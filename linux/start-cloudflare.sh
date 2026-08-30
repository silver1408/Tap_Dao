#!/usr/bin/env bash
# ============================================================
#  Tap DAO — Cloudflare Deployment Startup (Linux / Ubuntu)
#  Starts the full stack and exposes backend + frontend
#  publicly via Cloudflare Tunnel (trycloudflare.com)
#
#  Usage:  chmod +x start-cloudflare.sh && ./start-cloudflare.sh
# ============================================================

set -e

# ── Resolve paths relative to this script ───────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$SCRIPT_DIR/.."
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

echo ""
echo "============================================"
echo "  Tap DAO - Cloudflare Deployment Startup"
echo "============================================"
echo "  Starting full stack + Cloudflare Tunnels"
echo "============================================"
echo ""

# ── Helper: kill anything on a port ─────────────────────────
kill_port() {
  local port=$1
  local pid
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  Clearing port $port (PID $pid)..."
    kill -9 "$pid" 2>/dev/null || true
  fi
}

# ── Ensure ports are free before starting ───────────────────
echo "Clearing any leftover processes on required ports..."
kill_port 8545
kill_port 3001
kill_port 5173
kill_port 4000
sleep 1

# ── Step 1: Start Hardhat blockchain node ───────────────────
echo "[1/7] Starting local blockchain (Hardhat)..."
nohup bash -c "cd '$ROOT/backend' && npx hardhat node" \
  > "$LOG_DIR/hardhat.log" 2>&1 &
echo $! > "$LOG_DIR/hardhat.pid"
echo "      PID $(cat "$LOG_DIR/hardhat.pid") — log: linux/logs/hardhat.log"
echo "      Waiting 10 seconds for blockchain to boot..."
sleep 10

# ── Step 2: Deploy smart contract ───────────────────────────
echo "[2/7] Deploying smart contract..."
cd "$ROOT/backend"
npx hardhat compile > /dev/null 2>&1
npx hardhat run scripts/deploy.js --network localhost
echo ""

# ── Step 3: Start backend server ────────────────────────────
echo "[3/7] Starting backend server (port 3001)..."
nohup bash -c "cd '$ROOT/backend' && node server.js" \
  > "$LOG_DIR/backend.log" 2>&1 &
echo $! > "$LOG_DIR/backend.pid"
echo "      PID $(cat "$LOG_DIR/backend.pid") — log: linux/logs/backend.log"
sleep 3

# ── Step 4: Start frontend ───────────────────────────────────
echo "[4/7] Starting frontend (port 5173)..."
nohup bash -c "cd '$ROOT/frontend' && npx vite --host 0.0.0.0 --port 5173" \
  > "$LOG_DIR/frontend.log" 2>&1 &
echo $! > "$LOG_DIR/frontend.pid"
echo "      PID $(cat "$LOG_DIR/frontend.pid") — log: linux/logs/frontend.log"
sleep 3

# ── Step 5: Start Apple Watch UI ────────────────────────────
echo "[5/7] Starting Apple Watch UI (port 4000)..."
nohup bash -c "cd '$ROOT/frontend-watch' && node server.js" \
  > "$LOG_DIR/watch.log" 2>&1 &
echo $! > "$LOG_DIR/watch.pid"
echo "      PID $(cat "$LOG_DIR/watch.pid") — log: linux/logs/watch.log"
sleep 2

# ── Step 6: Cloudflare Tunnel → Backend ─────────────────────
echo "[6/7] Starting Cloudflare Tunnel for Backend (port 3001)..."
rm -f "$LOG_DIR/cf-backend.log"
nohup cloudflared tunnel --url http://localhost:3001 \
  > "$LOG_DIR/cf-backend.log" 2>&1 &
echo $! > "$LOG_DIR/cf-backend.pid"
echo "      PID $(cat "$LOG_DIR/cf-backend.pid") — log: linux/logs/cf-backend.log"
sleep 6

# ── Step 7: Cloudflare Tunnel → Frontend ────────────────────
echo "[7/7] Starting Cloudflare Tunnel for Frontend (port 5173)..."
rm -f "$LOG_DIR/cf-frontend.log"
nohup cloudflared tunnel --url http://localhost:5173 \
  > "$LOG_DIR/cf-frontend.log" 2>&1 &
echo $! > "$LOG_DIR/cf-frontend.pid"
echo "      PID $(cat "$LOG_DIR/cf-frontend.pid") — log: linux/logs/cf-frontend.log"

echo ""
echo "Waiting for Cloudflare tunnels to register (~10s)..."
sleep 10

# ── Extract and print public URLs ───────────────────────────
BACKEND_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_DIR/cf-backend.log" 2>/dev/null | tail -1 || true)
FRONTEND_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_DIR/cf-frontend.log" 2>/dev/null | tail -1 || true)

echo ""
echo "============================================"
echo "  All services started!"
echo ""
echo "  LOCAL URLS"
echo "  ----------"
echo "  Frontend:    http://localhost:5173"
echo "  Watch UI:    http://localhost:4000"
echo "  Backend:     http://localhost:3001"
echo "  Blockchain:  http://localhost:8545"
echo ""
echo "  CLOUDFLARE PUBLIC URLS"
echo "  ----------------------"
if [ -n "$BACKEND_URL" ]; then
  echo "  Backend:     $BACKEND_URL"
else
  echo "  Backend:     (still starting — run ./show-urls.sh)"
fi
if [ -n "$FRONTEND_URL" ]; then
  echo "  Frontend:    $FRONTEND_URL"
else
  echo "  Frontend:    (still starting — run ./show-urls.sh)"
fi
echo ""
echo "  Tip: run  linux/show-urls.sh  to print URLs anytime."
echo "  Tip: run  linux/stop-cloudflare.sh  to shut down."
echo "============================================"
echo ""
echo "Done."
