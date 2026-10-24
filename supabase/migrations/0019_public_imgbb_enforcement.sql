-- =============================================================================
-- Migration: 0019_public_imgbb_enforcement.sql
-- Build Response 13: enforce ImgBB-only public media in storage and catalog responses.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.is_public_imgbb_url(p_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(p_url LIKE 'https://i.ibb.co/%', false);
$$;
COMMENT ON FUNCTION public.is_public_imgbb_url(text) IS
  'Returns true only for HTTPS ImgBB CDN URLs allowed for public/platform image fields under ADR-0006 v2.';

CREATE OR REPLACE FUNCTION public.public_imgbb_urls_only(p_urls text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT coalesce(bool_and(public.is_public_imgbb_url(item.url)), true)
  FROM unnest(coalesce(p_urls, ARRAY[]::text[])) AS item(url);
$$;
COMMENT ON FUNCTION public.public_imgbb_urls_only(text[]) IS
  'Returns true only when every public review-photo URL is on the ImgBB CDN; empty arrays are valid.';

-- Remove any legacy/nonconforming public media before adding write-time constraints.
UPDATE public.profiles
SET avatar_url = NULL
WHERE avatar_url IS NOT NULL AND NOT public.is_public_imgbb_url(avatar_url);

UPDATE public.vendors
SET logo_url = CASE WHEN public.is_public_imgbb_url(logo_url) THEN logo_url ELSE NULL END,
    cover_url = CASE WHEN public.is_public_imgbb_url(cover_url) THEN cover_url ELSE NULL END
WHERE (logo_url IS NOT NULL AND NOT public.is_public_imgbb_url(logo_url))
   OR (cover_url IS NOT NULL AND NOT public.is_public_imgbb_url(cover_url));

UPDATE public.menu_items
SET image_url = NULL
WHERE image_url IS NOT NULL AND NOT public.is_public_imgbb_url(image_url);

UPDATE public.reviews AS r
SET photo_urls = ARRAY(
  SELECT item.url
  FROM unnest(r.photo_urls) WITH ORDINALITY AS item(url, position)
  WHERE public.is_public_imgbb_url(item.url)
  ORDER BY item.position
)
WHERE NOT public.public_imgbb_urls_only(r.photo_urls);

DELETE FROM public.banners
WHERE NOT public.is_public_imgbb_url(image_url);

DELETE FROM public.media_assets
WHERE provider = 'imgbb'
  AND (
    NOT public.is_public_imgbb_url(public_cdn_url)
    OR (medium_url IS NOT NULL AND NOT public.is_public_imgbb_url(medium_url))
    OR (thumb_url IS NOT NULL AND NOT public.is_public_imgbb_url(thumb_url))
  );

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_avatar_imgbb_only') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_avatar_imgbb_only
      CHECK (avatar_url IS NULL OR public.is_public_imgbb_url(avatar_url)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_logo_imgbb_only') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_logo_imgbb_only
      CHECK (logo_url IS NULL OR public.is_public_imgbb_url(logo_url)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vendors'::regclass AND conname = 'vendors_cover_imgbb_only') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_cover_imgbb_only
      CHECK (cover_url IS NULL OR public.is_public_imgbb_url(cover_url)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.menu_items'::regclass AND conname = 'menu_items_image_imgbb_only') THEN
    ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_image_imgbb_only
      CHECK (image_url IS NULL OR public.is_public_imgbb_url(image_url)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.banners'::regclass AND conname = 'banners_image_imgbb_only') THEN
    ALTER TABLE public.banners ADD CONSTRAINT banners_image_imgbb_only
      CHECK (public.is_public_imgbb_url(image_url)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND conname = 'reviews_photo_urls_imgbb_only') THEN
    ALTER TABLE public.reviews ADD CONSTRAINT reviews_photo_urls_imgbb_only
      CHECK (public.public_imgbb_urls_only(photo_urls)) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.media_assets'::regclass AND conname = 'media_assets_imgbb_urls_only') THEN
    ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_imgbb_urls_only
      CHECK (
        provider <> 'imgbb' OR (
          public.is_public_imgbb_url(public_cdn_url)
          AND (medium_url IS NULL OR public.is_public_imgbb_url(medium_url))
          AND (thumb_url IS NULL OR public.is_public_imgbb_url(thumb_url))
        )
      ) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_avatar_imgbb_only;
ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_logo_imgbb_only;
ALTER TABLE public.vendors VALIDATE CONSTRAINT vendors_cover_imgbb_only;
ALTER TABLE public.menu_items VALIDATE CONSTRAINT menu_items_image_imgbb_only;
ALTER TABLE public.banners VALIDATE CONSTRAINT banners_image_imgbb_only;
ALTER TABLE public.reviews VALIDATE CONSTRAINT reviews_photo_urls_imgbb_only;
ALTER TABLE public.media_assets VALIDATE CONSTRAINT media_assets_imgbb_urls_only;

CREATE OR REPLACE VIEW public.public_vendor_cards AS
SELECT
  v.id, v.type, v.brand_name, v.brand_name_bn, v.slug, v.zone_id,
  CASE WHEN v.type = 'HOME_KITCHEN' THEN round(v.lat::numeric, 2)::double precision ELSE v.lat END AS display_lat,
  CASE WHEN v.type = 'HOME_KITCHEN' THEN round(v.lng::numeric, 2)::double precision ELSE v.lng END AS display_lng,
  left(v.geohash, CASE WHEN v.type = 'HOME_KITCHEN' THEN 5 ELSE 9 END) AS display_geohash,
  v.public_area_label,
  CASE WHEN public.is_public_imgbb_url(v.logo_url) THEN v.logo_url ELSE NULL END AS logo_url,
  CASE WHEN public.is_public_imgbb_url(v.cover_url) THEN v.cover_url ELSE NULL END AS cover_url,
  v.cuisines, v.hygiene_verified, v.min_order_poisha, v.accepts_pickup,
  CASE WHEN v.accepts_pickup THEN v.pickup_point_label ELSE NULL END AS pickup_point_label,
  v.rating_avg, v.rating_count, v.avg_prep_min
FROM public.vendors AS v
WHERE v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL;
COMMENT ON VIEW public.public_vendor_cards IS
  'Privacy-filtered public projection of approved kitchens; emits vendor logo/cover only from ImgBB and redacts HOME_KITCHEN pins.';

CREATE OR REPLACE FUNCTION public.get_home_feed(
  p_lat double precision,
  p_lng double precision,
  p_fulfilment text DEFAULT 'delivery',
  p_cuisine text DEFAULT NULL,
  p_sort text DEFAULT 'recommended',
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_zone record;
  v_items jsonb;
BEGIN
  SELECT * INTO v_zone FROM public.resolve_zone(p_lat, p_lng);
  IF v_zone.zone_id IS NULL THEN
    RETURN jsonb_build_object(
      'in_service_area', false, 'nearest_zone_slug', v_zone.nearest_zone_slug,
      'nearest_distance_km', v_zone.nearest_distance_km, 'formula_version', 'rank_v1', 'vendors', '[]'::jsonb
    );
  END IF;

  WITH eligible AS (
    SELECT
      v.id, v.type, v.brand_name, v.brand_name_bn, v.slug, v.public_area_label,
      CASE WHEN public.is_public_imgbb_url(v.logo_url) THEN v.logo_url ELSE NULL END AS logo_url,
      CASE WHEN public.is_public_imgbb_url(v.cover_url) THEN v.cover_url ELSE NULL END AS cover_url,
      v.cuisines, v.hygiene_verified, v.min_order_poisha,
      v.accepts_pickup, v.rating_avg, v.rating_count, (v.rating_count < 5) AS is_new_vendor,
      public.vendor_operational_status(v.id, p_ts) AS operational_status,
      round((public.haversine_km(p_lat, p_lng, v.lat, v.lng) * z.road_factor)::numeric, 2) AS road_km,
      (
        v.avg_prep_min
        + CASE WHEN v.busy_mode_until IS NOT NULL AND v.busy_mode_until > p_ts THEN v.busy_mode_extra_minutes ELSE 0 END
        + ceil((public.haversine_km(p_lat, p_lng, v.lat, v.lng) * z.road_factor) * 3.0)::integer
      ) AS eta_minutes,
      CASE WHEN v.rating_count >= 5 AND v.rating_avg < 3.20 THEN 'more_places' ELSE 'primary' END AS feed_section,
      v.prep_reliability, v.acceptance_rate, v.ontime_handover_rate, v.complaint_free_rate
    FROM public.vendors AS v
    JOIN public.zones AS z ON z.id = v.zone_id
    WHERE v.zone_id = v_zone.zone_id
      AND v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL
      AND (p_fulfilment <> 'pickup' OR v.accepts_pickup = true)
      AND (p_cuisine IS NULL OR p_cuisine = ANY(v.cuisines))
  ),
  scored AS (
    SELECT e.*, public.compute_vendor_rank_v1(
      e.rating_avg, e.rating_count, e.prep_reliability, e.acceptance_rate,
      e.ontime_handover_rate, e.complaint_free_rate, e.eta_minutes
    ) AS rank_score
    FROM eligible AS e WHERE e.road_km <= 12.0
  )
  SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_items
  FROM (
    SELECT
      id, type, brand_name, brand_name_bn, slug, public_area_label, logo_url, cover_url,
      cuisines, hygiene_verified, min_order_poisha, accepts_pickup, rating_avg, rating_count,
      is_new_vendor, operational_status, road_km, eta_minutes, feed_section, rank_score
    FROM scored
    ORDER BY
      (operational_status = 'open') DESC,
      (feed_section = 'primary') DESC,
      CASE WHEN p_sort = 'fastest' THEN eta_minutes END ASC,
      CASE WHEN p_sort = 'nearest' THEN road_km END ASC,
      CASE WHEN p_sort = 'top_rated' THEN rating_avg END DESC,
      rank_score DESC, slug ASC
    LIMIT greatest(1, least(p_limit, 50)) OFFSET greatest(0, p_offset)
  ) AS r;

  RETURN jsonb_build_object(
    'in_service_area', true, 'zone_id', v_zone.zone_id, 'zone_slug', v_zone.slug,
    'zone_name_en', v_zone.name_en, 'zone_name_bn', v_zone.name_bn,
    'formula_version', 'rank_v1', 'vendors', v_items
  );
END;
$$;
COMMENT ON FUNCTION public.get_home_feed(double precision, double precision, text, text, text, integer, integer, timestamptz) IS
  'Ranked public customer feed; all vendor logo/cover URLs are ImgBB-only, and HOME_KITCHEN pins/private addresses are redacted.';
