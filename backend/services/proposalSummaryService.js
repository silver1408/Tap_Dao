// ─────────────────────────────────────────────────────────────────────────────
//  proposalSummaryService.js
//
//  AI backend for proposal generation & summarisation.
//  Uses a free model running on Google Colab instead of paid APIs.
//
//  HOW TO SET UP:
//    1. Open colab/tap_dao_ai_server.py in Google Colab and run it.
//    2. Copy the printed public URL (e.g. https://xxxx.ngrok-free.app).
//    3. Add it to backend/.env:
//         COLAB_AI_URL=https://xxxx.ngrok-free.app
//    4. Restart this server. GET /ai/status confirms the wiring.
//
//  All provider calls stay server-side: the browser only ever talks to this
//  API, never to the AI provider directly.
// ─────────────────────────────────────────────────────────────────────────────

const COLAB_AI_URL = (process.env.COLAB_AI_URL || "").trim().replace(/\/+$/, "");
const DEFAULT_MODEL_LABEL = "colab-qwen2.5-0.5b-instruct";
const MODEL_NAME = process.env.AI_MODEL_LABEL || DEFAULT_MODEL_LABEL;
const GENERATE_TIMEOUT_MS = Number(process.env.AI_GENERATE_TIMEOUT_MS || 90_000);
const SUMMARIZE_TIMEOUT_MS = Number(process.env.AI_SUMMARIZE_TIMEOUT_MS || 60_000);
const HEALTH_TIMEOUT_MS = Number(process.env.AI_HEALTH_TIMEOUT_MS || 8_000);
const MAX_TEXT_LENGTH = 2000;
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_SUMMARY_LENGTH = 1000;

const VALID_CATEGORIES = [
  "General",
  "Infrastructure",
  "Energy",
  "Digital",
  "Education",
  "Health",
];

class AiServiceError extends Error {
  constructor(code, message, { status = 502, cause } = {}) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function aiConfig() {
  return {
    provider: "colab",
    model: MODEL_NAME,
    configured: Boolean(COLAB_AI_URL),
    generateTimeoutMs: GENERATE_TIMEOUT_MS,
    summarizeTimeoutMs: SUMMARIZE_TIMEOUT_MS,
  };
}

function requireConfigured() {
  if (COLAB_AI_URL) return;
  throw new AiServiceError(
    "AI_NOT_CONFIGURED",
    "AI provider is not configured. Run colab/tap_dao_ai_server.py in Google Colab and set COLAB_AI_URL=https://xxxx.ngrok-free.app in backend/.env, then restart the backend.",
    { status: 503 },
  );
}

async function callColab(endpoint, body, timeoutMs) {
  requireConfigured();

  const url = `${COLAB_AI_URL}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "ngrok-skip-browser-warning": "true",
        "User-Agent": "tap-dao-backend/1.0",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      throw new AiServiceError(
        "AI_TIMEOUT",
        `AI provider did not answer within ${Math.round(timeoutMs / 1000)}s. The Colab runtime may be waking up, idle, or overloaded — retry in a moment.`,
        { status: 504, cause: err },
      );
    }
    throw new AiServiceError(
      "AI_UNREACHABLE",
      `Cannot reach the AI provider. Check that the Colab notebook is still running and that COLAB_AI_URL is correct.`,
      { status: 502, cause: err },
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    throw new AiServiceError(
      "AI_UPSTREAM_ERROR",
      `AI provider returned HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      { status: response.status === 404 ? 502 : response.status >= 500 ? 502 : response.status },
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_error) {
    throw new AiServiceError(
      "AI_INVALID_RESPONSE",
      text.trim().startsWith("<")
        ? "AI provider returned HTML instead of JSON (tunnel interstitial). Re-run the Colab cell and make sure the tunnel URL is the API root."
        : "AI provider returned a response that is not valid JSON.",
      { status: 502 },
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiServiceError("AI_INVALID_RESPONSE", "AI provider returned an unexpected payload shape.", {
      status: 502,
    });
  }
  return parsed;
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/```[a-z]*\s*/gi, " ")
    .replace(/```/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseCategory(value) {
  const raw = cleanText(value);
  if (!raw) return "General";
  const exact = VALID_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const partial = VALID_CATEGORIES.find((c) => raw.toLowerCase().includes(c.toLowerCase()));
  return partial || "General";
}

async function generateProposalFromDescription(userText) {
  const text = cleanText(userText).slice(0, MAX_TEXT_LENGTH);
  if (!text) {
    throw new AiServiceError("AI_INVALID_INPUT", "Please describe your proposal idea.", {
      status: 400,
    });
  }

  const data = await callColab("/generate", { text }, GENERATE_TIMEOUT_MS);
  const title = cleanText(data.title).slice(0, MAX_TITLE_LENGTH);
  const description = cleanText(data.description).slice(0, MAX_DESCRIPTION_LENGTH);
  const category = normaliseCategory(data.category);

  if (!title) {
    throw new AiServiceError(
      "AI_EMPTY_RESULT",
      "The model did not return a usable title. Add more detail to your description and try again.",
      { status: 502 },
    );
  }

  return {
    title,
    description,
    category,
    model: typeof data.model === "string" && data.model ? data.model : MODEL_NAME,
  };
}

async function summarizeProposalProblem({ title, description }) {
  const cleanTitle = cleanText(title).slice(0, MAX_TITLE_LENGTH);
  const cleanDescription = cleanText(description).slice(0, MAX_DESCRIPTION_LENGTH);
  if (!cleanTitle) {
    throw new AiServiceError("AI_INVALID_INPUT", "Proposal title is required.", { status: 400 });
  }

  const data = await callColab(
    "/summarize",
    { title: cleanTitle, description: cleanDescription },
    SUMMARIZE_TIMEOUT_MS,
  );
  const summary = cleanText(data.summary).slice(0, MAX_SUMMARY_LENGTH);
  if (!summary) {
    throw new AiServiceError(
      "AI_EMPTY_RESULT",
      "The model returned an empty summary. Try again with a more specific title.",
      { status: 502 },
    );
  }
  return { summary, model: typeof data.model === "string" && data.model ? data.model : MODEL_NAME };
}

async function checkAiHealth() {
  const config = aiConfig();
  if (!config.configured) {
    return { ...config, reachable: false, detail: "COLAB_AI_URL is not set" };
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${COLAB_AI_URL}/health`, {
      method: "GET",
      headers: { Accept: "application/json", "ngrok-skip-browser-warning": "true" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ...config, reachable: false, detail: `provider returned HTTP ${response.status}` };
    }
    const payload = await response.json().catch(() => ({}));
    return {
      ...config,
      reachable: true,
      detail: "ok",
      providerModel: typeof payload.model === "string" ? payload.model : null,
    };
  } catch (error) {
    return {
      ...config,
      reachable: false,
      detail:
        error.name === "AbortError"
          ? `no response within ${Math.round(HEALTH_TIMEOUT_MS / 1000)}s`
          : "provider unreachable",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  summarizeProposalProblem,
  generateProposalFromDescription,
  checkAiHealth,
  aiConfig,
  AiServiceError,
  VALID_CATEGORIES,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  OLLAMA_MODEL: MODEL_NAME,
  FEATHERLESS_MODEL: MODEL_NAME,
};
