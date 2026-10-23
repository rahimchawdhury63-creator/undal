-- =============================================================================
-- Migration: 0004_core_rls_and_seeds.sql
-- Milestone: Build Response 2 (Migrations I — Core RLS Policies & Canonical Seeds)
-- References: Master Guide File 05 (§5.2), File 09 (§9.2), ADR-0006 (Zero Supabase Storage), Appendix C/D/M
-- Notes:
--   * Zero demo/fake records: seeds strictly canonical RBAC roles/permissions,
--     72 platform_settings defaults, 117 Appendix D cuisines, and cancel/feedback vocabularies.
--   * Zero Supabase Storage buckets (all public & authenticated assets hosted on Free Cloudinary per ADR-0006).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Least-Privilege Schema & Table Grants (anon, authenticated, service_role)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT ON public.cuisine_taxonomy, public.cancel_reasons, public.feedback_tags, public.platform_settings TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_tokens, public.customer_addresses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_roles, public.admin_permissions, public.admin_user_roles TO authenticated;
GRANT SELECT, UPDATE ON public.platform_settings TO authenticated;
GRANT SELECT ON public.platform_settings_history, public.audit_logs TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.cuisine_taxonomy, public.cancel_reasons, public.feedback_tags TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Row-Level Security Policies (0002 + 0003 — 12 / 12 Tables Protected)
-- -----------------------------------------------------------------------------

-- 2.1 public.profiles
DROP POLICY IF EXISTS profiles_service_all ON public.profiles;
CREATE POLICY profiles_service_all ON public.profiles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_admin_permission('1.rbac.view')
    OR public.has_admin_permission('4.vendor_360')
    OR public.has_admin_permission('6.order_360')
    OR public.has_admin_permission('8.customer_360')
  );

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() AND role = 'customer' AND status = 'active' AND trust_score = 70);

DROP POLICY IF EXISTS profiles_update_self_or_rbac_admin ON public.profiles;
CREATE POLICY profiles_update_self_or_rbac_admin ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_admin_permission('1.rbac.manage'))
  WITH CHECK (id = auth.uid() OR public.has_admin_permission('1.rbac.manage'));

-- 2.2 public.device_tokens
DROP POLICY IF EXISTS device_tokens_service_all ON public.device_tokens;
CREATE POLICY device_tokens_service_all ON public.device_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS device_tokens_own_crud ON public.device_tokens;
CREATE POLICY device_tokens_own_crud ON public.device_tokens
  FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.has_admin_permission('2.live_board'))
  WITH CHECK (profile_id = auth.uid());

-- 2.3 public.customer_addresses
DROP POLICY IF EXISTS customer_addresses_service_all ON public.customer_addresses;
CREATE POLICY customer_addresses_service_all ON public.customer_addresses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS customer_addresses_own_crud ON public.customer_addresses;
CREATE POLICY customer_addresses_own_crud ON public.customer_addresses
  FOR ALL TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS customer_addresses_admin_read ON public.customer_addresses;
CREATE POLICY customer_addresses_admin_read ON public.customer_addresses
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('8.customer_360'));

-- 2.4 admin_roles, admin_permissions, admin_user_roles
DROP POLICY IF EXISTS admin_roles_service_all ON public.admin_roles;
CREATE POLICY admin_roles_service_all ON public.admin_roles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admin_roles_read ON public.admin_roles;
CREATE POLICY admin_roles_read ON public.admin_roles
  FOR SELECT TO authenticated
  USING (public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS admin_roles_manage ON public.admin_roles;
CREATE POLICY admin_roles_manage ON public.admin_roles
  FOR ALL TO authenticated
  USING (public.has_admin_permission('1.rbac.manage'))
  WITH CHECK (public.has_admin_permission('1.rbac.manage'));

DROP POLICY IF EXISTS admin_permissions_service_all ON public.admin_permissions;
CREATE POLICY admin_permissions_service_all ON public.admin_permissions
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admin_permissions_read ON public.admin_permissions;
CREATE POLICY admin_permissions_read ON public.admin_permissions
  FOR SELECT TO authenticated
  USING (public.current_profile_role() = 'admin');

DROP POLICY IF EXISTS admin_permissions_manage ON public.admin_permissions;
CREATE POLICY admin_permissions_manage ON public.admin_permissions
  FOR ALL TO authenticated
  USING (public.has_admin_permission('1.rbac.manage'))
  WITH CHECK (public.has_admin_permission('1.rbac.manage'));

DROP POLICY IF EXISTS admin_user_roles_service_all ON public.admin_user_roles;
CREATE POLICY admin_user_roles_service_all ON public.admin_user_roles
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS admin_user_roles_read_own_or_admin ON public.admin_user_roles;
CREATE POLICY admin_user_roles_read_own_or_admin ON public.admin_user_roles
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.has_admin_permission('1.rbac.view'));

DROP POLICY IF EXISTS admin_user_roles_manage ON public.admin_user_roles;
CREATE POLICY admin_user_roles_manage ON public.admin_user_roles
  FOR ALL TO authenticated
  USING (public.has_admin_permission('1.rbac.manage'))
  WITH CHECK (public.has_admin_permission('1.rbac.manage'));

