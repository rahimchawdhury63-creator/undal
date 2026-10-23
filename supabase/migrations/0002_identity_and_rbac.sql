-- =============================================================================
-- Migration: 0002_identity_and_rbac.sql
-- Milestone: Build Response 2 (Migrations I — Identity, RBAC & Forensic Audit)
-- Tables:    profiles, device_tokens, customer_addresses,
--            admin_roles, admin_permissions, admin_user_roles, audit_logs
-- References: Master Guide File 05 (§5.1–5.2), File 09 (§9.1–9.4), Appendix B/C
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `public.profiles` (1:1 with `auth.users`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'vendor_owner', 'vendor_staff', 'rider', 'admin')),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 1 AND 120),
  phone text CHECK (phone IS NULL OR phone ~ '^01[3-9][0-9]{8}$'),
  email text,
  avatar_url text,
  language text NOT NULL DEFAULT 'bn' CHECK (language IN ('en', 'bn')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  trust_score smallint NOT NULL DEFAULT 70 CHECK (trust_score BETWEEN 0 AND 100),
  totp_enrolled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS profiles_phone_unique_idx
  ON public.profiles (phone)
  WHERE phone IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS profiles_role_status_idx
  ON public.profiles (role, status);

COMMENT ON TABLE public.profiles IS
  'Canonical user identity profile (1:1 with auth.users) across customer, partner, rider, and admin surfaces.';

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create baseline customer profile when a new Supabase Auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_name text;
  v_lang text;
BEGIN
  v_name := coalesce(
    nullif(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
    'Undal User'
  );
  v_lang := CASE WHEN NEW.raw_user_meta_data ->> 'language' = 'en' THEN 'en' ELSE 'bn' END;

  INSERT INTO public.profiles (id, role, full_name, email, language)
  VALUES (NEW.id, 'customer', left(v_name, 120), NEW.email, v_lang)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Idempotent auth.users AFTER INSERT trigger creating default customer profile; elevated roles require onboarding/admin approval (File 09 §9.1).';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- 2. `public.device_tokens` (FCM registration tokens + OEM alarm readiness state)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.device_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fcm_token text NOT NULL CHECK (char_length(fcm_token) BETWEEN 16 AND 4096),
  app_flavor text NOT NULL CHECK (app_flavor IN ('customer', 'partner', 'rider')),
  platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'web')),
  app_version text,
  oem_brand text,
  alarm_ready boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT device_tokens_fcm_token_key UNIQUE (fcm_token)
);

CREATE INDEX IF NOT EXISTS device_tokens_profile_flavor_idx
  ON public.device_tokens (profile_id, app_flavor, last_seen_at DESC);

COMMENT ON TABLE public.device_tokens IS
  'FCM device tokens per actor/app flavour with native alarm channel health flags (File 07).';

DROP TRIGGER IF EXISTS device_tokens_set_updated_at ON public.device_tokens;
CREATE TRIGGER device_tokens_set_updated_at
  BEFORE UPDATE ON public.device_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. `public.customer_addresses` (Saved pins with auto-computed 9-char geohash)
--    Note: FK to `public.zones(id)` is attached in `0005_zones_and_vendors.sql`.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Home' CHECK (char_length(btrim(label)) BETWEEN 1 AND 60),
  lat double precision NOT NULL CHECK (lat BETWEEN -90.0 AND 90.0),
  lng double precision NOT NULL CHECK (lng BETWEEN -180.0 AND 180.0),
  geohash text NOT NULL,
  address_text text NOT NULL CHECK (char_length(btrim(address_text)) BETWEEN 3 AND 400),
  delivery_instructions text CHECK (delivery_instructions IS NULL OR char_length(delivery_instructions) <= 300),
  zone_id uuid,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_addresses_one_default_idx
  ON public.customer_addresses (profile_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS customer_addresses_profile_idx
  ON public.customer_addresses (profile_id, created_at DESC);

CREATE INDEX IF NOT EXISTS customer_addresses_zone_idx
  ON public.customer_addresses (zone_id)
  WHERE zone_id IS NOT NULL;

COMMENT ON TABLE public.customer_addresses IS
  'Saved customer delivery pins; zone_id resolved at save time and enforced single default per user.';

CREATE OR REPLACE FUNCTION public.sync_address_geohash()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.geohash IS NULL OR char_length(btrim(NEW.geohash)) = 0
     OR TG_OP = 'UPDATE' AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng) THEN
    NEW.geohash := public.encode_geohash(NEW.lat, NEW.lng, 9);
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.sync_address_geohash() IS
  'Keeps customer_addresses.geohash synchronized as a 9-character geohash whenever (lat, lng) changes.';

DROP TRIGGER IF EXISTS customer_addresses_sync_geohash ON public.customer_addresses;
CREATE TRIGGER customer_addresses_sync_geohash
  BEFORE INSERT OR UPDATE ON public.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION public.sync_address_geohash();

DROP TRIGGER IF EXISTS customer_addresses_set_updated_at ON public.customer_addresses;
CREATE TRIGGER customer_addresses_set_updated_at
  BEFORE UPDATE ON public.customer_addresses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. `admin_roles`, `admin_permissions`, `admin_user_roles` (RBAC Matrix File 09)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  name_en text NOT NULL,
  name_bn text NOT NULL,
  description_en text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

COMMENT ON TABLE public.admin_roles IS
  'Named Super-Admin panel RBAC roles (7 canonical system roles + custom founder roles).';

