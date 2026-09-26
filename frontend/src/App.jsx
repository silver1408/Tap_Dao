import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";
import { ClipboardList, PenTool, Activity, Copy, Check, Globe, Link, Users, Sun, Moon, Coffee, Monitor, LogOut } from "lucide-react";
import { decrypt, encrypt } from "./lib/crypto";

// ─── API Base ───
const API_BASE = (
  import.meta.env.VITE_API_URL || window.location.origin
).replace(/\/$/, "");

const SOCKET_BASE = import.meta.env.VITE_SOCKET_URL || API_BASE || undefined;

const AI_REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_AI_TIMEOUT_MS || 100000);
const SESSION_TOUCH_INTERVAL_MS = 30000;
const SESSION_WARNING_SECONDS = 60;

function NavigationBreadcrumbs({ current }) {
  const isDashboard = current === "dashboard";

  return (
    <nav className={`breadcrumbs breadcrumbs-${current}`} aria-label="Breadcrumb">
      <span className="breadcrumbs-root">Tap DAO</span>
      <span className="breadcrumbs-separator" aria-hidden="true">/</span>
      {isDashboard ? (
        <>
          <span className="breadcrumbs-current" aria-current="page">
            Governance Dashboard
          </span>
          <span className="breadcrumbs-separator" aria-hidden="true">/</span>
          <a href="/mobile">Mobile voting</a>
        </>
      ) : (
        <>
          <a href="/dashboard">Governance Dashboard</a>
          <span className="breadcrumbs-separator" aria-hidden="true">/</span>
          <span className="breadcrumbs-current" aria-current="page">
            Mobile voting
          </span>
        </>
      )}
    </nav>
  );
}

// The session cookie is HttpOnly, so the browser also keeps a *public* handle
// for the session it believes it holds. The server refuses to act on a session
// whose handle does not match, which is what keeps two members sharing one
// kiosk from bleeding into each other. sessionStorage survives a reload, so a
// refresh still restores the member, while a fresh visitor is never handed the
// previous member's session.
const SESSION_HANDLE_KEY = "tapdao.sessionHandle";
const MOBILE_SCAN_SESSION_KEY = "tapdao.mobileScanSession";

