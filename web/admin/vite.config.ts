/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The admin build.
 *
 * Two rules shape this file. First, the console is served from `/admin/*` inside the storefront's
 * Pages project, so every asset URL is built against that base — an absolute `/assets/index.js`
 * would 404 and take the console down. Second, the API is reached through the same origin under
 * `/api`, which is what lets the deployed CSP stay `'self'` and keeps the session cookie first-party.
 */

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env["PUBLIC_API_BASE"] ?? "https://api.undal.app";
  const adminBase = env["PUBLIC_ADMIN_BASE"] ?? "/admin";
  return {
    base: `${adminBase.replace(/\/$/u, "")}/`,
    plugins: [react()],
    build: {
      target: "es2022",
      // A private console does not publish its source maps: they would be readable by anyone
      // who guesses the asset name, and the CSP check below asserts none were written.
      sourcemap: false,
      // The console's budget is wider than the storefront's because it is a desktop tool used by
      // staff on a wired connection, but it is still a budget (docs/21 §6).
      chunkSizeWarningLimit: 420,
      rollupOptions: {
        output: {
          manualChunks: { react: ["react", "react-dom", "react-router"] },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5174,
      proxy: {
        "/api": {
          target: apiBase,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/u, ""),
        },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: 4174,
    },
  };
});
