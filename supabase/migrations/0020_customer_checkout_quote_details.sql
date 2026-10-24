-- =============================================================================
-- Migration: 0020_customer_checkout_quote_details.sql
-- Build Response 14: server-priced line details, configurable priority fee, and COD parity.
-- =============================================================================

INSERT INTO public.platform_settings (key, group_key, value, value_type, description_en, is_public_readable)
VALUES (
  'money.priority_delivery_fee_poisha', 'money', '2000'::jsonb, 'integer',
  'Customer priority-delivery upgrade fee in integer poisha', false
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.customer_priority_delivery_fee_poisha()
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_raw text;
BEGIN
  SELECT value #>> '{}' INTO v_raw FROM public.platform_settings
  WHERE key = 'money.priority_delivery_fee_poisha';
  IF v_raw ~ '^[0-9]{1,12}$' THEN RETURN v_raw::bigint; END IF;
  RETURN 2000;
END;
$$;
COMMENT ON FUNCTION public.customer_priority_delivery_fee_poisha() IS
  'Reads the admin-configurable priority-delivery surcharge in integer poisha; clients never choose the fee.';
REVOKE EXECUTE ON FUNCTION public.customer_priority_delivery_fee_poisha() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.customer_priority_delivery_fee_poisha() TO service_role;

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
  v_priority_fee bigint := 0;
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
  v_priority_fee := public.customer_priority_delivery_fee_poisha();

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
    IF v_voucher.first_order_only AND EXISTS (
      SELECT 1 FROM public.orders WHERE customer_id = p_customer_id
    ) THEN
      RAISE EXCEPTION 'VOUCHER_FIRST_ORDER_ONLY: code is limited to a first order' USING ERRCODE = '22023';
    END IF;
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
    v_delivery + CASE WHEN p_is_priority AND v_cart.fulfilment = 'delivery' THEN v_priority_fee ELSE 0 END,
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
    'priority_delivery_fee_poisha', v_priority_fee,
    'cod_collect_poisha', v_price.cod_collect_poisha,
    'commission_poisha', v_price.commission_poisha,
    'rider_bonus_poisha', v_price.rider_bonus_poisha,
    'vendor_net_poisha', v_price.vendor_net_poisha,
    'undal_margin_poisha', v_price.undal_margin_poisha,
    'campaign_discount_poisha', v_campaign_vendor + v_campaign_platform,
    'voucher_discount_poisha', v_voucher_vendor + v_voucher_platform,
    'delivery_waived_poisha', v_delivery_waived,
    'voucher_code', v_cart.voucher_code,
    'line_items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'menu_item_id', ci.menu_item_id, 'variant_id', ci.variant_id,
        'selections', ci.selections, 'qty', ci.qty,
        'name_en', mi.name_en, 'name_bn', mi.name_bn,
        'unit_poisha', priced.unit_poisha, 'line_poisha', priced.unit_poisha * ci.qty
      ) ORDER BY ci.created_at, ci.id)
      FROM public.cart_items AS ci
      JOIN public.menu_items AS mi ON mi.id = ci.menu_item_id
      CROSS JOIN LATERAL (
        SELECT public.calculate_cart_item_unit_poisha(ci.menu_item_id, ci.variant_id, ci.selections, p_now) AS unit_poisha
      ) AS priced
      WHERE ci.cart_id = v_cart.id
    ), '[]'::jsonb)
  );
END;
$$;
COMMENT ON FUNCTION public.quote_customer_cart(uuid, bigint, bigint, boolean, timestamptz) IS
  'Returns a read-only W1 quote using current item/modifier prices, campaign and voucher rules, exact integer-poisha price_order() and the COD trust ceiling.';

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
  v_priority_fee_effective bigint := 0;
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
    IF v_voucher.first_order_only AND EXISTS (
      SELECT 1 FROM public.orders WHERE customer_id = p_customer_id
    ) THEN
      RAISE EXCEPTION 'VOUCHER_FIRST_ORDER_ONLY: code % is limited to a first order', v_voucher.code USING ERRCODE = '22023';
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

  v_priority_fee_effective := public.customer_priority_delivery_fee_poisha();

  SELECT * INTO v_price FROM public.price_order(
    v_cart.fulfilment,
    v_items_gross,
    v_disc_vendor,
    v_disc_platform,
    v_deliv_effective + CASE WHEN p_is_priority AND v_cart.fulfilment = 'delivery' THEN v_priority_fee_effective ELSE 0 END,
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
