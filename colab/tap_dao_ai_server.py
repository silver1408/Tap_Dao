"""
╔══════════════════════════════════════════════════════════════╗
║         TAP DAO — Free AI Inference Server (Colab)           ║
║                                                              ║
║  Paste this entire file into a Google Colab cell and run.   ║
║  Model: Qwen/Qwen2.5-0.5B-Instruct (chat model, free)       ║
║                                                              ║
║  USAGE IN COLAB:                                             ║
║  Step 1: Runtime → Change runtime type → T4 GPU             ║
║  Step 2: Paste this file into a code cell and run it.       ║
║  Step 3: Enter your ngrok auth token when prompted.          ║
║          (Free account at https://ngrok.com)                 ║
║          Press Enter to skip → uses localtunnel instead.     ║
║  Step 4: Copy the PUBLIC URL into backend/.env:              ║
║            COLAB_AI_URL=https://xxxx.ngrok-free.app          ║
║  Step 5: Restart your Node backend. Done!                    ║
╚══════════════════════════════════════════════════════════════╝
"""

# ── 1. INSTALL DEPENDENCIES ──────────────────────────────────────────────────
import subprocess, sys

def pip(*args):
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *args])

pip("fastapi", "uvicorn[standard]", "transformers", "torch", "accelerate", "pyngrok")

# ── 2. LOAD MODEL ────────────────────────────────────────────────────────────
import re, json, threading, time
import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from transformers import AutoTokenizer, AutoModelForCausalLM

# ✅ Qwen2.5-0.5B-Instruct: tiny chat model, excellent instruction following,
#    generates clean JSON, runs in <2 GB VRAM on Colab free T4.
MODEL_NAME = "Qwen/Qwen2.5-0.5B-Instruct"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

print(f"⏳ Loading {MODEL_NAME} on {DEVICE.upper()}…")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForCausalLM.from_pretrained(
    MODEL_NAME,
    torch_dtype=torch.float16 if DEVICE == "cuda" else torch.float32,
    device_map="auto",
)
model.eval()
print(f"✅ Model ready: {MODEL_NAME} on {DEVICE.upper()}")

VALID_CATEGORIES = ["General", "Infrastructure", "Energy", "Digital", "Education", "Health"]

# ── 3. INFERENCE HELPER ───────────────────────────────────────────────────────

def chat(system_prompt: str, user_prompt: str, max_new_tokens: int = 300) -> str:
    """Run a single chat-style inference using the model's chat template."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": user_prompt},
    ]
    text = tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True,
    )
    inputs = tokenizer([text], return_tensors="pt").to(DEVICE)

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            temperature=0.4,
            do_sample=True,
            top_p=0.9,
            pad_token_id=tokenizer.eos_token_id,
        )
    # Slice off the input tokens — keep only newly generated tokens
    generated = output_ids[0][inputs["input_ids"].shape[1]:]
    return tokenizer.decode(generated, skip_special_tokens=True).strip()


def extract_json(text: str) -> dict:
    """Pull the first valid JSON object out of a string."""
    # Strip markdown code fences
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found")
    depth, end = 0, -1
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end == -1:
        raise ValueError("Unclosed JSON object")
    return json.loads(text[start:end])

# ── 4. PROMPT BUILDERS & GENERATE LOGIC ──────────────────────────────────────
#
#  Strategy: ask 3 simple, focused questions instead of one big JSON prompt.
#  Small models answer simple questions reliably; they struggle with structured
#  output formats. We assemble the JSON ourselves from 3 plain-text answers.
# ─────────────────────────────────────────────────────────────────────────────

def generate_field(system: str, user: str, max_tokens: int = 80) -> str:
    return chat(system, user, max_new_tokens=max_tokens).strip()


def build_title(user_text: str) -> str:
    return generate_field(
        "You are a civic governance assistant. Reply with ONLY the answer, nothing else.",
        f'Write a formal civic proposal title (maximum 10 words) for this problem: "{user_text}"\nTitle:',
        max_tokens=40,
    )

def build_description(user_text: str, title: str) -> str:
    return generate_field(
        "You are a civic governance assistant. Reply with ONLY the answer, nothing else.",
        f'Write 2-3 formal sentences for a civic proposal about "{title}". '
        f'Describe the problem and proposed solution based on: "{user_text}"\nDescription:',
        max_tokens=180,
    )

def build_category(user_text: str) -> str:
    cats = ", ".join(VALID_CATEGORIES)
    return generate_field(
        "You are a civic governance assistant. Reply with ONLY one word from the list.",
        f'Choose the best category for this civic issue: "{user_text}"\n'
        f'Options: {cats}\nCategory:',
        max_tokens=10,
    )

SUMMARIZE_SYSTEM = """You are a civic governance assistant.
Summarize the core problem of the given proposal in 1 to 2 plain, simple sentences.
Do NOT use bullet points, headings, or any formatting — just the sentences."""

SUMMARIZE_USER = """Proposal Title: {title}

