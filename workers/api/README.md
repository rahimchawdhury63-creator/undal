# `workers/api` — `W1: undal-api` (Transactional Public & Authenticated Edge API)

- **Runtime:** Cloudflare Workers Free (`Hono` + `Zod` + WebCrypto JWT, `ADR-0001`, `< 10 ms` CPU budget)
- **Governing Spec:** `UNDAL-MASTER-GUIDE/08-cloudflare-workers.md`, `Appendix E` (`45 endpoints`)
- **Build Responses:** `Build 6`, `Build 7`
- **Responsibilities:** Cart validation & pricing, COD order creation (`Idempotency-Key`), lifecycle state transitions, HMAC QR tokens, Free Cloudinary Unsigned Preset & `authenticated` upload tickets + `s--XXXXXXXX--` signed viewing URLs (`ADR-0006` — zero Supabase Storage), ImgBB fallback proxy, OSM tile edge caching (`30d`), reviews, and disputes.
