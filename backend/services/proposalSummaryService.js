const { Ollama } = require("ollama");

// ─────────────────────────────────────────────
//  FEATHERLESS AI CONFIG (OpenAI-compatible)
// ─────────────────────────────────────────────
const FEATHERLESS_API_KEY = process.env.FEATHERLESS_API_KEY || "";
const FEATHERLESS_BASE_URL =
  process.env.FEATHERLESS_BASE_URL || "https://api.featherless.ai/v1";
const FEATHERLESS_MODEL =
  process.env.FEATHERLESS_MODEL || "meta-llama/Llama-3.2-3B-Instruct";

// ─────────────────────────────────────────────
//  OLLAMA CONFIG (legacy, used for summaries)
// ─────────────────────────────────────────────
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "https://ollama.com";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:120b";

const ollama = new Ollama({
  host: OLLAMA_HOST,
  ...(OLLAMA_API_KEY
    ? { headers: { Authorization: `Bearer ${OLLAMA_API_KEY}` } }
    : {}),
});

// ─────────────────────────────────────────────
//  VALID CATEGORIES
// ─────────────────────────────────────────────
const VALID_CATEGORIES = [
  "General",
  "Infrastructure",
  "Energy",
  "Digital",
  "Education",
  "Health",
];

// ─────────────────────────────────────────────
//  PROPOSAL GENERATION (Featherless AI)
// ─────────────────────────────────────────────

function buildGeneratePrompt(userText) {
  return [
    "You are a civic governance assistant that converts informal descriptions into structured DAO proposals.",
    "",
    "Given the user's plain-language description below, extract or generate:",
    '1. "title" — A clear, concise proposal title (max 10 words)',
    '2. "description" — A formal 2-3 sentence description of the problem and proposed solution',
    `3. "category" — One of: ${VALID_CATEGORIES.join(", ")}`,
    "",
    "IMPORTANT: Respond with ONLY valid JSON, no markdown, no code fences, no explanation.",
    'Format: {"title": "...", "description": "...", "category": "..."}',
    "",
    "User's description:",
    userText,
  ].join("\n");
}

async function generateProposalFromDescription(userText) {
  if (!FEATHERLESS_API_KEY) {
    throw new Error(
      "FEATHERLESS_API_KEY is required. Set it in backend/.env to enable AI proposal generation.",
    );
  }

  const response = await fetch(
    `${FEATHERLESS_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FEATHERLESS_API_KEY}`,
      },
      body: JSON.stringify({
        model: FEATHERLESS_MODEL,
        messages: [
          { role: "user", content: buildGeneratePrompt(userText) },
        ],
        temperature: 0.4,
        max_tokens: 400,
      }),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    console.error(
      `Featherless API error ${response.status}: ${errorBody}`,
    );
    throw new Error(
      `AI service returned ${response.status}. Check your FEATHERLESS_API_KEY.`,
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "";

  // Parse JSON from response — handle models that wrap in code fences
  // or append extra text after the JSON object.
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Extract first JSON object by finding matching braces
  let parsed;
  const jsonStart = cleaned.indexOf("{");
  if (jsonStart !== -1) {
    let depth = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
    if (jsonEnd > jsonStart) {
      try {
        parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd));
      } catch (_e) {
        // fall through to error
      }
    }
  }

  if (!parsed) {
    console.error("Failed to parse AI response as JSON:", cleaned.slice(0, 500));
    throw new Error(
      "AI returned an unexpected format. Please try again or rephrase your description.",
    );
  }

  // Validate and sanitize
  const title =
    typeof parsed.title === "string" ? parsed.title.trim() : "";
  const description =
    typeof parsed.description === "string"
      ? parsed.description.trim()
      : "";
  const rawCategory =
    typeof parsed.category === "string" ? parsed.category.trim() : "";

  // Match category case-insensitively
  const category =
    VALID_CATEGORIES.find(
      (c) => c.toLowerCase() === rawCategory.toLowerCase(),
    ) || "General";

  if (!title) {
    throw new Error(
      "AI could not generate a title. Please provide more detail in your description.",
    );
  }

  return {
    title,
    description,
    category,
    model: FEATHERLESS_MODEL,
  };
}

// ─────────────────────────────────────────────
//  PROPOSAL SUMMARY (Ollama — existing)
// ─────────────────────────────────────────────

function buildSummaryPrompt(title, description) {
  return [
    "You are a civic governance assistant.",
    "Task: Summarize the core problem from the proposal in very simple language.",
    "Output rules:",
    "- Return only 1 or 2 short sentences.",
    "- Keep it concise and plain.",
    "- Do not include headings, bullets, or extra explanation.",
    "",
    `Proposal Title: ${title}`,
    "",
    "Proposal Description:",
    description || "No description provided.",
  ].join("\n");
}

async function summarizeProposalProblem({ title, description }) {
  if (!OLLAMA_API_KEY && OLLAMA_HOST.includes("ollama.com")) {
    throw new Error(
      "OLLAMA_API_KEY is required to use the Ollama cloud summary endpoint",
    );
  }

  const prompt = buildSummaryPrompt(title, description);

  const response = await ollama.chat({
    model: OLLAMA_MODEL,
    messages: [{ role: "user", content: prompt }],
    stream: true,
  });

  let summary = "";
  for await (const part of response) {
    summary += part?.message?.content || "";
  }

  summary = summary.trim();
  if (!summary) {
    throw new Error("Model returned an empty summary");
  }

  return summary;
}

module.exports = {
  summarizeProposalProblem,
  generateProposalFromDescription,
  OLLAMA_MODEL,
  FEATHERLESS_MODEL,
};
