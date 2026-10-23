-- =============================================================================
-- Migration: 0007_catalog_search_rpcs.sql
-- Milestone: Build Response 3 (Migrations II — Zone Resolution, Hours, rank_v1 & Search RPCs)
-- Objects:   public_vendor_cards (view), resolve_zone, is_vendor_open_now,
--            vendor_operational_status, vendor_weekly_open_compliance,
--            is_menu_item_orderable_now, compute_vendor_rank_v1,
--            get_home_feed, get_vendor_storefront, search_catalog
-- References: Master Guide File 05 (§5.2–5.3), File 13 (§13.1–13.2), File 14 (§14.2–14.4), File 21
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_zone(
  p_lat double precision,
  p_lng double precision
)
RETURNS TABLE (
  zone_id uuid,
  slug text,
  name_en text,
  name_bn text,
  in_service_area boolean,
  nearest_zone_slug text,
  nearest_distance_km numeric(7,2)
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_hit record;
  v_near record;
BEGIN
  SELECT z.id, z.slug, z.name_en, z.name_bn INTO v_hit
  FROM public.zones AS z
  WHERE z.is_active = true
    AND p_lat BETWEEN z.bbox_min_lat AND z.bbox_max_lat
    AND p_lng BETWEEN z.bbox_min_lng AND z.bbox_max_lng
    AND public.point_in_polygon(p_lat, p_lng, z.polygon)
  ORDER BY z.area_km2 ASC, z.created_at ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN QUERY SELECT v_hit.id, v_hit.slug, v_hit.name_en, v_hit.name_bn, true, v_hit.slug, 0.00::numeric(7,2);
    RETURN;
  END IF;

  SELECT z.slug, round(public.haversine_km(p_lat, p_lng, z.center_lat, z.center_lng)::numeric, 2) AS dist_km
  INTO v_near
  FROM public.zones AS z
  WHERE z.is_active = true
  ORDER BY public.haversine_km(p_lat, p_lng, z.center_lat, z.center_lng) ASC
  LIMIT 1;

  RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::text, NULL::text, false, v_near.slug, v_near.dist_km;
END;
$$;
COMMENT ON FUNCTION public.resolve_zone(double precision, double precision) IS
  'Resolves (lat, lng) against active delivery polygons (smallest containing polygon wins per File 14 §14.4; returns nearest zone km when outside).';

CREATE OR REPLACE FUNCTION public.sync_address_geohash()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.geohash IS NULL OR char_length(btrim(NEW.geohash)) = 0
     OR (TG_OP = 'UPDATE' AND (NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng)) THEN
    NEW.geohash := public.encode_geohash(NEW.lat, NEW.lng, 9);
    NEW.zone_id := (SELECT rz.zone_id FROM public.resolve_zone(NEW.lat, NEW.lng) AS rz);
  ELSIF NEW.zone_id IS NULL THEN
    NEW.zone_id := (SELECT rz.zone_id FROM public.resolve_zone(NEW.lat, NEW.lng) AS rz);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.shift_contains_time(p_open time, p_close time, p_local time)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_open IS NULL OR p_close IS NULL THEN false
    WHEN p_open <= p_close THEN p_local >= p_open AND p_local < p_close
    ELSE p_local >= p_open OR p_local < p_close
  END;
$$;
COMMENT ON FUNCTION public.shift_contains_time(time, time, time) IS
  'Checks whether local Asia/Dhaka wall time falls inside a shift window, supporting post-midnight rollover.';

CREATE OR REPLACE FUNCTION public.vendor_operational_status(
  p_vendor_id uuid,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vendor record;
  v_local timestamp without time zone := p_ts AT TIME ZONE 'Asia/Dhaka';
  v_dow smallint := extract(dow FROM v_local)::smallint;
  v_prev_dow smallint := ((v_dow + 6) % 7)::smallint;
  v_time time := v_local::time;
  v_open boolean := false;
BEGIN
  SELECT is_active, kyc_status, deleted_at INTO v_vendor FROM public.vendors WHERE id = p_vendor_id;
  IF NOT FOUND OR v_vendor.deleted_at IS NOT NULL OR NOT v_vendor.is_active OR v_vendor.kyc_status <> 'approved' THEN
    RETURN 'suspended';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.vendor_pauses AS vp
    WHERE vp.vendor_id = p_vendor_id AND vp.starts_at <= p_ts AND vp.ends_at > p_ts
  ) THEN
    RETURN 'paused';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.vendor_hours AS vh
    WHERE vh.vendor_id = p_vendor_id
      AND vh.is_closed = false
      AND (
        (vh.weekday = v_dow AND (
          public.shift_contains_time(vh.open1, vh.close1, v_time)
          OR public.shift_contains_time(vh.open2, vh.close2, v_time)
        ))
        OR (vh.weekday = v_prev_dow AND (
          (vh.open1 > vh.close1 AND v_time < vh.close1)
          OR (vh.open2 IS NOT NULL AND vh.open2 > vh.close2 AND v_time < vh.close2)
        ))
      )
  ) INTO v_open;

  RETURN CASE WHEN v_open THEN 'open' ELSE 'closed_hours' END;
