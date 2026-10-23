-- =============================================================================
-- Migration: 0016_settlement_and_cron_rpcs.sql
-- Milestone: Build Response 5 (Migrations IV — Final Settlement, Cash Gate & RLS Completion)
-- Functions: sync_rider_cash_gate, record_order_delivered_ledger,
--            submit_cash_remittance, decide_cash_remittance,
--            generate_weekly_invoices, verify_and_pay_invoice
-- RLS:       Full grants & policies across 0013..0015 (19 new tables -> 62/62 cumulative tables!)
-- References: Master Guide File 10 (§10.4–10.5), File 23 (§23.1–23.5), D-06, ADR-0006
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START WITH 1001 INCREMENT BY 1;

-- 1. Idempotent Double-Checked Order Completion Ledger Writer (`File 10 §10.4`)
CREATE OR REPLACE FUNCTION public.record_order_delivered_ledger(
  p_order_id uuid,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ord public.orders%ROWTYPE;
  v_vendor_sum bigint;
  v_undal_sum bigint;
  v_gate jsonb := NULL;
BEGIN
  SELECT * INTO v_ord FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND OR v_ord.status <> 'DELIVERED' THEN
    RAISE EXCEPTION 'LEDGER_ORDER_NOT_DELIVERED: order % must be DELIVERED', p_order_id USING ERRCODE = '55000';
  END IF;

  -- Idempotency check: if already booked, return summary without duplicating ledger rows
  IF EXISTS (SELECT 1 FROM public.ledger_entries WHERE order_id = p_order_id AND kind = 'vendor_payable') THEN
    IF v_ord.fulfilment = 'delivery' AND v_ord.rider_id IS NOT NULL THEN
      v_gate := public.sync_rider_cash_gate(v_ord.rider_id);
    END IF;
    RETURN jsonb_build_object('order_id', p_order_id, 'already_recorded', true, 'cash_gate', v_gate);
  END IF;

  INSERT INTO public.ledger_entries (actor_type, actor_id, order_id, kind, amount_poisha, memo, created_at) VALUES
    ('vendor', v_ord.vendor_id, p_order_id, 'vendor_payable',
     (v_ord.items_poisha - v_ord.discount_total_poisha) + v_ord.discount_platform_poisha,
     format('Order %s food payable + Undal subsidy reimbursement', v_ord.public_code), p_now),
    ('vendor', v_ord.vendor_id, p_order_id, 'commission',
     -v_ord.commission_poisha,
     format('Order %s Undal food commission', v_ord.public_code), p_now),
    ('undal', NULL, p_order_id, 'commission',
     v_ord.commission_poisha,
     format('Order %s Undal commission revenue', v_ord.public_code), p_now);

  IF v_ord.discount_platform_poisha > 0 THEN
    INSERT INTO public.ledger_entries (actor_type, actor_id, order_id, kind, amount_poisha, memo, created_at)
    VALUES ('undal', NULL, p_order_id, 'discount_fund', -v_ord.discount_platform_poisha,
            format('Order %s Undal-funded discount subsidy', v_ord.public_code), p_now);
  END IF;

  IF v_ord.fulfilment = 'delivery' AND v_ord.rider_id IS NOT NULL THEN
    INSERT INTO public.ledger_entries (actor_type, actor_id, order_id, kind, amount_poisha, memo, created_at) VALUES
      ('rider', v_ord.rider_id, p_order_id, 'rider_fare', v_ord.rider_fare_poisha,
       format('Order %s dynamic delivery fare', v_ord.public_code), p_now),
      ('rider', v_ord.rider_id, p_order_id, 'rider_bonus', v_ord.rider_bonus_poisha,
       format('Order %s 3%% food-value bonus', v_ord.public_code), p_now),
      ('rider', v_ord.rider_id, p_order_id, 'cod_liability', -v_ord.cod_collect_poisha,
       format('Order %s COD cash collected from customer', v_ord.public_code), p_now);

    IF v_ord.tip_poisha > 0 THEN
      INSERT INTO public.ledger_entries (actor_type, actor_id, order_id, kind, amount_poisha, memo, created_at)
      VALUES ('rider', v_ord.rider_id, p_order_id, 'tip', v_ord.tip_poisha,
              format('Order %s 100%% customer cash tip', v_ord.public_code), p_now);
    END IF;
    v_gate := public.sync_rider_cash_gate(v_ord.rider_id);
  END IF;

  -- Self-auditing zero-drift assertion directly inside transaction
  SELECT sum(amount_poisha) INTO v_vendor_sum FROM public.ledger_entries WHERE order_id = p_order_id AND actor_type = 'vendor';
  SELECT sum(amount_poisha) INTO v_undal_sum FROM public.ledger_entries WHERE order_id = p_order_id AND actor_type = 'undal';
  IF v_vendor_sum <> v_ord.vendor_net_poisha OR v_undal_sum <> (v_ord.commission_poisha - v_ord.discount_platform_poisha) THEN
    RAISE EXCEPTION 'LEDGER_CONSERVATION_ERROR on order %', p_order_id USING ERRCODE = '55000';
  END IF;

  RETURN jsonb_build_object(
    'order_id', p_order_id, 'already_recorded', false,
    'vendor_net_poisha', v_vendor_sum, 'undal_net_poisha', v_undal_sum, 'cash_gate', v_gate
  );
END;
$$;
COMMENT ON FUNCTION public.record_order_delivered_ledger(uuid, timestamptz) IS
  'Writes exact append-only ledger entries matching packages/shared_ts buildOrderLedgerEntries() to 0 poisha drift and updates cash gate.';

CREATE OR REPLACE FUNCTION public.trigger_book_delivered_ledger()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.record_order_delivered_ledger(NEW.id, coalesce(NEW.delivered_at, clock_timestamp()));
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.trigger_book_delivered_ledger() IS
  'Guarantees ACID ledger booking + cash-gate sync inside the same transaction as status -> DELIVERED.';

DROP TRIGGER IF EXISTS orders_auto_book_delivered_ledger ON public.orders;
CREATE TRIGGER orders_auto_book_delivered_ledger
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'DELIVERED' AND OLD.status IS DISTINCT FROM 'DELIVERED')
  EXECUTE FUNCTION public.trigger_book_delivered_ledger();

