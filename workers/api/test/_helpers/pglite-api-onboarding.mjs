/**
 * @file workers/api/test/_helpers/pglite-api-onboarding.mjs
 * @description Real PGlite PostgreSQL methods for owner-scoped Partner drafts, hours, and RSA-protected payouts.
 */

/** Creates W1 Partner onboarding adapter methods backed by the real migrated PGlite database. */
export function createPglitePartnerMethods(db) {
  return {
    async getVendorApplication(profileId) {
      const vendor = (await db.query(
        `SELECT * FROM public.vendors WHERE owner_profile_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [profileId],
      )).rows[0];
      if (!vendor) return null;
      const [hours, documents, payouts] = await Promise.all([
        db.query('SELECT weekday, is_closed, open1, close1, open2, close2 FROM public.vendor_hours WHERE vendor_id = $1 ORDER BY weekday', [vendor.id]),
        db.query('SELECT id, doc_type, review_status, review_note, expires_on, issued_on, media_asset_id, created_at FROM public.vendor_documents WHERE vendor_id = $1 ORDER BY created_at DESC, id DESC LIMIT 100', [vendor.id]),
        db.query('SELECT method, holder_name, masked, is_primary FROM public.vendor_payout_accounts WHERE vendor_id = $1 AND is_primary = true LIMIT 1', [vendor.id]),
      ]);
      return { ...vendor, hours: hours.rows, documents: documents.rows, payout: payouts.rows[0] ?? null };
    },
    async listActiveCuisines() {
      return (await db.query('SELECT key, name_en, name_bn, parent_key FROM public.cuisine_taxonomy WHERE is_active = true ORDER BY sort, name_en')).rows;
    },
    async createVendorApplication(input) {
      return (await db.query(
        `INSERT INTO public.vendors (
           owner_profile_id, type, legal_name, brand_name, brand_name_bn, slug, representative_name, contact_email,
           lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id, cuisines,
           accepts_pickup, pickup_point_label, kyc_status, is_active
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'',$11,$12,$13,$14,$15,$16,$17,'draft',false) RETURNING *`,
        [input.ownerProfileId, input.type, input.legalName, input.brandName, input.brandNameBn, input.slug, input.representativeName, input.contactEmail, input.lat, input.lng, input.publicAreaLabel, input.addressTextPrivate, input.counterPhone, input.zoneId, input.cuisines, input.acceptsPickup, input.pickupPointLabel],
      )).rows[0];
    },
    async updateVendorApplication(profileId, vendorId, patch) {
      const allowed = new Set([
        'legal_name', 'brand_name', 'brand_name_bn', 'representative_name', 'contact_email', 'counter_phone',
        'public_area_label', 'address_text_private', 'lat', 'lng', 'zone_id', 'cuisines', 'accepts_pickup',
        'pickup_point_label', 'onboarding_menu', 'on_demand_declared', 'partner_prep_minutes_estimate', 'hygiene_checklist',
        'packaging_standard_accepted_at', 'partner_agreement_version', 'partner_agreement_hash',
        'partner_agreement_accepted_at', 'partner_agreement_accepted_by', 'kyc_status', 'is_active',
      ]);
      const entries = Object.entries(patch).filter(([key]) => allowed.has(key));
      if (entries.length !== Object.keys(patch).length || entries.length === 0) return null;
      const jsonColumns = new Set(['onboarding_menu', 'hygiene_checklist']);
      const values = [vendorId, profileId];
      const assignments = entries.map(([key, value], index) => {
        values.push(jsonColumns.has(key) ? JSON.stringify(value) : value);
        return `${key} = $${index + 3}${jsonColumns.has(key) ? '::jsonb' : ''}`;
      });
      return (await db.query(
        `UPDATE public.vendors SET ${assignments.join(', ')}
         WHERE id = $1 AND owner_profile_id = $2 AND kyc_status IN ('draft','needs_fix') RETURNING *`,
        values,
      )).rows[0] ?? null;
    },
    async saveVendorApplicationHours(vendorId, hours) {
      const results = [];
      for (const day of hours) {
        results.push((await db.query(
          `INSERT INTO public.vendor_hours (vendor_id, weekday, is_closed, open1, close1, open2, close2)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (vendor_id, weekday) DO UPDATE SET is_closed = EXCLUDED.is_closed,
             open1 = EXCLUDED.open1, close1 = EXCLUDED.close1, open2 = EXCLUDED.open2, close2 = EXCLUDED.close2
           RETURNING *`,
          [vendorId, day.weekday, day.isClosed, day.open1, day.close1, day.open2, day.close2],
        )).rows[0]);
      }
      return results;
    },
    async saveVendorPayoutAccount(input) {
      await db.query(`SELECT set_config('request.jwt.claim.role', 'service_role', false)`);
      try {
        return (await db.query(
          `SELECT * FROM public.save_vendor_payout_account($1,$2,$3,$4,$5,$6)`,
          [input.profileId, input.vendorId, input.method, input.holderName, input.ciphertextHex, input.masked],
        )).rows[0];
      } finally {
        await db.query(`SELECT set_config('request.jwt.claim.role', '', false)`);
      }
    },
  };
}
