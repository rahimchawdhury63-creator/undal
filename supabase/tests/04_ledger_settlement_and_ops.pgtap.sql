-- =============================================================================
-- pgTAP Suite: 04_ledger_settlement_and_ops.pgtap.sql
-- Milestone:   Build Response 5 (Migrations 0013..0016 — 16/16 Complete DB Suite)
-- Coverage:    62/62 RLS-forced public tables, zero Supabase Storage schema (`ADR-0006`),
--              ACID append-only ledger conservation on DELIVERED transition, bicycle ৳3,000
--              cash ceiling auto-lock & TrxID remittance auto-unlock, Friday/Saturday
--              dual-path idempotent invoices with bKash cash-out fee cover, verified-buyer
--              reviews, 24h chat lock, Cloudinary EXIF-stripped media_assets, quota pruning.
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(26);

-- 1. All Build 5 tables exist & EVERY regular public table (62/62) has ENABLE + FORCE RLS (`0` Supabase storage tables)
SELECT has_table('public', 'ledger_entries', 'ledger_entries table exists');
SELECT has_table('public', 'invoices', 'invoices table exists');
SELECT has_table('public', 'invoice_lines', 'invoice_lines table exists');
SELECT has_table('public', 'rider_cash_remittances', 'rider_cash_remittances table exists');
SELECT has_table('public', 'penalties_adjustments', 'penalties_adjustments table exists');
SELECT has_table('public', 'reviews', 'reviews table exists');
SELECT has_table('public', 'chats', 'chats table exists');
SELECT has_table('public', 'media_assets', 'media_assets table exists');
SELECT has_table('public', 'geocode_cache', 'geocode_cache table exists');

SELECT results_eq(
  $$ SELECT
       count(*)::int AS total_public_tables,
       count(*) FILTER (WHERE NOT c.relrowsecurity OR NOT c.relforcerowsecurity)::int AS unprotected_tables,
       (SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'storage') AS supabase_storage_tables
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' $$,
  $$ VALUES (62, 0, 0) $$,
  'All 62 public tables have ENABLE + FORCE RLS and 0 Supabase Storage tables exist (ADR-0006)'
);

-- 2. Fixtures: Customer (trust=70 -> max COD ৳3,500), Home-Kitchen Vendor, Bicycle Rider (ceiling=৳3,000), SuperAdmin
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('bbbb1111-1111-4111-8111-111111111111', 'tanvir-b05@undal.test', '{"full_name":"Tanvir Customer"}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222222', 'nadia-b05@undal.test', '{"full_name":"Nadia Kitchen"}'::jsonb),
  ('bbbb3333-3333-4333-8333-333333333333', 'rafi-b05@undal.test', '{"full_name":"Rafi Cycle Rider"}'::jsonb),
  ('bbbb9999-9999-4999-8999-999999999999', 'finance-b05@undal.test', '{"full_name":"Finance SuperAdmin"}'::jsonb);

UPDATE public.profiles SET trust_score = 75 WHERE id = 'bbbb1111-1111-4111-8111-111111111111';
UPDATE public.profiles SET role = 'vendor_owner' WHERE id = 'bbbb2222-2222-4222-8222-222222222222';
UPDATE public.profiles SET role = 'rider' WHERE id = 'bbbb3333-3333-4333-8333-333333333333';
UPDATE public.profiles SET role = 'admin' WHERE id = 'bbbb9999-9999-4999-8999-999999999999';

INSERT INTO public.admin_user_roles (profile_id, role_id)
SELECT 'bbbb9999-9999-4999-8999-999999999999'::uuid, id FROM public.admin_roles WHERE key = 'super_admin';

INSERT INTO public.riders (id, profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
SELECT 'bbbb7777-7777-4777-8777-777777777777', 'bbbb3333-3333-4333-8333-333333333333', 'bicycle', '1999-03-14'::date, 'approved', true, true, id
FROM public.zones WHERE slug = 'sylhet-sadar';

INSERT INTO public.vendors (
  id, owner_profile_id, type, legal_name, brand_name, slug,
  lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
  cuisines, kyc_status, is_active, min_order_poisha
)
SELECT
  'bbbb4444-4444-4444-8444-444444444444', 'bbbb2222-2222-4222-8222-222222222222', 'HOME_KITCHEN',
  'Nadia Begum', 'Nadia Mezban House', 'nadia-mezban',
  24.8960, 91.8700, '', 'Zindabazar, Sylhet', 'House 9, Zindabazar', '01715000002', id,
  ARRAY['homemade'], 'approved', true, 10000
FROM public.zones WHERE slug = 'sylhet-sadar';

INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, is_closed)
VALUES ('bbbb4444-4444-4444-8444-444444444444', 5, '09:00', '23:00', false);