-- 3. Rider Cash Remittance Submission & Finance Verification RPCs (`File 23 §23.2–23.3`)
CREATE OR REPLACE FUNCTION public.submit_cash_remittance(
  p_rider_id uuid,
  p_method text,
  p_amount_poisha bigint,
  p_bkash_trxid text,
  p_sender_number text,
  p_screenshot_public_id text,
  p_sender_name text DEFAULT NULL,
  p_selfie_public_id text DEFAULT NULL
)
RETURNS public.rider_cash_remittances LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.rider_cash_remittances%ROWTYPE;
BEGIN
  INSERT INTO public.rider_cash_remittances (
    rider_id, method, amount_poisha, bkash_trxid, sender_number, sender_name, screenshot_public_id, selfie_public_id
  )
  VALUES (
    p_rider_id, p_method, p_amount_poisha, upper(btrim(p_bkash_trxid)),
    p_sender_number, p_sender_name, p_screenshot_public_id, p_selfie_public_id
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
COMMENT ON FUNCTION public.submit_cash_remittance(uuid, text, bigint, text, text, text, text, text) IS
  'Submits a Rider bKash/Nagad/Bank COD remittance with Cloudinary authenticated proof public_id and unique TrxID guard.';

CREATE OR REPLACE FUNCTION public.decide_cash_remittance(
  p_remittance_id uuid,
  p_reviewer_id uuid,
  p_decision text,
  p_verified_amount_poisha bigint DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_request_id text DEFAULT 'sql-rpc',
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rem public.rider_cash_remittances%ROWTYPE;
  v_credited bigint := 0;
  v_gate jsonb;
BEGIN
  SELECT * INTO v_rem FROM public.rider_cash_remittances WHERE id = p_remittance_id FOR UPDATE;
  IF NOT FOUND OR v_rem.state <> 'pending' THEN
    RAISE EXCEPTION 'REMITTANCE_NOT_PENDING: %', p_remittance_id USING ERRCODE = '55000';
  END IF;
  IF p_decision NOT IN ('verified', 'partial', 'rejected') THEN
    RAISE EXCEPTION 'INVALID_REMITTANCE_DECISION: %', p_decision USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'verified' THEN
    v_credited := v_rem.amount_poisha;
  ELSIF p_decision = 'partial' THEN
    IF p_verified_amount_poisha IS NULL OR p_verified_amount_poisha <= 0 OR p_verified_amount_poisha >= v_rem.amount_poisha THEN
      RAISE EXCEPTION 'PARTIAL_AMOUNT_INVALID' USING ERRCODE = '22023';
    END IF;
    v_credited := p_verified_amount_poisha;
  END IF;

  UPDATE public.rider_cash_remittances SET
    state = p_decision,
    verified_amount_poisha = v_credited,
    reviewer_id = p_reviewer_id,
    review_note = p_note,
    reviewed_at = p_now
  WHERE id = p_remittance_id
  RETURNING * INTO v_rem;

  IF v_credited > 0 THEN
    INSERT INTO public.ledger_entries (actor_type, actor_id, remittance_id, kind, amount_poisha, memo, created_at)
    VALUES ('rider', v_rem.rider_id, v_rem.id, 'remittance', v_credited,
            format('Verified %s remittance TrxID %s', v_rem.method, v_rem.bkash_trxid), p_now);
  END IF;

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, diff, reason, request_id)
  VALUES (
    p_reviewer_id, 'admin', 'remittance.' || p_decision, 'rider_cash_remittance', v_rem.id::text,
    jsonb_build_object('claimed_poisha', v_rem.amount_poisha, 'verified_poisha', v_credited, 'trxid', v_rem.bkash_trxid),
    p_note, p_request_id
  );

  v_gate := public.sync_rider_cash_gate(v_rem.rider_id);
  RETURN jsonb_build_object('remittance_id', v_rem.id, 'state', v_rem.state, 'verified_amount_poisha', v_credited, 'cash_gate', v_gate);
END;
$$;
COMMENT ON FUNCTION public.decide_cash_remittance(uuid, uuid, text, bigint, text, text, timestamptz) IS
  'Approves (full/partial) or rejects a Rider COD cash remittance, books immutable ledger credit, logs audit, and refreshes cash gate.';

-- 4. Dual-Path Idempotent Weekly Invoice Generator (`D-06` Cron + Lazy Read, `File 10 §10.5`, `File 23 §23.1`)
CREATE OR REPLACE FUNCTION public.generate_weekly_invoices(
  p_payee_type text,
  p_period_start date,
  p_period_end date,
  p_cashout_fee_bps integer DEFAULT 185,
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS SETOF public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_start_ts timestamptz := (p_period_start::timestamp AT TIME ZONE 'Asia/Dhaka');
  v_end_excl_ts timestamptz := ((p_period_end + 1)::timestamp AT TIME ZONE 'Asia/Dhaka');
  v_rec record;
  v_inv public.invoices%ROWTYPE;
  v_fee bigint;
  v_code text;
BEGIN
  IF p_payee_type NOT IN ('vendor', 'rider') THEN
    RAISE EXCEPTION 'INVALID_PAYEE_TYPE: %', p_payee_type USING ERRCODE = '22023';
  END IF;

  -- Book any confirmed un-invoiced adjustments into ledger_entries first
  INSERT INTO public.ledger_entries (actor_type, actor_id, adjustment_id, kind, amount_poisha, memo, created_at)
  SELECT
    pa.target_type, pa.target_id, pa.id, 'adjustment', pa.amount_poisha,
    format('Confirmed %s (%s)', pa.kind, pa.reason_code), p_now
  FROM public.penalties_adjustments AS pa
  WHERE pa.target_type = p_payee_type
    AND pa.state = 'confirmed'
    AND NOT EXISTS (SELECT 1 FROM public.ledger_entries AS le WHERE le.adjustment_id = pa.id);

  FOR v_rec IN
    SELECT
      le.actor_id AS payee_id,
      coalesce(sum(le.amount_poisha) FILTER (WHERE le.amount_poisha > 0), 0)::bigint AS gross_poisha,
      coalesce(sum(-le.amount_poisha) FILTER (WHERE le.amount_poisha < 0 AND le.kind <> 'adjustment'), 0)::bigint AS deductions_poisha,
      coalesce(sum(le.amount_poisha) FILTER (WHERE le.kind = 'adjustment'), 0)::bigint AS adjustments_poisha,
      coalesce(sum(le.amount_poisha), 0)::bigint AS net_poisha
    FROM public.ledger_entries AS le
    WHERE le.actor_type = p_payee_type
      AND le.actor_id IS NOT NULL
      AND le.kind <> 'payout'
      AND NOT EXISTS (SELECT 1 FROM public.invoice_lines AS il WHERE il.ledger_entry_id = le.id)
      AND le.created_at >= v_start_ts AND le.created_at < v_end_excl_ts
    GROUP BY le.actor_id
  LOOP
    SELECT * INTO v_inv FROM public.invoices
    WHERE period_start = p_period_start AND payee_type = p_payee_type AND payee_id = v_rec.payee_id;

    IF NOT FOUND THEN
      v_fee := CASE
        WHEN v_rec.net_poisha > 0 THEN public.round_half_up_div(v_rec.net_poisha * p_cashout_fee_bps::bigint, 10000)
        ELSE 0
      END;
      v_code := format(
        'INV-%s-%s-%s',
        CASE WHEN p_payee_type = 'vendor' THEN 'V' ELSE 'R' END,
        to_char(p_period_start, 'YYYYMMDD'),
        lpad(nextval('public.invoice_number_seq')::text, 4, '0')
      );

      INSERT INTO public.invoices (
        invoice_number, payee_type, payee_id, period_start, period_end,
        gross_poisha, deductions_poisha, adjustments_poisha, net_payable_poisha,
        cashout_fee_cover_poisha, total_disbursed_poisha
      ) VALUES (
        v_code, p_payee_type, v_rec.payee_id, p_period_start, p_period_end,
        v_rec.gross_poisha, v_rec.deductions_poisha, v_rec.adjustments_poisha, v_rec.net_poisha,
        v_fee, CASE WHEN v_rec.net_poisha > 0 THEN v_rec.net_poisha + v_fee ELSE 0 END
      ) RETURNING * INTO v_inv;

      INSERT INTO public.invoice_lines (invoice_id, order_id, ledger_entry_id, line_kind, label_en, amount_poisha, sort)
      SELECT v_inv.id, le.order_id, le.id, le.kind, le.memo, le.amount_poisha, row_number() OVER (ORDER BY le.id)
      FROM public.ledger_entries AS le
      WHERE le.actor_type = p_payee_type AND le.actor_id = v_rec.payee_id
        AND le.kind <> 'payout'
        AND NOT EXISTS (SELECT 1 FROM public.invoice_lines AS il WHERE il.ledger_entry_id = le.id)
        AND le.created_at >= v_start_ts AND le.created_at < v_end_excl_ts;
    END IF;
  END LOOP;

  -- Single clean return set across newly-generated + previously-generated invoices (`D-06` idempotency)
  RETURN QUERY
  SELECT * FROM public.invoices
  WHERE payee_type = p_payee_type AND period_start = p_period_start
  ORDER BY created_at ASC;
END;
$$;
COMMENT ON FUNCTION public.generate_weekly_invoices(text, date, date, integer, timestamptz) IS
  'Idempotent weekly settlement invoice generator (Riders Friday, Vendors Saturday per D-06 & File 23 §23.1).';

-- 5. Spot-Recompute Verification & Payout Execution RPC (`GENERATED -> VERIFIED -> PAID`)
CREATE OR REPLACE FUNCTION public.verify_and_pay_invoice(
  p_invoice_id uuid,
  p_actor_id uuid,
  p_action text,
  p_payout_method text DEFAULT 'bkash',
  p_payout_txn_ref text DEFAULT NULL,
  p_payout_proof_public_id text DEFAULT NULL,
  p_pdf_public_id text DEFAULT NULL,
  p_request_id text DEFAULT 'sql-rpc',
  p_now timestamptz DEFAULT clock_timestamp()
)
RETURNS public.invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_inv public.invoices%ROWTYPE;
  v_lines_sum bigint;
BEGIN
  SELECT * INTO v_inv FROM public.invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INVOICE_NOT_FOUND: %', p_invoice_id USING ERRCODE = 'P0002'; END IF;

  SELECT coalesce(sum(amount_poisha), 0) INTO v_lines_sum FROM public.invoice_lines WHERE invoice_id = p_invoice_id;
  IF v_lines_sum <> v_inv.net_payable_poisha THEN
    RAISE EXCEPTION 'INVOICE_LEDGER_MISMATCH: lines sum % <> header net %', v_lines_sum, v_inv.net_payable_poisha
      USING ERRCODE = '55000';
  END IF;

  IF p_action = 'verify' THEN
    UPDATE public.invoices SET state = 'VERIFIED', verified_by = p_actor_id, verified_at = p_now,
      pdf_public_id = coalesce(p_pdf_public_id, pdf_public_id)
    WHERE id = p_invoice_id RETURNING * INTO v_inv;
  ELSIF p_action = 'pay' THEN
    IF v_inv.state <> 'VERIFIED' THEN
      RAISE EXCEPTION 'INVOICE_MUST_BE_VERIFIED_BEFORE_PAY' USING ERRCODE = '55000';
    END IF;
    IF v_inv.net_payable_poisha < 0 THEN
      RAISE EXCEPTION 'INVOICE_NEGATIVE_NET_OWES_UNDAL: cannot mark negative balance PAID until cash remittance settles'
        USING ERRCODE = '55000';
    END IF;
    IF p_payout_txn_ref IS NULL OR p_payout_proof_public_id IS NULL THEN
      RAISE EXCEPTION 'PAYOUT_PROOF_REQUIRED: TrxID and Cloudinary proof public_id required' USING ERRCODE = '22023';
    END IF;
    UPDATE public.invoices SET
      state = 'PAID', paid_by = p_actor_id, paid_at = p_now,
      payout_method = p_payout_method, payout_txn_ref = p_payout_txn_ref,
      payout_proof_public_id = p_payout_proof_public_id,
      pdf_public_id = coalesce(p_pdf_public_id, pdf_public_id)
    WHERE id = p_invoice_id RETURNING * INTO v_inv;

    IF v_inv.net_payable_poisha > 0 THEN
      INSERT INTO public.ledger_entries (actor_type, actor_id, invoice_id, kind, amount_poisha, memo, created_at)
      VALUES (v_inv.payee_type, v_inv.payee_id, v_inv.id, 'payout', -v_inv.net_payable_poisha,
              format('Invoice %s settled via %s (%s)', v_inv.invoice_number, p_payout_method, p_payout_txn_ref), p_now);
      IF v_inv.cashout_fee_cover_poisha > 0 THEN
        INSERT INTO public.ledger_entries (actor_type, actor_id, invoice_id, kind, amount_poisha, memo, created_at)
        VALUES ('undal', NULL, v_inv.id, 'cashout_fee_cover', -v_inv.cashout_fee_cover_poisha,
                format('Undal %s cash-out fee cover on %s', p_payout_method, v_inv.invoice_number), p_now);
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_INVOICE_ACTION: %', p_action USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, diff, request_id)
  VALUES (p_actor_id, 'admin', 'invoice.' || p_action, 'invoice', v_inv.id::text,
          jsonb_build_object('state', v_inv.state, 'disbursed_poisha', v_inv.total_disbursed_poisha), p_request_id);
  RETURN v_inv;
END;
$$;
COMMENT ON FUNCTION public.verify_and_pay_invoice(uuid, uuid, text, text, text, text, text, text, timestamptz) IS
  'Replays invoice lines against header net_payable_poisha, blocks negative-net payout, and records Cloudinary payout proof.';

-- 6. Grants & RLS Across All 19 Build 5 Tables (`62 / 62` Cumulative Public Tables Protected!)
GRANT SELECT ON public.banners, public.reviews, public.weather_cache TO anon, authenticated;
GRANT SELECT ON public.invoices, public.invoice_lines, public.ledger_entries, public.chats TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.rider_cash_remittances, public.penalties_adjustments, public.reviews, public.chat_messages, public.support_threads, public.support_messages, public.notifications, public.media_assets TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.favourites TO authenticated;
GRANT INSERT ON public.client_errors, public.search_queries TO anon, authenticated;
GRANT ALL ON
  public.invoices, public.invoice_lines, public.rider_cash_remittances, public.penalties_adjustments,
  public.ledger_entries, public.reviews, public.favourites, public.chats, public.chat_messages,
  public.support_threads, public.support_messages, public.media_assets, public.banners,
  public.notifications, public.fcm_dispatch_log, public.client_errors, public.search_queries,
  public.weather_cache, public.geocode_cache
TO service_role;

DROP POLICY IF EXISTS ledger_entries_actor_or_finance ON public.ledger_entries;
CREATE POLICY ledger_entries_actor_or_finance ON public.ledger_entries FOR SELECT TO authenticated
  USING (
    (actor_type = 'vendor' AND actor_id IS NOT NULL AND public.is_vendor_owner(actor_id))
    OR (actor_type = 'rider' AND actor_id IS NOT NULL AND public.is_rider_owner(actor_id))
    OR public.has_admin_permission('5.ledger')
  );

DROP POLICY IF EXISTS invoices_payee_or_finance ON public.invoices;
CREATE POLICY invoices_payee_or_finance ON public.invoices FOR SELECT TO authenticated
  USING (
    (payee_type = 'vendor' AND public.is_vendor_owner(payee_id))
    OR (payee_type = 'rider' AND public.is_rider_owner(payee_id))
    OR public.has_admin_permission('5.invoices')
  );

DROP POLICY IF EXISTS invoice_lines_via_invoice ON public.invoice_lines;
CREATE POLICY invoice_lines_via_invoice ON public.invoice_lines FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices AS i WHERE i.id = invoice_lines.invoice_id));

