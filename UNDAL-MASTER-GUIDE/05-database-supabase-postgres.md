# 05 · Supabase / PostgreSQL — System of Record

Full column dictionary: **Appendix B** (generated from this spec; builder keeps it in sync via migration comments).
Extensions: `pgcrypto` (UUIDs), `pg_trgm` (search), `postgis` **optional** — v1 uses lat/lng + geohash + Haversine SQL
to stay lean; enable PostGIS only if zone-polygon queries outgrow the app-side point-in-polygon cache (file `14`).

## 5.1 Core tables (grouped; every table: `id`, `created_at`, `updated_at`, soft-delete `deleted_at` where noted)

**Identity & access**
- `profiles` (1:1 `auth.users`): `role` (`customer|vendor_owner|vendor_staff|rider|admin`), `full_name`, `phone` (BD `^01[3-9]\d{8}$`),
  `avatar_url` (ImgBB), `language`, `status` (`active|suspended|deleted`), `fcm_tokens` in child table.
- `device_tokens`: `profile_id`, `platform`, `fcm_token`, `app_flavor`, `last_seen_at`, unique(token).
- `admin_roles` / `admin_permissions` / `admin_user_roles`: RBAC matrix (file `09`); `audit_logs` (append-only).
- `customer_addresses`: `label`, `lat/lng/geohash`, `address_text`, `delivery_instructions`, `is_default`, `zone_id` (resolved at save).

**Vendors & catalog**
- `vendors`: `owner_profile_id`, `type` (`RESTAURANT|HOME_KITCHEN|CLOUD_KITCHEN`), `legal_name`, `brand_name`, `slug` unique,
  `lat/lng/geohash`, `address_text`, `zone_id`, `logo_url/cover_url` (ImgBB), `cuisines text[]` (FK-checked against taxonomy),
  `kyc_status` (`draft|submitted|under_review|approved|rejected|needs_fix`), `operational_status` (derived, never hand-set:
  `open|closed_hours|paused|offline|suspended`), `accepts_pickup bool`, `pickup_point_label`, `min_open_compliant bool`,
  rating aggregates (`rating_avg`, `rating_count`), performance aggregates (`avg_prep_min`, `acceptance_rate`, …).
- `vendor_hours` (per weekday open/close, split shifts ×2), `vendor_pauses` (busy-pause with auto-resume),
  `vendor_payout_accounts` (`method bkash|nagad|bank`, masked display, encrypted account no. via pgcrypto + Worker-only decrypt),
  `vendor_documents` (private-bucket paths, `doc_type`, `review_status`, reviewer, expiry for trade licence).
- `menu_categories` (per vendor, sort), `menu_items` (`name_en/name_bn`, `description`, `price_poisha`, `compare_at_poisha`,
  `image_url`, `item_type simple|sized|bundle`, `is_available`, `unavailable_until`, `spicy_level`, `is_veg`, `halal` default true BD,
  `serves`, `prep_weight` (kitchen load units)), `variant_groups`+`variants`, `option_groups`+`options` (min/max, price delta),
  `bundle_slots`+`bundle_slot_choices`. All customer-visible prices VAT-inclusive (D-08).

**Riders**
- `riders`: `profile_id`, `vehicle_type motorbike|bicycle`, `kyc_status`, `home_zone_id`, `payout_account_id`,
  aggregates (`rating_avg`, `completion_rate`, `cash_in_hand_poisha` — ledger-derived, cached).
- `rider_documents`, `rider_shifts` (`started_at/ended_at`, `vehicle_confirmed`, `selfie_path`), `rider_location_daily`
  (rollup: km travelled, online minutes — raw breadcrumbs stay in RTDB/telemetry table with 7-day prune job).

**Commerce (the heart)**
- `zones`: `name`, `polygon jsonb` (array of [lng,lat]), `center`, `is_active`, fee overrides, surge config ref.
- `carts` (server-side, 1 active/customer) + `cart_items` (with chosen variants/options JSON snapshot + unit price snapshot).
- `orders`: `public_code`, `customer_id`, `vendor_id`, `rider_id?`, `zone_id`, `fulfilment delivery|pickup`,
  `status` (state machine file `22`), address snapshot, vendor location snapshot, `prep_minutes_committed`,
  money snapshot columns (each `*_poisha`: items, discount_total, discount_vendor_funded, discount_platform_funded,
  delivery_fee_charged, platform_fee, tip, tax_included_extracted, cod_collect, rider_fare_total, rider_bonus,
  vendor_commission, vendor_net), `voucher_id?`, `campaign_id?`, `is_priority`, `batch_id?`, timestamps per state.