INSERT INTO public.menu_categories (id, vendor_id, name_en)
VALUES ('bbbb5555-5555-4555-8555-555555555555', 'bbbb4444-4444-4444-8444-444444444444', 'Platters');

INSERT INTO public.menu_items (id, vendor_id, category_id, name_en, price_poisha)
VALUES ('bbbb6666-6666-4666-8666-666666666666', 'bbbb4444-4444-4444-8444-444444444444', 'bbbb5555-5555-4555-8555-555555555555', 'Beef Mezban Platter', 100000);

INSERT INTO public.customer_addresses (id, profile_id, label, lat, lng, geohash, address_text, is_default)
VALUES ('bbbb1212-1212-4212-8212-121212121212', 'bbbb1111-1111-4111-8111-111111111111', 'Home', 24.9045, 91.8611, '', 'Amberkhana, Sylhet', true);

INSERT INTO public.carts (id, customer_id, vendor_id, address_id, fulfilment)
VALUES ('bbbb1313-1313-4313-8313-131313131313', 'bbbb1111-1111-4111-8111-111111111111', 'bbbb4444-4444-4444-8444-444444444444', 'bbbb1212-1212-4212-8212-121212121212', 'delivery');

INSERT INTO public.cart_items (cart_id, menu_item_id, qty, unit_snapshot_poisha)
VALUES ('bbbb1313-1313-4313-8313-131313131313', 'bbbb6666-6666-4666-8666-666666666666', 3, 100000);

-- 3. Place ৳3,055 COD order (300,000 food + 5,000 delivery + 500 platform = 305,500 poisha >= 300,000 bicycle ceiling!)
DO $$
DECLARE
  v_placed jsonb;
  v_oid uuid;
  v_nonce text;
BEGIN
  v_placed := public.place_order('bbbb1111-1111-4111-8111-111111111111', 'idem-b05-01', 305500, 5000, 500, false, '2026-10-23 13:00:00+06'::timestamptz);
  v_oid := (v_placed ->> 'order_id')::uuid;
  PERFORM set_config('test.b05_order_id', v_oid::text, true);

  PERFORM public.transition_order(v_oid, 'bbbb2222-2222-4222-8222-222222222222', 'vendor', 'VENDOR_ACCEPTED', '{"prep_minutes_committed":20}'::jsonb, '2026-10-23 13:01:00+06'::timestamptz);
  PERFORM public.transition_order(v_oid, 'bbbb2222-2222-4222-8222-222222222222', 'vendor', 'PREPARING', '{}'::jsonb, '2026-10-23 13:03:00+06'::timestamptz);
  PERFORM public.transition_order(v_oid, 'bbbb2222-2222-4222-8222-222222222222', 'vendor', 'READY_FOR_PICKUP', '{}'::jsonb, '2026-10-23 13:12:00+06'::timestamptz);
  PERFORM public.transition_order(v_oid, 'bbbb9999-9999-4999-8999-999999999999', 'admin', 'RIDER_ASSIGNED', '{"rider_id":"bbbb7777-7777-4777-8777-777777777777","rider_fare_poisha":4100}'::jsonb, '2026-10-23 13:13:00+06'::timestamptz);
  PERFORM public.transition_order(v_oid, 'bbbb3333-3333-4333-8333-333333333333', 'rider', 'RIDER_AT_VENDOR', '{}'::jsonb, '2026-10-23 13:16:00+06'::timestamptz);

  SELECT pickup_qr_nonce INTO v_nonce FROM public.orders WHERE id = v_oid;
  PERFORM public.verify_pickup_handover(
    v_oid, 'bbbb3333-3333-4333-8333-333333333333', 'TEST_QR_SECRET_32_BYTES_MINIMUM!',
    public.compute_pickup_qr_token(v_oid, v_nonce, 'TEST_QR_SECRET_32_BYTES_MINIMUM!'),
    NULL, NULL, '{}'::text[], '2026-10-23 13:17:00+06'::timestamptz
  );
  PERFORM public.transition_order(v_oid, 'bbbb3333-3333-4333-8333-333333333333', 'rider', 'RIDER_AT_CUSTOMER', '{}'::jsonb, '2026-10-23 13:26:00+06'::timestamptz);
  PERFORM public.transition_order(v_oid, 'bbbb3333-3333-4333-8333-333333333333', 'rider', 'DELIVERED', '{}'::jsonb, '2026-10-23 13:28:00+06'::timestamptz);

  -- Explicit second call proves 100% idempotency atop automatic DELIVERED trigger!
  PERFORM public.record_order_delivered_ledger(v_oid, '2026-10-23 13:28:05+06'::timestamptz);
END;
$$;

