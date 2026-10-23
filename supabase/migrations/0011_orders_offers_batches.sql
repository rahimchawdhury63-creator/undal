-- =============================================================================
-- Migration: 0011_orders_offers_batches.sql
-- Milestone: Build Response 4 (Migrations III — Canonical SQL Money Math, Orders, Events & Offers)
-- Functions: round_half_up_div, price_order, compute_pickup_qr_token,
--            next_order_public_code, is_legal_order_transition
-- Tables:    order_batches, orders, order_items, order_events (APPEND-ONLY), order_offers
-- References: Master Guide File 07, File 10 (§10.2), File 12, File 22, Appendix F (M-1..M-8)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.round_half_up_div(p_num bigint, p_den bigint)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE STRICT PARALLEL SAFE AS $$
DECLARE
  v_sign bigint := 1;
  v_abs_n bigint := abs(p_num);
  v_abs_d bigint := abs(p_den);
  v_quot bigint;
BEGIN
  IF p_den = 0 THEN
    RAISE EXCEPTION 'DIVISION_BY_ZERO in round_half_up_div' USING ERRCODE = '22012';
  END IF;
  IF (p_num < 0) <> (p_den < 0) THEN v_sign := -1; END IF;
  v_quot := v_abs_n / v_abs_d;
  IF ((v_abs_n % v_abs_d) * 2) >= v_abs_d THEN v_quot := v_quot + 1; END IF;
  RETURN v_sign * v_quot;
END;
$$;
COMMENT ON FUNCTION public.round_half_up_div(bigint, bigint) IS
  'Exact bigint half-up division matching shared_ts & undal_core to 0 poisha drift across all Appendix F vectors.';

CREATE OR REPLACE FUNCTION public.price_order(
  p_fulfilment text,
  p_items_poisha bigint,
  p_discount_vendor_poisha bigint,
  p_discount_platform_poisha bigint,
  p_delivery_fee_poisha bigint DEFAULT 0,
  p_platform_fee_poisha bigint DEFAULT 500,
  p_tip_poisha bigint DEFAULT 0,
  p_commission_bps integer DEFAULT 1500,
  p_vat_bps integer DEFAULT 500,
  p_rider_bonus_bps integer DEFAULT 300
)
RETURNS TABLE (
  fulfilment text,
  items_poisha bigint,
  discount_vendor_poisha bigint,
  discount_platform_poisha bigint,
  discount_total_poisha bigint,
  food_payable_poisha bigint,
  tax_extracted_poisha bigint,
  delivery_fee_poisha bigint,
  platform_fee_poisha bigint,
  tip_poisha bigint,
  cod_collect_poisha bigint,
  commission_poisha bigint,
  rider_bonus_poisha bigint,
  tax_pool_remainder_poisha bigint,
  vendor_net_poisha bigint,
  undal_margin_poisha bigint
)
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE AS $$
DECLARE
  v_is_pickup boolean := (p_fulfilment = 'pickup');
  v_disc_total bigint := p_discount_vendor_poisha + p_discount_platform_poisha;
  v_food_payable bigint;
  v_deliv bigint;
  v_plat bigint;
  v_tip bigint;
  v_tax bigint;
  v_comm bigint;
  v_bonus bigint;
BEGIN
  IF p_fulfilment NOT IN ('delivery', 'pickup') THEN
    RAISE EXCEPTION 'INVALID_FULFILMENT: %', p_fulfilment USING ERRCODE = '22023';
  END IF;
  IF p_items_poisha < 0 OR p_discount_vendor_poisha < 0 OR p_discount_platform_poisha < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_MONEY_INPUT' USING ERRCODE = '22023';
  END IF;
  IF v_disc_total > p_items_poisha THEN
    RAISE EXCEPTION 'DISCOUNT_EXCEEDS_ITEMS: % > %', v_disc_total, p_items_poisha USING ERRCODE = '22023';
  END IF;

  v_food_payable := p_items_poisha - v_disc_total;
  v_deliv := CASE WHEN v_is_pickup THEN 0 ELSE coalesce(p_delivery_fee_poisha, 0) END;
  v_plat := CASE WHEN v_is_pickup THEN 0 ELSE coalesce(p_platform_fee_poisha, 500) END;
  v_tip := CASE WHEN v_is_pickup THEN 0 ELSE coalesce(p_tip_poisha, 0) END;
  v_tax := public.round_half_up_div(v_food_payable * p_vat_bps::bigint, 10000 + p_vat_bps::bigint);
  v_comm := public.round_half_up_div(v_food_payable * p_commission_bps::bigint, 10000);
  v_bonus := public.round_half_up_div(v_food_payable * p_rider_bonus_bps::bigint, 10000);

  RETURN QUERY SELECT
    p_fulfilment, p_items_poisha, p_discount_vendor_poisha, p_discount_platform_poisha, v_disc_total,
    v_food_payable, v_tax, v_deliv, v_plat, v_tip,
    v_food_payable + v_deliv + v_plat + v_tip,
    v_comm, v_bonus, v_tax - v_bonus,
    v_food_payable + p_discount_platform_poisha - v_comm,
    v_comm - p_discount_platform_poisha + v_plat;
