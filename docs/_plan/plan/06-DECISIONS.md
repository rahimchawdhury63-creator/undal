# 6. Discrepancy and decision register

Each entry: the conflict, the evidence, the choice, what it costs.

**D1 — `docs/36` acceptance matrix vs the checkout.** The matrix marks surfaces as designed; several
do not exist (customer app, vendor order intake, ten domains). *Decision:* the matrix is intent, the
route table and modules are fact. Every future acceptance claim cites a command.

**D2 — `PRODUCTION-READINESS.md` (~3/10) vs README status table.** The README reads more finished.
*Decision:* the stricter document stands; the README table gets regenerated from it.

**D3 — Seeded demo data vs "boots empty".** A guardrail forbids business rows in migrations.
*Decision:* fixtures live in `scripts/db/seed_local.py`, applied only by the integration harness, never
by a migration. Alternative rejected: a `--schema-data:` marker would blur the rule it protects.

**D4 — Where the Kotlin route table comes from.** Hand-typing 58 paths would be a second source of
truth. *Decision:* generate `ApiRoutes.kt` from `docs/api/surface.json`; drift fails the gate and CI.

**D5 — Vendor app cannot list orders.** No such route exists. *Decision:* the app reads, pauses and
resumes only; the missing route is scheduled as Response 4 rather than invented inside the client.

**D6 — `audit_log.request_id` is `BINARY(16)`; brain tables store `VARCHAR(64)`.** Unresolved.
*Decision:* record the inconsistency, do not "fix" it by widening a column that migrations cannot
alter additively yet. Owner: the audit-format work.

**D7 — 100 000-word plan vs one turn.** The prompt forbids faking the count. *Decision:* ship the
evidence-backed sections, print the real count, keep the planning gate open.

**D8 — Commit and push.** The current instruction says not to push without explicit direction.
*Decision:* commit locally on the current branch only; no push, no deploy, no workflow trigger this
turn. Earlier turns pushed because earlier instructions said to.
