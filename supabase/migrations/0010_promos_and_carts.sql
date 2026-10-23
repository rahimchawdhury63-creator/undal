-- =============================================================================
-- Migration: 0010_promos_and_carts.sql
-- Milestone: Build Response 4 (Migrations III — Campaigns, Vouchers, Carts & Idempotency)
-- Tables:    campaigns, campaign_vendors, vouchers, voucher_redemptions,
--            carts, cart_items, idempotency_keys
-- References: Master Guide File 10 (§10.2–10.3), File 16, D-11 (Flash Box split), Appendix B
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,80}$'),
  kind text NOT NULL CHECK (kind IN ('flash_box', 'vendor_promo', 'first_order', 'free_delivery')),
  title_en text NOT NULL CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 120),
  title_bn text NOT NULL CHECK (char_length(btrim(title_bn)) BETWEEN 2 AND 120),
  percent_bps integer CHECK (percent_bps IS NULL OR (percent_bps BETWEEN 100 AND 8000)),
  flat_poisha bigint CHECK (flat_poisha IS NULL OR flat_poisha >= 0),
  cap_poisha bigint CHECK (cap_poisha IS NULL OR cap_poisha >= 0),
  min_order_poisha bigint NOT NULL DEFAULT 0 CHECK (min_order_poisha >= 0),
  vendor_share_bps integer NOT NULL DEFAULT 10000 CHECK (vendor_share_bps BETWEEN 0 AND 10000),
  budget_cap_poisha bigint CHECK (budget_cap_poisha IS NULL OR budget_cap_poisha >= 0),
  budget_spent_poisha bigint NOT NULL DEFAULT 0 CHECK (budget_spent_poisha >= 0),
  zone_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  daily_start_time time,
  daily_end_time time,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT campaigns_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT campaigns_budget_ceiling CHECK (budget_cap_poisha IS NULL OR budget_spent_poisha <= budget_cap_poisha)
);

CREATE INDEX IF NOT EXISTS campaigns_active_window_idx
  ON public.campaigns (is_active, starts_at, ends_at);
COMMENT ON TABLE public.campaigns IS
  'Platform & Flash Box promotional campaigns with explicit vendor_share_bps split (D-11) and hard budget ceiling.';
DROP TRIGGER IF EXISTS campaigns_set_updated_at ON public.campaigns;
CREATE TRIGGER campaigns_set_updated_at BEFORE UPDATE ON public.campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.campaign_vendors (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  opted_in_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (campaign_id, vendor_id)
);
CREATE INDEX IF NOT EXISTS campaign_vendors_vendor_idx ON public.campaign_vendors (vendor_id, is_active);
COMMENT ON TABLE public.campaign_vendors IS
  'Explicit vendor opt-ins into campaigns (vendors are never auto-enrolled in discounts without consent per D-11).';

CREATE TABLE IF NOT EXISTS public.vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  title_en text NOT NULL CHECK (char_length(btrim(title_en)) BETWEEN 2 AND 120),
  title_bn text,
  kind text NOT NULL CHECK (kind IN ('percent', 'flat', 'free_delivery')),
  value_num bigint NOT NULL CHECK (value_num > 0),
  cap_poisha bigint CHECK (cap_poisha IS NULL OR cap_poisha > 0),
  min_order_poisha bigint NOT NULL DEFAULT 0 CHECK (min_order_poisha >= 0),
  max_uses_per_user smallint NOT NULL DEFAULT 1 CHECK (max_uses_per_user >= 1),
  first_order_only boolean NOT NULL DEFAULT false,
  vendor_share_bps integer NOT NULL DEFAULT 0 CHECK (vendor_share_bps BETWEEN 0 AND 10000),
  budget_cap_poisha bigint NOT NULL CHECK (budget_cap_poisha > 0),
  budget_spent_poisha bigint NOT NULL DEFAULT 0 CHECK (budget_spent_poisha >= 0),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT vouchers_window_valid CHECK (ends_at > starts_at),
  CONSTRAINT vouchers_budget_ceiling CHECK (budget_spent_poisha <= budget_cap_poisha),
  CONSTRAINT vouchers_percent_range CHECK (kind <> 'percent' OR value_num BETWEEN 100 AND 10000)
);

CREATE INDEX IF NOT EXISTS vouchers_active_window_idx ON public.vouchers (is_active, starts_at, ends_at);
COMMENT ON TABLE public.vouchers IS
  'Single-order promo codes (percent in bps, flat poisha, or free_delivery) with atomic budget_spent_poisha guard.';