-- 2.5 public.audit_logs (Append-Only; reads gated by 1.audit_logs)
DROP POLICY IF EXISTS audit_logs_service_all ON public.audit_logs;
CREATE POLICY audit_logs_service_all ON public.audit_logs
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS audit_logs_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_admin_read ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('1.audit_logs'));

-- 2.6 public.platform_settings & public.platform_settings_history
DROP POLICY IF EXISTS platform_settings_service_all ON public.platform_settings;
CREATE POLICY platform_settings_service_all ON public.platform_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS platform_settings_public_read ON public.platform_settings;
CREATE POLICY platform_settings_public_read ON public.platform_settings
  FOR SELECT TO anon, authenticated
  USING (is_public_readable = true);

DROP POLICY IF EXISTS platform_settings_admin_read ON public.platform_settings;
CREATE POLICY platform_settings_admin_read ON public.platform_settings
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('1.settings.view'));

DROP POLICY IF EXISTS platform_settings_admin_write ON public.platform_settings;
CREATE POLICY platform_settings_admin_write ON public.platform_settings
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('1.settings.edit'))
  WITH CHECK (public.has_admin_permission('1.settings.edit'));

DROP POLICY IF EXISTS platform_settings_history_service_all ON public.platform_settings_history;
CREATE POLICY platform_settings_history_service_all ON public.platform_settings_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS platform_settings_history_admin_read ON public.platform_settings_history;
CREATE POLICY platform_settings_history_admin_read ON public.platform_settings_history
  FOR SELECT TO authenticated
  USING (public.has_admin_permission('1.settings.view'));

-- 2.7 cuisine_taxonomy, cancel_reasons, feedback_tags
DROP POLICY IF EXISTS cuisine_taxonomy_service_all ON public.cuisine_taxonomy;
CREATE POLICY cuisine_taxonomy_service_all ON public.cuisine_taxonomy
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cuisine_taxonomy_public_active ON public.cuisine_taxonomy;
CREATE POLICY cuisine_taxonomy_public_active ON public.cuisine_taxonomy
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('4.catalog'));

DROP POLICY IF EXISTS cuisine_taxonomy_admin_manage ON public.cuisine_taxonomy;
CREATE POLICY cuisine_taxonomy_admin_manage ON public.cuisine_taxonomy
  FOR ALL TO authenticated
  USING (public.has_admin_permission('4.catalog'))
  WITH CHECK (public.has_admin_permission('4.catalog'));

DROP POLICY IF EXISTS cancel_reasons_service_all ON public.cancel_reasons;
CREATE POLICY cancel_reasons_service_all ON public.cancel_reasons
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS cancel_reasons_public_active ON public.cancel_reasons;
CREATE POLICY cancel_reasons_public_active ON public.cancel_reasons
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('1.settings.view'));

DROP POLICY IF EXISTS cancel_reasons_admin_manage ON public.cancel_reasons;
CREATE POLICY cancel_reasons_admin_manage ON public.cancel_reasons
  FOR ALL TO authenticated
  USING (public.has_admin_permission('1.settings.edit'))
  WITH CHECK (public.has_admin_permission('1.settings.edit'));

DROP POLICY IF EXISTS feedback_tags_service_all ON public.feedback_tags;
CREATE POLICY feedback_tags_service_all ON public.feedback_tags
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS feedback_tags_public_active ON public.feedback_tags;
CREATE POLICY feedback_tags_public_active ON public.feedback_tags
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('1.settings.view'));

DROP POLICY IF EXISTS feedback_tags_admin_manage ON public.feedback_tags;
CREATE POLICY feedback_tags_admin_manage ON public.feedback_tags
  FOR ALL TO authenticated
  USING (public.has_admin_permission('1.settings.edit'))
  WITH CHECK (public.has_admin_permission('1.settings.edit'));

-- -----------------------------------------------------------------------------
-- 3. Media Architecture Note (ADR-0006 — Zero Supabase Storage)
--    All public food photos & private/authenticated KYC, remittance & invoice assets
--    live on Free Cloudinary (`undal/public/*` + `undal/private/*`), tracked in `public.media_assets`.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- 4. Canonical System RBAC Roles & Domain Permission Grants (File 09, Appendix C)
-- -----------------------------------------------------------------------------
INSERT INTO public.admin_roles (key, name_en, name_bn, description_en, is_system)
VALUES
  ('super_admin', 'Super Admin', 'সুপার অ্যাডমিন', 'Full founder control across all 9 domains & 132 capabilities', true),
  ('ops_manager', 'Operations Manager', 'অপারেশনস ম্যানেজার', 'Zones, live dispatch, order escalations, vendor ops & BI', true),
  ('dispatcher', 'Live Dispatcher', 'ডিসপ্যাচার', 'Live dispatch board, manual assign, solo-rider escalation & active orders', true),
  ('vendor_onboarding', 'Vendor & Rider KYC Specialist', 'কেওয়াইসি স্পেশালিস্ট', '3-track partner & rider KYC verification, menu moderation & catalog', true),
  ('finance', 'Finance & Settlement Officer', 'ফাইন্যান্স অফিসার', 'COD cash remittances, weekly vendor/rider invoices, ledger & payouts', true),
  ('support', 'Customer & Partner Support', 'সাপোর্ট এজেন্ট', 'Support tickets, order 360 lookup, customer 360 & SLA queues', true),
  ('compliance_auditor', 'Compliance Auditor (Read-Only)', 'কমপ্লায়েন্স অডিটর', 'Read-only inspection across audit logs, RBAC, settings, finance & orders', true)
