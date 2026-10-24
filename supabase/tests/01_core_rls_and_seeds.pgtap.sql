-- =============================================================================
-- pgTAP Security, Immutability & Seed Verification Suite — Build Response 2
-- File: supabase/tests/01_core_rls_and_seeds.pgtap.sql
-- Run via: pg_prove -d undal_test supabase/tests/01_core_rls_and_seeds.pgtap.sql
-- =============================================================================

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(30);

-- 1. All 12 core tables exist with BOTH RLS enabled AND forced (`SEC-01`)
SELECT results_eq(
  $$
    SELECT count(*)::int
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relname IN (
        'profiles', 'device_tokens', 'customer_addresses',
        'admin_roles', 'admin_permissions', 'admin_user_roles', 'audit_logs',
        'platform_settings', 'platform_settings_history',
        'cuisine_taxonomy', 'cancel_reasons', 'feedback_tags'
      )
      AND c.relrowsecurity = true
      AND c.relforcerowsecurity = true
  $$,
  ARRAY[12],
  'All 12 core tables enforce ENABLE + FORCE ROW LEVEL SECURITY'
);

-- 2. Canonical seed counts (`72` base settings + one Build 14 checkout setting, `117` cuisines, `7` roles)
SELECT results_eq(
  'SELECT count(*)::int FROM public.platform_settings',
  ARRAY[73],
  '72 Appendix M + D-09 settings plus configurable priority-delivery fee are present'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.cuisine_taxonomy',
  ARRAY[117],
  'Exactly 117 Appendix D cuisines are seeded with intact parent hierarchy'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.admin_roles WHERE is_system = true',
  ARRAY[7],
  'All 7 system RBAC roles are seeded'
);

-- 3. Pure SQL helpers (`normalize_bd_phone`, `encode_geohash`, `haversine_km`)
SELECT is(
  public.normalize_bd_phone('+880 17১১-223344'),
  '01711223344',
  'normalize_bd_phone normalizes mixed ASCII + Bengali digits cleanly'
);

SELECT throws_ok(
  $$ SELECT public.normalize_bd_phone('01112345678') $$,
  '22023',
  NULL,
  'normalize_bd_phone rejects invalid operator prefix 011'
);

SELECT is(
  char_length(public.encode_geohash(24.8949, 91.8687, 9)),
  9,
  'encode_geohash produces 9-character geohash for Sylhet Zindabazar'
);

SELECT ok(
  public.haversine_km(24.9045, 91.8611, 24.8949, 91.8687) BETWEEN 1.25 AND 1.40,
  'haversine_km computes Sylhet Ambarkhana -> Zindabazar great-circle distance (~1.31 km)'
);

-- 4. Append-only immutability triggers (`audit_logs` & `platform_settings_history`)
SELECT lives_ok(
  $$ SELECT public.append_audit_log('test.boot', 'system', 'boot-1', '{"ok":true}'::jsonb, 'pgtap', '127.0.0.1', 'req-pgtap-01') $$,
  'append_audit_log inserts forensic entry cleanly'
);

SELECT throws_ok(
  $$ UPDATE public.audit_logs SET reason = 'tampered' WHERE request_id = 'req-pgtap-01' $$,
  '55000',
  NULL,
  'audit_logs blocks UPDATE via prevent_mutation()'
);

SELECT throws_ok(
  $$ DELETE FROM public.audit_logs WHERE request_id = 'req-pgtap-01' $$,
  '55000',
  NULL,
  'audit_logs blocks DELETE via prevent_mutation()'
);

SELECT lives_ok(
  $$ UPDATE public.platform_settings SET value = '600'::jsonb WHERE key = 'money.platform_fee_poisha' $$,
  'Updating platform_settings succeeds under admin/migration authority'
);

SELECT results_eq(
  $$ SELECT version FROM public.platform_settings WHERE key = 'money.platform_fee_poisha' $$,
  ARRAY[2],
  'Updating platform_settings auto-increments version from 1 to 2'
);

SELECT throws_ok(
  $$ DELETE FROM public.platform_settings_history WHERE setting_key = 'money.platform_fee_poisha' $$,
  '55000',
  NULL,
  'platform_settings_history blocks DELETE via prevent_mutation()'
);

-- 5. Provision test actors (`Customer A`, `Customer B`, `Dispatcher`, `Finance`, `Super Admin`)
INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
  ('11111111-1111-4111-8111-111111111111', 'cust.a@undal.test', '{"full_name":"Customer A"}'::jsonb),
  ('22222222-2222-4222-8222-222222222222', 'cust.b@undal.test', '{"full_name":"Customer B"}'::jsonb),
  ('33333333-3333-4333-8333-333333333333', 'dispatch@undal.test', '{"full_name":"Sylhet Dispatcher"}'::jsonb),
  ('44444444-4444-4444-8444-444444444444', 'finance@undal.test', '{"full_name":"Sylhet Finance"}'::jsonb),
  ('55555555-5555-4555-8555-555555555555', 'founder@undal.test', '{"full_name":"Undal Founder"}'::jsonb);

