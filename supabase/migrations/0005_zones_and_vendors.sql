-- =============================================================================
-- Migration: 0005_zones_and_vendors.sql
-- Milestone: Build Response 3 (Migrations II — Delivery Zones, 3-Track Vendors & KYC)
-- Tables:    zones, vendors, vendor_staff_members, vendor_hours,
--            vendor_pauses, vendor_documents, vendor_payout_accounts
-- References: Master Guide File 05, File 14 (§14.4), File 15 (§15.3), File 21, D-01, D-24
-- =============================================================================

CREATE OR REPLACE FUNCTION public.point_in_polygon(
  p_lat double precision,
  p_lng double precision,
  p_polygon jsonb
)
RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  v_len integer;
  v_inside boolean := false;
  v_i integer;
  v_j integer;
  v_xi double precision;
  v_yi double precision;
  v_xj double precision;
  v_yj double precision;
BEGIN
  IF jsonb_typeof(p_polygon) <> 'array' THEN RETURN false; END IF;
  v_len := jsonb_array_length(p_polygon);
  IF v_len < 3 THEN RETURN false; END IF;

  v_j := v_len - 1;
  FOR v_i IN 0 .. (v_len - 1) LOOP
    v_xi := (p_polygon -> v_i ->> 0)::double precision;
    v_yi := (p_polygon -> v_i ->> 1)::double precision;
    v_xj := (p_polygon -> v_j ->> 0)::double precision;
    v_yj := (p_polygon -> v_j ->> 1)::double precision;
    IF ((v_yi > p_lat) <> (v_yj > p_lat))
       AND (p_lng < ((v_xj - v_xi) * (p_lat - v_yi)) / nullif(v_yj - v_yi, 0.0) + v_xi) THEN
      v_inside := NOT v_inside;
    END IF;
    v_j := v_i;
  END LOOP;
  RETURN v_inside;
END;
$$;
COMMENT ON FUNCTION public.point_in_polygon(double precision, double precision, jsonb) IS
  'Even-odd Jordan curve ray-casting test over GeoJSON [[lng, lat], ...] coordinate ring.';

CREATE OR REPLACE FUNCTION public.polygon_area_km2(p_polygon jsonb)
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  v_len integer;
  v_i integer;
  v_j integer;
  v_sum double precision := 0.0;
  v_mean_lat double precision := 0.0;
  v_km_lat constant double precision := 111.132;
  v_km_lng double precision;
BEGIN
  IF jsonb_typeof(p_polygon) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_POLYGON: polygon must be a JSON array' USING ERRCODE = '22023';
  END IF;
  v_len := jsonb_array_length(p_polygon);
  IF v_len < 3 THEN
    RAISE EXCEPTION 'INVALID_POLYGON: polygon requires >= 3 vertices' USING ERRCODE = '22023';
  END IF;
  FOR v_i IN 0 .. (v_len - 1) LOOP
    v_mean_lat := v_mean_lat + ((p_polygon -> v_i ->> 1)::double precision);
  END LOOP;
  v_km_lng := 111.320 * cos(radians(v_mean_lat / v_len));

  FOR v_i IN 0 .. (v_len - 1) LOOP
    v_j := (v_i + 1) % v_len;
    v_sum := v_sum + (
      ((p_polygon -> v_i ->> 0)::double precision * v_km_lng) * ((p_polygon -> v_j ->> 1)::double precision * v_km_lat)
      - ((p_polygon -> v_j ->> 0)::double precision * v_km_lng) * ((p_polygon -> v_i ->> 1)::double precision * v_km_lat)
    );
  END LOOP;
  RETURN abs(v_sum) / 2.0;
END;
$$;
COMMENT ON FUNCTION public.polygon_area_km2(jsonb) IS
  'Planar Shoelace area in km^2 for sanity bounds and smallest-containing-polygon tiebreaking (File 14 §14.4).';

CREATE TABLE IF NOT EXISTS public.zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 2 AND 80),
  name_bn text NOT NULL CHECK (char_length(btrim(name_bn)) BETWEEN 2 AND 80),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  polygon jsonb NOT NULL,
  bbox_min_lat double precision NOT NULL,
  bbox_max_lat double precision NOT NULL,
  bbox_min_lng double precision NOT NULL,
  bbox_max_lng double precision NOT NULL,
  area_km2 double precision NOT NULL CHECK (area_km2 > 0.01 AND area_km2 < 25000.0),
  center_lat double precision NOT NULL CHECK (center_lat BETWEEN -90.0 AND 90.0),
  center_lng double precision NOT NULL CHECK (center_lng BETWEEN -180.0 AND 180.0),
  road_factor numeric(4,2) NOT NULL DEFAULT 1.35 CHECK (road_factor BETWEEN 1.00 AND 3.00),
  is_active boolean NOT NULL DEFAULT false,
  fee_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS zones_active_bbox_idx
  ON public.zones (is_active, bbox_min_lat, bbox_max_lat, bbox_min_lng, bbox_max_lng, area_km2 ASC);