DROP POLICY IF EXISTS remittances_rider_or_finance ON public.rider_cash_remittances;
CREATE POLICY remittances_rider_or_finance ON public.rider_cash_remittances FOR ALL TO authenticated
  USING (public.is_rider_owner(rider_id) OR public.has_admin_permission('5.cash_reconciliation'))
  WITH CHECK (public.is_rider_owner(rider_id) OR public.has_admin_permission('5.cash_reconciliation'));

DROP POLICY IF EXISTS adjustments_target_or_finance ON public.penalties_adjustments;
CREATE POLICY adjustments_target_or_finance ON public.penalties_adjustments FOR ALL TO authenticated
  USING (
    (target_type = 'vendor' AND public.is_vendor_owner(target_id))
    OR (target_type = 'rider' AND public.is_rider_owner(target_id))
    OR public.has_admin_permission('5.adjustments')
  )
  WITH CHECK (
    (target_type = 'vendor' AND public.is_vendor_owner(target_id))
    OR (target_type = 'rider' AND public.is_rider_owner(target_id))
    OR public.has_admin_permission('5.adjustments')
  );

DROP POLICY IF EXISTS reviews_public_visible ON public.reviews;
CREATE POLICY reviews_public_visible ON public.reviews FOR SELECT TO anon, authenticated
  USING (moderation_status = 'visible' OR reviewer_id = auth.uid() OR public.has_admin_permission('4.reviews'));
