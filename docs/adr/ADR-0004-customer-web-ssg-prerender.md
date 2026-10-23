# ADR-0004 · Customer Web SEO Prerendering (`SSG` + Hydrated SPA on Cloudflare Pages)

- **Status:** Accepted (`Plan Response 1`, 2026-10-23)
- **Deciders:** Builder AI · **Governing Spec:** `File 19 §19.1–19.6`, `File 26 (WEB-01)`, `D-04`, `D-15`

---

## Context

`customer_web` runs on **Cloudflare Pages Free** (`unlimited static bandwidth, 500 builds/month`) and must satisfy two simultaneous requirements:
1. **Strict SEO Crawlability (`WEB-01`):** `curl -s` (with **zero JavaScript execution**) against `/`, `/sylhet`, `/sylhet/biryani`, `/r/{slug}`, `/about`, `/privacy`, `/terms`, `/refund-policy`, `/become-partner`, `/become-rider`, `/contact` MUST return full rendered HTML containing `<title>`, `<meta name="description">`, canonical `<link>`, OpenGraph tags, visible `<h1>` + menu items, and valid Schema.org `JSON-LD` (`FoodEstablishment` + `Menu` + `BreadcrumbList` + `FAQPage`) plus valid `/sitemap.xml`, `/robots.txt`, and `/.well-known/assetlinks.json`.
2. **Dynamic Live Web App (`w-01..w-24`):** Logged-in cart state, live checkout, live order tracking, search, EN/বাংলা instant toggle, and newly onboarded vendors added **between builds** must work seamlessly in the browser without requiring a redeploy per menu edit!

---

## Decision

Implement **Vite Dual-Build (`client` + `entry-server` Node `renderToString`) Static Prerendering + Cloudflare Pages SPA Fallback (`200 /index.html` + Pages Function `<meta>` injection)**:

1. **`vite build` (`dist/client`):** Produces code-split browser bundles (`< 120 KB gzipped` initial JS budget, `CLS < 0.05`, `LCP < 2.5s` on emulated 4G).
2. **`vite build --ssr src/entry-server.tsx` (`dist/server`):** Compiles the exact same React router + route data loaders to Node ESM.
3. **`scripts/prerender.mjs` (post-build step):**
   - Pulls approved active zones, cuisines (`Appendix D`), and active vendors/menus from public `W1 /v1/seo/manifest` (falling back cleanly to deterministic seed snapshot in CI offline tests!).
   - Calls `renderToString()` for every route in `< 2 seconds total` (zero Chromium binary needed in CI!), injects route `<head>` tags + `JSON-LD` + initial hydration payload `window.__UNDAL_DATA__`, writes `dist/client/{route}/index.html`, generates `/sitemap.xml`, `/robots.txt`, and `/.well-known/assetlinks.json`, and asserts every generated HTML file contains non-empty `<h1>` and valid `application/ld+json`.
4. **Live Revalidation Between Builds:** Client hydration immediately revalidates live menu availability/prices against `W1` (`stale-while-revalidate`), and any newly approved vendor `/r/{new-slug}` not yet prerendered resolves via a lightweight Cloudflare Pages `functions/r/[slug].ts` edge handler that injects dynamic `<title>` + `JSON-LD` on the fly before streaming!

---

## Consequences

- `curl` without JS receives **100% rich semantic HTML + full menu + JSON-LD** for BOTH prerendered routes AND brand-new vendors approved seconds ago!
- Build + prerender runs in **< 10 seconds** inside GitHub Actions Free Ubuntu runners with **zero flaky headless browser dependencies**.
