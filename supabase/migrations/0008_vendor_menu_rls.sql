-- =============================================================================
-- Migration: 0008_vendor_menu_rls.sql
-- Milestone: Build Response 3 (Migrations II — Vendor, Privacy & Menu RLS Matrix)
-- Coverage:  All 15 tables from 0005 + 0006 (27 / 50 cumulative tables RLS-forced)
-- Key Security Invariants (`SEC-01`, `D-24`, `File 05 §5.2`, `File 15 §15.3`):
--   1. `anon` & `customer` have ZERO raw `SELECT` privilege on `public.vendors` —
--      public discovery flows strictly through `public_vendor_cards` & `0007` RPCs
--      so `HOME_KITCHEN` `address_text_private` and `counter_phone` NEVER leak.
--   2. `vendor_staff` (`manager` / `kitchen_staff`) operate orders/hours/pauses/menus
--      and have ZERO access to `vendor_payout_accounts` (`account_ref_enc`) or KYC docs.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Helper Functions for Vendor Ownership & Staff Membership Checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_vendor_owner(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vendors AS v
    WHERE v.id = p_vendor_id
      AND v.owner_profile_id = auth.uid()
      AND v.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.is_vendor_owner(uuid) IS
  'Returns true iff caller owns p_vendor_id.';

CREATE OR REPLACE FUNCTION public.is_vendor_operator(p_vendor_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT public.is_vendor_owner(p_vendor_id)
  OR EXISTS (
    SELECT 1
    FROM public.vendor_staff_members AS vsm
    WHERE vsm.vendor_id = p_vendor_id
      AND vsm.profile_id = auth.uid()
      AND vsm.is_active = true
  );
$$;

COMMENT ON FUNCTION public.is_vendor_operator(uuid) IS
  'Returns true iff caller is owner or active staff member of p_vendor_id.';

-- -----------------------------------------------------------------------------
-- 2. Explicit Least-Privilege Grants (`anon`, `authenticated`, `service_role`)
-- -----------------------------------------------------------------------------
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;

-- Public read strictly via `public_vendor_cards` view + active zones + visible menu tables (NEVER raw `vendors`!)
GRANT SELECT ON public.public_vendor_cards TO anon, authenticated;
GRANT SELECT ON public.zones, public.vendor_hours TO anon, authenticated;
GRANT SELECT ON
  public.menu_categories, public.menu_items,
  public.variant_groups, public.variants,
  public.option_groups, public.options,
  public.bundle_slots, public.bundle_slot_choices
TO anon, authenticated;

-- Authenticated operators & admins (filtered row-by-row via RLS below)
GRANT SELECT, INSERT, UPDATE ON public.vendors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.zones,
  public.vendor_staff_members,
  public.vendor_hours,
  public.vendor_pauses,
  public.vendor_documents,
  public.vendor_payout_accounts,
  public.menu_categories,
  public.menu_items,
  public.variant_groups,
  public.variants,
  public.option_groups,
  public.options,
  public.bundle_slots,
  public.bundle_slot_choices
TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. RLS Policies — `zones` & `vendors` subtree (`0005` — 7 Tables)
-- -----------------------------------------------------------------------------

-- 3.1 `public.zones`
DROP POLICY IF EXISTS zones_service_all ON public.zones;
CREATE POLICY zones_service_all ON public.zones
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS zones_public_active_read ON public.zones;
CREATE POLICY zones_public_active_read ON public.zones
  FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('3.zones'));

DROP POLICY IF EXISTS zones_admin_manage ON public.zones;
CREATE POLICY zones_admin_manage ON public.zones
  FOR ALL TO authenticated
  USING (public.has_admin_permission('3.zones'))
  WITH CHECK (public.has_admin_permission('3.zones'));

-- 3.2 `public.vendors` (NO `anon` or arbitrary `customer` read — protects `address_text_private`!)
DROP POLICY IF EXISTS vendors_service_all ON public.vendors;
CREATE POLICY vendors_service_all ON public.vendors
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendors_operator_or_admin_read ON public.vendors;
CREATE POLICY vendors_operator_or_admin_read ON public.vendors
  FOR SELECT TO authenticated
  USING (
    public.is_vendor_operator(id)
    OR public.has_admin_permission('4.vendor_360')
    OR public.has_admin_permission('4.pipeline')
    OR public.has_admin_permission('6.order_360')
  );

DROP POLICY IF EXISTS vendors_owner_apply_insert ON public.vendors;
CREATE POLICY vendors_owner_apply_insert ON public.vendors
  FOR INSERT TO authenticated
  WITH CHECK (
    (owner_profile_id = auth.uid() AND kyc_status IN ('draft', 'submitted') AND is_active = false)
    OR public.has_admin_permission('4.pipeline')
  );

DROP POLICY IF EXISTS vendors_owner_or_admin_update ON public.vendors;
CREATE POLICY vendors_owner_or_admin_update ON public.vendors
  FOR UPDATE TO authenticated
  USING (public.is_vendor_owner(id) OR public.has_admin_permission('4.vendor_360') OR public.has_admin_permission('4.pipeline'))
  WITH CHECK (public.is_vendor_owner(id) OR public.has_admin_permission('4.vendor_360') OR public.has_admin_permission('4.pipeline'));

-- 3.3 `public.vendor_staff_members`
DROP POLICY IF EXISTS vendor_staff_service_all ON public.vendor_staff_members;
CREATE POLICY vendor_staff_service_all ON public.vendor_staff_members
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_staff_read ON public.vendor_staff_members;
CREATE POLICY vendor_staff_read ON public.vendor_staff_members
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid() OR public.is_vendor_owner(vendor_id) OR public.has_admin_permission('4.vendor_360'));