DROP POLICY IF EXISTS reviews_write_own_or_vendor ON public.reviews;
CREATE POLICY reviews_write_own_or_vendor ON public.reviews FOR ALL TO authenticated
  USING (reviewer_id = auth.uid() OR (vendor_id IS NOT NULL AND public.is_vendor_operator(vendor_id)) OR public.has_admin_permission('4.reviews'))
  WITH CHECK (reviewer_id = auth.uid() OR (vendor_id IS NOT NULL AND public.is_vendor_operator(vendor_id)) OR public.has_admin_permission('4.reviews'));

DROP POLICY IF EXISTS favourites_own_crud ON public.favourites;
CREATE POLICY favourites_own_crud ON public.favourites FOR ALL TO authenticated
  USING (customer_id = auth.uid()) WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS chats_order_participant ON public.chats;
CREATE POLICY chats_order_participant ON public.chats FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.orders AS o WHERE o.id = chats.order_id) OR public.has_admin_permission('8.tickets'));

DROP POLICY IF EXISTS chat_messages_participant ON public.chat_messages;
CREATE POLICY chat_messages_participant ON public.chat_messages FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chats AS c WHERE c.id = chat_messages.chat_id) OR public.has_admin_permission('8.tickets'))
  WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.chats AS c WHERE c.id = chat_messages.chat_id));

