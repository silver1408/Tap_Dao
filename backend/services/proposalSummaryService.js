const { Ollama } = require("ollama");

const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_HOST = process.env.OLLAMA_HOST || "https://ollama.com";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gpt-oss:120b";

const ollama = new Ollama({
  host: OLLAMA_HOST,
  ...(OLLAMA_API_KEY
    ? { headers: { Authorization: `Bearer ${OLLAMA_API_KEY}` } }
    : {}),
});

function buildPrompt(title, description) {
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

  const prompt = buildPrompt(title, description);

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
  OLLAMA_MODEL,
};
