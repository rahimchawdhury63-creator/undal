# 20 · Super Admin Panel (Web, Cloudflare Pages + Worker-3) — Enterprise Command

Design: dense, keyboard-fast, dark-header ops console (Undal brand file `25`), left nav by the founder's 9 domains,
global search (⌘K: order code, phone, vendor, rider), live badges (exceptions count), role-aware nav (RBAC file `09`).
**Feature contract = Appendix C registry** (each row: screen · capability · permission · priority). This file defines the
domains; Appendix C is the countable truth (D-14).

## 20.1 The 9 domains → Undal implementation

1. **Governance/Security:** Admin users & roles matrix UI, TOTP enforcement, session/device management, audit-log explorer
   (filter/export), platform settings centre (every constant in this guide, grouped, versioned diff + rollback),
   auth-provider plugins (D-09), API rate-limit & kill-switches (realtime mode, ordering pause per zone), health & quota gauges.
2. **Dispatch & Logistics:** Live map board (Leaflet: riders/vendors/orders, zone overlays, heat from SDR), order tower
   (stage columns + table toggle), manual interventions (assign/reassign/unassign/cancel — reason mandatory, money impact
   previewed), batching controls, rider fleet list (presence, session, cash-in-hand), SLA timers & breach list.
3. **Geofencing & Pricing:** Zone studio (file `14` §4), delivery-fee matrices per zone (distance tiers + free-over rules),
   fare/surge settings (file `11` §5) with simulator, weather override per zone, platform-fee setting.
4. **Vendor & Menu Hub:** Onboarding pipeline board (KYC stages file `21`), vendor 360° (profile, docs viewer with signed URLs,
   menu inspector/editor-assist, hours, performance, reviews, invoices), global menu moderation (flagged items/photos, price-cap
   policy tooling), commission display (global 15% — per-vendor override field exists but founder-locked default; any override
   audit-screams), emergency close/pause vendor, home-kitchen trust checklist manager.
5. **Finance:** Ledger explorer, weekly invoice centre (generate/verify/pay per file `10`, bulk ops, PDF), rider cash
   remittance review queue (TrxID checks), payout execution tracking (bKash/Nagad/Bank refs + proofs), adjustments/penalties
   with approval flow, unit-economics dashboard (per order/zone: commission, delivery fee, rider cost, margin), tax-pool report
   (5% stream incl. 3% rider bonus allocation), CSV exports (accounting-ready).
6. **Orders & Exceptions:** Live order tower, exception engine rules (no-accept 3 min, no-rider 4 min, rider stationary 10 min,
   prep overrun, ETA slip 10 min, chat unanswered — each: severity, auto-action, owner), order 360° (timeline replay from
   `order_events`, chat transcripts, call logs metadata, money snapshot, fare snapshot, FCM dispatch proof), modify-order tools
   (address fix, item adjust pre-prep, goodwill voucher).
7. **Marketing/Growth (no ads):** Campaign builder (Flash Box scheduler, funding splits, zone/vendor targeting, caps),
   voucher factory (codes, rules, budgets, fraud guards), home-module/banner manager, referral & rewards config,
   lifecycle nudge centre (file `13` §3, frequency caps), notification composer (segmented FCM+inbox, EN/BN, approval for large sends).
8. **Support & Disputes:** Unified inbox (customer/vendor/rider tickets + live order chats monitor), dispute workflows
   (missing item, late, quality — decision templates with money actions wired to adjustments), review moderation queue,
   canned replies EN/BN, SLA timers, customer 360° (history, trust score, COD limits).
9. **BI/Analytics:** Executive dashboard (GMV food, orders, AOV, completion %, avg delivery time, commission revenue,
   rider cost ratio — by zone/day/cuisine), funnel (impression→order), cohort retention, demand heatmap (hour×zone),
   report builder (save + schedule CSV to private bucket), data-quality monitors.

## 20.2 UX/engineering standards

Every list: server pagination, saved filters, bulk actions with confirm+preview, export. Every destructive/money action:
reason + audit + undo-window where safe. Realtime: order tower via 5 s polling + RTDB focus views (connection economy).
PDF invoice template designed here (brand, tables, QR verify). Accessibility + 240 px survival (ops on phones at 2 a.m. is real).
Admin domain separate Pages project; optional Cloudflare Access in front (free) as belt-and-braces (runbook choice).
