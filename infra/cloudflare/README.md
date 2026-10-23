# `infra/cloudflare/` — Cloudflare Pages & Account Cron Topology

- **Governing Spec:** `ADR-0003`, `ADR-0004`, `UNDAL-MASTER-GUIDE/08`, `19`, `20`, `24`
- **Account Cron Budget (`4 of 5` Free Slots Used):**
  1. `workers/realtime` (`*/1 * * * *`) — safety sweep, presence eviction, surge/weather cache refresh
  2. `workers/admin` (`5 18 * * 4`) — Friday `00:05 Asia/Dhaka` weekly settlement & cash gate recompute
  3. `workers/admin` (`5 18 * * 5`) — Saturday `00:05 Asia/Dhaka` weekly settlement & cash gate recompute
  4. `workers/admin` (`0 * * * *`) — hourly ranking features rebuild & Supabase keepalive
