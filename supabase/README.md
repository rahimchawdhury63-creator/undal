# `supabase/` — Canonical Database Migrations, Seeds & pgTAP Suites

- **Governing Spec:** `UNDAL-MASTER-GUIDE/05-database-supabase-postgres.md`, `Appendix B` (`45 tables`, `RLS` enabled on 100% of tables)
- **Subdirectories:**
  - `migrations/` — Strictly ordered SQL migrations (`Build Responses 1–3`)
  - `seed/` — Production reference seed (`117 cuisines`, `62 settings`, `48 i18n strings`, `35 error codes`, `Sylhet Sadar zone`) + separate non-production realistic fixture (`Build Response 4`)
  - `tests/` — Automated SQL invariants (`M-1..M-8`, ledger zero-sum conservation, RLS cross-tenant isolation `SEC-01`)
