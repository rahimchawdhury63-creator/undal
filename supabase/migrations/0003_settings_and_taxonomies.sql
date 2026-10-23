-- =============================================================================
-- Migration: 0003_settings_and_taxonomies.sql
-- Milestone: Build Response 2 (Migrations I — Settings, History & Taxonomies)
-- Tables:    platform_settings, platform_settings_history,
--            cuisine_taxonomy, cancel_reasons, feedback_tags
-- References: Master Guide File 05, File 13, Appendix B, Appendix D, Appendix M
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `public.platform_settings` & `public.platform_settings_history`
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_.]{2,96}$'),
  group_key text NOT NULL CHECK (group_key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb NOT NULL,
  value_type text NOT NULL CHECK (value_type IN ('integer', 'number', 'boolean', 'string', 'json')),
  description_en text NOT NULL,
  is_public_readable boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS platform_settings_group_idx
  ON public.platform_settings (group_key);

COMMENT ON TABLE public.platform_settings IS
  'Live admin-governed platform settings registry (72 keys across money, fare, dispatch, auth, brand, settlement).';

CREATE TABLE IF NOT EXISTS public.platform_settings_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  setting_key text NOT NULL,
  version integer NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  changed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS platform_settings_history_key_ver_idx
  ON public.platform_settings_history (setting_key, version DESC);

COMMENT ON TABLE public.platform_settings_history IS
  'Append-only version history for platform_settings supporting instant diff inspection and rollback.';

DROP TRIGGER IF EXISTS platform_settings_history_immutable ON public.platform_settings_history;
CREATE TRIGGER platform_settings_history_immutable
  BEFORE UPDATE OR DELETE ON public.platform_settings_history
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON public.platform_settings_history FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_platform_setting_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.version := coalesce(NEW.version, 1);
    NEW.updated_at := clock_timestamp();
    INSERT INTO public.platform_settings_history (
      setting_key, version, previous_value, new_value, changed_by, reason
    )
    VALUES (
      NEW.key, NEW.version, NULL, NEW.value, coalesce(NEW.updated_by, auth.uid()), 'seed_or_create'
    );
    RETURN NEW;
  END IF;

  IF NEW.value IS DISTINCT FROM OLD.value OR NEW.is_public_readable IS DISTINCT FROM OLD.is_public_readable THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := clock_timestamp();
    NEW.updated_by := coalesce(auth.uid(), NEW.updated_by, OLD.updated_by);

    INSERT INTO public.platform_settings_history (
      setting_key, version, previous_value, new_value, changed_by
    )
    VALUES (
      NEW.key, NEW.version, OLD.value, NEW.value, NEW.updated_by
    );
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.record_platform_setting_change() IS
  'Automatically increments platform_settings.version and records immutable before/after snapshots.';

DROP TRIGGER IF EXISTS platform_settings_version_audit ON public.platform_settings;
CREATE TRIGGER platform_settings_version_audit
  BEFORE INSERT OR UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.record_platform_setting_change();

-- -----------------------------------------------------------------------------
-- 2. `public.cuisine_taxonomy` (Appendix D — 117 searchable EN/BN + Banglish rows)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cuisine_search_document(
  p_key text,
  p_name_en text,
  p_name_bn text,
  p_synonyms text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(
    concat_ws(' ', p_key, p_name_en, p_name_bn, array_to_string(coalesce(p_synonyms, '{}'::text[]), ' '))
  );
$$;

COMMENT ON FUNCTION public.cuisine_search_document(text, text, text, text[]) IS
  'Immutable text helper combining slug, English name, Bengali name, and Banglish synonyms for pg_trgm search.';

CREATE TABLE IF NOT EXISTS public.cuisine_taxonomy (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,48}$'),
  name_en text NOT NULL,
  name_bn text NOT NULL,
  parent_key text REFERENCES public.cuisine_taxonomy(key) ON DELETE RESTRICT,
  synonyms text[] NOT NULL DEFAULT '{}'::text[],
  icon_url text,
  sort integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  search_text text GENERATED ALWAYS AS (
    public.cuisine_search_document(key, name_en, name_bn, synonyms)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS cuisine_taxonomy_parent_sort_idx
  ON public.cuisine_taxonomy (parent_key, sort);

CREATE INDEX IF NOT EXISTS cuisine_taxonomy_search_trgm_idx
  ON public.cuisine_taxonomy USING gin (search_text gin_trgm_ops);

COMMENT ON TABLE public.cuisine_taxonomy IS
  'Canonical 117+ food cuisine & category taxonomy with Bengali labels and Banglish trigram synonyms (Appendix D).';

DROP TRIGGER IF EXISTS cuisine_taxonomy_set_updated_at ON public.cuisine_taxonomy;
CREATE TRIGGER cuisine_taxonomy_set_updated_at
  BEFORE UPDATE ON public.cuisine_taxonomy
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. `public.cancel_reasons` & `public.feedback_tags` (Bilingual Vocabularies)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cancel_reasons (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,64}$'),
  name_en text NOT NULL,
  name_bn text NOT NULL,
  actor_scope text NOT NULL CHECK (actor_scope IN ('customer', 'vendor', 'rider', 'admin', 'system')),
  requires_photo boolean NOT NULL DEFAULT false,
  refund_policy_hint text NOT NULL DEFAULT 'auto_full'
    CHECK (refund_policy_hint IN ('auto_full', 'manual_review', 'compensation_eligible', 'none')),
  is_active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS cancel_reasons_scope_sort_idx
  ON public.cancel_reasons (actor_scope, is_active, sort);

COMMENT ON TABLE public.cancel_reasons IS
  'Structured EN/BN cancellation & rejection vocabulary per actor scope (Customer, Partner, Rider, Admin, System).';

DROP TRIGGER IF EXISTS cancel_reasons_set_updated_at ON public.cancel_reasons;
CREATE TRIGGER cancel_reasons_set_updated_at
  BEFORE UPDATE ON public.cancel_reasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.feedback_tags (
  key text PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{2,64}$'),
  name_en text NOT NULL,
  name_bn text NOT NULL,
  actor_scope text NOT NULL
    CHECK (actor_scope IN ('customer_vendor', 'customer_rider', 'rider_pickup', 'vendor_handover')),
  sentiment text NOT NULL DEFAULT 'positive' CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  requires_photo boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS feedback_tags_scope_sort_idx
  ON public.feedback_tags (actor_scope, is_active, sort);

COMMENT ON TABLE public.feedback_tags IS
  'Structured EN/BN rating & operational handover tags (including ADR-0005 rider pickup rating tags).';

DROP TRIGGER IF EXISTS feedback_tags_set_updated_at ON public.feedback_tags;
CREATE TRIGGER feedback_tags_set_updated_at
  BEFORE UPDATE ON public.feedback_tags
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Enable & Force Row-Level Security on all 5 tables created in 0003 (policies attached in 0004)
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.platform_settings_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings_history FORCE ROW LEVEL SECURITY;

ALTER TABLE public.cuisine_taxonomy ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuisine_taxonomy FORCE ROW LEVEL SECURITY;

ALTER TABLE public.cancel_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cancel_reasons FORCE ROW LEVEL SECURITY;

ALTER TABLE public.feedback_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback_tags FORCE ROW LEVEL SECURITY;
