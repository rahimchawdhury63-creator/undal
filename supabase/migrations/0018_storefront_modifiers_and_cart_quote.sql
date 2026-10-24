-- =============================================================================
-- Migration: 0018_storefront_modifiers_and_cart_quote.sql
-- Build Response 13: publish safe menu configuration and exact current W1 order quotes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_vendor_storefront(
  p_slug text,
  p_ts timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card record;
  v_categories jsonb;
  v_hours jsonb;
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
        'image_url', CASE WHEN mi.image_url LIKE 'https://i.ibb.co/%' THEN mi.image_url ELSE NULL END,
        'item_type', mi.item_type,
        'spicy_level', mi.spicy_level, 'is_veg', mi.is_veg, 'halal', mi.halal, 'serves', mi.serves,
        'is_orderable', public.is_menu_item_orderable_now(mi.id, p_ts),
        'variant_groups', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', vg.id, 'name_en', vg.name_en, 'name_bn', vg.name_bn,
            'min_select', vg.min_select, 'max_select', vg.max_select,
            'variants', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'id', va.id, 'name_en', va.name_en, 'name_bn', va.name_bn,
                'price_delta_poisha', va.price_delta_poisha, 'is_available', va.is_available
              ) ORDER BY va.sort, va.name_en)
              FROM public.variants AS va WHERE va.group_id = vg.id
            ), '[]'::jsonb)
          ) ORDER BY vg.sort, vg.name_en)
          FROM public.variant_groups AS vg WHERE vg.item_id = mi.id
        ), '[]'::jsonb),
        'option_groups', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', og.id, 'name_en', og.name_en, 'name_bn', og.name_bn,
            'min_select', og.min_select, 'max_select', og.max_select,
            'options', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'id', op.id, 'name_en', op.name_en, 'name_bn', op.name_bn,
                'price_delta_poisha', op.price_delta_poisha, 'is_available', op.is_available
              ) ORDER BY op.sort, op.name_en)
              FROM public.options AS op WHERE op.group_id = og.id
            ), '[]'::jsonb)
          ) ORDER BY og.sort, og.name_en)
          FROM public.option_groups AS og WHERE og.item_id = mi.id
        ), '[]'::jsonb),
        'bundle_slots', coalesce((
          SELECT jsonb_agg(jsonb_build_object(
            'id', bs.id, 'name_en', bs.name_en, 'name_bn', bs.name_bn,
            'min_pick', bs.min_pick, 'max_pick', bs.max_pick,
            'choices', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                'item_id', choice.id, 'name_en', choice.name_en, 'name_bn', choice.name_bn,
                'price_delta_poisha', bsc.price_delta_poisha,
                'is_orderable', public.is_menu_item_orderable_now(choice.id, p_ts)
              ) ORDER BY bsc.sort, choice.name_en)
              FROM public.bundle_slot_choices AS bsc
              JOIN public.menu_items AS choice ON choice.id = bsc.item_id
              WHERE bsc.slot_id = bs.id AND choice.deleted_at IS NULL
                AND choice.moderation_status = 'visible'
            ), '[]'::jsonb)
          ) ORDER BY bs.sort, bs.name_en)
          FROM public.bundle_slots AS bs WHERE bs.bundle_item_id = mi.id
        ), '[]'::jsonb)
      ) ORDER BY mi.sort ASC, mi.name_en ASC)
      FROM public.menu_items AS mi
      WHERE mi.category_id = mc.id AND mi.deleted_at IS NULL AND mi.moderation_status = 'visible'
    ), '[]'::jsonb)
  ) ORDER BY mc.sort ASC, mc.name_en ASC), '[]'::jsonb)
  INTO v_categories FROM public.menu_categories AS mc
  WHERE mc.vendor_id = v_card.id AND mc.is_active = true;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'weekday', vh.weekday, 'is_closed', vh.is_closed,
    'open1', to_char(vh.open1, 'HH24:MI'), 'close1', to_char(vh.close1, 'HH24:MI'),
    'open2', to_char(vh.open2, 'HH24:MI'), 'close2', to_char(vh.close2, 'HH24:MI')
  ) ORDER BY vh.weekday), '[]'::jsonb)
  INTO v_hours FROM public.vendor_hours AS vh WHERE vh.vendor_id = v_card.id;

  RETURN jsonb_build_object(
    'vendor', to_jsonb(v_card) || jsonb_build_object(
      'logo_url', CASE WHEN v_card.logo_url LIKE 'https://i.ibb.co/%' THEN v_card.logo_url ELSE NULL END,
      'cover_url', CASE WHEN v_card.cover_url LIKE 'https://i.ibb.co/%' THEN v_card.cover_url ELSE NULL END
    ),
    'categories', v_categories,
    'vendor_hours', v_hours
  );
