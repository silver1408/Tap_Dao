# Linux / Ubuntu Deployment Scripts

These scripts are the **Linux/Ubuntu equivalent** of the `cloudflare/` Windows `.bat` files.
They start the full Tap DAO stack and expose it publicly via [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare/).

---

## Prerequisites

Install the following on Ubuntu before running:

```bash
# Node.js (v18+)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# cloudflared
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb

# lsof (usually pre-installed)
sudo apt-get install -y lsof
```

---

## Files

| File | Purpose |
|---|---|
| `start-cloudflare.sh` | Starts everything + opens two Cloudflare tunnels |
| `stop-cloudflare.sh` | Stops all services cleanly via PID files |
| `show-urls.sh` | Prints the live public Cloudflare URLs |
| `logs/` | Auto-created directory — all service logs go here |

---

## Usage

```bash
# 1. Make scripts executable (first time only)
chmod +x linux/*.sh

# 2. Start the full stack
./linux/start-cloudflare.sh

# 3. Print public URLs (run from project root or linux/ folder)
./linux/show-urls.sh

# 4. Shut everything down
./linux/stop-cloudflare.sh
```

---

## What it starts

| Service | Port | Log file | Exposed publicly? |
|---|---|---|---|
| Hardhat blockchain | 8545 | `logs/hardhat.log` | No |
| Backend (Node.js) | 3001 | `logs/backend.log` | ✅ Yes |
| Frontend (Vite) | 5173 | `logs/frontend.log` | ✅ Yes |
| Apple Watch UI | 4000 | `logs/watch.log` | No |
| CF Tunnel (backend) | — | `logs/cf-backend.log` | — |
| CF Tunnel (frontend) | — | `logs/cf-frontend.log` | — |

---

## Differences from Windows `.bat` files

| Windows (`cloudflare/`) | Linux (`linux/`) |
|---|---|
| Opens separate CMD windows | Runs services as background processes (`nohup &`) |
| PID tracking via window titles | PID tracking via `logs/*.pid` files |
| `taskkill /FI WINDOWTITLE` | `kill` via PID files + `lsof -ti:PORT` |
| `ping 127.0.0.1 -n X` for delays | `sleep X` |
| `%~dp0` for script path | `$(dirname "${BASH_SOURCE[0]}")` |

---

## Notes

- **URLs are ephemeral** — they change every restart. No uptime guarantee on free quick tunnels.
- For stable public URLs, set up a named tunnel at [dash.cloudflare.com](https://dash.cloudflare.com).
- All output is logged to `linux/logs/` — tail any log with `tail -f linux/logs/backend.log`.