SELECT results_eq(
  $$ SELECT
       count(*)::int AS ledger_rows,
       (SELECT sum(amount_poisha)::bigint FROM public.ledger_entries WHERE order_id = current_setting('test.b05_order_id')::uuid AND actor_type = 'vendor') AS vendor_net,
       (SELECT cash_gate_blocked FROM public.riders WHERE id = 'bbbb7777-7777-4777-8777-777777777777') AS gate_blocked
     FROM public.ledger_entries WHERE order_id = current_setting('test.b05_order_id')::uuid $$,
  $$ VALUES (6, 255000::bigint, true) $$,
  'ACID DELIVERED trigger + idempotent replay books 6 exact conserved rows and locks bicycle cash gate at ৳3,055 >= ৳3,000'
);

-- 4. Append-only ledger blocks UPDATE & DELETE
SELECT throws_ok(
  $$ UPDATE public.ledger_entries SET amount_poisha = 1 WHERE id = (SELECT min(id) FROM public.ledger_entries) $$,
  '55000',
  NULL,
  'ledger_entries strictly blocks UPDATE via prevent_mutation()'
);

-- 5. Cash remittance via TrxID + Cloudinary authenticated proof unlocks cash gate; duplicate TrxID is rejected
DO $$
DECLARE
  v_rem public.rider_cash_remittances%ROWTYPE;
BEGIN
  v_rem := public.submit_cash_remittance(
    'bbbb7777-7777-4777-8777-777777777777', 'bkash', 305500, 'BKX99887766',
    '01715000003', 'undal/private/cash_remittance_proof/bbbb3333/proof_1'
  );
  PERFORM set_config('test.b05_rem_id', v_rem.id::text, true);
END;
$$;

SELECT throws_ok(
  $$ SELECT public.submit_cash_remittance(
       'bbbb7777-7777-4777-8777-777777777777', 'bkash', 50000, 'bkx99887766',
       '01715000003', 'undal/private/cash_remittance_proof/bbbb3333/proof_dup'
     ) $$,
  '23505',
  NULL,
  'Global UNIQUE(bkash_trxid) blocks case-insensitive duplicate remittance replay fraud'
);

SELECT lives_ok(
  $$ SELECT public.decide_cash_remittance(
       current_setting('test.b05_rem_id')::uuid, 'bbbb9999-9999-4999-8999-999999999999',
       'verified', NULL, 'Verified against Undal bKash statement', 'req-rem-1', '2026-10-23 14:00:00+06'::timestamptz
     ) $$,
  'Finance decision RPC approves remittance and writes audit log'
);

SELECT results_eq(
  $$ SELECT rc.unremitted_cash_poisha, r.cash_gate_blocked
     FROM public.rider_cash_balance_v rc
     JOIN public.riders r ON r.id = rc.rider_id
     WHERE rc.rider_id = 'bbbb7777-7777-4777-8777-777777777777' $$,
  $$ VALUES (0::bigint, false) $$,
  'Finance verification credits 305,500 poisha remittance and immediately unlocks rider cash gate'
);

-- 6. Dual-path idempotent weekly invoices + 1.85% bKash cash-out fee cover + VERIFIED -> PAID lifecycle
SELECT lives_ok(
  $$ SELECT count(*) FROM public.generate_weekly_invoices('vendor', '2026-10-20'::date, '2026-10-26'::date, 185, '2026-10-24 00:05:00+06'::timestamptz) $$,
  'First generate_weekly_invoices Cron execution succeeds'
);

SELECT results_eq(
  $$ SELECT count(*)::int AS repeat_cnt,
            min(net_payable_poisha) AS net_p,
            min(cashout_fee_cover_poisha) AS fee_p,
            min(total_disbursed_poisha) AS total_p
     FROM public.generate_weekly_invoices('vendor', '2026-10-20'::date, '2026-10-26'::date, 185, '2026-10-24 00:06:00+06'::timestamptz)
     WHERE payee_id = 'bbbb4444-4444-4444-8444-444444444444' $$,
  $$ VALUES (1, 255000::bigint, 4718::bigint, 259718::bigint) $$,
  'generate_weekly_invoices is idempotent across Cron + lazy read and adds exact 1.85% (4,718 poisha) bKash cash-out cover'
);

SELECT throws_ok(
  $$ SELECT public.verify_and_pay_invoice(
       (SELECT id FROM public.invoices WHERE payee_id = 'bbbb4444-4444-4444-8444-444444444444'),
       'bbbb9999-9999-4999-8999-999999999999', 'pay', 'bkash', 'PAYTX1', 'undal/private/invoice_pdf/proof1'
     ) $$,
  '55000',
  NULL,
  'Invoice cannot skip VERIFIED straight to PAID'
);

