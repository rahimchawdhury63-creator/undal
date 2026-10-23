# 13 · The 10-Stage Ranking & Personalisation Engine (no ads. ever.)

**Pledge (D-12):** position cannot be bought. This file is Undal's constitution for discovery — published to vendors
in-app (“How ranking works”) so the algorithm itself builds trust.

## 13.1 Pipeline (per feed request: lat/lng, mode delivery|pickup, filters, user context)

| Stage | Name | What it does |
|---|---|---|
| 1 | **Eligibility gate** | Vendor approved + `operational_status=open` (or opens-soon pre-display labelled) + serves zone/radius + mode supported |
| 2 | **Geo feasibility** | Routed distance/ETA feasible per fleet reality (hide vendors no rider could serve hot; pickup: walking sanity distance) |
| 3 | **Quality floor** | Rating/reliability below hard floor → demote to “More places” section (never silently deleted; vendor sees why) |
| 4 | **Performance score** | `0.30 rating(90d, Bayesian-smoothed) + 0.20 prep reliability + 0.20 acceptance rate + 0.15 completion/on-time + 0.15 complaint-free rate` |
| 5 | **Speed score** | Live ETA (prep suggestion + fleet) normalised per zone — fast *now* beats fast on average |
| 6 | **Value score** | Effective price level (items + fees − active genuine discounts) vs cuisine-zone median; Flash Box participation counts here (real customer value, not payment to Undal) |
| 7 | **Personal affinity** | User's cuisine/dish/vendor history (decayed), favourites boost, dietary prefs (veg/spicy), time-of-day patterns — on-device signals + server history, never sold/shared |
| 8 | **Freshness & fairness exploration** | New-vendor discovery slots (labelled “New”), small controlled shuffle within score bands (±0.02) so equals rotate — prevents winner-take-all death spirals; home kitchens get fair exploration, not charity rank |
| 9 | **Diversity re-rank** | Cap consecutive same-cuisine cards (max 2), interleave price tiers — feed feels abundant, not monotonous |
| 10 | **Context modules** | Curated rails assembled from ranked pool: “Order again”, “Flash Box ending soon”, “Top rated near you”, “Home kitchens”, “Under 30 min”, “Because you loved {dish}” — each module labelled with its reason |

Sort/filter overrides (Fastest / Nearest / Top rated / Price) re-weight stages 4–6 deterministically (documented table in code).
Search ranking reuses stages 1–3 + text relevance (trigram + dish match depth) + stage 4 tiebreak.

## 13.2 Cold-start & integrity

New vendor: Bayesian rating prior = zone median (weight 10 pseudo-reviews) — neither buried nor gifted 5.0.
Review integrity: only delivered orders review; one review/order; velocity + device-graph abuse flags → Admin queue;
vendor replies never edit ratings. Performance aggregates recomputed nightly (+ incremental on order completion);
formula version stored (`rank_v1`) — weight changes ship as settings + ADR + vendor changelog post.

## 13.3 Reminders & lifecycle nudges (founder's “proper reminder” system, anti-spam capped)

Post-delivery rating ask (once, in-app + optional push after 45 min, never twice) · “Order again?” at user's usual meal
windows (max 3/week, quiet hours 23:00–08:00) · Favourite-vendor Flash Box start (opt-in per vendor) · Dormant-user
voucher (Admin campaign, frequency-capped) · Abandoned-cart single reminder (30 min). All via FCM data → local
notification + inbox; global opt-out honoured instantly; every campaign measurable (sent/opened/ordered) in Admin.

## 13.4 Analytics events (first-party, Postgres — feeds ranking + Growth tab)

`impression, menu_view, item_add, checkout_start, order_placed` (vendor-attributed, user-consented, aggregated daily,
raw pruned 30 d). Partner Growth charts (file `17`) render from these — the same numbers for vendor and Undal (no dark metrics).
