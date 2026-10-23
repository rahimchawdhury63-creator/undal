-- =============================================================================
-- Migration: 0013_ledger_and_settlement.sql
-- Milestone: Build Response 5 (Migrations IV — Append-Only Ledger, Invoices & Cash Gate)
-- Tables:    ledger_entries (APPEND-ONLY), invoices, invoice_lines,
--            rider_cash_remittances, penalties_adjustments
-- Views:     rider_cash_balance_v
-- References: Master Guide File 10 (§10.4–10.6), File 23 (§23.1–23.5), ADR-0006
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  payee_type text NOT NULL CHECK (payee_type IN ('vendor', 'rider')),
  payee_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  gross_poisha bigint NOT NULL DEFAULT 0,
  deductions_poisha bigint NOT NULL DEFAULT 0,
  adjustments_poisha bigint NOT NULL DEFAULT 0,
  net_payable_poisha bigint NOT NULL,
  cashout_fee_cover_poisha bigint NOT NULL DEFAULT 0 CHECK (cashout_fee_cover_poisha >= 0),
  total_disbursed_poisha bigint NOT NULL DEFAULT 0 CHECK (total_disbursed_poisha >= 0),
  state text NOT NULL DEFAULT 'GENERATED'
    CHECK (state IN ('GENERATED', 'VERIFIED', 'PAID', 'DISPUTED')),
  payout_method text CHECK (payout_method IN ('bkash', 'nagad', 'bank')),
  payout_txn_ref text,
  payout_proof_public_id text,
  pdf_public_id text,
  dispute_reason text,
  verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  verified_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT invoices_period_valid CHECK (period_end >= period_start),
  CONSTRAINT invoices_unique_period_payee UNIQUE (period_start, payee_type, payee_id),
  CONSTRAINT invoices_disbursed_math CHECK (
    total_disbursed_poisha = CASE
      WHEN net_payable_poisha > 0 THEN net_payable_poisha + cashout_fee_cover_poisha
      ELSE 0
    END
  )
);

CREATE INDEX IF NOT EXISTS invoices_payee_period_idx
  ON public.invoices (payee_type, payee_id, period_start DESC);
CREATE INDEX IF NOT EXISTS invoices_state_idx ON public.invoices (state, payee_type, period_start DESC);
COMMENT ON TABLE public.invoices IS
  'Weekly settlement invoices (Riders Friday, Vendors Saturday per D-06 & File 23 §23.1) with Undal cash-out fee cover and Cloudinary authenticated proof/PDF public_ids.';
DROP TRIGGER IF EXISTS invoices_set_updated_at ON public.invoices;
CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.rider_cash_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id uuid NOT NULL REFERENCES public.riders(id) ON DELETE RESTRICT,
  method text NOT NULL CHECK (method IN ('bkash', 'nagad', 'bank')),
  amount_poisha bigint NOT NULL CHECK (amount_poisha > 0),
  verified_amount_poisha bigint CHECK (verified_amount_poisha IS NULL OR verified_amount_poisha >= 0),
  bkash_trxid text NOT NULL UNIQUE CHECK (char_length(btrim(bkash_trxid)) BETWEEN 5 AND 64),
  sender_number text NOT NULL CHECK (sender_number ~ '^01[3-9][0-9]{8}$'),
  sender_name text,
  screenshot_public_id text NOT NULL CHECK (char_length(btrim(screenshot_public_id)) BETWEEN 5 AND 300),
  selfie_public_id text,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'verified', 'partial', 'rejected')),
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS remittances_rider_state_idx
  ON public.rider_cash_remittances (rider_id, state, created_at DESC);
COMMENT ON TABLE public.rider_cash_remittances IS
  'Rider COD cash remittances with global UNIQUE(bkash_trxid) replay guard and Cloudinary authenticated screenshot_public_id.';