END;
$$;
COMMENT ON FUNCTION public.get_vendor_storefront(text, timestamptz) IS
  'Public privacy-filtered storefront with categories, current variants/options/bundle choices and weekly hours; never returns kitchen-internal labels or private addresses.';

CREATE OR REPLACE FUNCTION public.customer_platform_fee_poisha()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw text;
BEGIN
  SELECT value #>> '{}' INTO v_raw FROM public.platform_settings
  WHERE key = 'money.platform_fee_poisha';
  IF v_raw ~ '^[0-9]{1,12}$' THEN RETURN v_raw::bigint; END IF;
  RETURN 500;
END;
$$;
COMMENT ON FUNCTION public.customer_platform_fee_poisha() IS
  'Reads the current audited platform service fee in integer poisha; never accepts a customer-supplied amount.';
REVOKE EXECUTE ON FUNCTION public.customer_platform_fee_poisha() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_platform_fee_poisha() TO service_role;

CREATE OR REPLACE FUNCTION public.customer_delivery_fee_poisha(
  p_customer_id uuid,
  p_vendor_id uuid,
  p_zone_id uuid,
  p_address_id uuid,
  p_food_subtotal_poisha bigint
)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_vendor record;
  v_address record;
  v_distance_km numeric;
  v_fee bigint := 4000;
  v_threshold_raw text;
  v_best_max numeric;
  v_best_fee bigint;
  v_last_max numeric;
  v_last_fee bigint;
  v_tier record;
  v_max numeric;
  v_amount bigint;
BEGIN
  SELECT v.lat, v.lng, z.road_factor, z.fee_overrides
  INTO v_vendor
  FROM public.vendors AS v
  JOIN public.zones AS z ON z.id = v.zone_id
  WHERE v.id = p_vendor_id AND z.id = p_zone_id
    AND v.deleted_at IS NULL AND z.is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUT_OF_ZONE: active vendor zone unavailable' USING ERRCODE = '22023'; END IF;

  SELECT ca.lat, ca.lng INTO v_address
  FROM public.customer_addresses AS ca
  WHERE ca.id = p_address_id AND ca.profile_id = p_customer_id AND ca.zone_id = p_zone_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUT_OF_ZONE: customer address is not in the kitchen zone' USING ERRCODE = '22023'; END IF;

  v_distance_km := public.haversine_km(v_address.lat, v_address.lng, v_vendor.lat, v_vendor.lng) * v_vendor.road_factor;
  IF coalesce(v_vendor.fee_overrides->>'base_delivery_fee_poisha', '') ~ '^[0-9]{1,12}$' THEN
    v_fee := (v_vendor.fee_overrides->>'base_delivery_fee_poisha')::bigint;
  END IF;

  IF jsonb_typeof(v_vendor.fee_overrides->'tiers_poisha') = 'array' THEN
    FOR v_tier IN SELECT value FROM jsonb_array_elements(v_vendor.fee_overrides->'tiers_poisha') AS tier(value)
    LOOP
      IF jsonb_typeof(v_tier.value) <> 'object'
        OR coalesce(v_tier.value->>'max_km', '') !~ '^[0-9]+([.][0-9]+)?$'
        OR coalesce(v_tier.value->>'fee_poisha', '') !~ '^[0-9]{1,12}$' THEN
        CONTINUE;
      END IF;
      v_max := (v_tier.value->>'max_km')::numeric;
      v_amount := (v_tier.value->>'fee_poisha')::bigint;
      IF v_last_max IS NULL OR v_max > v_last_max THEN
        v_last_max := v_max;
        v_last_fee := v_amount;
      END IF;
      IF v_max >= v_distance_km AND (v_best_max IS NULL OR v_max < v_best_max) THEN
        v_best_max := v_max;
        v_best_fee := v_amount;
      END IF;
    END LOOP;
    v_fee := coalesce(v_best_fee, v_last_fee, v_fee);
  END IF;

  v_threshold_raw := coalesce(
    v_vendor.fee_overrides->>'free_delivery_min_poisha',
    v_vendor.fee_overrides->>'free_delivery_above_poisha'
  );
  IF v_threshold_raw ~ '^[0-9]{1,12}$' AND p_food_subtotal_poisha >= v_threshold_raw::bigint THEN
    RETURN 0;
  END IF;
  RETURN v_fee;
