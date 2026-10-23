# Appendix B · PostgreSQL Data Dictionary (from guide file 05)

Conventions: money columns `bigint` poisha; every table also has `created_at/updated_at` unless append-only;
**Tables/groups: 45 · documented column entries: 212.**

RLS enabled everywhere (file 05 §5.2). Builder turns this into migrations in Build Responses 2–5 and keeps this file in sync.

## `profiles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | = auth.users.id |
| `role` | text | customer|vendor_owner|vendor_staff|rider|admin |
| `full_name` | text | legal/display name |
| `phone` | text | BD mobile ^01[3-9]\d{8}$, unique where set |
| `email` | text | mirror of auth email |
| `avatar_url` | text | ImgBB public |
| `language` | text | en|bn |
| `status` | text | active|suspended|deleted |
| `trust_score` | int | COD trust 0-100 (file 09) |
| `created_at/updated_at/deleted_at` | timestamptz | standard trio |

## `device_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `profile_id` | uuid FK | owner |
| `fcm_token` | text unique | FCM registration token |
| `app_flavor` | text | customer|partner|rider |
| `platform` | text | = android v1 |
| `last_seen_at` | timestamptz | prune >60d |

## `customer_addresses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `profile_id` | uuid FK |  |
| `label` | text | Home|Office|Other+custom |
| `lat/lng` | double | pin |
| `geohash` | text | 9-char |
| `address_text` | text | house/road/area |
| `delivery_instructions` | text |  |
| `zone_id` | uuid FK | resolved at save |
| `is_default` | bool | one per user |

## `admin_roles`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `key` | text unique | super_admin|ops_manager|dispatcher|vendor_onboarding|finance|support|compliance_auditor + custom |
| `name` | text |  |

## `admin_permissions`

| Column | Type | Notes |
|---|---|---|
| `role_id,permission` | PK pair | permission strings match Appendix C |

## `admin_user_roles`

| Column | Type | Notes |
|---|---|---|
| `profile_id,role_id` | PK pair | granted_by + audit |

## `audit_logs`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | append-only |
| `actor_id/actor_role` | uuid/text |  |
| `action` | text | e.g. invoice.pay |
| `entity_type/entity_id` | text/text |  |
| `diff` | jsonb | before/after |
| `ip/request_id` | text/text | CF header + trace |
| `created_at` | timestamptz | immutable |

## `zones`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `name/slug` | text | e.g. Sylhet Sadar |
| `polygon` | jsonb | [[lng,lat],...] |
| `center_lat/lng` | double |  |
| `is_active` | bool |  |
| `fee_overrides` | jsonb | delivery-fee tiers |
| `config` | jsonb | radii/surge/batching overrides |

## `vendors`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `owner_profile_id` | uuid FK |  |
| `type` | text | RESTAURANT|HOME_KITCHEN|CLOUD_KITCHEN |
| `legal_name/brand_name` | text |  |
| `slug` | text unique | /r/{slug} |
| `lat/lng/geohash` | geo |  |
| `address_text` | text | private exact for home kitchens |
| `zone_id` | uuid FK |  |
| `logo_url/cover_url` | text | ImgBB |
| `cuisines` | text[] | taxonomy keys <=5 primary |
| `kyc_status` | text | draft|submitted|under_review|approved|rejected|needs_fix |
| `accepts_pickup` | bool | D-24 |
| `pickup_point_label` | text |  |
| `rating_avg/rating_count` | numeric/int | Bayesian aggregates cached |
| `avg_prep_min/acceptance_rate` | numeric | performance aggregates |

## `vendor_hours`

| Column | Type | Notes |
|---|---|---|
| `vendor_id,weekday` | PK | 0=Sun..6=Sat Asia/Dhaka |
| `open1/close1,open2/close2` | time | split shift optional |
| `is_closed` | bool | weekly holiday |

## `vendor_pauses`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `vendor_id` | FK |  |
| `starts_at/ends_at` | timestamptz | busy-pause auto-resume |
| `reason` | text |  |

## `vendor_documents`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `vendor_id` | FK |  |
| `doc_type` | text | trade_license|nid_front|nid_back|tin|bin|bank_proof|bikash_proof|utility_bill|menu_doc |
| `storage_path` | text | private bucket path |
| `review_status` | text | pending|approved|needs_fix |
| `reviewer_id/review_note` | FK/text |  |
| `expires_on` | date | licence alerts |

## `vendor_payout_accounts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `vendor_id` | FK |  |
| `method` | text | bkash|nagad|bank |
| `holder_name` | text |  |
| `account_ref_enc` | bytea | pgcrypto-encrypted number |
| `masked` | text | display •••1234 |
| `is_primary` | bool |  |

## `menu_categories`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `vendor_id` | FK |  |
| `name_en/name_bn` | text |  |
| `sort` | int |  |
| `is_active` | bool |  |
| `schedule` | jsonb | optional daypart availability |