DROP TRIGGER IF EXISTS remittances_set_updated_at ON public.rider_cash_remittances;
CREATE TRIGGER remittances_set_updated_at BEFORE UPDATE ON public.rider_cash_remittances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.penalties_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('vendor', 'rider')),
  target_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('penalty', 'bonus', 'refund_adjustment')),
  amount_poisha bigint NOT NULL CHECK (amount_poisha <> 0),
  reason_code text NOT NULL CHECK (char_length(btrim(reason_code)) BETWEEN 3 AND 64),
  note text,
  evidence_public_id text,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'confirmed', 'disputed', 'cancelled')),
  dispute_note text,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS adjustments_target_state_idx
  ON public.penalties_adjustments (target_type, target_id, state);
COMMENT ON TABLE public.penalties_adjustments IS
  'Reason-coded penalties, bonuses & COD refund adjustments with payee dispute window before invoice inclusion (File 23 §23.4).';
DROP TRIGGER IF EXISTS adjustments_set_updated_at ON public.penalties_adjustments;
CREATE TRIGGER adjustments_set_updated_at BEFORE UPDATE ON public.penalties_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_type text NOT NULL CHECK (actor_type IN ('vendor', 'rider', 'undal')),
  actor_id uuid,
  order_id uuid REFERENCES public.orders(id) ON DELETE RESTRICT,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE RESTRICT,
  remittance_id uuid REFERENCES public.rider_cash_remittances(id) ON DELETE RESTRICT,
  adjustment_id uuid REFERENCES public.penalties_adjustments(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN (
    'vendor_payable', 'commission', 'rider_fare', 'rider_bonus', 'tip',
    'cod_liability', 'remittance', 'adjustment', 'discount_fund', 'payout', 'cashout_fee_cover'
  )),
  amount_poisha bigint NOT NULL,
  memo text NOT NULL CHECK (char_length(btrim(memo)) BETWEEN 3 AND 240),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE UNIQUE INDEX IF NOT EXISTS ledger_order_component_once_idx
  ON public.ledger_entries (order_id, actor_type, kind)
  WHERE order_id IS NOT NULL AND kind IN (
    'vendor_payable', 'commission', 'rider_fare', 'rider_bonus', 'tip', 'cod_liability', 'discount_fund'
  );
CREATE INDEX IF NOT EXISTS ledger_actor_period_idx
  ON public.ledger_entries (actor_type, actor_id, created_at ASC);
COMMENT ON TABLE public.ledger_entries IS
  'Immutable append-only signed integer-poisha financial ledger (File 10 §10.4); UPDATE and DELETE strictly blocked.';

DROP TRIGGER IF EXISTS ledger_entries_no_update ON public.ledger_entries;
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE OR DELETE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();

CREATE TABLE IF NOT EXISTS public.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  ledger_entry_id bigint REFERENCES public.ledger_entries(id) ON DELETE SET NULL,
  line_kind text NOT NULL,
  label_en text NOT NULL,
  label_bn text,
  amount_poisha bigint NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS invoice_lines_invoice_sort_idx ON public.invoice_lines (invoice_id, sort ASC);
COMMENT ON TABLE public.invoice_lines IS 'Itemized line-level breakdown frozen inside each weekly settlement invoice.';

