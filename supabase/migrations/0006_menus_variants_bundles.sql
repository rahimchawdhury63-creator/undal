-- =============================================================================
-- Migration: 0006_menus_variants_bundles.sql
-- Milestone: Build Response 3 (Migrations II — Menu Studio, Variants, Add-ons & Combos)
-- Tables:    menu_categories, menu_items, variant_groups, variants,
--            option_groups, options, bundle_slots, bundle_slot_choices
-- References: Master Guide File 05 (§5.1), File 10, File 17, Appendix B, D-08, ADR-0005
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. `public.menu_categories` (`regular` | `combo` per ADR-0005)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 100),
  name_bn text,
  description_en text,
  description_bn text,
  category_type text NOT NULL DEFAULT 'regular' CHECK (category_type IN ('regular', 'combo')),
  sort integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  schedule jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS menu_categories_vendor_sort_idx
  ON public.menu_categories (vendor_id, is_active, sort);

COMMENT ON TABLE public.menu_categories IS
  'Per-vendor menu categories supporting regular sections, combo sections, and optional daypart schedules.';

DROP TRIGGER IF EXISTS menu_categories_set_updated_at ON public.menu_categories;
CREATE TRIGGER menu_categories_set_updated_at
  BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. `public.menu_items` (Integer Poisha VAT-Inclusive Pricing — D-08)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_item_search_document(
  p_name_en text,
  p_name_bn text,
  p_desc_en text,
  p_desc_bn text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(concat_ws(' ', p_name_en, coalesce(p_name_bn, ''), coalesce(p_desc_en, ''), coalesce(p_desc_bn, '')));
$$;

COMMENT ON FUNCTION public.menu_item_search_document(text, text, text, text) IS
  'Immutable EN + Bengali dish text normalization document indexed via pg_trgm GIN.';

CREATE TABLE IF NOT EXISTS public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES public.menu_categories(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 140),
  name_bn text,
  description_en text,
  description_bn text,
  price_poisha bigint NOT NULL CHECK (price_poisha >= 0),
  compare_at_poisha bigint CHECK (compare_at_poisha IS NULL OR compare_at_poisha > price_poisha),
  image_url text,
  item_type text NOT NULL DEFAULT 'simple' CHECK (item_type IN ('simple', 'sized', 'bundle')),
  is_available boolean NOT NULL DEFAULT true,
  unavailable_until timestamptz,
  moderation_status text NOT NULL DEFAULT 'visible'
    CHECK (moderation_status IN ('visible', 'flagged', 'hidden')),
  spicy_level smallint NOT NULL DEFAULT 0 CHECK (spicy_level BETWEEN 0 AND 3),
  is_veg boolean NOT NULL DEFAULT false,
  halal boolean NOT NULL DEFAULT true,
  serves text,
  prep_weight smallint NOT NULL DEFAULT 1 CHECK (prep_weight BETWEEN 1 AND 20),
  sort integer NOT NULL DEFAULT 0,
  search_text text GENERATED ALWAYS AS (
    public.menu_item_search_document(name_en, name_bn, description_en, description_bn)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS menu_items_vendor_cat_sort_idx
  ON public.menu_items (vendor_id, category_id, sort)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS menu_items_search_trgm_idx
  ON public.menu_items USING gin (search_text gin_trgm_ops)
  WHERE deleted_at IS NULL AND moderation_status = 'visible';

COMMENT ON TABLE public.menu_items IS
  'VAT-inclusive integer-poisha dishes (simple, sized, or bundle/combo) with EN+BN trigram search.';

CREATE OR REPLACE FUNCTION public.validate_menu_item_ownership()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_cat_vendor uuid;
BEGIN
  SELECT vendor_id INTO v_cat_vendor FROM public.menu_categories WHERE id = NEW.category_id;
  IF v_cat_vendor IS DISTINCT FROM NEW.vendor_id THEN
    RAISE EXCEPTION 'CROSS_VENDOR_CATEGORY_MISMATCH: category % belongs to another vendor', NEW.category_id
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_menu_item_ownership() IS
  'Ensures menu_items.category_id always belongs to the exact same vendor_id.';

DROP TRIGGER IF EXISTS menu_items_validate_vendor ON public.menu_items;
CREATE TRIGGER menu_items_validate_vendor
  BEFORE INSERT OR UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_menu_item_ownership();

DROP TRIGGER IF EXISTS menu_items_set_updated_at ON public.menu_items;
CREATE TRIGGER menu_items_set_updated_at
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 3. `variant_groups` & `variants` (Portion/Size Variations)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.variant_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 80),
  name_bn text,
  min_select smallint NOT NULL DEFAULT 1 CHECK (min_select >= 0),
  max_select smallint NOT NULL DEFAULT 1 CHECK (max_select >= 1 AND max_select >= min_select),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS variant_groups_item_sort_idx
  ON public.variant_groups (item_id, sort);

COMMENT ON TABLE public.variant_groups IS
  'Portion/size selector groups attached to sized menu_items (e.g. Half / Full / Family Platter).';

DROP TRIGGER IF EXISTS variant_groups_set_updated_at ON public.variant_groups;
CREATE TRIGGER variant_groups_set_updated_at
  BEFORE UPDATE ON public.variant_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.variant_groups(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 80),
  name_bn text,
  price_delta_poisha bigint NOT NULL DEFAULT 0,
  is_available boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS variants_group_sort_idx
  ON public.variants (group_id, sort);

COMMENT ON TABLE public.variants IS
  'Individual size/portion choices with integer-poisha price delta relative to menu_items.price_poisha.';

DROP TRIGGER IF EXISTS variants_set_updated_at ON public.variants;
CREATE TRIGGER variants_set_updated_at
  BEFORE UPDATE ON public.variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 4. `option_groups` & `options` (Modifier/Add-on Groups with Internal Labels — ADR-0005)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.option_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id uuid NOT NULL REFERENCES public.vendors(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  internal_label text NOT NULL CHECK (char_length(btrim(internal_label)) BETWEEN 1 AND 100),
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 100),
  name_bn text,
  min_select smallint NOT NULL DEFAULT 0 CHECK (min_select >= 0),
  max_select smallint NOT NULL DEFAULT 1 CHECK (max_select >= 1 AND max_select >= min_select),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS option_groups_item_sort_idx
  ON public.option_groups (item_id, sort);

COMMENT ON TABLE public.option_groups IS
  'Modifier/add-on groups distinguishing kitchen internal_label from customer-facing EN/BN prompt (ADR-0005).';

DROP TRIGGER IF EXISTS option_groups_set_updated_at ON public.option_groups;
CREATE TRIGGER option_groups_set_updated_at
  BEFORE UPDATE ON public.option_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.option_groups(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 100),
  name_bn text,
  price_delta_poisha bigint NOT NULL DEFAULT 0 CHECK (price_delta_poisha >= 0),
  is_available boolean NOT NULL DEFAULT true,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS options_group_sort_idx
  ON public.options (group_id, sort);

COMMENT ON TABLE public.options IS
  'Individual modifier/add-on choices priced in non-negative integer poisha.';

DROP TRIGGER IF EXISTS options_set_updated_at ON public.options;
CREATE TRIGGER options_set_updated_at
  BEFORE UPDATE ON public.options
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 5. `bundle_slots` & `bundle_slot_choices` (Structured Combo Builder — ADR-0005)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bundle_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  name_en text NOT NULL CHECK (char_length(btrim(name_en)) BETWEEN 1 AND 100),
  name_bn text,
  min_pick smallint NOT NULL DEFAULT 1 CHECK (min_pick >= 0),
  max_pick smallint NOT NULL DEFAULT 1 CHECK (max_pick >= 1 AND max_pick >= min_pick),
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS bundle_slots_item_sort_idx
  ON public.bundle_slots (bundle_item_id, sort);

COMMENT ON TABLE public.bundle_slots IS
  'Configurable slot steps inside a combo/bundle menu_item (e.g. Choose 2 Burgers, Choose 2 Drinks).';

DROP TRIGGER IF EXISTS bundle_slots_set_updated_at ON public.bundle_slots;
CREATE TRIGGER bundle_slots_set_updated_at
  BEFORE UPDATE ON public.bundle_slots
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.bundle_slot_choices (
  slot_id uuid NOT NULL REFERENCES public.bundle_slots(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE RESTRICT,
  price_delta_poisha bigint NOT NULL DEFAULT 0,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (slot_id, item_id)
);

COMMENT ON TABLE public.bundle_slot_choices IS
  'Eligible menu_items selectable inside a bundle_slot, validated to belong to the same vendor.';

CREATE OR REPLACE FUNCTION public.validate_bundle_choice_same_vendor()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_bundle_vendor uuid;
  v_choice_vendor uuid;
BEGIN
  SELECT mi.vendor_id INTO v_bundle_vendor
  FROM public.bundle_slots AS bs
  JOIN public.menu_items AS mi ON mi.id = bs.bundle_item_id
  WHERE bs.id = NEW.slot_id;

  SELECT vendor_id INTO v_choice_vendor
  FROM public.menu_items
  WHERE id = NEW.item_id;

  IF v_bundle_vendor IS DISTINCT FROM v_choice_vendor THEN
    RAISE EXCEPTION 'CROSS_VENDOR_BUNDLE_CHOICE: bundle item and slot choice belong to different vendors'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.validate_bundle_choice_same_vendor() IS
  'Prevents linking dishes across different vendors inside a bundle_slot.';

DROP TRIGGER IF EXISTS bundle_slot_choices_same_vendor ON public.bundle_slot_choices;
CREATE TRIGGER bundle_slot_choices_same_vendor
  BEFORE INSERT OR UPDATE ON public.bundle_slot_choices
  FOR EACH ROW EXECUTE FUNCTION public.validate_bundle_choice_same_vendor();

-- Enable & Force Row-Level Security across all 8 tables in `0006`
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items FORCE ROW LEVEL SECURITY;
ALTER TABLE public.variant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variant_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.variants FORCE ROW LEVEL SECURITY;
ALTER TABLE public.option_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.option_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE public.options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.options FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_slots FORCE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_slot_choices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bundle_slot_choices FORCE ROW LEVEL SECURITY;
