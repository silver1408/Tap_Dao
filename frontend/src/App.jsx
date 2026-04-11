import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import "./App.css";
import { decrypt, encrypt } from "./lib/crypto";
import ProposalPreviewModal from "./components/ProposalPreviewModal";
import { requestProposalProblemSummary } from "./services/proposalSummaryService";

const API_BASE = (
  import.meta.env.VITE_API_URL || "http://localhost:3001"
).replace(/\/$/, "");
const SOCKET_BASE = import.meta.env.VITE_SOCKET_URL || API_BASE || undefined;

const CARD_OPTIONS = [
  { id: "Metro_Card_001", label: "Metro Card 001 (Vaibhav Gupta)" },
  { id: "Metro_Card_002", label: "Metro Card 002 (OG Pratyush Mehra)" },
  { id: "Metro_Card_003", label: "Metro Card 003 (Suryansh Gupta)" },
];

function App() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [contractInfo, setContractInfo] = useState(null);
  const [proposals, setProposals] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [selectedCardId, setSelectedCardId] = useState(CARD_OPTIONS[0].id);
  const [pendingProposal, setPendingProposal] = useState(null);
  const [currentVoter, setCurrentVoter] = useState(null);
  const [toast, setToast] = useState("");
  const [creating, setCreating] = useState(false);
  const [previewProposal, setPreviewProposal] = useState(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinValue, setPinValue] = useState("");
  const [scannedPayload, setScannedPayload] = useState(null);
  const [pinError, setPinError] = useState("");
  const [summaryByProposalId, setSummaryByProposalId] = useState({});
  const [summaryLoadingProposalId, setSummaryLoadingProposalId] =
    useState(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "General",
    fundsRequested: "",
  });

  const pendingProposalRef = useRef(null);
  const toastTimerRef = useRef(null);

  useEffect(() => {
    pendingProposalRef.current = pendingProposal;
  }, [pendingProposal]);

  const totalVotes = useMemo(
    () => proposals.reduce((acc, proposal) => acc + (proposal.votes || 0), 0),
    [proposals],
  );

  const activeProposals = useMemo(
    () => proposals.filter((proposal) => proposal.status === "active").length,
    [proposals],
  );

  const notify = useCallback((message) => {
    setToast(message);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = setTimeout(() => setToast(""), 3500);
  }, []);

  const toApiPath = useCallback((path) => `${API_BASE}${path}`, []);

  const decodeApiPayload = useCallback((data) => {
    if (data && typeof data === "object" && typeof data.payload === "string") {
      const decrypted = decrypt(data.payload);
      if (!decrypted) {
        throw new Error("Unable to decrypt server payload");
      }
      return JSON.parse(decrypted);
    }
    return data;
  }, []);

  const apiGet = useCallback(
    async (path, fallbackMessage) => {
      const response = await fetch(toApiPath(path));
      const raw = await response.json();
      const data = decodeApiPayload(raw);
      if (!response.ok) {
        throw new Error(data?.error || fallbackMessage);
      }
      return data;
    },
    [decodeApiPayload, toApiPath],
  );

  const apiPost = useCallback(
    async (path, body, fallbackMessage) => {
      const encryptedPayload = encrypt(JSON.stringify(body));
      const response = await fetch(toApiPath(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload: encryptedPayload }),
      });
      const raw = await response.json();
      const data = decodeApiPayload(raw);
      if (!response.ok) {
        throw new Error(data?.error || fallbackMessage);
      }
      return data;
    },
    [decodeApiPayload, toApiPath],
  );

  const fetchProposals = useCallback(async () => {
    try {
      const data = await apiGet("/proposals", "Failed to load proposals");
      setProposals(data);
    } catch (error) {
      notify(`API error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  }, [apiGet, notify]);

  const fetchContractInfo = useCallback(async () => {
    try {
      const data = await apiGet("/contract", "Failed to load contract details");
      setContractInfo(data);
    } catch (error) {
      notify(`Contract bootstrap error: ${error.message}`);
    }
  }, [apiGet, notify]);

  const castVote = useCallback(
    async (encryptedPayload, proposalId, proposalTitle, pin) => {
      try {
        await apiPost("/vote", { encryptedPayload, proposalId, pin }, "Vote request failed");
        notify(`Vote transaction submitted for ${proposalTitle}`);
        setPinModalOpen(false);
        setPinValue("");
        setPendingProposal(null);
        setScannedPayload(null);
      } catch (error) {
        setPinError(`Vote failed: ${error.message}`);
      }
    },
    [apiPost, notify],
  );

  const handlePinSubmit = (e) => {
    e.preventDefault();
    if (pinValue.length < 4) {
      setPinError("PIN must be at least 4 digits");
      return;
    }
    const pending = pendingProposalRef.current;
    if (pending?.id && scannedPayload) {
      setPinError("");
      castVote(scannedPayload, pending.id, pending.title, pinValue);
    }
  };

  const handlePinCancel = () => {
    setPinModalOpen(false);
    setPinValue("");
    setScannedPayload(null);
    setPendingProposal(null);
    setPinError("");
  };

  const simulateTap = async () => {
    try {
      const data = await apiGet(
        `/scan?cardId=${encodeURIComponent(selectedCardId)}`,
        "Card scan failed",
      );
      notify(`Card verified for ${data.voter}`);
    } catch (error) {
      notify(`Scan failed: ${error.message}`);
    }
  };

  const simulateTapForCard = useCallback(
    async (cardId) => {
      try {
        const data = await apiGet(
          `/scan?cardId=${encodeURIComponent(cardId)}`,
          "Card scan failed",
        );
        notify(`Card verified for ${data.voter}`);
      } catch (error) {
        notify(`Scan failed: ${error.message}`);
      }
    },
    [apiGet, notify],
  );

  const createProposal = async (event) => {
    event.preventDefault();
    if (!form.title.trim() || !form.fundsRequested) {
      notify("Title and token amount are required");
      return;
    }

    setCreating(true);
    const payload = {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      fundsRequested: Number(form.fundsRequested),
    };

    try {
      await apiPost("/proposals", payload, "Create proposal failed");
      setForm({
        title: "",
        description: "",
        category: "General",
        fundsRequested: "",
      });
      notify("Proposal created and broadcast to all clients");
    } catch (error) {
      notify(`Create failed: ${error.message}`);
    } finally {
      setCreating(false);
    }
  };

  const summarizeProposalProblem = useCallback(
    async (proposal, options = {}) => {
      if (!proposal?.id) return;

      const forceRefresh = Boolean(options.forceRefresh);
      const cachedSummary = summaryByProposalId[proposal.id]?.summary;
      if (cachedSummary && !forceRefresh) {
        return;
      }

      setSummaryLoadingProposalId(proposal.id);

      setSummaryByProposalId((prev) => ({
        ...prev,
        [proposal.id]: {
          ...(prev[proposal.id] || {}),
          error: "",
        },
      }));

      try {
        const response = await requestProposalProblemSummary({
          apiPost,
          proposal,
        });

        setSummaryByProposalId((prev) => ({
          ...prev,
          [proposal.id]: {
            summary: response.summary,
            model: response.model,
            error: "",
          },
        }));
      } catch (error) {
        setSummaryByProposalId((prev) => ({
          ...prev,
          [proposal.id]: {
            ...(prev[proposal.id] || {}),
            error:
              error.message ||
              "Summary could not be generated right now. Please try again.",
          },
        }));
      } finally {
        setSummaryLoadingProposalId((current) =>
          current === proposal.id ? null : current,
        );
      }
    },
    [apiPost, summaryByProposalId],
  );

  useEffect(() => {
    fetchContractInfo();
    fetchProposals();

    const socket = io(SOCKET_BASE, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("init", (payload) => {
      setProposals(payload.proposals || []);
      setTransactions(payload.transactions || []);
      setCurrentVoter(payload.currentVoter || null);
      setLoading(false);
    });

    socket.on("proposals-updated", (payload) => {
      setProposals(payload || []);
    });

    socket.on("card-scanned", (payload) => {
      setCurrentVoter(payload.voter || null);
      if (payload.transaction) {
        setTransactions((prev) => [payload.transaction, ...prev].slice(0, 20));
      }

      const pending = pendingProposalRef.current;
      if (pending?.id && payload.voter?.encryptedPayload) {
        setScannedPayload(payload.voter.encryptedPayload);
        setPinModalOpen(true);
      }
    });

    socket.on("vote-recorded", (payload) => {
      setProposals((prev) =>
        prev.map((proposal) =>
          proposal.id === payload.proposal.id ? payload.proposal : proposal,
        ),
      );
      if (payload.transaction) {
        setTransactions((prev) => [payload.transaction, ...prev].slice(0, 20));
      }
      if (payload.voter) {
        setCurrentVoter((prev) => ({ ...prev, ...payload.voter }));
      }
      notify(`Vote recorded for "${payload.proposal.title}"`);
    });

    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
      socket.disconnect();
    };
  }, [castVote, fetchContractInfo, fetchProposals, notify]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cardFromUrl = params.get("cardId");
    if (!cardFromUrl) return;

    setSelectedCardId(cardFromUrl);
    simulateTapForCard(cardFromUrl);
  }, [simulateTapForCard]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Off-Grid DAO</p>
          <h1>Community Voting Console</h1>
        </div>
        <div className={`status ${connected ? "online" : "offline"}`}>
          <span className="dot" />
          <span>{connected ? "Socket Connected" : "Socket Disconnected"}</span>
        </div>
      </header>

      <section className="stats-grid">
        <article>
          <p>Active Proposals</p>
          <strong>{activeProposals}</strong>
        </article>
        <article>
          <p>Total Votes</p>
          <strong>{totalVotes}</strong>
        </article>
        <article>
          <p>Live Feed Items</p>
          <strong>{transactions.length}</strong>
        </article>
        <article>
          <p>Contract</p>
          <strong>
            {contractInfo?.contractAddress
              ? `${contractInfo.contractAddress.slice(0, 10)}...`
              : "Waiting..."}
          </strong>
        </article>
      </section>

      <main className="content-grid">
        <section className="panel controls">
          <h2>NFC + Vote Flow</h2>
          <p>
            Pick a proposal, then simulate an NFC tap. The card scan triggers
            backend identity verification and then submits the vote transaction.
          </p>

          <label>
            Card ID
            <select
              value={selectedCardId}
              onChange={(event) => setSelectedCardId(event.target.value)}
            >
              {CARD_OPTIONS.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.label}
                </option>
              ))}
            </select>
          </label>

          <button type="button" onClick={simulateTap} className="primary-btn">
            Simulate NFC Tap
          </button>

          <div className="voter-card">
            <p>Current Voter</p>
            <strong>{currentVoter?.name || "No card scanned yet"}</strong>
            <small>
              {currentVoter?.wallet || "Wallet will appear after scan"}
            </small>
          </div>
        </section>

        <section className="panel proposals">
          <h2>Live Proposals</h2>
          {loading ? <p>Loading proposals...</p> : null}
          <div className="proposal-list">
            {proposals.map((proposal) => (
              <article
                key={proposal.id}
                className="proposal-item clickable"
                onClick={() => setPreviewProposal(proposal)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPreviewProposal(proposal);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <div>
                  <h3>{proposal.title}</h3>
                  <p>{proposal.description || "No description provided."}</p>
                </div>
                <div className="proposal-meta">
                  <span>{proposal.category}</span>
                  <span>{proposal.fundsRequested} tokens</span>
                  <span>{proposal.votes} votes</span>
                </div>
                <button
                  type="button"
                  className={
                    pendingProposal?.id === proposal.id
                      ? "secondary-btn active"
                      : "secondary-btn"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    setPendingProposal(proposal);
                  }}
                >
                  {pendingProposal?.id === proposal.id
                    ? "Awaiting Tap..."
                    : "Select for Vote"}
                </button>
              </article>
            ))}
          </div>
        </section>

        <section className="panel create">
          <h2>Create Proposal</h2>
          <form onSubmit={createProposal} className="create-form">
            <label>
              Title
              <input
                type="text"
                value={form.title}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, title: event.target.value }))
                }
                placeholder="Community solar lighting"
              />
            </label>
            <label>
              Description
              <textarea
                rows="3"
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    description: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Category
              <select
                value={form.category}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, category: event.target.value }))
                }
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
              Tokens Requested
              <input
                type="number"
                min="1"
                value={form.fundsRequested}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    fundsRequested: event.target.value,
                  }))
                }
                placeholder="50000"
              />
            </label>
            <button type="submit" className="primary-btn" disabled={creating}>
              {creating ? "Submitting..." : "Deploy Proposal"}
            </button>
          </form>
        </section>

        <section className="panel feed">
          <h2>Transaction Feed</h2>
          <div className="feed-list">
            {transactions.length === 0 ? <p>No transactions yet.</p> : null}
            {transactions.map((tx) => (
              <div key={`${tx.hash}-${tx.id}`} className="feed-row">
                <strong>{tx.type}</strong>
                <span>{tx.hash}</span>
                <small>{new Date(tx.timestamp).toLocaleTimeString()}</small>
              </div>
            ))}
          </div>
        </section>
      </main>

      <ProposalPreviewModal
        isOpen={Boolean(previewProposal)}
        proposal={previewProposal}
        onClose={() => setPreviewProposal(null)}
        onSummarize={() => summarizeProposalProblem(previewProposal)}
        onRefreshSummary={() =>
          summarizeProposalProblem(previewProposal, { forceRefresh: true })
        }
        summaryState={
          previewProposal ? summaryByProposalId[previewProposal.id] : null
        }
        isLoading={summaryLoadingProposalId === previewProposal?.id}
      />

      {pinModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content pin-modal">
            <h2>Vault Locked</h2>
            <p className="pin-description">
              Please enter your 4-digit PIN to decrypt your wallet and authorize this transaction.
            </p>
            <form onSubmit={handlePinSubmit} className="pin-form">
              <input
                type="password"
                maxLength="4"
                className="pin-input"
                placeholder="****"
                value={pinValue}
                onChange={(e) => { setPinValue(e.target.value); setPinError(""); }}
                autoFocus
              />
              {pinError ? <p className="error-text">{pinError}</p> : null}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={handlePinCancel}>
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Unlock & Vote
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {toast ? <div className="toast">{toast}</div> : null}

      <footer className="footer-note">
        <p>
          Selected Proposal:{" "}
          <strong>{pendingProposal?.title || "None selected"}</strong>
        </p>
      </footer>
    </div>
  );
}

export default App;
