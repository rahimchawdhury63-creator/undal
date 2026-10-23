# Appendix C · Super Admin Feature Registry (the countable contract — guide file 20, D-14)

Every row = one implementable capability with a required permission. **P0 = launch-blocking** (all rows below are P0 unless
marked P1 in Build Ledger). Founder asked for “2000+ features”: Undal counts honestly — capabilities x (list/view/create/edit/
**Enumerated capabilities: 132 across 9 domains.** Each ships with: UI + W3 endpoint + permission + audit + test (file 26).

audit/export) surfaces multiply in implementation, but this registry is the auditable unit. Builder must not invent counts.

## Domain 1 Governance & Security  ·  default permission owner: `super_admin`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C1 | Admin users | Create/edit/deactivate admin accounts | `1.admin_users` |
| C2 | Admin users | Assign/revoke roles per user | `1.admin_users` |
| C3 | Admin users | Force password reset + TOTP re-enrol | `1.admin_users` |
| C4 | Roles matrix | Toggle permission per role (grid) | `1.roles_matrix` |
| C5 | Roles matrix | Create custom role from template | `1.roles_matrix` |
| C6 | Roles matrix | Permission diff preview before save | `1.roles_matrix` |
| C7 | Sessions | List active admin sessions/devices | `1.sessions` |
| C8 | Sessions | Revoke session | `1.sessions` |
| C9 | Sessions | Login history + failed attempts | `1.sessions` |
| C10 | Audit logs | Search by actor/action/entity/date | `1.audit_logs` |
| C11 | Audit logs | View before/after diff | `1.audit_logs` |
| C12 | Audit logs | Export CSV (audited) | `1.audit_logs` |
| C13 | Platform settings | Edit grouped settings with validation | `1.platform_settings` |
| C14 | Platform settings | Version history + rollback | `1.platform_settings` |
| C15 | Platform settings | Auth provider toggles (D-09) | `1.platform_settings` |
| C16 | Kill switches | Pause ordering globally/per zone | `1.kill_switches` |
| C17 | Kill switches | Realtime mode switch RTDB/polling | `1.kill_switches` |
| C18 | Kill switches | Maintenance banner EN/BN | `1.kill_switches` |
| C19 | Health | Worker/DB/RTDB/FCM/ImgBB/OSRM status | `1.health` |
| C20 | Health | Free-tier quota gauges | `1.health` |
| C21 | Health | Client error inbox + triage | `1.health` |

## Domain 2 Dispatch & Logistics  ·  default permission owner: `dispatcher`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C22 | Live map | Riders/vendors/active orders layers | `2.live_map` |
| C23 | Live map | Zone SDR heat shading | `2.live_map` |
| C24 | Live map | Click entity -> focus panel | `2.live_map` |
| C25 | Order tower | Stage columns board | `2.order_tower` |
| C26 | Order tower | Table view + saved filters | `2.order_tower` |
| C27 | Order tower | Exception-only filter | `2.order_tower` |
| C28 | Interventions | Assign rider manually | `2.interventions` |
| C29 | Interventions | Reassign with fare recompute | `2.interventions` |
| C30 | Interventions | Unassign to pool | `2.interventions` |
| C31 | Interventions | Cancel order (money preview) | `2.interventions` |
| C32 | Interventions | Force-complete with evidence | `2.interventions` |
| C33 | Interventions | Extend prep / edit ETA + notify | `2.interventions` |
| C34 | Fleet | Rider presence/session list | `2.fleet` |
| C35 | Fleet | Rider cash-in-hand overview | `2.fleet` |
| C36 | Fleet | Force session-end (safety) | `2.fleet` |
| C37 | Batching | View active batches + sequence | `2.batching` |
| C38 | Batching | Break batch manually | `2.batching` |
| C39 | SLA | Breach list + timers | `2.sla` |
| C40 | SLA | Assignment 'why this rider' inspector | `2.sla` |

