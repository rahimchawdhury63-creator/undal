# 07 · Final Super Admin Registry (`Appendix C` — All `132` P0 Capabilities Confirmed)

> **Plan Response 2 Frozen Capability Registry** · Directly drives **`Build Responses 10–11`** (`W3`) and **`Build Responses 25–28`** (`apps/admin_web`)  
> **Honesty Rule (`File 20`, `Appendix C`):** Every single one of the **132 capabilities (`C1–C132`)** below is **P0 launch-blocking** and ships with **(1) real UI in `apps/admin_web`**, **(2) real `W3` endpoint**, **(3) server-enforced permission key**, **(4) immutable `audit_logs` write**, and **(5) automated test coverage** so **`132 / 132`** are ticked in `Build Response 28`. Zero rows are elided or inflated.

---

## Domain 1 · Governance & Security (`C1–C21` · Default Role: `super_admin` · `Build 25`)

| ID | Module | Capability | Permission | Screen | W3 Endpoint & Audit Action |
|---|---|---|---|---|---|
| `C1` | Admin users | Create/edit/deactivate admin accounts | `1.admin_users` | `a-29` | `POST/PATCH /v1/admin/users` (`admin.user.upsert`, `TOTP✓`) |
| `C2` | Admin users | Assign/revoke roles per user | `1.admin_users` | `a-29` | `PUT /v1/admin/users/{id}/roles` (`admin.user.roles`, `TOTP✓`) |
| `C3` | Admin users | Force password reset + TOTP re-enrol | `1.admin_users` | `a-29` | `POST /v1/admin/users/{id}/reset-totp` (`admin.user.reset_auth`, `TOTP✓`) |
| `C4` | Roles matrix | Toggle permission per role (grid) | `1.roles_matrix` | `a-30` | `PUT /v1/admin/roles/{id}/permissions` (`admin.role.perms`, `TOTP✓`) |
| `C5` | Roles matrix | Create custom role from template | `1.roles_matrix` | `a-30` | `POST /v1/admin/roles` (`admin.role.create`, `TOTP✓`) |
| `C6` | Roles matrix | Permission diff preview before save | `1.roles_matrix` | `a-30` | `POST /v1/admin/roles/preview-diff` (dry-run impact counter) |
| `C7` | Sessions | List active admin sessions/devices | `1.sessions` | `a-29` | `GET /v1/admin/sessions` |
| `C8` | Sessions | Revoke session immediately | `1.sessions` | `a-29` | `DELETE /v1/admin/sessions/{id}` (`admin.session.revoke`, `TOTP✓`) |
| `C9` | Sessions | Login history + failed attempts | `1.sessions` | `a-29` | `GET /v1/admin/sessions/history` |
| `C10` | Audit logs | Search by actor/action/entity/date | `1.audit_logs` | `a-31` | `GET /v1/admin/audit` |
| `C11` | Audit logs | View structured before/after JSON diff | `1.audit_logs` | `a-31` | `GET /v1/admin/audit/{id}` |
| `C12` | Audit logs | Export filtered CSV (audited) | `1.audit_logs` | `a-31` | `POST /v1/admin/audit/export` (`admin.audit.export`) |
| `C13` | Platform settings | Edit grouped settings (`62` keys) with Zod validation | `1.platform_settings` | `a-32` | `PATCH /v1/admin/settings` (`settings.update`, `TOTP✓`) |
| `C14` | Platform settings | Version history + 1-click rollback | `1.platform_settings` | `a-32` | `POST /v1/admin/settings/rollback` (`settings.rollback`, `TOTP✓`) |
| `C15` | Platform settings | OAuth/OTP auth provider toggles (`D-09`) | `1.platform_settings` | `a-32` | `PATCH /v1/admin/settings` (`auth.providers.*`, `TOTP✓`) |
| `C16` | Kill switches | Pause ordering globally or per zone | `1.kill_switches` | `a-33` | `POST /v1/admin/kill-switches` (`killswitch.ordering`, `TOTP✓`) |
| `C17` | Kill switches | Switch realtime mode (`RTDB` ↔ `HTTP poll`) | `1.kill_switches` | `a-33` | `POST /v1/admin/kill-switches` (`killswitch.realtime`, `TOTP✓`) |
| `C18` | Kill switches | Publish bilingual EN/BN maintenance banner | `1.kill_switches` | `a-33` | `POST /v1/admin/kill-switches` (`killswitch.banner`, `TOTP✓`) |
| `C19` | Health | Live status across W1/W2/W3, DB, RTDB, FCM, ImgBB, OSRM, Weather | `1.health` | `a-29` | `GET /v1/admin/health/deep` |
| `C20` | Health | Free-tier quota gauges (`500MB` DB, `1GB` Storage, `100` RTDB conns, `100K/d` Workers) | `1.health` | `a-29` | `GET /v1/admin/health/quotas` |
| `C21` | Health | Client error inbox + status triage (`open/resolved/ignored`) | `1.health` | `a-29` | `GET/PATCH /v1/admin/errors` (`health.error.triage`) |

