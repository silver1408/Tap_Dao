# ── Build stage ────────────────────────────────────────────────────────────
# Vite inlines VITE_* variables at build time, so the public API origin and the
# transport secret are baked in here from build args (never hardcoded).
FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci || npm install

COPY . .

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_CRYPTO_SECRET_KEY
ARG VITE_AI_TIMEOUT_MS
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_SOCKET_URL=${VITE_SOCKET_URL} \
    VITE_CRYPTO_SECRET_KEY=${VITE_CRYPTO_SECRET_KEY} \
    VITE_AI_TIMEOUT_MS=${VITE_AI_TIMEOUT_MS}

RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────
# Plain nginx serving the compiled SPA. It is the origin behind
# https://tap.kiyoai.in; API and WebSocket traffic go straight to
# https://tap-back.kiyoai.in from the browser, so nothing is proxied here.
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/nginx-security-headers.conf

# Bound to loopback on the host (see docker-compose.yml) so only the
# Cloudflare tunnel can reach it — never the LAN or the internet directly.
EXPOSE 9100

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:9100/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
