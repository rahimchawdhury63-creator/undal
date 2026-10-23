# 07 · FCM Data-Only Alert Engine — “Never Miss an Order” (the most important system in Undal)

## 7.1 Absolute rules

1. **Data-only payloads. The `notification:` key is forbidden** in every Undal FCM message (notification payloads are
   swallowed by the system tray when the app is backgrounded and cannot reliably start our alarm logic).
2. `priority: high` (Android), `content_available` n/a (Android-only), per-type TTL + collapse key (table §4).
3. All sends originate from **Worker-2 via FCM HTTP v1** (service-account OAuth2, cached access token). No client ever sends FCM.
4. Sound is played by **native Kotlin code**, never by the notification channel alone (§3). The loop asset ships in this guide:
   `sounds/undal_order_alert_loop.wav` (loud, normalised, seamlessly looped) → `res/raw/undal_order_alert.mp3|ogg` at build.

## 7.2 Honest Android truth table (read before promising anything — D-04)

| Device/app state | High-priority data FCM delivered? | Undal behaviour |
|---|---|---|
| App foreground / background (recent) | Yes, seconds | Alarm service starts, loop + full-screen order UI |
| App swiped from Recents (most OEMs) | **Usually yes** — `FirebaseMessagingService` is woken by FCM | Alarm starts exactly as background case |
| Screen locked / Doze | Yes (high-priority grants temporary Doze exemption) | Full-screen intent over lockscreen, alarm-stream audio (rings even on silent* — see §3 note) |
| Battery-saver / aggressive OEM killer (Xiaomi/Oppo/Vivo etc. **before whitelisting**) | **Often no** until app is autostart-whitelisted + battery-unrestricted | Onboarding *Alarm Health* flow (§6) walks the user through exact OEM toggles with deep-link intents; presence system detects silence and protects the order (§7 fallbacks) |
| **Force Stop** (Settings → Apps → Force Stop) or app uninstalled | **Never** — Android guarantees zero delivery until user manually reopens | Impossible for any app (Foodpanda/Uber included). Undal detects via presence + no-ack timers and re-routes/cancels safely (§7) |

*Silent/DND: alarm-stream (`USAGE_ALARM`) audio + a max-importance channel bypasses media silence; true DND with
“alarms blocked” still wins on some OEMs — Alarm Health flow requests DND-access exemption guidance. **Marketing copy must
say “alarm-grade alerts with guided setup” — never “guaranteed on every phone”.**

## 7.3 Native receive pipeline (Partner + Rider apps, Kotlin module `alarm-engine`)

```
FCM data msg → UndalMessagingService.onMessageReceived()   [extends FirebaseMessagingService]
  → validate type/signature (HMAC over orderId+ts with app-held rotating key from W2 bootstrap)
  → AlarmController.start(order):
      • acquire partial WakeLock (≤3 min)
      • start Foreground Service (type: specialUse/mediaPlayback per target SDK rules)
          – MediaPlayer/AudioTrack on STREAM_ALARM, loop=true, volume forced to max alarm volume
          – vibration pattern loop [0,600,300,600]
      • post high-importance notification w/ FullScreenIntent → OrderAlertActivity
          (showWhenLocked + turnScreenOn; USE_FULL_SCREEN_INTENT permission flow for Android 14+)
      • render the same Accept/Reject (vendor) or offer (rider) UI as in-app, from cached order payload + instant W1 refetch
  → loops UNTIL: user acts, OR server sends type=alert_cancel (order gone/accepted elsewhere), OR max-ring timeout
    (default 120 s vendor / offer-expiry rider) → then stops, leaves missed-order notification + event log
BootReceiver (BOOT_COMPLETED): re-registers FCM token check + WorkManager 15-min heartbeat-safety job
Token rotation: onNewToken → W1 register (old token invalidated server-side)
```

Permissions choreography (each with priming screen, file `02` law): `POST_NOTIFICATIONS`, full-screen intent (14+ settings deep-link),
exact-alarm not required (FCM-driven), battery-optimisation exemption request (`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` —
justified to Play policy as core delivery-alert functionality), `FOREGROUND_SERVICE` (+type), `WAKE_LOCK`, `VIBRATE`,
`RECEIVE_BOOT_COMPLETED`, Camera (QR, rider/partner as needed), fine+background location (rider session only, with Play declaration).
Customer app uses a *gentle* subset: data FCM → local notification with order-status copy + deep link (no loop, no FSI).

