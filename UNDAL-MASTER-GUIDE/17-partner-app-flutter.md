# 17 · Partner App (Flutter Android + Kotlin alarm engine) — Vendors' Cockpit

Reference basis: file `02` §2.3. Tabs: **Live Orders · Overview · Menu · Growth · More**.
Persistent header: outlet switcher (multi-outlet owners), **Open/Closed truth banner**, **Alarm-health pill**
(ARMED/AT RISK → file `07` §6), connectivity dot. Dark-mode supported (kitchens are bright — default light).

## 17.1 Live Orders (alarm-first)
Queues: **New** (ringing; each card: code, items count, total, customer area, elapsed timer turning amber/red) →
**Preparing** (prep countdown, rider status chip: assigning/en-route/arrived) → **Ready** (awaiting pickup, QR prominent) →
**Completed today**. Incoming order = full-screen alarm (file `07`) → **Accept sheet:** item list, smart prep default
(file `12` §5) with −/+ stepper + chips (5–200, D-22), kitchen-load hint (“3 orders cooking now”), Accept (primary) /
Reject (reason chips: too busy, item unavailable, closing soon, other — rejection offers “mark item unavailable” shortcut).
Order detail: ticket §2.3 anatomy + timeline, money block (incl. “you keep ৳X”), customer note banner, rider card + mini-map,
actions: Call/Chat customer, Call/Chat rider, **Show pickup QR** (signed, rotating — file `22` §5), Mark ready (with
early-ready honesty: ready >5 min early repeatedly → coaching tip, riders see “usually ready on time” badge), Print ticket.
Missed/unreachable handling per file `07` §7; reopen check-in flow after offline (“You were unreachable 14 min — 1 order auto-cancelled” recap + re-arm test).

## 17.2 Overview (business at a glance)
Today/week/month cards: orders, revenue gross/net, avg prep, acceptance %, rating; sales chart (hourly/daily bars),
top items, peak heatmap; payout card (current week accrual → Saturday invoice preview, live from ledger);
alerts row (licence expiring, low rating trend, menu items without photos). All numbers drill into filtered lists.

## 17.3 Menu studio
Categories (drag-sort, available toggle, scheduled availability e.g. breakfast-only), Items CRUD wizard
(type chooser Simple/Sized/Bundle — §2.3, + duplicate, + convert-via-copy), photo via ImgBB pipeline (file `15`)
with crop guides, price + compare-at, VAT-inclusive note, variants & option groups editor (min/max, free/paid),
bundle slot builder, availability controls (now / until tomorrow / until date / sold-out-today), bulk tools
(price ±%, activate/deactivate category), menu health score (photos %, descriptions, dead items) with one-tap fixes.
Changes go live instantly (cache-bust via W1) — with “customer view” preview exactly as shoppers see it.

## 17.4 Growth (replaces Ads — D-12)
Analytics (impressions, menu views, CTR, conversion, customer mix new/occasional/frequent/reactivated — reference charts,
file `02` §2.3), **Ranking transparency:** your 10-factor scores vs zone median + concrete improvement quests
(“Add photos to 6 items → +visibility”), **Promotions builder** (Flash Box opt-in, % off menu/category, BOGO,
free-delivery-over-৳X, first-order; each with margin simulator showing post-commission keep), Reviews manager
(reply/dispute, aspect-tag summary, filters), Insights tips feed (data-driven, e.g. “Fridays 19:00 demand +40% — staff up”).

## 17.5 More (settings & finance)
Outlet profile (logo/cover/cuisines/about), Hours & holidays, Pause controls (15/30/60 min busy-pause, close-early today),
Pickup settings (D-24), Staff accounts (invite by phone, permission presets), **Finance:** weekly invoices (list → detail →
PDF download/share, states), payout account management (bKash recommended badge), transaction ledger viewer,
Documents vault (KYC status per doc, re-upload, expiry warnings), Alarm & notification settings + test alarm,
Printer setup (Bluetooth/USB thermal test print), Support chat, Legal, Logout.
Offline: actions queue with visible sync badge; Live Orders remains usable from cache with clear “you are offline” state —
but Open toggle auto-suspends ordering via presence law (file `12`) so customers never order into a void.
