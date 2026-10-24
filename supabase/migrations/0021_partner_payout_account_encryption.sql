-- =============================================================================
-- Migration: 0021_partner_payout_account_encryption.sql
-- Milestone: Build Response 16 (Partner onboarding, KYC vault binding & payout encryption)
-- Purpose:   Persist private applicant fields, typed menu/hygiene state, document asset ownership,
--            and RSA-OAEP ciphertext while keeping the payout private key exclusively in W3.
-- References: ADR-0006 v2, Files 17/21, Appendix N (`p-01..p-07`, vault `p-35`).
-- =============================================================================

-- Applicant-only data. The public catalog projection deliberately does not expose these columns.
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS representative_name text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS contact_email text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS onboarding_menu jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS on_demand_declared boolean NOT NULL DEFAULT false;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS partner_prep_minutes_estimate smallint;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS hygiene_checklist jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS packaging_standard_accepted_at timestamptz;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS partner_agreement_version text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS partner_agreement_hash text;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS partner_agreement_accepted_at timestamptz;
ALTER TABLE public.vendors ADD COLUMN IF NOT EXISTS partner_agreement_accepted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_representative_name_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_representative_name_check
      CHECK (representative_name IS NULL OR char_length(btrim(representative_name)) BETWEEN 2 AND 140);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_contact_email_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_contact_email_check
      CHECK (contact_email IS NULL OR contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_partner_prep_minutes_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_partner_prep_minutes_check
      CHECK (partner_prep_minutes_estimate IS NULL OR partner_prep_minutes_estimate BETWEEN 5 AND 200);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_onboarding_menu_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_onboarding_menu_check
      CHECK (jsonb_typeof(onboarding_menu) = 'array' AND jsonb_array_length(onboarding_menu) <= 30);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_hygiene_checklist_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_hygiene_checklist_check
      CHECK (jsonb_typeof(hygiene_checklist) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vendors_partner_agreement_hash_check') THEN
    ALTER TABLE public.vendors ADD CONSTRAINT vendors_partner_agreement_hash_check
      CHECK (partner_agreement_hash IS NULL OR partner_agreement_hash ~ '^[0-9a-f]{64}$');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS vendors_owner_application_idx
  ON public.vendors (owner_profile_id, created_at DESC) WHERE deleted_at IS NULL;

-- Outside-zone demand captures only an owner-bound neighbourhood pin, never the applicant's private address.
CREATE TABLE IF NOT EXISTS public.partner_zone_waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  vendor_type text NOT NULL CHECK (vendor_type IN ('RESTAURANT', 'HOME_KITCHEN', 'CLOUD_KITCHEN')),
  lat double precision NOT NULL CHECK (lat BETWEEN 20 AND 27),
  lng double precision NOT NULL CHECK (lng BETWEEN 88 AND 93),
  public_area_label text NOT NULL CHECK (char_length(btrim(public_area_label)) BETWEEN 2 AND 120),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (profile_id, idempotency_key)
);
ALTER TABLE public.partner_zone_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_zone_waitlist FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_zone_waitlist FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.partner_zone_waitlist TO service_role;
COMMENT ON TABLE public.partner_zone_waitlist IS
  'Owner-scoped outside-zone launch interest; stores no exact street address, phone, email, document, or payment data.';

-- Store only the Cloudinary media_assets relation and private public_id; never a signed URL or file bytes.
ALTER TABLE public.vendor_documents ADD COLUMN IF NOT EXISTS media_asset_id uuid
  REFERENCES public.media_assets(id) ON DELETE SET NULL;
ALTER TABLE public.vendor_documents ADD COLUMN IF NOT EXISTS issued_on date;
ALTER TABLE public.vendor_documents DROP CONSTRAINT IF EXISTS vendor_documents_doc_type_check;
ALTER TABLE public.vendor_documents ADD CONSTRAINT vendor_documents_doc_type_check CHECK (doc_type IN (
  'trade_license', 'nid_front', 'nid_back', 'passport_front', 'passport_back',
  'tin', 'bin', 'bank_proof', 'bkash_proof', 'nagad_proof', 'utility_bill',
  'kitchen_hygiene_photo', 'menu_doc', 'selfie'
));
COMMENT ON COLUMN public.vendor_documents.media_asset_id IS
  'Owner-bound Cloudinary authenticated asset id; W1 rejects non-owner, ImgBB, and non-vendor_kyc assets.';
COMMENT ON COLUMN public.vendor_documents.issued_on IS
  'Issue date used to enforce the home/cloud kitchen utility-bill freshness window (90 days).';

-- W1 receives only the public half of a 3072-bit RSA-OAEP/SHA-256 key pair. Plain account identifiers
-- are encrypted in W1 before crossing the PostgREST boundary; the decrypt-only private key lives in W3.
CREATE OR REPLACE FUNCTION public.save_vendor_payout_account(
  p_owner_profile_id uuid,
  p_vendor_id uuid,
  p_method text,
  p_holder_name text,
  p_account_ciphertext_hex text,
  p_masked text
)
RETURNS TABLE (
  method text,
  holder_name text,
  masked text,
  is_primary boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'PAYOUT_WRITE_SERVICE_ONLY' USING ERRCODE = '42501';
  END IF;
  IF p_method NOT IN ('bkash', 'nagad', 'bank') THEN
    RAISE EXCEPTION 'PAYOUT_METHOD_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_holder_name IS NULL OR char_length(btrim(p_holder_name)) NOT BETWEEN 2 AND 140 THEN
    RAISE EXCEPTION 'PAYOUT_HOLDER_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_account_ciphertext_hex IS NULL OR p_account_ciphertext_hex !~ '^[0-9A-Fa-f]+$'
     OR char_length(p_account_ciphertext_hex) NOT BETWEEN 256 AND 2048
     OR mod(char_length(p_account_ciphertext_hex), 2) <> 0 THEN
    RAISE EXCEPTION 'PAYOUT_CIPHERTEXT_INVALID' USING ERRCODE = '22023';
  END IF;
  IF (p_method IN ('bkash', 'nagad') AND p_masked !~ '^[0-9]{3}[*]{4}[0-9]{4}$')
     OR (p_method = 'bank' AND p_masked !~ '^••••[0-9]{4}$') THEN
    RAISE EXCEPTION 'PAYOUT_MASK_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.vendors v
    WHERE v.id = p_vendor_id
      AND v.owner_profile_id = p_owner_profile_id
      AND v.kyc_status IN ('draft', 'needs_fix')
      AND v.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'PAYOUT_VENDOR_OWNER_MISMATCH' USING ERRCODE = '42501';
  END IF;

  UPDATE public.vendor_payout_accounts AS account
  SET is_primary = false
  WHERE account.vendor_id = p_vendor_id AND account.is_primary = true;

  INSERT INTO public.vendor_payout_accounts (
    vendor_id, method, holder_name, account_ref_enc, masked, is_primary
  ) VALUES (
    p_vendor_id,
    p_method,
    btrim(p_holder_name),
    decode(p_account_ciphertext_hex, 'hex'),
    p_masked,
    true
  );

  RETURN QUERY SELECT p_method, btrim(p_holder_name), p_masked, true;
END;
$$;

COMMENT ON FUNCTION public.save_vendor_payout_account(uuid, uuid, text, text, text, text) IS
  'Service-role W1 owner payout setup. W1 RSA-OAEP encrypts the beneficiary using a public key before sending ciphertext; only W3 holds the matching private key. Returns masked data only.';

REVOKE ALL ON FUNCTION public.save_vendor_payout_account(uuid, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_vendor_payout_account(uuid, uuid, text, text, text, text) TO service_role;