## 7.4 Message catalogue (`data.type` registry — extend only via guide PR)

| type | To | TTL | Collapse | Payload essentials | Client action |
|---|---|---|---|---|---|
| `vendor_new_order` | Vendor devices (outlet) | 120 s | `ord_{id}` | orderId, code, items_count, cod_poisha, placed_at, hmac | **Alarm loop** + accept sheet (prep stepper) |
| `rider_offer` | 1 rider | 30 s | `off_{id}` | offerId, fare_poisha, pickup/dist/eta, expires_at, hmac | **Alarm loop** (shorter pattern) + offer card |
| `alert_cancel` | Same targets | 30 s | same as orig. | orderId/offerId, reason | Stop loop instantly, dismiss, log |
| `order_status` | Customer/rider/vendor | 300 s | `st_{id}` | orderId, status, eta | Local notification + silent RTDB/UI refresh |
| `chat_msg` | Counterparty | 3600 s | `chat_{id}` | orderId, preview (≤60 chars, no sensitive data) | Notification + badge |
| `rider_nearby_pickup` | Vendor | 120 s | `nr_{id}` | orderId, eta_min | Chime + banner “Rider 3 min away — keep ready” |
| `cash_gate_reminder` | Rider | shift-end | `cash` | amount_poisha | Tick-tick sound (guide sound #2 spec) + gate screen |
| `kyc_update` / `payout_update` / `system_notice` | Affected actor | 24 h | per topic | deep_link | Inbox + notification |

Payload ceiling: FCM data ≤4 KB — payloads carry **IDs + display crumbs only**; screens refetch truth from W1.
Every send logged (`fcm_dispatch_log`: type, target, FCM message id, error) — Admin can prove “we rang you at 19:42:03” in disputes.

## 7.5 Worker-2 sender design

Service-account JSON → Actions secret → Worker secret (never repo). Access-token mint/cache (55 min), batch sends per outlet
(all staff devices), invalid-token pruning on `UNREGISTERED`, retry ×3 exp. backoff for 5xx, dead-letter row + Admin alert
if a `vendor_new_order` send fails for an *online* vendor. Fan-out order: RTDB room write **and** FCM in parallel (either path wakes the app; app dedupes by orderId).

## 7.6 Alarm Health onboarding (Partner/Rider first-run + permanent Settings screen)

Live checklist with per-OEM instructions (Samsung/Xiaomi/Oppo/Vivo/Realme/OnePlus/Tecno/Infinix — BD market reality):
notifications ON → full-screen allowed → battery **Unrestricted** → autostart ON (OEM intent where available) →
“Send test alarm” button (W2 sends `type=test_alarm` → loop 5 s → confirms ARMED). Status pill persists on home:
**ARMED ✓ / AT RISK**. Vendors cannot toggle “Open” while AT RISK without acknowledging the warning (logged).

## 7.7 Fallback chain when a device is unreachable (orders stay safe — founder's 2-minute rule)

Vendor: ring 0–120 s (FCM + RTDB) → no accept **and** presence stale → auto-cancel `VENDOR_UNREACHABLE`, customer notified
with instant reorder suggestions (voucher per Admin policy), vendor flagged (score + reopen check-in prompt on next launch).
Vendor reachable but ignoring: auto-reject at Admin timeout (default 180 s) `VENDOR_NO_RESPONSE` (distinct reason, distinct coaching).
Rider: offer 30 s → next-best rider (file `12`); after N failures or zero fleet → order queued with honest customer ETA +
Admin exception alert (never fake “rider assigned”).

## 7.8 Test protocol (mandatory, file `26` expands)

Physical-device matrix (≥1 Xiaomi + Samsung + Tecno/equivalent): states = foreground, background, swiped, locked, DND,
battery-saver, post-reboot, whitelisted vs not. Record delivery latency (server send ts → first audio frame log).
Release gate: 100% alarm-start ≤5 s in all *whitelisted* states across 20 trials/device; results filed in `docs/runbooks/fcm-test-evidence/`.