- `order_items` (full snapshot incl. names — history must survive menu edits), `order_events` (append-only audit spine),
  `order_offers` (rider offer attempts: rider, fare snapshot, response, reason), `order_batches` (bundled pickups, file `12`).
- `vouchers` + `voucher_redemptions` (unique per user/code rules), `campaigns` (Flash Box etc., funding split, windows, caps),
  `campaign_vendors` (opt-ins), `reviews` (vendor + rider, aspect tags, photos, reply, moderation status),
  `favourites`, `chats` + `chat_messages` (order-scoped rooms + support tickets in `support_threads`).

**Money & settlement**
- `ledger_entries` (double-entry-lite: every poisha movement with `actor`, `order_id`, `kind`, `amount_poisha` signed,
  `balance_after` per actor cache) — invoices are *views over ledger*, never hand-summed spreadsheets.
- `invoices` (`payee_type vendor|rider`, period Fri/Sat weeks, totals, `state GENERATED|VERIFIED|PAID|DISPUTED`,
  `pdf_path`, `payout_txn_ref`, unique(period_start, payee)) + `invoice_lines` (per-order rows).
- `rider_cash_remittances` (amount, bKash TrxID unique, sender number/name, screenshot private path, selfie path, review state),
  `penalties_adjustments` (reason-coded, Admin-approved, appear as invoice lines).

**Platform**
- `platform_settings` (key/value + JSON, versioned), `cuisine_taxonomy` (Appendix D, searchable EN/BN + synonyms),
  `cancel_reasons`/`reject_reasons`/`feedback_tags`, `banners` (home modules, zone-targeted, schedule),
  `notifications` (in-app inbox), `client_errors`, `search_queries` (trending computation), `weather_cache`.

## 5.2 RLS law (deny-by-default)

Every table `ENABLE ROW LEVEL SECURITY`. Patterns: customer sees own rows (`auth.uid() = profile_id` via join helper),
vendor staff see own vendor subtree, rider sees assigned orders, **Workers use service-role only from Worker secrets**
(never shipped to clients), anon role: read-only public catalog views (`public_vendor_cards`, `public_menus` views with
private columns stripped). Storage buckets: `public-avatars` (public read), `kyc-private`, `proofs-private`,
`invoices-private` — private buckets: no public policy at all; access exclusively via Worker-minted signed URLs (≤10 min).

## 5.3 SQL RPC surface (clients never do multi-table client joins for hot paths)

`get_home_feed(lat,lng,mode,filters,page)` (ranked, file `13`) · `get_vendor_menu(slug)` · `search_food(q,lat,lng)` ·
`validate_cart(cart_id)` (price truth) · `place_order(...)` (called only by W1) · `transition_order(order_id, to, actor, meta)`
(single guarded door for all state changes) · `finalize_delivery(order_id)` (ledger fan-out) ·
`generate_invoices(period, type)` (idempotent) · `vendor_stats(vendor_id, range)` · `rider_stats(...)` ·
`admin_dispatch_board(zone)` — each `SECURITY DEFINER` with explicit actor checks, documented, pgTAP-tested.

## 5.4 Indexes & performance rules

Geohash-prefix + status composite indexes for feed/dispatch; `orders(vendor_id,status,created_at desc)`,
`orders(rider_id,status)`, `ledger_entries(actor,created_at)`, trigram GIN on item/vendor names (EN+BN),
partial indexes for active states. `EXPLAIN` evidence required in PRs touching hot queries (file `26`).
Nightly (W3 cron): rollup aggregates, prune telemetry >7 d, expire carts >24 h, refresh trending searches.

## 5.5 Migrations discipline

Numbered immutable files `0001_....sql`… applied **only** by GitHub Actions (`supabase-cli` in CI, file `24`);
founder never hand-edits SQL in the dashboard post-launch (emergency runbook excepted, then back-filled as migration).
Every migration: up-only + data-backfill note + RLS in same file + `COMMENT ON` for new objects.
