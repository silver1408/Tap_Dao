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
//    4. Restart this server.
// ─────────────────────────────────────────────────────────────────────────────

// ── CONFIG ────────────────────────────────────────────────────────────────────
const COLAB_AI_URL = (process.env.COLAB_AI_URL || "").replace(/\/$/, ""); // strip trailing slash

// ── VALID CATEGORIES (must match the smart contract) ─────────────────────────
const VALID_CATEGORIES = [
  "General",
  "Infrastructure",
  "Energy",
  "Digital",
  "Education",
  "Health",
];

// ── INTERNAL: call Colab server with a timeout ────────────────────────────────
async function callColab(endpoint, body) {
  if (!COLAB_AI_URL) {
    throw new Error(
      "COLAB_AI_URL is not set. " +
        "Run colab/tap_dao_ai_server.py on Google Colab, then paste the " +
        "public URL into backend/.env as COLAB_AI_URL=https://xxxx.ngrok-free.app"
    );
  }

  const url = `${COLAB_AI_URL}${endpoint}`;
  const controller = new AbortController();
  // 60 s timeout — Colab on CPU can be slow on first inference (model warm-up)
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Required to bypass ngrok's browser interstitial page
        "ngrok-skip-browser-warning": "true",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(
        "Colab AI server timed out (60 s). " +
          "Make sure the Colab notebook is still running and the tunnel is active."
      );
    }
    throw new Error(
      `Cannot reach Colab AI server at ${COLAB_AI_URL}. ` +
        "Check that the Colab notebook is still running."
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Colab AI server returned HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  return response.json();
}

// ── PUBLIC: Generate a structured proposal from plain-text description ─────────
async function generateProposalFromDescription(userText) {
  const data = await callColab("/generate", { text: userText });

  // Validate & sanitise
  const title = typeof data.title === "string" ? data.title.trim() : "";
  const description =
    typeof data.description === "string" ? data.description.trim() : "";
  const rawCategory =
    typeof data.category === "string" ? data.category.trim() : "";

  const category =
    VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === rawCategory.toLowerCase()
    ) || "General";

  if (!title) {
    throw new Error(
      "AI could not generate a title. Please provide more detail in your description."
    );
  }

  return {
    title,
    description,
    category,
    model: data.model || "colab-flan-t5-large",
  };
}

// ── PUBLIC: Summarise the problem a proposal is trying to solve ───────────────
async function summarizeProposalProblem({ title, description }) {
  const data = await callColab("/summarize", {
    title,
    description: description || "",
  });

  const summary = typeof data.summary === "string" ? data.summary.trim() : "";
  if (!summary) {
    throw new Error("Colab model returned an empty summary. Try again.");
  }

  return summary;
}

// ── EXPORTS ───────────────────────────────────────────────────────────────────
// Keep the same shape as before so server.js doesn't need to change.
module.exports = {
  summarizeProposalProblem,
  generateProposalFromDescription,
  // Legacy named exports (server.js references these in its startup log)
  OLLAMA_MODEL: "colab-flan-t5-large",
  FEATHERLESS_MODEL: "colab-flan-t5-large",
};
