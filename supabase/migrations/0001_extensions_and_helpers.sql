-- =============================================================================
-- Migration: 0001_extensions_and_helpers.sql
-- Milestone: Build Response 2 (Migrations I — Extensions & Pure SQL Helpers)
-- References: Master Guide File 05 (§5.1–5.5), File 09, File 14 (Geo & Zones)
-- Notes:
--   * Pure hosted-Supabase-safe DDL: never mutates `auth.*` schema internals.
--   * Uses `pgcrypto` + `pg_trgm` + pure SQL Haversine & 9-char Geohash helpers
--     per File 05 headnote (keeps 500 MB free-tier DB lean without PostGIS bloat).
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- -----------------------------------------------------------------------------
-- 1. Automatic `updated_at` timestamp trigger function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'Standard BEFORE UPDATE trigger keeping updated_at stamped with clock_timestamp() UTC.';

-- -----------------------------------------------------------------------------
-- 2. Strict append-only immutability guard (`audit_logs`, `order_events`, `ledger_entries`)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_VIOLATION: table %.% is immutable (% forbidden)',
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

COMMENT ON FUNCTION public.prevent_mutation() IS
  'Constitutional immutability guard blocking UPDATE and DELETE on forensic/accounting tables.';

-- -----------------------------------------------------------------------------
-- 3. Bangladesh mobile phone normalizer (`^01[3-9][0-9]{8}$`, matches shared_ts & Dart)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_bd_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  v_clean text;
BEGIN
  -- Translate Bengali digits (০-৯) to ASCII (0-9) and strip formatting chars
  v_clean := translate(p_raw, '০১২৩৪৫৬৭৮৯', '0123456789');
  v_clean := regexp_replace(v_clean, '[\s\-\(\)]+', '', 'g');

  IF v_clean LIKE '+880%' THEN
    v_clean := '0' || substring(v_clean FROM 5);
  ELSIF v_clean LIKE '880%' AND length(v_clean) = 13 THEN
    v_clean := '0' || substring(v_clean FROM 4);
  END IF;

  IF v_clean !~ '^01[3-9][0-9]{8}$' THEN
    RAISE EXCEPTION 'INVALID_BD_PHONE: % does not match 11-digit BD mobile format', p_raw
      USING ERRCODE = '22023';
  END IF;

  RETURN v_clean;
END;
$$;

COMMENT ON FUNCTION public.normalize_bd_phone(text) IS
  'Normalizes ASCII or Bengali-digit BD phone strings (+8801XXXXXXXXX / 01XXXXXXXXX) to canonical 11-digit 01[3-9]XXXXXXXX.';

-- -----------------------------------------------------------------------------
-- 4. Pure SQL Base-32 Geohash encoder (`precision` 1..12, default 9 chars ~4.8m cell)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encode_geohash(
  p_lat double precision,
  p_lng double precision,
  p_precision integer DEFAULT 9
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
DECLARE
  c_base32 constant text := '0123456789bcdefghjkmnpqrstuvwxyz';
  v_min_lat double precision := -90.0;
  v_max_lat double precision := 90.0;
  v_min_lng double precision := -180.0;
  v_max_lng double precision := 180.0;
  v_mid double precision;
  v_is_even boolean := true;
  v_bit integer := 0;
  v_ch integer := 0;
  v_hash text := '';
BEGIN
  IF p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
    RAISE EXCEPTION 'INVALID_COORDINATES: lat=% lng=% out of WGS84 bounds', p_lat, p_lng
      USING ERRCODE = '22023';
  END IF;
  IF p_precision < 1 OR p_precision > 12 THEN
    RAISE EXCEPTION 'INVALID_GEOHASH_PRECISION: % (must be 1..12)', p_precision
      USING ERRCODE = '22023';
  END IF;

  WHILE length(v_hash) < p_precision LOOP
    IF v_is_even THEN
      v_mid := (v_min_lng + v_max_lng) / 2.0;
      IF p_lng >= v_mid THEN
        v_ch := (v_ch * 2) + 1;
        v_min_lng := v_mid;
      ELSE
        v_ch := v_ch * 2;
        v_max_lng := v_mid;
      END IF;
    ELSE
      v_mid := (v_min_lat + v_max_lat) / 2.0;
      IF p_lat >= v_mid THEN
        v_ch := (v_ch * 2) + 1;
        v_min_lat := v_mid;
      ELSE
        v_ch := v_ch * 2;
        v_max_lat := v_mid;
      END IF;
    END IF;

    v_is_even := NOT v_is_even;
    v_bit := v_bit + 1;

    IF v_bit = 5 THEN
      v_hash := v_hash || substr(c_base32, v_ch + 1, 1);
      v_bit := 0;
      v_ch := 0;
    END IF;
  END LOOP;

  RETURN v_hash;
END;
$$;

COMMENT ON FUNCTION public.encode_geohash(double precision, double precision, integer) IS
  'Encodes WGS84 (lat, lng) into a standard lowercase Base32 geohash (default 9 characters ~4.77m × 4.77m).';

-- -----------------------------------------------------------------------------
-- 5. Pure SQL Great-Circle Haversine distance in kilometres (`File 14`)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.haversine_km(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
RETURNS double precision
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT 2.0 * 6371.0088 * asin(
    least(
      1.0,
      sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2.0), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2.0), 2)
      )
    )
  );
$$;

COMMENT ON FUNCTION public.haversine_km(double precision, double precision, double precision, double precision) IS
  'Computes WGS84 great-circle distance in kilometres using mean Earth radius 6371.0088 km.';