## `menu_items`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `vendor_id/category_id` | FK |  |
| `name_en/name_bn` | text |  |
| `description_en/bn` | text |  |
| `price_poisha/compare_at_poisha` | bigint | VAT-inclusive |
| `image_url` | text | ImgBB |
| `item_type` | text | simple|sized|bundle |
| `is_available/unavailable_until` | bool/timestamptz |  |
| `spicy_level/is_veg` | int/bool | 0-3 |
| `serves/prep_weight` | text/int | kitchen-load units |
| `sort` | int |  |

## `variant_groups/variants`

| Column | Type | Notes |
|---|---|---|
| `group: item_id,name,min=1,max=1` | sizes (Regular/Large) |  |
| `variant: group_id,name,price_delta_poisha` | delta vs base (can be full-price mode flag) |  |

## `option_groups/options`

| Column | Type | Notes |
|---|---|---|
| `group: item_id,name,min_select,max_select` | add-ons rules |  |
| `option: group_id,name,price_delta_poisha,is_available` |  |  |

## `bundle_slots/bundle_slot_choices`

| Column | Type | Notes |
|---|---|---|
| `slot: bundle_item_id,name,sort` | e.g. Choose your drink |  |
| `choice: slot_id,item_id,price_delta_poisha` | items pickable in slot |  |

## `riders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `profile_id` | FK unique |  |
| `vehicle_type` | text | motorbike|bicycle |
| `kyc_status` | text | as vendors |
| `home_zone_id` | FK |  |
| `rating_avg/count,completion_rate` | aggregates |  |
| `cash_ceiling_override_poisha` | bigint? | per-rider ceiling tune |

## `rider_documents`

| Column | Type | Notes |
|---|---|---|
| `doc_type` | text | nid|birth_cert|driving_license|vehicle_reg|tax_token|selfie|vehicle_photo |
| `expires_on` | date | licence/token alerts |
| `...+ same columns as vendor_documents` |  |  |

## `rider_shifts`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `rider_id` | FK |  |
| `started_at/ended_at` | timestamptz |  |
| `vehicle_confirmed` | text | session vehicle |
| `start_selfie_path` | text? | private |
| `end_reason` | text | normal|cash_gate|admin |

## `presence_live`

| Column | Type | Notes |
|---|---|---|
| `profile_id` | PK | UNLOGGED table |
| `kind` | text | vendor|rider |
| `ref_id` | uuid | vendor/rider id |
| `lat/lng/zone_id` | geo |  |
| `capacity_used` | int | active deliveries |
| `app_state` | text | fg|bg |
| `last_seen_at` | timestamptz | staleness per D-05 |

## `carts/cart_items`

| Column | Type | Notes |
|---|---|---|
| `cart: customer_id unique-active, vendor_id, fulfilment` | single-vendor law |  |
| `item: item_id, qty, selections jsonb, unit_snapshot_poisha` | repriced at validate |  |

## `orders`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `public_code` | text unique | UD-{zone}-{date}-{seq} |
| `customer_id/vendor_id/rider_id/zone_id` | FK | rider nullable |
| `fulfilment` | text | delivery|pickup |
| `status` | text | file 22 machine |
| `address_snapshot/vendor_snapshot` | jsonb | immutable |
| `prep_minutes_committed` | int |  |
| `items_poisha/discount_total_poisha/discount_vendor_poisha/discount_platform_poisha` | bigint | waterfall file 10 |
| `delivery_fee_poisha/platform_fee_poisha/tip_poisha/tax_extracted_poisha/cod_collect_poisha` | bigint |  |
| `rider_fare_poisha/rider_bonus_poisha/commission_poisha/vendor_net_poisha` | bigint | settlement snapshot |
| `fare_inputs` | jsonb | file 11 snapshot |
| `voucher_id/campaign_id/batch_id` | FK? |  |
| `is_priority` | bool |  |
| `placed_at/accepted_at/ready_at/picked_at/delivered_at/cancelled_at` | timestamptz? | state clocks |

## `order_items`

| Column | Type | Notes |
|---|---|---|
| `order_id` | FK |  |
| `name_snapshot` | text | survives menu edits |
| `unit_poisha/qty/line_poisha` | bigint/int/bigint |  |
| `selections` | jsonb | variants/options/bundle picks |
| `note` | text? | per-item instruction |

## `order_events`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | append-only spine |
| `order_id` | FK |  |
| `actor_id/actor_kind` | uuid/text |  |
| `from_status/to_status` | text |  |
| `meta` | jsonb | reasons, coords, timers |
| `created_at` | timestamptz |  |

## `order_offers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `order_id/rider_id` | FK |  |
| `fare_poisha/fare_inputs` | bigint/jsonb |  |
| `score/score_factors` | int/jsonb | explainability |
| `response` | text | pending|accepted|rejected|expired |
| `reject_reason` | text? |  |
| `offered_at/expires_at/responded_at` | timestamptz |  |

