-- =============================================================================
-- Migration: 0012_money_and_order_rpcs.sql
-- Milestone: Build Response 4 (Migrations III — Order Placement, Transitions, QR Handover & RLS)
-- Functions: place_order, transition_order, verify_pickup_handover, is_rider_owner
-- RLS:       Full grants & policies across 0009..0011 (16 new tables -> 43 cumulative tables)
-- References: Master Guide File 10 (§10.1–10.6), File 12, File 22, ADR-0005
-- =============================================================================

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
  v_deliv_effective bigint := coalesce(p_delivery_fee_poisha, 0);
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

  SELECT coalesce(sum((mi.price_poisha + coalesce(va.price_delta_poisha, 0)) * ci.qty), 0)
  INTO v_items_gross
  FROM public.cart_items AS ci
  JOIN public.menu_items AS mi ON mi.id = ci.menu_item_id
  LEFT JOIN public.variants AS va ON va.id = ci.variant_id
  WHERE ci.cart_id = v_cart.id;

  IF v_items_gross <= 0 THEN
    RAISE EXCEPTION 'CART_EMPTY: cart has zero items' USING ERRCODE = '22023';
  END IF;
  IF v_items_gross < v_vendor.min_order_poisha THEN
    RAISE EXCEPTION 'BELOW_MIN_ORDER: items % < vendor minimum %', v_items_gross, v_vendor.min_order_poisha USING ERRCODE = '22023';
  END IF;

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
    p_platform_fee_poisha,
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
    (mi.price_poisha + coalesce(va.price_delta_poisha, 0)), ci.qty,
    (mi.price_poisha + coalesce(va.price_delta_poisha, 0)) * ci.qty,
    ci.selections, ci.note
  FROM public.cart_items AS ci
  JOIN public.menu_items AS mi ON mi.id = ci.menu_item_id
  LEFT JOIN public.variants AS va ON va.id = ci.variant_id
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