COMMENT ON TABLE public.zones IS
  'Delivery service polygons with precomputed bounding boxes, km^2 area, road_factor, and per-zone fee/surge overrides.';

CREATE OR REPLACE FUNCTION public.sync_zone_bounds()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_len integer := jsonb_array_length(NEW.polygon);
  v_i integer;
  v_lng double precision;
  v_lat double precision;
  v_min_lat double precision := 90.0;
  v_max_lat double precision := -90.0;
  v_min_lng double precision := 180.0;
  v_max_lng double precision := -180.0;
BEGIN
  IF v_len < 3 THEN
    RAISE EXCEPTION 'INVALID_POLYGON: zone % must have >= 3 vertices', NEW.slug USING ERRCODE = '22023';
  END IF;
  FOR v_i IN 0 .. (v_len - 1) LOOP
    v_lng := (NEW.polygon -> v_i ->> 0)::double precision;
    v_lat := (NEW.polygon -> v_i ->> 1)::double precision;
    IF v_lat < -90.0 OR v_lat > 90.0 OR v_lng < -180.0 OR v_lng > 180.0 THEN
      RAISE EXCEPTION 'INVALID_COORDINATES: vertex % out of bounds in zone %', v_i, NEW.slug USING ERRCODE = '22023';
    END IF;
    v_min_lat := least(v_min_lat, v_lat);
    v_max_lat := greatest(v_max_lat, v_lat);
    v_min_lng := least(v_min_lng, v_lng);
    v_max_lng := greatest(v_max_lng, v_lng);
  END LOOP;
  NEW.bbox_min_lat := v_min_lat;
  NEW.bbox_max_lat := v_max_lat;
  NEW.bbox_min_lng := v_min_lng;
  NEW.bbox_max_lng := v_max_lng;
  NEW.area_km2 := public.polygon_area_km2(NEW.polygon);
  NEW.center_lat := coalesce(NEW.center_lat, (v_min_lat + v_max_lat) / 2.0);
  NEW.center_lng := coalesce(NEW.center_lng, (v_min_lng + v_max_lng) / 2.0);
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.sync_zone_bounds() IS
  'Computes bounding box and planar km^2 area whenever zones.polygon is created or updated.';

