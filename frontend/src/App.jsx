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
function ProposalPreview({ proposal, onClose, onVote, currentVoter }) {
  if (!proposal) return null;

  const tokensReceived = (proposal.votes || 0) * 100;
  const percent = Math.min((tokensReceived / (proposal.fundsRequested || 1)) * 100, 100).toFixed(1);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        {proposal.imageUrl ? (
          <div className="preview-hero">
            <img src={proposal.imageUrl} alt="" />
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

function App() {
  // ── Connection ──
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Data ──
  const [proposals, setProposals] = useState([]);
  const [transactions, setTransactions] = useState([]);

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
  const [nfcSupported, setNfcSupported] = useState('NDEFReader' in window);

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
  const [showStatusMenu, setShowStatusMenu] = useState(false);

  // ── AI Preview ──
  const [aiPreview, setAiPreview] = useState(null);

  // ── Balance countdown ──
  const [balanceSecondsLeft, setBalanceSecondsLeft] = useState(null);

  // ── Voted proposals tracking ──
  const [votedProposalIds, setVotedProposalIds] = useState(new Set());

  // ── Category filter ──
  const [categoryFilter, setCategoryFilter] = useState("All");

  const toastTimerRef = useRef(null);
  const voterTimeoutRef = useRef(null);
  const sessionCountdownRef = useRef(null);
  const balanceCountdownRef = useRef(null);
  const socketRef = useRef(null);

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

  const handleLogout = useCallback(() => {
    setCurrentVoter(null);
    setIntendedAction(null);
    setAiPreview(null);
    setPreviewProposal(null);
    if (voterTimeoutRef.current) clearTimeout(voterTimeoutRef.current);
    if (sessionCountdownRef.current) clearInterval(sessionCountdownRef.current);
    if (balanceCountdownRef.current) clearInterval(balanceCountdownRef.current);
    setSessionSecondsLeft(null);
    setBalanceSecondsLeft(null);
    notify("Signed out successfully");
  }, [notify]);

  const toApiPath = useCallback((path) => `${API_BASE}${path}`, []);

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
      if (!decrypted) throw new Error("Unable to decrypt server payload");
      return JSON.parse(decrypted);
    }
    return data;
  }, []);

  const apiGet = useCallback(
    async (path, fallback) => {
      const res = await fetch(toApiPath(path));
      const raw = await res.json();
      const data = decodeApiPayload(raw);
      if (!res.ok) throw new Error(data?.error || fallback);
      return data;
    },
    [decodeApiPayload, toApiPath],
  );

  const apiPost = useCallback(
    async (path, body, fallback) => {
      const encrypted = encrypt(JSON.stringify(body));
      const res = await fetch(toApiPath(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: encrypted }),
      });
      const raw = await res.json();
      const data = decodeApiPayload(raw);
      if (!res.ok) throw new Error(data?.error || fallback);
      return data;
    },
    [decodeApiPayload, toApiPath],
  );

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
        await apiGet(
          `/scan?cardId=${encodeURIComponent(cardId)}&socketId=${encodeURIComponent(sid)}`,
          "Card scan failed",
        );
      } catch (error) {
        console.error("Card scan error:", error);
        notify(`Scan failed: ${error.message}`);
      }
    },
    [apiGet, notify],
  );

  // ── Register a new card ──
  const registerCard = useCallback(
    async ({ cardId, name, pin }) => {
      setRegisterLoading(true);
      setRegisterError("");
      try {
        const data = await apiPost("/register", { cardId, name, pin }, "Registration failed");
        setCurrentVoter({
          ...data.voter,
          cardId,
        });
        setRegisterCardId(null);
        notify(`Welcome, ${data.voter.name}! Card registered with 1000 tokens.`);

        // Reset voter timeout
        if (voterTimeoutRef.current) clearTimeout(voterTimeoutRef.current);
        voterTimeoutRef.current = setTimeout(() => setCurrentVoter(null), 120000);
      } catch (error) {
        setRegisterError(error.message);
      } finally {
        setRegisterLoading(false);
      }
    },
    [apiPost, notify],
  );

  // ── Cast Vote ──
  const castVote = useCallback(
    async (pin) => {
      if (!pinModal || !currentVoter?.encryptedPayload) return;
      setPinError("");
      try {
        await apiPost(
          "/vote",
          {
            encryptedPayload: currentVoter.encryptedPayload,
            proposalId: pinModal.proposalId,
            pin,
          },
          "Vote request failed",
        );
        // Haptic feedback on success
        navigator.vibrate?.([100, 50, 100]);
        // Track voted proposal locally
        setVotedProposalIds((prev) => new Set([...prev, pinModal.proposalId]));
        notify(`Vote submitted for "${pinModal.proposalTitle}"`);
        setPinModal(null);
        setPreviewProposal(null);
      } catch (error) {
        setPinError(error.message);
      }
    },
    [apiPost, currentVoter, notify, pinModal],
  );

  // ── Check Balance ──
  const checkBalance = useCallback(
    async (pin) => {
      if (!currentVoter?.encryptedPayload) return;
      setPinError("");
      try {
        const data = await apiPost(
          "/verify-pin",
          { encryptedPayload: currentVoter.encryptedPayload, pin },
          "Balance check failed",
        );
        setCurrentVoter((prev) => ({ ...prev, tokenBalance: data.tokenBalance }));
        setPinModal(null);
        // Balance countdown: 10s then auto-hide
        setBalanceSecondsLeft(10);
        if (balanceCountdownRef.current) clearInterval(balanceCountdownRef.current);
        balanceCountdownRef.current = setInterval(() => {
          setBalanceSecondsLeft((s) => {
            if (s <= 1) {
              clearInterval(balanceCountdownRef.current);
              setCurrentVoter((prev) => prev ? { ...prev, tokenBalance: null } : prev);
              return null;
            }
            return s - 1;
          });
        }, 1000);
      } catch (error) {
        setPinError(error.message);
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
      if (!currentVoter?.encryptedPayload || !pinModal?.requiredTokens) return;
      setCreating(true);
      setPinError("");

      let imageUrl = "";
      if (form.imageFile) {
        try {
          const fd = new FormData();
          fd.append("image", form.imageFile);
          const uploadRes = await fetch(toApiPath("/upload"), { method: "POST", body: fd });
          if (!uploadRes.ok) throw new Error("Upload failed");
          const uploadData = await uploadRes.json();
          imageUrl = uploadData.imageUrl || "";
        } catch (err) {
          notify(`Image upload warning: ${err.message}`);
        }
      }

      try {
        await apiPost(
          "/proposals",
          {
            title: form.title.trim(),
            description: form.description.trim(),
            category: form.category,
            fundsRequested: pinModal.requiredTokens,
            imageUrl,
            encryptedPayload: currentVoter.encryptedPayload,
            pin,
          },
          "Create proposal failed",
        );
        setForm({ title: "", description: "", category: "General", fiatBudget: "", imageFile: null });
        setPinModal(null);
        notify("Proposal created! 200 tokens deducted.");
        setIntendedAction("read");
        setActiveTab("vote");
      } catch (error) {
        setPinError(error.message);
      } finally {
        setCreating(false);
      }
    },
    [apiPost, currentVoter, form, notify, pinModal, toApiPath],
  );

  // ── AI Generate ──
  const generateProposal = useCallback(async () => {
    if (!aiPrompt.trim()) {
      setAiError("Describe your proposal idea first");
      return;
    }
    setAiGenerating(true);
    setAiError("");
    try {
      const generated = await apiPost(
        "/proposals/generate",
        { text: aiPrompt.trim() },
        "AI generation failed",
      );
      setAiPreview({
        title: generated.title || "",
        description: generated.description || "",
        category: generated.category || "General",
      });
      notify("AI structured your proposal — review and accept");
    } catch (error) {
      setAiError(error.message || "Failed to generate proposal");
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, apiPost, notify]);

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

  // ── Socket.IO Setup ──
  useEffect(() => {
    const socket = io(SOCKET_BASE, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      setSocketId(socket.id);
    });
    socket.on("disconnect", () => setConnected(false));

    socket.on("init", (payload) => {
      setProposals(payload.proposals || []);
      setTransactions(payload.transactions || []);
      setSocketId(payload.socketId || socket.id);
      setLoading(false);
    });

    socket.on("proposals-updated", (payload) => {
      setProposals(payload || []);
    });

    socket.on("card-scanned", (payload) => {
      console.log("Card-scanned event received:", payload);
      if (payload.type === "unregistered") {
        console.log("Showing registration modal for card:", payload.cardId);
        setRegisterCardId(payload.cardId);
        return;
      }

      // Known card — set voter and go directly to vote tab (skip action gate)
      console.log("Setting current voter:", payload.voter);
      setCurrentVoter(payload.voter || null);
      setIntendedAction("read"); // skip the "where to?" gate
      setActiveTab("vote");
      setVotedProposalIds(new Set()); // reset voted set for new session
      if (payload.transaction) {
        setTransactions((prev) => [payload.transaction, ...prev].slice(0, 20));
      }

      // Auto-expire identity after 2 minutes with countdown
      if (voterTimeoutRef.current) clearTimeout(voterTimeoutRef.current);
      if (sessionCountdownRef.current) clearInterval(sessionCountdownRef.current);
      setSessionSecondsLeft(120);
      sessionCountdownRef.current = setInterval(() => {
        setSessionSecondsLeft((s) => {
          if (s === 31) {
            notify("⚠️ Session expires in 30 seconds. Tap card to renew.");
          }
          if (s <= 1) {
            clearInterval(sessionCountdownRef.current);
            setCurrentVoter(null);
            setPinModal(null);
            setSessionSecondsLeft(null);
            return null;
          }
          return s - 1;
        });
      }, 1000);
    });

    socket.on("vote-recorded", (payload) => {
      setProposals((prev) =>
        prev.map((p) => (p.id === payload.proposal.id ? payload.proposal : p)),
      );
      if (payload.transaction) {
        // Enrich transaction with proposal title for human-readable feed
        const enrichedTx = { ...payload.transaction, proposalTitle: payload.proposal.title };
        setTransactions((prev) => [enrichedTx, ...prev].slice(0, 20));
      }
      if (payload.voter) {
        setCurrentVoter((prev) => (prev ? { ...prev, ...payload.voter } : prev));
      }
      notify(`Vote recorded for "${payload.proposal.title}"`);
    });

    socket.on("voter-registered", () => {
      // Could show a notification, but keep it quiet for other kiosks
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
          
          const socketId = socket.id || "";
          console.log("Socket connected, ID:", socketId);
          
          const response = await fetch(
            `${API_BASE}/scan?cardId=${encodeURIComponent(cardFromUrl)}&socketId=${encodeURIComponent(socketId)}`
          );
          const raw = await response.json();
          console.log("Raw scan response:", raw);
          
          // Decrypt the response (backend sends encrypted responses)
          const data = raw?.payload ? JSON.parse(decrypt(raw.payload)) : raw;
          console.log("Decrypted scan response:", data);
          
          // Clean URL after scan
          window.history.replaceState({}, "", window.location.pathname);
          
          // Handle directly from HTTP response instead of waiting for socket
          if (data.registered === false) {
            // Unregistered card — show registration modal
            console.log("Unregistered card, showing registration for:", data.cardId || cardFromUrl);
            setRegisterCardId(data.cardId || cardFromUrl);
          } else if (data.registered === true) {
            // Registered card — socket event should have fired, but as a fallback
            // set intended action so user goes straight to dashboard
            console.log("Registered card detected via HTTP response");
            setIntendedAction((prev) => prev || "read");
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
        const res = await fetch(`${API_BASE}/tunnel-info`);
        const data = await res.json();
        setTunnelInfo(data);
      } catch (_) {}
    };
    fetchTunnelInfo();
    const tunnelPoll = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/tunnel-info`);
        const data = await res.json();
        setTunnelInfo(data);
        if (data.tunnelReady) clearInterval(tunnelPoll);
      } catch (_) {}
    }, 5000);

    // Fetch proposals
    fetch(`${API_BASE}/proposals`)
      .then((r) => r.json())
      .then((raw) => {
        try {
          const decoded =
            raw?.payload ? JSON.parse(decrypt(raw.payload)) : raw;
          setProposals(decoded || []);
        } catch {
          /* noop */
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));

    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (voterTimeoutRef.current) clearTimeout(voterTimeoutRef.current);
      clearInterval(tunnelPoll);
      socket.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ═══ RENDER ═══

  // ─── GATE: Entry / Welcome ───
  if (!intendedAction && !currentVoter) {
    return (
      <div className="app-shell" style={{ justifyContent: "center", alignItems: "center" }}>
        <div className="panel" style={{ textAlign: "center", maxWidth: "400px", width: "100%", margin: "0 auto", padding: "2rem" }}>
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
        <div className="panel" style={{ textAlign: "center", maxWidth: "400px", width: "100%", margin: "0 auto", padding: "2rem" }}>
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
        <div className="panel" style={{ textAlign: "center", maxWidth: "400px", width: "100%", margin: "0 auto", padding: "2rem", position: "relative" }}>
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
        <h1>Tap DAO</h1>
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
      {sessionSecondsLeft !== null && sessionSecondsLeft <= 30 && (
        <div className="session-warning">
          <span>⏱ Session expires in {sessionSecondsLeft}s</span>
          <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>Tap your card to renew</span>
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
                <strong>{transactions.filter((t) => t.type === "IDENTITY_VERIFY").length}</strong>
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
                          <img src={proposal.imageUrl} alt="" className="proposal-thumbnail" />
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
                      />
                      {aiError ? <p className="error-text">{aiError}</p> : null}
                      <button
                        type="button"
                        className="primary-btn btn-block"
                        onClick={generateProposal}
                        disabled={aiGenerating}
                      >
                        {aiGenerating ? "Generating..." : "Generate Proposal"}
                      </button>
                      {aiGenerating ? (
                        <div className="loading-row">
                          <span className="spinner" />
                          <span>AI is structuring your proposal...</span>
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
                      const timeAgo = (() => {
                        const diff = Math.floor((Date.now() - new Date(tx.timestamp).getTime()) / 1000);
                        if (diff < 60) return `${diff}s ago`;
                        if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
                        return new Date(tx.timestamp).toLocaleTimeString();
                      })();
                      return (
                        <div key={`${tx.hash}-${tx.id}`} className="feed-row">
                          <span className="feed-icon">{isVote ? "\uD83D\uDDF3\uFE0F" : "\uD83C\uDD94"}</span>
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
