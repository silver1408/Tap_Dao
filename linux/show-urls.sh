#!/usr/bin/env bash
# ============================================================
#  Tap DAO — Show Cloudflare Public URLs (Linux / Ubuntu)
#  Run any time after start-cloudflare.sh to print live URLs
#
#  Usage:  ./show-urls.sh
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$SCRIPT_DIR/logs"

echo ""
echo "============================================"
echo "  Tap DAO - Cloudflare Public URLs"
echo "============================================"
echo ""

# ── Backend URL ──────────────────────────────────────────────
echo "  BACKEND (port 3001):"
if [ -f "$LOG_DIR/cf-backend.log" ]; then
  URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_DIR/cf-backend.log" 2>/dev/null | tail -1)
  if [ -n "$URL" ]; then
    echo "    $URL"
  else
    echo "    (not ready yet — wait a few more seconds and retry)"
  fi
else
  echo "    (log file not found — is the tunnel running?)"
fi

echo ""

# ── Frontend URL ─────────────────────────────────────────────
echo "  FRONTEND (port 5173):"
if [ -f "$LOG_DIR/cf-frontend.log" ]; then
  URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOG_DIR/cf-frontend.log" 2>/dev/null | tail -1)
  if [ -n "$URL" ]; then
    echo "    $URL"
  else
    echo "    (not ready yet — wait a few more seconds and retry)"
  fi
else
  echo "    (log file not found — is the tunnel running?)"
fi

echo ""
echo "============================================"
echo "  Tip: URLs change every time you restart."
echo "  Logs: linux/logs/cf-backend.log"
echo "        linux/logs/cf-frontend.log"
echo "============================================"
echo ""
