-- =============================================================================
-- Migration: 0017_server_authoritative_cart_pricing.sql
-- Build Response 13: all selectable modifier pricing is server-derived in integer poisha.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.calculate_cart_item_unit_poisha(
  p_menu_item_id uuid,
  p_variant_id uuid DEFAULT NULL,
  p_selections jsonb DEFAULT '[]'::jsonb,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item record;
  v_group record;
  v_selections jsonb := coalesce(p_selections, '[]'::jsonb);
  v_variant_groups integer := 0;
  v_variant_delta bigint := 0;
  v_option_delta bigint := 0;
  v_bundle_delta bigint := 0;
  v_selected_count bigint := 0;
  v_option_selected_count bigint := 0;
  v_option_valid_count bigint := 0;
  v_bundle_selected_count bigint := 0;
  v_bundle_valid_count bigint := 0;
  v_total bigint;
BEGIN
  IF p_menu_item_id IS NULL OR jsonb_typeof(v_selections) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_SELECTION: menu item and selections are required' USING ERRCODE = '22023';
  END IF;

  SELECT mi.price_poisha, mi.item_type
  INTO v_item
  FROM public.menu_items AS mi
  WHERE mi.id = p_menu_item_id AND mi.deleted_at IS NULL AND mi.moderation_status = 'visible';
  IF NOT FOUND OR NOT public.is_menu_item_orderable_now(p_menu_item_id, p_now) THEN
    RAISE EXCEPTION 'ITEM_UNAVAILABLE: menu item is not orderable' USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_selections) AS e(selection)
    WHERE jsonb_typeof(e.selection) <> 'object'
      OR coalesce(e.selection->>'kind', '') NOT IN ('option', 'bundle')
      OR (e.selection->>'kind' = 'option' AND (
        coalesce(e.selection->>'group_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR coalesce(e.selection->>'option_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ))
      OR (e.selection->>'kind' = 'bundle' AND (
        coalesce(e.selection->>'slot_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR coalesce(e.selection->>'item_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ))
  ) THEN
    RAISE EXCEPTION 'INVALID_SELECTION: malformed modifier or bundle choice' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_selections) AS e(selection)
    WHERE e.selection->>'kind' = 'option'
    GROUP BY e.selection->>'group_id', e.selection->>'option_id'
    HAVING count(*) > 1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_selections) AS e(selection)
    WHERE e.selection->>'kind' = 'bundle'
    GROUP BY e.selection->>'slot_id', e.selection->>'item_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'INVALID_SELECTION: duplicate choice' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_variant_groups
  FROM public.variant_groups WHERE item_id = p_menu_item_id;
  IF v_variant_groups > 1 THEN
    RAISE EXCEPTION 'INVALID_VARIANT: multiple variant groups are unsupported' USING ERRCODE = '22023';
  END IF;
  FOR v_group IN
    SELECT id, min_select, max_select FROM public.variant_groups WHERE item_id = p_menu_item_id
  LOOP
    IF v_group.min_select > 1 OR v_group.max_select <> 1 THEN
      RAISE EXCEPTION 'INVALID_VARIANT: unsupported variant group limits' USING ERRCODE = '22023';
    END IF;
    v_selected_count := CASE WHEN p_variant_id IS NULL THEN 0 ELSE 1 END;
    IF v_selected_count < v_group.min_select OR v_selected_count > v_group.max_select THEN
      RAISE EXCEPTION 'VARIANT_REQUIRED: select an available portion' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_variant_id IS NOT NULL THEN
    SELECT va.price_delta_poisha INTO v_variant_delta
    FROM public.variants AS va
    JOIN public.variant_groups AS vg ON vg.id = va.group_id
    WHERE va.id = p_variant_id AND vg.item_id = p_menu_item_id AND va.is_available = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_VARIANT: selection is unavailable or belongs to another item' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT count(*) INTO v_option_selected_count
  FROM jsonb_array_elements(v_selections) AS e(selection)
  WHERE e.selection->>'kind' = 'option';
  FOR v_group IN
    SELECT id, min_select, max_select FROM public.option_groups WHERE item_id = p_menu_item_id
  LOOP
    SELECT count(*) INTO v_selected_count
    FROM jsonb_array_elements(v_selections) AS e(selection)
    WHERE e.selection->>'kind' = 'option' AND e.selection->>'group_id' = v_group.id::text;
    IF v_selected_count < v_group.min_select OR v_selected_count > v_group.max_select THEN
      RAISE EXCEPTION 'OPTION_SELECTION_INVALID: group limits not satisfied' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT count(*), coalesce(sum(o.price_delta_poisha), 0)
  INTO v_option_valid_count, v_option_delta
  FROM jsonb_array_elements(v_selections) AS e(selection)
  JOIN public.option_groups AS og ON og.id = (e.selection->>'group_id')::uuid AND og.item_id = p_menu_item_id
  JOIN public.options AS o ON o.id = (e.selection->>'option_id')::uuid AND o.group_id = og.id AND o.is_available = true
  WHERE e.selection->>'kind' = 'option';
  IF v_option_valid_count <> v_option_selected_count THEN
    RAISE EXCEPTION 'OPTION_SELECTION_INVALID: choice is unavailable or belongs to another item' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_bundle_selected_count
  FROM jsonb_array_elements(v_selections) AS e(selection)
  WHERE e.selection->>'kind' = 'bundle';
  FOR v_group IN
    SELECT id, min_pick, max_pick FROM public.bundle_slots WHERE bundle_item_id = p_menu_item_id
  LOOP
    SELECT count(*) INTO v_selected_count
    FROM jsonb_array_elements(v_selections) AS e(selection)
    WHERE e.selection->>'kind' = 'bundle' AND e.selection->>'slot_id' = v_group.id::text;
    IF v_selected_count < v_group.min_pick OR v_selected_count > v_group.max_pick THEN
      RAISE EXCEPTION 'BUNDLE_SELECTION_INVALID: slot limits not satisfied' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  SELECT count(*), coalesce(sum(bsc.price_delta_poisha), 0)
  INTO v_bundle_valid_count, v_bundle_delta
  FROM jsonb_array_elements(v_selections) AS e(selection)
  JOIN public.bundle_slots AS bs ON bs.id = (e.selection->>'slot_id')::uuid AND bs.bundle_item_id = p_menu_item_id
  JOIN public.bundle_slot_choices AS bsc ON bsc.slot_id = bs.id AND bsc.item_id = (e.selection->>'item_id')::uuid
  JOIN public.menu_items AS choice_item ON choice_item.id = bsc.item_id
  WHERE e.selection->>'kind' = 'bundle'
    AND choice_item.deleted_at IS NULL
    AND choice_item.moderation_status = 'visible'
    AND public.is_menu_item_orderable_now(choice_item.id, p_now);
  IF v_bundle_valid_count <> v_bundle_selected_count THEN
    RAISE EXCEPTION 'BUNDLE_SELECTION_INVALID: choice is unavailable or belongs to another item' USING ERRCODE = '22023';
  END IF;

  v_total := v_item.price_poisha + v_variant_delta + v_option_delta + v_bundle_delta;
  IF v_total < 0 THEN
    RAISE EXCEPTION 'INVALID_SELECTION: configured item price cannot be negative' USING ERRCODE = '22023';
  END IF;
  RETURN v_total;