Proposal Description:
{description}

Write a 1-2 sentence plain summary of the core problem:"""

# ── 5. FASTAPI APP ────────────────────────────────────────────────────────────

app = FastAPI(title="TapDAO AI Server", version="2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class GenerateRequest(BaseModel):
    text: str


class SummarizeRequest(BaseModel):
    title: str
    description: str = ""


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/generate")
def generate_proposal(req: GenerateRequest):
    user_text = req.text.strip()
    if not user_text:
        raise HTTPException(400, "text field is required")

    print(f"[generate] input: {user_text[:100]}")

    # Ask 3 simple questions — far more reliable than one JSON prompt
    title       = build_title(user_text)
    description = build_description(user_text, title)
    raw_cat     = build_category(user_text)

    print(f"[generate] title={title!r}  cat={raw_cat!r}")
    print(f"[generate] desc={description[:120]!r}")

    # Clean up any leading label the model may have echoed (e.g. "Title: ...")
    for label in ("title:", "description:", "category:"):
        if title.lower().startswith(label):
            title = title[len(label):].strip()
        if description.lower().startswith(label):
            description = description[len(label):].strip()

    # Strip wrapping quotes the model sometimes adds: "Street Light Fix" → Street Light Fix
    title       = title.strip('"\'')
    description = description.strip('"\'')

    title       = title[:120]
    description = description[:600]
    category    = next(
        (c for c in VALID_CATEGORIES if c.lower() in raw_cat.lower()),
        "General",
    )

    if not title:
        raise HTTPException(502, "Model could not generate a title. Try adding more detail.")

    return {"title": title, "description": description, "category": category, "model": MODEL_NAME}


@app.post("/summarize")
def summarize_proposal(req: SummarizeRequest):
    if not req.title.strip():
        raise HTTPException(400, "title field is required")

    summary = chat(
        SUMMARIZE_SYSTEM,
        SUMMARIZE_USER.format(title=req.title, description=req.description or "Not provided."),
        max_new_tokens=120,
    )
    print(f"[summarize] → {summary[:200]}")

    if not summary:
        raise HTTPException(502, "Model returned an empty summary. Try again.")

    return {"summary": summary, "model": MODEL_NAME}


# ── 6. START SERVER ───────────────────────────────────────────────────────────

PORT = 8765

def start_server():
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")

server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()
time.sleep(2)

# ── 7. TUNNEL ─────────────────────────────────────────────────────────────────
public_url = None

try:
    from pyngrok import ngrok, conf

    ngrok_token = input(
        "\n🔑 Enter your ngrok auth token (or press Enter to skip → uses localtunnel):\n> "
    ).strip()

    if ngrok_token:
        conf.get_default().auth_token = ngrok_token
        tunnel = ngrok.connect(PORT, "http")
        public_url = tunnel.public_url
    else:
        raise ValueError("Skipping ngrok")

except Exception as e:
    print(f"\nngrok skipped ({e}). Trying localtunnel…")
    try:
        subprocess.Popen(
            ["npm", "install", "-g", "localtunnel"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        ).wait()
        lt_proc = subprocess.Popen(
            ["lt", "--port", str(PORT)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
        )
        for line in lt_proc.stdout:
            if "your url is" in line.lower():
                public_url = line.strip().split()[-1]
                break
    except Exception as lt_err:
        print(f"localtunnel also failed: {lt_err}")

if public_url:
    print("\n" + "═" * 62)
    print("   🤖  TAP DAO AI SERVER IS LIVE")
    print("═" * 62)
    print(f"\n   Public URL : {public_url}")
    print(f"\n   ➜ Paste into backend/.env :")
    print(f"\n     COLAB_AI_URL={public_url}\n")
    print("   Then restart your Node backend.")
    print("\n   Endpoints:")
    print(f"     GET  {public_url}/health")
    print(f"     POST {public_url}/generate    {{ \"text\": \"...\" }}")
    print(f"     POST {public_url}/summarize   {{ \"title\": \"...\", \"description\": \"...\" }}")
    print("═" * 62)
    print("\n⚠️  Keep this Colab tab open while using the DAO app.\n")
else:
    print(f"\n❌ No public tunnel. Server is on local port {PORT}.")
    print("   Use Colab's port forwarding from the sidebar instead.")