DROP POLICY IF EXISTS vendor_staff_owner_manage ON public.vendor_staff_members;
CREATE POLICY vendor_staff_owner_manage ON public.vendor_staff_members
  FOR ALL TO authenticated
  USING (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('4.vendor_360'))
  WITH CHECK (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('4.vendor_360'));

-- 3.4 `public.vendor_hours` & `public.vendor_pauses`
DROP POLICY IF EXISTS vendor_hours_service_all ON public.vendor_hours;
CREATE POLICY vendor_hours_service_all ON public.vendor_hours
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_hours_public_read ON public.vendor_hours;
CREATE POLICY vendor_hours_public_read ON public.vendor_hours
  FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.vendors AS v
      WHERE v.id = vendor_hours.vendor_id AND v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL
    )
    OR public.is_vendor_operator(vendor_id)
    OR public.has_admin_permission('4.vendor_360')
  );

DROP POLICY IF EXISTS vendor_hours_operator_manage ON public.vendor_hours;
CREATE POLICY vendor_hours_operator_manage ON public.vendor_hours
  FOR ALL TO authenticated
  USING (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.vendor_360'))
  WITH CHECK (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.vendor_360'));

DROP POLICY IF EXISTS vendor_pauses_service_all ON public.vendor_pauses;
CREATE POLICY vendor_pauses_service_all ON public.vendor_pauses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_pauses_operator_manage ON public.vendor_pauses;
CREATE POLICY vendor_pauses_operator_manage ON public.vendor_pauses
  FOR ALL TO authenticated
  USING (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.vendor_360'))
  WITH CHECK (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.vendor_360'));

-- 3.5 `public.vendor_documents` & `public.vendor_payout_accounts` (STRICT OWNER / KYC / FINANCE ONLY)
DROP POLICY IF EXISTS vendor_documents_service_all ON public.vendor_documents;
CREATE POLICY vendor_documents_service_all ON public.vendor_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_documents_owner_read_insert ON public.vendor_documents;
CREATE POLICY vendor_documents_owner_read_insert ON public.vendor_documents
  FOR SELECT TO authenticated
  USING (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('4.pipeline'));

DROP POLICY IF EXISTS vendor_documents_owner_upload ON public.vendor_documents;
CREATE POLICY vendor_documents_owner_upload ON public.vendor_documents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_vendor_owner(vendor_id) AND review_status = 'pending');

DROP POLICY IF EXISTS vendor_documents_admin_review ON public.vendor_documents;
CREATE POLICY vendor_documents_admin_review ON public.vendor_documents
  FOR UPDATE TO authenticated
  USING (public.has_admin_permission('4.pipeline'))
  WITH CHECK (public.has_admin_permission('4.pipeline'));

DROP POLICY IF EXISTS vendor_payout_service_all ON public.vendor_payout_accounts;
CREATE POLICY vendor_payout_service_all ON public.vendor_payout_accounts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS vendor_payout_owner_or_finance_read ON public.vendor_payout_accounts;
CREATE POLICY vendor_payout_owner_or_finance_read ON public.vendor_payout_accounts
  FOR SELECT TO authenticated
  USING (
    public.is_vendor_owner(vendor_id)
    OR public.has_admin_permission('4.pipeline')
    OR public.has_admin_permission('5.invoices')
  );

DROP POLICY IF EXISTS vendor_payout_owner_manage ON public.vendor_payout_accounts;
CREATE POLICY vendor_payout_owner_manage ON public.vendor_payout_accounts
  FOR ALL TO authenticated
  USING (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('5.invoices'))
  WITH CHECK (public.is_vendor_owner(vendor_id) OR public.has_admin_permission('5.invoices'));

-- -----------------------------------------------------------------------------
-- 4. RLS Policies — Menu Studio Tables (`0006` — 8 Tables)
-- -----------------------------------------------------------------------------

-- 4.1 `menu_categories` & `menu_items`
DROP POLICY IF EXISTS menu_categories_service_all ON public.menu_categories;
CREATE POLICY menu_categories_service_all ON public.menu_categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS menu_categories_public_read ON public.menu_categories;
CREATE POLICY menu_categories_public_read ON public.menu_categories
  FOR SELECT TO anon, authenticated
  USING (
    (is_active = true AND EXISTS (
      SELECT 1 FROM public.vendors AS v
      WHERE v.id = menu_categories.vendor_id AND v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL
    ))
    OR public.is_vendor_operator(vendor_id)
    OR public.has_admin_permission('4.menu_moderation')
  );

DROP POLICY IF EXISTS menu_categories_operator_manage ON public.menu_categories;
CREATE POLICY menu_categories_operator_manage ON public.menu_categories
  FOR ALL TO authenticated
  USING (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  WITH CHECK (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'));

DROP POLICY IF EXISTS menu_items_service_all ON public.menu_items;
CREATE POLICY menu_items_service_all ON public.menu_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS menu_items_public_visible_read ON public.menu_items;
CREATE POLICY menu_items_public_visible_read ON public.menu_items
  FOR SELECT TO anon, authenticated
  USING (
    (deleted_at IS NULL AND moderation_status = 'visible' AND EXISTS (
      SELECT 1 FROM public.vendors AS v
      WHERE v.id = menu_items.vendor_id AND v.is_active = true AND v.kyc_status = 'approved' AND v.deleted_at IS NULL
    ))
    OR public.is_vendor_operator(vendor_id)
    OR public.has_admin_permission('4.menu_moderation')
  );

DROP POLICY IF EXISTS menu_items_operator_manage ON public.menu_items;
CREATE POLICY menu_items_operator_manage ON public.menu_items
  FOR ALL TO authenticated
  USING (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  WITH CHECK (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'));

-- 4.2 `variant_groups`, `variants`, `option_groups`, `options`, `bundle_slots`, `bundle_slot_choices`
DROP POLICY IF EXISTS variant_groups_service_all ON public.variant_groups;
CREATE POLICY variant_groups_service_all ON public.variant_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS variant_groups_read_and_manage ON public.variant_groups;
CREATE POLICY variant_groups_read_and_manage ON public.variant_groups
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items AS mi WHERE mi.id = variant_groups.item_id));

DROP POLICY IF EXISTS variant_groups_operator_write ON public.variant_groups;
CREATE POLICY variant_groups_operator_write ON public.variant_groups
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menu_items AS mi
    WHERE mi.id = variant_groups.item_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.menu_items AS mi
    WHERE mi.id = variant_groups.item_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ));

DROP POLICY IF EXISTS variants_service_all ON public.variants;
CREATE POLICY variants_service_all ON public.variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS variants_read ON public.variants;
CREATE POLICY variants_read ON public.variants
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.variant_groups AS vg WHERE vg.id = variants.group_id));

DROP POLICY IF EXISTS variants_operator_write ON public.variants;
CREATE POLICY variants_operator_write ON public.variants
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.variant_groups AS vg
    JOIN public.menu_items AS mi ON mi.id = vg.item_id
    WHERE vg.id = variants.group_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.variant_groups AS vg
    JOIN public.menu_items AS mi ON mi.id = vg.item_id
    WHERE vg.id = variants.group_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ));