END;
$$;
COMMENT ON FUNCTION public.calculate_cart_item_unit_poisha(uuid, uuid, jsonb, timestamptz) IS
  'Recomputes current menu, variant, option and bundle-choice price in integer poisha and validates every selected ID and min/max rule.';

CREATE OR REPLACE FUNCTION public.calculate_cart_items_total_poisha(
  p_cart_id uuid,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(public.calculate_cart_item_unit_poisha(ci.menu_item_id, ci.variant_id, ci.selections, p_now) * ci.qty), 0)
  FROM public.cart_items AS ci
  WHERE ci.cart_id = p_cart_id;
$$;
COMMENT ON FUNCTION public.calculate_cart_items_total_poisha(uuid, timestamptz) IS
  'Computes a cart gross from current database prices, never trusting client unit snapshots.';
REVOKE EXECUTE ON FUNCTION public.calculate_cart_item_unit_poisha(uuid, uuid, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.calculate_cart_items_total_poisha(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_cart_item_unit_poisha(uuid, uuid, jsonb, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_cart_items_total_poisha(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.set_cart_item_authoritative_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.unit_snapshot_poisha := public.calculate_cart_item_unit_poisha(
    NEW.menu_item_id, NEW.variant_id, NEW.selections, clock_timestamp()
  );
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.set_cart_item_authoritative_price() IS
  'Overwrites cart_items.unit_snapshot_poisha with validated current server pricing.';

DROP TRIGGER IF EXISTS cart_items_authoritative_price ON public.cart_items;
CREATE TRIGGER cart_items_authoritative_price
  BEFORE INSERT OR UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.set_cart_item_authoritative_price();

CREATE OR REPLACE FUNCTION public.place_order(
  p_customer_id uuid,
  p_idempotency_key text,
  p_expected_cod_poisha bigint DEFAULT NULL,
  p_delivery_fee_poisha bigint DEFAULT 4000,
  p_platform_fee_poisha bigint DEFAULT 500,
  p_is_priority boolean DEFAULT false,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_replay jsonb;
  v_cart record;
  v_vendor record;
  v_zone record;
  v_addr record;
  v_trust smallint;
  v_max_cod bigint;
  v_items_gross bigint := 0;
  v_disc_vendor bigint := 0;
  v_disc_platform bigint := 0;
  v_camp record;
  v_camp_id uuid := NULL;
  v_camp_total bigint := 0;
  v_camp_v bigint := 0;
  v_camp_p bigint := 0;
  v_voucher record;
  v_voucher_id uuid := NULL;
  v_voucher_total bigint := 0;
  v_voucher_v bigint := 0;
  v_voucher_p bigint := 0;
  v_deliv_waived bigint := 0;
  v_deliv_effective bigint := 0;
  v_platform_fee_effective bigint := 500;
  v_price record;
  v_order_id uuid := gen_random_uuid();
  v_public_code text;
  v_nonce text := encode(sha256(convert_to(v_order_id::text || ':' || clock_timestamp()::text || ':' || random()::text, 'UTF8')), 'hex');
  v_code4 char(4) := lpad((floor(random() * 10000)::int)::text, 4, '0');
  v_resp jsonb;
BEGIN
  SELECT response_body INTO v_replay
  FROM public.idempotency_keys
  WHERE actor_id = p_customer_id AND key = p_idempotency_key AND expires_at > p_now;
  IF FOUND THEN
    RETURN v_replay || jsonb_build_object('idempotent_replay', true);
  END IF;

  SELECT trust_score INTO v_trust FROM public.profiles WHERE id = p_customer_id AND status = 'active' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCOUNT_INACTIVE: customer % is not active', p_customer_id USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cart FROM public.carts WHERE customer_id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CART_EMPTY: no active cart for customer %', p_customer_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_vendor FROM public.vendors WHERE id = v_cart.vendor_id AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.is_vendor_open_now(v_vendor.id, p_now) THEN
    RAISE EXCEPTION 'VENDOR_CLOSED: vendor % is not currently accepting orders', v_cart.vendor_id USING ERRCODE = '55000';
  END IF;
  IF v_cart.fulfilment = 'pickup' AND NOT v_vendor.accepts_pickup THEN
    RAISE EXCEPTION 'PICKUP_DISABLED: vendor % does not accept customer self-pickup', v_vendor.id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_zone FROM public.zones WHERE id = v_vendor.zone_id AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OUT_OF_ZONE: vendor zone is inactive' USING ERRCODE = '55000';
  END IF;

  IF v_cart.fulfilment = 'delivery' THEN
    SELECT * INTO v_addr FROM public.customer_addresses WHERE id = v_cart.address_id AND profile_id = p_customer_id;
    IF NOT FOUND OR v_addr.zone_id IS DISTINCT FROM v_vendor.zone_id THEN
      RAISE EXCEPTION 'OUT_OF_ZONE: delivery address must resolve inside kitchen zone %', v_zone.slug USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.cart_items AS ci
    WHERE ci.cart_id = v_cart.id AND NOT public.is_menu_item_orderable_now(ci.menu_item_id, p_now)
  ) THEN
    RAISE EXCEPTION 'ITEM_UNAVAILABLE: one or more cart items are currently unavailable' USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(sum(public.calculate_cart_item_unit_poisha(ci.menu_item_id, ci.variant_id, ci.selections, p_now) * ci.qty), 0)
  INTO v_items_gross
  FROM public.cart_items AS ci
  WHERE ci.cart_id = v_cart.id;

  IF v_items_gross <= 0 THEN
    RAISE EXCEPTION 'CART_EMPTY: cart has zero items' USING ERRCODE = '22023';
  END IF;
  IF v_items_gross < v_vendor.min_order_poisha THEN
    RAISE EXCEPTION 'BELOW_MIN_ORDER: items % < vendor minimum %', v_items_gross, v_vendor.min_order_poisha USING ERRCODE = '22023';
  END IF;
  IF v_cart.fulfilment = 'delivery' THEN
    v_deliv_effective := public.customer_delivery_fee_poisha(p_customer_id, v_vendor.id, v_zone.id, v_cart.address_id, v_items_gross);
  END IF;
  v_platform_fee_effective := public.customer_platform_fee_poisha();

  SELECT c.* INTO v_camp
  FROM public.campaigns AS c
  JOIN public.campaign_vendors AS cv ON cv.campaign_id = c.id AND cv.vendor_id = v_vendor.id AND cv.is_active = true
  WHERE c.is_active = true
    AND p_now >= c.starts_at AND p_now < c.ends_at
    AND v_items_gross >= c.min_order_poisha
    AND (cardinality(c.zone_ids) = 0 OR v_zone.id = ANY(c.zone_ids))
    AND (c.daily_start_time IS NULL OR c.daily_end_time IS NULL
         OR public.shift_contains_time(c.daily_start_time, c.daily_end_time, (p_now AT TIME ZONE 'Asia/Dhaka')::time))
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE OF c;

  IF FOUND THEN
    IF v_camp.flat_poisha IS NOT NULL THEN
      v_camp_total := least(v_camp.flat_poisha, v_items_gross);
    ELSIF v_camp.percent_bps IS NOT NULL THEN
      v_camp_total := public.round_half_up_div(v_items_gross * v_camp.percent_bps::bigint, 10000);
      IF v_camp.cap_poisha IS NOT NULL THEN v_camp_total := least(v_camp_total, v_camp.cap_poisha); END IF;
    END IF;
    v_camp_v := public.round_half_up_div(v_camp_total * v_camp.vendor_share_bps::bigint, 10000);
    v_camp_p := v_camp_total - v_camp_v;
    IF v_camp.budget_cap_poisha IS NULL OR (v_camp.budget_spent_poisha + v_camp_p) <= v_camp.budget_cap_poisha THEN
      v_disc_vendor := v_disc_vendor + v_camp_v;
      v_disc_platform := v_disc_platform + v_camp_p;
      v_camp_id := v_camp.id;
    END IF;
  END IF;

  IF v_cart.voucher_code IS NOT NULL AND char_length(btrim(v_cart.voucher_code)) > 0 THEN
    SELECT * INTO v_voucher
    FROM public.vouchers
    WHERE code = upper(btrim(v_cart.voucher_code)) AND is_active = true AND p_now >= starts_at AND p_now < ends_at
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'VOUCHER_INVALID: code % is inactive or expired', v_cart.voucher_code USING ERRCODE = '22023';
    END IF;
    IF v_items_gross < v_voucher.min_order_poisha THEN
      RAISE EXCEPTION 'VOUCHER_MIN_ORDER: basket % < required %', v_items_gross, v_voucher.min_order_poisha USING ERRCODE = '22023';
    END IF;
    IF (SELECT count(*) FROM public.voucher_redemptions WHERE voucher_id = v_voucher.id AND customer_id = p_customer_id) >= v_voucher.max_uses_per_user THEN
      RAISE EXCEPTION 'VOUCHER_LIMIT_REACHED: user limit exceeded for %', v_voucher.code USING ERRCODE = '22023';
    END IF;

    IF v_voucher.kind = 'free_delivery' THEN
      v_deliv_waived := CASE WHEN v_cart.fulfilment = 'delivery' THEN v_deliv_effective ELSE 0 END;
      v_deliv_effective := 0;
    ELSIF v_voucher.kind = 'flat' THEN
      v_voucher_total := least(v_voucher.value_num, v_items_gross - (v_disc_vendor + v_disc_platform));
    ELSE
      v_voucher_total := public.round_half_up_div((v_items_gross - (v_disc_vendor + v_disc_platform)) * v_voucher.value_num, 10000);
      IF v_voucher.cap_poisha IS NOT NULL THEN v_voucher_total := least(v_voucher_total, v_voucher.cap_poisha); END IF;
    END IF;

    v_voucher_v := public.round_half_up_div(v_voucher_total * v_voucher.vendor_share_bps::bigint, 10000);
    v_voucher_p := v_voucher_total - v_voucher_v;
    IF (v_voucher.budget_spent_poisha + v_voucher_p + v_deliv_waived) > v_voucher.budget_cap_poisha THEN
      RAISE EXCEPTION 'VOUCHER_BUDGET_EXHAUSTED: % exceeds campaign budget', v_voucher.code USING ERRCODE = '55000';
    END IF;
    v_disc_vendor := v_disc_vendor + v_voucher_v;
    v_disc_platform := v_disc_platform + v_voucher_p;
    v_voucher_id := v_voucher.id;
  END IF;

  SELECT * INTO v_price FROM public.price_order(
    v_cart.fulfilment,
    v_items_gross,
    v_disc_vendor,
    v_disc_platform,
    v_deliv_effective + CASE WHEN p_is_priority AND v_cart.fulfilment = 'delivery' THEN 1000 ELSE 0 END,
    v_platform_fee_effective,
    v_cart.tip_poisha,
    v_vendor.commission_bps
  );

  IF p_expected_cod_poisha IS NOT NULL AND p_expected_cod_poisha <> v_price.cod_collect_poisha THEN
    RAISE EXCEPTION 'CART_STALE: expected cod %, server computed %', p_expected_cod_poisha, v_price.cod_collect_poisha
      USING ERRCODE = '40001';
  END IF;

  v_max_cod := CASE WHEN v_trust < 40 THEN 80000 WHEN v_trust < 60 THEN 150000 ELSE 350000 END;
  IF v_price.cod_collect_poisha > v_max_cod THEN
    RAISE EXCEPTION 'COD_LIMIT_EXCEEDED: cod % exceeds customer trust ceiling %', v_price.cod_collect_poisha, v_max_cod
      USING ERRCODE = '22023';
  END IF;

  v_public_code := public.next_order_public_code(v_zone.slug, p_now);

  INSERT INTO public.orders (
    id, public_code, customer_id, vendor_id, zone_id, fulfilment, status,
    address_snapshot, vendor_snapshot, cutlery_requested, customer_note, change_for_poisha,
    items_poisha, discount_total_poisha, discount_vendor_poisha, discount_platform_poisha,
    delivery_fee_poisha, platform_fee_poisha, tip_poisha, tax_extracted_poisha,
    cod_collect_poisha, rider_bonus_poisha, commission_poisha, vendor_net_poisha, undal_margin_poisha,
    pickup_qr_nonce, pickup_code_4, voucher_id, campaign_id, is_priority, placed_at
  )
  VALUES (
    v_order_id, v_public_code, p_customer_id, v_vendor.id, v_zone.id, v_cart.fulfilment, 'PLACED',
    CASE
      WHEN v_cart.fulfilment = 'delivery' THEN jsonb_build_object(
        'label', v_addr.label, 'lat', v_addr.lat, 'lng', v_addr.lng,
        'address_text', v_addr.address_text, 'delivery_instructions', v_addr.delivery_instructions
      )
      ELSE jsonb_build_object('mode', 'pickup')
    END,
    jsonb_build_object(
      'brand_name', v_vendor.brand_name, 'brand_name_bn', v_vendor.brand_name_bn,
      'type', v_vendor.type, 'public_area_label', v_vendor.public_area_label,
      'pickup_point_label', CASE WHEN v_vendor.accepts_pickup THEN v_vendor.pickup_point_label ELSE NULL END
    ),
    v_cart.cutlery_requested, v_cart.customer_note, v_cart.change_for_poisha,
    v_price.items_poisha, v_price.discount_total_poisha, v_price.discount_vendor_poisha, v_price.discount_platform_poisha,
    v_price.delivery_fee_poisha, v_price.platform_fee_poisha, v_price.tip_poisha, v_price.tax_extracted_poisha,
    v_price.cod_collect_poisha, v_price.rider_bonus_poisha, v_price.commission_poisha, v_price.vendor_net_poisha, v_price.undal_margin_poisha,
    v_nonce, v_code4, v_voucher_id, v_camp_id, p_is_priority, p_now
  );

  INSERT INTO public.order_items (
    order_id, menu_item_id, name_en_snapshot, name_bn_snapshot, unit_poisha, qty, line_poisha, selections, note
  )
  SELECT
    v_order_id, ci.menu_item_id, mi.name_en, mi.name_bn,
    public.calculate_cart_item_unit_poisha(ci.menu_item_id, ci.variant_id, ci.selections, p_now), ci.qty,
    public.calculate_cart_item_unit_poisha(ci.menu_item_id, ci.variant_id, ci.selections, p_now) * ci.qty,
    ci.selections, ci.note
  FROM public.cart_items AS ci
  JOIN public.menu_items AS mi ON mi.id = ci.menu_item_id
  WHERE ci.cart_id = v_cart.id;

  INSERT INTO public.order_events (order_id, actor_id, actor_kind, from_status, to_status, meta, created_at)
  VALUES (v_order_id, p_customer_id, 'customer', NULL, 'PLACED', jsonb_build_object('public_code', v_public_code), p_now);

  IF v_camp_id IS NOT NULL AND v_camp_p > 0 THEN
    UPDATE public.campaigns SET budget_spent_poisha = budget_spent_poisha + v_camp_p WHERE id = v_camp_id;
  END IF;

  IF v_voucher_id IS NOT NULL THEN
    INSERT INTO public.voucher_redemptions (
      voucher_id, customer_id, order_id, discount_vendor_poisha, discount_platform_poisha, delivery_waived_poisha
    ) VALUES (v_voucher_id, p_customer_id, v_order_id, v_voucher_v, v_voucher_p, v_deliv_waived);
    UPDATE public.vouchers SET budget_spent_poisha = budget_spent_poisha + v_voucher_p + v_deliv_waived WHERE id = v_voucher_id;
  END IF;

  DELETE FROM public.cart_items WHERE cart_id = v_cart.id;

  v_resp := jsonb_build_object(
    'order_id', v_order_id, 'public_code', v_public_code, 'status', 'PLACED',
    'cod_collect_poisha', v_price.cod_collect_poisha, 'vendor_net_poisha', v_price.vendor_net_poisha,
    'commission_poisha', v_price.commission_poisha, 'tax_extracted_poisha', v_price.tax_extracted_poisha,
    'rider_bonus_poisha', v_price.rider_bonus_poisha, 'idempotent_replay', false
  );

  INSERT INTO public.idempotency_keys (actor_id, key, route, request_hash, status_code, response_body, created_at, expires_at)
  VALUES (p_customer_id, p_idempotency_key, 'POST /v1/orders', md5(p_idempotency_key), 201, v_resp, p_now, p_now + INTERVAL '24 hours');
  RETURN v_resp;
END;
$$;
COMMENT ON FUNCTION public.place_order(uuid, text, bigint, bigint, bigint, boolean, timestamptz) IS
  'Atomically validates cart, applies campaign/voucher budget locks, runs price_order(), writes order + items + event, and caches 24h idempotent response.';
REVOKE EXECUTE ON FUNCTION public.place_order(uuid, text, bigint, bigint, bigint, boolean, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.place_order(uuid, text, bigint, bigint, bigint, boolean, timestamptz) TO service_role;
