-- =============================================================================
-- pgTAP SQL Money Vectors (M-1..M-8), Order Lifecycle, QR Handover & RLS Suite — Build 4
-- File: supabase/tests/03_orders_money_and_rls.pgtap.sql
-- Run via: pg_prove -d undal_test supabase/tests/*.pgtap.sql
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(27);

-- 1. All 16 Build 4 tables enforce ENABLE + FORCE RLS (`0` unprotected tables across schema)
SELECT results_eq(
  $$
    SELECT
      count(*) FILTER (WHERE c.relname IN (
        'riders', 'rider_documents', 'rider_shifts', 'presence_live',
        'campaigns', 'campaign_vendors', 'vouchers', 'voucher_redemptions',
        'carts', 'cart_items', 'idempotency_keys',
        'order_batches', 'orders', 'order_items', 'order_events', 'order_offers'
      ) AND c.relrowsecurity = true AND c.relforcerowsecurity = true)::int,
      count(*) FILTER (WHERE NOT (c.relrowsecurity = true AND c.relforcerowsecurity = true))::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  $$,
  $$ VALUES (16, 0) $$,
  'All 16 Build 4 tables enforce ENABLE + FORCE RLS with 0 unprotected tables in schema'
);

SELECT results_eq(
  $$ SELECT relpersistence::text FROM pg_class WHERE relname = 'presence_live' $$,
  ARRAY['u'],
  'presence_live is stored as an UNLOGGED table (relpersistence = u) per File 03 §3.1'
);

-- 2. ALL 8 Appendix F Golden Money Vectors (`M-1..M-8`) exact to 0 poisha inside PostgreSQL SQL!
SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 54100, 10820, 0, 0, 500, 0) $$,
  $$ VALUES (43280::bigint, 2061::bigint, 6492::bigint, 1298::bigint, 36788::bigint, 43780::bigint) $$,
  'Appendix F Golden Money Vector M-1 matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 30000, 0, 0, 6000, 500, 0) $$,
  $$ VALUES (30000::bigint, 1429::bigint, 4500::bigint, 900::bigint, 25500::bigint, 36500::bigint) $$,
  'Appendix F Golden Money Vector M-2 matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 40000, 5000, 5000, 2000, 500, 0) $$,
  $$ VALUES (30000::bigint, 1429::bigint, 4500::bigint, 900::bigint, 30500::bigint, 32500::bigint) $$,
  'Appendix F Golden Money Vector M-3 (50/50 split) matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('pickup', 25000, 2500, 0, 4000, 500, 2000) $$,
  $$ VALUES (22500::bigint, 1071::bigint, 3375::bigint, 675::bigint, 19125::bigint, 22500::bigint) $$,
  'Appendix F Golden Money Vector M-4 (pickup zeroes delivery, platform & tip) matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 270500, 54100, 0, 13000, 500, 0) $$,
  $$ VALUES (216400::bigint, 10305::bigint, 32460::bigint, 6492::bigint, 183940::bigint, 229900::bigint) $$,
  'Appendix F Golden Money Vector M-5 matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 9900, 0, 0, 5000, 500, 0) $$,
  $$ VALUES (9900::bigint, 471::bigint, 1485::bigint, 297::bigint, 8415::bigint, 15400::bigint) $$,
  'Appendix F Golden Money Vector M-6 matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 35000, 0, 11000, 5000, 500, 0) $$,
  $$ VALUES (24000::bigint, 1143::bigint, 3600::bigint, 720::bigint, 31400::bigint, 29500::bigint) $$,
  'Appendix F Golden Money Vector M-7 (100% platform funded top-up) matches in SQL to 0 poisha'
);

SELECT results_eq(
  $$ SELECT food_payable_poisha, tax_extracted_poisha, commission_poisha, rider_bonus_poisha, vendor_net_poisha, cod_collect_poisha
     FROM public.price_order('delivery', 18000, 1800, 0, 0, 500, 0) $$,
  $$ VALUES (16200::bigint, 771::bigint, 2430::bigint, 486::bigint, 13770::bigint, 16700::bigint) $$,
  'Appendix F Golden Money Vector M-8 matches in SQL to 0 poisha'
);

-- 3. Rider age >= 18 trigger, single-open-shift constraint, and presence dispatch query
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('91111111-1111-4111-8111-111111111111', 'chef-b04@undal.test', '{"full_name":"Nusrat Home Chef"}'::jsonb),
  ('92222222-2222-4222-8222-222222222222', 'other-b04@undal.test', '{"full_name":"Other Chef"}'::jsonb),
  ('93333333-3333-4333-8333-333333333333', 'rider-b04@undal.test', '{"full_name":"Karim Rider"}'::jsonb),
  ('94444444-4444-4444-8444-444444444444', 'minor-b04@undal.test', '{"full_name":"Underage Applicant"}'::jsonb),
  ('95555555-5555-4555-8555-555555555555', 'buyer-b04@undal.test', '{"full_name":"Tahmid Buyer"}'::jsonb),
  ('96666666-6666-4666-8666-666666666666', 'outsider-b04@undal.test', '{"full_name":"Outsider Buyer"}'::jsonb);

SELECT throws_ok(
  $$
    INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, home_zone_id)
    SELECT '94444444-4444-4444-8444-444444444444', 'bicycle', '2011-05-01'::date, id
    FROM public.zones WHERE slug = 'sylhet-sadar'
  $$,
  '23514',
  NULL,
  'riders trigger rejects underage applicant (< 18 years old)'
);

INSERT INTO public.riders (id, profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
SELECT '71111111-1111-4111-8111-111111111111', '93333333-3333-4333-8333-333333333333', 'motorbike', '1999-03-15'::date, 'approved', true, true, id
FROM public.zones WHERE slug = 'sylhet-sadar';

INSERT INTO public.rider_shifts (rider_id, zone_id, vehicle_confirmed)
SELECT '71111111-1111-4111-8111-111111111111', id, 'motorbike' FROM public.zones WHERE slug = 'sylhet-sadar';

SELECT throws_ok(
  $$
    INSERT INTO public.rider_shifts (rider_id, zone_id, vehicle_confirmed)
    SELECT '71111111-1111-4111-8111-111111111111', id, 'motorbike' FROM public.zones WHERE slug = 'sylhet-sadar'
  $$,
  '23505',
  NULL,
  'rider_shifts partial unique index prevents concurrent duplicate open shifts'
);

SELECT public.upsert_presence_heartbeat(
  '93333333-3333-4333-8333-333333333333', 'rider', '71111111-1111-4111-8111-111111111111',
  (SELECT id FROM public.zones WHERE slug = 'sylhet-sadar'),
  24.8920, 91.8720, 90.0, 6.5, 0::smallint, 'fg', 84::smallint, '2026-10-23 19:30:00+06'::timestamptz
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.list_dispatchable_riders_in_zone(
       (SELECT id FROM public.zones WHERE slug = 'sylhet-sadar'), 90, '2026-10-23 19:30:30+06'::timestamptz) $$,
  ARRAY[1],
  'Fresh online rider heartbeat appears in list_dispatchable_riders_in_zone'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.list_dispatchable_riders_in_zone(
       (SELECT id FROM public.zones WHERE slug = 'sylhet-sadar'), 90, '2026-10-23 19:35:00+06'::timestamptz) $$,
  ARRAY[0],
  'Stale rider heartbeat (> 90s old) is automatically excluded from dispatch candidates'
);

-- 4. HOME_KITCHEN setup, single-vendor cart guard, idempotent `place_order`, QR handover & dynamic address privacy
INSERT INTO public.vendors (
  id, owner_profile_id, type, legal_name, brand_name, slug,
  lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
  cuisines, kyc_status, is_active, min_order_poisha
)
SELECT
  '81111111-1111-4111-8111-111111111111', '91111111-1111-4111-8111-111111111111', 'HOME_KITCHEN',
  'Nusrat Jahan', 'Nusrat Kitchen B04', 'nusrat-kitchen-b04',
  24.8884, 91.8796, '', 'Upashahar, Sylhet', 'Flat 4B, House 19, Road 7, Upashahar', '01711000999', id,
  ARRAY['homemade'], 'approved', true, 15000
FROM public.zones WHERE slug = 'sylhet-sadar';

INSERT INTO public.vendors (
  id, owner_profile_id, type, legal_name, brand_name, slug,
  lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
  cuisines, kyc_status, is_active
)
SELECT
  '82222222-2222-4222-8222-822222222222', '92222222-2222-4222-8222-222222222222', 'RESTAURANT',
  'Other Handi', 'Other Handi B04', 'other-handi-b04',
  24.8950, 91.8690, '', 'Zindabazar, Sylhet', 'Plot 8, Zindabazar', '01811000888', id,
  ARRAY['biryani'], 'approved', true
FROM public.zones WHERE slug = 'sylhet-sadar';

INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, is_closed)
VALUES ('81111111-1111-4111-8111-111111111111', 5, '10:00', '23:00', false);

INSERT INTO public.menu_categories (id, vendor_id, name_en) VALUES
  ('83333333-3333-4333-8333-833333333331', '81111111-1111-4111-8111-111111111111', 'Mains'),
  ('83333333-3333-4333-8333-833333333332', '82222222-2222-4222-8222-822222222222', 'Other Mains');

INSERT INTO public.menu_items (id, vendor_id, category_id, name_en, price_poisha) VALUES
  ('84444444-4444-4444-8444-844444444441', '81111111-1111-4111-8111-111111111111', '83333333-3333-4333-8333-833333333331', 'Beef Satkora Bowl', 20000),
  ('84444444-4444-4444-8444-844444444442', '82222222-2222-4222-8222-822222222222', '83333333-3333-4333-8333-833333333332', 'Mutton Tehari', 25000);

INSERT INTO public.customer_addresses (id, profile_id, label, lat, lng, geohash, address_text, is_default)
VALUES ('85555555-5555-4555-8555-855555555555', '95555555-5555-4555-8555-555555555555', 'Home', 24.8949, 91.8687, '', 'Zindabazar, Sylhet', true);

INSERT INTO public.carts (id, customer_id, vendor_id, address_id, fulfilment, voucher_code)
VALUES ('86666666-6666-4666-8666-866666666666', '95555555-5555-4555-8555-555555555555', '81111111-1111-4111-8111-111111111111', '85555555-5555-4555-8555-855555555555', 'delivery', 'SYLHET100');

SELECT throws_ok(
  $$ INSERT INTO public.cart_items (cart_id, menu_item_id, qty, unit_snapshot_poisha)
     VALUES ('86666666-6666-4666-8666-866666666666', '84444444-4444-4444-8444-844444444442', 1, 25000) $$,
  '23514',
  NULL,
  'validate_cart_item_vendor rejects adding another kitchen dish into active cart (CART_VENDOR_CONFLICT)'
);

INSERT INTO public.cart_items (cart_id, menu_item_id, qty, unit_snapshot_poisha)
VALUES ('86666666-6666-4666-8666-866666666666', '84444444-4444-4444-8444-844444444441', 2, 20000);

-- 50/50 split flat voucher (`10,000` poisha off `40,000` items + `2,000` delivery + `500` platform = exact Vector `M-3`!)
INSERT INTO public.vouchers (code, title_en, kind, value_num, min_order_poisha, vendor_share_bps, budget_cap_poisha, starts_at, ends_at, is_active)
VALUES ('SYLHET100', 'Sylhet Launch 100 Tk', 'flat', 10000, 30000, 5000, 50000, '2026-10-01 00:00+06', '2026-11-01 00:00+06', true);

-- Stale client total (`99999` != `32500`) is rejected with `40001` (`CART_STALE`)
SELECT throws_ok(
  $$ SELECT public.place_order('95555555-5555-4555-8555-555555555555', 'idem-stale-check-01', 99999, 2000, 500, false, '2026-10-23 19:30:00+06'::timestamptz) $$,
  '40001',
  NULL,
  'place_order rejects stale client total mismatch with SQLSTATE 40001 (CART_STALE)'
);

-- Valid `place_order` produces exact `M-3` numbers (`cod = 32500`, `vendor_net = 30500`) and replays idempotently!
SELECT results_eq(
  $$
    WITH first_call AS (
      SELECT public.place_order('95555555-5555-4555-8555-555555555555', 'idem-live-order-0001', 32500, 2000, 500, false, '2026-10-23 19:30:00+06'::timestamptz) AS r1
    ),
    replay_call AS (
      SELECT public.place_order('95555555-5555-4555-8555-555555555555', 'idem-live-order-0001', 32500, 2000, 500, false, '2026-10-23 19:30:05+06'::timestamptz) AS r2
      FROM first_call
    )
    SELECT
      (r1 ->> 'cod_collect_poisha')::bigint,
      (r1 ->> 'vendor_net_poisha')::bigint,
      ((r1 ->> 'order_id') = (r2 ->> 'order_id')),
      (r2 ->> 'idempotent_replay')::boolean,
      (SELECT count(*)::int FROM public.orders WHERE customer_id = '95555555-5555-4555-8555-555555555555')
    FROM first_call, replay_call
  $$,
  $$ VALUES (32500::bigint, 30500::bigint, true, true, 1) $$,
  'place_order executes exact M-3 waterfall and returns exact idempotent replay with 1 order row'
);

-- Advance `PLACED -> VENDOR_ACCEPTED -> READY_FOR_PICKUP -> RIDER_ASSIGNED`
DO $$
DECLARE
  v_oid uuid := (SELECT id FROM public.orders WHERE customer_id = '95555555-5555-4555-8555-555555555555');
BEGIN
  PERFORM public.transition_order(v_oid, '91111111-1111-4111-8111-111111111111', 'vendor', 'VENDOR_ACCEPTED', '{"prep_minutes_committed":20}'::jsonb);
  PERFORM public.transition_order(v_oid, '91111111-1111-4111-8111-111111111111', 'vendor', 'READY_FOR_PICKUP', '{}'::jsonb);
  PERFORM public.transition_order(v_oid, NULL, 'system', 'RIDER_ASSIGNED', '{"rider_id":"71111111-1111-4111-8111-111111111111","rider_fare_poisha":6500}'::jsonb);
END;
$$;

-- Assigned active rider CAN read HOME_KITCHEN pickup address NOW, while outsider customer sees 0 orders!
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '96666666-6666-4666-8666-666666666666', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.orders $$,
  ARRAY[0],
  'Outsider customer sees 0 rows in public.orders'
);

SELECT set_config('request.jwt.claim.sub', '93333333-3333-4333-8333-333333333333', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendors WHERE id = '81111111-1111-4111-8111-111111111111' $$,
  ARRAY[1],
  'Assigned active rider can read HOME_KITCHEN pickup address while status = RIDER_ASSIGNED'
);

RESET ROLE;

-- Forged QR token is rejected; real SHA-256 QR token completes handover -> `PICKED_UP`!
SELECT throws_ok(
  $$
    SELECT public.verify_pickup_handover(
      (SELECT id FROM public.orders WHERE customer_id = '95555555-5555-4555-8555-555555555555'),
      '93333333-3333-4333-8333-333333333333',
      'test-qr-secret',
      'forged-bad-token'
    )
  $$,
  '42501',
  NULL,
  'verify_pickup_handover rejects forged QR token with 42501'
);

SELECT results_eq(
  $$
    SELECT (public.verify_pickup_handover(
      o.id,
      '93333333-3333-4333-8333-333333333333',
      'test-qr-secret',
      public.compute_pickup_qr_token(o.id, o.pickup_qr_nonce, 'test-qr-secret'),
      NULL,
      5::smallint,
      ARRAY['polite_staff', 'fast_handover']
    )).status
    FROM public.orders AS o WHERE o.customer_id = '95555555-5555-4555-8555-555555555555'
  $$,
  ARRAY['PICKED_UP'],
  'Valid SHA-256 QR handover transitions order to PICKED_UP and stores rider counter feedback'
);

-- Unreachable door protocol rejects `< 8 min` wait; valid completion reaches `DELIVERED`
SELECT throws_ok(
  $$
    SELECT public.transition_order(
      (SELECT id FROM public.orders WHERE customer_id = '95555555-5555-4555-8555-555555555555'),
      '93333333-3333-4333-8333-333333333333', 'rider', 'FAILED_DELIVERY',
      '{"wait_minutes":3,"call_attempts":1}'::jsonb
    )
  $$,
  '22023',
  NULL,
  'FAILED_DELIVERY blocks rider premature abort when wait < 8 min or calls < 2'
);

SELECT results_eq(
  $$
    SELECT (public.transition_order(
      (SELECT id FROM public.orders WHERE customer_id = '95555555-5555-4555-8555-555555555555'),
      '93333333-3333-4333-8333-333333333333', 'rider', 'DELIVERED', '{}'::jsonb
    )).status
  $$,
  ARRAY['DELIVERED'],
  'Rider completes COD handover -> terminal status DELIVERED'
);

-- Terminal `DELIVERED -> CANCELLED_ADMIN` (`AP-O4`), money mutation, `order_events` mutation & post-delivery HOME_KITCHEN privacy!
SELECT throws_ok(
  $$
    UPDATE public.orders SET status = 'CANCELLED_ADMIN', cancel_reason_key = 'admin_override'
    WHERE customer_id = '95555555-5555-4555-8555-555555555555'
  $$,
  '22023',
  NULL,
  'Terminal state law (AP-O4): DELIVERED -> CANCELLED_ADMIN is strictly forbidden'
);

SELECT throws_ok(
  $$ UPDATE public.orders SET cod_collect_poisha = 100 WHERE customer_id = '95555555-5555-4555-8555-555555555555' $$,
  '55000',
  NULL,
  'Immutable money snapshot trigger blocks any post-placement edit of cod_collect_poisha'
);

SELECT throws_ok(
  $$ DELETE FROM public.order_events $$,
  '55000',
  NULL,
  'Append-only trigger prevents deleting rows from public.order_events'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', '93333333-3333-4333-8333-333333333333', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendors WHERE id = '81111111-1111-4111-8111-111111111111' $$,
  ARRAY[0],
  'Dynamic privacy guard: once order is DELIVERED, former rider immediately loses access to HOME_KITCHEN address'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