END;
$$;
COMMENT ON FUNCTION public.customer_delivery_fee_poisha(uuid, uuid, uuid, uuid, bigint) IS
  'Computes audited zone distance-tier/free-delivery pricing from the server cart and saved address; never trusts client fee fields.';
REVOKE EXECUTE ON FUNCTION public.customer_delivery_fee_poisha(uuid, uuid, uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_delivery_fee_poisha(uuid, uuid, uuid, uuid, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.quote_customer_cart(
  p_customer_id uuid,
  p_delivery_fee_poisha bigint DEFAULT 4000,
  p_platform_fee_poisha bigint DEFAULT 500,
  p_is_priority boolean DEFAULT false,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cart record;
  v_vendor record;
  v_zone record;
  v_address record;
  v_campaign record;
  v_voucher record;
  v_trust smallint;
  v_max_cod bigint;
  v_items bigint := 0;
  v_discount_vendor bigint := 0;
  v_discount_platform bigint := 0;
  v_campaign_discount bigint := 0;
  v_campaign_vendor bigint := 0;
  v_campaign_platform bigint := 0;
  v_voucher_discount bigint := 0;
  v_voucher_vendor bigint := 0;
  v_voucher_platform bigint := 0;
  v_delivery_waived bigint := 0;
  v_delivery bigint := 0;
  v_platform_fee bigint := 500;
  v_price record;
BEGIN
  SELECT trust_score INTO v_trust FROM public.profiles
  WHERE id = p_customer_id AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_INACTIVE: customer is not active' USING ERRCODE = '42501'; END IF;

  SELECT * INTO v_cart FROM public.carts WHERE customer_id = p_customer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CART_EMPTY: no active cart' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_cart.vendor_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_vendor_open_now(v_vendor.id, p_now) THEN
    RAISE EXCEPTION 'VENDOR_CLOSED: vendor is not currently accepting orders' USING ERRCODE = '55000';
  END IF;
  IF v_cart.fulfilment = 'pickup' AND NOT v_vendor.accepts_pickup THEN
    RAISE EXCEPTION 'PICKUP_DISABLED: vendor does not accept customer self-pickup' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_zone FROM public.zones WHERE id = v_vendor.zone_id AND is_active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'OUT_OF_ZONE: vendor zone is inactive' USING ERRCODE = '55000'; END IF;
  IF v_cart.fulfilment = 'delivery' THEN
    SELECT * INTO v_address FROM public.customer_addresses
    WHERE id = v_cart.address_id AND profile_id = p_customer_id;
    IF NOT FOUND OR v_address.zone_id IS DISTINCT FROM v_vendor.zone_id THEN
      RAISE EXCEPTION 'OUT_OF_ZONE: delivery address is not inside the kitchen zone' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cart_items WHERE cart_id = v_cart.id) THEN
    RAISE EXCEPTION 'CART_EMPTY: cart has zero items' USING ERRCODE = '22023';
  END IF;
  v_items := public.calculate_cart_items_total_poisha(v_cart.id, p_now);
  IF v_items <= 0 THEN RAISE EXCEPTION 'CART_EMPTY: cart has zero priced items' USING ERRCODE = '22023'; END IF;
  IF v_items < v_vendor.min_order_poisha THEN
    RAISE EXCEPTION 'BELOW_MIN_ORDER: items % < vendor minimum %', v_items, v_vendor.min_order_poisha USING ERRCODE = '22023';
  END IF;
  IF v_cart.fulfilment = 'delivery' THEN
    v_delivery := public.customer_delivery_fee_poisha(p_customer_id, v_vendor.id, v_zone.id, v_cart.address_id, v_items);
  END IF;
  v_platform_fee := public.customer_platform_fee_poisha();

  SELECT c.* INTO v_campaign
  FROM public.campaigns AS c
  JOIN public.campaign_vendors AS cv ON cv.campaign_id = c.id AND cv.vendor_id = v_vendor.id AND cv.is_active = true
  WHERE c.is_active = true AND p_now >= c.starts_at AND p_now < c.ends_at
    AND v_items >= c.min_order_poisha
    AND (cardinality(c.zone_ids) = 0 OR v_zone.id = ANY(c.zone_ids))
    AND (c.daily_start_time IS NULL OR c.daily_end_time IS NULL
      OR public.shift_contains_time(c.daily_start_time, c.daily_end_time, (p_now AT TIME ZONE 'Asia/Dhaka')::time))
  ORDER BY c.created_at DESC LIMIT 1;
  IF FOUND THEN
    IF v_campaign.flat_poisha IS NOT NULL THEN
      v_campaign_discount := least(v_campaign.flat_poisha, v_items);
    ELSIF v_campaign.percent_bps IS NOT NULL THEN
      v_campaign_discount := public.round_half_up_div(v_items * v_campaign.percent_bps::bigint, 10000);
      IF v_campaign.cap_poisha IS NOT NULL THEN v_campaign_discount := least(v_campaign_discount, v_campaign.cap_poisha); END IF;
    END IF;
    v_campaign_vendor := public.round_half_up_div(v_campaign_discount * v_campaign.vendor_share_bps::bigint, 10000);
    v_campaign_platform := v_campaign_discount - v_campaign_vendor;
    IF v_campaign.budget_cap_poisha IS NOT NULL
      AND v_campaign.budget_spent_poisha + v_campaign_platform > v_campaign.budget_cap_poisha THEN
      v_campaign_vendor := 0;
      v_campaign_platform := 0;
    END IF;
    v_discount_vendor := v_discount_vendor + v_campaign_vendor;
    v_discount_platform := v_discount_platform + v_campaign_platform;
  END IF;

  IF v_cart.voucher_code IS NOT NULL AND char_length(btrim(v_cart.voucher_code)) > 0 THEN
    SELECT * INTO v_voucher FROM public.vouchers
    WHERE code = upper(btrim(v_cart.voucher_code)) AND is_active = true
      AND p_now >= starts_at AND p_now < ends_at;
    IF NOT FOUND THEN RAISE EXCEPTION 'VOUCHER_INVALID: code is inactive or expired' USING ERRCODE = '22023'; END IF;
    IF v_items < v_voucher.min_order_poisha THEN
      RAISE EXCEPTION 'VOUCHER_MIN_ORDER: basket is below required minimum' USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.voucher_redemptions
        WHERE voucher_id = v_voucher.id AND customer_id = p_customer_id) >= v_voucher.max_uses_per_user THEN
      RAISE EXCEPTION 'VOUCHER_LIMIT_REACHED: user limit exceeded' USING ERRCODE = '22023';
    END IF;
    IF v_voucher.kind = 'free_delivery' THEN
      v_delivery_waived := CASE WHEN v_cart.fulfilment = 'delivery' THEN v_delivery ELSE 0 END;
      v_delivery := 0;
    ELSIF v_voucher.kind = 'flat' THEN
      v_voucher_discount := least(v_voucher.value_num, v_items - (v_discount_vendor + v_discount_platform));
    ELSE
      v_voucher_discount := public.round_half_up_div(
        (v_items - (v_discount_vendor + v_discount_platform)) * v_voucher.value_num, 10000
      );
      IF v_voucher.cap_poisha IS NOT NULL THEN v_voucher_discount := least(v_voucher_discount, v_voucher.cap_poisha); END IF;
    END IF;
    v_voucher_vendor := public.round_half_up_div(v_voucher_discount * v_voucher.vendor_share_bps::bigint, 10000);
    v_voucher_platform := v_voucher_discount - v_voucher_vendor;
    IF v_voucher.budget_spent_poisha + v_voucher_platform + v_delivery_waived > v_voucher.budget_cap_poisha THEN
      RAISE EXCEPTION 'VOUCHER_BUDGET_EXHAUSTED: code exceeds campaign budget' USING ERRCODE = '55000';
    END IF;
    v_discount_vendor := v_discount_vendor + v_voucher_vendor;
    v_discount_platform := v_discount_platform + v_voucher_platform;
  END IF;

  SELECT * INTO v_price FROM public.price_order(
    v_cart.fulfilment, v_items, v_discount_vendor, v_discount_platform,
    v_delivery + CASE WHEN p_is_priority AND v_cart.fulfilment = 'delivery' THEN 1000 ELSE 0 END,
    v_platform_fee, v_cart.tip_poisha, v_vendor.commission_bps
  );
  v_max_cod := CASE WHEN v_trust < 40 THEN 80000 WHEN v_trust < 60 THEN 150000 ELSE 350000 END;
  IF v_price.cod_collect_poisha > v_max_cod THEN
    RAISE EXCEPTION 'COD_LIMIT_EXCEEDED: cash amount exceeds customer trust ceiling' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'fulfilment', v_price.fulfilment, 'items_poisha', v_price.items_poisha,
    'discount_vendor_poisha', v_price.discount_vendor_poisha,
    'discount_platform_poisha', v_price.discount_platform_poisha,
    'discount_total_poisha', v_price.discount_total_poisha,
    'food_payable_poisha', v_price.food_payable_poisha,
    'tax_extracted_poisha', v_price.tax_extracted_poisha,
    'delivery_fee_poisha', v_price.delivery_fee_poisha,
    'platform_fee_poisha', v_price.platform_fee_poisha, 'tip_poisha', v_price.tip_poisha,
    'cod_collect_poisha', v_price.cod_collect_poisha,
    'commission_poisha', v_price.commission_poisha,
    'rider_bonus_poisha', v_price.rider_bonus_poisha,
    'vendor_net_poisha', v_price.vendor_net_poisha,
    'undal_margin_poisha', v_price.undal_margin_poisha,
    'campaign_discount_poisha', v_campaign_vendor + v_campaign_platform,
    'voucher_discount_poisha', v_voucher_vendor + v_voucher_platform,
    'delivery_waived_poisha', v_delivery_waived,
    'voucher_code', v_cart.voucher_code
  );
END;
$$;
COMMENT ON FUNCTION public.quote_customer_cart(uuid, bigint, bigint, boolean, timestamptz) IS
  'Returns a read-only W1 quote using current item/modifier prices, campaign and voucher rules, exact integer-poisha price_order() and the COD trust ceiling.';
REVOKE EXECUTE ON FUNCTION public.quote_customer_cart(uuid, bigint, bigint, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quote_customer_cart(uuid, bigint, bigint, boolean, timestamptz) TO service_role;
