-- =============================================================================
-- Migration: 0009_riders_and_presence.sql
-- Milestone: Build Response 4 (Migrations III — Riders, Shifts & Unlogged Live Presence)
-- Tables:    riders, rider_documents, rider_shifts, presence_live (UNLOGGED)
-- References: Master Guide File 03 (§3.1), File 11, File 12, File 21 (§21.4), Appendix B
-- =============================================================================

CREATE OR REPLACE FUNCTION public.enforce_rider_adult_age()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_today_dhaka date := (clock_timestamp() AT TIME ZONE 'Asia/Dhaka')::date;
BEGIN
  IF NEW.date_of_birth > (v_today_dhaka - INTERVAL '18 years')::date THEN
    RAISE EXCEPTION 'RIDER_UNDERAGE: rider must be at least 18 years old in Asia/Dhaka (dob=%).', NEW.date_of_birth
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.enforce_rider_adult_age() IS
  'Blocks registration of riders under 18 years old evaluated in Asia/Dhaka calendar date (File 21 §21.4).';

CREATE TABLE IF NOT EXISTS public.riders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vehicle_type text NOT NULL CHECK (vehicle_type IN ('motorbike', 'bicycle')),
  date_of_birth date NOT NULL,
  kyc_status text NOT NULL DEFAULT 'draft'
    CHECK (kyc_status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'needs_fix')),
  is_active boolean NOT NULL DEFAULT false,
  is_online boolean NOT NULL DEFAULT false,
  cash_gate_blocked boolean NOT NULL DEFAULT false,
  home_zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  payout_method text CHECK (payout_method IN ('bkash', 'nagad', 'bank')),
  payout_holder_name text,
  payout_account_enc bytea CHECK (payout_account_enc IS NULL OR octet_length(payout_account_enc) >= 8),
  payout_masked text,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0.00 CHECK (rating_avg BETWEEN 0.00 AND 5.00),
  rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  completion_rate numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (completion_rate BETWEEN 0.00 AND 100.00),
  acceptance_rate numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (acceptance_rate BETWEEN 0.00 AND 100.00),
  cash_ceiling_override_poisha bigint CHECK (cash_ceiling_override_poisha IS NULL OR cash_ceiling_override_poisha >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS riders_zone_dispatch_idx
  ON public.riders (home_zone_id, is_active, is_online, vehicle_type) WHERE deleted_at IS NULL;
COMMENT ON TABLE public.riders IS
  'Motorbike and bicycle fleet partners; enforces >= 18 age check, vehicle rules, and cash-gate state.';

DROP TRIGGER IF EXISTS riders_check_adult_age ON public.riders;
CREATE TRIGGER riders_check_adult_age BEFORE INSERT OR UPDATE OF date_of_birth ON public.riders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rider_adult_age();
DROP TRIGGER IF EXISTS riders_set_updated_at ON public.riders;
CREATE TRIGGER riders_set_updated_at BEFORE UPDATE ON public.riders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.rider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'nid_front', 'nid_back', 'birth_cert', 'driving_license',
    'vehicle_reg', 'tax_token', 'selfie', 'vehicle_photo'
  )),
  storage_path text NOT NULL CHECK (char_length(btrim(storage_path)) BETWEEN 5 AND 400),
  review_status text NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'needs_fix', 'rejected')),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS rider_documents_rider_status_idx ON public.rider_documents (rider_id, review_status);
CREATE INDEX IF NOT EXISTS rider_documents_expiry_idx
  ON public.rider_documents (expires_on) WHERE expires_on IS NOT NULL AND review_status = 'approved';
COMMENT ON TABLE public.rider_documents IS
  'Private KYC and vehicle documents stored in kyc-private bucket; accessed strictly via signed URLs.';
