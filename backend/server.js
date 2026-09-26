require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const { ethers } = require("ethers");
const crypto = require("crypto");
const QRCode = require("qrcode");
const multer = require("multer");
const {
  summarizeProposalProblem,
  generateProposalFromDescription,
  checkAiHealth,
  aiConfig,
  AiServiceError,
} = require("./services/proposalSummaryService");
const { createStore, installShutdownFlush } = require("./lib/jsonStore");
const { createSessionManager } = require("./lib/sessionManager");

const app = express();
app.disable("x-powered-by");
// Behind the Cloudflare Tunnel every request arrives over HTTPS on a local
// port, so the forwarded protocol header is the only reliable source for
// req.secure. TRUST_PROXY=0 is only for running the API directly.
const TRUST_PROXY = String(process.env.TRUST_PROXY || "1").toLowerCase();
app.set(
  "trust proxy",
  TRUST_PROXY === "0" || TRUST_PROXY === "false"
    ? false
    : TRUST_PROXY === "loopback"
      ? "loopback"
      : true,
);

/**
 * Reduces a configured public URL to a comparable `scheme://host[:port]`
 * origin: no trailing slash, no path, no query. Cloudflare sometimes hands out
 * a value with a trailing slash or an ingress path, and a mismatch there would
 * silently break CORS.
 */
function normalizePublicUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin.toLowerCase();
  } catch (_error) {
    return "";
  }
}

// Production topology: the kiosk UI is served from https://tap.kiyoai.in and
// this API is public at https://tap-back.kiyoai.in. Only the UI origin may send
// credentialed requests; every other origin is rejected outright.
const PUBLIC_APP_URL = normalizePublicUrl(process.env.PUBLIC_APP_URL);
const PUBLIC_API_URL = normalizePublicUrl(process.env.PUBLIC_API_URL);

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((value) => normalizePublicUrl(value))
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0 && PUBLIC_APP_URL) ALLOWED_ORIGINS.push(PUBLIC_APP_URL);

function isAllowedOrigin(origin) {
  if (!origin) return true; // same-origin / server-to-server / curl
  return ALLOWED_ORIGINS.includes(normalizePublicUrl(origin));
}

app.use(
  cors({
    origin(origin, callback) {
      // Never reflect an arbitrary origin: an allow-list miss gets no CORS
      // headers at all, so the browser blocks the (credentialed) request.
      callback(null, isAllowedOrigin(origin));
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Session-Handle"],
    maxAge: 86400,
  }),
);
// Responses differ per Origin, so caches must key on it.
app.use((req, res, next) => {
  res.setHeader("Vary", "Origin");
  next();
});
app.use(express.json({ limit: "256kb" }));

// Serve built frontend (from frontend/dist/) at root — this is the kiosk UI
const frontendDistPath = path.join(__dirname, "..", "frontend", "dist");
if (fs.existsSync(frontendDistPath)) {
  app.use(express.static(frontendDistPath));
}

// Legacy static files (backend/public for uploads etc)
app.use(express.static(path.join(__dirname, "public")));

// ── PERSISTENT STATE (survives restarts / container restarts) ──
const store = createStore();
const storeInfo = store.load();
installShutdownFlush(store);

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(
  "/uploads",
  express.static(uploadDir, {
    index: false,
    dotfiles: "deny",
    fallthrough: false,
    setHeaders(res) {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("X-Frame-Options", "DENY");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  }),
);

// ── IMAGE UPLOAD (allow-listed raster formats only) ──
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 5 * 1024 * 1024);
const ALLOWED_IMAGE_TYPES = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
]);

const storage = multer.diskStorage({
  destination: function (_req, _file, cb) {
    cb(null, uploadDir);
  },
  filename: function (_req, file, cb) {
    const ext = ALLOWED_IMAGE_TYPES.get(file.mimetype) || ".bin";
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 },
  fileFilter: function (_req, file, cb) {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      const error = new Error(
        `Unsupported image type "${file.mimetype}". Allowed: JPEG, PNG, WebP, GIF, AVIF.`,
      );
      error.status = 400;
      return cb(error);
    }
    return cb(null, true);
  },
});

const server = http.createServer(app);
// The browser opens the WebSocket from https://tap.kiyoai.in, so the handshake
// must be allowed for that origin only. `origin: "*"` is invalid together with
// `credentials: true` and would expose the session to any site.
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isAllowedOrigin(origin)),
    credentials: true,
    methods: ["GET", "POST"],
  },
});

const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const addressFilePath =
  process.env.ADDRESS_FILE || path.join(__dirname, "address.json");
const port = Number(process.env.PORT || 3001);

// ─────────────────────────────────────────────
//  WEB3 BLOCKCHAIN SETUP (Hardhat localhost)
// ─────────────────────────────────────────────

const provider = new ethers.JsonRpcProvider(rpcUrl);

// Read deployed contract metadata generated by deployment service.
const contractJSON = require("./artifacts/contracts/OffGridDAO.sol/OffGridDAO.json");
const { encrypt, decrypt } = require("./lib/crypto");
let contractAddress = "";
let contractAbi = contractJSON.abi;
let deploymentMetadata = null;
try {
  const raw = fs.readFileSync(addressFilePath, "utf8");
  deploymentMetadata = JSON.parse(raw);
  contractAddress = deploymentMetadata.contractAddress;
  if (
    Array.isArray(deploymentMetadata.abi) &&
    deploymentMetadata.abi.length > 0
  ) {
    contractAbi = deploymentMetadata.abi;
  }
} catch (e) {
  console.warn(
    "⚠️ Warning: address.json not found. Run deployment script first.",
  );
}

let daoContract;
if (contractAddress) {
  daoContract = new ethers.Contract(contractAddress, contractAbi, provider);
}