-- Live Rider COD Cash-in-Hand Float View (`File 23 §23.2`: ৳3,000 cycle / ৳5,000 motorbike ceiling; 80% warn, 100% gate)
CREATE OR REPLACE VIEW public.rider_cash_balance_v AS
WITH ledger_sums AS (
  SELECT
    le.actor_id AS rider_id,
    coalesce(sum(-le.amount_poisha) FILTER (WHERE le.kind = 'cod_liability'), 0)::bigint AS cod_collected_poisha,
    coalesce(sum(le.amount_poisha) FILTER (WHERE le.kind = 'remittance'), 0)::bigint AS remitted_verified_poisha
  FROM public.ledger_entries AS le
  WHERE le.actor_type = 'rider' AND le.actor_id IS NOT NULL
  GROUP BY le.actor_id
)
SELECT
  r.id AS rider_id,
  r.profile_id,
  r.vehicle_type,
  coalesce(ls.cod_collected_poisha, 0)::bigint AS cod_collected_poisha,
  coalesce(ls.remitted_verified_poisha, 0)::bigint AS remitted_verified_poisha,
  greatest(0, coalesce(ls.cod_collected_poisha, 0) - coalesce(ls.remitted_verified_poisha, 0))::bigint AS unremitted_cash_poisha,
  coalesce(
    r.cash_ceiling_override_poisha,
    CASE WHEN r.vehicle_type = 'bicycle' THEN 300000::bigint ELSE 500000::bigint END
  ) AS ceiling_poisha,
  (
    greatest(0, coalesce(ls.cod_collected_poisha, 0) - coalesce(ls.remitted_verified_poisha, 0)) * 100
    >= coalesce(r.cash_ceiling_override_poisha, CASE WHEN r.vehicle_type = 'bicycle' THEN 300000::bigint ELSE 500000::bigint END) * 80
  ) AS warn_80pct,
  (
    greatest(0, coalesce(ls.cod_collected_poisha, 0) - coalesce(ls.remitted_verified_poisha, 0))
    >= coalesce(r.cash_ceiling_override_poisha, CASE WHEN r.vehicle_type = 'bicycle' THEN 300000::bigint ELSE 500000::bigint END)
  ) AS at_or_above_ceiling
FROM public.riders AS r
LEFT JOIN ledger_sums AS ls ON ls.rider_id = r.id;

COMMENT ON VIEW public.rider_cash_balance_v IS
  'Live rider COD liability meter enforcing 80% warning and 100% dispatch block (File 23 §23.2).';

CREATE OR REPLACE FUNCTION public.sync_rider_cash_gate(p_rider_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bal record;
BEGIN
  SELECT * INTO v_bal FROM public.rider_cash_balance_v WHERE rider_id = p_rider_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RIDER_NOT_FOUND: %', p_rider_id USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.riders
  SET cash_gate_blocked = v_bal.at_or_above_ceiling
  WHERE id = p_rider_id AND cash_gate_blocked IS DISTINCT FROM v_bal.at_or_above_ceiling;
  RETURN jsonb_build_object(
    'rider_id', v_bal.rider_id, 'unremitted_cash_poisha', v_bal.unremitted_cash_poisha,
    'ceiling_poisha', v_bal.ceiling_poisha, 'warn_80pct', v_bal.warn_80pct, 'cash_gate_blocked', v_bal.at_or_above_ceiling
  );
END;
$$;
COMMENT ON FUNCTION public.sync_rider_cash_gate(uuid) IS
  'Recomputes rider COD float from immutable ledger_entries and locks/unlocks riders.cash_gate_blocked automatically.';

CREATE OR REPLACE FUNCTION public.enforce_rider_cash_gate_on_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.rider_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.rider_id IS DISTINCT FROM OLD.rider_id) THEN
    IF EXISTS (SELECT 1 FROM public.riders WHERE id = NEW.rider_id AND cash_gate_blocked = true) THEN
      RAISE EXCEPTION 'RIDER_CASH_CEILING_EXCEEDED: rider % must remit COD cash before taking new orders', NEW.rider_id
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION public.enforce_rider_cash_gate_on_assignment() IS
  'Blocks rider assignment when riders.cash_gate_blocked is active (File 23 §23.2).';

DROP TRIGGER IF EXISTS orders_enforce_rider_cash_gate ON public.orders;
CREATE TRIGGER orders_enforce_rider_cash_gate BEFORE INSERT OR UPDATE OF rider_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rider_cash_gate_on_assignment();

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_lines FORCE ROW LEVEL SECURITY;
ALTER TABLE public.rider_cash_remittances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_cash_remittances FORCE ROW LEVEL SECURITY;
ALTER TABLE public.penalties_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.penalties_adjustments FORCE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries FORCE ROW LEVEL SECURITY;