DROP POLICY IF EXISTS option_groups_service_all ON public.option_groups;
CREATE POLICY option_groups_service_all ON public.option_groups
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS option_groups_read ON public.option_groups;
CREATE POLICY option_groups_read ON public.option_groups
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items AS mi WHERE mi.id = option_groups.item_id));

DROP POLICY IF EXISTS option_groups_operator_write ON public.option_groups;
CREATE POLICY option_groups_operator_write ON public.option_groups
  FOR ALL TO authenticated
  USING (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  WITH CHECK (public.is_vendor_operator(vendor_id) OR public.has_admin_permission('4.menu_moderation'));

DROP POLICY IF EXISTS options_service_all ON public.options;
CREATE POLICY options_service_all ON public.options
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS options_read ON public.options;
CREATE POLICY options_read ON public.options
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.option_groups AS og WHERE og.id = options.group_id));

DROP POLICY IF EXISTS options_operator_write ON public.options;
CREATE POLICY options_operator_write ON public.options
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.option_groups AS og
    WHERE og.id = options.group_id
      AND (public.is_vendor_operator(og.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.option_groups AS og
    WHERE og.id = options.group_id
      AND (public.is_vendor_operator(og.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ));

DROP POLICY IF EXISTS bundle_slots_service_all ON public.bundle_slots;
CREATE POLICY bundle_slots_service_all ON public.bundle_slots
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bundle_slots_read ON public.bundle_slots;
CREATE POLICY bundle_slots_read ON public.bundle_slots
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.menu_items AS mi WHERE mi.id = bundle_slots.bundle_item_id));