END;
$$;
COMMENT ON FUNCTION public.vendor_operational_status(uuid, timestamptz) IS
  'Derives live operational status (open | closed_hours | paused | suspended) in Asia/Dhaka timezone (File 05 §5.1).';

CREATE OR REPLACE FUNCTION public.is_vendor_open_now(
  p_vendor_id uuid,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.vendor_operational_status(p_vendor_id, p_ts) = 'open';
$$;
COMMENT ON FUNCTION public.is_vendor_open_now(uuid, timestamptz) IS
  'Returns true iff vendor is approved, active, unpaused, and open at p_ts in Asia/Dhaka.';

CREATE OR REPLACE FUNCTION public.vendor_weekly_open_compliance(p_vendor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH daily AS (
    SELECT
      weekday,
      (CASE
        WHEN is_closed OR open1 IS NULL OR close1 IS NULL THEN 0.0
        WHEN close1 >= open1 THEN extract(epoch FROM (close1 - open1)) / 3600.0
        ELSE (86400.0 - extract(epoch FROM (open1 - close1))) / 3600.0
      END
      + CASE
        WHEN is_closed OR open2 IS NULL OR close2 IS NULL THEN 0.0
        WHEN close2 >= open2 THEN extract(epoch FROM (close2 - open2)) / 3600.0
        ELSE (86400.0 - extract(epoch FROM (open2 - close2))) / 3600.0
      END) AS hours_open
    FROM public.vendor_hours
    WHERE vendor_id = p_vendor_id
  )
  SELECT count(*) FILTER (WHERE hours_open >= 4.0) >= 5 FROM daily;
$$;
COMMENT ON FUNCTION public.vendor_weekly_open_compliance(uuid) IS
  'Checks File 21 §21.1–21.2 onboarding minimum hours law: >= 4 hours/day on at least 5 days/week.';

CREATE OR REPLACE FUNCTION public.is_menu_item_orderable_now(
  p_item_id uuid,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
BEGIN
  SELECT id, item_type, is_available, unavailable_until, moderation_status, deleted_at
  INTO v_item FROM public.menu_items WHERE id = p_item_id;

  IF NOT FOUND OR v_item.deleted_at IS NOT NULL OR v_item.moderation_status <> 'visible' THEN
    RETURN false;
  END IF;
  IF NOT v_item.is_available AND (v_item.unavailable_until IS NULL OR v_item.unavailable_until > p_ts) THEN
    RETURN false;
  END IF;

  IF v_item.item_type = 'bundle' AND EXISTS (
    SELECT 1 FROM public.bundle_slots AS bs
    WHERE bs.bundle_item_id = p_item_id
      AND bs.min_pick > 0
      AND (
        SELECT count(*)
        FROM public.bundle_slot_choices AS bsc
        JOIN public.menu_items AS ci ON ci.id = bsc.item_id
        WHERE bsc.slot_id = bs.id
          AND ci.deleted_at IS NULL
          AND ci.moderation_status = 'visible'
          AND (ci.is_available = true OR (ci.unavailable_until IS NOT NULL AND ci.unavailable_until <= p_ts))
      ) < bs.min_pick
  ) THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
COMMENT ON FUNCTION public.is_menu_item_orderable_now(uuid, timestamptz) IS
  'Checks dish availability, snooze expiry, moderation gate, and combo slot satisfiability.';

CREATE OR REPLACE VIEW public.public_vendor_cards AS
SELECT
  v.id, v.type, v.brand_name, v.brand_name_bn, v.slug, v.zone_id,
  CASE WHEN v.type = 'HOME_KITCHEN' THEN round(v.lat::numeric, 2)::double precision ELSE v.lat END AS display_lat,
  CASE WHEN v.type = 'HOME_KITCHEN' THEN round(v.lng::numeric, 2)::double precision ELSE v.lng END AS display_lng,
  left(v.geohash, CASE WHEN v.type = 'HOME_KITCHEN' THEN 5 ELSE 9 END) AS display_geohash,
  v.public_area_label, v.logo_url, v.cover_url, v.cuisines, v.hygiene_verified,
  v.min_order_poisha, v.accepts_pickup,
  CASE WHEN v.accepts_pickup THEN v.pickup_point_label ELSE NULL END AS pickup_point_label,
  v.rating_avg, v.rating_count, v.avg_prep_min
FROM public.vendors AS v
WHERE v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL;
COMMENT ON VIEW public.public_vendor_cards IS
  'Privacy-filtered public projection of approved active kitchens; strips address_text_private, owner_profile_id, and exact HOME_KITCHEN pin.';

CREATE OR REPLACE FUNCTION public.compute_vendor_rank_v1(
  p_rating_avg numeric,
  p_rating_count integer,
  p_prep_reliability numeric,
  p_acceptance_rate numeric,
  p_ontime_rate numeric,
  p_complaint_free_rate numeric,
  p_eta_minutes integer,
  p_zone_median_rating numeric DEFAULT 4.30
)
RETURNS numeric(6,4) LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  WITH perf AS (
    SELECT
      0.30 * (((10.0 * coalesce(p_zone_median_rating, 4.30) + p_rating_count * p_rating_avg) / (10.0 + p_rating_count)) / 5.0)
      + 0.20 * (p_prep_reliability / 100.0)
      + 0.20 * (p_acceptance_rate / 100.0)
      + 0.15 * (p_ontime_rate / 100.0)
      + 0.15 * (p_complaint_free_rate / 100.0) AS perf_score
  )
  SELECT round((0.75 * p.perf_score + 0.25 * greatest(0.0, least(1.0, (60.0 - least(p_eta_minutes, 60)) / 45.0)))::numeric, 4)
  FROM perf AS p;
$$;
COMMENT ON FUNCTION public.compute_vendor_rank_v1(numeric, integer, numeric, numeric, numeric, numeric, integer, numeric) IS
  'Deterministic meritocratic rank_v1 score (File 13 §13.1–13.2; D-12 pledge: paid placement strictly impossible).';

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
      v.logo_url, v.cover_url, v.cuisines, v.hygiene_verified, v.min_order_poisha,
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
  'Ranked meritocratic customer feed (File 13 rank_v1); never exposes address_text_private or HOME_KITCHEN exact coordinates.';

CREATE OR REPLACE FUNCTION public.get_vendor_storefront(
  p_slug text,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card record;
  v_categories jsonb;
BEGIN
  SELECT pvc.*, public.vendor_operational_status(pvc.id, p_ts) AS operational_status
  INTO v_card FROM public.public_vendor_cards AS pvc WHERE pvc.slug = p_slug;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', mc.id, 'name_en', mc.name_en, 'name_bn', mc.name_bn, 'category_type', mc.category_type, 'sort', mc.sort,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', mi.id, 'name_en', mi.name_en, 'name_bn', mi.name_bn,
        'description_en', mi.description_en, 'description_bn', mi.description_bn,
        'price_poisha', mi.price_poisha, 'compare_at_poisha', mi.compare_at_poisha,
        'image_url', mi.image_url, 'item_type', mi.item_type,
        'spicy_level', mi.spicy_level, 'is_veg', mi.is_veg, 'halal', mi.halal, 'serves', mi.serves,
        'is_orderable', public.is_menu_item_orderable_now(mi.id, p_ts)
      ) ORDER BY mi.sort ASC, mi.name_en ASC)
      FROM public.menu_items AS mi
      WHERE mi.category_id = mc.id AND mi.deleted_at IS NULL AND mi.moderation_status = 'visible'
    ), '[]'::jsonb)
  ) ORDER BY mc.sort ASC, mc.name_en ASC), '[]'::jsonb)
  INTO v_categories FROM public.menu_categories AS mc WHERE mc.vendor_id = v_card.id AND mc.is_active = true;

  RETURN jsonb_build_object('vendor', to_jsonb(v_card), 'categories', v_categories);