CREATE OR REPLACE FUNCTION public.transition_order(
  p_order_id uuid,
  p_actor_id uuid,
  p_actor_kind text,
  p_to_status text,
  p_meta jsonb DEFAULT '{}'::jsonb,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord public.orders%ROWTYPE;
  v_prev_status text;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id USING ERRCODE = 'P0002'; END IF;
  v_prev_status := v_ord.status;

  IF NOT public.is_legal_order_transition(v_prev_status, p_to_status) THEN
    RAISE EXCEPTION 'ILLEGAL_ORDER_TRANSITION: % -> %', v_prev_status, p_to_status USING ERRCODE = '22023';
  END IF;

  IF p_to_status = 'FAILED_DELIVERY' THEN
    IF coalesce((p_meta ->> 'wait_minutes')::int, 0) < 8 OR coalesce((p_meta ->> 'call_attempts')::int, 0) < 2 THEN
      RAISE EXCEPTION 'DOOR_PROTOCOL_INCOMPLETE: FAILED_DELIVERY requires >= 8 min wait and >= 2 logged calls' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_to_status LIKE 'CANCELLED_%' AND (p_meta ->> 'cancel_reason_key') IS NULL THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED: cancel_reason_key required for %', p_to_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders SET
    status = p_to_status,
    rider_id = coalesce((p_meta ->> 'rider_id')::uuid, rider_id),
    rider_fare_poisha = coalesce((p_meta ->> 'rider_fare_poisha')::bigint, rider_fare_poisha),
    prep_minutes_committed = coalesce((p_meta ->> 'prep_minutes_committed')::smallint, prep_minutes_committed),
    accepted_at = CASE WHEN p_to_status = 'VENDOR_ACCEPTED' THEN coalesce(accepted_at, p_now) ELSE accepted_at END,
    ready_at = CASE WHEN p_to_status = 'READY_FOR_PICKUP' THEN coalesce(ready_at, p_now) ELSE ready_at END,
    arrived_vendor_at = CASE WHEN p_to_status = 'RIDER_AT_VENDOR' THEN coalesce(arrived_vendor_at, p_now) ELSE arrived_vendor_at END,
    picked_at = CASE WHEN p_to_status = 'PICKED_UP' THEN coalesce(picked_at, p_now) ELSE picked_at END,
    arrived_customer_at = CASE WHEN p_to_status = 'RIDER_AT_CUSTOMER' THEN coalesce(arrived_customer_at, p_now) ELSE arrived_customer_at END,
    delivered_at = CASE WHEN p_to_status = 'DELIVERED' THEN coalesce(delivered_at, p_now) ELSE delivered_at END,
    cancelled_at = CASE WHEN p_to_status LIKE 'CANCELLED_%' THEN coalesce(cancelled_at, p_now) ELSE cancelled_at END,
    cancel_reason_key = coalesce(p_meta ->> 'cancel_reason_key', cancel_reason_key)
  WHERE id = p_order_id
  RETURNING * INTO v_ord;

  INSERT INTO public.order_events (order_id, actor_id, actor_kind, from_status, to_status, meta, created_at)
  VALUES (p_order_id, p_actor_id, p_actor_kind, v_prev_status, p_to_status, coalesce(p_meta, '{}'::jsonb), p_now);
  RETURN v_ord;
END;
$$;
COMMENT ON FUNCTION public.transition_order(uuid, uuid, text, text, jsonb, timestamptz) IS
  'Atomically advances order status along legal transitions, enforces door/cancel protocols, and writes append-only order_events.';

CREATE OR REPLACE FUNCTION public.verify_pickup_handover(
  p_order_id uuid,
  p_actor_profile_id uuid,
  p_secret text,
  p_qr_token text DEFAULT NULL,
  p_code_4 text DEFAULT NULL,
  p_feedback_rating smallint DEFAULT NULL,
  p_feedback_tags text[] DEFAULT '{}'::text[],
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS public.orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord public.orders%ROWTYPE;
  v_prev_status text;
  v_expected_qr text;
  v_target_status text;
  v_actor_kind text;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND: %', p_order_id USING ERRCODE = 'P0002'; END IF;
  v_prev_status := v_ord.status;
  IF v_prev_status NOT IN ('READY_FOR_PICKUP', 'RIDER_AT_VENDOR') THEN
    RAISE EXCEPTION 'PICKUP_NOT_READY: order % must be READY_FOR_PICKUP or RIDER_AT_VENDOR (got %)', p_order_id, v_prev_status USING ERRCODE = '55000';
  END IF;

  v_expected_qr := public.compute_pickup_qr_token(v_ord.id, v_ord.pickup_qr_nonce, p_secret);
  IF NOT (
    (p_qr_token IS NOT NULL AND p_qr_token = v_expected_qr)
    OR (p_code_4 IS NOT NULL AND btrim(p_code_4) = v_ord.pickup_code_4)
  ) THEN
    RAISE EXCEPTION 'PICKUP_TOKEN_MISMATCH: invalid QR token or 4-digit handover code' USING ERRCODE = '42501';
  END IF;

  IF v_ord.fulfilment = 'delivery' THEN
    IF v_ord.rider_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.riders AS r WHERE r.id = v_ord.rider_id AND r.profile_id = p_actor_profile_id
    ) THEN
      RAISE EXCEPTION 'PICKUP_WRONG_RIDER: caller is not the assigned rider for order %', p_order_id USING ERRCODE = '42501';
    END IF;
    v_target_status := 'PICKED_UP';
    v_actor_kind := 'rider';
  ELSE
    IF v_ord.customer_id <> p_actor_profile_id AND NOT public.is_vendor_operator(v_ord.vendor_id) THEN
      RAISE EXCEPTION 'PICKUP_UNAUTHORIZED: caller cannot complete pickup order %', p_order_id USING ERRCODE = '42501';
    END IF;
    v_target_status := 'DELIVERED';
    v_actor_kind := 'customer';
  END IF;

  UPDATE public.orders SET
    status = v_target_status,
    picked_at = coalesce(picked_at, p_now),
    delivered_at = CASE WHEN v_target_status = 'DELIVERED' THEN coalesce(delivered_at, p_now) ELSE delivered_at END,
    pickup_feedback_rating = coalesce(p_feedback_rating, pickup_feedback_rating),
    pickup_feedback_tags = CASE WHEN cardinality(p_feedback_tags) > 0 THEN p_feedback_tags ELSE pickup_feedback_tags END
  WHERE id = p_order_id
  RETURNING * INTO v_ord;

  INSERT INTO public.order_events (order_id, actor_id, actor_kind, from_status, to_status, meta, created_at)
  VALUES (
    p_order_id, p_actor_profile_id, v_actor_kind, v_prev_status, v_target_status,
    jsonb_build_object('method', CASE WHEN p_qr_token IS NOT NULL THEN 'qr' ELSE 'code_4' END), p_now
  );
  RETURN v_ord;
END;
$$;
COMMENT ON FUNCTION public.verify_pickup_handover(uuid, uuid, text, text, text, smallint, text[], timestamptz) IS
  'Verifies SHA-256 QR handover token or 4-digit fallback code; zero counter cash changes hands on delivery pickup.';

CREATE OR REPLACE FUNCTION public.is_rider_owner(p_rider_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.riders AS r WHERE r.id = p_rider_id AND r.profile_id = auth.uid() AND r.deleted_at IS NULL
  );
$$;

GRANT SELECT ON public.campaigns TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.riders, public.rider_documents, public.rider_shifts, public.presence_live TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.carts, public.cart_items, public.campaign_vendors TO authenticated;
GRANT SELECT ON public.vouchers, public.voucher_redemptions, public.order_batches, public.orders, public.order_items, public.order_events, public.order_offers, public.idempotency_keys TO authenticated;
GRANT ALL ON
  public.riders, public.rider_documents, public.rider_shifts, public.presence_live,
  public.campaigns, public.campaign_vendors, public.vouchers, public.voucher_redemptions,
  public.carts, public.cart_items, public.idempotency_keys,
  public.order_batches, public.orders, public.order_items, public.order_events, public.order_offers
TO service_role;

DROP POLICY IF EXISTS vendors_select_assigned_active_rider ON public.vendors;
CREATE POLICY vendors_select_assigned_active_rider ON public.vendors FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders AS o JOIN public.riders AS r ON r.id = o.rider_id
    WHERE o.vendor_id = vendors.id AND r.profile_id = auth.uid()
      AND o.status IN ('RIDER_ASSIGNED', 'PREPARING', 'READY_FOR_PICKUP', 'RIDER_AT_VENDOR')
  ));

