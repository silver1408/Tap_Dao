# Cloudflare Deployment (self-hosted production)

TAP_DAO is published through a Cloudflare Tunnel on **two hostnames only**:

| Public URL | Serves | Local origin |
|---|---|---|
| `https://tap.kiyoai.in` | React frontend (nginx) | `http://localhost:9100` |
| `https://tap-back.kiyoai.in` | Node.js backend / API | `http://localhost:9200` |

The Hardhat chain (`8545`) is never published: it is reachable only as
`http://hardhat:8545` inside the Compose network.

---

## Files

| File | Purpose |
|---|---|
| `start-cloudflare.bat` | Starts the Docker stack and the tunnel |
| `stop-cloudflare.bat` | Stops the stack and the tunnel |
| `show-urls.bat` | Prints the two public URLs |
| `tunnel-config.example.yml` | Ingress rules matching the two hostnames |
| `cf-backend.log` / `cf-frontend.log` | Tunnel logs (auto-generated) |

---

## One-time setup

1. **Environment** — create the root env file and generate both secrets:

   ```
   copy .env.example .env
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Paste the generated values into `SESSION_SECRET` and `CRYPTO_SECRET_KEY`.
   `CRYPTO_SECRET_KEY` is also passed to the frontend build, so the API payload
   key stays identical on both sides.

2. **Tunnel** (if one does not exist yet):

   ```
   cloudflared tunnel login
   cloudflared tunnel create tapdao
   cloudflared tunnel route dns tapdao tap.kiyoai.in
   cloudflared tunnel route dns tapdao tap-back.kiyoai.in
   ```

   Then either copy `tunnel-config.example.yml` to `cloudflare/config.yml` and
   fill in the tunnel ID, or paste the same ingress rules into the Cloudflare
   Zero Trust dashboard. The tunnel token is *not* stored in this repository.

3. **Start**:

   ```
   cloudflare\start-cloudflare.bat
   ```

---

## Why the ports are safe

`docker-compose.yml` publishes the frontend and API ports on `127.0.0.1` only:

```yaml
ports:
  - "127.0.0.1:9100:9100"
  - "127.0.0.1:9200:9200"
```

A host-level `cloudflared` can therefore reach both services, while the LAN and
the internet cannot. TLS terminates at Cloudflare; the backend trusts
`X-Forwarded-Proto` (`TRUST_PROXY=1`) so the session cookie is issued with the
`Secure` flag.

---

## Cross-origin notes

The UI and the API are different origins on purpose, which has three
consequences that are already configured:

- `PUBLIC_APP_URL=https://tap.kiyoai.in` is the only value in the backend's
  CORS allow-list, and it is also the origin allowed for the Socket.IO
  handshake. Any other origin gets no CORS headers.
- `SESSION_COOKIE_SAME_SITE=none` is required: a `Lax` cookie is withheld from
  cross-origin `fetch`, which would log every member out immediately. Browsers
  accept `SameSite=None` only together with `Secure`, which `COOKIE_SECURE=auto`
  adds because the tunnel terminates TLS.
- The frontend bundle is built with `VITE_API_URL=https://tap-back.kiyoai.in`,
  so the browser talks to the API directly; nginx serves static files only and
  proxies nothing.

---

## Quick tunnel (development only)

For a throwaway `*.trycloudflare.com` URL, run the stack and then:

```
cloudflared tunnel --url http://localhost:9200
```

In that mode leave `PUBLIC_APP_URL` empty so the backend reports the tunnel URL
it finds in `CLOUDFLARED_LOG`, and expect the browser origin to change, so add
it to `CORS_ALLOWED_ORIGINS`.

---

## Troubleshooting

| Symptom | Cause |
|---|---|
| `SESSION_UNCLAIMED` / `SESSION_EXPIRED` in the console | `CRYPTO_SECRET_KEY` differs between the backend and the frontend build — rebuild the frontend |
| Login loop, cookie missing | `SESSION_COOKIE_SAME_SITE` is not `none`, or `COOKIE_SECURE` is off while served over HTTPS |
| CORS error in the browser | The tunnel hostname is not in `PUBLIC_APP_URL` / `CORS_ALLOWED_ORIGINS` |
| API hostname serves the UI | Swap the ingress order in `tunnel-config.example.yml` (API first, catch-all last) |
| `cloudflared` cannot connect | A container is not listening, or the port is published on a non-loopback interface |
