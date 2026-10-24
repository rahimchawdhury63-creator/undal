/**
 * @file workers/api/src/db-postgrest-onboarding.ts
 * @description Owner-scoped Partner application persistence for Build Response 16.
 * All confidential account numbers are encrypted by the service-only PostgreSQL RPC; no KYC path uses Supabase Storage.
 */

import type { ApiDbAdapter, VendorApplicationInput, VendorApplicationHoursInput } from './types.ts';
import type { PostgrestTransport } from './db-postgrest-ops.ts';

const APPLICATION_FIELDS = [
  'id', 'owner_profile_id', 'type', 'legal_name', 'brand_name', 'brand_name_bn', 'slug',
  'counter_phone', 'public_area_label', 'address_text_private', 'lat', 'lng', 'zone_id',
  'cuisines', 'kyc_status', 'accepts_pickup', 'pickup_point_label', 'representative_name',
  'contact_email', 'onboarding_menu', 'on_demand_declared', 'partner_prep_minutes_estimate', 'hygiene_checklist',
  'packaging_standard_accepted_at', 'partner_agreement_version', 'partner_agreement_hash',
  'partner_agreement_accepted_at', 'partner_agreement_accepted_by', 'created_at', 'updated_at',
].join(',');

/** Builds owner-scoped Partner onboarding methods over the shared PostgREST transport. */
export function createPostgrestOnboardingMethods(t: PostgrestTransport) {
  return {
    /** Loads an applicant's latest vendor record plus only safe KYC, hours, and masked payout projections. */
    async getVendorApplication(profileId: string): Promise<Record<string, unknown> | null> {
      const vendors = await t.getJson<Record<string, unknown>[]>(
        `vendors?owner_profile_id=eq.${encodeURIComponent(profileId)}&deleted_at=is.null&select=${APPLICATION_FIELDS}&order=created_at.desc&limit=1`,
      );
      const vendor = vendors[0];
      if (!vendor || typeof vendor.id !== 'string') return null;
      const vendorId = encodeURIComponent(vendor.id);
      const [hours, documents, payouts] = await Promise.all([
        t.getJson<Record<string, unknown>[]>(
          `vendor_hours?vendor_id=eq.${vendorId}&select=weekday,is_closed,open1,close1,open2,close2&order=weekday.asc`,
        ),
        t.getJson<Record<string, unknown>[]>(
          `vendor_documents?vendor_id=eq.${vendorId}&select=id,doc_type,review_status,review_note,expires_on,issued_on,media_asset_id,created_at&order=created_at.desc,id.desc&limit=100`,
        ),
        t.getJson<Record<string, unknown>[]>(
          `vendor_payout_accounts?vendor_id=eq.${vendorId}&is_primary=eq.true&select=method,holder_name,masked,is_primary&limit=1`,
        ),
      ]);
      return { ...vendor, hours, documents, payout: payouts[0] ?? null };
    },

    /** Lists live, localized cuisine labels from the canonical Appendix D taxonomy. */
    async listActiveCuisines(): Promise<readonly Record<string, unknown>[]> {
      return await t.getJson<Record<string, unknown>[]>(
        'cuisine_taxonomy?is_active=eq.true&select=key,name_en,name_bn,parent_key&order=sort.asc,name_en.asc',
      );
    },

    /** Creates one private draft vendor row after W1 has resolved an active service-zone pin. */
    async createVendorApplication(input: VendorApplicationInput): Promise<Record<string, unknown>> {
      const rows = await t.sendJson<Record<string, unknown>[]>('POST', 'vendors', {
        owner_profile_id: input.ownerProfileId,
        type: input.type,
        legal_name: input.legalName,
        brand_name: input.brandName,
        brand_name_bn: input.brandNameBn,
        slug: input.slug,
        representative_name: input.representativeName,
        contact_email: input.contactEmail,
        lat: input.lat,
        lng: input.lng,
        geohash: '',
        public_area_label: input.publicAreaLabel,
        address_text_private: input.addressTextPrivate,
        counter_phone: input.counterPhone,
        zone_id: input.zoneId,
        cuisines: input.cuisines,
        accepts_pickup: input.acceptsPickup,
        pickup_point_label: input.pickupPointLabel,
        kyc_status: 'draft',
        is_active: false,
      });
      return rows[0] ?? {};
    },

    /** Patches only an applicant-owned draft or needs-fix vendor record. */
    async updateVendorApplication(
      profileId: string,
      vendorId: string,
      patch: Record<string, unknown>,
    ): Promise<Record<string, unknown> | null> {
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'PATCH',
        `vendors?id=eq.${encodeURIComponent(vendorId)}&owner_profile_id=eq.${encodeURIComponent(profileId)}&kyc_status=in.(draft,needs_fix)`,
        patch,
      );
      return rows[0] ?? null;
    },

    /** Atomically upserts the complete seven-day schedule using the table's vendor/weekday primary key. */
    async saveVendorApplicationHours(
      vendorId: string,
      hours: readonly VendorApplicationHoursInput[],
    ): Promise<readonly Record<string, unknown>[]> {
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'POST',
        'vendor_hours?on_conflict=vendor_id,weekday',
        hours.map((day) => ({
          vendor_id: vendorId,
          weekday: day.weekday,
          is_closed: day.isClosed,
          open1: day.open1,
          close1: day.close1,
          open2: day.open2,
          close2: day.close2,
        })),
        'resolution=merge-duplicates,return=representation',
      );
      return rows;
    },

    /** Stores an idempotent owner-linked outside-zone interest record without a private street address. */
    async createPartnerZoneWaitlist(input: Parameters<ApiDbAdapter['createPartnerZoneWaitlist']>[0]): Promise<Record<string, unknown>> {
      const rows = await t.sendJson<Record<string, unknown>[]>(
        'POST',
        'partner_zone_waitlist?on_conflict=profile_id,idempotency_key',
        {
          profile_id: input.profileId,
          idempotency_key: input.idempotencyKey,
          vendor_type: input.vendorType,
          lat: input.lat,
          lng: input.lng,
          public_area_label: input.publicAreaLabel,
        },
        'resolution=ignore-duplicates,return=representation',
      );
      if (rows[0]) return rows[0];
      const existing = await t.getJson<Record<string, unknown>[]>(
        `partner_zone_waitlist?profile_id=eq.${encodeURIComponent(input.profileId)}&idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}&select=id,created_at&limit=1`,
      );
      return existing[0] ?? {};
    },

    /** Saves a payout beneficiary through the service-only pgcrypto RPC; returns no plaintext account number. */
    async saveVendorPayoutAccount(input: Parameters<ApiDbAdapter['saveVendorPayoutAccount']>[0]): Promise<Record<string, unknown>> {
      const saved = await t.callRpc<Record<string, unknown>>('save_vendor_payout_account', {
        p_owner_profile_id: input.profileId,
        p_vendor_id: input.vendorId,
        p_method: input.method,
        p_holder_name: input.holderName,
        p_account_ciphertext_hex: input.ciphertextHex,
        p_masked: input.masked,
      });
      return saved;
    },
  };
}
