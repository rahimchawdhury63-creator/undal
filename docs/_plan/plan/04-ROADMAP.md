# 4. Roadmap, Responses 2–20

Each response ends green on the gate and on the Android workflow. A response that cannot end green
ships less, not broken.

| # | Scope | Exit gate |
|---|---|---|
| 2 | Finish the plan: read `docs/01`–`39`, append the missing sections until the word count is genuine | `node scripts/plan-words.mjs` reports the required total; tracker updated |
| 3 | A reachable TiDB: run `integration.py --run`, fix every query that fails on real rows | 20 queries return rows; output pasted into STATUS |
| 4 | Vendor-scoped order intake (`GET /v1/vendors/{id}/orders`) with permission, repository, tests; wire the vendor app | route in surface; client-calls green; vendor APK shows orders |
| 5 | Lift `TokenStore`/`AuthApi` into `android/shared/session`; vendor sign-in | both APKs assemble against one session module |
| 6 | Customer app shell: browse, cart, checkout | APK assembles; calls only existing routes |
| 7 | Realtime: SSE order tracking end to end (Worker test + client reconnect test) | stream test green; no polling fallback silently substituted |
| 8 | Rider shift start/stop and cash settlement screens | APK assembles; writes carry idempotency keys |
| 9 | Dispatch domain: permissions, route, repository, tests | `dispatch.*` moves from 0 to >0 in the surface report |
| 10 | Pricing domain and fare verification against `docs/10` vectors | vector test green |
| 11 | KYC and sensitive media: storage, authorisation, retention, audit | uploads refused without permission; deletion path tested |
| 12 | Support domain: tickets, replies, audit | routes + tests + admin screen |
| 13 | Analytics domain: read-only aggregates | routes + tests |
| 14 | Partner web surface (order console) | build + CSP + a11y checks |
| 15 | Rider web surface | as 14 |
| 16 | Admin: the ten-empty-domain screen set, one per domain | admin tests, tsc, build green |
| 17 | Localization completeness sweep: every new string in both locales | i18n count matches across en/bn |
| 18 | Accessibility pass: labels, contrast, focus order, reduced motion | a11y script green |
| 19 | Operations: runbooks, backup/restore, incident procedure | docs + workflow_dispatch jobs |
| 20 | Final integration, hardening, release readiness with evidence table | gate + Android + a written, honest "not production-ready" list |

## Sequencing rules

1. **A database outranks every feature.** Response 3 is the highest-value turn available and should
   not be deferred for something more visible.
2. **No new route without a permission, a test and a client call** — the three checks that made the
   last ten turns catch real defects.
3. **Android follows the API, never the reverse.** The vendor app waits for the vendor order route.
4. **Each response ends with the measured table.** If a number did not change, say so.
