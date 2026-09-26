import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The dev server proxies API traffic to the backend so the browser always talks
// to a single origin (no CORS/cookie/absolute-URL surprises on LAN phones or
// through the Cloudflare tunnel).
// Override with VITE_PROXY_TARGET, e.g. http://app:9201 inside Docker.
const PROXY_TARGET = process.env.VITE_PROXY_TARGET || "http://localhost:9201";

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