const DEV_ADMIN_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const DEV_HARDHAT_KEYS = [
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
  "0xf214f2b2cd398c806f84e317254e0f0b801d0643303237d97a22a48e01628897",
  "0x701b615bbdfb9de65240bc28bd21bbc0d996645a3dd57e7b12bc2bdf6f192c82",
  "0xa267530f49f8280200edf313ee7af6b827f2a8bce2897751d06a843f644967b1",
  "0x47c99abed3324a2707c28affff1267e45918ec8c3f20b8aa892e8b065d2942dd",
  "0xc526ee95bf44d8fc405a158bb884d9d1238d99f0612e9f33d006bb0789009aaa",
  "0x8166f546bab6da521a8369cab06c5d2b9e46670292d85c875ee9ec20e84ffb61",
  "0xea6c44ac03bff858b476bba40716402b03e41b8e97e276d1baec7c37d42484a0",
  "0x689af8efa8c651a91ad287602527f3af2fe9f6501a7ac4b061667b5a93e037fd",
  "0xde9be858da4a475276426320d5e9262ecfc3ba460bfac56360bfa6c4c28b4ee0",
  "0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e",
];

function parseKeyList(raw) {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => (value.startsWith("0x") ? value : `0x${value}`));
}

const ADMIN_KEY = process.env.ADMIN_PRIVATE_KEY || DEV_ADMIN_KEY;
const VOTER_KEYS = parseKeyList(process.env.VOTER_PRIVATE_KEYS).length
  ? parseKeyList(process.env.VOTER_PRIVATE_KEYS)
  : DEV_HARDHAT_KEYS;
const USING_DEV_KEYS = ADMIN_KEY === DEV_ADMIN_KEY || !process.env.VOTER_PRIVATE_KEYS;

const adminSigner = new ethers.Wallet(ADMIN_KEY, provider);
let adminContract;
if (daoContract) {
  adminContract = daoContract.connect(adminSigner);
}

// ─────────────────────────────────────────────
//  SESSIONS (server-side, signed httpOnly cookie)
// ─────────────────────────────────────────────

const sessions = createSessionManager({
  store,
  secret: process.env.SESSION_SECRET,
  cookieName: process.env.SESSION_COOKIE_NAME || "tapdao_sid",
  idleTtlMs: Number(process.env.SESSION_IDLE_TTL_MS || 0) || undefined,
  absoluteTtlMs: Number(process.env.SESSION_ABSOLUTE_TTL_MS || 0) || undefined,
  // The UI and the API live on different Cloudflare hostnames, so the cookie
  // must be SameSite=None; Secure to survive cross-origin fetch requests.
  sameSite: process.env.SESSION_COOKIE_SAME_SITE || "lax",
});
sessions.startReaper();

function wantsSecureCookie(req) {
  const flag = (process.env.COOKIE_SECURE || "auto").toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  const forwarded = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req.secure) || forwarded === "https";
}

function currentSession(req) {
  return sessions.activeFromRequest(req);
}

function claimedHandle(req) {
  const header = req.headers["x-session-handle"];
  if (typeof header === "string" && header.trim()) return header.trim();
  return null;
}

/**
 * Resolves the session a request may act with, distinguishing the three ways a
 * kiosk session can be unusable:
 *   - no/expired session            → 401 SESSION_EXPIRED
 *   - replaced by another card tap  → 409 SESSION_SUPERSEDED
 *   - client believes in another session (shared kiosk) → 409 SESSION_SUPERSEDED
 */
function authorizeSession(req, res) {
  const raw = sessions.fromRequest(req);
  if (!raw) {
    sendEncrypted(res, 401, {
      error: "Session expired. Tap your card to continue.",
      code: "SESSION_EXPIRED",
    });
    return null;
  }
  if (raw.superseded) {
    sessions.clear(res, wantsSecureCookie(req));
    sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
    return null;
  }
  const handle = claimedHandle(req);
  if (!handle) {
    // `sendEncrypted` returns the Express response, so it must never be the
    // return value of this function — callers treat a truthy result as a
    // usable session.
    sendEncrypted(res, 401, {
      error: "No active session",
      code: "SESSION_UNCLAIMED",
    });
    return null;
  }
  if (!sessions.handleMatches(raw, handle)) {
    sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
    return null;
  }
  return raw;
}

function issueSession(req, res, cardId) {
  const previous = sessions.fromRequest(req);
  const session = sessions.issue(cardId);
  sessions.attach(res, session, wantsSecureCookie(req));
  if (previous && previous.record.cardId !== cardId) {
    logSessionSwitch(previous.record.cardId, cardId);
  }
  return session;
}

function logSessionSwitch(fromCardId, toCardId) {
  const from = getVoter(fromCardId);
  const to = getVoter(toCardId);
  console.log(
    `🔁 Kiosk session handed over: ${from ? from.name : fromCardId} → ${to ? to.name : toCardId}`,
  );
}

// ─────────────────────────────────────────────
//  DYNAMIC VOTER REGISTRY (persistent)
// ─────────────────────────────────────────────

// Stateless PIN encryption
function encryptPayload(text, pin) {
  const key = crypto.pbkdf2Sync(pin, "salt", 100000, 32, "sha256");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return { iv: iv.toString("hex"), encrypted, authTag };
}