DROP TRIGGER IF EXISTS admin_roles_set_updated_at ON public.admin_roles;
CREATE TRIGGER admin_roles_set_updated_at
  BEFORE UPDATE ON public.admin_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.admin_permissions (
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (char_length(permission) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (role_id, permission)
);

COMMENT ON TABLE public.admin_permissions IS
  'Granular Appendix C capability permission grants assigned to each admin_role.';

CREATE TABLE IF NOT EXISTS public.admin_user_roles (
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.admin_roles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (profile_id, role_id)
);

CREATE INDEX IF NOT EXISTS admin_user_roles_role_idx
  ON public.admin_user_roles (role_id);

COMMENT ON TABLE public.admin_user_roles IS
  'M:N assignment binding admin profiles to one or more admin_roles with granter attribution.';

-- -----------------------------------------------------------------------------
-- 5. `public.audit_logs` (Immutable Append-Only Forensic Spine — File 09 §9.4)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  action text NOT NULL CHECK (char_length(btrim(action)) BETWEEN 2 AND 120),
  entity_type text NOT NULL CHECK (char_length(btrim(entity_type)) BETWEEN 1 AND 80),
  entity_id text NOT NULL CHECK (char_length(btrim(entity_id)) BETWEEN 1 AND 120),
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  ip text,
  request_id text NOT NULL CHECK (char_length(btrim(request_id)) BETWEEN 4 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_created_idx
  ON public.audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_actor_created_idx
  ON public.audit_logs (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_action_created_idx
  ON public.audit_logs (action, created_at DESC);

COMMENT ON TABLE public.audit_logs IS
  'Immutable append-only audit trail recording every admin/privileged mutation with before/after diff & trace ID.';

DROP TRIGGER IF EXISTS audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.audit_logs FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. RBAC Security Helper Functions & Privilege-Escalation Column Guard
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_profile_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p.role
  FROM public.profiles AS p
  WHERE p.id = auth.uid()
    AND p.status = 'active'
    AND p.deleted_at IS NULL;
$$;

COMMENT ON FUNCTION public.current_profile_role() IS
  'Returns active authenticated profile role or NULL when anonymous, suspended, or soft-deleted.';

CREATE OR REPLACE FUNCTION public.has_admin_permission(p_permission text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles AS p
    JOIN public.admin_user_roles AS aur ON aur.profile_id = p.id
    JOIN public.admin_roles AS ar ON ar.id = aur.role_id
    LEFT JOIN public.admin_permissions AS ap
      ON ap.role_id = ar.id
      AND (
        ap.permission = '*'
        OR ap.permission = p_permission
        OR p_permission LIKE replace(ap.permission, '.*', '.%')
      )
    WHERE p.id = auth.uid()
      AND p.role = 'admin'
      AND p.status = 'active'
      AND p.deleted_at IS NULL
      AND (ar.key = 'super_admin' OR ap.permission IS NOT NULL)
  );
$$;

COMMENT ON FUNCTION public.has_admin_permission(text) IS
  'Checks active admin RBAC grant: super_admin has full access; other roles match exact or domain-wildcard grants.';

CREATE OR REPLACE FUNCTION public.append_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_diff jsonb DEFAULT '{}'::jsonb,
  p_reason text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_request_id text DEFAULT replace(gen_random_uuid()::text, '-', '')
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_id bigint;
BEGIN
  IF (
       coalesce(nullif(current_setting('role', true), ''), 'none') = 'none'
       AND session_user IN ('postgres', 'supabase_admin')
     )
     OR current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role' THEN
    v_role := coalesce((SELECT role FROM public.profiles WHERE id = v_uid), 'service_role');
  ELSE
    v_role := public.current_profile_role();
    IF v_role IS NULL THEN
      RAISE EXCEPTION 'UNAUTHORIZED_AUDIT_WRITE: active profile required'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, action, entity_type, entity_id, diff, reason, ip, request_id
  )
  VALUES (
    v_uid, v_role, p_action, p_entity_type, p_entity_id,
    coalesce(p_diff, '{}'::jsonb), p_reason, p_ip, p_request_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.append_audit_log(text, text, text, jsonb, text, text, text) IS
  'Controlled SECURITY DEFINER audit log writer used by RPCs and Workers.';

-- Block self-service privilege escalation on security-sensitive `profiles` columns
CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF (
       coalesce(nullif(current_setting('role', true), ''), 'none') = 'none'
       AND session_user IN ('postgres', 'supabase_admin')
     )
     OR current_setting('role', true) = 'service_role'
     OR auth.role() = 'service_role'
     OR public.has_admin_permission('1.rbac.manage') THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.trust_score IS DISTINCT FROM OLD.trust_score
     OR NEW.totp_enrolled_at IS DISTINCT FROM OLD.totp_enrolled_at THEN
    RAISE EXCEPTION 'PRIVILEGE_ESCALATION_BLOCKED: protected profile columns require admin/service authority'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.guard_profile_sensitive_columns() IS
  'Blocks horizontal/vertical privilege escalation on profiles.(role, status, trust_score, totp_enrolled_at).';

DROP TRIGGER IF EXISTS profiles_guard_sensitive_columns ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_sensitive_columns();

-- Enable & Force Row-Level Security on every table created in 0002 (policies attached in 0004)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens FORCE ROW LEVEL SECURITY;

ALTER TABLE public.customer_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_addresses FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_permissions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.admin_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_roles FORCE ROW LEVEL SECURITY;

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;