DROP TRIGGER IF EXISTS rider_documents_set_updated_at ON public.rider_documents;
CREATE TRIGGER rider_documents_set_updated_at BEFORE UPDATE ON public.rider_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.rider_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ended_at timestamptz,
  vehicle_confirmed text NOT NULL CHECK (vehicle_confirmed IN ('motorbike', 'bicycle')),
  start_selfie_path text,
  end_reason text CHECK (end_reason IN ('normal', 'cash_gate', 'admin', 'timeout')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT rider_shifts_window_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS rider_shifts_single_open_idx
  ON public.rider_shifts (rider_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS rider_shifts_zone_time_idx
  ON public.rider_shifts (zone_id, started_at DESC);
COMMENT ON TABLE public.rider_shifts IS
  'Rider online sessions enforcing at most one open shift per rider and recording vehicle/selfie attestation.';

-- High-churn ephemeral heartbeat table stored UNLOGGED to avoid WAL bloat on Free Tier (`File 03 §3.1`)
CREATE UNLOGGED TABLE IF NOT EXISTS public.presence_live (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('vendor', 'rider')),
  ref_id uuid NOT NULL,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE CASCADE,
  lat double precision CHECK (lat IS NULL OR (lat BETWEEN -90.0 AND 90.0)),
  lng double precision CHECK (lng IS NULL OR (lng BETWEEN -180.0 AND 180.0)),
  geohash text,
  heading real CHECK (heading IS NULL OR (heading >= 0.0 AND heading < 360.0)),
  speed_mps real CHECK (speed_mps IS NULL OR (speed_mps >= 0.0 AND speed_mps <= 60.0)),
  capacity_used smallint NOT NULL DEFAULT 0 CHECK (capacity_used BETWEEN 0 AND 3),
  app_state text NOT NULL DEFAULT 'fg' CHECK (app_state IN ('fg', 'bg', 'alarm_service')),
  battery_pct smallint CHECK (battery_pct IS NULL OR (battery_pct BETWEEN 0 AND 100)),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS presence_live_zone_kind_seen_idx
  ON public.presence_live (zone_id, kind, last_seen_at DESC);
COMMENT ON TABLE public.presence_live IS
  'UNLOGGED live presence table backing W2 dispatch candidate discovery without WAL amplification.';

CREATE OR REPLACE FUNCTION public.upsert_presence_heartbeat(
  p_profile_id uuid,
  p_kind text,
  p_ref_id uuid,
  p_zone_id uuid,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_heading real DEFAULT NULL,
  p_speed_mps real DEFAULT NULL,
  p_capacity_used smallint DEFAULT 0,
  p_app_state text DEFAULT 'fg',
  p_battery_pct smallint DEFAULT NULL,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_geohash text := CASE
    WHEN p_lat IS NOT NULL AND p_lng IS NOT NULL THEN public.encode_geohash(p_lat, p_lng, 8)
    ELSE NULL
  END;
BEGIN
  INSERT INTO public.presence_live (
    profile_id, kind, ref_id, zone_id, lat, lng, geohash,
    heading, speed_mps, capacity_used, app_state, battery_pct, last_seen_at
  )
  VALUES (
    p_profile_id, p_kind, p_ref_id, p_zone_id, p_lat, p_lng, v_geohash,
    p_heading, p_speed_mps, p_capacity_used, p_app_state, p_battery_pct, p_now
  )
  ON CONFLICT (profile_id) DO UPDATE SET
    kind = EXCLUDED.kind,
    ref_id = EXCLUDED.ref_id,
    zone_id = EXCLUDED.zone_id,
    lat = coalesce(EXCLUDED.lat, public.presence_live.lat),
    lng = coalesce(EXCLUDED.lng, public.presence_live.lng),
    geohash = coalesce(EXCLUDED.geohash, public.presence_live.geohash),
    heading = EXCLUDED.heading,
    speed_mps = EXCLUDED.speed_mps,
    capacity_used = EXCLUDED.capacity_used,
    app_state = EXCLUDED.app_state,
    battery_pct = EXCLUDED.battery_pct,
    last_seen_at = EXCLUDED.last_seen_at;
END;
$$;
COMMENT ON FUNCTION public.upsert_presence_heartbeat(uuid, text, uuid, uuid, double precision, double precision, real, real, smallint, text, smallint, timestamptz) IS
  'Atomically upserts vendor/rider heartbeat row in UNLOGGED presence_live with 8-char geohash.';

CREATE OR REPLACE FUNCTION public.list_dispatchable_riders_in_zone(
  p_zone_id uuid,
  p_stale_after_seconds integer DEFAULT 90,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS TABLE (
  rider_id uuid,
  profile_id uuid,
  vehicle_type text,
  lat double precision,
  lng double precision,
  capacity_used smallint,
  rating_avg numeric(3,2),
  acceptance_rate numeric(5,2),
  battery_pct smallint,
  last_seen_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    r.id AS rider_id,
    r.profile_id,
    r.vehicle_type,
    pl.lat,
    pl.lng,
    pl.capacity_used,
    r.rating_avg,
    r.acceptance_rate,
    pl.battery_pct,
    pl.last_seen_at
  FROM public.presence_live AS pl
  JOIN public.riders AS r ON r.id = pl.ref_id
  WHERE pl.zone_id = p_zone_id
    AND pl.kind = 'rider'
    AND pl.lat IS NOT NULL
    AND pl.lng IS NOT NULL
    AND pl.last_seen_at >= (p_now - make_interval(secs => greatest(15, p_stale_after_seconds)))
    AND r.is_active = true
    AND r.is_online = true
    AND r.cash_gate_blocked = false
    AND r.kyc_status = 'approved'
    AND r.deleted_at IS NULL
    AND pl.capacity_used < 3;
$$;
COMMENT ON FUNCTION public.list_dispatchable_riders_in_zone(uuid, integer, timestamptz) IS
  'Returns non-stale approved unblocked riders in a zone for W2 ZoneDispatchDO scoring (File 12).';

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.riders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rider_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rider_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.presence_live ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_live FORCE ROW LEVEL SECURITY;