function decryptPayload(encryptedObj, pin) {
  const key = crypto.pbkdf2Sync(pin, "salt", 100000, 32, "sha256");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(encryptedObj.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(encryptedObj.authTag, "hex"));
  let decrypted = decipher.update(encryptedObj.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

function getVoter(cardId) {
  if (!cardId) return null;
  return store.getState().voters[cardId] || null;
}

function listVoters() {
  return Object.values(store.getState().voters);
}

function saveVoter(voter) {
  store.mutate((state) => {
    state.voters[voter.cardId] = voter;
  });
  return voter;
}

function allocateWalletSlot() {
  const used = new Set(
    listVoters()
      .map((voter) => (voter.wallet || "").toLowerCase())
      .filter(Boolean),
  );
  for (const privateKey of VOTER_KEYS) {
    let address;
    try {
      address = new ethers.Wallet(privateKey).address;
    } catch (_error) {
      continue;
    }
    if (!used.has(address.toLowerCase())) {
      return { privateKey, address };
    }
  }
  return null;
}

function getProposalImage(proposalId) {
  const record = store.getState().proposalImages[String(proposalId)];
  return record ? record.imageUrl : "";
}

function saveProposalImage(proposalId, imageUrl) {
  store.mutate((state) => {
    state.proposalImages[String(proposalId)] = {
      imageUrl,
      createdAt: new Date().toISOString(),
    };
  });
}

function listInvites() {
  return store.getState().invites;
}

function addTransaction(entry) {
  return store.pushTransaction(entry);
}

// Helper to read all proposals from blockchain
async function readAllProposals() {
  const proposalsData = [];
  if (!daoContract) return proposalsData;
  try {
    const count = await daoContract.proposalCount();
    for (let i = 1; i <= Number(count); i++) {
      const p = await daoContract.getProposal(i);
      proposalsData.push({
        id: Number(p.id),
        title: p.title,
        description: p.description,
        category: p.category,
        fundsRequested: Number(p.fundsRequested),
        votes: Number(p.votes),
        status: p.active ? "active" : "inactive",
        imageUrl: getProposalImage(Number(p.id)),
      });
    }
  } catch (e) {
    console.error("Error reading proposals:", e);
  }
  return proposalsData;
}

function ensureContractReady(res) {
  if (!daoContract || !adminContract || !contractAddress) {
    sendEncrypted(res, 503, {
      error: "Contract not ready yet. Wait for deployment to complete.",
      addressFilePath,
    });
    return false;
  }
  return true;
}

function buildEncryptedPayload(data) {
  return { payload: encrypt(JSON.stringify(data)) };
}

function sendEncrypted(res, statusCode, data) {
  return res.status(statusCode).json(buildEncryptedPayload(data));
}

function readEncryptedBody(req) {
  const body = req.body;

  if (body && typeof body === "object" && typeof body.payload === "string") {
    const decrypted = decrypt(body.payload);
    if (!decrypted) return null;
    try {
      return JSON.parse(decrypted);
    } catch (_error) {
      return null;
    }
  }

  // Backward compatibility for non-encrypted callers.
  if (body && typeof body === "object") {
    return body;
  }

  if (typeof body === "string") {
    const decrypted = decrypt(body);
    if (!decrypted) return null;
    try {
      return JSON.parse(decrypted);
    } catch (_error) {
      return null;
    }
  }

  return null;
}

// ─────────────────────────────────────────────
//  SESSION-AWARE PIN AUTHORISATION
// ─────────────────────────────────────────────

function publicVoter(voter, extra = {}) {
  return {
    name: voter.name,
    avatar: voter.avatar,
    wallet: voter.wallet,
    ward: voter.ward,
    cardId: voter.cardId,
    registeredAt: voter.registeredAt,
    ...extra,
  };
}

/**
 * Resolves the wallet vault for a PIN-gated action.
 * Prefers the server-side session (the encrypted payload never leaves the
 * server) and only falls back to a client-supplied payload for the legacy
 * stateless API shape.
 */
function resolveVault(req, session, data) {
  if (session && session.record) {
    const voter = getVoter(session.record.cardId);
    if (voter && voter.encryptedPayload) {
      return { voter, encryptedPayload: voter.encryptedPayload };
    }
  }
  if (data && data.encryptedPayload && data.cardId) {
    const voter = getVoter(data.cardId);
    if (voter) return { voter, encryptedPayload: data.encryptedPayload };
  }
  if (data && data.encryptedPayload) {
    return { voter: null, encryptedPayload: data.encryptedPayload };
  }
  return null;
}

/**
 * Defence in depth for the shared kiosk: a stale client that still believes it
 * is another member must never unlock that member's wallet, even if it somehow
 * carries the current cookie.
 */
function sessionCardMatches(session, data) {
  if (!session || !session.record) return true;
  const claimed = data && typeof data.cardId === "string" ? data.cardId.trim() : "";
  if (!claimed) return true; // legacy clients that omit cardId
  return claimed === session.record.cardId;
}

function requireSession(req, res) {
  return authorizeSession(req, res);
}

function sendPinError(res, session) {
  if (session && sessions.isPinLocked(session)) {
    const lock = store.getState().pinLocks[session.record.cardId];
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((Number(lock && lock.lockedUntil) - Date.now()) / 1000),
    );
    return sendEncrypted(res, 429, {
      error: `Too many incorrect PIN attempts. Try again in ${retryAfterSeconds}s.`,
      code: "PIN_LOCKED",
    });
  }
  return null;
}

function unlockWithPin(session, pin, encryptedPayload) {
  let privateKey;
  try {
    privateKey = decryptPayload(encryptedPayload, pin);
  } catch (_error) {
    if (session) sessions.registerPinFailure(session);
    return null;
  }
  if (session) sessions.clearPinFailures(session);
  try {
    return new ethers.Wallet(privateKey, provider);
  } catch (_error) {
    return null;
  }
}

// ─────────────────────────────────────────────
//  API ROUTES
// ─────────────────────────────────────────────

// Image upload endpoint
app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided." });
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  return res.json({ imageUrl: fileUrl, bytes: req.file.size });
});