## Domain 3 Geofencing & Pricing  ·  default permission owner: `ops_manager`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C41 | Zones | Create zone (draw polygon) | `3.zones` |
| C42 | Zones | Circle-template generator | `3.zones` |
| C43 | Zones | Edit/duplicate/deactivate zone | `3.zones` |
| C44 | Zones | Overlap warning resolver | `3.zones` |
| C45 | Delivery fees | Distance-tier matrix per zone | `3.delivery_fees` |
| C46 | Delivery fees | Free-over-threshold rules | `3.delivery_fees` |
| C47 | Delivery fees | Platform fee setting | `3.delivery_fees` |
| C48 | Fare engine | Base/per-km/included-km/floors per vehicle | `3.fare_engine` |
| C49 | Fare engine | Surge band bounds | `3.fare_engine` |
| C50 | Fare engine | Weather % + zone override | `3.fare_engine` |
| C51 | Fare engine | Traffic block value | `3.fare_engine` |
| C52 | Fare engine | Batch factors + wait-pay | `3.fare_engine` |
| C53 | Fare engine | Fare simulator (production function) | `3.fare_engine` |
| C54 | Radii | Bicycle/motorbike max radius per zone | `3.radii` |

## Domain 4 Vendor & Menu Hub  ·  default permission owner: `vendor_onboarding`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C55 | Pipeline | KYC stage board (3 tracks) | `4.pipeline` |
| C56 | Pipeline | Document viewer (signed URLs) | `4.pipeline` |
| C57 | Pipeline | Approve / request-fix per document | `4.pipeline` |
| C58 | Pipeline | Reject with reason + cool-off | `4.pipeline` |
| C59 | Pipeline | Expiry watchlist (licence/TIN) | `4.pipeline` |
| C60 | Vendor 360 | Profile/hours/payout view-edit | `4.vendor_360` |
| C61 | Vendor 360 | Performance + ranking factors | `4.vendor_360` |
| C62 | Vendor 360 | Invoices + ledger tab | `4.vendor_360` |
| C63 | Vendor 360 | Reviews tab | `4.vendor_360` |
| C64 | Vendor 360 | Emergency pause/close | `4.vendor_360` |
| C65 | Vendor 360 | Suspend/reactivate | `4.vendor_360` |
| C66 | Menu moderation | Flagged items/photos queue | `4.menu_moderation` |
| C67 | Menu moderation | Hide item / force photo fix | `4.menu_moderation` |
| C68 | Menu moderation | Price-cap policy alerts | `4.menu_moderation` |
| C69 | Catalog | Cuisine taxonomy editor | `4.catalog` |
| C70 | Catalog | Global item search across vendors | `4.catalog` |

## Domain 5 Finance  ·  default permission owner: `finance`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C71 | Invoices | Weekly list (rider Fri / vendor Sat) | `5.invoices` |
| C72 | Invoices | Line-level recompute verify | `5.invoices` |
| C73 | Invoices | Verify (dual-control) | `5.invoices` |
| C74 | Invoices | Mark PAID + TrxID/proof | `5.invoices` |
| C75 | Invoices | Dispute handling | `5.invoices` |
| C76 | Invoices | PDF regenerate/download | `5.invoices` |
| C77 | Invoices | Bulk verify | `5.invoices` |
| C78 | Remittances | Rider cash review queue | `5.remittances` |
| C79 | Remittances | Approve full/partial | `5.remittances` |
| C80 | Remittances | Reject with template | `5.remittances` |
| C81 | Adjustments | Create penalty/bonus | `5.adjustments` |
| C82 | Adjustments | Approve >threshold | `5.adjustments` |
| C83 | Adjustments | Dispute resolution | `5.adjustments` |
| C84 | Ledger | Actor ledger explorer | `5.ledger` |
| C85 | Ledger | Order money waterfall view | `5.ledger` |
| C86 | Reports | Unit economics per zone/order | `5.reports` |
| C87 | Reports | Tax-pool (5%) + bonus allocation | `5.reports` |
| C88 | Reports | Weekly settlement pack export | `5.reports` |
| C89 | Reports | Cash-position snapshot | `5.reports` |

