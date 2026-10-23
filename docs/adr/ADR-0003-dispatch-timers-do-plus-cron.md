# ADR-0003 · Sub-Minute Dispatch Timers via Free SQLite Durable Object Alarms + 4 Account Crons

- **Status:** Accepted (`Plan Response 1`, 2026-10-23)
- **Deciders:** Builder AI · **Governing Spec:** `File 06`, `File 08 §8.2–8.3`, `File 12 §12.3/12.8`, `File 22`, `File 23`

---

## Context

Undal's real-time dispatch & order lifecycle (`File 12` & `File 22`) requires exact sub-minute state transitions:
- **30 seconds:** Rider offer timeout (`OFFERED → EXPIRED → rank & alert next best rider` + increment `unanswered_streak`).
- **120 seconds:** Customer unreachable wait window before rider can complete proof-of-attempt protocol.
- **180 seconds (3 min):** Partner acceptance window before ops alert / auto-cancel (`CANCELLED_VENDOR_TIMEOUT` at configurable cap).
- **15 minutes post-terminal:** Purge `o/{orderId}` and `chat/{orderId}` from Firebase RTDB.

Meanwhile, **Cloudflare Workers Free Plan** imposes two exact platform rules (verified 2026-10-23 at `developers.cloudflare.com/workers/platform/limits/`):
1. **Cron Triggers have a minimum interval of `1 minute` (`*/1 * * * *`)** — sub-minute cron expressions are rejected.
2. **Maximum `5` Cron Triggers total across the entire Cloudflare account** (shared across `W1`, `W2`, and `W3`).
3. **SQLite-backed Durable Objects ARE available on the Free Plan** (`new_sqlite_classes` migration in `wrangler.toml`, 5 GB storage, 100K writes/day, **millisecond-accurate `state.storage.setAlarm(timestampMs)`**!).

---

## Decision

1. **Primary Precision Timer Engine — `ZoneDispatchDO` (SQLite Durable Object in `W2`):**
   - One Durable Object instance per active delivery zone (`idFromName(zoneId)` — e.g. `sylhet-sadar`, `kulaura`).
   - Serializes concurrent rider acceptances in-memory + SQLite (**eliminating race conditions where two riders tap Accept in the same millisecond!**) AND schedules exact millisecond `storage.setAlarm(nextDeadlineMs)` callbacks for:
     - `30s` rider offer expiry → immediately scores & pushes `P0` FCM to candidate #2 in **30.0s**, not 60–90s!
     - `180s` unaccepted kitchen alert → `P0` reminder ring / auto-timeout transition.
     - `15m` RTDB room cleanup (`DELETE o/{orderId}` + `chat/{orderId}`).
2. **Account-Wide Cron Trigger Allocation (`4 of 5` Free Slots Used — `1` Spare Reserved):**
   - **Slot 1 (`W2` — `*/1 * * * *`):** Belt-and-braces reconciliation sweep (catches any DO alarm missed during redeploy, expires stale RTDB leases/presence > 60s, refreshes active zone surge & 10m weather cache).
   - **Slot 2 (`W3` — `5 18 * * 4` = Friday `00:05 Asia/Dhaka`):** Weekly invoice generation for Friday-cycle zones + `recompute_all_cash_gates()`.
   - **Slot 3 (`W3` — `5 18 * * 5` = Saturday `00:05 Asia/Dhaka`):** Weekly invoice generation for Saturday-cycle zones + `recompute_all_cash_gates()`.
   - **Slot 4 (`W3` — `0 * * * *` Hourly):** Recompute `vendor_rank_features`, check cash-gate auto-blocks, archive expired disputes/tokens (`02:00 UTC` daily subset).
   - **Slot 5:** Intentionally kept unused (`20%` headroom for future operational crons!).

---

## Consequences

- **Exact 30.0-second rider failover** with **zero double-assignment races** and **zero cost**.
- Deploys cleanly on a brand-new free Cloudflare account on the first `wrangler deploy` without hitting the 5-cron ceiling.