## `order_batches`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK |  |
| `rider_id` | FK? |  |
| `sequence` | jsonb | ordered pickup/drop plan |
| `state` | text | forming|offered|active|done |

## `vouchers/voucher_redemptions`

| Column | Type | Notes |
|---|---|---|
| `voucher: code unique, kind percent|flat|free_delivery, value, cap_poisha, min_order_poisha, scope jsonb, funding, budget_poisha, starts/ends` |  |  |
| `redemption: voucher_id+customer_id+order_id unique` | anti-farming |  |

## `campaigns/campaign_vendors`

| Column | Type | Notes |
|---|---|---|
| `campaign: kind flash_box|vendor_promo|first_order|banner, percent, cap, funding_split jsonb, window, zone scope` | Flash Box file 01 D-11 |  |
| `opt-in: campaign_id+vendor_id` |  |  |

## `reviews`

| Column | Type | Notes |
|---|---|---|
| `order_id` | FK unique per side | one per order per direction |
| `direction` | text | customer_vendor|customer_rider|rider_internal|vendor_internal |
| `stars` | int 1-5 |  |
| `aspect_tags` | text[] | taste/packaging/portion/value/temp... |
| `body/photos` | text/text[] | ImgBB |
| `reply_body/replied_at` | text? | vendor reply |
| `moderation` | text | visible|hidden|disputed |

## `favourites`

| Column | Type | Notes |
|---|---|---|
| `customer_id+vendor_id` | PK pair |  |

## `chats/chat_messages`

| Column | Type | Notes |
|---|---|---|
| `chat: order_id, pair_kind` | c_r|c_v|r_v |  |
| `msg: sender_id, kind text|image|voice|system, body, media_path, read_at` | private media lane |  |

## `support_threads/messages`

| Column | Type | Notes |
|---|---|---|
| `thread: opener, category, order_id?, status, assignee, sla_due` |  |  |
| `msg: as chat + internal_note bool` |  |  |

## `ledger_entries`

| Column | Type | Notes |
|---|---|---|
| `id` | bigint identity | append-only |
| `actor_type/actor_id` | text/uuid | vendor|rider|undal |
| `order_id` | FK? |  |
| `kind` | text | vendor_payable|commission|rider_fare|rider_bonus|tip|cod_liability|remittance|adjustment|discount_fund |
| `amount_poisha` | bigint signed |  |
| `memo` | text |  |
| `created_at` | timestamptz |  |

## `invoices/invoice_lines`

| Column | Type | Notes |
|---|---|---|
| `invoice: payee_type/payee_id, period_start/end, totals jsonb+cols, state GENERATED|VERIFIED|PAID|DISPUTED, pdf_path, payout_txn_ref, UNIQUE(period_start,payee)` | D-06 idempotency |  |
| `line: order_id + component cols` | per-order row |  |

## `rider_cash_remittances`

| Column | Type | Notes |
|---|---|---|
| `rider_id` | FK |  |
| `amount_poisha` | bigint |  |
| `bkash_trxid` | text UNIQUE | double-claim impossible |
| `sender_number/sender_name` | text |  |
| `screenshot_path/selfie_path` | text | private |
| `state` | text | pending|verified|partial|rejected |

## `penalties_adjustments`

| Column | Type | Notes |
|---|---|---|
| `target_type/target_id` | vendor|rider |  |
| `kind/amount_poisha` | reason-coded |  |
| `state` | text | pending|confirmed|disputed|cancelled |
| `evidence_path` | text? | private |

## `platform_settings`

| Column | Type | Notes |
|---|---|---|
| `key` | PK | dotted keys e.g. fare.motorbike.per_km |
| `value` | jsonb |  |
| `version/updated_by` | int/FK | audited history table alongside |

## `cuisine_taxonomy`

| Column | Type | Notes |
|---|---|---|
| `key` | PK slug |  |
| `name_en/name_bn` | text | Appendix D |
| `parent_key` | text? |  |
| `synonyms` | text[] | Banglish search |
| `icon_url` | text? | ImgBB |

## `cancel_reasons/feedback_tags`

| Column | Type | Notes |
|---|---|---|
| `key,name_en,name_bn,actor_scope,sort` | seeded vocabularies |  |

## `banners`

| Column | Type | Notes |
|---|---|---|
| `title/subtitle EN/BN, image_url, link_route, zone scope, schedule, sort` | home modules |  |

## `notifications`

| Column | Type | Notes |
|---|---|---|
| `profile_id,kind,title_en/bn,body_en/bn,deep_link,read_at` | in-app inbox |  |

## `fcm_dispatch_log`

| Column | Type | Notes |
|---|---|---|
| `type,target_profile,order_id,fcm_message_id,error,sent_at` | file 07 proof |  |

## `client_errors/search_queries/weather_cache/geocode_cache/media_assets`

| Column | Type | Notes |
|---|---|---|
| `ops/support tables per files 03/13/14/15` | small, pruned by cron |  |
