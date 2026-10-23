# 22 · Order Lifecycle, Chat, QR Pickup, Reviews (the daily heartbeat)

## 22.1 State machine (one diagram, one guarded door `transition_order`)

```
DELIVERY:  PLACED → VENDOR_ACCEPTED(prep set) → PREPARING → READY_FOR_PICKUP → RIDER_ASSIGNED* → PICKED_UP → OUT_FOR_DELIVERY
           → DELIVERED | FAILED_DELIVERY
           ↘ VENDOR_REJECTED ↘ CANCELLED_{CUSTOMER_EARLY|VENDOR_UNREACHABLE|NO_RIDER|ADMIN|PAYMENT_RISK}
PICKUP:    PLACED → VENDOR_ACCEPTED → PREPARING → READY_FOR_PICKUP → COMPLETED_PICKUP (code/QR verified)
*RIDER_ASSIGNED can occur any time after PLACED (usually during PREPARING, timed per file 12 §5)
```

Guards: actor + from-state + payload per transition (table in code, mirrored in Appendix F tests); every transition appends
`order_events{actor, from, to, meta, request_id}` + RTDB mirror + FCM fan-out to affected parties. Customer cancel window:
free until VENDOR_ACCEPTED; after = request flow (vendor/Admin decides; money per file `10` §6). Timers (settings):
vendor respond 180 s (unreachable rule 120 s file `07`), rider offer 30 s cascade, prep overrun alert +50%, pickup no-show
(customer) 15 min after ready → vendor may close as no-show (policy lines).

## 22.2 Live tracking payload & ETAs

Per file `06` room + file `12` §6 ETA. Customer timeline copy EN/BN per state (Appendix H). Vendor sees rider ETA-to-store;
rider sees next-step card. Arrival geofences (80 m vendor / 60 m customer) *suggest* step buttons — manual confirm always (GPS lies in dense BD urban).

## 22.3 Chat (order-scoped + support)

Rooms auto-created per order: customer↔rider, customer↔vendor, rider↔vendor (pickup coordination). Text (≤1000 chars),
photo (private lane), **voice note** (≤60 s, private lane, auto-expire), quick chips (“I'm downstairs”, “Please call on arrival”,
“Gate is closed — other side please”), read receipts, typing via RTDB ephemeral. Persisted in Postgres (`chat_messages`),
fanned via RTDB while active + FCM `chat_msg` nudges. Safety: phone-number/link regex shielding (warn, don't silently censor),
report/block → Admin transcript review, chats lock to read-only 24 h after terminal (support retains access). Support desk
threads separate (`support_threads`, Admin-connected, file `20`).

## 22.4 Calls

System dialer intents with real numbers revealed **only to assigned parties during active order** (privacy file `09`);
call-attempt logging (tap timestamps) for no-contact dispute evidence. No in-app VoIP in v1 (free-tier/complexity honesty).

## 22.5 QR pickup verification (founder spec — secure design)

Vendor order screen shows QR encoding `UD1.{orderId}.{exp}.{hmac}` (HMAC-SHA256 with server secret via W1-minted token,
5-min rotation, single-use nonce stored on order). Rider scans (CameraX/ML Kit) → W1 verifies (expiry, nonce unused,
rider == assignee, state == READY/ASSIGNED) → `PICKED_UP`. Fallbacks: 6-digit code under QR (same nonce family),
vendor-confirms-handover button (dual-control, logged) for broken-camera reality. Pickup (customer collect): 4-digit code +
optional QR from customer app, verified by vendor app scan/entry. Wrong-order scans error loudly with both codes shown —
designed to make bag-swaps nearly impossible.

## 22.6 Ratings & reviews

Post-terminal prompts (file `13` §3 discipline): Customer→Vendor (stars, aspect chips: taste/packaging/portion/value/temp,
photos, text EN/BN), Customer→Rider (stars, chips: polite/fast/careful), Rider→(vendor wait, customer findability — internal),
Vendor→(customer pickup behaviour — pickup only, internal trust). Vendor replies public; disputes → Admin with timeline
evidence auto-attached; moderation (hide/restore with reason, appeal). Aggregates: Bayesian averages (file `13`), 90-day
windows displayed honestly (“4.3 · 512 ratings”). Incentivised/fake review detection per file `09` fraud rules.

## 22.7 Offline action outbox (all apps — §6.6 contract)

Local queue (SQLite) of intents with idempotency keys + created-at; optimistic UI marked “pending sync”; replay in order;
server rejections reconcile with explicit UI (“Couldn't mark delivered: order was cancelled by support at 19:02 — see details”).
Order placement is **never** outboxed (requires live server verdict — COD fraud + menu staleness).
