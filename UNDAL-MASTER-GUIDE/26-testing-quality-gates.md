# 26 · Testing & Quality Gates (“proven” = tested, with evidence)

Test catalogue seeds: **Appendix F**. Rule: a Build Response is not done until its tests run green in CI — the builder
pastes CI evidence links (Actions run URLs) in every response summary. “Manually tested by the agent” = agent executes
the suites + scripted API walks in CI, and files device-test evidence for FCM/geo per file `07` §8.

## 26.1 Pyramid per layer

| Layer | Tools (free) | Must cover |
|---|---|---|
| SQL/RPC | pgTAP + SQL assertion scripts in CI (Supabase local via CLI) | Money waterfall golden vectors (≥12 orders incl. §10.2), state-machine guards (every illegal transition rejected), RLS cross-tenant matrix (customer/vendor/rider/admin × tables), invoice idempotency (double-run = same totals), ranking SQL determinism |
| Workers (TS) | Vitest + Miniflare | Fare engine vectors (≥15 incl. F-1, batch, caps), assignment scoring fixtures, pricing parity vs SQL, auth/rate-limit/idempotency, FCM payload builders (snapshot: **no `notification` key ever** — lint-asserted), fallback paths (OSRM down, ImgBB down) |
| Flutter | `flutter test` (unit/widget/golden) + integration_test (emulator in CI) | Money display/parsing (EN/BN digits), cart/checkout flows, state machines (offer countdown, delivery steps), offline outbox replay, golden screens (light/dark × EN/BN × 360/800 dp), alarm-service intent handling (Robolectric-ish/native unit) |
| Web/Admin | Vitest + Testing Library + Playwright (free, CI) | Checkout e2e, tracking render, admin invoice verify→pay flow, zone drawing save/load, responsive matrix screenshots at D-15 widths incl. **240 px no-h-scroll assertion**, Lighthouse budgets (§19.5) |
| Firebase | Emulator rules tests | RTDB rules: participant-only rooms, presence self-write, payload caps |
| Contract | OpenAPI schema diff | API changes versioned; apps min-version gate verified |

## 26.2 Money-proof protocol (the “100% accurate” claim, made real)

Property-based tests: random order baskets (items/options/discounts/vouchers/fees) → assert identities
`COD = food_payable + delivery + platform + tip`, `Σ ledger(invoice lines) = invoice totals`, `vendor_net` formula (§10.2),
poisha conservation (no created/destroyed poisha across ledger per order). Fuzz fares across input grid (SDR/weather/traffic/batch)
for monotonicity (farther ⇒ ≥, worse SDR ⇒ ≥) + caps. Any failure blocks merge — file an ADR if a formula must change.

## 26.3 Realtime & device evidence

RTDB load script (k6 free tier local/CI): 30 simulated orders → assert connection budget math + payload sizes (file `06`).
FCM device matrix (file `07` §8) executed on physical BD-market devices before each major release; evidence sheets in repo.
Geo: recorded GPX replays through rider pipeline (throttle correctness, ETA stability). Chaos toggles in staging
(kill OSRM/ImgBB/RTDB via settings) → assert graceful fallbacks end-to-end.

## 26.4 Quality gates in CI (all must pass to merge)

Format/lint (dart analyze, eslint, sqlfluff-lite) · types strict · **≤500-line checker** · placeholder denylist grep
(file `04`) · secret scan (gitleaks) · dependency audit · test suites above · bundle/APK size budgets
(customer APK ≤28 MB target) · accessibility lint (semantics, contrast tokens, aria) · i18n completeness (EN⇔BN key parity).
Release checklist (signed build smoke: fresh install → order → deliver → invoice on staging) run per release tag.

## 26.5 Defect & incident discipline

Bug template (actor, order code, events replay attached), severity ladder (money/alarm = S0 hotfix path), post-incident
notes in `docs/runbooks/`. Uptime/health via `health-ping.yml` issues. Beta: closed rider/vendor cohort in launch zone
(Sylhet Sadar) with feedback channel wired to support desk before public marketing.