app.get("/health", (req, res) => {
  return res.json({
    status: "ok",
    port,
    contract: contractAddress || null,
    registeredCards: listVoters().length,
    storage: { dataFile: store.file, uploads: uploadDir },
    ai: aiConfig(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// AI provider status (no credentials are ever returned)
app.get("/ai/status", async (req, res) => {
  return res.json(await checkAiHealth());
});

app.get("/contract", (req, res) => {
  if (!contractAddress) {
    return sendEncrypted(res, 503, {
      error: "Contract metadata unavailable",
      addressFilePath,
    });
  }

  return sendEncrypted(res, 200, {
    name:
      (deploymentMetadata && deploymentMetadata.contractName) || "OffGridDAO",
    contractAddress,
    abi: contractAbi,
    rpcUrl,
    deployedAt: deploymentMetadata && deploymentMetadata.deployedAt,
  });
});

// ── Session lifecycle ──
app.get("/session", (req, res) => {
  const raw = sessions.fromRequest(req);
  const handle = claimedHandle(req);

  if (!raw || raw.superseded) {
    sessions.clear(res, wantsSecureCookie(req));
    return sendEncrypted(res, 401, {
      error: "No active session",
      code: raw ? "SESSION_SUPERSEDED" : "SESSION_UNCLAIMED",
    });
  }

  // A kiosk that cannot say which session it holds (fresh page load, or a
  // different member at the same device) must never inherit it, and a handle
  // that names a different session means this one was taken over.
  if (!handle) {
    return sendEncrypted(res, 401, {
      error: "No active session",
      code: "SESSION_UNCLAIMED",
    });
  }
  if (!sessions.handleMatches(raw, handle)) {
    return sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
  }

  const voter = getVoter(raw.record.cardId);
  if (!voter) {
    sessions.revoke(raw.id);
    sessions.clear(res, wantsSecureCookie(req));
    return sendEncrypted(res, 401, {
      error: "Card is no longer registered",
      code: "SESSION_EXPIRED",
    });
  }
  sessions.touch(raw.id);
  return sendEncrypted(res, 200, {
    voter: publicVoter(voter),
    session: sessions.publicView({ id: raw.id, record: sessions.get(raw.id) }),
  });
});

app.post("/session/touch", (req, res) => {
  const session = requireSession(req, res);
  if (!session) return undefined;
  const record = sessions.touch(session.id);
  if (!record) {
    sessions.clear(res, wantsSecureCookie(req));
    return sendEncrypted(res, 401, {
      error: "Session expired. Tap your card to continue.",
      code: "SESSION_EXPIRED",
    });
  }
  sessions.attach(res, { id: session.id, record }, wantsSecureCookie(req));
  return sendEncrypted(res, 200, { session: sessions.publicView({ id: session.id, record }) });
});

/**
 * Signs the kiosk out. Always clears the cookie and always succeeds, even when
 * the session is already gone, so the next member starts from a clean slate.
 */
app.post("/session/logout", (req, res) => {
  const handle = claimedHandle(req);
  const raw = sessions.fromRequest(req);
  const logoutBody = readEncryptedBody(req) || {};
  markSocketSession(logoutBody.socketId, null);
  if (raw) {
    // Revoke whatever the cookie points at: after a handover the cookie may
    // belong to another member, and leaving it alive would let the next person
    // inherit their session.
    if (handle && !sessions.handleMatches(raw, handle)) {
      console.warn("⚠️  Logout presented a stale session handle — dropping the cookie session anyway.");
    }
    sessions.revoke(raw.id);
  }
  sessions.clear(res, wantsSecureCookie(req));
  console.log("👋 Kiosk session signed out");
  return sendEncrypted(res, 200, { success: true });
});

/**
 * Exchanges a scan claim for a first-class session on the kiosk itself.
 * Scans are usually triggered from a member's phone, so the kiosk browser never
 * received the Set-Cookie and previously could not authenticate at all (hence
 * the endless "Session Expired" on PIN-gated actions). The claim is single-use
 * and short-lived, and only proves which card was scanned: every sensitive
 * action still requires the member's PIN.
 */
app.post("/session/claim", (req, res) => {
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, { error: "Invalid encrypted payload" });
  }

  const claim = sessions.consumeClaim(data.claim);
  if (!claim) {
    return sendEncrypted(res, 401, {
      error: "This scan has already been used or expired. Tap your card again.",
      code: "CLAIM_INVALID",
    });
  }

  const voter = getVoter(claim.cardId);
  if (!voter) {
    return sendEncrypted(res, 404, {
      error: "Card is no longer registered",
      code: "CARD_UNKNOWN",
    });
  }

  // The kiosk is now this member's device: take the session over from whoever
  // was signed in before.
  const session = issueSession(req, res, claim.cardId);

  markSocketSession(data.socketId, claim.cardId);

  return sendEncrypted(res, 200, {
    voter: publicVoter(voter, { tokenBalance: null }),
    session: sessions.publicView(session),
  });
});

// Check if a card is registered
app.get("/card/:cardId", (req, res) => {
  const cardId = req.params.cardId;
  const voter = getVoter(cardId);
  if (voter) {
    return sendEncrypted(res, 200, {
      registered: true,
      name: voter.name,
      wallet: voter.wallet,
      cardId,
    });
  }
  return sendEncrypted(res, 200, { registered: false, cardId });
});

// Register a new NFC card
app.post("/register", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, { error: "Invalid encrypted payload" });
  }

  const { cardId, name, pin } = data;
  if (typeof cardId !== "string" || !cardId.trim() || cardId.length > 128) {
    return sendEncrypted(res, 400, { error: "A valid cardId is required" });
  }
  if (typeof pin !== "string" || pin.length < 4 || pin.length > 32) {
    return sendEncrypted(res, 400, {
      error: "cardId and a 4-digit pin are required",
    });
  }

  const normalizedCardId = cardId.trim();

  // Check if already registered
  const existing = getVoter(normalizedCardId);
  if (existing) {
    return sendEncrypted(res, 409, {
      error: "This card is already registered",
      voter: { name: existing.name, cardId: normalizedCardId },
    });
  }

  const slot = allocateWalletSlot();
  if (!slot) {
    return sendEncrypted(res, 503, {
      error: `No free wallet slot left (max ${VOTER_KEYS.length} voters). Increase VOTER_PRIVATE_KEYS to onboard more members.`,
      code: "NO_WALLET_SLOT",
    });
  }

  const voterName =
    (typeof name === "string" && name.trim()) ||
    `Voter ${normalizedCardId.slice(-4)}`;

  // Encrypt private key with user's PIN
  const encPayload = encryptPayload(slot.privateKey, pin);

  // Persist immediately so a concurrent duplicate request cannot claim the
  // same card (the async token allocation below yields the event loop).
  const voterData = saveVoter({
    name: voterName.slice(0, 80),
    avatar: "🧑",
    wallet: slot.address,
    encryptedPayload: encPayload,
    ward: "Community Member",
    cardId: normalizedCardId,
    registeredAt: new Date().toISOString(),
  });
  console.log(`✅ Card registered: ${normalizedCardId} → ${voterName}`);

  // Allocate tokens on-chain
  let tokenBalance = 0;
  try {
    console.log(`🪙 Allocating tokens to ${slot.address} for "${voterName}"`);
    const alreadyInitialized = await daoContract.isInitialized(slot.address);
    if (!alreadyInitialized) {
      const allocTx = await adminContract.allocateTokens(slot.address, 1000);
      await allocTx.wait();
      console.log(`✅ 1000 tokens allocated to ${slot.address}`);
    }
    tokenBalance = Number(await daoContract.getTokenBalance(slot.address));
  } catch (e) {
    console.error("Token allocation error:", e.reason || e.message);
  }

  const session = issueSession(req, res, normalizedCardId);
  markSocketSession(req.query && req.query.socketId, normalizedCardId);

  // Broadcast registration event
  io.emit("voter-registered", {
    cardId: normalizedCardId,
    name: voterName,
    wallet: slot.address,
    registeredVoters: listVoters().length,
  });

  return sendEncrypted(res, 200, {
    success: true,
    voter: publicVoter(voterData, { tokenBalance }),
    session: sessions.publicView(session),
  });
});