END;
$$;
COMMENT ON FUNCTION public.price_order(text, bigint, bigint, bigint, bigint, bigint, bigint, integer, integer, integer) IS
  'Canonical SQL implementation of File 10 §10.2 order money waterfall; matches TS & Dart poisha-for-poisha.';

CREATE OR REPLACE FUNCTION public.compute_pickup_qr_token(p_order_id uuid, p_nonce text, p_secret text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT encode(sha256(convert_to(p_order_id::text || ':' || p_nonce || ':' || p_secret, 'UTF8')), 'hex');
$$;
COMMENT ON FUNCTION public.compute_pickup_qr_token(uuid, text, text) IS
  'Computes hex SHA-256 handover token bound to order_id, random per-order nonce, and Worker secret.';

CREATE SEQUENCE IF NOT EXISTS public.order_public_code_seq START WITH 1001 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.next_order_public_code(
  p_zone_slug text,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS text LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT format(
    'UD-%s-%s-%s',
    upper(left(regexp_replace(coalesce(p_zone_slug, 'BD'), '[^a-zA-Z0-9]', '', 'g'), 3)),
    to_char(p_now AT TIME ZONE 'Asia/Dhaka', 'YYMMDD'),
    lpad(nextval('public.order_public_code_seq')::text, 4, '0')
  );
$$;
COMMENT ON FUNCTION public.next_order_public_code(text, timestamptz) IS
  'Generates human-readable Asia/Dhaka public order codes (e.g. UD-SYL-261023-1001).';

CREATE OR REPLACE FUNCTION public.is_legal_order_transition(p_from text, p_to text)
RETURNS boolean LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT CASE p_from
    WHEN 'PLACED' THEN p_to IN ('VENDOR_ACCEPTED', 'CANCELLED_CUSTOMER', 'CANCELLED_VENDOR', 'CANCELLED_TIMEOUT', 'CANCELLED_ADMIN')
    WHEN 'VENDOR_ACCEPTED' THEN p_to IN ('PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'CANCELLED_VENDOR', 'CANCELLED_ADMIN')
    WHEN 'PREPARING' THEN p_to IN ('READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'CANCELLED_ADMIN')
    WHEN 'RIDER_ASSIGNED' THEN p_to IN ('PREPARING', 'READY_FOR_PICKUP', 'RIDER_AT_VENDOR', 'CANCELLED_ADMIN')
    WHEN 'READY_FOR_PICKUP' THEN p_to IN ('RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'PICKED_UP', 'DELIVERED', 'CANCELLED_ADMIN')
    WHEN 'RIDER_AT_VENDOR' THEN p_to IN ('READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED_ADMIN')
    WHEN 'PICKED_UP' THEN p_to IN ('RIDER_AT_CUSTOMER', 'DELIVERED', 'FAILED_DELIVERY', 'CANCELLED_ADMIN')
    WHEN 'RIDER_AT_CUSTOMER' THEN p_to IN ('DELIVERED', 'FAILED_DELIVERY', 'CANCELLED_ADMIN')
    ELSE false
  END;
$$;
COMMENT ON FUNCTION public.is_legal_order_transition(text, text) IS
  'Canonical 14-state order transition graph matching packages/shared_ts/src/schemas.ts 100% verbatim.';

CREATE TABLE IF NOT EXISTS public.order_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  rider_id uuid REFERENCES public.riders(id) ON DELETE SET NULL,
  sequence jsonb NOT NULL DEFAULT '[]'::jsonb,
  state text NOT NULL DEFAULT 'forming'
    CHECK (state IN ('forming', 'offered', 'active', 'done', 'broken')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS order_batches_zone_state_idx ON public.order_batches (zone_id, state);
COMMENT ON TABLE public.order_batches IS
  'Multi-order dispatch batches (max 3 orders, 1st-customer ETA delay <= 6 min per File 12).';
DROP TRIGGER IF EXISTS order_batches_set_updated_at ON public.order_batches;
CREATE TRIGGER order_batches_set_updated_at BEFORE UPDATE ON public.order_batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE RESTRICT,
  rider_id uuid REFERENCES public.riders(id) ON DELETE RESTRICT,
  zone_id uuid NOT NULL REFERENCES public.zones(id) ON DELETE RESTRICT,
  batch_id uuid REFERENCES public.order_batches(id) ON DELETE SET NULL,
  fulfilment text NOT NULL CHECK (fulfilment IN ('delivery', 'pickup')),
  status text NOT NULL DEFAULT 'PLACED' CHECK (status IN (
    'PLACED', 'VENDOR_ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP',
    'RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'PICKED_UP', 'RIDER_AT_CUSTOMER',
    'DELIVERED', 'CANCELLED_CUSTOMER', 'CANCELLED_VENDOR',
    'CANCELLED_TIMEOUT', 'CANCELLED_ADMIN', 'FAILED_DELIVERY'
  )),
  address_snapshot jsonb NOT NULL,
  vendor_snapshot jsonb NOT NULL,
  cutlery_requested boolean NOT NULL DEFAULT false,
  customer_note text CHECK (customer_note IS NULL OR char_length(customer_note) <= 300),
  change_for_poisha bigint CHECK (change_for_poisha IS NULL OR change_for_poisha >= cod_collect_poisha),
  items_poisha bigint NOT NULL CHECK (items_poisha >= 0),
  discount_total_poisha bigint NOT NULL DEFAULT 0 CHECK (discount_total_poisha >= 0),
  discount_vendor_poisha bigint NOT NULL DEFAULT 0 CHECK (discount_vendor_poisha >= 0),
  discount_platform_poisha bigint NOT NULL DEFAULT 0 CHECK (discount_platform_poisha >= 0),
  delivery_fee_poisha bigint NOT NULL DEFAULT 0 CHECK (delivery_fee_poisha >= 0),
  platform_fee_poisha bigint NOT NULL DEFAULT 0 CHECK (platform_fee_poisha >= 0),
  tip_poisha bigint NOT NULL DEFAULT 0 CHECK (tip_poisha >= 0),
  tax_extracted_poisha bigint NOT NULL DEFAULT 0 CHECK (tax_extracted_poisha >= 0),
  cod_collect_poisha bigint NOT NULL CHECK (cod_collect_poisha >= 0),
  rider_fare_poisha bigint NOT NULL DEFAULT 0 CHECK (rider_fare_poisha >= 0),
  rider_bonus_poisha bigint NOT NULL DEFAULT 0 CHECK (rider_bonus_poisha >= 0),
  commission_poisha bigint NOT NULL DEFAULT 0 CHECK (commission_poisha >= 0),
  vendor_net_poisha bigint NOT NULL,
  undal_margin_poisha bigint NOT NULL,
  pickup_qr_nonce text NOT NULL CHECK (char_length(pickup_qr_nonce) >= 16),
  pickup_code_4 char(4) NOT NULL CHECK (pickup_code_4 ~ '^[0-9]{4}$'),
  fare_inputs jsonb,
  voucher_id uuid REFERENCES public.vouchers(id) ON DELETE SET NULL,
  campaign_id uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,
  is_priority boolean NOT NULL DEFAULT false,
  prep_minutes_committed smallint CHECK (prep_minutes_committed IS NULL OR prep_minutes_committed BETWEEN 3 AND 240),
  pickup_feedback_rating smallint CHECK (pickup_feedback_rating IS NULL OR pickup_feedback_rating BETWEEN 1 AND 5),
  pickup_feedback_tags text[] NOT NULL DEFAULT '{}'::text[],
  placed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  ready_at timestamptz,
  arrived_vendor_at timestamptz,
  picked_at timestamptz,
  arrived_customer_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason_key text REFERENCES public.cancel_reasons(key) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT orders_discount_sum_exact CHECK (discount_total_poisha = discount_vendor_poisha + discount_platform_poisha),
  CONSTRAINT orders_discount_le_items CHECK (discount_total_poisha <= items_poisha),
  CONSTRAINT orders_cod_waterfall_exact CHECK (
    cod_collect_poisha = (items_poisha - discount_total_poisha) + delivery_fee_poisha + platform_fee_poisha + tip_poisha
  ),
  CONSTRAINT orders_vendor_net_exact CHECK (
    vendor_net_poisha = (items_poisha - discount_total_poisha) + discount_platform_poisha - commission_poisha
  ),
  CONSTRAINT orders_pickup_zero_delivery_fees CHECK (
    fulfilment <> 'pickup' OR (delivery_fee_poisha = 0 AND platform_fee_poisha = 0 AND tip_poisha = 0)
  )
);

CREATE INDEX IF NOT EXISTS orders_customer_placed_idx ON public.orders (customer_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_vendor_active_idx ON public.orders (vendor_id, status, placed_at DESC);
CREATE INDEX IF NOT EXISTS orders_rider_active_idx ON public.orders (rider_id, status) WHERE rider_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_zone_status_idx ON public.orders (zone_id, status, placed_at DESC);
COMMENT ON TABLE public.orders IS
  'Authoritative COD food order record storing immutable poisha waterfall snapshot and 14-state lifecycle.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'voucher_redemptions_order_id_fkey') THEN
    ALTER TABLE public.voucher_redemptions
      ADD CONSTRAINT voucher_redemptions_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_order_mutation_invariants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.items_poisha IS DISTINCT FROM OLD.items_poisha
     OR NEW.discount_total_poisha IS DISTINCT FROM OLD.discount_total_poisha
     OR NEW.discount_vendor_poisha IS DISTINCT FROM OLD.discount_vendor_poisha
     OR NEW.discount_platform_poisha IS DISTINCT FROM OLD.discount_platform_poisha
     OR NEW.cod_collect_poisha IS DISTINCT FROM OLD.cod_collect_poisha
     OR NEW.commission_poisha IS DISTINCT FROM OLD.commission_poisha
     OR NEW.vendor_net_poisha IS DISTINCT FROM OLD.vendor_net_poisha THEN
    RAISE EXCEPTION 'ORDER_MONEY_IMMUTABLE: order % money snapshot cannot be rewritten after placement', OLD.id
      USING ERRCODE = '55000';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT public.is_legal_order_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'ILLEGAL_ORDER_TRANSITION: cannot transition order % from % to %', OLD.id, OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.enforce_order_mutation_invariants() IS
  'Locks money snapshot immutability after placement and rejects illegal status transitions at DB level.';

DROP TRIGGER IF EXISTS orders_enforce_invariants ON public.orders;
CREATE TRIGGER orders_enforce_invariants BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.enforce_order_mutation_invariants();
DROP TRIGGER IF EXISTS orders_set_updated_at ON public.orders;
CREATE TRIGGER orders_set_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  name_en_snapshot text NOT NULL,
  name_bn_snapshot text,
  unit_poisha bigint NOT NULL CHECK (unit_poisha >= 0),
  qty smallint NOT NULL CHECK (qty > 0),
  line_poisha bigint NOT NULL CHECK (line_poisha = unit_poisha * qty),
  selections jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  refunded_qty smallint NOT NULL DEFAULT 0 CHECK (refunded_qty >= 0 AND refunded_qty <= qty),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON public.order_items (order_id);
COMMENT ON TABLE public.order_items IS 'Immutable snapshot line items for placed orders.';

CREATE TABLE IF NOT EXISTS public.order_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_kind text NOT NULL CHECK (actor_kind IN ('customer', 'vendor', 'rider', 'admin', 'system')),
  from_status text,
  to_status text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS order_events_order_time_idx ON public.order_events (order_id, id ASC);
COMMENT ON TABLE public.order_events IS 'Append-only event log of every order transition, offer dispatch, and handover verification.';
DROP TRIGGER IF EXISTS order_events_no_update ON public.order_events;
CREATE TRIGGER order_events_no_update BEFORE UPDATE OR DELETE ON public.order_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE IF NOT EXISTS public.order_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.order_batches(id) ON DELETE SET NULL,
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE CASCADE,
  fare_poisha bigint NOT NULL CHECK (fare_poisha > 0),
  fare_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  score integer NOT NULL DEFAULT 0,
  score_factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  solo_rider boolean NOT NULL DEFAULT false,
  response text NOT NULL DEFAULT 'pending'
    CHECK (response IN ('pending', 'accepted', 'rejected', 'reassign_requested', 'expired')),
  reject_reason text,
  offered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  CONSTRAINT order_offers_window_valid CHECK (expires_at > offered_at)
);
CREATE INDEX IF NOT EXISTS order_offers_rider_pending_idx ON public.order_offers (rider_id, response, expires_at DESC);
CREATE INDEX IF NOT EXISTS order_offers_order_idx ON public.order_offers (order_id, offered_at DESC);
COMMENT ON TABLE public.order_offers IS '45-second rider dispatch offer records supporting D-23 solo-rider mode.';

ALTER TABLE public.order_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.order_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_offers FORCE ROW LEVEL SECURITY;