ON CONFLICT (key) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_bn = EXCLUDED.name_bn,
  description_en = EXCLUDED.description_en,
  is_system = true;

WITH grants(role_key, perm) AS (
  VALUES
    ('super_admin', '*'),
    ('ops_manager', '1.settings.view'), ('ops_manager', '2.*'), ('ops_manager', '3.*'),
    ('ops_manager', '4.*'), ('ops_manager', '6.*'), ('ops_manager', '7.*'), ('ops_manager', '9.*'),
    ('dispatcher', '2.*'), ('dispatcher', '6.*'),
    ('vendor_onboarding', '4.*'),
    ('finance', '5.*'), ('finance', '6.order_360'), ('finance', '9.*'),
    ('support', '6.order_360'), ('support', '8.*'),
    ('compliance_auditor', '1.rbac.view'), ('compliance_auditor', '1.settings.view'),
    ('compliance_auditor', '1.audit_logs'), ('compliance_auditor', '4.vendor_360'),
    ('compliance_auditor', '5.ledger.view'), ('compliance_auditor', '6.order_360'), ('compliance_auditor', '9.*')
)
INSERT INTO public.admin_permissions (role_id, permission)
SELECT ar.id, g.perm
FROM grants AS g
JOIN public.admin_roles AS ar ON ar.key = g.role_key
ON CONFLICT (role_id, permission) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Canonical Platform Settings Seed (72 Keys — Appendix M + D-09)
-- -----------------------------------------------------------------------------
INSERT INTO public.platform_settings (key, group_key, value, value_type, description_en, is_public_readable)
VALUES
  ('money.commission_pct', 'money', '15'::jsonb, 'integer', 'Vendor commission % on discounted food payable', false),
  ('money.tax_vat_incl_pct', 'money', '5'::jsonb, 'integer', 'VAT-inclusive extraction % (D-08: 5/105)', true),
  ('money.rider_bonus_pct', 'money', '3'::jsonb, 'integer', 'Rider food bonus % from extracted tax stream (D-07)', false),
  ('money.platform_fee_poisha', 'money', '500'::jsonb, 'integer', 'Customer service fee on delivery orders (poisha)', true),
  ('money.invoice_rider_day', 'money', '"FRI"'::jsonb, 'string', 'Weekly rider settlement generation day (Asia/Dhaka)', false),
  ('money.invoice_vendor_day', 'money', '"SAT"'::jsonb, 'string', 'Weekly partner settlement generation day (Asia/Dhaka)', false),
  ('fare.base_motorbike_poisha', 'fare', '3000'::jsonb, 'integer', 'Motorbike base fare (poisha)', false),
  ('fare.base_bicycle_poisha', 'fare', '2500'::jsonb, 'integer', 'Bicycle base fare (poisha)', false),
  ('fare.per_km_motorbike_poisha', 'fare', '1400'::jsonb, 'integer', 'Motorbike per-km rate (poisha)', false),
  ('fare.per_km_bicycle_poisha', 'fare', '800'::jsonb, 'integer', 'Bicycle per-km rate (poisha)', false),
  ('fare.included_km', 'fare', '2'::jsonb, 'integer', 'Distance km covered by base fare', false),
  ('fare.deadhead_factor', 'fare', '0.5'::jsonb, 'number', 'To-vendor deadhead leg multiplier', false),
  ('fare.floor_motorbike_poisha', 'fare', '4000'::jsonb, 'integer', 'Minimum motorbike payout floor (poisha)', false),
  ('fare.floor_bicycle_poisha', 'fare', '3000'::jsonb, 'integer', 'Minimum bicycle payout floor (poisha)', false),
  ('fare.surge_mid_low', 'fare', '1.2'::jsonb, 'number', 'SDR 0.5..1.0 band low multiplier', false),
  ('fare.surge_mid_high', 'fare', '1.4'::jsonb, 'number', 'SDR 0.5..1.0 band high multiplier', false),
  ('fare.surge_severe_low', 'fare', '1.5'::jsonb, 'number', 'SDR < 0.5 band low multiplier', false),
  ('fare.surge_severe_cap', 'fare', '2.2'::jsonb, 'number', 'Hard maximum surge cap', false),
  ('fare.weather_rain_pct', 'fare', '20'::jsonb, 'integer', 'Rain weather boost %', false),
  ('fare.weather_storm_pct', 'fare', '40'::jsonb, 'integer', 'Storm weather boost %', false),
  ('fare.weather_heat_pct', 'fare', '10'::jsonb, 'integer', 'Extreme heat weather boost %', false),
  ('fare.traffic_block_minutes', 'fare', '5'::jsonb, 'integer', 'Minutes per traffic delay compensation block', false),
  ('fare.traffic_block_poisha', 'fare', '400'::jsonb, 'integer', 'Poisha paid per traffic delay block', false),
  ('fare.batch_factor_2', 'fare', '0.6'::jsonb, 'number', '2nd batched order base-fare factor', false),
  ('fare.batch_factor_3', 'fare', '0.5'::jsonb, 'number', '3rd batched order base-fare factor', false),
  ('fare.priority_uplift_poisha', 'fare', '1000'::jsonb, 'integer', 'Priority delivery rider uplift (poisha)', false),
  ('fare.wait_comp_per_min_poisha', 'fare', '200'::jsonb, 'integer', 'Kitchen wait compensation per min beyond grace', false),
  ('dispatch.bicycle_max_km', 'dispatch', '4'::jsonb, 'integer', 'Maximum loaded leg km for bicycle offers', false),
  ('dispatch.motorbike_max_km', 'dispatch', '12'::jsonb, 'integer', 'Maximum loaded leg km for standard motorbike offers', false),
  ('dispatch.offer_ttl_sec', 'dispatch', '30'::jsonb, 'integer', 'Rider offer countdown seconds', false),
  ('dispatch.vendor_respond_ttl_sec', 'dispatch', '180'::jsonb, 'integer', 'Max kitchen accept window seconds', false),
  ('dispatch.vendor_unreachable_cancel_sec', 'dispatch', '120'::jsonb, 'integer', 'Auto-cancel seconds when kitchen presence is stale', false),
  ('dispatch.presence_heartbeat_sec', 'dispatch', '10'::jsonb, 'integer', 'Active delivery GPS ping interval seconds', false),
  ('dispatch.presence_stale_sec', 'dispatch', '25'::jsonb, 'integer', 'Seconds until presence marked stale', false),
  ('dispatch.presence_offline_sec', 'dispatch', '60'::jsonb, 'integer', 'Seconds until presence marked offline', false),
  ('dispatch.max_concurrent_bicycle', 'dispatch', '2'::jsonb, 'integer', 'Max concurrent orders for bicycle', false),
  ('dispatch.max_concurrent_motorbike', 'dispatch', '3'::jsonb, 'integer', 'Max concurrent orders for motorbike', false),
  ('dispatch.batch_max_orders', 'dispatch', '3'::jsonb, 'integer', 'Hard cap on orders per batch', false),
  ('dispatch.batch_ready_window_min', 'dispatch', '8'::jsonb, 'integer', 'Max ready-time spread minutes for batching', false),
  ('dispatch.batch_detour_max_min', 'dispatch', '6'::jsonb, 'integer', 'Max customer detour minutes for batching', false),
  ('orders.prep_min_minutes', 'orders', '5'::jsonb, 'integer', 'Minimum committed kitchen prep minutes', false),
  ('orders.prep_max_minutes', 'orders', '200'::jsonb, 'integer', 'Maximum committed kitchen prep minutes', false),
  ('orders.prep_reason_above_min', 'orders', '60'::jsonb, 'integer', 'Prep minutes above which reason note is required', false),
  ('orders.customer_wait_min', 'orders', '8'::jsonb, 'integer', 'Customer doorstep wait protocol minutes', false),
  ('orders.pickup_noshow_min', 'orders', '15'::jsonb, 'integer', 'Customer self-pickup grace window after ready', false),
  ('cash.ceiling_bicycle_poisha', 'cash', '300000'::jsonb, 'integer', 'Bicycle COD cash-in-hand ceiling (৳3,000)', false),
  ('cash.ceiling_motorbike_poisha', 'cash', '500000'::jsonb, 'integer', 'Motorbike COD cash-in-hand ceiling (৳5,000)', false),
  ('cash.ceiling_warn_pct', 'cash', '80'::jsonb, 'integer', 'Cash ceiling warning banner threshold %', false),
  ('alerts.vendor_ring_max_sec', 'alerts', '120'::jsonb, 'integer', 'Max continuous kitchen alarm ring seconds', false),
  ('alerts.customer_eta_slip_notify_min', 'alerts', '10'::jsonb, 'integer', 'Notify customer when ETA slips by N minutes', false),
  ('ranking.w_rating', 'ranking', '0.3'::jsonb, 'number', 'rank_v1 Bayesian star rating weight', false),
  ('ranking.w_prep', 'ranking', '0.2'::jsonb, 'number', 'rank_v1 prep accuracy weight', false),
  ('ranking.w_accept', 'ranking', '0.2'::jsonb, 'number', 'rank_v1 acceptance reliability weight', false),
  ('ranking.w_ontime', 'ranking', '0.15'::jsonb, 'number', 'rank_v1 on-time handover weight', false),
  ('ranking.w_complaint_free', 'ranking', '0.15'::jsonb, 'number', 'rank_v1 complaint-free order weight', false),
  ('ranking.new_vendor_prior_weight', 'ranking', '10'::jsonb, 'integer', 'Bayesian prior review count for new kitchens', false),
  ('realtime.mode', 'realtime', '"rtdb"'::jsonb, 'string', 'Active realtime transport (rtdb | polling)', true),
  ('realtime.gps_min_displacement_m', 'realtime', '25'::jsonb, 'integer', 'Minimum movement meters to push GPS update', false),
  ('realtime.gps_min_interval_sec', 'realtime', '4'::jsonb, 'integer', 'Minimum seconds between RTDB GPS writes', false),
  ('apps.min_supported_version', 'apps', '"1.0.0"'::jsonb, 'string', 'Force-upgrade minimum app version', true),
  ('media.vendor_img_per_day', 'media', '30'::jsonb, 'integer', 'Daily ImgBB proxy uploads allowed per vendor', false),
  ('auth.providers.email', 'auth', 'true'::jsonb, 'boolean', 'Enable Email + Password auth', true),
  ('auth.providers.phone', 'auth', 'true'::jsonb, 'boolean', 'Enable BD Phone auth', true),
  ('auth.providers.google', 'auth', 'true'::jsonb, 'boolean', 'Enable Sign in with Google', true),
  ('auth.providers.facebook', 'auth', 'false'::jsonb, 'boolean', 'Enable Facebook OAuth (D-09 toggle)', true),
  ('auth.providers.apple', 'auth', 'false'::jsonb, 'boolean', 'Enable Sign in with Apple (D-09 toggle)', true),
  ('auth.providers.github', 'auth', 'false'::jsonb, 'boolean', 'Enable GitHub OAuth (D-09 toggle)', true),
  ('auth.providers.microsoft', 'auth', 'false'::jsonb, 'boolean', 'Enable Microsoft OAuth (D-09 toggle)', true),
  ('auth.providers.discord', 'auth', 'false'::jsonb, 'boolean', 'Enable Discord OAuth (D-09 toggle)', true),
  ('auth.providers.twitter', 'auth', 'false'::jsonb, 'boolean', 'Enable X/Twitter OAuth (D-09 toggle)', true),
  ('auth.providers.linkedin', 'auth', 'false'::jsonb, 'boolean', 'Enable LinkedIn OAuth (D-09 toggle)', true),
  ('auth.providers.anonymous_browse', 'auth', 'true'::jsonb, 'boolean', 'Allow guest browsing before checkout', true)