---

## Domain 2 · Dispatch & Logistics (`C22–C40` · Default Role: `dispatcher` · `Build 25`)

| ID | Module | Capability | Permission | Screen | W3 Endpoint & Audit Action |
|---|---|---|---|---|---|
| `C22` | Live map | Multi-layer OSM map (online riders, open kitchens, active orders) | `2.live_map` | `a-15` | `GET /v1/admin/dispatch/map` |
| `C23` | Live map | Live Zone Supply/Demand Ratio (SDR) polygon shading | `2.live_map` | `a-15` | `GET /v1/admin/dispatch/map?layers=sdr` |
| `C24` | Live map | Click rider/vendor/order pin → live side inspector drawer | `2.live_map` | `a-15` | `GET /v1/admin/dispatch/entity/{kind}/{id}` |
| `C25` | Order tower | Real-time Kanban columns by stage (`PLACED` → `PICKED_UP`) | `2.order_tower` | `a-16` | `GET /v1/admin/dispatch/board` |
| `C26` | Order tower | High-density table view + saved filter presets | `2.order_tower` | `a-16` | `GET /v1/admin/dispatch/board?view=table` |
| `C27` | Order tower | 1-click **Exceptions Only** filter (stuck `>3m`, unaccepted, late pickup) | `2.order_tower` | `a-16` | `GET /v1/admin/dispatch/board?exceptions_only=1` |
| `C28` | Interventions | Assign specific online rider manually | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/assign` (`dispatch.assign`) |
| `C29` | Interventions | Reassign rider with automatic live fare recompute | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/reassign` (`dispatch.reassign`) |
| `C30` | Interventions | Unassign rider back to auto-dispatch pool | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/unassign` (`dispatch.unassign`) |
| `C31` | Interventions | Cancel order with exact vendor/rider money impact preview | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/cancel` (`dispatch.cancel`, `TOTP✓`) |
| `C32` | Interventions | Force-complete delivery with mandatory evidence & ledger write | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/force-complete` (`dispatch.force_complete`, `TOTP✓`) |
| `C33` | Interventions | Extend prep time / edit promised ETA + notify customer | `2.interventions` | `a-16` | `POST /v1/admin/orders/{id}/eta` (`dispatch.eta`) |
| `C34` | Fleet | Active rider presence, battery %, GPS freshness & session list | `2.fleet` | `a-17` | `GET /v1/admin/fleet/riders` |
| `C35` | Fleet | Real-time rider COD cash-in-hand vs ceiling overview | `2.fleet` | `a-17` | `GET /v1/admin/fleet/cash` |
| `C36` | Fleet | Force rider session-end (safety / stale device) | `2.fleet` | `a-17` | `POST /v1/admin/riders/{id}/end-session` (`fleet.end_session`) |
| `C37` | Batching | Inspect active 2-order batches + stop sequence on map | `2.batching` | `a-17` | `GET /v1/admin/batches` |
| `C38` | Batching | Break batch manually & re-dispatch second order | `2.batching` | `a-17` | `POST /v1/admin/batches/{id}/break` (`dispatch.break_batch`) |
| `C39` | SLA | Live SLA breach queue with ticking countdown timers | `2.sla` | `a-16` | `GET /v1/admin/sla/breaches` |
| `C40` | SLA | Explainability drawer: **`"Why this rider?"`** score breakdown (`score_factors`) | `2.sla` | `a-16` | `GET /v1/admin/orders/{id}/offers-trace` |

---

## Domain 3 · Geofencing & Dynamic Pricing (`C41–C54` · Default Role: `ops_manager` · `Build 26`)

| ID | Module | Capability | Permission | Screen | W3 Endpoint & Audit Action |
|---|---|---|---|---|---|
| `C41` | Zones | Draw/create delivery zone polygon on interactive Leaflet map | `3.zones` | `a-18` | `POST /v1/admin/zones` (`zone.create`, `TOTP✓`) |
| `C42` | Zones | 1-click N-point circle polygon generator from center pin + km radius | `3.zones` | `a-18` | `POST /v1/admin/zones/circle-preview` |
| `C43` | Zones | Edit vertices, duplicate, activate (**Kulaura 1-tap launch!**) or pause zone | `3.zones` | `a-18` | `PATCH /v1/admin/zones/{id}` (`zone.update`, `TOTP✓`) |
| `C44` | Zones | Automatic polygon self-intersection & cross-zone overlap detector | `3.zones` | `a-18` | `POST /v1/admin/zones/validate` |
| `C45` | Delivery fees | Configure per-zone distance-tier customer delivery fee matrix (poisha) | `3.delivery_fees` | `a-19` | `PATCH /v1/admin/zones/{id}/fees` (`pricing.delivery_tiers`, `TOTP✓`) |
| `C46` | Delivery fees | Configure free-delivery minimum basket rules per zone | `3.delivery_fees` | `a-19` | `PATCH /v1/admin/zones/{id}/fees` (`pricing.free_threshold`, `TOTP✓`) |
| `C47` | Delivery fees | Configure platform service fee (`500` poisha default) | `3.delivery_fees` | `a-19` | `PATCH /v1/admin/settings` (`pricing.platform_fee`, `TOTP✓`) |
| `C48` | Fare engine | Edit base fare, per-km poisha, included km & minimum floor (`motorbike` vs `bicycle`) | `3.fare_engine` | `a-20` | `PATCH /v1/admin/fare-config` (`fare.vehicle_rates`, `TOTP✓`) |
| `C49` | Fare engine | Edit SDR surge bands & maximum cap (`1.00x – 1.80x`) | `3.fare_engine` | `a-20` | `PATCH /v1/admin/fare-config` (`fare.surge_bands`, `TOTP✓`) |
| `C50` | Fare engine | Configure weather boost % + manual per-zone rain/storm override | `3.fare_engine` | `a-20` | `POST /v1/admin/zones/{id}/weather-override` (`fare.weather_override`) |
| `C51` | Fare engine | Configure traffic congestion per-block poisha bonus | `3.fare_engine` | `a-20` | `PATCH /v1/admin/fare-config` (`fare.traffic`, `TOTP✓`) |
| `C52` | Fare engine | Configure batch drop-off factor + kitchen wait-time pay rate | `3.fare_engine` | `a-20` | `PATCH /v1/admin/fare-config` (`fare.batch_wait`, `TOTP✓`) |
| `C53` | Fare engine | Interactive **Live Fare Simulator** calling real shared `calculateRiderFare()` | `3.fare_engine` | `a-20` | `POST /v1/admin/fare/simulate` |
| `C54` | Radii | Set max delivery radius per zone (`Bicycle 3.5 km` vs `Motorbike 8.0 km`) | `3.radii` | `a-18` | `PATCH /v1/admin/zones/{id}` (`zone.radii`) |

---

## Domain 4 · Vendor & Menu Hub (`C55–C70` · Default Role: `vendor_onboarding` · `Build 26`)

| ID | Module | Capability | Permission | Screen | W3 Endpoint & Audit Action |
|---|---|---|---|---|---|
| `C55` | Pipeline | 3-track KYC Kanban board (`Restaurant`, `Home Kitchen`, `Cloud Kitchen` + Riders) | `4.pipeline` | `a-06` | `GET /v1/admin/kyc/queue` |
| `C56` | Pipeline | Side-by-side private KYC document viewer (120s audited signed URLs) | `4.pipeline` | `a-07` | `POST /v1/images/private-view-url` (`kyc.doc.view`) |
| `C57` | Pipeline | Per-document `Approve` or `Request Fix` with bilingual note | `4.pipeline` | `a-07` | `POST /v1/admin/kyc/{type}/{id}/decide` (`kyc.doc.decide`) |
| `C58` | Pipeline | Reject application with structured reason + cool-off window | `4.pipeline` | `a-07` | `POST /v1/admin/kyc/{type}/{id}/decide` (`kyc.reject`) |
| `C59` | Pipeline | Trade licence / driving licence / tax token expiry watchlist (`30d/7d/expired`) | `4.pipeline` | `a-06` | `GET /v1/admin/kyc/expiring` |
| `C60` | Vendor 360 | View/edit vendor profile, commission bps, hours & payout metadata | `4.vendor_360` | `a-09` | `GET/PATCH /v1/admin/vendors/{id}` (`vendor.update`, `TOTP✓` on bps/payout) |
| `C61` | Vendor 360 | Inspect transparent `rank_v1` score breakdown & ops health | `4.vendor_360` | `a-09` | `GET /v1/admin/vendors/{id}/ranking` |
| `C62` | Vendor 360 | Vendor weekly invoices & ledger tab | `4.vendor_360` | `a-09` | `GET /v1/admin/vendors/{id}/finance` |
| `C63` | Vendor 360 | Vendor customer reviews + aggregated rider pickup feedback tab | `4.vendor_360` | `a-09` | `GET /v1/admin/vendors/{id}/reviews` |
| `C64` | Vendor 360 | Emergency kitchen pause / temporary close | `4.vendor_360` | `a-09` | `POST /v1/admin/vendors/{id}/pause` (`vendor.emergency_pause`) |
| `C65` | Vendor 360 | Suspend or reactivate vendor storefront | `4.vendor_360` | `a-09` | `POST /v1/admin/vendors/{id}/suspend` (`vendor.suspend`, `TOTP✓`) |
| `C66` | Menu moderation | Queue of flagged dishes, duplicate spam (`AP-9`) & low-quality photos | `4.menu_moderation` | `a-13` | `GET /v1/admin/menu/moderation` |
| `C67` | Menu moderation | Hide dish immediately or request photo replacement | `4.menu_moderation` | `a-13` | `POST /v1/admin/menu/items/{id}/moderate` (`menu.moderate`) |
| `C68` | Menu moderation | Inflated `compare_at_poisha` / menu price-parity policy alerts | `4.menu_moderation` | `a-13` | `GET /v1/admin/menu/price-alerts` |
| `C69` | Catalog | Bilingual `EN/বাংলা` cuisine taxonomy & Banglish synonym editor | `4.catalog` | `a-14` | `POST/PATCH /v1/admin/taxonomy` (`catalog.taxonomy`) |
| `C70` | Catalog | Instant cross-vendor dish search & bulk inspection | `4.catalog` | `a-14` | `GET /v1/admin/catalog/search` |

---

## Domain 5 · Finance, Weekly Settlement & Cash Gate (`C71–C89` · Default Role: `finance` · `Build 27`)

| ID | Module | Capability | Permission | Screen | W3 Endpoint & Audit Action |
|---|---|---|---|---|---|
| `C71` | Invoices | Weekly invoice queue (`Rider` Friday `00:05`, `Partner` Saturday `00:05`) | `5.invoices` | `a-22` | `GET /v1/admin/invoices` |
| `C72` | Invoices | Line-by-line order vs `ledger_entries` zero-drift recompute check | `5.invoices` | `a-22` | `GET /v1/admin/invoices/{id}/recompute` |
| `C73` | Invoices | Mark invoice `VERIFIED` (**dual-control: verifier ≠ payer enforced!**) | `5.invoices` | `a-22` | `POST /v1/admin/invoices/{id}/verify` (`invoice.verify`, `TOTP✓`) |
| `C74` | Invoices | Mark invoice `PAID` with `bKash/Nagad/Bank TrxID` + private proof upload | `5.invoices` | `a-22` | `POST /v1/admin/invoices/{id}/pay` (`invoice.pay`, `TOTP✓`) |
| `C75` | Invoices | Hold/resolve disputed invoice with adjustment link | `5.invoices` | `a-22` | `POST /v1/admin/invoices/{id}/dispute` (`invoice.dispute`) |
| `C76` | Invoices | Generate/download printable bilingual statement HTML/PDF | `5.invoices` | `a-22` | `GET /v1/admin/invoices/{id}/pdf` |
| `C77` | Invoices | Bulk verify zero-discrepancy statements + lazy-trigger generator (`POST /generate`) | `5.invoices` | `a-22` | `POST /v1/admin/invoices/bulk-verify` (`invoice.bulk_verify`, `TOTP✓`) |
| `C78` | Remittances | Rider COD cash remittance review queue (side-by-side `TrxID` + screenshot) | `5.remittances` | `a-23` | `GET /v1/admin/remittances` |
| `C79` | Remittances | Approve full or partial remitted poisha → auto-unlocks Rider Cash Gate | `5.remittances` | `a-23` | `POST /v1/admin/remittances/{id}/decide` (`remittance.approve`, `TOTP✓`) |
| `C80` | Remittances | Reject remittance with bilingual template reason | `5.remittances` | `a-23` | `POST /v1/admin/remittances/{id}/decide` (`remittance.reject`) |
| `C81` | Adjustments | Create reason-coded penalty or bonus adjustment (`vendor` / `rider`) | `5.adjustments` | `a-24` | `POST /v1/admin/adjustments` (`adjustment.create`) |
| `C82` | Adjustments | Dual-control approval required above configurable poisha threshold | `5.adjustments` | `a-24` | `POST /v1/admin/adjustments/{id}/approve` (`adjustment.approve`, `TOTP✓`) |
| `C83` | Adjustments | Partner/Rider adjustment appeal review & reversal | `5.adjustments` | `a-24` | `POST /v1/admin/adjustments/{id}/resolve` (`adjustment.resolve`) |
| `C84` | Ledger | Immutable actor ledger explorer (`vendor`, `rider`, `undal` revenue/promo accounts) | `5.ledger` | `a-24` | `GET /v1/admin/ledger` |
| `C85` | Ledger | Single-order full poisha waterfall inspector (`M-1..M-8` breakdown) | `5.ledger` | `a-24` | `GET /v1/admin/orders/{id}/waterfall` |
| `C86` | Reports | Unit economics report per zone & order cohort (margin poisha/order) | `5.reports` | `a-25` | `GET /v1/admin/finance/reports/unit-economics` |
| `C87` | Reports | Extracted VAT (`5/105` informational summary) + `3%` rider bonus pool tracker | `5.reports` | `a-25` | `GET /v1/admin/finance/reports/tax-and-pool` |
| `C88` | Reports | Weekly settlement CSV pack export for mobile banking batch payout | `5.reports` | `a-25` | `POST /v1/admin/finance/reports/settlement-pack` (`finance.export`) |
| `C89` | Reports | Real-time platform COD cash-position snapshot (street cash vs verified remittances) | `5.reports` | `a-25` | `GET /v1/admin/finance/reports/cash-position` |

---

## Domains 6–9 · Orders 360, Growth (Zero Ads), Support & BI (`C90–C132` · `Build 27–28`)

| ID | Domain · Module | Capability | Permission | Screen | W3 Endpoint & Build |
|---|---|---|---|---|---|
| `C90` | D6 · Order 360 | Full monotonic `order_events` timeline replay | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C91` | D6 · Order 360 | Immutable order poisha snapshot & voucher/campaign attribution | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C92` | D6 · Order 360 | Rider dynamic fare snapshot + weather/SDR/distance inputs | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C93` | D6 · Order 360 | Read-only order chat transcripts (`c_r`, `c_v`, `r_v`) | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C94` | D6 · Order 360 | `fcm_dispatch_log` message IDs, delivery timestamps & device state proof | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C95` | D6 · Order 360 | Rider/Partner call-attempt & GPS dwell verification log (`File 22 §22.5`) | `6.order_360` | `a-11` | `GET /v1/admin/orders/{id}/360` (`B27`) |
| `C96` | D6 · Exceptions | Automated exception rule thresholds editor | `6.exceptions` | `a-12` | `GET/PATCH /v1/admin/exceptions/rules` (`B27`) |
| `C97` | D6 · Exceptions | Claim, assign & resolve live operational exceptions | `6.exceptions` | `a-12` | `POST /v1/admin/exceptions/{id}/resolve` (`B27`) |
| `C98` | D6 · Modify | Correct customer pin/address mid-order + recompute rider distance delta | `6.modify` | `a-11` | `POST /v1/admin/orders/{id}/modify` (`B27`) |
| `C99` | D6 · Modify | Partial item removal/adjustment pre-prep (`refunded_qty` recalculation) | `6.modify` | `a-11` | `POST /v1/admin/orders/{id}/modify` (`B27`) |
| `C100` | D6 · Modify | Issue single-use goodwill compensation voucher (`TOTP✓`) | `6.modify` | `a-11` | `POST /v1/admin/orders/{id}/goodwill-voucher` (`B27`) |
| `C101` | D6 · Search | Global instant order search by `UD-*` code, BD phone, customer/vendor name | `6.search` | `a-10` | `GET /v1/admin/orders/search` (`B27`) |
| `C102` | D7 · Flash Box | Create time-boxed **Flash Box** co-funded deal (`D-11`) | `7.flash_box` | `a-26` | `POST /v1/admin/campaigns` (`B28`) |
| `C103` | D7 · Flash Box | Daypart time-window (`15:00–17:30`) + multi-zone targeting | `7.flash_box` | `a-26` | `PATCH /v1/admin/campaigns/{id}` (`B28`) |
| `C104` | D7 · Flash Box | Hard poisha budget cap + automatic shutoff when exhausted | `7.flash_box` | `a-26` | `PATCH /v1/admin/campaigns/{id}` (`B28`) |
| `C105` | D7 · Campaigns | Vendor campaign opt-in / invitation manager | `7.campaigns` | `a-26` | `POST /v1/admin/campaigns/{id}/vendors` (`B28`) |
| `C106` | D7 · Campaigns | Campaign ROI analytics (incremental orders, GMV, Undal promo spend) | `7.campaigns` | `a-26` | `GET /v1/admin/campaigns/{id}/stats` (`B28`) |
| `C107` | D7 · Vouchers | Create voucher codes, min basket, per-user limits & funding split | `7.vouchers` | `a-26` | `POST/PATCH /v1/admin/vouchers` (`B28`) |
| `C108` | D7 · Vouchers | Voucher redemption audit & multi-account abuse alerts | `7.vouchers` | `a-26` | `GET /v1/admin/vouchers/redemptions` (`B28`) |
| `C109` | D7 · Banners | Home hero/carousel banner manager (ImgBB upload + deep link + schedule) | `7.banners` | `a-27` | `CRUD /v1/admin/banners` (`B28`) |
| `C110` | D7 · Referrals | Customer/Rider referral reward poisha rules config | `7.referrals` | `a-26` | `PATCH /v1/admin/referrals` (`B28`) |
| `C111` | D7 · Nudges | Bilingual `EN/বাংলা` push/inbox lifecycle message composer | `7.nudges` | `a-27` | `POST /v1/admin/nudges/draft` (`B28`) |
| `C112` | D7 · Nudges | Cohort segment builder + anti-spam daily/weekly frequency cap | `7.nudges` | `a-27` | `POST /v1/admin/nudges/preview` (`B28`) |
| `C113` | D7 · Nudges | Step-up send approval + delivery/open conversion metrics (`TOTP✓`) | `7.nudges` | `a-27` | `POST /v1/admin/nudges/{id}/send` (`B28`) |
| `C114` | D8 · Inbox | Unified support queue (Customers, Partners, Riders) | `8.inbox` | `a-28` | `GET /v1/admin/support/threads` (`B28`) |
| `C115` | D8 · Inbox | Ticket claim, SLA countdown timer & priority escalation | `8.inbox` | `a-28` | `PATCH /v1/admin/support/threads/{id}` (`B28`) |
| `C116` | D8 · Inbox | Bilingual `EN/বাংলা` canned response templates | `8.inbox` | `a-28` | `CRUD /v1/admin/support/templates` (`B28`) |
| `C117` | D8 · Live chats | Active-order chat monitor for stuck/SOS orders | `8.live_chats` | `a-28` | `GET /v1/admin/chats/live` (`B28`) |
| `C118` | D8 · Disputes | Missing/wrong item evidence workflow (side-by-side customer photo + receipt) | `8.disputes` | `a-28` | `POST /v1/admin/disputes/{id}/resolve` (`B28`) |
| `C119` | D8 · Disputes | Cold food / late delivery root-cause split (`ready_at` vs `picked_at` proof!) | `8.disputes` | `a-28` | `POST /v1/admin/disputes/{id}/resolve` (`B28`) |
| `C120` | D8 · Disputes | Atomic dispute money action (vendor adjustment + customer voucher, `TOTP✓`) | `8.disputes` | `a-28` | `POST /v1/admin/disputes/{id}/resolve` (`B28`) |
| `C121` | D8 · Reviews | Flagged customer reviews & vendor report queue | `8.reviews` | `a-28` | `GET /v1/admin/reviews/queue` (`B28`) |
| `C122` | D8 · Reviews | Hide/restore review + notify author/vendor with reason | `8.reviews` | `a-28` | `POST /v1/admin/reviews/{id}/moderate` (`B28`) |
| `C123` | D8 · Customer 360 | Customer order history, failed-COD count, `trust_score` & COD ceiling | `8.customer_360` | `a-05` | `GET /v1/admin/customers/{id}` (`B28`) |
| `C124` | D8 · Customer 360 | Warn, lower COD basket cap, or suspend abusive account (`TOTP✓`, audited) | `8.customer_360` | `a-05` | `POST /v1/admin/customers/{id}/action` (`B28`) |
| `C125` | D9 · Executive | Executive KPI cockpit (GMV, net revenue, orders, AOV, completion %, SLA %) | `9.executive` | `a-03` | `GET /v1/admin/dashboard/kpis` (`B28`) |
| `C126` | D9 · Executive | Multi-zone side-by-side comparison (`Sylhet Sadar` vs `Kulaura`...) | `9.executive` | `a-03` | `GET /v1/admin/bi/executive` (`B28`) |
| `C127` | D9 · Funnels | Conversion funnel (`Home Feed → Storefront → Cart → Checkout → Delivered`) | `9.funnels` | `a-04` | `GET /v1/admin/bi/funnels` (`B28`) |
| `C128` | D9 · Cohorts | Weekly/monthly customer & kitchen retention cohort table | `9.cohorts` | `a-04` | `GET /v1/admin/bi/cohorts` (`B28`) |
| `C129` | D9 · Demand | Hour × Zone order & unfulfilled-search demand heatmap | `9.demand` | `a-04` | `GET /v1/admin/bi/demand` (`B28`) |
| `C130` | D9 · Reports | Parameterised saved report builder (`zone`, `date range`, `group_by`) | `9.reports` | `a-04` | `CRUD /v1/admin/bi/saved-reports` (`B28`) |
| `C131` | D9 · Reports | Scheduled weekly CSV report archived to private Supabase bucket | `9.reports` | `a-04` | `POST /v1/admin/bi/saved-reports/{id}/run` (`B28`) |
| `C132` | D9 · Quality | Ledger-sum vs order-sum & orphan-offer data-integrity monitor (`0` drift check!) | `9.quality` | `a-04` | `GET /v1/admin/bi/quality` (`B28`) |
