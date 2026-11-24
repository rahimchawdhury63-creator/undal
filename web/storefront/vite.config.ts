/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The storefront build.
 *
 * Two outputs from one source tree: the client bundle Pages serves, and an SSR bundle the
 * prerender step imports to emit real HTML for every public route. In development the API is
 * proxied under `/api` so the browser makes same-origin requests and never learns a hostname
 * that only exists on the developer's machine — the same rule the deployed CSP enforces.
 */

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiBase = env["PUBLIC_API_BASE"] ?? "https://api.undal.app";
  return {
    plugins: [react()],
    build: {
      target: "es2022",
      cssCodeSplit: true,
      sourcemap: true,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom", "react-router"],
          },
        },
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5173,
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
      port: 4173,
    },
    test: {
      environment: "jsdom",
      include: ["test/**/*.test.{ts,tsx}"],
      globals: false,
    },
  };
});
