-- =============================================================================
-- Migration: 0015_ops_caches_and_telemetry.sql
-- Milestone: Build Response 5 (Migrations IV — Cloudinary Media Registry, Caches & Quota Pruning)
-- Tables:    media_assets, banners, notifications, fcm_dispatch_log,
--            client_errors, search_queries, weather_cache, geocode_cache
-- Functions: prune_ephemeral_rows(p_now timestamptz)
-- References: Master Guide File 03 (§3.1), File 07, File 14, File 20, ADR-0006
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('imgbb', 'cloudinary')),
  category text NOT NULL CHECK (category IN (
    'menu_item', 'vendor_logo', 'vendor_cover', 'profile_avatar', 'banner', 'review_photo',
    'vendor_kyc', 'rider_kyc', 'rider_shift_selfie', 'cash_remittance_proof',
    'dispute_evidence', 'chat_attachment', 'invoice_pdf'
  )),
  delivery_type text NOT NULL CHECK (delivery_type IN ('upload', 'authenticated', 'private')),
  resource_type text NOT NULL DEFAULT 'image' CHECK (resource_type IN ('image', 'raw', 'video')),
  cloudinary_public_id text NOT NULL UNIQUE CHECK (char_length(btrim(cloudinary_public_id)) BETWEEN 4 AND 320),
  public_cdn_url text,
  medium_url text,
  thumb_url text,
  imgbb_delete_url text,
  bytes integer NOT NULL CHECK (bytes > 0 AND bytes <= 20971520),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  format text,
  sha256_etag text,
  exif_stripped boolean NOT NULL DEFAULT true CHECK (exif_stripped = true),
  moderation_status text NOT NULL DEFAULT 'approved'
    CHECK (moderation_status IN ('pending', 'approved', 'flagged', 'deleted')),
  retention_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT media_assets_dual_provider_law CHECK (
    (
      category IN ('menu_item', 'vendor_logo', 'vendor_cover', 'profile_avatar', 'banner', 'review_photo')
      AND provider = 'imgbb'
      AND delivery_type = 'upload'
      AND public_cdn_url IS NOT NULL
    )
    OR
    (
      category IN ('vendor_kyc', 'rider_kyc', 'rider_shift_selfie', 'cash_remittance_proof', 'dispute_evidence', 'chat_attachment', 'invoice_pdf')
      AND provider = 'cloudinary'
      AND delivery_type IN ('authenticated', 'private')
      AND public_cdn_url IS NULL
      AND imgbb_delete_url IS NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS media_assets_owner_cat_idx
  ON public.media_assets (owner_profile_id, category, created_at DESC);
CREATE INDEX IF NOT EXISTS media_assets_retention_idx
  ON public.media_assets (retention_until) WHERE retention_until IS NOT NULL;
COMMENT ON TABLE public.media_assets IS
  'Canonical Zero-Supabase-Storage registry (ADR-0006): tracks all Cloudinary unsigned/authenticated & ImgBB assets with mandatory EXIF stripping.';

CREATE TABLE IF NOT EXISTS public.banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid REFERENCES public.zones(id) ON DELETE CASCADE,
  title_en text NOT NULL CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 120),
  title_bn text,
  image_url text NOT NULL,
  deep_link text NOT NULL,
  placement text NOT NULL DEFAULT 'home_hero' CHECK (placement IN ('home_hero', 'home_mid', 'pickup_strip')),
  sort integer NOT NULL DEFAULT 0,
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ends_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS banners_active_zone_idx ON public.banners (is_active, zone_id, sort ASC);
COMMENT ON TABLE public.banners IS 'Zone-targeted customer home banners served only from the ImgBB public CDN (ADR-0006 v2).';
DROP TRIGGER IF EXISTS banners_set_updated_at ON public.banners;
CREATE TRIGGER banners_set_updated_at BEFORE UPDATE ON public.banners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title_en text NOT NULL,
  title_bn text,
  body_en text NOT NULL,
  body_bn text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_id, created_at DESC) WHERE read_at IS NULL;
COMMENT ON TABLE public.notifications IS 'In-app inbox history paired with data-only FCM wake signals.';