END;
$$;
COMMENT ON FUNCTION public.get_vendor_storefront(text, timestamptz) IS
  'Fetches public storefront card + categorized menu tree for Customer App and SSR Customer Web (/r/{slug}).';

CREATE OR REPLACE FUNCTION public.search_catalog(
  p_query text,
  p_lat double precision,
  p_lng double precision,
  p_fulfilment text DEFAULT 'delivery',
  p_limit integer DEFAULT 20,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_q text := lower(btrim(coalesce(p_query, '')));
  v_zone record;
  v_matched_cuisines text[];
  v_results jsonb;
BEGIN
  IF char_length(v_q) < 1 THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO v_zone FROM public.resolve_zone(p_lat, p_lng);
  IF v_zone.zone_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT coalesce(array_agg(ct.key), '{}'::text[]) INTO v_matched_cuisines
  FROM public.cuisine_taxonomy AS ct
  WHERE ct.is_active = true AND (ct.search_text LIKE '%' || v_q || '%' OR similarity(ct.search_text, v_q) >= 0.25);

  SELECT coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) INTO v_results
  FROM (
    SELECT
      v.id, v.slug, v.type, v.brand_name, v.brand_name_bn, v.public_area_label,
      v.cuisines, v.rating_avg, v.rating_count,
      public.vendor_operational_status(v.id, p_ts) AS operational_status,
      greatest(
        similarity(v.search_text, v_q),
        CASE WHEN v.cuisines && v_matched_cuisines THEN 0.70 ELSE 0.0 END,
        coalesce((SELECT max(similarity(mi.search_text, v_q)) FROM public.menu_items AS mi
                  WHERE mi.vendor_id = v.id AND mi.deleted_at IS NULL AND mi.moderation_status = 'visible'), 0.0)
      ) AS relevance
    FROM public.vendors AS v
    WHERE v.zone_id = v_zone.zone_id AND v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL
      AND (p_fulfilment <> 'pickup' OR v.accepts_pickup = true)
      AND (
        v.search_text LIKE '%' || v_q || '%' OR similarity(v.search_text, v_q) >= 0.20
        OR v.cuisines && v_matched_cuisines
        OR EXISTS (
          SELECT 1 FROM public.menu_items AS mi
          WHERE mi.vendor_id = v.id AND mi.deleted_at IS NULL AND mi.moderation_status = 'visible'
            AND (mi.search_text LIKE '%' || v_q || '%' OR similarity(mi.search_text, v_q) >= 0.20)
        )
      )
    ORDER BY (public.vendor_operational_status(v.id, p_ts) = 'open') DESC, relevance DESC, v.rating_avg DESC
    LIMIT greatest(1, least(p_limit, 50))
  ) AS s;
  RETURN v_results;
END;
$$;
COMMENT ON FUNCTION public.search_catalog(text, double precision, double precision, text, integer, timestamptz) IS
  'Unified EN + Bengali + Banglish dish/vendor/synonym trigram search scoped to caller resolved zone.';
