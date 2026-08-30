# Cloudflare Deployment Scripts

These scripts start the **full Tap DAO stack** and expose it publicly via [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/do-more-with-tunnels/trycloudflare/).

> Compare with the root-level `start-demo.bat` which is for **local-only** development.

---

## Files

| File | Purpose |
|---|---|
| `start-cloudflare.bat` | Starts everything + opens two Cloudflare tunnels |
| `stop-cloudflare.bat` | Stops all services and kills tunnel processes |
| `show-urls.bat` | Prints the live public URLs (run after startup) |
| `cf-backend.log` | Auto-generated tunnel log for backend |
| `cf-frontend.log` | Auto-generated tunnel log for frontend |

---

## Usage

```
1. Double-click  start-cloudflare.bat
2. Wait ~30 seconds for all services to boot
3. Double-click  show-urls.bat  to get your public URLs
4. When done, double-click  stop-cloudflare.bat
```

---

## What it starts

| Service | Port | Exposed publicly? |
|---|---|---|
| Hardhat blockchain | 8545 | No (local only) |
| Backend (Node.js) | 3001 | ✅ Yes — via `cf-backend.log` URL |
| Frontend (Vite) | 5173 | ✅ Yes — via `cf-frontend.log` URL |
| Apple Watch UI | 4000 | No (local only) |

---

## Notes

- **URLs are ephemeral** — they change every time you restart the tunnels. There is no uptime guarantee on free quick tunnels.
- For stable public URLs, create a named tunnel at [dash.cloudflare.com](https://dash.cloudflare.com).
- `cloudflared` must be installed and on your PATH.