DROP TRIGGER IF EXISTS zones_sync_bounds ON public.zones;
CREATE TRIGGER zones_sync_bounds BEFORE INSERT OR UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION public.sync_zone_bounds();
DROP TRIGGER IF EXISTS zones_set_updated_at ON public.zones;
CREATE TRIGGER zones_set_updated_at BEFORE UPDATE ON public.zones FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_addresses_zone_id_fkey') THEN
    ALTER TABLE public.customer_addresses
      ADD CONSTRAINT customer_addresses_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.zones(id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  type text NOT NULL CHECK (type IN ('RESTAURANT', 'HOME_KITCHEN', 'CLOUD_KITCHEN')),
  legal_name text NOT NULL CHECK (char_length(btrim(legal_name)) BETWEEN 2 AND 140),
  brand_name text NOT NULL CHECK (char_length(btrim(brand_name)) BETWEEN 2 AND 120),
  brand_name_bn text,
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  lat double precision NOT NULL CHECK (lat BETWEEN -90.0 AND 90.0),
  lng double precision NOT NULL CHECK (lng BETWEEN -180.0 AND 180.0),
  geohash text NOT NULL,
  public_area_label text NOT NULL CHECK (char_length(btrim(public_area_label)) BETWEEN 2 AND 120),
  address_text_private text NOT NULL CHECK (char_length(btrim(address_text_private)) BETWEEN 4 AND 400),
  counter_phone text NOT NULL CHECK (counter_phone ~ '^01[3-9][0-9]{8}$'),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  logo_url text,
  cover_url text,
  cuisines text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(cuisines) <= 5),
  kyc_status text NOT NULL DEFAULT 'draft'
    CHECK (kyc_status IN ('draft', 'submitted', 'under_review', 'approved', 'rejected', 'needs_fix')),
  is_active boolean NOT NULL DEFAULT false,
  hygiene_verified boolean NOT NULL DEFAULT false,
  commission_bps integer NOT NULL DEFAULT 1500 CHECK (commission_bps BETWEEN 0 AND 3000),
  min_order_poisha bigint NOT NULL DEFAULT 15000 CHECK (min_order_poisha >= 0),
  accepts_pickup boolean,
  pickup_point_label text,
  busy_mode_extra_minutes smallint NOT NULL DEFAULT 0 CHECK (busy_mode_extra_minutes IN (0, 10, 15, 20)),
  busy_mode_until timestamptz,
  rating_avg numeric(3,2) NOT NULL DEFAULT 0.00 CHECK (rating_avg BETWEEN 0.00 AND 5.00),
  rating_count integer NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
  avg_prep_min smallint NOT NULL DEFAULT 20 CHECK (avg_prep_min BETWEEN 5 AND 200),
  prep_reliability numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (prep_reliability BETWEEN 0.00 AND 100.00),
  acceptance_rate numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (acceptance_rate BETWEEN 0.00 AND 100.00),
  ontime_handover_rate numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (ontime_handover_rate BETWEEN 0.00 AND 100.00),
  complaint_free_rate numeric(5,2) NOT NULL DEFAULT 100.00 CHECK (complaint_free_rate BETWEEN 0.00 AND 100.00),
  search_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS vendors_zone_active_kyc_idx ON public.vendors (zone_id, is_active, kyc_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS vendors_geohash_idx ON public.vendors (left(geohash, 6), is_active);
CREATE INDEX IF NOT EXISTS vendors_owner_idx ON public.vendors (owner_profile_id);
CREATE INDEX IF NOT EXISTS vendors_search_trgm_idx ON public.vendors USING gin (search_text gin_trgm_ops);
COMMENT ON TABLE public.vendors IS
  '3-track food partners (RESTAURANT, HOME_KITCHEN, CLOUD_KITCHEN); raw table blocks public SELECT to protect HOME_KITCHEN street privacy (D-24).';

CREATE OR REPLACE FUNCTION public.before_write_vendor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_unknown_cuisine text;
BEGIN
  IF NEW.accepts_pickup IS NULL THEN
    NEW.accepts_pickup := CASE WHEN NEW.type = 'HOME_KITCHEN' THEN false ELSE true END;
  END IF;
  IF NEW.geohash IS NULL OR char_length(btrim(NEW.geohash)) = 0
     OR (TG_OP = 'UPDATE' AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)) THEN
    NEW.geohash := public.encode_geohash(NEW.lat, NEW.lng, 9);
  END IF;
  IF cardinality(NEW.cuisines) > 0 THEN
    SELECT c INTO v_unknown_cuisine
    FROM unnest(NEW.cuisines) AS c
    LEFT JOIN public.cuisine_taxonomy AS t ON t.key = c
    WHERE t.key IS NULL LIMIT 1;
    IF v_unknown_cuisine IS NOT NULL THEN
      RAISE EXCEPTION 'UNKNOWN_CUISINE_KEY: % is not in cuisine_taxonomy', v_unknown_cuisine USING ERRCODE = '23503';
    END IF;
  END IF;
  NEW.search_text := lower(
    concat_ws(' ', NEW.brand_name, coalesce(NEW.brand_name_bn, ''), NEW.public_area_label, array_to_string(NEW.cuisines, ' '))
  );
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.before_write_vendor() IS
  'Enforces D-24 HOME_KITCHEN pickup default, validates cuisines[] against cuisine_taxonomy, and updates geohash + trigram search_text.';

DROP TRIGGER IF EXISTS vendors_before_write ON public.vendors;
CREATE TRIGGER vendors_before_write BEFORE INSERT OR UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.before_write_vendor();
DROP TRIGGER IF EXISTS vendors_set_updated_at ON public.vendors;
CREATE TRIGGER vendors_set_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_staff_members (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('manager', 'kitchen_staff')),
  permissions text[] NOT NULL DEFAULT ARRAY['orders', 'menu']::text[],
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (vendor_id, profile_id)
);
CREATE INDEX IF NOT EXISTS vendor_staff_profile_idx ON public.vendor_staff_members (profile_id, is_active);
COMMENT ON TABLE public.vendor_staff_members IS
  'Outlet staff memberships scoped strictly to operational duties (payout accounts remain owner-only).';
DROP TRIGGER IF EXISTS vendor_staff_set_updated_at ON public.vendor_staff_members;
CREATE TRIGGER vendor_staff_set_updated_at BEFORE UPDATE ON public.vendor_staff_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_hours (
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open1 time,
  close1 time,
  open2 time,
  close2 time,
  is_closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (vendor_id, weekday),
  CONSTRAINT vendor_hours_shift1_valid CHECK (
    (is_closed = true AND open1 IS NULL AND close1 IS NULL AND open2 IS NULL AND close2 IS NULL)
    OR (is_closed = false AND open1 IS NOT NULL AND close1 IS NOT NULL)
  ),
  CONSTRAINT vendor_hours_shift2_valid CHECK (
    (open2 IS NULL AND close2 IS NULL) OR (open2 IS NOT NULL AND close2 IS NOT NULL)
  )
);
COMMENT ON TABLE public.vendor_hours IS
  'Weekly Asia/Dhaka operating hours supporting up to two split shifts per day (File 05 §5.1, File 21).';