DROP POLICY IF EXISTS riders_self_or_admin ON public.riders;
CREATE POLICY riders_self_or_admin ON public.riders FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.has_admin_permission('2.rider_360') OR public.has_admin_permission('4.pipeline'))
  WITH CHECK (profile_id = auth.uid() OR public.has_admin_permission('2.rider_360') OR public.has_admin_permission('4.pipeline'));

DROP POLICY IF EXISTS rider_documents_owner_or_kyc ON public.rider_documents;
CREATE POLICY rider_documents_owner_or_kyc ON public.rider_documents FOR ALL TO authenticated
  USING (public.is_rider_owner(rider_id) OR public.has_admin_permission('4.pipeline'))
  WITH CHECK (public.is_rider_owner(rider_id) OR public.has_admin_permission('4.pipeline'));

DROP POLICY IF EXISTS rider_shifts_owner_or_ops ON public.rider_shifts;
CREATE POLICY rider_shifts_owner_or_ops ON public.rider_shifts FOR ALL TO authenticated
  USING (public.is_rider_owner(rider_id) OR public.has_admin_permission('2.rider_360'))
  WITH CHECK (public.is_rider_owner(rider_id) OR public.has_admin_permission('2.rider_360'));

DROP POLICY IF EXISTS presence_live_self_or_dispatch ON public.presence_live;
CREATE POLICY presence_live_self_or_dispatch ON public.presence_live FOR ALL TO authenticated
  USING (profile_id = auth.uid() OR public.has_admin_permission('2.live_map'))
  WITH CHECK (profile_id = auth.uid() OR public.has_admin_permission('2.live_map'));

