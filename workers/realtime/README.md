# `workers/realtime` — `W2: undal-realtime` (Dispatch, Leases, Surge & Data-Only FCM)

- **Runtime:** Cloudflare Workers Free + SQLite-backed `ZoneDispatchDO` Durable Object (`ADR-0003`) + 1-min safety Cron
- **Governing Spec:** `UNDAL-MASTER-GUIDE/06`, `07`, `08`, `11`, `12`, `14`
- **Build Responses:** `Build 8`, `Build 9`
- **Responsibilities:** 100-connection Spark RTDB lease broker, RS256 Firebase Custom Token minter, strictly data-only FCM HTTP v1 sender (`ALM-01`), smart rider assignment, corridor batching, `30s/120s/180s` exact alarms, and cached Nominatim / OSRM / Weather proxies.