// ─────────────────────────────────────────────
//  PROPOSALS
// ─────────────────────────────────────────────

// Get all proposals from the SMART CONTRACT
app.get("/proposals", async (req, res) => {
  if (!ensureContractReady(res)) return;
  return sendEncrypted(res, 200, await readAllProposals());
});

const IMAGE_URL_PATTERN = /^\/uploads\/[A-Za-z0-9._-]+$/;

// Create a new proposal (costs 200 tokens: deducted from creator)
app.post("/proposals", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, {
      error: "Invalid encrypted payload",
    });
  }

  const { title, description, category, fundsRequested, imageUrl, pin, cardId } = data;
  if (typeof title !== "string" || !title.trim() || !fundsRequested) {
    return sendEncrypted(res, 400, {
      error: "Missing title or fundsRequested",
    });
  }

  if (typeof pin !== "string" || !pin) {
    return sendEncrypted(res, 400, {
      error: "Missing PIN to authorize creation fee",
    });
  }

  if (imageUrl && !IMAGE_URL_PATTERN.test(String(imageUrl))) {
    return sendEncrypted(res, 400, { error: "Invalid imageUrl" });
  }

  const session = requireSession(req, res);
  if (!session) return undefined;
  if (!sessionCardMatches(session, data)) {
    return sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
  }

  const vault = resolveVault(req, session, data);
  if (!vault) {
    return sendEncrypted(res, 401, {
      error: "Session expired. Tap your card to continue.",
      code: "SESSION_EXPIRED",
    });
  }

  const locked = sendPinError(res, session);
  if (locked) return locked;

  const signer = unlockWithPin(session, pin, vault.encryptedPayload);
  if (!signer) {
    console.error("❌ Proposal creation failed: Wrong PIN!");
    return sendEncrypted(res, 401, {
      error: "Incorrect PIN. Vault failed to open.",
      code: "PIN_INVALID",
    });
  }

  const connectedContract = daoContract.connect(signer);

  try {
    console.log(`📝 Creating new proposal using signer ${signer.address}...`);
    const tx = await connectedContract.createProposal(
      title.trim().slice(0, 200),
      (description || "").slice(0, 5000),
      category || "General",
      fundsRequested,
    );
    await tx.wait();
    console.log(`✅ Proposal created on-chain! TX: ${tx.hash}`);

    // Store image URL server-side (contract doesn't support it)
    const newCount = Number(await daoContract.proposalCount());
    if (imageUrl) {
      saveProposalImage(newCount, imageUrl);
    }

    // Explicitly emit vote event for the creator (since they are now part of the 1 vote)
    const p = await daoContract.getProposal(newCount);
    const proposalObj = {
      id: Number(p.id),
      title: p.title,
      description: p.description,
      category: p.category,
      fundsRequested: Number(p.fundsRequested),
      votes: Number(p.votes),
      imageUrl: getProposalImage(Number(p.id)),
      status: p.active ? "active" : "inactive",
    };

    const txEntry = addTransaction({
      type: "VOTE_CAST", // It acts as a vote
      hash: tx.hash,
    });

    const updatedBalance = Number(await daoContract.getTokenBalance(signer.address));

    // Emit the vote-recorded so it pushes up to frontend instantly
    io.emit("vote-recorded", {
      voter: { name: "Creator", wallet: signer.address, tokenBalance: updatedBalance },
      proposal: proposalObj,
      transaction: txEntry,
    });

    // Re-read all proposals and broadcast to all dashboards
    const allProposals = await readAllProposals();
    io.emit("proposals-updated", allProposals);

    return sendEncrypted(res, 200, {
      success: true,
      transactionHash: tx.hash,
    });
  } catch (e) {
    console.error("❌ Failed to create proposal:", e.reason || e.message);
    return sendEncrypted(res, 500, {
      error:
        e.reason ||
        "Failed to create proposal. Ensure you have 200 tokens and haven't voted.",
    });
  }
});

function sendAiError(res, error) {
  const status = error instanceof AiServiceError ? error.status : 502;
  const code = error instanceof AiServiceError ? error.code : "AI_ERROR";
  const isConfigIssue = code === "AI_NOT_CONFIGURED";
  console.error(`❌ AI request failed [${code}]: ${error.message}`);
  return sendEncrypted(res, status, {
    error: isConfigIssue
      ? "AI Assist is not configured on the server. Ask the operator to set COLAB_AI_URL."
      : error.message,
    code,
  });
}

app.post("/proposals/summarize-problem", async (req, res) => {
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, {
      error: "Invalid encrypted payload",
    });
  }

  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";

  if (!title) {
    return sendEncrypted(res, 400, {
      error: "Proposal title is required",
    });
  }

  try {
    const { summary, model } = await summarizeProposalProblem({
      title,
      description,
    });

    return sendEncrypted(res, 200, { summary, model });
  } catch (error) {
    return sendAiError(res, error);
  }
});