DROP TRIGGER IF EXISTS vouchers_set_updated_at ON public.vouchers;
CREATE TRIGGER vouchers_set_updated_at BEFORE UPDATE ON public.vouchers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.voucher_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  discount_vendor_poisha bigint NOT NULL DEFAULT 0 CHECK (discount_vendor_poisha >= 0),
  discount_platform_poisha bigint NOT NULL DEFAULT 0 CHECK (discount_platform_poisha >= 0),
  delivery_waived_poisha bigint NOT NULL DEFAULT 0 CHECK (delivery_waived_poisha >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (voucher_id, order_id)
);
CREATE INDEX IF NOT EXISTS voucher_redemptions_user_idx ON public.voucher_redemptions (voucher_id, customer_id);
COMMENT ON TABLE public.voucher_redemptions IS
  'Immutable audit record of every redeemed voucher and its exact vendor/platform poisha funding split.';

CREATE TABLE IF NOT EXISTS public.carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  address_id uuid REFERENCES public.customer_addresses(id) ON DELETE SET NULL,
  fulfilment text NOT NULL DEFAULT 'delivery' CHECK (fulfilment IN ('delivery', 'pickup')),
  voucher_code text,
  tip_poisha bigint NOT NULL DEFAULT 0 CHECK (tip_poisha >= 0 AND tip_poisha <= 100000),
  cutlery_requested boolean NOT NULL DEFAULT false,
  customer_note text CHECK (customer_note IS NULL OR char_length(customer_note) <= 300),
  change_for_poisha bigint CHECK (change_for_poisha IS NULL OR change_for_poisha >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMENT ON TABLE public.carts IS
  'Single-vendor customer shopping cart (UNIQUE on customer_id enforces single active kitchen per basket).';
DROP TRIGGER IF EXISTS carts_set_updated_at ON public.carts;
CREATE TRIGGER carts_set_updated_at BEFORE UPDATE ON public.carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id uuid NOT NULL REFERENCES public.carts(id) ON DELETE CASCADE,
  menu_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  variant_id uuid REFERENCES public.variants(id) ON DELETE SET NULL,
  qty smallint NOT NULL DEFAULT 1 CHECK (qty BETWEEN 1 AND 50),
  selections jsonb NOT NULL DEFAULT '[]'::jsonb,
  unit_snapshot_poisha bigint NOT NULL CHECK (unit_snapshot_poisha >= 0),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS cart_items_cart_idx ON public.cart_items (cart_id);
COMMENT ON TABLE public.cart_items IS
  'Line items inside a customer cart; trigger enforces same-vendor membership against carts.vendor_id.';

CREATE OR REPLACE FUNCTION public.validate_cart_item_vendor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_cart_vendor uuid;
  v_item_vendor uuid;
  v_variant_item uuid;
BEGIN
  SELECT vendor_id INTO v_cart_vendor FROM public.carts WHERE id = NEW.cart_id;
  SELECT vendor_id INTO v_item_vendor FROM public.menu_items WHERE id = NEW.menu_item_id;
  IF v_cart_vendor IS DISTINCT FROM v_item_vendor THEN
    RAISE EXCEPTION 'CART_VENDOR_CONFLICT: menu_item % does not belong to cart vendor %', NEW.menu_item_id, v_cart_vendor
      USING ERRCODE = '23514';
  END IF;
  IF NEW.variant_id IS NOT NULL THEN
    SELECT vg.item_id INTO v_variant_item
    FROM public.variants AS v
    JOIN public.variant_groups AS vg ON vg.id = v.group_id
    WHERE v.id = NEW.variant_id;
    IF v_variant_item IS DISTINCT FROM NEW.menu_item_id THEN
      RAISE EXCEPTION 'INVALID_VARIANT: variant % does not belong to menu_item %', NEW.variant_id, NEW.menu_item_id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.validate_cart_item_vendor() IS
  'Prevents cross-vendor cart items (CART_VENDOR_CONFLICT) and cross-item variant selections.';

DROP TRIGGER IF EXISTS cart_items_validate_vendor ON public.cart_items;
CREATE TRIGGER cart_items_validate_vendor BEFORE INSERT OR UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_cart_item_vendor();
DROP TRIGGER IF EXISTS cart_items_set_updated_at ON public.cart_items;
CREATE TRIGGER cart_items_set_updated_at BEFORE UPDATE ON public.cart_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  actor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  key text NOT NULL CHECK (char_length(btrim(key)) BETWEEN 8 AND 128),
  route text NOT NULL CHECK (char_length(btrim(route)) BETWEEN 2 AND 120),
  request_hash text NOT NULL,
  status_code smallint NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + INTERVAL '24 hours'),
  PRIMARY KEY (actor_id, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expires_idx ON public.idempotency_keys (expires_at);
COMMENT ON TABLE public.idempotency_keys IS
  '24-hour idempotency replay store preventing duplicate COD order placement on flaky mobile networks.';

ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns FORCE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_vendors FORCE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_redemptions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys FORCE ROW LEVEL SECURITY;