ON CONFLICT (key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. Canonical Cuisine Taxonomy Seed (117 Entries — Appendix D Exact Parity)
-- -----------------------------------------------------------------------------
INSERT INTO public.cuisine_taxonomy (key, name_en, name_bn, parent_key, synonyms, sort)
VALUES
  ('bangladeshi', 'Bangladeshi', 'বাংলাদেশি', NULL, ARRAY['deshi','bangla','bengali']::text[], 10), ('biryani', 'Biryani', 'বিরিয়ানি', 'bangladeshi', ARRAY['briyani','biriyani','kacchi']::text[], 20),
  ('khichuri', 'Khichuri', 'খিচুড়ি', 'bangladeshi', ARRAY['khichdi']::text[], 30), ('tehari', 'Tehari', 'তেহারি', 'bangladeshi', ARRAY['tehri']::text[], 40),
  ('morog_polao', 'Morog Polao', 'মোরগ পোলাও', 'bangladeshi', '{}'::text[], 50), ('rice_dishes', 'Rice Dishes', 'ভাত জাতীয়', 'bangladeshi', ARRAY['bhaat','vat']::text[], 60),
  ('curry', 'Curry', 'তরকারি/কারি', 'bangladeshi', ARRAY['torkari','jhol']::text[], 70), ('bhuna', 'Bhuna', 'ভুনা', 'bangladeshi', ARRAY['kala bhuna']::text[], 80),
  ('fish', 'Fish', 'মাছ', 'bangladeshi', ARRAY['mach','ilish','rui']::text[], 90), ('ilish', 'Ilish Specials', 'ইলিশ', 'fish', ARRAY['hilsha']::text[], 100),
  ('bhorta', 'Bhorta', 'ভর্তা', 'bangladeshi', ARRAY['vorta']::text[], 110), ('bhaji', 'Bhaji', 'ভাজি', 'bangladeshi', ARRAY['vaji']::text[], 120),
  ('dal', 'Dal & Lentils', 'ডাল', 'bangladeshi', ARRAY['daal']::text[], 130), ('beef', 'Beef', 'গরুর মাংস', 'bangladeshi', ARRAY['gorur mangsho']::text[], 140),
  ('chicken_deshi', 'Deshi Chicken', 'দেশি মুরগি', 'bangladeshi', '{}'::text[], 150), ('mutton', 'Mutton', 'খাসির মাংস', 'bangladeshi', ARRAY['khashi','goat']::text[], 160),
  ('duck', 'Duck', 'হাঁস', 'bangladeshi', ARRAY['hash']::text[], 170), ('pitha', 'Pitha', 'পিঠা', 'bangladeshi', '{}'::text[], 180),
  ('street', 'Street Food', 'স্ট্রিট ফুড', NULL, ARRAY['rastar khabar']::text[], 200), ('fuchka', 'Fuchka & Chotpoti', 'ফুচকা-চটপটি', 'street', ARRAY['phuchka']::text[], 190),
  ('chaap', 'Chaap', 'চাপ', 'street', ARRAY['chap']::text[], 210), ('grill', 'Grill & BBQ', 'গ্রিল', NULL, ARRAY['bbq','tandoori grill']::text[], 230),
  ('kebab', 'Kebab', 'কাবাব', 'grill', ARRAY['kabab','sheekh']::text[], 220), ('tandoori', 'Tandoori', 'তান্দুরি', 'grill', '{}'::text[], 240),
  ('breads', 'Breads', 'রুটি জাতীয়', NULL, '{}'::text[], 260), ('naan_roti', 'Naan & Roti', 'নান-রুটি', 'breads', ARRAY['rumali','paratha','porota']::text[], 250),
  ('snacks', 'Snacks', 'নাস্তা', NULL, ARRAY['nasta','evening snacks']::text[], 270), ('singara', 'Singara & Somosa', 'সিঙ্গারা-সমুচা', 'snacks', ARRAY['samosa']::text[], 280),
  ('fast_food', 'Fast Food', 'ফাস্ট ফুড', NULL, '{}'::text[], 290), ('burgers', 'Burgers', 'বার্গার', 'fast_food', ARRAY['burger']::text[], 300),
  ('italian', 'Italian', 'ইতালিয়ান', NULL, '{}'::text[], 330), ('pizza', 'Pizza', 'পিজ্জা', 'italian', ARRAY['piza']::text[], 310),
  ('pasta', 'Pasta', 'পাস্তা', 'italian', ARRAY['spaghetti','penne']::text[], 320), ('fried_chicken', 'Fried Chicken', 'ফ্রাইড চিকেন', 'fast_food', ARRAY['crispy chicken','broast']::text[], 340),
  ('wings', 'Chicken Wings', 'উইংস', 'fried_chicken', '{}'::text[], 350), ('fries', 'Fries & Sides', 'ফ্রাইজ', 'fast_food', ARRAY['french fries','wedges']::text[], 360),
  ('sandwich', 'Sandwiches', 'স্যান্ডউইচ', 'fast_food', ARRAY['sub','club']::text[], 370), ('middle_eastern', 'Middle Eastern', 'মধ্যপ্রাচ্য', NULL, ARRAY['arabic']::text[], 390),
  ('shawarma', 'Shawarma & Wraps', 'শাওয়ারমা', 'middle_eastern', ARRAY['wrap','roll']::text[], 380), ('chinese', 'Chinese', 'চাইনিজ', NULL, ARRAY['chowmein deshi']::text[], 400),
  ('chowmein', 'Chowmein & Noodles', 'চাউমিন', 'chinese', ARRAY['noodles','hakka']::text[], 410), ('fried_rice', 'Fried Rice', 'ফ্রাইড রাইস', 'chinese', '{}'::text[], 420),
  ('soup', 'Soups', 'স্যুপ', NULL, ARRAY['sup','hot and sour']::text[], 430), ('thai', 'Thai', 'থাই', NULL, ARRAY['pad thai','tom yum']::text[], 440),
  ('indian', 'Indian', 'ভারতীয়', NULL, ARRAY['dosa','idli','punjabi']::text[], 450), ('south_indian', 'South Indian', 'দক্ষিণ ভারতীয়', 'indian', ARRAY['dosa']::text[], 460),
  ('mughlai', 'Mughlai', 'মোগলাই', 'bangladeshi', ARRAY['moghlai']::text[], 470), ('set_meal', 'Set Meals', 'সেট মিল', NULL, ARRAY['combo','platter','thali']::text[], 480),
  ('seafood', 'Seafood', 'সি-ফুড', 'fish', ARRAY['chingri','prawn','crab']::text[], 490), ('prawn', 'Prawn & Chingri', 'চিংড়ি', 'seafood', '{}'::text[], 500),
  ('bakery', 'Bakery', 'বেকারি', NULL, '{}'::text[], 520), ('cakes', 'Cakes', 'কেক', 'bakery', ARRAY['pastry','birthday']::text[], 510),
  ('dessert', 'Desserts', 'মিষ্টি জাতীয়', NULL, ARRAY['sweet','dessert']::text[], 530), ('sweets', 'Bangla Sweets', 'মিষ্টি', 'dessert', ARRAY['mishti','rasgulla','sandesh','doi']::text[], 540),
  ('ice_cream', 'Ice Cream', 'আইসক্রিম', 'dessert', ARRAY['kulfi']::text[], 550), ('faluda', 'Faluda', 'ফালুদা', 'dessert', '{}'::text[], 560),
  ('drinks', 'Drinks', 'পানীয়', NULL, ARRAY['beverage']::text[], 580), ('juice', 'Juice & Lassi', 'জুস-লাচ্ছি', 'drinks', ARRAY['borhani']::text[], 570),
  ('cafe', 'Cafe', 'ক্যাফে', 'drinks', '{}'::text[], 590), ('coffee', 'Coffee', 'কফি', 'cafe', ARRAY['espresso','cappuccino']::text[], 600),
  ('tea', 'Tea & Cha', 'চা', 'cafe', ARRAY['cha','dudh cha']::text[], 610), ('breakfast', 'Breakfast', 'সকালের নাস্তা', NULL, ARRAY['nashta']::text[], 620),
  ('healthy', 'Healthy', 'স্বাস্থ্যকর', NULL, ARRAY['diet','light']::text[], 630), ('salad', 'Salads', 'সালাদ', 'healthy', '{}'::text[], 640),
  ('vegetarian', 'Vegetarian', 'নিরামিষ', NULL, ARRAY['veg','niramish']::text[], 650), ('vegan', 'Vegan', 'ভেগান', 'vegetarian', '{}'::text[], 660),
  ('keto', 'Keto & Diet', 'কিটো', 'healthy', ARRAY['low carb']::text[], 670), ('japanese', 'Japanese', 'জাপানিজ', NULL, ARRAY['sushi','ramen']::text[], 680),
  ('korean', 'Korean', 'কোরিয়ান', NULL, ARRAY['kimbap','bibimbap']::text[], 690), ('mexican', 'Mexican', 'মেক্সিকান', NULL, ARRAY['taco','burrito','nachos']::text[], 700),
  ('continental', 'Continental', 'কন্টিনেন্টাল', NULL, ARRAY['steak']::text[], 710), ('steak', 'Steaks', 'স্টেক', 'continental', '{}'::text[], 720),
  ('home_kitchen', 'Home Kitchen Specials', 'হোম কিচেন', NULL, ARRAY['homemade']::text[], 740), ('homemade', 'Homemade Deshi', 'ঘরোয়া খাবার', 'home_kitchen', ARRAY['ghorer khabar']::text[], 730),
  ('achaar', 'Achaar & Sides', 'আচার', 'bangladeshi', ARRAY['pickle']::text[], 750), ('peyaju', 'Peyaju & Fritters', 'পেঁয়াজু', 'snacks', ARRAY['bora','pakora']::text[], 760),
  ('haleem', 'Haleem', 'হালিম', 'bangladeshi', '{}'::text[], 770), ('nihari', 'Nihari & Paya', 'নেহারি', 'bangladeshi', '{}'::text[], 780),
  ('khabsa', 'Khabsa & Mandi', 'খাবসা', 'middle_eastern', ARRAY['mandi']::text[], 790), ('rolls', 'Rolls', 'রোল', 'snacks', ARRAY['kathi roll']::text[], 800),
  ('momos', 'Momos', 'মোমো', 'snacks', ARRAY['dumpling']::text[], 810), ('ramen', 'Ramen', 'রামেন', 'japanese', '{}'::text[], 820),
  ('sushi', 'Sushi', 'সুশি', 'japanese', '{}'::text[], 830), ('wings_bbq', 'BBQ Platters', 'বিবিকিউ প্ল্যাটার', 'grill', '{}'::text[], 840),
  ('kacchi', 'Kacchi Biryani', 'কাচ্চি', 'biryani', ARRAY['dhakaiya kacchi']::text[], 850), ('chicken_roast', 'Chicken Roast Sets', 'মোরগ রোস্ট', 'set_meal', '{}'::text[], 860),
  ('beef_kala', 'Kala Bhuna', 'কালা ভুনা', 'bhuna', '{}'::text[], 870), ('shutki', 'Shutki', 'শুঁটকি', 'bangladeshi', ARRAY['dried fish']::text[], 880),
  ('chingri_malai', 'Chingri Malaikari', 'চিংড়ি মালাইকারি', 'prawn', '{}'::text[], 890), ('rui_curry', 'Rui & River Fish', 'রুই', 'fish', ARRAY['katla','pabda','tengra','koi']::text[], 900),
  ('egg', 'Egg Dishes', 'ডিম', 'breakfast', ARRAY['dim bhuna']::text[], 910), ('paratha_set', 'Paratha Sets', 'পরোটা সেট', 'breakfast', ARRAY['porota']::text[], 920),
  ('borhani_doi', 'Borhani & Doi', 'বোরহানি-দই', 'drinks', '{}'::text[], 930), ('lassi', 'Lassi', 'লাচ্ছি', 'drinks', '{}'::text[], 940),
  ('cold_drinks', 'Soft Drinks', 'কোল্ড ড্রিংকস', 'drinks', ARRAY['coke','sprite']::text[], 950), ('mocktail', 'Mocktails', 'মকটেল', 'drinks', ARRAY['mojito virgin']::text[], 960),
  ('combo_family', 'Family Combos', 'ফ্যামিলি কম্বো', 'set_meal', ARRAY['family pack']::text[], 970), ('party', 'Party Orders', 'পার্টি অর্ডার', 'set_meal', ARRAY['bulk','walima']::text[], 980),
  ('seasonal', 'Seasonal', 'ঋতুভিত্তিক', NULL, '{}'::text[], 1000), ('iftar', 'Iftar (seasonal)', 'ইফতার', 'seasonal', ARRAY['ramadan']::text[], 990),
  ('eid_special', 'Eid Specials', 'ঈদ স্পেশাল', 'seasonal', '{}'::text[], 1010), ('kids', 'Kids Meals', 'কিডস মিল', NULL, ARRAY['children']::text[], 1020),
  ('low_spice', 'Low-Spice', 'কম ঝাল', 'healthy', ARRAY['non spicy']::text[], 1030), ('extra_spicy', 'Extra Spicy', 'বেশি ঝাল', NULL, ARRAY['jhal','naga']::text[], 1040),
  ('naga', 'Naga Specials', 'নাগা', 'extra_spicy', '{}'::text[], 1050), ('cheese', 'Cheesy', 'চিজি', 'fast_food', ARRAY['cheese']::text[], 1060),
  ('local_sylhet', 'Sylheti Specials', 'সিলেটি', 'bangladeshi', ARRAY['sylhet','satkora']::text[], 1070), ('satkora', 'Satkora Beef', 'সাতকড়া গরু', 'local_sylhet', '{}'::text[], 1080),
  ('chattogram', 'Chattogram Specials', 'চট্টগ্রাম', 'bangladeshi', ARRAY['mezbani']::text[], 1090), ('mezbani', 'Mezbani', 'মেজবানি', 'chattogram', '{}'::text[], 1100),
  ('khulna', 'Khulna Specials', 'খুলনা', 'bangladeshi', ARRAY['chui jhal']::text[], 1110), ('chui', 'Chui Jhal', 'চুই ঝাল', 'khulna', '{}'::text[], 1120),
  ('rajshahi', 'Rajshahi Specials', 'রাজশাহী', 'bangladeshi', ARRAY['kalai ruti']::text[], 1130), ('global', 'World Kitchen', 'বিশ্ব খাবার', NULL, ARRAY['fusion']::text[], 1140),
  ('fusion', 'Fusion', 'ফিউশন', 'global', '{}'::text[], 1150), ('budget', 'Budget Bites', 'সাশ্রয়ী', NULL, ARRAY['cheap eats','under 100']::text[], 1160),
  ('premium', 'Premium', 'প্রিমিয়াম', NULL, '{}'::text[], 1170)
ON CONFLICT (key) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_bn = EXCLUDED.name_bn,
  parent_key = EXCLUDED.parent_key,
  synonyms = EXCLUDED.synonyms,
  sort = EXCLUDED.sort;

-- -----------------------------------------------------------------------------
-- 7. Canonical Structured Cancel Reasons & Feedback Tags (EN + বাংলা)
-- -----------------------------------------------------------------------------
INSERT INTO public.cancel_reasons (key, name_en, name_bn, actor_scope, requires_photo, refund_policy_hint, sort)
VALUES
  ('cust_changed_mind', 'Changed my mind', 'মন পরিবর্তন করেছি', 'customer', false, 'auto_full', 10),
  ('cust_wrong_address', 'Entered wrong delivery pin', 'ভুল ঠিকানা দিয়েছি', 'customer', false, 'auto_full', 20),
  ('cust_high_eta', 'Estimated wait time is too long', 'ডেলিভারি সময় বেশি লাগছে', 'customer', false, 'auto_full', 30),
  ('vendor_item_unavailable', 'Item out of stock today', 'আইটেমটি এখন স্টকে নেই', 'vendor', false, 'auto_full', 10),
  ('vendor_kitchen_overloaded', 'Kitchen at peak capacity', 'কিচেনে অতিরিক্ত অর্ডারের চাপ', 'vendor', false, 'auto_full', 20),
  ('vendor_closing_emergency', 'Unexpected utility/gas outage', 'জরুরি গ্যাস/বিদ্যুৎ সমস্যা', 'vendor', false, 'auto_full', 30),
  ('rider_vehicle_breakdown', 'Vehicle breakdown / flat tyre', 'যানবাহন নষ্ট/পাংচার হয়েছে', 'rider', true, 'compensation_eligible', 10),
  ('rider_customer_unreachable', 'Customer unreachable after protocol timer', 'নির্ধারিত সময় চেষ্টা করেও গ্রাহককে পাওয়া যায়নি', 'rider', true, 'manual_review', 20),
  ('rider_severe_roadblock', 'Road flooded or blocked', 'রাস্তা জলাবদ্ধ বা বন্ধ', 'rider', true, 'compensation_eligible', 30),
  ('admin_fraud_suspected', 'Suspected fake COD order', 'সন্দেহজনক ভুয়া সিওডি অর্ডার', 'admin', false, 'none', 10),
  ('system_vendor_accept_timeout', 'Restaurant did not accept in time', 'নির্ধারিত সময়ে রেস্তোরাঁ অর্ডার গ্রহণ করেনি', 'system', false, 'auto_full', 10)
ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_bn = EXCLUDED.name_bn;

INSERT INTO public.feedback_tags (key, name_en, name_bn, actor_scope, sentiment, requires_photo, sort)
VALUES
  ('cv_taste_great', 'Authentic taste', 'দারুণ স্বাদ', 'customer_vendor', 'positive', false, 10),
  ('cv_generous_portion', 'Generous portion', 'পর্যাপ্ত পরিমাণ', 'customer_vendor', 'positive', false, 20),
  ('cv_sealed_packaging', 'Clean & spill-free packaging', 'পরিচ্ছন্ন প্যাকেজিং', 'customer_vendor', 'positive', false, 30),
  ('cv_missing_or_wrong_item', 'Missing or wrong item', 'ভুল বা কম আইটেম', 'customer_vendor', 'negative', true, 40),
  ('cr_on_time_polite', 'Polite & right on time', 'ভদ্র আচরণ ও সময়মতো ডেলিভারি', 'customer_rider', 'positive', false, 10),
  ('cr_careful_handling', 'Food arrived hot & intact', 'খাবার গরম ও অক্ষত ছিল', 'customer_rider', 'positive', false, 20),
  ('rp_ready_on_arrival', 'Ready right on arrival', 'পৌঁছাতেই খাবার প্রস্তুত ছিল', 'rider_pickup', 'positive', false, 10),
  ('rp_long_counter_wait', 'Long waiting time at counter', 'কাউন্টারে দীর্ঘ অপেক্ষা', 'rider_pickup', 'negative', false, 20),
  ('rp_weak_packaging', 'Unsealed or leaky bag', 'দুর্বল বা লিক হওয়া প্যাকেট', 'rider_pickup', 'negative', false, 30),
  ('rp_staff_behavior', 'Helpful counter staff', 'সহযোগিতাপূর্ণ স্টাফ আচরণ', 'rider_pickup', 'positive', false, 40)
ON CONFLICT (key) DO UPDATE SET name_en = EXCLUDED.name_en, name_bn = EXCLUDED.name_bn;