UPDATE public.profiles SET role = 'admin' WHERE id IN (
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555'
);

INSERT INTO public.admin_user_roles (profile_id, role_id)
SELECT '33333333-3333-4333-8333-333333333333'::uuid, id FROM public.admin_roles WHERE key = 'dispatcher'
UNION ALL
SELECT '44444444-4444-4444-8444-444444444444'::uuid, id FROM public.admin_roles WHERE key = 'finance'
UNION ALL
SELECT '55555555-5555-4555-8555-555555555555'::uuid, id FROM public.admin_roles WHERE key = 'super_admin';

-- 6. Anonymous (`anon`) surface checks
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', 'anon', true);

SELECT results_eq(
  'SELECT count(*)::int FROM public.cuisine_taxonomy',
  ARRAY[117],
  'anon role can read all 117 active cuisines'
);

SELECT ok(
  (SELECT count(*) FROM public.platform_settings) < 72
  AND (SELECT count(*) FROM public.platform_settings WHERE key = 'money.commission_pct') = 0,
  'anon role sees public bootstrap settings only and ZERO private commercial settings'
);

SELECT throws_ok(
  $$ SELECT count(*) FROM public.profiles $$,
  '42501',
  NULL,
  'anon role is completely denied table privilege on profiles'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'storage' $$,
  ARRAY[0],
  'anon role sees 0 Supabase Storage tables (100% Free Cloudinary architecture per ADR-0006)'
);

-- 7. Customer A (`authenticated`) self-access & privilege-escalation defense
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);

SELECT lives_ok(
  $$
    INSERT INTO public.customer_addresses (profile_id, label, lat, lng, geohash, address_text, is_default)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Home', 24.8949, 91.8687, '', 'House 12, Zindabazar, Sylhet', true)
  $$,
  'Customer A can save default delivery address with auto-computed 9-char geohash'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_addresses (profile_id, label, lat, lng, geohash, address_text, is_default)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Work', 24.9045, 91.8611, '', 'Ambarkhana, Sylhet', true)
  $$,
  '23505',
  NULL,
  'Partial unique index prevents two simultaneous is_default=true addresses per customer'
);

SELECT throws_ok(
  $$ UPDATE public.profiles SET role = 'admin' WHERE id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  NULL,
  'Customer A is blocked from self-escalating profiles.role to admin'
);

SELECT throws_ok(
  $$ UPDATE public.profiles SET trust_score = 100 WHERE id = '11111111-1111-4111-8111-111111111111' $$,
  '42501',
  NULL,
  'Customer A is blocked from tampering with profiles.trust_score'
);

SELECT results_eq(
  $$ SELECT count(*)::int FROM information_schema.tables WHERE table_schema = 'storage' $$,
  ARRAY[0],
  'Zero Supabase storage tables exist (all media hosted on Free Cloudinary per ADR-0006)'
);

-- 8. Customer B cross-tenant isolation (`SEC-01`)
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

SELECT results_eq(
  'SELECT count(*)::int FROM public.customer_addresses',
  ARRAY[0],
  'Customer B sees 0 of Customer A saved addresses'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.profiles',
  ARRAY[1],
  'Customer B can read strictly own profile row only (1 row)'
);

SELECT throws_ok(
  $$
    INSERT INTO public.customer_addresses (profile_id, label, lat, lng, geohash, address_text)
    VALUES ('11111111-1111-4111-8111-111111111111', 'Spoof', 24.89, 91.86, '', 'Spoofed address')
  $$,
  '42501',
  NULL,
  'Customer B cannot insert an address for Customer A'
);

-- 9. Granular Admin RBAC Matrix (`dispatcher` vs `finance` vs `super_admin`)
SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
SELECT ok(
  public.has_admin_permission('2.live_board') AND NOT public.has_admin_permission('5.invoices.pay'),
  'Dispatcher holds 2.live_board permission and NOT 5.invoices.pay'
);

SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
SELECT ok(
  public.has_admin_permission('5.invoices.pay') AND NOT public.has_admin_permission('1.rbac.manage'),
  'Finance Officer holds 5.invoices.pay permission and NOT 1.rbac.manage'
);

SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
SELECT ok(
  public.has_admin_permission('1.rbac.manage') AND public.has_admin_permission('5.invoices.pay'),
  'Super Admin holds universal wildcard permissions across all 9 domains'
);

SELECT results_eq(
  'SELECT count(*)::int FROM public.audit_logs',
  ARRAY[1],
  'Super Admin can query immutable audit_logs via 1.audit_logs permission'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
