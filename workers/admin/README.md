# `workers/admin` — `W3: undal-admin` (Super Admin API, Settlement & System Health)

- **Runtime:** Cloudflare Workers Free + 3 Cron Triggers (`Fri 00:05 BDT`, `Sat 00:05 BDT`, `Hourly`)
- **Governing Spec:** `UNDAL-MASTER-GUIDE/08`, `09`, `20`, `23`, `Appendix C` (`55+ endpoints`)
- **Build Responses:** `Build 10`, `Build 11`
- **Responsibilities:** Mandatory TOTP + RBAC gate (`D-10`), immutable `audit_log` writer, all 9 Admin API domains, KYC vault signed URLs, weekly Partner & Rider invoice generation + PDF archival (`ADR-0002`), cash-gate state engine (`CSH-01/02`), `vendor_rank_features` builder, and free-tier quota telemetry.