DROP POLICY IF EXISTS support_threads_own_or_agent ON public.support_threads;
CREATE POLICY support_threads_own_or_agent ON public.support_threads FOR ALL TO authenticated
  USING (requester_id = auth.uid() OR public.has_admin_permission('8.tickets'))
  WITH CHECK (requester_id = auth.uid() OR public.has_admin_permission('8.tickets'));

DROP POLICY IF EXISTS support_messages_own_or_agent ON public.support_messages;
CREATE POLICY support_messages_own_or_agent ON public.support_messages FOR ALL TO authenticated
  USING (
    (NOT is_internal_note AND EXISTS (SELECT 1 FROM public.support_threads AS t WHERE t.id = support_messages.thread_id))
    OR public.has_admin_permission('8.tickets')
  )
  WITH CHECK (
    (sender_id = auth.uid() AND NOT is_internal_note AND EXISTS (SELECT 1 FROM public.support_threads AS t WHERE t.id = support_messages.thread_id))
    OR public.has_admin_permission('8.tickets')
  );

DROP POLICY IF EXISTS media_assets_owner_or_admin ON public.media_assets;
CREATE POLICY media_assets_owner_or_admin ON public.media_assets FOR ALL TO authenticated
  USING (owner_profile_id = auth.uid() OR public.has_admin_permission('4.pipeline') OR public.has_admin_permission('5.invoices'))
  WITH CHECK (owner_profile_id = auth.uid() OR public.has_admin_permission('4.pipeline') OR public.has_admin_permission('5.invoices'));

