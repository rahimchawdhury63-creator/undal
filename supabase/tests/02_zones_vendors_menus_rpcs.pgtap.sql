-- =============================================================================
-- pgTAP Zone, 3-Track Vendor Privacy, Menu Combo & rank_v1 RPC Suite — Build 3
-- File: supabase/tests/02_zones_vendors_menus_rpcs.pgtap.sql
-- Run via: pg_prove -d undal_test supabase/tests/*.pgtap.sql
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

-- 1. All 15 Build 3 tables exist with ENABLE + FORCE RLS AND zero public tables lack FORCE RLS
SELECT results_eq(
  $$
    SELECT
      count(*) FILTER (WHERE c.relname IN (
        'zones', 'vendors', 'vendor_staff_members', 'vendor_hours',
        'vendor_pauses', 'vendor_documents', 'vendor_payout_accounts',
        'menu_categories', 'menu_items', 'variant_groups', 'variants',
        'option_groups', 'options', 'bundle_slots', 'bundle_slot_choices'
      ) AND c.relrowsecurity = true AND c.relforcerowsecurity = true)::int AS matched,
      count(*) FILTER (WHERE NOT (c.relrowsecurity = true AND c.relforcerowsecurity = true))::int AS unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  $$,
  $$ VALUES (15::int, 0::int) $$,
  'All 15 Build 3 tables exist and 100% of public tables enforce ENABLE + FORCE ROW LEVEL SECURITY'
);

-- 2. Seeded launch zones (`Sylhet Sadar` active, `Kulaura` paused)
SELECT results_eq(
  $$ SELECT slug FROM public.resolve_zone(24.8949, 91.8687) WHERE in_service_area = true $$,
  ARRAY['sylhet-sadar'],
  'Zindabazar (24.8949, 91.8687) resolves inside active Sylhet Sadar polygon'
);

SELECT results_eq(
  $$ SELECT in_service_area FROM public.resolve_zone(24.5186, 92.0336) $$,
  ARRAY[false],
  'Paused Kulaura polygon reports in_service_area = false until activated'
);

-- Smaller overlapping active sub-polygon wins (`File 14 §14.4`)
INSERT INTO public.zones (name_en, name_bn, slug, polygon, center_lat, center_lng, is_active)
VALUES (
  'Zindabazar Micro',
  'জিন্দাবাজার কোর',
  'zindabazar-micro',
  '[[91.8640,24.8910],[91.8730,24.8910],[91.8730,24.8990],[91.8640,24.8990],[91.8640,24.8910]]'::jsonb,
  24.8949,
  91.8687,
  true
);

SELECT results_eq(
  $$ SELECT slug FROM public.resolve_zone(24.8949, 91.8687) $$,
  ARRAY['zindabazar-micro'],
  'Smallest containing active polygon wins when delivery zones overlap (File 14 §14.4)'
);

DELETE FROM public.zones WHERE slug = 'zindabazar-micro';

-- 3. Provision test actors (`Home Chef`, `Restaurant Owner`, `Kitchen Staff`, `Stranger Customer`)
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('aaaa1111-1111-4111-8111-111111111111', 'homechef@undal.test', '{"full_name":"Nusrat Home Chef"}'::jsonb),
  ('bbbb2222-2222-4222-8222-222222222222', 'restowner@undal.test', '{"full_name":"Jalal Restaurant Owner"}'::jsonb),
  ('cccc3333-3333-4333-8333-333333333333', 'staff@undal.test', '{"full_name":"Rafi Counter Staff"}'::jsonb),
  ('dddd4444-4444-4444-8444-444444444444', 'stranger@undal.test', '{"full_name":" curiosity Customer"}'::jsonb);

UPDATE public.profiles SET role = 'vendor_owner' WHERE id IN (
  'aaaa1111-1111-4111-8111-111111111111',
  'bbbb2222-2222-4222-8222-222222222222'
);
UPDATE public.profiles SET role = 'vendor_staff' WHERE id = 'cccc3333-3333-4333-8333-333333333333';

-- Invalid taxonomy slug in `cuisines[]` is rejected by `before_write_vendor()`
SELECT throws_ok(
  $$
    INSERT INTO public.vendors (
      owner_profile_id, type, legal_name, brand_name, slug,
      lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id, cuisines
    )
    SELECT
      'aaaa1111-1111-4111-8111-111111111111', 'HOME_KITCHEN', 'Test Kitchen', 'Test Kitchen', 'bad-cuisine-test',
      24.8881, 91.8794, '', 'Upashahar, Sylhet', 'Flat 4B, Road 7, Block C, Upashahar', '01712345678', id,
      ARRAY['nonexistent_cuisine']
    FROM public.zones WHERE slug = 'sylhet-sadar'
  $$,
  '23503',
  NULL,
  'vendors.cuisines[] rejects unknown taxonomy keys'
);

-- Insert approved `HOME_KITCHEN` (omitting `accepts_pickup` to test D-24 false default) + approved `RESTAURANT`
INSERT INTO public.vendors (
  id, owner_profile_id, type, legal_name, brand_name, brand_name_bn, slug,
  lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
  cuisines, kyc_status, is_active, rating_avg, rating_count, avg_prep_min
)
SELECT
  '10101010-1010-4010-8010-101010101010',
  'aaaa1111-1111-4111-8111-111111111111',
  'HOME_KITCHEN',
  'Nusrat Jahan',
  'Nusrat Gharoa Kitchen',
  'নুসরাত ঘরোয়া কিচেন',
  'nusrat-gharoa-kitchen',
  24.888432, 91.879654, '',
  'Upashahar, Sylhet',
  'Flat 4B, House 19, Road 7, Block C, Shahjalal Upashahar',
  '01711000111',
  z.id,
  ARRAY['homemade', 'satkora', 'bhorta'],
  'approved', true, 4.85, 42, 25
FROM public.zones AS z WHERE z.slug = 'sylhet-sadar';

INSERT INTO public.vendors (
  id, owner_profile_id, type, legal_name, brand_name, brand_name_bn, slug,
  lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
  cuisines, kyc_status, is_active, rating_avg, rating_count, avg_prep_min
)
SELECT
  '20202020-2020-4020-8020-202020202020',
  'bbbb2222-2222-4222-8222-222222222222',
  'RESTAURANT',
  'Panshi Sylhet Ltd',
  'Sylhet Heritage Handi',
  'সিলেট হেরিটেজ হাঁড়ি',
  'sylhet-heritage-handi',
  24.895200, 91.868900, '',
  'Zindabazar, Sylhet',
  'Plot 14, Water Works Road, Zindabazar, Sylhet',
  '01811000222',
  z.id,
  ARRAY['bangladeshi', 'biryani', 'local_sylhet'],
  'approved', true, 4.70, 180, 18
FROM public.zones AS z WHERE z.slug = 'sylhet-sadar';

-- Bind kitchen staff, payout account & KYC doc on Restaurant
INSERT INTO public.vendor_staff_members (vendor_id, profile_id, role)
VALUES ('20202020-2020-4020-8020-202020202020', 'cccc3333-3333-4333-8333-333333333333', 'kitchen_staff');

INSERT INTO public.vendor_payout_accounts (vendor_id, method, holder_name, account_ref_enc, masked)
VALUES ('20202020-2020-4020-8020-202020202020', 'bkash', 'Jalal Uddin', decode('0102030405060708', 'hex'), '•••0222');

INSERT INTO public.vendor_documents (vendor_id, doc_type, storage_path)
VALUES ('20202020-2020-4020-8020-202020202020', 'trade_license', 'bbbb2222-2222-4222-8222-222222222222/trade_license/lic.pdf');

SELECT results_eq(
  $$ SELECT accepts_pickup FROM public.vendors WHERE id = '10101010-1010-4010-8010-101010101010' $$,
  ARRAY[false],
  'D-24 law: HOME_KITCHEN defaults accepts_pickup = false when omitted'
);

SELECT results_eq(
  $$ SELECT accepts_pickup FROM public.vendors WHERE id = '20202020-2020-4020-8020-202020202020' $$,
  ARRAY[true],
  'RESTAURANT defaults accepts_pickup = true when omitted'
);

-- 4. Hours (`>= 4h x 5d` compliance, post-midnight rollover & active pause)
INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, open2, close2, is_closed) VALUES
  ('20202020-2020-4020-8020-202020202020', 0, '11:30', '15:30', '18:00', '23:30', false),
  ('20202020-2020-4020-8020-202020202020', 1, '11:30', '15:30', '18:00', '23:30', false),
  ('20202020-2020-4020-8020-202020202020', 2, '11:30', '15:30', '18:00', '23:30', false),
  ('20202020-2020-4020-8020-202020202020', 3, '11:30', '15:30', '18:00', '23:30', false);

SELECT results_eq(
  $$ SELECT public.vendor_weekly_open_compliance('20202020-2020-4020-8020-202020202020') $$,
  ARRAY[false],
  'vendor_weekly_open_compliance returns false with only 4 open days (< 5 required by File 21)'
);

INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, open2, close2, is_closed) VALUES
  ('20202020-2020-4020-8020-202020202020', 5, '13:30', '17:30', '22:00', '02:00', false);

SELECT results_eq(
  $$ SELECT public.vendor_weekly_open_compliance('20202020-2020-4020-8020-202020202020') $$,
  ARRAY[true],
  'vendor_weekly_open_compliance returns true once >= 5 days have >= 4 open hours'
);

-- Post-midnight check: Friday night 22:00-02:00 evaluated on Saturday 01:15 Asia/Dhaka (`2026-10-24 01:15+06`)
SELECT results_eq(
  $$ SELECT public.is_vendor_open_now('20202020-2020-4020-8020-202020202020', '2026-10-24 01:15:00+06'::timestamptz) $$,
  ARRAY[true],
  'is_vendor_open_now accurately handles post-midnight shift rollover into Saturday 01:15 Asia/Dhaka'
);

-- 5. Menu items & Combo/Bundle satisfiability (`is_menu_item_orderable_now`)
INSERT INTO public.menu_categories (id, vendor_id, name_en, name_bn, category_type, sort)
VALUES ('30303030-3030-4030-8030-303030303030', '20202020-2020-4020-8020-202020202020', 'Combos', 'কম্বো সেট', 'combo', 1);

INSERT INTO public.menu_items (id, vendor_id, category_id, name_en, name_bn, price_poisha, item_type, is_available) VALUES
  ('40404040-4040-4040-8040-404040404041', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Beef Satkora Platter', 'সাতকড়া গরুর প্ল্যাটার', 32000, 'simple', true),
  ('40404040-4040-4040-8040-404040404042', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Shahi Borhani Glass', 'শাহী বোরহানি', 7000, 'simple', true),
  ('40404040-4040-4040-8040-404040404043', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Feast For 1 Combo', 'ফিস্ট কম্বো', 36000, 'bundle', true);

INSERT INTO public.bundle_slots (id, bundle_item_id, name_en, min_pick, max_pick, sort)
VALUES ('50505050-5050-4050-8050-505050505050', '40404040-4040-4040-8040-404040404043', 'Choose Drink', 1, 1, 1);

INSERT INTO public.bundle_slot_choices (slot_id, item_id, price_delta_poisha)
VALUES ('50505050-5050-4050-8050-505050505050', '40404040-4040-4040-8040-404040404042', 0);

SELECT results_eq(
  $$ SELECT public.is_menu_item_orderable_now('40404040-4040-4040-8040-404040404043') $$,
  ARRAY[true],
  'Combo bundle item is orderable when required slot choice is available'
);

UPDATE public.menu_items SET is_available = false WHERE id = '40404040-4040-4040-8040-404040404042';

SELECT results_eq(
  $$ SELECT public.is_menu_item_orderable_now('40404040-4040-4040-8040-404040404043') $$,
  ARRAY[false],
  'Combo bundle item automatically becomes unorderable when required slot choices run out'
);

-- 6. Anonymous (`anon`) & Stranger Customer RLS + Privacy Verification (`D-24`, `SEC-01`)
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);

SELECT throws_ok(
  $$ SELECT count(*) FROM public.vendors $$,
  '42501',
  NULL,
  'anon role has ZERO direct SELECT access on raw public.vendors'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.zones $$,
  ARRAY[1],
  'anon role sees only active Sylhet Sadar zone (paused Kulaura hidden)'
);

SELECT ok(
  (public.get_vendor_storefront('nusrat-gharoa-kitchen') -> 'vendor' ->> 'address_text_private') IS NULL
  AND length(public.get_vendor_storefront('nusrat-gharoa-kitchen') -> 'vendor' ->> 'display_geohash') = 5,
  'Public storefront RPC strips HOME_KITCHEN address_text_private and truncates geohash to 5 chars'
);

SELECT ok(
  jsonb_array_length(public.get_home_feed(24.8949, 91.8687, 'delivery') -> 'vendors') = 2
  AND jsonb_array_length(public.get_home_feed(24.8949, 91.8687, 'pickup') -> 'vendors') = 1,
  'get_home_feed returns 2 delivery kitchens and filters out pickup-disabled HOME_KITCHEN in pickup mode'
);

SELECT ok(
  jsonb_array_length(public.search_catalog('সাতকড়া', 24.8949, 91.8687)) >= 1
  AND jsonb_array_length(public.search_catalog('satkora', 24.8949, 91.8687)) >= 1,
  'search_catalog matches both Bengali script (সাতকড়া) and Banglish (satkora)'
);

-- Stranger authenticated customer cannot query raw `public.vendors` either!
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'dddd4444-4444-4444-8444-444444444444', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendors $$,
  ARRAY[0],
  'Arbitrary customer sees 0 rows in raw public.vendors (HOME_KITCHEN Flat 4B address protected)'
);

-- Customer saving a Zindabazar pin automatically resolves `zone_id`!
INSERT INTO public.customer_addresses (profile_id, label, lat, lng, geohash, address_text, is_default)
VALUES ('dddd4444-4444-4444-8444-444444444444', 'Home', 24.8949, 91.8687, '', 'Zindabazar, Sylhet', true);

SELECT ok(
  (SELECT zone_id FROM public.customer_addresses WHERE profile_id = 'dddd4444-4444-4444-8444-444444444444') IS NOT NULL,
  'customer_addresses automatically resolves and stores active Sylhet Sadar zone_id at save time'
);

-- 7. Kitchen Staff RLS: operational access YES, payout accounts & KYC docs NO!
SELECT set_config('request.jwt.claim.sub', 'cccc3333-3333-4333-8333-333333333333', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendors $$,
  ARRAY[1],
  'Kitchen staff member sees strictly own assigned outlet (1 vendor row)'
);

SELECT lives_ok(
  $$ INSERT INTO public.vendor_pauses (vendor_id, ends_at, reason) VALUES ('20202020-2020-4020-8020-202020202020', clock_timestamp() + interval '15 minutes', 'Peak rush') $$,
  'Kitchen staff member can trigger temporary kitchen busy pause'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendor_payout_accounts $$,
  ARRAY[0],
  'Kitchen staff member sees 0 payout accounts (strict owner/finance isolation)'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendor_documents $$,
  ARRAY[0],
  'Kitchen staff member sees 0 private KYC documents (strict owner/KYC admin isolation)'
);

-- Restaurant Owner DOES see own payout account & KYC doc
SELECT set_config('request.jwt.claim.sub', 'bbbb2222-2222-4222-8222-222222222222', true);

SELECT results_eq(
  $$ SELECT count(*)::int FROM public.vendor_payout_accounts $$,
  ARRAY[1],
  'Restaurant owner sees own encrypted payout account record'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
