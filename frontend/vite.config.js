import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// ── Public origins ────────────────────────────────────────────────────────
// Production (Docker) serves the built bundle from https://tap.kiyoai.in and
// the browser calls the API on https://tap-back.kiyoai.in. Both are injected at
// build time as VITE_API_URL / VITE_SOCKET_URL (see docker-compose.yml).
//
// The dev server below is for local work only: it proxies API and WebSocket
// traffic to the backend so the browser stays on a single origin. The proxy is
// never used in production — the production bundle talks to the public API
// origin directly.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || "http://localhost:9200";

// Hosts the dev server answers to. Vite blocks unknown Host headers, so the
// production domain is listed explicitly to allow testing a production build
// through a local reverse proxy.
const ALLOWED_HOSTS = (process.env.VITE_ALLOWED_HOSTS || "tap.kiyoai.in,tap-back.kiyoai.in,localhost,127.0.0.1")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const API_ROUTES = [
  "/session",
  "/contract",
  "/proposals",
  "/scan",
  "/balance",
  "/verify-pin",
  "/vote",
  "/register",
  "/card",
  "/upload",
  "/uploads",
  "/invites",
  "/tunnel-info",
  "/ai",
  "/health",
];

const proxy = Object.fromEntries(
  API_ROUTES.map((route) => [route, { target: PROXY_TARGET, changeOrigin: true }]),
);

proxy["/socket.io"] = { target: PROXY_TARGET, ws: true, changeOrigin: true };

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: ["tap.kiyoai.in", ".trycloudflare.com"],
    proxy,
  },
});
