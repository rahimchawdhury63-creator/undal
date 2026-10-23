# 18 · Rider App (Flutter Android + Kotlin geo/alarm/QR) — Riders' Cockpit

Reference basis: file `02` §2.4. Tabs: **Home (map) · Deliveries · Earnings · History · More**.
Design for gloves/sunlight: huge touch targets (≥56 dp primary actions), high contrast, voice prompts (TTS BN/EN
“New order — Lalbagh thike pickup”) optional, one-hand step buttons.

## 18.1 Session lifecycle
Offline home: zone map (heat hint from live SDR), **Start session** → pre-flight (vehicle confirm, bag type, GPS fix quality,
alarm-health ARMED check + test, battery advisory, face-selfie when prompted: shift-start per policy + random mid-shift
max 1/day — CameraX front cam, liveness-lite blink/smile challenge on-device ML Kit free APIs; mismatch → soft-block +
support review, never public shaming). In-session: online pill, shift timer, today earnings ticker, extension opt-in toggle
(reference pattern), pause (15 min meal break — excluded from offers, fairness-safe), End session → if cash-in-hand >0 →
**Cash Gate** (§18.5), else summary (deliveries, km, earnings, rating delta).

## 18.2 Offer screen (alarm full-screen, file `07`)
Countdown ring 30 s, map (you→vendor→customer polyline), **fare big + itemised “Why this fare?” sheet** (file `11`),
pickup (vendor, address, distance/ETA, ready-in countdown), drop (area, distance/ETA), items count, **COD to collect ৳X**,
batch badge + per-order breakdown when bundled, vehicle-feasibility already guaranteed server-side.
Accept (slide or tap-hold to prevent pocket-accepts — setting) / Reject with reason chips (D-23 conditional availability).
Expired/accepted-elsewhere → instant polite dismiss via `alert_cancel`.

## 18.3 Active delivery step-machine (per order; batches interleave steps optimally)
1 **To vendor:** Navigate (Google intent, D-10) / in-app route, vendor card, Call/Chat vendor, “Arrived” (geofence-suggested
≤80 m, manual override logged). 2 **Pickup verify:** vendor order code cross-check + **Scan QR** (CameraX + ML Kit barcode;
manual code fallback) → items checklist display → “Picked up” (optional bag photo). 3 **To customer:** Navigate, customer
card (masked name, instructions, pin), Call/Chat, “Arrived” (starts wait-timer visible to all). 4 **Handover:** Collect-cash
card (**Collect ৳432 · if given ৳500 return ৳68** quick-change chips), delivery PIN entry if zone-enabled, photo proof
optional, “Delivered” → micro-feedback chips (vendor wait? address quality?) → next offer or idle map.
Problem flows at every step: vendor closed/not-ready (timer + wait-pay auto, file `11` §3), customer unreachable
(2-call + 8-min protocol with countdown UI → failed-delivery flow), wrong pin correction, accident/emergency button
(one-tap: share live location to support + emergency contact call), order damaged/spilled report with photo.

## 18.4 Earnings & History
Today/week cards from ledger (fares, bonuses 3%, tips, wait-pay, adjustments — each line tappable to its order),
**Friday invoice** preview + past invoices/PDF, cash-in-hand meter (collected − remitted, ceiling warning at 80%),
performance (rating, completion, acceptance with reason-quality note, on-time %), trip history with map replay (aggregated track).

## 18.5 Cash Gate (founder's fixed remittance screen — D-16)
Triggers: shift-end with balance >0, or ceiling reached, or Friday cutoff. Screen: amount due itemised, **Undal bKash
number** (from W2 config — sourced from Actions secret `UNDAL_BKASH_NUMBER`, displayed with copy button + bKash app deep-link),
“Send Money” instructions BN/EN (“cash-out charge is on Undal — send exact ৳X”), then submission form: TrxID, sender number,
sender name, screenshot (private lane), **face selfie**, submit → `pending review`. Until approved (or partial-approved),
rider **cannot start a new session** (blocking screen with ticking reminder sound at chosen intervals while app open +
FCM reminders) — with permanent “Call Support” + dispute entry. Admin verifies TrxID uniqueness (double-claim impossible)
→ ledger settled → gate lifts instantly via FCM/RTDB ping.

## 18.6 More
Profile + vehicle/docs vault (expiry alerts), payout account, zone & vehicle settings (change request → Admin),
alarm/sound settings (loop choice among bundled tones, volume test), language, Help/safety center (insurance info placeholder-free:
real policy text from Admin CMS), app update gate, logout (blocked mid-delivery).
Geo service (Kotlin foreground, file `06` throttles) runs **only in-session** — privacy promise shown in UI (“Location shared only while you're in session”).