DROP POLICY IF EXISTS bundle_slots_operator_write ON public.bundle_slots;
CREATE POLICY bundle_slots_operator_write ON public.bundle_slots
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menu_items AS mi
    WHERE mi.id = bundle_slots.bundle_item_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.menu_items AS mi
    WHERE mi.id = bundle_slots.bundle_item_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ));

DROP POLICY IF EXISTS bundle_slot_choices_service_all ON public.bundle_slot_choices;
CREATE POLICY bundle_slot_choices_service_all ON public.bundle_slot_choices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS bundle_slot_choices_read ON public.bundle_slot_choices;
CREATE POLICY bundle_slot_choices_read ON public.bundle_slot_choices
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.bundle_slots AS bs WHERE bs.id = bundle_slot_choices.slot_id));

DROP POLICY IF EXISTS bundle_slot_choices_operator_write ON public.bundle_slot_choices;
CREATE POLICY bundle_slot_choices_operator_write ON public.bundle_slot_choices
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bundle_slots AS bs
    JOIN public.menu_items AS mi ON mi.id = bs.bundle_item_id
    WHERE bs.id = bundle_slot_choices.slot_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.bundle_slots AS bs
    JOIN public.menu_items AS mi ON mi.id = bs.bundle_item_id
    WHERE bs.id = bundle_slot_choices.slot_id
      AND (public.is_vendor_operator(mi.vendor_id) OR public.has_admin_permission('4.menu_moderation'))
  ));
