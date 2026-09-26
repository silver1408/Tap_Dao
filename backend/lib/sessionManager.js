const crypto = require("crypto");

const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 12 * 60 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCKOUT_MS = 60 * 1000;
const MAX_SESSIONS_PER_CARD = 5;
const RENEW_PERSIST_INTERVAL_MS = 10 * 1000;
const SESSION_REAPER_INTERVAL_MS = 60 * 1000;
// A session that a newer login replaced stays readable for a short grace
// period so the previous holder gets a precise "someone else signed in"
// answer instead of a misleading "session expired".
const SUPERSEDED_GRACE_MS = 60 * 1000;
// Scan claims let a kiosk that was *not* the HTTP caller (a phone triggering
// /scan over the tunnel) establish its own isolated session.
const CLAIM_TTL_MS = 90 * 1000;

function parseCookies(header) {
  const jar = {};
  if (!header || typeof header !== "string") return jar;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const value = part.slice(index + 1).trim();
    try {
      jar[key] = decodeURIComponent(value);
    } catch (_error) {
      jar[key] = value;
    }
  }
  return jar;
}

function createSessionManager(options) {
  const store = options.store;
  const logger = options.logger || console;
  const cookieName = options.cookieName || "tapdao_sid";
  const idleTtlMs = Number(options.idleTtlMs || DEFAULT_IDLE_TTL_MS);
  const absoluteTtlMs = Number(options.absoluteTtlMs || DEFAULT_ABSOLUTE_TTL_MS);
  const secureCookies = Boolean(options.secureCookies);
  const ephemeralSecret = !options.secret;
  // Shared-kiosk default: a new login supersedes the previous member.
  // Set to false only if several kiosks must hold sessions independently.
  const supersedeOthers = options.supersedeOthers !== false;

  const secret = options.secret || crypto.randomBytes(32).toString("hex");
  if (ephemeralSecret) {
    logger.warn(
      "[session] SESSION_SECRET is not set — generated a random one. Sessions will not survive a restart. Set SESSION_SECRET in backend/.env.",
    );
  }

  const now = () => Date.now();

  function sign(id, cardId, issuedAt) {
    return crypto
      .createHmac("sha256", secret)
      .update(`${id}.${cardId}.${issuedAt}`)
      .digest("base64url");
  }

  function serializeCookie(id, cardId, issuedAt) {
    return `${id}.${issuedAt}.${sign(id, cardId, issuedAt)}`;
  }

  function clearCookieHeader(secure) {
    const parts = [
      `${cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=0`,
      `Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    ];
    if (secure ?? secureCookies) parts.push("Secure");
    return parts.join("; ");
  }

  function sessionCookieHeader(id, cardId, issuedAt, secure) {
    const parts = [
      `${cookieName}=${encodeURIComponent(serializeCookie(id, cardId, issuedAt))}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(idleTtlMs / 1000)}`,
    ];
    if (secure ?? secureCookies) parts.push("Secure");
    return parts.join("; ");
  }

  function issue(cardId, issueOptions = {}) {
    const id = crypto.randomBytes(32).toString("hex");
    const issuedAt = now();
    const shouldSupersede =
      issueOptions.supersedeOthers ?? supersedeOthers;
    const record = {
      cardId,
      kind: issueOptions.kind || "mobile",
      // Public, per-session random id. It is *not* the cookie value: the cookie
      // stays HttpOnly and HMAC-signed, while this handle only lets a browser
      // prove which session it believes it holds (shared-kiosk isolation).
      handle: crypto.randomBytes(16).toString("hex"),
      issuedAt,
      lastSeenAt: issuedAt,
      expiresAt: issuedAt + idleTtlMs,
      absoluteExpiresAt: issuedAt + absoluteTtlMs,
    };
    store.mutate((state) => {
      if (!shouldSupersede) {
        state.sessions[id] = record;
      } else {
        // One shared kiosk, one active member: a new login immediately
        // supersedes every previous session, whatever card it was for.
        for (const [otherId, other] of Object.entries(state.sessions)) {
          if (otherId === id || !other) continue;
          if (other.supersededAt) continue;
          other.supersededAt = issuedAt;
          other.supersededBy = id;
          other.expiresAt = Math.min(
            other.expiresAt || issuedAt,
            issuedAt + SUPERSEDED_GRACE_MS,
          );
        }
        state.sessions[id] = record;
      }
      const siblings = Object.entries(state.sessions)
        .filter(([, value]) => value && value.cardId === cardId)
        .sort((a, b) => (a[1].issuedAt || 0) - (b[1].issuedAt || 0));
      while (siblings.length > MAX_SESSIONS_PER_CARD) {
        const [oldestId] = siblings.shift();
        if (oldestId !== id) delete state.sessions[oldestId];
      }
    });
    return { id, record };
  }

  function isSuperseded(record) {
    return Boolean(record && record.supersededAt);
  }

  function handleMatches(session, handle) {
    if (!handle) return true; // client did not claim a session
    if (!session || !session.record) return false;
    const provided = String(handle);
    const expected = String(session.record.handle || "");
    if (!expected || provided.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  // ── Single-use scan claims ──
  function hashClaim(token) {
    return crypto.createHash("sha256").update(String(token)).digest("hex");
  }

  function pruneClaims(nowMs) {
    store.mutate((state) => {
      for (const [key, claim] of Object.entries(state.claims || {})) {
        if (!claim || claim.expiresAt <= nowMs) delete state.claims[key];
      }
    });
  }

  function issueClaim(cardId) {
    pruneClaims(now());
    const token = crypto.randomBytes(32).toString("hex");
    const key = hashClaim(token);
    store.mutate((state) => {
      state.claims[key] = { cardId, expiresAt: now() + CLAIM_TTL_MS };
    });
    return { token, cardId, expiresAt: now() + CLAIM_TTL_MS };
  }

  function consumeClaim(token) {
    if (typeof token !== "string" || token.length < 16) return null;
    const key = hashClaim(token);
    const state = store.getState();
    const claim = state.claims && state.claims[key];
    if (!claim) return null;
    // Single use: burn the claim even if it has just expired, so a replayed
    // token can never be redeemed twice.
    store.mutate((current) => {
      delete current.claims[key];
    });
    if (claim.expiresAt <= now()) return null;
    return { cardId: claim.cardId };
  }

  function peekClaim(token) {
    if (typeof token !== "string" || token.length < 16) return null;
    const claim = store.getState().claims[hashClaim(token)];
    if (!claim || claim.expiresAt <= now()) return null;
    return { cardId: claim.cardId, expiresAt: claim.expiresAt };
  }

  function parseCookieValue(value) {
    if (typeof value !== "string") return null;
    const parts = value.split(".");
    if (parts.length !== 3) return null;
    const [id, issuedAtRaw, signature] = parts;
    if (!/^[a-f0-9]{64}$/.test(id) || !/^\d+$/.test(issuedAtRaw)) return null;
    const cardId = store.getState().sessions[id] && store.getState().sessions[id].cardId;
    if (!cardId) return null;
    const expected = sign(id, cardId, Number(issuedAtRaw));
    const provided = Buffer.from(signature);
    const computed = Buffer.from(expected);
    if (provided.length !== computed.length) return null;
    if (!crypto.timingSafeEqual(provided, computed)) return null;
    return { id, cardId, issuedAt: Number(issuedAtRaw) };
  }

  function revoke(id) {
    if (!id) return;
    store.mutate((state) => {
      delete state.sessions[id];
    });
  }

  function isExpired(record) {
    const t = now();
    return !record || record.expiresAt <= t || record.absoluteExpiresAt <= t;
  }

  function remainingMs(record) {
    if (!record) return 0;
    return Math.max(0, Math.min(record.expiresAt, record.absoluteExpiresAt) - now());
  }

  function get(id) {
    if (!id) return null;
    return store.getState().sessions[id] || null;
  }

  function touch(id) {
    const record = get(id);
    if (!record) return null;
    const t = now();
    if (record.expiresAt <= t || record.absoluteExpiresAt <= t) {
      revoke(id);
      return null;
    }
    // The idle window always slides in memory; persisting is throttled so a
    // chatty kiosk does not rewrite the state file on every request.
    record.expiresAt = Math.min(t + idleTtlMs, record.absoluteExpiresAt);
    if (t - record.lastSeenAt >= RENEW_PERSIST_INTERVAL_MS) {
      record.lastSeenAt = t;
      store.mutate((state) => {
        state.sessions[id] = record;
      });
    }
    return record;
  }

  // PIN failures are tracked per card, not per session: re-tapping a card
  // mints a new session, so a per-session counter could be reset for free.
  function cardIdOf(target) {
    if (!target) return null;
    if (typeof target === "string") return target;
    if (target.record && target.record.cardId) return target.record.cardId;
    if (target.cardId) return target.cardId;
    return null;
  }

  function isPinLocked(target) {
    const cardId = cardIdOf(target);
    if (!cardId) return false;
    const lock = store.getState().pinLocks[cardId];
    return Boolean(lock) && Number(lock.lockedUntil || 0) > now();
  }

  function registerPinFailure(target) {
    const cardId = cardIdOf(target);
    if (!cardId) return null;
    let lock = null;
    store.mutate((state) => {
      const current = state.pinLocks[cardId] || { failures: 0, lockedUntil: 0 };
      current.failures = Number(current.failures || 0) + 1;
      if (current.failures >= PIN_MAX_FAILURES) {
        current.lockedUntil = now() + PIN_LOCKOUT_MS;
        current.failures = 0;
      }
      state.pinLocks[cardId] = current;
      lock = current;
    });
    return lock;
  }

  function clearPinFailures(target) {
    const cardId = cardIdOf(target);
    if (!cardId) return;
    store.mutate((state) => {
      delete state.pinLocks[cardId];
    });
  }

  function startReaper() {
    const timer = setInterval(() => {
      const state = store.getState();
      const t = now();
      let removed = 0;
      for (const [id, record] of Object.entries(state.sessions)) {
        if (!record || record.expiresAt <= t || record.absoluteExpiresAt <= t) {
          delete state.sessions[id];
          removed += 1;
        }
      }
      if (removed > 0) {
        logger.log(`[session] Reaped ${removed} expired session(s)`);
        store.mutate(() => undefined);
      }
    }, SESSION_REAPER_INTERVAL_MS);
    if (timer.unref) timer.unref();
    return timer;
  }

  function fromRequest(req) {
    const cookies = parseCookies(req.headers && req.headers.cookie);
    const parsed = parseCookieValue(cookies[cookieName]);
    if (!parsed) return null;
    const record = get(parsed.id);
    if (!record || record.cardId !== parsed.cardId) return null;
    if (isExpired(record)) {
      revoke(parsed.id);
      return null;
    }
    return { id: parsed.id, record, superseded: isSuperseded(record) };
  }

  /**
   * The session a request may act with: a superseded one is reported apart so
   * the caller can tell "you were replaced" from "your session expired".
   */
  function activeFromRequest(req) {
    const session = fromRequest(req);
    if (!session || session.superseded) return null;
    return session;
  }

  function attach(res, session, secure) {
    res.setHeader(
      "Set-Cookie",
      sessionCookieHeader(
        session.id,
        session.record.cardId,
        session.record.issuedAt,
        secure,
      ),
    );
  }

  function clear(res, secure) {
    res.setHeader("Set-Cookie", clearCookieHeader(secure));
  }

  function publicView(session) {
    return {
      cardId: session.record.cardId,
      handle: session.record.handle,
      issuedAt: session.record.issuedAt,
      expiresAt: session.record.expiresAt,
      absoluteExpiresAt: session.record.absoluteExpiresAt,
      remainingMs: remainingMs(session.record),
    };
  }

  return {
    cookieName,
    idleTtlMs,
    absoluteTtlMs,
    secureCookies,
    ephemeralSecret,
    sign,
    issue,
    get,
    touch,
    revoke,
    serializeCookie,
    parseCookieValue,
    parseCookies,
    fromRequest,
    activeFromRequest,
    isSuperseded,
    handleMatches,
    issueClaim,
    peekClaim,
    consumeClaim,
    attach,
    clear,
    publicView,
    remainingMs,
    isPinLocked,
    registerPinFailure,
    clearPinFailures,
    startReaper,
    limits: { pinMaxFailures: PIN_MAX_FAILURES, pinLockoutMs: PIN_LOCKOUT_MS },
  };
}

module.exports = {
  createSessionManager,
  parseCookies,
  DEFAULT_IDLE_TTL_MS,
  DEFAULT_ABSOLUTE_TTL_MS,
  SUPERSEDED_GRACE_MS,
  CLAIM_TTL_MS,
  PIN_MAX_FAILURES,
  PIN_LOCKOUT_MS,
};