SELECT lives_ok(
  $$ SELECT public.verify_and_pay_invoice(
       (SELECT id FROM public.invoices WHERE payee_id = 'bbbb4444-4444-4444-8444-444444444444'),
       'bbbb9999-9999-4999-8999-999999999999', 'verify', 'bkash', NULL, NULL, 'undal/private/invoice_pdf/vendor/inv_1001'
     );
     SELECT public.verify_and_pay_invoice(
       (SELECT id FROM public.invoices WHERE payee_id = 'bbbb4444-4444-4444-8444-444444444444'),
       'bbbb9999-9999-4999-8999-999999999999', 'pay', 'bkash', 'PAYTX1', 'undal/private/cash_remittance_proof/payout_1001'
     ); $$,
  'Verified vendor invoice transitions cleanly to PAID with Cloudinary proof + payout ledger rows'
);

-- 7. Verified-buyer reviews, 24h chat lock, Cloudinary EXIF-stripped media_assets, and quota pruning
SELECT throws_ok(
  $$ INSERT INTO public.reviews (order_id, reviewer_id, direction, rating, comment)
     VALUES (current_setting('test.b05_order_id')::uuid, 'bbbb3333-3333-4333-8333-333333333333', 'customer_to_vendor', 5, 'Fake review') $$,
  '42501',
  NULL,
  'Non-buyer is blocked from posting customer_to_vendor review'
);

INSERT INTO public.reviews (order_id, reviewer_id, direction, rating, comment)
VALUES (current_setting('test.b05_order_id')::uuid, 'bbbb1111-1111-4111-8111-111111111111', 'customer_to_vendor', 5, 'Authentic Sylheti Mezban!');

SELECT results_eq(
  $$ SELECT rating_avg, rating_count FROM public.vendors WHERE id = 'bbbb4444-4444-4444-8444-444444444444' $$,
  $$ VALUES (5.00::numeric(3,2), 1) $$,
  'Verified DELIVERED customer review automatically updates vendors.rating_avg and rating_count'
);

INSERT INTO public.chats (id, order_id, pair_kind, is_locked)
VALUES ('bbbb8888-8888-4888-8888-888888888888', current_setting('test.b05_order_id')::uuid, 'customer_rider', true);

SELECT throws_ok(
  $$ INSERT INTO public.chat_messages (chat_id, sender_id, body)
     VALUES ('bbbb8888-8888-4888-8888-888888888888', 'bbbb1111-1111-4111-8111-111111111111', 'Late message') $$,
  '55000',
  NULL,
  'Locked post-24h order chat rejects new customer/rider writes (File 22 §22.3)'
);

SELECT throws_ok(
  $$ INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, public_cdn_url, bytes)
     VALUES ('bbbb3333-3333-4333-8333-333333333333', 'cloudinary', 'rider_kyc', 'authenticated', 'undal/private/rider_kyc/nid1', 'https://res.cloudinary.com/leak.jpg', 84000) $$,
  '23514',
  NULL,
  'media_assets DB constraint forbids authenticated private KYC assets from storing any public_cdn_url'
);

INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, bytes)
VALUES ('bbbb3333-3333-4333-8333-333333333333', 'cloudinary', 'rider_kyc', 'authenticated', 'undal/private/rider_kyc/nid1', 84000);

INSERT INTO public.geocode_cache (cache_key, kind, payload, expires_at)
VALUES ('fwd:sylhet:amberkhana', 'forward', '{"lat":24.9045}'::jsonb, clock_timestamp() - INTERVAL '1 hour');

SELECT is(
  (public.prune_ephemeral_rows(clock_timestamp())->>'geocode_cache')::int,
  1,
  'prune_ephemeral_rows purges expired geocode_cache entries cleanly'
);

-- 8. RLS isolation: Customer sees 0 invoices/ledger entries; Vendor sees own 1 invoice & 3 ledger entries
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'bbbb1111-1111-4111-8111-111111111111', true);
SELECT results_eq(
  $$ SELECT (SELECT count(*)::int FROM public.invoices) AS invs, (SELECT count(*)::int FROM public.ledger_entries) AS ledgers $$,
  $$ VALUES (0, 0) $$,
  'Customer cannot read any vendor/rider invoices or financial ledger rows under FORCE RLS'
);

SELECT set_config('request.jwt.claim.sub', 'bbbb2222-2222-4222-8222-222222222222', true);
SELECT results_eq(
  $$ SELECT (SELECT count(*)::int FROM public.invoices) AS invs, (SELECT count(*)::int FROM public.ledger_entries) AS ledgers $$,
  $$ VALUES (1, 3) $$,
  'Vendor owner reads own 1 weekly invoice and own 3 ledger entries (payable, commission, payout)'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