function readMobileScanSession() {
  try {
    const existing = window.sessionStorage.getItem(MOBILE_SCAN_SESSION_KEY);
    if (existing) return existing;
    const created =
      window.crypto?.randomUUID?.() ||
      `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(MOBILE_SCAN_SESSION_KEY, created);
    return created;
  } catch {
    return `scan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function readSessionHandle() {
  try {
    return window.sessionStorage.getItem(SESSION_HANDLE_KEY) || "";
  } catch {
    return "";
  }
}

function writeSessionHandle(handle) {
  try {
    if (handle) window.sessionStorage.setItem(SESSION_HANDLE_KEY, handle);
    else window.sessionStorage.removeItem(SESSION_HANDLE_KEY);
  } catch {
    /* private mode: the cookie still works, only the binding is lost */
  }
}

class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const AI_ERROR_HINTS = {
  AI_NOT_CONFIGURED:
    "AI Assist is not configured on the server. Set COLAB_AI_URL in backend/.env and restart the backend.",
  AI_UNREACHABLE:
    "The AI provider is unreachable. Check that the Colab notebook is still running and the tunnel URL is current.",
  AI_TIMEOUT:
    "The AI provider took too long to answer. Colab runtimes wake slowly — try again in a few seconds.",
  AI_INVALID_RESPONSE:
    "The AI provider returned an unexpected response. Re-run the Colab cell and confirm the tunnel URL points at the API root.",
  AI_EMPTY_RESULT:
    "The model did not return a usable draft. Add more detail to your description and try again.",
  AI_UPSTREAM_ERROR:
    "The AI provider reported an error. Check the Colab logs for details.",
  PIN_LOCKED: "Too many incorrect PIN attempts. Wait a moment and try again.",
};

// ─── RegisterModal Component ───
function RegisterModal({ cardId, onRegister, onCancel, loading, error }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [localError, setLocalError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length < 4) {
      setLocalError("PIN must be at least 4 digits");
      return;
    }
    if (pin !== pinConfirm) {
      setLocalError("PINs don't match");
      return;
    }
    setLocalError("");
    onRegister({ cardId, name: name.trim() || `Voter ${cardId.slice(-4)}`, pin });
  };

  return (
    <div className="modal-overlay centered" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Register Card</h2>
        <p className="modal-subtitle">
          This card isn't registered yet. Set your identity and a 4-digit PIN to secure your wallet.
        </p>

        <div className="card-id-display">
          <p className="card-label">Card ID</p>
          <p className="card-value">{cardId}</p>
        </div>

        <form onSubmit={handleSubmit} className="create-form">
          <label>
            Your Name
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              autoFocus
            />
          </label>
          <label>
            Set 4-Digit PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength="6"
              className="pin-input"
              value={pin}
              onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setLocalError(""); }}
              placeholder="••••"
            />
          </label>
          <label>
            Confirm PIN
            <input
              type="password"
              inputMode="numeric"
              maxLength="6"
              className="pin-input"
              value={pinConfirm}
              onChange={(e) => { setPinConfirm(e.target.value.replace(/\D/g, "")); setLocalError(""); }}
              placeholder="••••"
            />
          </label>
          {(localError || error) ? <p className="error-text">{localError || error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={loading}>
              {loading ? "Registering..." : "Register Card"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── PinModal Component ───
function PinModal({ action, onSubmit, onCancel, error }) {
  const [pin, setPin] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (pin.length < 4) return;
    onSubmit(pin);
  };

  const titles = {
    vote: "🔐 Authorize Vote",
    balance: "🔐 Check Balance",
    create: "🔐 Verify Identity",
  };

  const descriptions = {
    vote: "Enter your 4-digit PIN to authorize this vote on the blockchain.",
    balance: "Enter your PIN to decrypt your wallet and check your token balance.",
    create: "Enter your PIN to verify your identity and create this proposal.",
  };

  const buttonLabels = {
    vote: "Cast Vote",
    balance: "Unlock Balance",
    create: "Create Proposal",
  };

  return (
    <div className="modal-overlay centered" onClick={onCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>{titles[action] || "🔐 Enter PIN"}</h2>
        <p className="modal-subtitle">{descriptions[action] || ""}</p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            inputMode="numeric"
            maxLength="6"
            className="pin-input"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            placeholder="••••"
            autoFocus
          />
          {error ? <p className="error-text">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="secondary-btn" onClick={onCancel}>Cancel</button>
            <button type="submit" className="primary-btn" disabled={pin.length < 4}>
              {buttonLabels[action] || "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ProposalPreview Modal ───
function ProposalPreview({ proposal, imageUrl, onClose, onVote, currentVoter }) {
  if (!proposal) return null;

  const tokensReceived = (proposal.votes || 0) * 100;
  const percent = Math.min((tokensReceived / (proposal.fundsRequested || 1)) * 100, 100).toFixed(1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {imageUrl ? (
          <div className="preview-hero">
            <img src={imageUrl} alt="" />
          </div>
        ) : null}

        <div className="preview-header">
          <h3>{proposal.title}</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="preview-meta">
          <span>{proposal.category}</span>
          <span>{tokensReceived} / {proposal.fundsRequested} tokens</span>
          <span>{percent}% funded</span>
          <span>{proposal.votes} votes</span>
        </div>

        <div className="preview-description">
          <p>{proposal.description || "No detailed description provided."}</p>
        </div>

        {currentVoter ? (
          <button
            type="button"
            className="primary-btn btn-block"
            onClick={() => onVote(proposal)}
          >
            Vote for This Proposal
          </button>
        ) : (
          <p className="error-text" style={{ textAlign: "center" }}>
            Scan your card first to vote
          </p>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════

function DashboardView({
  proposals,
  transactions,
  loading,
  connected,
  registeredVotersCount,
  activeProposals,
  totalVotes,
  resolveMediaUrl,
}) {
  const events = transactions;
  const eventLabel = (event) => {
    if (event.type === "PROPOSAL_CREATED") {
      return "New proposal: " + (event.proposalTitle || "Proposal #" + event.proposalId);
    }
    if (event.type === "PROPOSAL_CREATE_FAILED") {
      return "Proposal creation failed: " + (event.proposalTitle || "Untitled proposal");
    }
    if (event.type === "VOTE_CAST") {
      return "Vote recorded: " + (event.proposalTitle || "Proposal #" + event.proposalId);
    }
    if (event.type === "VOTE_FAILED") {
      return "Vote failed: Proposal #" + (event.proposalId || "unknown");
    }
    if (event.type === "IDENTITY_VERIFY") return "Card tapped";
    return event.type || "Activity";
  };

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <NavigationBreadcrumbs current="dashboard" />
          <h1>Governance Dashboard</h1>
        </div>
        <div className="dashboard-actions">
          <span className={connected ? "dashboard-live live" : "dashboard-live"}>
            <span className="dot" />
            {connected ? "Live" : "Offline"}
          </span>
          <a className="dashboard-mobile-link" href="/mobile">
            Mobile voting
          </a>
        </div>
      </header>

      <section className="dashboard-stats" aria-label="DAO summary">
        <div className="dashboard-stat">
          <span>Active proposals</span>
          <strong>{activeProposals}</strong>
        </div>
        <div className="dashboard-stat">
          <span>Total votes</span>
          <strong>{totalVotes}</strong>
        </div>
        <div className="dashboard-stat">
          <span>Registered cards</span>
          <strong>{registeredVotersCount}</strong>
        </div>
      </section>

      <main className="dashboard-grid">
        <section className="dashboard-section">
          <div className="dashboard-section-heading">
            <div>
              <p className="dashboard-kicker">On chain</p>
              <h2>All proposals</h2>
            </div>
            <span className="dashboard-count">{proposals.length}</span>
          </div>
          {loading ? (
            <div className="dashboard-empty">Loading proposals...</div>
          ) : proposals.length === 0 ? (
            <div className="dashboard-empty">No proposals have been created yet.</div>
          ) : (
            <div className="dashboard-proposals">
              {proposals.map((proposal) => {
                const tokensReceived = (proposal.votes || 0) * 100;
                const percent = Math.min(
                  (tokensReceived / (proposal.fundsRequested || 1)) * 100,
                  100,
                ).toFixed(1);
                return (
                  <article className="dashboard-proposal" key={proposal.id}>
                    {proposal.imageUrl ? (
                      <img
                        src={resolveMediaUrl(proposal.imageUrl)}
                        alt=""
                        className="dashboard-proposal-image"
                      />
                    ) : null}
                    <div className="dashboard-proposal-body">
                      <div className="dashboard-proposal-title">
                        <h3>{proposal.title}</h3>
                        <span className={proposal.status === "active" ? "status-pill active" : "status-pill"}>
                          {proposal.status}
                        </span>
                      </div>
                      <p>{proposal.description || "No description provided."}</p>
                      <div className="dashboard-progress">
                        <span style={{ width: percent + "%" }} />
                      </div>
                      <div className="dashboard-proposal-meta">
                        <span>{proposal.category}</span>
                        <span>{proposal.votes || 0} votes</span>
                        <span>{tokensReceived}/{proposal.fundsRequested} tokens</span>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <aside className="dashboard-section dashboard-activity">
          <div className="dashboard-section-heading">
            <div>
              <p className="dashboard-kicker">Live feed</p>
              <h2>Activity</h2>
            </div>
            <span className="dashboard-count">{events.length}</span>
          </div>
          {events.length === 0 ? (
            <div className="dashboard-empty">Waiting for proposal and vote activity.</div>
          ) : (
            <div className="dashboard-event-list">
              {events.slice(0, 12).map((event) => (
                <div className="dashboard-event" key={event.id + "-" + event.timestamp}>
                  <span className={"dashboard-event-mark " + (event.status === "failed" ? "failed" : "success")} />
                  <div>
                    <strong>{eventLabel(event)}</strong>
                    {event.error ? <small>{event.error}</small> : null}
                    <time dateTime={event.timestamp}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </time>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}

function App() {
  const [isMobileUi] = useState(
    () => {
      const isDashboardRoute = window.location.pathname === "/dashboard";
      return (
        !isDashboardRoute &&
        (window.location.pathname === "/mobile" ||
          window.matchMedia("(max-width: 767px)").matches)
      );
    },
  );

  // ── Connection ──
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Data ──
  const [proposals, setProposals] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [registeredVotersCount, setRegisteredVotersCount] = useState(0);

  // ── Identity ──
  const [currentVoter, setCurrentVoter] = useState(null);
  const [manualCardId, setManualCardId] = useState("");

  // ── UI State ──
  const [activeTab, setActiveTab] = useState("vote");
  const [intendedAction, setIntendedAction] = useState(null);
  const [toast, setToast] = useState("");
  const [previewProposal, setPreviewProposal] = useState(null);

  const handleActionSelect = (action) => {
    setIntendedAction(action);
    if (action === "read") setActiveTab("vote");
    if (action === "write") setActiveTab("create");
  };

  const [nfcScanning, setNfcScanning] = useState(false);

  // ── Registration ──
  const [registerCardId, setRegisterCardId] = useState(null);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [registerError, setRegisterError] = useState("");

  // ── PIN Modal ──
  const [pinModal, setPinModal] = useState(null); // { action, proposalId?, proposalTitle? }
  const [pinError, setPinError] = useState("");

  // ── Create Proposal ──
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState("manual");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiError, setAiError] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "General",
    fiatBudget: "",
    imageFile: null,
  });

  // ── V2: Tunnel + Invites ──
  const [tunnelInfo, setTunnelInfo] = useState({ tunnelUrl: null, lanUrl: null, tunnelReady: false });
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [invites, setInvites] = useState([]);
  const [inviteLabel, setInviteLabel] = useState("");
  const [generatingInvite, setGeneratingInvite] = useState(false);

  // ── Session expiry countdown ──
  const [sessionSecondsLeft, setSessionSecondsLeft] = useState(null);

  // ── Theme State ──
  const [appTheme, setAppTheme] = useState("system"); // 'system', 'light', 'sepia', 'dark'
  const themeIcons = { 
    system: <Monitor size={18} />, 
    light: <Sun size={18} />, 
    sepia: <Coffee size={18} />, 
    dark: <Moon size={18} /> 
  };
  const themes = ["system", "light", "sepia", "dark"];
  
  const cycleTheme = () => {
    const nextIndex = (themes.indexOf(appTheme) + 1) % themes.length;
    setAppTheme(themes[nextIndex]);
  };

  const [isFeedExpanded, setIsFeedExpanded] = useState(false);

  // ── AI Preview ──
  const [aiPreview, setAiPreview] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const [aiElapsed, setAiElapsed] = useState(0);

  // ── Balance countdown ──
  const balanceCountdownValueRef = useRef(null);

  // ── Voted proposals tracking ──
  const [votedProposalIds, setVotedProposalIds] = useState(new Set());

  // ── Category filter ──
  const [categoryFilter, setCategoryFilter] = useState("All");

  const toastTimerRef = useRef(null);
  const sessionCountdownRef = useRef(null);
  const balanceCountdownRef = useRef(null);
  const socketRef = useRef(null);
  const sessionRef = useRef(null);
  // Bumped on every sign-in/sign-out so responses from a previous member can
  // never be applied to the member who is signed in now.
  const sessionEpochRef = useRef(0);
  const handledClaimsRef = useRef(new Set());
  const mobileScanSessionRef = useRef(isMobileUi ? readMobileScanSession() : "");
  const lastTouchRef = useRef(0);
  const onSessionLostRef = useRef(null);
  const aiElapsedRef = useRef(null);

  // ── Computed ──
  const totalVotes = useMemo(
    () => proposals.reduce((acc, p) => acc + (p.votes || 0), 0),
    [proposals],
  );
  const activeProposals = useMemo(
    () => proposals.filter((p) => p.status === "active").length,
    [proposals],
  );

  // ── Helpers ──
  const notify = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(""), 3500);
  }, []);

  // Everything that belongs to one member. Shared data (proposals, the
  // transaction feed, invites) is deliberately left alone.
  const resetMemberState = useCallback(() => {
    setIntendedAction(null);
    setActiveTab("vote");
    setAiPreview(null);
    setPreviewProposal(null);
    setPinModal(null);
    setPinError("");
    setVotedProposalIds(new Set());
    balanceCountdownValueRef.current = null;
    setAiPrompt("");
    setAiError("");
    setAiGenerating(false);
    setCreating(false);
    setForm({
      title: "",
      description: "",
      category: "General",
      fiatBudget: "",
      imageFile: null,
    });
    setManualCardId("");
  }, []);

  const clearLocalSession = useCallback(
    (message) => {
      // Invalidate in-flight requests from the member who is leaving.
      sessionEpochRef.current += 1;
      sessionRef.current = null;
      writeSessionHandle("");
      resetMemberState();
      setCurrentVoter(null);
      if (sessionCountdownRef.current) {
        clearInterval(sessionCountdownRef.current);
        sessionCountdownRef.current = null;
      }
      if (balanceCountdownRef.current) {
        clearInterval(balanceCountdownRef.current);
        balanceCountdownRef.current = null;
      }
      lastTouchRef.current = 0;
      setSessionSecondsLeft(null);
      if (message) notify(message);
    },
    [notify, resetMemberState],
  );

  const toApiPath = useCallback((path) => `${API_BASE}${path}`, []);

  const resolveMediaUrl = useCallback(
    (value) => {
      if (typeof value !== "string" || !value) return "";
      if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
      if (!value.startsWith("/")) return value;
      return `${API_BASE}${value}`;
    },
    [],
  );

  // ── V2: Copy to clipboard helper ──
  const copyToClipboard = useCallback(async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(key);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      notify("Could not copy — please copy manually");
    }
  }, [notify]);

  // ── V2: Generate invite code ──
  const generateInvite = useCallback(async () => {
    setGeneratingInvite(true);
    try {
      const res = await fetch(toApiPath("/invites/generate"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: inviteLabel.trim() || "Remote Voter" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setInvites((prev) => [data, ...prev]);
      setInviteLabel("");
      notify(`Invite created: ${data.code}`);
    } catch (err) {
      notify(`Invite error: ${err.message}`);
    } finally {
      setGeneratingInvite(false);
    }
  }, [inviteLabel, toApiPath, notify]);

  const decodeApiPayload = useCallback((data) => {
    if (data && typeof data === "object" && typeof data.payload === "string") {
      const decrypted = decrypt(data.payload);
      if (!decrypted) {
        throw new ApiError(
          "Could not decrypt the server response. Check that CRYPTO_SECRET_KEY matches on both sides.",
          0,
          "DECRYPT_FAILED",
        );
      }
      try {
        return JSON.parse(decrypted);
      } catch {
        throw new ApiError("Server returned malformed data", 0, "DECRYPT_FAILED");
      }
    }
    return data;
  }, []);

  const request = useCallback(
    async (path, { method = "GET", body, formData, timeoutMs, keepalive } = {}) => {
      const controller = timeoutMs ? new AbortController() : null;
      const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      const handle = readSessionHandle();
      try {
        const res = await fetch(toApiPath(path), {
          method,
          credentials: "include",
          keepalive: Boolean(keepalive),
          headers: {
            ...(formData ? {} : { "Content-Type": "application/json" }),
            ...(handle ? { "X-Session-Handle": handle } : {}),
          },
          body: formData ?? (body === undefined ? undefined : JSON.stringify(body)),
          signal: controller ? controller.signal : undefined,
        });
        const text = await res.text();
        let raw = null;
        if (text) {
          try {
            raw = JSON.parse(text);
          } catch {
            raw = { error: `Unexpected response from server (HTTP ${res.status})` };
          }
        }
        let data = null;
        try {
          data = decodeApiPayload(raw);
        } catch (error) {
          throw new ApiError(error.message, res.status, "DECRYPT_FAILED");
        }
        if (!res.ok) {
          // Another member took the kiosk over, or this session is gone: drop
          // our own state quietly instead of throwing a scary error at whoever
          // is signed in now.
          if (
            data &&
            (data.code === "SESSION_SUPERSEDED" ||
              data.code === "SESSION_EXPIRED" ||
              data.code === "SESSION_UNCLAIMED") &&
            // Only the member whose session failed may be signed out: a slow
            // response must not sign out the member who replaced them.
            readSessionHandle() === handle &&
            onSessionLostRef.current
          ) {
            onSessionLostRef.current(data.code);
          }
          throw new ApiError(data?.error || `Request failed (HTTP ${res.status})`, res.status, data?.code);
        }
        return { data, res };
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error.name === "AbortError") {
          throw new ApiError("The request timed out. Please try again.", 0, "CLIENT_TIMEOUT");
        }
        throw new ApiError("Cannot reach the server. Is the backend running?", 0, "NETWORK");
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    [decodeApiPayload, toApiPath],
  );

  const apiGet = useCallback(
    async (path) => {
      const { data } = await request(path);
      return data;
    },
    [request],
  );

  const apiPost = useCallback(
    async (path, body, options = {}) => {
      const encrypted = encrypt(JSON.stringify(body ?? {}));
      const { data } = await request(path, {
        method: "POST",
        body: { payload: encrypted },
        ...options,
      });
      return data;
    },
    [request],
  );

  // Declared after apiPost/clearLocalSession: hook dependency arrays are
  // evaluated during render, so referencing a later `const` throws a
  // ReferenceError and blanks the whole screen.
  const handleLogout = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    try {
      await apiPost("/session/logout", { socketId: socketRef.current?.id || null }, {
        keepalive: true,
      });
    } catch {
      // The local session is dropped either way: the kiosk must never stay
      // "signed in" just because the network hiccuped.
    }
    // A member who tapped in while the logout was in flight keeps their session.
    if (sessionEpochRef.current === epoch) {
      clearLocalSession("Signed out successfully");
    }
  }, [apiPost, clearLocalSession]);

  // ── Session lifecycle ──
  const applySession = useCallback(
    (voter, session) => {
      if (!voter) return null;
      // A new member takes the kiosk over completely: previous member state is
      // dropped instead of merged, so no PIN, balance or draft survives a swap.
      sessionEpochRef.current += 1;
      const epoch = sessionEpochRef.current;
      sessionRef.current = { voter, session };
      writeSessionHandle(session && session.handle ? session.handle : "");
      resetMemberState();
      setCurrentVoter(voter);
      if (session && typeof session.remainingMs === "number") {
        // remainingMs is already clamped to the server-side absolute cap
        setSessionSecondsLeft(Math.max(1, Math.round(session.remainingMs / 1000)));
      }
      return epoch;
    },
    [resetMemberState],
  );

  const signIn = useCallback(
    (voter, session, message) => {
      const epoch = applySession(voter, session);
      if (message) notify(message);
      return epoch;
    },
    [applySession, notify],
  );

  const touchSession = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    const epoch = sessionEpochRef.current;
    const cardId = current.voter && current.voter.cardId;
    lastTouchRef.current = Date.now();
    try {
      const data = await apiPost("/session/touch", {});
      // The response belongs to whoever is signed in right now — never to the
      // member whose request this actually was.
      if (sessionEpochRef.current !== epoch) return;
      if (data && data.session) {
        if (data.session.cardId && cardId && data.session.cardId !== cardId) return;
        sessionRef.current = { voter: current.voter, session: data.session };
        setSessionSecondsLeft(Math.max(1, Math.round(data.session.remainingMs / 1000)));
      }
    } catch (error) {
      if (sessionEpochRef.current !== epoch) return;
      if (error.code === "SESSION_EXPIRED" || error.code === "NETWORK") {
        clearLocalSession(
          error.code === "SESSION_EXPIRED"
            ? "Session expired — tap your card to continue."
            : null,
        );
      }
    }
  }, [apiPost, clearLocalSession]);

  const restoreSession = useCallback(async () => {
    const knownHandle = readSessionHandle();
    try {
      const data = await apiGet("/session");
      if (data && data.voter) {
        applySession(data.voter, data.session);
      }
    } catch (error) {
      // A kiosk that does not remember a session must not inherit the cookie's
      // session, and one that was replaced just starts over quietly.
      if (
        error.code === "SESSION_EXPIRED" ||
        error.code === "SESSION_UNCLAIMED" ||
        error.code === "SESSION_SUPERSEDED"
      ) {
        if (knownHandle) clearLocalSession();
        return;
      }
      if (error.code) notify(`Could not verify your session: ${error.message}`);
    }
  }, [apiGet, applySession, clearLocalSession, notify]);

  // ── NFC Scan (triggered by iOS Shortcut / Android NFC app or manual input) ──
  const scanCard = useCallback(
    async (cardId) => {
      if (!cardId) return;

      // Wait for socket to be connected and have an ID
      const waitForSocket = () => {
        return new Promise((resolve, reject) => {
          const maxWait = 5000; // 5 seconds max wait
          const startTime = Date.now();

          const checkSocket = () => {
            if (socketRef.current?.connected && socketRef.current?.id) {
              resolve(socketRef.current.id);
            } else if (Date.now() - startTime > maxWait) {
              reject(new Error("Socket connection timeout"));
            } else {
              setTimeout(checkSocket, 100);
            }
          };

          checkSocket();
        });
      };

      try {
        const sid = await waitForSocket();
        // Remember the scan so the matching socket event does not sign the
        // member in twice (this browser already gets its own cookie back).
        const data = await apiGet(
          `/scan?cardId=${encodeURIComponent(cardId)}&socketId=${encodeURIComponent(sid)}`,
        );
        if (data && data.voter && data.session) {
          signIn(data.voter, data.session);
        }
      } catch (error) {
        console.error("Card scan error:", error);
        notify(`Scan failed: ${error.message}`);
      }
    },
    [apiGet, notify, signIn],
  );

  // ── Register a new card ──
  const registerCard = useCallback(
    async ({ cardId, name, pin }) => {
      setRegisterLoading(true);
      setRegisterError("");
      try {
        const data = await apiPost("/register", { cardId, name, pin });
        setRegisterCardId(null);
        applySession({ ...data.voter, cardId }, data.session);
        const nextAction = intendedAction === "write" ? "write" : "read";
        setIntendedAction(nextAction);
        setActiveTab(nextAction === "write" ? "create" : "vote");
        notify(`Welcome, ${data.voter.name}! Card registered with 1000 tokens.`);
      } catch (error) {
        setRegisterError(error.message);
      } finally {
        setRegisterLoading(false);
      }
    },
    [apiPost, applySession, intendedAction, notify],
  );

  // ── Cast Vote ──
  const castVote = useCallback(
    async (pin) => {
      if (!pinModal || !currentVoter?.cardId) return;
      setPinError("");
      try {
        await apiPost("/vote", {
          proposalId: pinModal.proposalId,
          pin,
          cardId: currentVoter.cardId,
        });
        // Haptic feedback on success
        navigator.vibrate?.([100, 50, 100]);
        // Track voted proposal locally
        setVotedProposalIds((prev) => new Set([...prev, pinModal.proposalId]));
        notify(`Vote submitted for "${pinModal.proposalTitle}"`);
        setPinModal(null);
        setPreviewProposal(null);
      } catch (error) {
        if (error.code === "SESSION_EXPIRED") {
          setPinModal(null);
          return;
        }
        setPinError(error.message);
      }
    },
    [apiPost, currentVoter, notify, pinModal],
  );

  // ── Check Balance ──
  const checkBalance = useCallback(
    async (pin) => {
      if (!currentVoter?.cardId) return;
      setPinError("");
      try {
        const data = await apiPost("/verify-pin", { pin, cardId: currentVoter.cardId });
        setCurrentVoter((prev) => ({ ...prev, tokenBalance: data.tokenBalance }));
        setPinModal(null);
        // Balance countdown: 10s then auto-hide
        balanceCountdownValueRef.current = 10;
        if (balanceCountdownRef.current) clearInterval(balanceCountdownRef.current);
        balanceCountdownRef.current = setInterval(() => {
          const seconds = balanceCountdownValueRef.current;
          balanceCountdownValueRef.current = seconds <= 1 ? null : seconds - 1;
          if (seconds <= 1) {
            clearInterval(balanceCountdownRef.current);
            setCurrentVoter((prev) => prev ? { ...prev, tokenBalance: null } : prev);
            return;
          }
        }, 1000);
      } catch (error) {
        if (error.code === "SESSION_EXPIRED") {
          setPinModal(null);
          return;
        }
        setPinError(AI_ERROR_HINTS[error.code] || error.message);
      }
    },
    [apiPost, currentVoter],
  );

  // ── Create Proposal ──
  const createProposal = useCallback(
    async (e) => {
      e.preventDefault();
      if (!form.title.trim()) {
        notify("Please provide a title");
        return;
      }
      if (!form.fiatBudget) {
        notify("Please set the estimated budget");
        return;
      }

      const budget = Number(form.fiatBudget);
      let requiredTokens = 1000;
      if (budget > 100000) requiredTokens = 10000;
      else if (budget > 10000) requiredTokens = 5000;

      setPinError("");
      setPinModal({
        action: "create",
        requiredTokens,
      });
    },
    [form, notify],
  );

  const executeCreateProposal = useCallback(
    async (pin) => {
      if (!currentVoter?.cardId || !pinModal?.requiredTokens) return;
      setCreating(true);
      setPinError("");

      let imageUrl = "";
      if (form.imageFile) {
        try {
          const fd = new FormData();
          fd.append("image", form.imageFile);
          const { data } = await request("/upload", { method: "POST", formData: fd });
          imageUrl = data.imageUrl || "";
        } catch (err) {
          notify(`Image upload warning: ${err.message}`);
        }
      }

      try {
        await apiPost("/proposals", {
          title: form.title.trim(),
          description: form.description.trim(),
          category: form.category,
          fundsRequested: pinModal.requiredTokens,
          imageUrl,
          pin,
          cardId: currentVoter.cardId,
        });
        setForm({ title: "", description: "", category: "General", fiatBudget: "", imageFile: null });
        setPinModal(null);
        notify("Proposal created! 200 tokens deducted.");
        setIntendedAction("read");
        setActiveTab("vote");
      } catch (error) {
        if (error.code === "SESSION_EXPIRED") {
          setPinModal(null);
          return;
        }
        setPinError(AI_ERROR_HINTS[error.code] || error.message);
      } finally {
        setCreating(false);
      }
    },
    [apiPost, currentVoter, form, notify, pinModal, request],
  );

  // ── AI status (provider configured / reachable) ──
  const checkAiStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/ai/status`, { credentials: "include" });
      if (!res.ok) throw new Error("status unavailable");
      setAiStatus(await res.json());
    } catch {
      setAiStatus({ configured: false, reachable: false, detail: "backend unreachable" });
    }
  }, []);

  // ── AI Generate ──
  const generateProposal = useCallback(async () => {
    if (!aiPrompt.trim()) {
      setAiError("Describe your proposal idea first");
      return;
    }
    setAiGenerating(true);
    setAiError("");
    setAiElapsed(0);
    aiElapsedRef.current = setInterval(() => {
      setAiElapsed((value) => value + 1);
    }, 1000);
    try {
      const generated = await apiPost(
        "/proposals/generate",
        { text: aiPrompt.trim() },
        { timeoutMs: AI_REQUEST_TIMEOUT_MS },
      );
      if (!generated || !generated.title) {
        throw new ApiError("AI returned an empty draft", 502, "AI_EMPTY_RESULT");
      }
      setAiPreview({
        title: generated.title || "",
        description: generated.description || "",
        category: generated.category || "General",
      });
      notify("AI structured your proposal — review and accept");
    } catch (error) {
      const clientTimeout = error.code === "CLIENT_TIMEOUT";
      setAiError(
        clientTimeout
          ? "The request timed out in the browser. The AI runtime may be slow — try again."
          : AI_ERROR_HINTS[error.code] || error.message || "Failed to generate proposal",
      );
      checkAiStatus();
    } finally {
      if (aiElapsedRef.current) clearInterval(aiElapsedRef.current);
      aiElapsedRef.current = null;
      setAiGenerating(false);
    }
  }, [aiPrompt, apiPost, notify, checkAiStatus]);

  // ── PIN Submit Handler ──
  const handlePinSubmit = useCallback(
    (pin) => {
      if (!pinModal) return;
      if (pinModal.action === "balance") return checkBalance(pin);
      if (pinModal.action === "vote") return castVote(pin);
      if (pinModal.action === "create") return executeCreateProposal(pin);
    },
    [pinModal, checkBalance, castVote, executeCreateProposal],
  );

  const claimScan = useCallback(
    async (payload, socketId) => {
      if (!isMobileUi || !payload?.claim) return;
      const activeCardId = sessionRef.current?.voter?.cardId;
      if (activeCardId) {
        if (activeCardId !== payload.cardId) {
          notify("A card session is already active. Sign out before switching cards.");
        }
        return;
      }
      if (handledClaimsRef.current.has(payload.claim)) return;
      handledClaimsRef.current.add(payload.claim);
      try {
        const data = await apiPost("/session/claim", {
          claim: payload.claim,
          socketId: socketId || null,
        });
        if (data && data.voter) {
          signIn(data.voter, data.session);
          const nextAction = intendedAction === "write" ? "write" : "read";
          setIntendedAction(nextAction);
          setActiveTab(nextAction === "write" ? "create" : "vote");
          if (payload.transaction) {
            setTransactions((prev) => {
              if (prev.some((entry) => entry.id === payload.transaction.id)) return prev;
              return [payload.transaction, ...prev].slice(0, 20);
            });
          }
        }
      } catch (error) {
        handledClaimsRef.current.delete(payload.claim);
        if (error?.code === "CLAIM_INVALID") {
          notify("That scan expired - tap your card again.");
        } else if (error?.code === "SESSION_SWITCH_REQUIRED") {
          notify("Sign out before switching to another card.");
        } else {
          console.error("Claim exchange failed:", error);
        }
      }
    },
    [apiPost, intendedAction, isMobileUi, notify, signIn],
  );

  // ── Socket.IO Setup ──
  useEffect(() => {
    const socket = io(SOCKET_BASE, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
      auth: {
        clientRole: isMobileUi ? "mobile" : "dashboard",
        scanSession: isMobileUi ? mobileScanSessionRef.current : "",
      },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocketId(socket.id);
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("init", (payload) => {
      setProposals(payload.proposals || []);
      setTransactions((payload.transactions || []).slice().reverse());
      setSocketId(payload.socketId || socket.id);
      if (payload.registeredVoters !== undefined) {
        setRegisteredVotersCount(payload.registeredVoters);
      }
      setLoading(false);
    });

    socket.on("proposals-updated", (payload) => {
      setProposals(payload || []);
    });

    socket.on("activity-event", (payload) => {
      if (!payload) return;
      setTransactions((prev) => {
        if (prev.some((entry) => entry.id === payload.id)) return prev;
        return [payload, ...prev].slice(0, 20);
      });
    });

    socket.on("card-scanned", (payload) => {
      if (!payload) return;
      if (!isMobileUi) return;
      if (payload.type === "unregistered") {
        setRegisterCardId(payload.cardId);
        return;
      }

      // This browser triggered the scan itself, so it already received a
      // session cookie from the HTTP response.
      // A scan triggered from the member's phone: the phone got the cookie, not
      // this kiosk, so the claim is exchanged for a session of its own.
      claimScan(payload, socket.id);
    });

    socket.on("vote-recorded", (payload) => {
      setProposals((prev) =>
        prev.map((p) => (p.id === payload.proposal.id ? payload.proposal : p)),
      );
      // Only the member who actually voted may have their balance refreshed:
      // a shared kiosk must not copy another member's vote onto this session.
      const current = sessionRef.current;
      const currentWallet = current && current.voter && current.voter.wallet;
      const votedWallet = payload.voter && payload.voter.wallet;
      if (payload.voter && currentWallet && votedWallet === currentWallet) {
        setCurrentVoter((prev) => (prev ? { ...prev, ...payload.voter } : prev));
      }
      notify(`Vote recorded for "${payload.proposal.title}"`);
    });

    socket.on("voter-registered", (payload) => {
      // Could show a notification, but keep it quiet for other kiosks
      if (payload && payload.registeredVoters !== undefined) {
        setRegisteredVotersCount(payload.registeredVoters);
      }
    });

    // Check URL for cardId parameter (from NFC shortcut)
    const params = new URLSearchParams(window.location.search);
    const cardFromUrl = params.get("cardId");
    const inviteFromUrl = params.get("invite");

    // Handle ?invite= param — redeem invite code as virtual NFC card
    if (inviteFromUrl) {
      const handleInviteRedeem = async () => {
        try {
          await new Promise((resolve) => {
            if (socket.connected) resolve();
            else { socket.on("connect", resolve); setTimeout(resolve, 3000); }
          });
          const sid = socket.id || "";
          const res = await fetch(`${API_BASE}/invites/redeem`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: inviteFromUrl, socketId: sid }),
          });
          const data = await res.json();
          window.history.replaceState({}, "", window.location.pathname);
          if (!res.ok) notify(data.error || "Invite redemption failed");
          // card-scanned socket event will handle the rest
        } catch (err) {
          notify(`Invite error: ${err.message}`);
        }
      };
      setTimeout(handleInviteRedeem, 500);
    }

    if (cardFromUrl) {
      // Handle scan directly from URL parameter
      const handleUrlScan = async () => {
        try {
          // Wait for socket to be connected
          await new Promise((resolve) => {
            if (socket.connected) {
              resolve();
            } else {
              socket.on("connect", resolve);
              setTimeout(resolve, 3000); // Timeout after 3 seconds
            }
          });

          const sid = socket.id || "";
          const data = await apiGet(
            `/scan?cardId=${encodeURIComponent(cardFromUrl)}&socketId=${encodeURIComponent(sid)}&scanSession=${encodeURIComponent(mobileScanSessionRef.current)}`,
          );

          // Clean URL after scan
          window.history.replaceState({}, "", window.location.pathname);

          if (data.registered === false) {
            // Unregistered card — show registration modal
            setRegisterCardId(data.cardId || cardFromUrl);
          } else if (data.registered === true) {
            await claimScan(data, sid);
          }
        } catch (error) {
          console.error("Scan error:", error);
          notify(`Scan failed: ${error.message}`);
        }
      };
      
      // Handle scan after a short delay
      setTimeout(handleUrlScan, 500);
    }

    // Fetch tunnel info and poll until ready
    const fetchTunnelInfo = async () => {
      try {
        const res = await fetch(`${API_BASE}/tunnel-info`, { credentials: "include" });
        const data = await res.json();
        setTunnelInfo(data);
      } catch {
        return;
      }
    };
    fetchTunnelInfo();
    const tunnelPoll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/tunnel-info`, { credentials: "include" });
        const data = await res.json();
        setTunnelInfo(data);
        if (data.tunnelReady) clearInterval(tunnelPoll);
      } catch {
        return;
      }
    }, 5000);

    // Fetch proposals
    apiGet("/proposals")
      .then((decoded) => setProposals(Array.isArray(decoded) ? decoded : []))
      .catch(() => {})
      .finally(() => setLoading(false));

    // Restore the httpOnly session and probe the AI provider on mount.
    if (isMobileUi) restoreSession();
    checkAiStatus();

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      clearInterval(tunnelPoll);
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session: server-authoritative idle window with activity renewal ──
  useEffect(() => {
    onSessionLostRef.current = (code) => {
      // Another member took the kiosk over, or this browser never held a
      // session: just reset quietly and let the next tap sign someone in.
      if (code === "SESSION_SUPERSEDED" || code === "SESSION_UNCLAIMED") {
        clearLocalSession();
        return;
      }
      clearLocalSession("Session expired — tap your card to continue.");
    };
    return () => {
      onSessionLostRef.current = null;
    };
  }, [clearLocalSession]);

  useEffect(() => {
    if (!currentVoter?.cardId) return undefined;

    // Renew the sliding window while the member is actually using the app
    const onActivity = () => {
      if (Date.now() - lastTouchRef.current < SESSION_TOUCH_INTERVAL_MS) return;
      touchSession();
    };
    const events = ["pointerdown", "keydown", "touchstart", "wheel", "visibilitychange"];
    events.forEach((name) =>
      window.addEventListener(name, onActivity, { passive: true }),
    );
    const heartbeat = setInterval(touchSession, SESSION_TOUCH_INTERVAL_MS);
    touchSession();

    if (sessionCountdownRef.current) clearInterval(sessionCountdownRef.current);
    sessionCountdownRef.current = setInterval(() => {
      setSessionSecondsLeft((seconds) => {
        if (seconds === null) return null;
        if (seconds <= 1) {
          clearLocalSession("Session idle for too long — tap your card to continue.");
          return null;
        }
        return seconds - 1;
      });
    }, 1000);

    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity));
      clearInterval(heartbeat);
      if (sessionCountdownRef.current) {
        clearInterval(sessionCountdownRef.current);
        sessionCountdownRef.current = null;
      }
    };
  }, [currentVoter?.cardId, touchSession, clearLocalSession]);

  // ── Native WebNFC Scan (Android / HTTPS only) ──
  const startNativeScan = async () => {
    if (!('NDEFReader' in window)) {
      notify("Native NFC scanning is not supported on this browser (or it's not HTTPS/Localhost).");
      return;
    }

    try {
      setNfcScanning(true);
      const ndef = new window.NDEFReader();
      await ndef.scan();

      notify("Ready to scan. Please tap your NFC card.");

      ndef.addEventListener("reading", ({ serialNumber }) => {
        // Stop scanning after a successful read
        setNfcScanning(false);
        if (serialNumber) {
          const formattedId = serialNumber.replace(/:/g, "").toUpperCase();
          scanCard(formattedId);
        } else {
          notify("Card read successfully, but no serial number found.");
        }
      });

      ndef.addEventListener("readingerror", () => {
        setNfcScanning(false);
        notify("Cannot read data from the NFC tag. Try another one.");
      });

    } catch (error) {
      setNfcScanning(false);
      notify(`NFC Error: ${error.message}`);
    }
  };

  // ── Manual card scan ──
  const handleManualScan = () => {
    const id = manualCardId.trim();
    if (!id) return;
    scanCard(id);
    setManualCardId("");
  };

  // ── Start vote flow ──
  const startVoteFlow = (proposal) => {
    if (!currentVoter) {
      notify("Scan your card first to vote");
      return;
    }
    setPinError("");
    setPinModal({
      action: "vote",
      proposalId: proposal.id,
      proposalTitle: proposal.title,
    });
  };

  const mobileShortcutUrl = `${window.location.origin}/scan?cardId=YOUR_CARD_ID&scanSession=${encodeURIComponent(mobileScanSessionRef.current)}`;

  // ═══ RENDER ═══

  // ─── GATE: Entry / Welcome ───
  if (!isMobileUi) {
    return (
      <DashboardView
        proposals={proposals}
        transactions={transactions}
        loading={loading}
        connected={connected}
        registeredVotersCount={registeredVotersCount}
        activeProposals={activeProposals}
        totalVotes={totalVotes}
        resolveMediaUrl={resolveMediaUrl}
      />
    );
  }

  if (!intendedAction && !currentVoter) {
    return (
      <div className="app-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <NavigationBreadcrumbs current="mobile" />
        <div className="panel gate-panel">
          <h2>Welcome to Tap DAO</h2>
          <p style={{ marginBottom: "2rem", color: "var(--ink-muted)" }}>
            What would you like to do today?
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <button className="primary-btn btn-block" style={{ padding: "1rem", fontSize: "1.1rem" }} onClick={() => handleActionSelect("read")}>
              <ClipboardList className="inline-icon" size={20} /> Read Proposals
            </button>
            <button className="secondary-btn btn-block" style={{ padding: "1rem", fontSize: "1.1rem" }} onClick={() => handleActionSelect("write")}>
              <PenTool className="inline-icon" size={20} /> Write a Proposal
            </button>
          </div>
        </div>
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    );
  }

  // ─── GATE: Welcome (Tap-First) ───
  if (!intendedAction && currentVoter) {
    return (
      <div className="app-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <NavigationBreadcrumbs current="mobile" />
        <div className="panel gate-panel">
          <h2>Welcome Back, {currentVoter.name}!</h2>
          <p style={{ marginBottom: "2rem", color: "var(--ink-muted)" }}>
            Identity verified. Where to?
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <button className="primary-btn btn-block" style={{ padding: "1rem", fontSize: "1.1rem" }} onClick={() => handleActionSelect("read")}>
              <Activity className="inline-icon" size={20} /> View Dashboard
            </button>
            <button className="secondary-btn btn-block" style={{ padding: "1rem", fontSize: "1.1rem" }} onClick={() => handleActionSelect("write")}>
              <PenTool className="inline-icon" size={20} /> Create Proposal
            </button>
          </div>
        </div>
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    );
  }

  // ─── GATE: Scan (Click-First) ───
  if (intendedAction && !currentVoter) {
    return (
      <div className="app-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <NavigationBreadcrumbs current="mobile" />
        <div className="panel gate-panel" style={{ position: "relative" }}>
          <button
            className="secondary-btn"
            style={{ position: "absolute", top: "1rem", left: "1rem", padding: "0.2rem 0.5rem" }}
            onClick={() => setIntendedAction(null)}
          >
            ← Back
          </button>

          <h2 style={{ marginTop: "1rem" }}>Identify Yourself</h2>
          <p style={{ marginBottom: "2rem", color: "var(--ink-muted)" }}>
            Please tap your NFC card to your device to {intendedAction === "read" ? "access the dashboard" : "create a proposal"}.
          </p>

          <button
            type="button"
            className="scan-btn"
            onClick={startNativeScan}
            style={{ marginBottom: "1rem", backgroundColor: nfcScanning ? "var(--itom-charcoal)" : undefined, color: nfcScanning ? "var(--itom-white)" : undefined }}
          >
            <span className="scan-icon">◉</span>
            <span>{nfcScanning ? "Scanning..." : "Scan NFC Card"}</span>
          </button>

          <p style={{ margin: "1.5rem 0 0.5rem", fontSize: "0.8rem", color: "var(--ink-muted)" }}>
            — OR MANUALLY ENTER ID —
          </p>
          <div className="manual-card-input" style={{ justifyContent: "center" }}>
            <input
              type="text"
              value={manualCardId}
              onChange={(e) => setManualCardId(e.target.value)}
              placeholder="Enter Card ID..."
              onKeyDown={(e) => { if (e.key === "Enter") handleManualScan(); }}
              style={{ maxWidth: "150px" }}
            />
            <button type="button" className="secondary-btn" onClick={handleManualScan}>
              Submit
            </button>
          </div>
          <button
            type="button"
            className="secondary-btn btn-block"
            style={{ marginTop: "1rem" }}
            onClick={() => copyToClipboard(mobileShortcutUrl, "mobile-scan")}
          >
            {copiedUrl === "mobile-scan" ? <Check size={16} /> : <Copy size={16} />}
            {copiedUrl === "mobile-scan" ? "Copied" : "Copy iPhone Shortcut URL"}
          </button>
          <p style={{ margin: "0.7rem 0 0", fontSize: "0.75rem", color: "var(--ink-muted)" }}>
            Replace YOUR_CARD_ID in the copied URL. Copy it on the phone that will tap the card; it only reaches this mobile session.
          </p>
        </div>

        {registerCardId ? (
          <RegisterModal
            cardId={registerCardId}
            onRegister={registerCard}
            onCancel={() => { setRegisterCardId(null); setRegisterError(""); }}
            loading={registerLoading}
            error={registerError}
          />
        ) : null}
        {toast ? <div className="toast">{toast}</div> : null}
      </div>
    );
  }

  // ─── MAIN APP SHELL (Action + Voter present) ───
  return (
    <div className={`app-shell theme-${appTheme}`}>
      {/* ── Top Bar ── */}
      <header className="topbar">
        <div className="topbar-brand">
          <h1>Tap DAO</h1>
          <NavigationBreadcrumbs current="mobile" />
        </div>
        <div className="topbar-right">
          <div className="theme-toggles">
            <button type="button" className="theme-btn active" onClick={cycleTheme} title={`Theme: ${appTheme}`}>
              {themeIcons[appTheme]}
            </button>
          </div>
          {currentVoter ? (
            <div
              className="identity-badge"
              onClick={() => {
                setPinError("");
                setPinModal({ action: "balance" });
              }}
              title="Tap to check balance"
            >
              <span className="badge-avatar">{currentVoter.avatar || "👤"}</span>
              <span>{currentVoter.name}</span>
              {currentVoter.tokenBalance != null ? (
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem" }}>
                  {currentVoter.tokenBalance}t
                </span>
              ) : null}
            </div>
          ) : null}
          <div className={`status ${connected ? "online" : "offline"}`}>
            <span className="dot" />
            <span>{connected ? "Live" : "Off"}</span>
          </div>
          <a className="mobile-dashboard-link" href="/dashboard">
            Governance
          </a>
          {currentVoter && (
            <button 
              type="button" 
              className="theme-btn" 
              onClick={handleLogout} 
              title="Sign Out" 
              style={{ marginLeft: '4px' }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </header>

      {/* ── Session Expiry Warning Banner ── */}
      {sessionSecondsLeft !== null && sessionSecondsLeft <= SESSION_WARNING_SECONDS && (
        <div className="session-warning">
          <span>⏱ Session expires in {sessionSecondsLeft}s</span>
          <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>
            Keep tapping to stay signed in, or tap your card
          </span>
        </div>
      )}

      {/* ── Tab Content ── */}
      <div className="tab-content">
        {/* ─── VOTE TAB ─── */}
        {activeTab === "vote" && (
          <>
            {/* Stats */}
            <div className="stats-row">
              <div className="stat-card">
                <p>Proposals</p>
                <strong>{activeProposals}</strong>
              </div>
              <div className="stat-card">
                <p>Votes</p>
                <strong>{totalVotes}</strong>
              </div>
              <div className="stat-card">
                <p>Voters</p>
                <strong>{registeredVotersCount}</strong>
              </div>
            </div>

            {/* Identity Section - Now handled by Gates */}
            {currentVoter ? (
              <div className="voter-card">
                <span className="voter-avatar">{currentVoter.avatar || "👤"}</span>
                <div className="voter-info">
                  <strong>{currentVoter.name}</strong>
                  <small>{currentVoter.wallet ? `${currentVoter.wallet.slice(0, 8)}...${currentVoter.wallet.slice(-6)}` : ""}</small>
                </div>
                {currentVoter.tokenBalance != null ? (
                  <span className="voter-balance">{currentVoter.tokenBalance}t</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ fontSize: "0.75rem", padding: "0.4rem 0.6rem", minHeight: "auto" }}
                    onClick={() => { setPinError(""); setPinModal({ action: "balance" }); }}
                  >
                    Balance
                  </button>
                )}
              </div>
            ) : null}

            {/* Proposal List */}
            <div className="section-header">
              <h2>Proposals</h2>
            </div>

            {/* Category filter pills */}
            {proposals.length > 0 && (
              <div className="category-pills">
                {["All", ...new Set(proposals.map((p) => p.category).filter(Boolean))].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`category-pill ${categoryFilter === cat ? "active" : ""}`}
                    onClick={() => setCategoryFilter(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}

            {loading ? (
              <div className="loading-row">
                <span className="spinner" />
                <span>Loading proposals...</span>
              </div>
            ) : proposals.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <p>No proposals yet. Create the first one!</p>
              </div>
            ) : (
              <div className="proposal-list">
                {proposals
                  .filter((p) => categoryFilter === "All" || p.category === categoryFilter)
                  .map((proposal) => {
                  const tokensReceived = (proposal.votes || 0) * 100;
                  const fundsReq = proposal.fundsRequested || 1;
                  const rawPercent = (tokensReceived / fundsReq) * 100;
                  const percent = Math.min(rawPercent, 100).toFixed(1);

                  let barColor = "#10B981";
                  if (rawPercent < 33) barColor = "#EF4444";
                  else if (rawPercent < 66) barColor = "#F59E0B";

                  const hasVoted = votedProposalIds.has(proposal.id);

                  return (
                    <article
                      key={proposal.id}
                      className={`proposal-card ${hasVoted ? "voted" : ""}`}
                      onClick={() => setPreviewProposal(proposal)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setPreviewProposal(proposal);
                        }
                      }}
                    >
                      {proposal.imageUrl ? (
                        <div className="proposal-thumbnail-wrapper">
                          <img
                            src={resolveMediaUrl(proposal.imageUrl)}
                            alt=""
                            className="proposal-thumbnail"
                          />
                        </div>
                      ) : null}

                      {/* Header row: title + voted badge */}
                      <div className="proposal-title-row">
                        <h3>{proposal.title}</h3>
                        {hasVoted && <span className="voted-badge">✓ Voted</span>}
                      </div>

                      {/* Progress bar is now the visual hero */}
                      <div className="proposal-progress-track">
                        <div
                          className="proposal-progress"
                          style={{ width: `${percent}%`, backgroundColor: barColor }}
                        />
                        <span className="progress-label">{percent}% funded</span>
                      </div>

                      <p className="desc">{proposal.description || "No description."}</p>
                      <div className="proposal-meta">
                        <span>{proposal.category}</span>
                        <span>{tokensReceived}/{proposal.fundsRequested}t</span>
                        <span>{proposal.votes} votes</span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ─── CREATE TAB ─── */}
        {activeTab === "create" && (
          <>
            <div className="panel">
              <h2>Create Proposal</h2>

              <div className="create-mode-tabs">
                <button
                  type="button"
                  className={`mode-tab ${createMode === "manual" ? "active" : ""}`}
                  onClick={() => setCreateMode("manual")}
                >
                  Manual
                </button>
                <button
                  type="button"
                  className={`mode-tab ${createMode === "ai" ? "active" : ""}`}
                  onClick={() => setCreateMode("ai")}
                >
                  AI Assist
                </button>
              </div>

              {createMode === "ai" ? (
                <div className="ai-mode">
                  <p className="ai-hint">
                    Describe your proposal idea in plain language. AI will structure it.
                  </p>

                  {aiStatus ? (
                    <div className="ai-status-row">
                      <span
                        className={`status-dot ${
                          aiStatus.configured && aiStatus.reachable ? "ok" : "off"
                        }`}
                      />
                      <span>
                        {aiStatus.configured
                          ? aiStatus.reachable
                            ? `AI ready (${aiStatus.providerModel || aiStatus.model || "colab"})`
                            : `AI provider unreachable — ${aiStatus.detail || ""}`
                          : "AI Assist is not configured on the server"}
                      </span>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={checkAiStatus}
                        disabled={aiGenerating}
                      >
                        Re-check
                      </button>
                    </div>
                  ) : null}
                  
                  {aiPreview ? (
                    <div className="ai-preview-card">
                      <h4>{aiPreview.title}</h4>
                      <p className="desc">{aiPreview.description}</p>
                      <span className="category-pill active">{aiPreview.category}</span>
                      
                      <div className="ai-preview-actions">
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => setAiPreview(null)}
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => {
                            setForm(prev => ({ ...prev, ...aiPreview }));
                            setAiPreview(null);
                            setCreateMode("manual");
                          }}
                        >
                          Accept & Edit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <textarea
                        className="ai-textarea"
                        rows="4"
                        value={aiPrompt}
                        onChange={(e) => { setAiPrompt(e.target.value); setAiError(""); }}
                        placeholder='e.g. "We need better street lights in sector 7..."'
                        disabled={aiGenerating}
                      />
                      {aiError ? (
                        <div className="error-text">
                          <p>{aiError}</p>
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={generateProposal}
                            disabled={aiGenerating}
                          >
                            Try again
                          </button>
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="primary-btn btn-block"
                        onClick={generateProposal}
                        disabled={aiGenerating || !aiPrompt.trim()}
                      >
                        {aiGenerating ? "Generating..." : "Generate Proposal"}
                      </button>
                      {aiGenerating ? (
                        <div className="loading-row">
                          <span className="spinner" />
                          <span>
                            AI is structuring your proposal… {aiElapsed}s
                            {aiElapsed >= 20 ? " (cold GPU start can take a while)" : ""}
                          </span>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              ) : (
                <form onSubmit={createProposal} className="create-form">
                  <label>
                    Title
                    <input
                      type="text"
                      value={form.title}
                      onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                      placeholder="Community solar lighting"
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      rows="3"
                      value={form.description}
                      onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                      placeholder="Describe the proposal..."
                    />
                  </label>
                  <label>
                    Category
                    <select
                      value={form.category}
                      onChange={(e) => setForm((p) => ({ ...p, category: e.target.value }))}
                    >
                      <option value="General">General</option>
                      <option value="Infrastructure">Infrastructure</option>
                      <option value="Energy">Energy</option>
                      <option value="Digital">Digital</option>
                      <option value="Education">Education</option>
                      <option value="Health">Health</option>
                    </select>
                  </label>
                  <label>
                    Estimated Budget (INR)
                    <input
                      type="number"
                      min="1"
                      value={form.fiatBudget}
                      onChange={(e) => setForm((p) => ({ ...p, fiatBudget: e.target.value }))}
                      placeholder="e.g. 150000"
                    />
                  </label>

                  {form.fiatBudget && Number(form.fiatBudget) > 0 ? (
                    <div style={{ padding: "0.75rem", backgroundColor: "var(--itom-light)", borderRadius: "8px", margin: "1rem 0", borderLeft: "4px solid var(--primary-main)" }}>
                      <strong style={{ display: "block", marginBottom: "0.25rem", color: "var(--itom-charcoal)" }}>Proposal Grade: {
                        Number(form.fiatBudget) > 100000 ? "A (10,000 Token Goal)" :
                          Number(form.fiatBudget) > 10000 ? "B (5,000 Token Goal)" : "C (1,000 Token Goal)"
                      }</strong>
                      <p style={{ fontSize: "0.80rem", color: "green", margin: 0 }}>
                        Submission requires 200 tokens (100 creation fee + 100 auto-vote).
                      </p>
                    </div>
                  ) : null}
                  <label>
                    Image (Optional)
                    <input
                      type="file"
                      accept="image/*"
                      className="file-input"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setForm((p) => ({ ...p, imageFile: file }));
                      }}
                    />
                  </label>
                  {form.imageFile ? (
                    <p style={{ marginTop: 0, fontSize: "0.85rem", color: "var(--ink-muted)" }}>
                      Selected: {form.imageFile.name}
                    </p>
                  ) : null}
                  <button type="submit" className="primary-btn btn-block" disabled={creating}>
                    {creating ? "Submitting..." : "Deploy Proposal"}
                  </button>
                </form>
              )}
            </div>
          </>
        )}

        {/* ─── ACTIVITY TAB ─── */}
        {activeTab === "activity" && (
          <>
            {/* ─ V2: Access Panel – Tunnel & Invite ─ */}
            <div className="panel access-panel">
              <h2><Globe size={18} className="inline-icon" /> Remote Access</h2>

              {/* Public tunnel URL */}
              <div className="access-section">
                <p className="access-label">Public URL (worldwide)</p>
                {tunnelInfo.tunnelReady ? (
                  <div className="access-url-row">
                    <span className="access-url">{tunnelInfo.tunnelUrl}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => copyToClipboard(tunnelInfo.tunnelUrl, "tunnel")}
                      title="Copy public URL"
                    >
                      {copiedUrl === "tunnel" ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                ) : (
                  <div className="access-url-row muted">
                    <span className="spinner" style={{ width: 14, height: 14 }} />
                    <span style={{ fontSize: "0.8rem" }}>Tunnel starting…</span>
                  </div>
                )}
              </div>

              {/* LAN URL */}
              <div className="access-section">
                <p className="access-label">Local network (same Wi-Fi)</p>
                <div className="access-url-row">
                  <span className="access-url">{tunnelInfo.lanUrl || "detecting…"}</span>
                  {tunnelInfo.lanUrl && (
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => copyToClipboard(tunnelInfo.lanUrl, "lan")}
                      title="Copy LAN URL"
                    >
                      {copiedUrl === "lan" ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
              </div>

            </div>

            {/* ─ V2: Invite Code Generator ─ */}
            <div className="panel">
              <h2><Users size={18} className="inline-icon" /> Invite Remote Voters</h2>
              <p style={{ fontSize: "0.85rem", color: "var(--ink-muted)", marginBottom: "1rem" }}>
                Generate a QR code for someone without an NFC card. They scan it to join.
              </p>
              <div className="invite-form">
                <input
                  type="text"
                  value={inviteLabel}
                  onChange={(e) => setInviteLabel(e.target.value)}
                  placeholder="Label (e.g. Priya - Kerala)" 
                  onKeyDown={(e) => { if (e.key === "Enter") generateInvite(); }}
                />
                <button
                  type="button"
                  className="primary-btn"
                  onClick={generateInvite}
                  disabled={generatingInvite}
                >
                  {generatingInvite ? "Creating…" : "Generate"}
                </button>
              </div>

              {invites.length > 0 && (
                <div className="invite-list">
                  {invites.map((inv) => (
                    <div key={inv.code} className="invite-item">
                      <div className="invite-qr-wrap">
                        <img
                          src={`${API_BASE}/invites/qr/${inv.code}`}
                          alt={`QR for ${inv.code}`}
                          className="invite-qr"
                        />
                      </div>
                      <div className="invite-meta">
                        <strong>{inv.label}</strong>
                        <span className="invite-code">{inv.code}</span>
                        <span className="invite-url" title={inv.joinUrl}>{inv.joinUrl}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => copyToClipboard(inv.joinUrl, inv.code)}
                          style={{ alignSelf: "flex-start" }}
                        >
                          {copiedUrl === inv.code ? <Check size={14} /> : <Link size={14} />}
                          <span style={{ marginLeft: 4, fontSize: "0.75rem" }}>
                            {copiedUrl === inv.code ? "Copied!" : "Copy link"}
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Transaction Feed */}
            <div className="panel">
              <h2>Transaction Feed</h2>
              {transactions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">No Data</div>
                  <p>No transactions yet. Scan a card or cast a vote.</p>
                </div>
              ) : (
                <>
                  <div className="feed-list">
                    {transactions.slice(0, isFeedExpanded ? transactions.length : 5).map((tx) => {
                      const isVote = tx.type === "VOTE_CAST";
                      const isFailure = tx.status === "failed";
                      const timeAgo = (() => {
                        const diff = Math.floor((Date.now() - new Date(tx.timestamp).getTime()) / 1000);
                        if (diff < 60) return `${diff}s ago`;
                        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                        return new Date(tx.timestamp).toLocaleTimeString();
                      })();
                      return (
                        <div key={`${tx.hash}-${tx.id}`} className="feed-row">
                          <span className="feed-icon">{isFailure ? "!" : isVote ? "\uD83D\uDDF3\uFE0F" : "\uD83C\uDD94"}</span>
                          <div className="feed-body">
                            <span className="feed-label">
                              {isVote
                                ? tx.proposalTitle ? `Voted on "${tx.proposalTitle}"` : "Vote cast"
                                : "Identity verified"}
                            </span>
                            <small className="feed-time">{timeAgo}</small>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {transactions.length > 5 && (
                    <button
                      className="secondary-btn btn-block"
                      style={{ marginTop: '0.75rem' }}
                      onClick={() => setIsFeedExpanded(!isFeedExpanded)}
                    >
                      {isFeedExpanded ? "Show Less" : `View All (${transactions.length})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Connection debug */}
            <div className="panel">
              <h2>Connection</h2>
              <p>Socket: {connected ? `Connected (${socketId})` : "Disconnected"}</p>
            </div>
          </>
        )}
      </div>

      {/* ── Bottom Navigation ── */}
      <nav className="bottom-nav">
        <button
          type="button"
          className={`nav-tab ${activeTab === "vote" ? "active" : ""}`}
          onClick={() => setActiveTab("vote")}
        >
          <span className="nav-icon">✓</span>
          <span>Vote</span>
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === "create" ? "active" : ""}`}
          onClick={() => setActiveTab("create")}
        >
          <span className="nav-icon">+</span>
          <span>Create</span>
        </button>
        <button
          type="button"
          className={`nav-tab ${activeTab === "activity" ? "active" : ""}`}
          onClick={() => setActiveTab("activity")}
        >
          <span className="nav-icon">•</span>
          <span>Activity</span>
        </button>
      </nav>

      {/* ── Modals ── */}
      {previewProposal ? (
        <ProposalPreview
          proposal={previewProposal}
          imageUrl={resolveMediaUrl(previewProposal.imageUrl)}
          onClose={() => setPreviewProposal(null)}
          onVote={startVoteFlow}
          currentVoter={currentVoter}
        />
      ) : null}

      {registerCardId ? (
        <RegisterModal
          cardId={registerCardId}
          onRegister={registerCard}
          onCancel={() => { setRegisterCardId(null); setRegisterError(""); }}
          loading={registerLoading}
          error={registerError}
        />
      ) : null}

      {pinModal ? (
        <PinModal
          action={pinModal.action}
          onSubmit={handlePinSubmit}
          onCancel={() => { setPinModal(null); setPinError(""); }}
          error={pinError}
        />
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

export default App;