// AI Proposal Generation
app.post("/proposals/generate", async (req, res) => {
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, {
      error: "Invalid encrypted payload",
    });
  }

  const userText =
    typeof data.text === "string" ? data.text.trim() : "";

  if (!userText) {
    return sendEncrypted(res, 400, {
      error: "Please describe your proposal idea",
    });
  }

  try {
    const generated = await generateProposalFromDescription(userText);
    console.log(`✅ AI generated proposal: "${generated.title}"`);

    return sendEncrypted(res, 200, generated);
  } catch (error) {
    return sendAiError(res, error);
  }
});

// ─────────────────────────────────────────────
//  NFC SCAN → Identify Voter
// ─────────────────────────────────────────────
app.get("/scan", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const cardId = String(req.query.cardId || "Unknown_Card").trim();
  const socketId = req.query.socketId || null;
  console.log(`\n📡 NFC SCAN DETECTED: ${cardId}`);

  const voter = getVoter(cardId);

  if (!voter) {
    // Unknown card — tell frontend to show registration
    console.log(`❓ Unknown card: ${cardId} — registration required`);

    const payload = {
      type: "unregistered",
      cardId,
    };

    emitCardScanned(socketId, payload);

    return sendEncrypted(res, 200, {
      success: true,
      registered: false,
      cardId,
    });
  }

  // Known card — read balance and emit to connected clients
  try {
    const alreadyInitialized = await daoContract.isInitialized(voter.wallet);
    if (!alreadyInitialized) {
      console.log(`🪙 Re-initializing tokens for ${voter.name} on new chain...`);
      const allocTx = await adminContract.allocateTokens(voter.wallet, 1000);
      await allocTx.wait();
    }
  } catch (e) {
    console.error("Balance read error:", e.reason || e.message);
  }

  const txEntry = addTransaction({ type: "IDENTITY_VERIFY", hash: identityHash() });
  store.mutate((state) => {
    state.voters[cardId] = { ...voter, lastSeenAt: new Date().toISOString() };
  });

  const session = issueSession(req, res, cardId);
  markSocketSession(socketId, cardId);

  // The HTTP caller (kiosk-side scan) gets a cookie. A scan triggered from a
  // member's phone gets a single-use claim instead, which the kiosk exchanges
  // for its own isolated session — no session material is broadcast.
  const claim = sessions.issueClaim(cardId);
  const scanPayload = {
    type: "registered",
    cardId,
    voter: publicVoter(voter, { tokenBalance: null }), // Hidden until PIN verified
    claim: claim.token,
    transaction: txEntry,
  };

  emitCardScanned(socketId, scanPayload);

  return sendEncrypted(res, 200, {
    success: true,
    registered: true,
    name: voter.name,
    voter: publicVoter(voter, { tokenBalance: null }),
    cardId,
    tokenBalance: null, // Hidden until the PIN is verified
    session: sessions.publicView(session),
  });
});

function identityHash() {
  return (
    "0x" +
    crypto
      .createHash("md5")
      .update("identity" + Date.now() + crypto.randomBytes(8).toString("hex"))
      .digest("hex")
  );
}

/** Keeps socket.data.session in sync so scan routing can find idle kiosks. */
function markSocketSession(socketId, cardId) {
  if (typeof socketId !== "string" || !socketId) return;
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  socket.data.session = cardId ? { cardId } : null;
}

/**
 * Delivers a scan to the kiosk that asked for it. When the scan came from
 * another device (phone shortcut over the tunnel) no socket id is known, so the
 * event only goes to kiosks that are not signed in — a member who is already
 * using the kiosk must not be silently switched to somebody else's card.
 */
function emitCardScanned(socketId, payload) {
  const target = socketId ? io.sockets.sockets.get(socketId) : null;
  if (target) {
    target.emit("card-scanned", payload);
    return;
  }
  for (const socket of io.sockets.sockets.values()) {
    if (!socket.data || !socket.data.session) socket.emit("card-scanned", payload);
  }
}

// Check token balance for a card
app.get("/balance", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const cardId = req.query.cardId || "Unknown_Card";
  const voter = getVoter(cardId);
  if (!voter) {
    return sendEncrypted(res, 404, { error: "Card not registered" });
  }
  try {
    const balance = Number(await daoContract.getTokenBalance(voter.wallet));
    return sendEncrypted(res, 200, {
      success: true,
      cardId,
      name: voter.name,
      tokenBalance: balance,
    });
  } catch (e) {
    return sendEncrypted(res, 500, { error: "Could not read balance" });
  }
});

// Verify PIN to securely return balance
app.post("/verify-pin", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, { error: "Invalid encrypted payload" });
  }
  const { pin } = data;
  if (typeof pin !== "string" || !pin) {
    return sendEncrypted(res, 400, { error: "Missing PIN" });
  }

  const session = requireSession(req, res);
  if (!session) return undefined;
  if (!sessionCardMatches(session, data)) {
    return sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
  }

  const vault = resolveVault(req, session, data);
  if (!vault) {
    return sendEncrypted(res, 401, {
      error: "Session expired. Tap your card to continue.",
      code: "SESSION_EXPIRED",
    });
  }

  const locked = sendPinError(res, session);
  if (locked) return locked;

  const signer = unlockWithPin(session, pin, vault.encryptedPayload);
  if (!signer) {
    console.error("❌ Balance check failed: Wrong PIN!");
    return sendEncrypted(res, 401, {
      error: "Incorrect PIN. Vault failed to open.",
      code: "PIN_INVALID",
    });
  }

  try {
    const balance = Number(await daoContract.getTokenBalance(signer.address));
    return sendEncrypted(res, 200, {
      success: true,
      tokenBalance: balance,
    });
  } catch (e) {
    return sendEncrypted(res, 500, { error: "Could not read balance from chain" });
  }
});