CREATE TABLE IF NOT EXISTS public.fcm_dispatch_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  recipient_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  data_only_verified boolean NOT NULL DEFAULT true CHECK (data_only_verified = true),
  http_status smallint NOT NULL,
  latency_ms integer CHECK (latency_ms IS NULL OR latency_ms >= 0),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS fcm_dispatch_order_idx ON public.fcm_dispatch_log (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fcm_dispatch_created_idx ON public.fcm_dispatch_log (created_at);
COMMENT ON TABLE public.fcm_dispatch_log IS
  'Proof-of-dispatch log for data-only FCM alarms (File 07); auto-pruned after 30 days to conserve Free-Tier DB space.';

CREATE TABLE IF NOT EXISTS public.client_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  surface text NOT NULL CHECK (surface IN ('customer_app', 'partner_app', 'rider_app', 'customer_web', 'admin_web', 'worker')),
  app_version text NOT NULL,
  profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  error_code text NOT NULL,
  message text NOT NULL CHECK (char_length(message) <= 1000),
  stack_preview text CHECK (stack_preview IS NULL OR char_length(stack_preview) <= 2000),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS client_errors_created_idx ON public.client_errors (created_at DESC);
COMMENT ON TABLE public.client_errors IS 'Zero-cost first-party crash/exception log across all 5 surfaces & 3 Workers.';

CREATE TABLE IF NOT EXISTS public.search_queries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  zone_id uuid REFERENCES public.zones(id) ON DELETE SET NULL,
  query_norm text NOT NULL CHECK (char_length(btrim(query_norm)) BETWEEN 1 AND 120),
  results_count smallint NOT NULL CHECK (results_count >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS search_queries_zero_hits_idx
  ON public.search_queries (zone_id, created_at DESC) WHERE results_count = 0;
COMMENT ON TABLE public.search_queries IS 'Anonymized search analytics powering Super Admin C128 unmet-cuisine demand reports.';

CREATE TABLE IF NOT EXISTS public.weather_cache (
  zone_id uuid PRIMARY KEY REFERENCES public.zones(id) ON DELETE CASCADE,
  condition text NOT NULL CHECK (condition IN ('clear', 'extreme_heat', 'rain', 'storm')),
  temp_c numeric(4,1),
  precip_mm numeric(5,2),
  source text NOT NULL CHECK (source IN ('open_meteo', 'met_norway', 'admin_override')),
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
COMMENT ON TABLE public.weather_cache IS
  'Per-zone weather cache shielding free weather upstreams and supporting manual dispatcher storm override (RSK-04).';

CREATE TABLE IF NOT EXISTS public.geocode_cache (
  cache_key text PRIMARY KEY CHECK (char_length(cache_key) BETWEEN 4 AND 180),
  kind text NOT NULL CHECK (kind IN ('forward', 'reverse', 'route_osrm')),
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS geocode_cache_expires_idx ON public.geocode_cache (expires_at);
COMMENT ON TABLE public.geocode_cache IS
  'Aggressive Nominatim/OSRM cache respecting strict OSM 1 req/s etiquette on Free Tier (File 14).';

-- Nightly Free-Tier DB Quota Guardian (`File 03 §3.1`: keeps 500 MB DB lean < 150 MB at 25,000+ orders)
CREATE OR REPLACE FUNCTION public.prune_ephemeral_rows(p_now timestamptz DEFAULT clock_timestamp())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_idem int;
  v_geo int;
  v_fcm int;
  v_err int;
  v_search int;
  v_pres int;
  v_notif int;
BEGIN
  DELETE FROM public.idempotency_keys WHERE expires_at <= p_now;
  GET DIAGNOSTICS v_idem = ROW_COUNT;

  DELETE FROM public.geocode_cache WHERE expires_at <= p_now;
  GET DIAGNOSTICS v_geo = ROW_COUNT;

  DELETE FROM public.fcm_dispatch_log WHERE created_at < (p_now - INTERVAL '30 days');
  GET DIAGNOSTICS v_fcm = ROW_COUNT;

  DELETE FROM public.client_errors WHERE created_at < (p_now - INTERVAL '30 days');
  GET DIAGNOSTICS v_err = ROW_COUNT;

  DELETE FROM public.search_queries WHERE created_at < (p_now - INTERVAL '60 days');
  GET DIAGNOSTICS v_search = ROW_COUNT;

  DELETE FROM public.presence_live WHERE last_seen_at < (p_now - INTERVAL '24 hours');
  GET DIAGNOSTICS v_pres = ROW_COUNT;

  DELETE FROM public.notifications WHERE read_at IS NOT NULL AND created_at < (p_now - INTERVAL '90 days');
  GET DIAGNOSTICS v_notif = ROW_COUNT;

  RETURN jsonb_build_object(
    'idempotency_keys', v_idem,
    'geocode_cache', v_geo,
    'fcm_dispatch_log', v_fcm,
    'client_errors', v_err,
    'search_queries', v_search,
    'presence_live', v_pres,
    'notifications', v_notif
  );
END;
$$;
COMMENT ON FUNCTION public.prune_ephemeral_rows(timestamptz) IS
  'Purges expired caches & ephemeral telemetry logs nightly while never touching orders, ledger_entries, invoices, or audit_logs.';

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fcm_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fcm_dispatch_log FORCE ROW LEVEL SECURITY;
ALTER TABLE public.client_errors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_errors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.search_queries FORCE ROW LEVEL SECURITY;
ALTER TABLE public.weather_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_cache FORCE ROW LEVEL SECURITY;
ALTER TABLE public.geocode_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geocode_cache FORCE ROW LEVEL SECURITY;
