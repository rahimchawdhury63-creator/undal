# `workers/api` — `W1: undal-api` (Transactional Public & Authenticated Edge API)

- **Runtime:** Cloudflare Workers Free (`Hono` + `Zod` + WebCrypto JWT, `ADR-0001`, `< 10 ms` CPU budget)
- **Governing Spec:** `UNDAL-MASTER-GUIDE/08-cloudflare-workers.md`, `Appendix E` (`45 endpoints`)
- **Build Responses:** `Build 6`, `Build 7`
- **Responsibilities:** Cart validation & pricing, COD order creation (`Idempotency-Key`), lifecycle state transitions, HMAC QR tokens, ImgBB public upload proxy (`D-03`), private storage signed URL minting (`300s`), OSM tile edge caching (`30d`), reviews, and disputes.