DROP POLICY IF EXISTS banners_public_active ON public.banners;
CREATE POLICY banners_public_active ON public.banners FOR SELECT TO anon, authenticated
  USING (is_active = true OR public.has_admin_permission('7.banners'));

DROP POLICY IF EXISTS notifications_own_only ON public.notifications;
CREATE POLICY notifications_own_only ON public.notifications FOR ALL TO authenticated
  USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS fcm_dispatch_admin_read ON public.fcm_dispatch_log;
CREATE POLICY fcm_dispatch_admin_read ON public.fcm_dispatch_log FOR SELECT TO authenticated
  USING (public.has_admin_permission('6.order_360') OR public.has_admin_permission('1.health'));

DROP POLICY IF EXISTS client_errors_insert_any ON public.client_errors;
CREATE POLICY client_errors_insert_any ON public.client_errors FOR INSERT TO anon, authenticated
  WITH CHECK (profile_id IS NULL OR profile_id = auth.uid());
DROP POLICY IF EXISTS client_errors_admin_read ON public.client_errors;
CREATE POLICY client_errors_admin_read ON public.client_errors FOR SELECT TO authenticated
  USING (public.has_admin_permission('1.health'));

DROP POLICY IF EXISTS search_queries_insert_any ON public.search_queries;
CREATE POLICY search_queries_insert_any ON public.search_queries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS search_queries_admin_read ON public.search_queries;
CREATE POLICY search_queries_admin_read ON public.search_queries FOR SELECT TO authenticated
  USING (public.has_admin_permission('9.analytics'));

DROP POLICY IF EXISTS weather_cache_public_read ON public.weather_cache;
CREATE POLICY weather_cache_public_read ON public.weather_cache FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS geocode_cache_admin_read ON public.geocode_cache;
CREATE POLICY geocode_cache_admin_read ON public.geocode_cache FOR SELECT TO authenticated
  USING (public.has_admin_permission('1.health'));
