const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = 1;
const MAX_TRANSACTIONS = Number(process.env.MAX_FEED_ENTRIES || 200);
const WRITE_DEBOUNCE_MS = Number(process.env.STORE_WRITE_DEBOUNCE_MS || 150);

function defaultDataDir() {
  return (
    process.env.DATA_DIR || path.join(__dirname, "..", "runtime")
  );
}

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    voters: {},
    proposals: {},
    proposalImages: {},
    invites: {},
    transactions: [],
    nextTransactionId: 1,
    sessions: {},
    // Single-use "this kiosk was told about that scan" tokens, keyed by
    // sha256(token) so a stolen state file yields no usable claims.
    claims: {},
    // PIN brute-force counters keyed by cardId so the lockout survives
    // session churn (a card can be re-tapped to force a brand new session).
    pinLocks: {},
  };
}

function createStore(options = {}) {
  const dataDir = options.dataDir || defaultDataDir();
  const file =
    options.file || process.env.STATE_FILE || path.join(dataDir, "dao-state.json");
  const maxTransactions = options.maxTransactions || MAX_TRANSACTIONS;
  const logger = options.logger || console;

  let state = emptyState();
  let writeTimer = null;
  let pendingWrite = false;
  let lastError = null;
  let loaded = false;

  function ensureDir() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  function readStateFromDisk() {
    if (!fs.existsSync(file)) {
      return { state: emptyState(), recovered: false, corrupt: false };
    }
    try {
      const raw = fs.readFileSync(file, "utf8");
      const parsed = JSON.parse(raw);
      const base = emptyState();
      const next = {
        ...base,
        ...parsed,
        voters: { ...base.voters, ...(parsed.voters || {}) },
        proposals: { ...base.proposals, ...(parsed.proposals || {}) },
        proposalImages: { ...base.proposalImages, ...(parsed.proposalImages || {}) },
        invites: { ...base.invites, ...(parsed.invites || {}) },
        sessions: { ...base.sessions, ...(parsed.sessions || {}) },
        claims: { ...base.claims, ...(parsed.claims || {}) },
        pinLocks: { ...base.pinLocks, ...(parsed.pinLocks || {}) },
        transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
        version: SCHEMA_VERSION,
      };
      if (!Number.isInteger(next.nextTransactionId) || next.nextTransactionId < 1) {
        next.nextTransactionId =
          next.transactions.reduce(
            (max, tx) => Math.max(max, Number(tx && tx.id) || 0),
            0,
          ) + 1;
      }
      return { state: next, recovered: false, corrupt: false };
    } catch (error) {
      const backup = `${file}.corrupt-${Date.now()}`;
      try {
        fs.copyFileSync(file, backup);
      } catch (_backupError) {
        /* best effort */
      }
      logger.error(
        `[store] ${file} is unreadable (${error.message}). Moved to ${backup}; starting from an empty state.`,
      );
      return { state: emptyState(), recovered: true, corrupt: true };
    }
  }

  function writeStateToDisk() {
    ensureDir();
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, file);
  }

  function persist() {
    writeTimer = null;
    pendingWrite = false;
    try {
      writeStateToDisk();
      lastError = null;
    } catch (error) {
      lastError = error;
      logger.error(`[store] Failed to persist state: ${error.message}`);
    }
  }

  function schedulePersist() {
    pendingWrite = true;
    if (writeTimer) return;
    writeTimer = setTimeout(persist, WRITE_DEBOUNCE_MS);
    if (writeTimer.unref) writeTimer.unref();
  }

  function load() {
    const result = readStateFromDisk();
    state = result.state;
    loaded = true;
    if (result.recovered) {
      writeStateToDisk();
    }
    return {
      file,
      dataDir,
      recovered: result.recovered,
      voters: Object.keys(state.voters).length,
      sessions: Object.keys(state.sessions).length,
      images: Object.keys(state.proposalImages).length,
    };
  }

  function flush() {
    if (writeTimer) {
      clearTimeout(writeTimer);
      writeTimer = null;
    }
    if (pendingWrite) persist();
  }

  function getState() {
    return state;
  }

  function mutate(mutator) {
    const result = mutator(state);
    schedulePersist();
    return result;
  }

  function pushTransaction(entry) {
    return mutate((current) => {
      const record = {
        id: current.nextTransactionId,
        ...entry,
        type: entry.type,
        hash: entry.hash,
        timestamp: entry.timestamp || new Date().toISOString(),
      };
      current.nextTransactionId = record.id + 1;
      current.transactions.push(record);
      if (current.transactions.length > maxTransactions) {
        current.transactions.splice(0, current.transactions.length - maxTransactions);
      }
      return record;
    });
  }

  return {
    file,
    dataDir,
    load,
    flush,
    getState,
    mutate,
    pushTransaction,
    isLoaded: () => loaded,
    hasPendingWrite: () => pendingWrite,
    getLastError: () => lastError,
    defaultDataDir,
  };
}

function installShutdownFlush(store, logger = console) {
  let done = false;
  const handler = () => {
    if (done) return;
    done = true;
    try {
      store.flush();
    } catch (error) {
      logger.error(`[store] Shutdown flush failed: ${error.message}`);
    }
  };
  process.on("exit", handler);
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  return handler;
}

module.exports = { createStore, installShutdownFlush, SCHEMA_VERSION, defaultDataDir };