DROP POLICY IF EXISTS campaigns_read_public ON public.campaigns;
CREATE POLICY campaigns_read_public ON public.campaigns FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('7.campaigns'));
DROP POLICY IF EXISTS campaigns_manage_admin ON public.campaigns;
CREATE POLICY campaigns_manage_admin ON public.campaigns FOR ALL TO authenticated
  USING (public.has_admin_permission('7.campaigns')) WITH CHECK (public.has_admin_permission('7.campaigns'));

DROP POLICY IF EXISTS campaign_vendors_access ON public.campaign_vendors;
CREATE POLICY campaign_vendors_access ON public.campaign_vendors FOR ALL TO authenticated
  USING (is_active = true OR public.is_vendor_owner(vendor_id) OR public.has_admin_permission('7.campaigns'))
  WITH CHECK (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('7.campaigns'));

DROP POLICY IF EXISTS vouchers_read_active ON public.vouchers;
CREATE POLICY vouchers_read_active ON public.vouchers FOR SELECT TO authenticated
  USING (is_active = true OR public.has_admin_permission('7.vouchers'));
DROP POLICY IF EXISTS vouchers_manage_admin ON public.vouchers;
CREATE POLICY vouchers_manage_admin ON public.vouchers FOR ALL TO authenticated
  USING (public.has_admin_permission('7.vouchers')) WITH CHECK (public.has_admin_permission('7.vouchers'));

DROP POLICY IF EXISTS voucher_redemptions_read_own ON public.voucher_redemptions;
CREATE POLICY voucher_redemptions_read_own ON public.voucher_redemptions FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR public.has_admin_permission('7.vouchers'));

DROP POLICY IF EXISTS carts_own_only ON public.carts;
CREATE POLICY carts_own_only ON public.carts FOR ALL TO authenticated
  USING (customer_id = auth.uid() OR public.has_admin_permission('8.customer_360'))
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS cart_items_own_only ON public.cart_items;
CREATE POLICY cart_items_own_only ON public.cart_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.carts AS c WHERE c.id = cart_items.cart_id AND (c.customer_id = auth.uid() OR public.has_admin_permission('8.customer_360'))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.carts AS c WHERE c.id = cart_items.cart_id AND c.customer_id = auth.uid()));

DROP POLICY IF EXISTS idempotency_keys_own_read ON public.idempotency_keys;
CREATE POLICY idempotency_keys_own_read ON public.idempotency_keys FOR SELECT TO authenticated
  USING (actor_id = auth.uid() OR public.has_admin_permission('6.order_360'));

DROP POLICY IF EXISTS order_batches_participant_or_ops ON public.order_batches;
CREATE POLICY order_batches_participant_or_ops ON public.order_batches FOR SELECT TO authenticated
  USING ((rider_id IS NOT NULL AND public.is_rider_owner(rider_id)) OR public.has_admin_permission('2.live_map') OR public.has_admin_permission('6.order_360'));

DROP POLICY IF EXISTS orders_participant_select ON public.orders;
CREATE POLICY orders_participant_select ON public.orders FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_vendor_operator(vendor_id)
    OR (rider_id IS NOT NULL AND public.is_rider_owner(rider_id))
    OR public.has_admin_permission('6.order_360')
    OR public.has_admin_permission('2.live_map')
  );

DROP POLICY IF EXISTS order_items_participant_select ON public.order_items;
CREATE POLICY order_items_participant_select ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders AS o WHERE o.id = order_items.order_id));

DROP POLICY IF EXISTS order_events_participant_select ON public.order_events;
CREATE POLICY order_events_participant_select ON public.order_events FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders AS o WHERE o.id = order_events.order_id));

DROP POLICY IF EXISTS order_offers_rider_or_ops ON public.order_offers;
CREATE POLICY order_offers_rider_or_ops ON public.order_offers FOR SELECT TO authenticated
  USING (public.is_rider_owner(rider_id) OR public.has_admin_permission('2.live_map') OR public.has_admin_permission('6.order_360'));