// Cast a real Blockchain Vote (Stateless PIN Verification)
app.post("/vote", async (req, res) => {
  if (!ensureContractReady(res)) return;
  const data = readEncryptedBody(req);
  if (!data) {
    return sendEncrypted(res, 400, {
      error: "Invalid encrypted payload",
    });
  }
  const { proposalId, pin } = data;

  if (!proposalId || typeof pin !== "string" || !pin) {
    return sendEncrypted(res, 400, {
      error: "Missing proposalId or pin",
    });
  }

  const session = requireSession(req, res);
  if (!session) return undefined;
  if (!sessionCardMatches(session, data)) {
    return sendEncrypted(res, 409, {
      error: "Another member signed in on this kiosk.",
      code: "SESSION_SUPERSEDED",
    });
  }

  const vault = resolveVault(req, session, data);
  if (!vault) {
    return sendEncrypted(res, 401, {
      error: "Session expired. Tap your card to continue.",
      code: "SESSION_EXPIRED",
    });
  }

  const locked = sendPinError(res, session);
  if (locked) return locked;

  const signer = unlockWithPin(session, pin, vault.encryptedPayload);
  if (!signer) {
    console.error("❌ Decryption failed: Wrong PIN or tampered payload!");
    return sendEncrypted(res, 401, {
      error: "Incorrect PIN. Vault failed to open.",
      code: "PIN_INVALID",
    });
  }

  const connectedContract = daoContract.connect(signer);

  try {
    console.log(`⏳ Signing and sending TX to Blockchain using decrypted key...`);
    const tx = await connectedContract.vote(proposalId);
    console.log(`⛓️  TX Sent! Hash: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(
      `⛏️  TX Mined! BlockNumber: ${receipt.blockNumber}, Gas Used: ${receipt.gasUsed.toString()}`,
    );

    // Explicitly fetch and emit to guarantee dashboard updates
    const p = await daoContract.getProposal(proposalId);
    const proposalObj = {
      id: Number(p.id),
      title: p.title,
      description: p.description,
      category: p.category,
      fundsRequested: Number(p.fundsRequested),
      votes: Number(p.votes),
      imageUrl: getProposalImage(Number(p.id)),
      status: p.active ? "active" : "inactive",
    };

    const txEntry = addTransaction({ type: "VOTE_CAST", hash: tx.hash });
    const voter = vault.voter;
    if (voter) {
      store.mutate((state) => {
        state.voters[voter.cardId] = {
          ...voter,
          lastSeenAt: new Date().toISOString(),
        };
      });
    }

    const updatedBalance = Number(await daoContract.getTokenBalance(signer.address));

    io.emit("vote-recorded", {
      voter: {
        name: (voter && voter.name) || "Voter",
        wallet: signer.address,
        tokenBalance: updatedBalance,
      },
      proposal: proposalObj,
      transaction: txEntry,
    });

    return sendEncrypted(res, 200, {
      success: true,
      transactionHash: tx.hash,
    });
  } catch (e) {
    console.error("❌ Blockchain error:", e.reason || e.message);
    return sendEncrypted(res, 500, {
      error: e.reason || "Blockchain execution failed",
    });
  }
});

// ─────────────────────────────────────────────
//  V2: TUNNEL INFO — Read cloudflared public URL
// ─────────────────────────────────────────────

const CLOUDFLARED_LOG = process.env.CLOUDFLARED_LOG
  ? path.resolve(process.env.CLOUDFLARED_LOG)
  : path.join(__dirname, "..", "cloudflared.log");
let cachedTunnelUrl = null;

/**
 * The join link for an invite must open the kiosk UI, never the API. Prefer the
 * configured production origin, fall back to the quick-tunnel URL when running
 * the throwaway tunnel, and only then to a local address (development).
 */
function publicAppUrl(req) {
  if (PUBLIC_APP_URL) return PUBLIC_APP_URL;
  const origin = req && typeof req.get === "function" ? req.get("origin") : "";
  if (origin && isAllowedOrigin(origin)) return normalizePublicUrl(origin);
  const tunnelUrl = extractTunnelUrl();
  if (tunnelUrl) return normalizePublicUrl(tunnelUrl);
  return `http://localhost:${port}`;
}

function publicApiUrl() {
  return PUBLIC_API_URL || PUBLIC_APP_URL || `http://localhost:${port}`;
}

function extractTunnelUrl() {
  if (cachedTunnelUrl) return cachedTunnelUrl;
  try {
    if (!fs.existsSync(CLOUDFLARED_LOG)) return null;
    const log = fs.readFileSync(CLOUDFLARED_LOG, "utf8");
    const match = log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      cachedTunnelUrl = match[0];
      console.log(`🌐 Cloudflare Tunnel detected: ${cachedTunnelUrl}`);
    }
    return cachedTunnelUrl || null;
  } catch (_) {
    return null;
  }
}

setInterval(() => {
  if (cachedTunnelUrl && fs.existsSync(CLOUDFLARED_LOG)) {
    const log = fs.readFileSync(CLOUDFLARED_LOG, "utf8");
    if (!log.includes(cachedTunnelUrl)) cachedTunnelUrl = null;
  } else if (cachedTunnelUrl && !fs.existsSync(CLOUDFLARED_LOG)) {
    cachedTunnelUrl = null;
  }
}, 30000).unref();

app.get("/tunnel-info", (req, res) => {
  const tunnelUrl = extractTunnelUrl();
  return res.json({
    // The public UI, for share links and QR codes.
    appUrl: publicAppUrl(req),
    // The public API the browser should call.
    apiUrl: publicApiUrl(),
    tunnelUrl: tunnelUrl || null,
    tunnelReady: Boolean(tunnelUrl || PUBLIC_APP_URL),
  });
});

// ─────────────────────────────────────────────
//  V2: INVITE CODES — Virtual NFC cards (persisted)
// ─────────────────────────────────────────────

function generateInviteCode() {
  const part = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  return `TDAO-${part()}-${part()}`;
}

function pruneInvites() {
  const now = Date.now();
  const invites = listInvites();
  for (const [code, invite] of Object.entries(invites)) {
    const expired = new Date(invite.expiresAt).getTime() < now - 7 * 24 * 60 * 60 * 1000;
    if (expired) delete invites[code];
  }
}

app.post("/invites/generate", (req, res) => {
  const body = req.body || {};
  const label = String(body.label || "Remote Voter").slice(0, 64);
  const code = generateInviteCode();
  const cardId = `INVITE-${code}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  store.mutate((state) => {
    pruneInvites();
    state.invites[code] = {
      label,
      cardId,
      used: false,
      expiresAt,
      createdAt: new Date().toISOString(),
    };
  });
  console.log(`🎟️  Invite generated: ${code} → cardId: ${cardId}`);

  const joinUrl = `${publicAppUrl(req)}/?invite=${code}`;

  return res.json({ code, cardId, label, joinUrl, expiresAt });
});

app.get("/invites/qr/:code", async (req, res) => {
  const code = req.params.code;
  const invite = listInvites()[code];
  if (!invite) return res.status(404).json({ error: "Invite not found" });

  const joinUrl = `${publicAppUrl(req)}/?invite=${code}`;

  try {
    const png = await QRCode.toBuffer(joinUrl, { width: 300, margin: 2 });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(png);
  } catch (err) {
    return res.status(500).json({ error: "QR generation failed" });
  }
});

app.get("/invites", (req, res) => {
  const list = Object.entries(listInvites()).map(([code, invite]) => ({
    code,
    label: invite.label,
    used: invite.used,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  }));
  return res.json(list);
});

app.post("/invites/redeem", async (req, res) => {
  const body = req.body || {};
  const { code, socketId } = body;

  if (!code) return res.status(400).json({ error: "Invite code required" });

  const invite = listInvites()[code];
  if (!invite) return res.status(404).json({ error: "Invite code not found or expired" });
  if (invite.used) return res.status(409).json({ error: "This invite has already been used" });

  const now = new Date();
  if (new Date(invite.expiresAt) < now) {
    return res.status(410).json({ error: "Invite code has expired" });
  }

  // Treat the virtual cardId exactly like a physical NFC card scan
  const { cardId } = invite;
  const voter = getVoter(cardId);

  if (!voter) {
    // Not yet registered — show registration modal (same as unregistered NFC card)
    const payload = { type: "unregistered", cardId };
    emitCardScanned(socketId, payload);
    console.log(`🎟️  Invite ${code} redeemed (unregistered) → cardId: ${cardId}`);
    return res.json({ success: true, registered: false, cardId });
  }

  // Already registered — emit voter session
  store.mutate((state) => {
    if (state.invites[code]) state.invites[code].used = true;
  });

  let tokenBalance = 0;
  try {
    tokenBalance = Number(await daoContract.getTokenBalance(voter.wallet));
  } catch (_) {}

  const session = issueSession(req, res, cardId);
  const claim = sessions.issueClaim(cardId);

  emitCardScanned(socketId, {
    type: "registered",
    cardId,
    voter: publicVoter(voter, { tokenBalance: null }),
    claim: claim.token,
  });

  console.log(`🎟️  Invite ${code} redeemed (registered) → voter: ${voter.name}`);
  return res.json({
    success: true,
    registered: true,
    name: voter.name,
    voter: publicVoter(voter, { tokenBalance: null }),
    cardId,
    session: sessions.publicView(session),
  });
});

// ─────────────────────────────────────────────
//  ERROR HANDLING
// ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError || err.status === 400) {
    const message =
      err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
        ? `Image is too large. Maximum size is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB.`
        : err.message || "Invalid upload";
    return res.status(400).json({ error: message });
  }
  console.error("❌ Unhandled request error:", err);
  return res.status(500).json({ error: "Internal server error" });
});

// ─────────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────────
io.on("connection", async (socket) => {
  console.log("🔌 Client connected:", socket.id);

  const connectedSession = currentSession(socket.request);
  socket.data.session = connectedSession
    ? { cardId: connectedSession.record.cardId }
    : null;

  const proposalsData = await readAllProposals();
  const state = store.getState();

  socket.emit("init", {
    proposals: proposalsData,
    transactions: state.transactions.slice(-20),
    treasury: { totalFunds: 500000, allocated: 0, currency: "DAO Tokens" },
    socketId: socket.id, // Send socketId so frontend can use it for NFC shortcut linking
    registeredVoters: listVoters().length,
  });

  socket.on("disconnect", () => {
    console.log("🔌 Client disconnected:", socket.id);
  });
});

// ─────────────────────────────────────────────
//  SPA FALLBACK — serve index.html for client-side routing
// ─────────────────────────────────────────────
if (fs.existsSync(frontendDistPath)) {
  app.get("*", (req, res) => {
    res.sendFile(path.join(frontendDistPath, "index.html"));
  });
}

// ─────────────────────────────────────────────
//  START SERVER
// ─────────────────────────────────────────────
function printBanner() {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("   🏛️  TAP DAO — Mobile Kiosk Server");
  console.log("═══════════════════════════════════════════════");
  console.log(`   Local:   http://localhost:${port}`);

  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`   Network: http://${net.address}:${port}`);
      }
    }
  }

  const ai = aiConfig();
  console.log("═══════════════════════════════════════════════");
  console.log(`   Registered cards: ${listVoters().length}`);
  console.log(`   Contract: ${contractAddress || "Not deployed"}`);
  console.log(`   State file: ${store.file}`);
  console.log(`   Uploads dir: ${uploadDir}`);
  console.log(
    `   AI provider: ${ai.configured ? ai.provider : "NOT CONFIGURED (set COLAB_AI_URL)"}`,
  );
  console.log(
    `   Sessions: ${sessions.ephemeralSecret ? "ephemeral secret (set SESSION_SECRET)" : "signed with SESSION_SECRET"}`,
  );
  if (USING_DEV_KEYS) {
    console.warn(
      "   ⚠️  Using public Hardhat development keys. Set ADMIN_PRIVATE_KEY / VOTER_PRIVATE_KEYS for any non-demo deployment.",
    );
  }
  console.log("═══════════════════════════════════════════════");
}

if (require.main === module) {
  server.listen(port, "0.0.0.0", () => printBanner());
}

module.exports = {
  app,
  server,
  io,
  store,
  sessions,
  printBanner,
  config: {
    port,
    rpcUrl,
    uploadDir,
    dataFile: store.file,
    voterKeyCount: VOTER_KEYS.length,
  },
};