## Domain 6 Orders & Exceptions  ·  default permission owner: `ops_manager`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C90 | Order 360 | Timeline replay | `6.order_360` |
| C91 | Order 360 | Money snapshot | `6.order_360` |
| C92 | Order 360 | Fare snapshot + inputs | `6.order_360` |
| C93 | Order 360 | Chat transcripts | `6.order_360` |
| C94 | Order 360 | FCM dispatch proof | `6.order_360` |
| C95 | Order 360 | Call-attempt log | `6.order_360` |
| C96 | Exceptions | Rule list + thresholds editor | `6.exceptions` |
| C97 | Exceptions | Acknowledge/assign/resolve | `6.exceptions` |
| C98 | Modify | Fix address/pin | `6.modify` |
| C99 | Modify | Adjust items pre-prep | `6.modify` |
| C100 | Modify | Issue goodwill voucher | `6.modify` |
| C101 | Search | By code/phone/name | `6.search` |

## Domain 7 Marketing & Growth (no ads)  ·  default permission owner: `ops_manager`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C102 | Flash Box | Create campaign + funding split | `7.flash_box` |
| C103 | Flash Box | Schedule + zone targeting | `7.flash_box` |
| C104 | Flash Box | Caps/budget guard | `7.flash_box` |
| C105 | Campaigns | Vendor opt-in manager | `7.campaigns` |
| C106 | Campaigns | Performance (orders/GMV/cost) | `7.campaigns` |
| C107 | Vouchers | Create code/rules/budget | `7.vouchers` |
| C108 | Vouchers | Redemption + fraud report | `7.vouchers` |
| C109 | Banners | Home modules manager | `7.banners` |
| C110 | Referrals | Rewards config | `7.referrals` |
| C111 | Nudges | Lifecycle message composer EN/BN | `7.nudges` |
| C112 | Nudges | Segment + frequency caps | `7.nudges` |
| C113 | Nudges | Send approval + results | `7.nudges` |

## Domain 8 Support & Disputes  ·  default permission owner: `support`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C114 | Inbox | Unified ticket queue | `8.inbox` |
| C115 | Inbox | Ticket assign/SLA/escalate | `8.inbox` |
| C116 | Inbox | Canned replies EN/BN | `8.inbox` |
| C117 | Live chats | Active-order chat monitor | `8.live_chats` |
| C118 | Disputes | Missing item workflow | `8.disputes` |
| C119 | Disputes | Late/quality workflow | `8.disputes` |
| C120 | Disputes | Money action (adjustment/voucher) | `8.disputes` |
| C121 | Reviews | Moderation queue | `8.reviews` |
| C122 | Reviews | Hide/restore + appeal | `8.reviews` |
| C123 | Customer 360 | History/trust/COD limits | `8.customer_360` |
| C124 | Customer 360 | Warn/limit/suspend (audited) | `8.customer_360` |

## Domain 9 BI & Analytics  ·  default permission owner: `compliance_auditor(read)`

| # | Module | Capability | Permission key |
|---|---|---|---|
| C125 | Executive | GMV/orders/AOV/completion KPIs | `9.executive` |
| C126 | Executive | Zone comparison | `9.executive` |
| C127 | Funnels | Impression->order funnel | `9.funnels` |
| C128 | Cohorts | Retention cohorts | `9.cohorts` |
| C129 | Demand | Hour x zone heatmap | `9.demand` |
| C130 | Reports | Saved report builder | `9.reports` |
| C131 | Reports | Scheduled CSV to private bucket | `9.reports` |
| C132 | Quality | Data-quality monitors | `9.quality` |
