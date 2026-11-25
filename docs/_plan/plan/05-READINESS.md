# 5. Production-readiness and evidence matrix

The columns are the type of evidence, because they are not interchangeable. A unit test is not a
staging run; a staging run is not a device; a device is not a provider.

Key: **A** automated test in this repo · **B** staging evidence · **C** live provider · **D** device ·
**E** legal/operator action · **?** unknown.

| Area | A | B | C | D | E | ? | Note |
|---|---|---|---|---|---|---|---|
| Money arithmetic (paisa) | ✓ | – | – | – | – | – | 110 000 vectors, TS = Kotlin |
| Fare engine | ✓ | – | – | – | – | – | no database-backed repricing proven |
| Ledger postings | ✓ | – | – | – | – | – | unit-level; atomicity unproven |
| Idempotency | ✓ | – | – | – | – | – | replay proven in tests only |
| Cash writes | gate | – | – | – | – | – | **gated by design; must stay gated** |
| Audit chain | partial | – | – | – | – | ✓ | never run serialised end to end |
| Auth/session | ✓ | – | – | – | – | – | no real token ever issued |
| RBAC | ✓ | – | – | – | – | – | 32 of 416 permissions implemented |
| SQL correctness | static | – | – | – | – | ✓ | no query has returned a row |
| Migrations | ✓ policy | – | – | – | – | ✓ | resume/recovery untested |
| Realtime | – | – | – | – | – | ✓ | no stream observed |
| Push (FCM v1) | – | – | – | – | – | ✓ | not implemented |
| Location ingestion | – | – | – | – | – | ✓ | not implemented |
| Media/KYC | – | – | – | ✓ | – | ✓ | gated; unverified |
| Localization | ✓ | – | – | – | – | – | 670 × 2 keys, coverage unmeasured per screen |
| Accessibility | partial | – | – | – | – | ✓ | no screen-reader run |
| Android build | ✓ CI | – | – | – | – | – | APKs assemble; never rendered |
| Web build | ✓ | – | – | – | – | – | storefront + admin build and prerender |
| Deploy pipeline | – | – | – | – | – | ✓ | workflow files exist for some apps only |
| Backups/restore | – | – | – | ✓ | – | ✓ | no drill |
| Monitoring | – | – | – | – | – | ✓ | `wrangler tail` only |
| Legal (LOSDA, ToS) | – | – | – | – | ✓ | ✓ | operator action |

## Verdict

**Not production-ready.** The honest summary of this checkout is: a well-guarded system that has
never executed against a database, never served a request, and never rendered on a phone. The
strongest evidence is static — 24 gate steps, 974 handler tests, 181 linted statements, a generated
API surface, an APK that assembles. The weakest is everything that needs the outside world: one
database, one deploy, one device, one provider, one lawyer.