DROP TRIGGER IF EXISTS vendor_hours_set_updated_at ON public.vendor_hours;
CREATE TRIGGER vendor_hours_set_updated_at BEFORE UPDATE ON public.vendor_hours FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_pauses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ends_at timestamptz NOT NULL,
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 2 AND 160),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vendor_pauses_window_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS vendor_pauses_active_lookup_idx ON public.vendor_pauses (vendor_id, ends_at DESC);
COMMENT ON TABLE public.vendor_pauses IS 'Temporary kitchen busy/utility pauses with mandatory auto-resume ends_at timestamp.';

CREATE TABLE IF NOT EXISTS public.vendor_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN (
    'trade_license', 'nid_front', 'nid_back', 'tin', 'bin',
    'bank_proof', 'bkash_proof', 'utility_bill', 'kitchen_hygiene_photo', 'menu_doc', 'selfie'
  )),
  storage_path text NOT NULL CHECK (char_length(btrim(storage_path)) BETWEEN 5 AND 400),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'needs_fix', 'rejected')),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS vendor_documents_vendor_status_idx ON public.vendor_documents (vendor_id, review_status);
CREATE INDEX IF NOT EXISTS vendor_documents_expiry_idx ON public.vendor_documents (expires_on) WHERE expires_on IS NOT NULL AND review_status = 'approved';
COMMENT ON TABLE public.vendor_documents IS
  'Private KYC documents on Cloudinary authenticated tier (ADR-0006); accessed strictly via short-lived Worker s-- signature URLs + audit log.';
DROP TRIGGER IF EXISTS vendor_documents_set_updated_at ON public.vendor_documents;
CREATE TRIGGER vendor_documents_set_updated_at BEFORE UPDATE ON public.vendor_documents FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.vendor_payout_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('bkash', 'nagad', 'bank')),
  holder_name text NOT NULL CHECK (char_length(btrim(holder_name)) BETWEEN 2 AND 140),
  account_ref_enc bytea NOT NULL CHECK (octet_length(account_ref_enc) >= 8),
  masked text NOT NULL CHECK (char_length(btrim(masked)) BETWEEN 4 AND 40),
  bank_meta jsonb,
  is_primary boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS vendor_payout_one_primary_idx ON public.vendor_payout_accounts (vendor_id) WHERE is_primary = true;
COMMENT ON TABLE public.vendor_payout_accounts IS
  'Encrypted payout beneficiary accounts (bKash/Nagad/Bank); hidden from staff and decrypted only inside W3 settlement Worker.';
DROP TRIGGER IF EXISTS vendor_payout_accounts_set_updated_at ON public.vendor_payout_accounts;
CREATE TRIGGER vendor_payout_accounts_set_updated_at BEFORE UPDATE ON public.vendor_payout_accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zones FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_staff_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_staff_members FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_hours FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_pauses FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payout_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendor_payout_accounts FORCE ROW LEVEL SECURITY;

INSERT INTO public.zones (name_en, name_bn, slug, polygon, center_lat, center_lng, is_active, fee_overrides, config)
VALUES
  ('Sylhet Sadar', 'সিলেট সদর', 'sylhet-sadar',
   '[[91.8150,24.8650],[91.9250,24.8650],[91.9250,24.9380],[91.8150,24.9380],[91.8150,24.8650]]'::jsonb,
   24.8949, 91.8687, true,
   '{"base_delivery_fee_poisha":4000,"free_delivery_above_poisha":69900}'::jsonb,
   '{"starter_polygon":true,"settlement_day":"FRI","max_delivery_km":12.0}'::jsonb),
  ('Kulaura', 'কুলাউড়া', 'kulaura',
   '[[91.9950,24.4900],[92.0750,24.4900],[92.0750,24.5520],[91.9950,24.5520],[91.9950,24.4900]]'::jsonb,
   24.5186, 92.0336, false,
   '{"base_delivery_fee_poisha":3500,"free_delivery_above_poisha":59900}'::jsonb,
   '{"starter_polygon":true,"settlement_day":"FRI","max_delivery_km":10.0}'::jsonb)
ON CONFLICT (slug) DO UPDATE SET
  name_en = EXCLUDED.name_en,
  name_bn = EXCLUDED.name_bn,
  polygon = EXCLUDED.polygon,
  center_lat = EXCLUDED.center_lat,
  center_lng = EXCLUDED.center_lng;
