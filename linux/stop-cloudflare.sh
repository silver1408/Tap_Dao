#!/usr/bin/env bash
# ============================================================
#  Tap DAO — Cloudflare Stack Shutdown (Linux / Ubuntu)
#  Stops all services started by start-cloudflare.sh
#
#  Usage:  ./stop-cloudflare.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

echo ""
echo "============================================"
echo "  Tap DAO - Stopping Cloudflare Stack"
echo "============================================"
echo ""

# ── Helper: stop process by PID file ────────────────────────
stop_pid() {
  local name=$1
  local pidfile="$LOG_DIR/$2.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid=$(cat "$pidfile")
    if kill -0 "$pid" 2>/dev/null; then
      echo "  Stopping $name (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      # Force kill if still running
      kill -9 "$pid" 2>/dev/null || true
    else
      echo "  $name already stopped."
    fi
    rm -f "$pidfile"
  else
    echo "  No PID file for $name — skipping."
  fi
}

# ── Stop all services in reverse order ──────────────────────
stop_pid "Cloudflare Tunnel (frontend)" "cf-frontend"
stop_pid "Cloudflare Tunnel (backend)"  "cf-backend"
stop_pid "Apple Watch UI"               "watch"
stop_pid "Frontend (Vite)"              "frontend"
stop_pid "Backend (Node.js)"            "backend"
stop_pid "Hardhat Node"                 "hardhat"

# ── Also kill by port just in case ──────────────────────────
echo ""
echo "Releasing ports (in case any process is still holding them)..."
for port in 8545 3001 5173 4000; do
  pid=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    echo "  Killing process on port $port (PID $pid)..."
    kill -9 "$pid" 2>/dev/null || true
  fi
done

# ── Kill any remaining cloudflared processes ─────────────────
echo ""
if pgrep -x cloudflared > /dev/null 2>&1; then
  echo "Stopping remaining cloudflared processes..."
  pkill -x cloudflared 2>/dev/null || true
fi

echo ""
echo "All Cloudflare services stopped."
echo "Done."
