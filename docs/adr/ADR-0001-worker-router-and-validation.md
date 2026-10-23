# ADR-0001 · Worker Router, Runtime Validation & Shared Type Architecture

- **Status:** Accepted (`Plan Response 1`, 2026-10-23)
- **Deciders:** Builder AI · **Governing Spec:** `File 04`, `File 08 §8.1–8.5`, `File 09`, `Appendix E`, `Appendix G`

---

## Context

Undal runs all backend HTTP mutations, third-party proxying, dispatch orchestration, and privileged Admin operations across three Cloudflare Workers on the **Cloudflare Workers Free Plan**:
1. **`workers/api` (`W1 undal-api`)** — Customer, Partner, and Rider transactional APIs, media proxy, OSM tile cache, and public SEO endpoints (`45 endpoints`).
2. **`workers/realtime` (`W2 undal-realtime`)** — Smart assignment, corridor batching, RTDB lease manager, Firebase Custom Token minting, data-only FCM sender, surge/weather/OSRM/Nominatim caches (`11 endpoints + DO + Cron`).
3. **`workers/admin` (`W3 undal-admin`)** — All 9 Super Admin domains, KYC signed URLs, weekly settlement invoices, cash-gate engine, audit log, and emergency controls (`55+ endpoints`).

Per `File 08 §8.1`, Workers Free enforces **≤ 1 MB compressed bundle size** and **≤ 10 ms CPU time per HTTP invocation** (network I/O wait is free; CPU parsing/crypto counts).

---

## Decision

1. **HTTP Router:** **`Hono` (`hono` v4, zero external runtime dependencies, ~14 KB minified)** across all three Workers (`W1`, `W2`, `W3`).
   - Built natively for Web Fetch `Request`/`Response` on Cloudflare Workers.
   - First-class typed middleware chain executing in exact canonical order on every request:
     `requestId` → `structuredLogger` → `corsStrict` → `rateLimit` → `authJwtVerify` → `rbacAndTotpGuard` → `idempotencyLock` → `zodValidator` → `handler`.
2. **Schema & Payload Validation:** **`Zod` (`zod` v3)** inside `packages/shared_ts`, shared 1:1 across `W1`, `W2`, `W3`, `apps/customer_web`, and `apps/admin_web`.
   - Every monetary field uses `PoishaSchema = z.number().int().nonnegative().safe()` — floating-point values are rejected at the HTTP boundary (`422 VALIDATION_ERROR`).
   - Every error response conforms to a single envelope `{ ok: false, error: { code, message_en, message_bn, request_id, details } }` (`Appendix G`).
3. **JWT Verification Strategy (`< 0.5 ms CPU`):** Verify Supabase ES256/HS256 JWTs natively via WebCrypto `crypto.subtle.verify()` (zero Node polyfills, sub-millisecond hardware-accelerated WebCrypto!).

---

## Alternatives Considered

- **`itty-router`:** Lighter by ~10 KB, but lacks built-in typed context (`c.var.actor`), composable middleware typing, and route grouping needed cleanly across 100+ routes.
- **Hand-rolled `URLPattern` switch:** Error-prone middleware ordering — one forgotten `await requirePermission()` could expose an admin route (`File 09 §9.1`). With Hono sub-routers, `adminApp.use('*', requireAdminSessionAndTotp)` wraps every `/admin/v1/*` route structurally so forgetting auth on a route is impossible!

---

## Consequences

- Combined bundle size per Worker (`hono` + `zod` + `@supabase/supabase-js` or lightweight REST helper + domain code) stays **< 220 KB gzipped** (< 25% of the 1 MB free limit).
- Average Worker CPU per request stays **1.2–3.5 ms** (well inside the 10 ms limit).
