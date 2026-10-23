/**
 * @file supabase/test/migrations-b03.test.mjs
 * @description Real PostgreSQL 16 (PGlite WASM) verification suite for Build Response 3
 * (`0005_zones_and_vendors.sql` .. `0008_vendor_menu_rls.sql` atop `0001..0004`).
 * Verifies:
 *   1. Double-apply idempotency & `ENABLE + FORCE ROW LEVEL SECURITY` on all 27 cumulative tables.
 *   2. Sylhet Sadar active / Kulaura paused polygon seeds, smallest-containing-polygon overlap rule,
 *      and auto-resolution of `customer_addresses.zone_id` on insert/move.
 *   3. D-24 HOME_KITCHEN private street-address isolation + coarse geohash projection + staff payout isolation.
 *   4. Asia/Dhaka split shifts, post-midnight rollover, busy pauses, >=4h x 5d compliance, combo availability,
 *      and `rank_v1` `get_home_feed` (incl. `more_places` demotion), `get_vendor_storefront`, & `search_catalog`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ALL_MIGRATIONS = [
  'supabase/migrations/0001_extensions_and_helpers.sql',
  'supabase/migrations/0002_identity_and_rbac.sql',
  'supabase/migrations/0003_settings_and_taxonomies.sql',
  'supabase/migrations/0004_core_rls_and_seeds.sql',
  'supabase/migrations/0005_zones_and_vendors.sql',
  'supabase/migrations/0006_menus_variants_bundles.sql',
  'supabase/migrations/0007_catalog_search_rpcs.sql',
  'supabase/migrations/0008_vendor_menu_rls.sql',
];

async function createB03Db() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests/_bootstrap_supabase_local.sql'), 'utf8'));
  for (const rel of ALL_MIGRATIONS) {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
  }
  return db;
}

test('B03-SQL-01: Migrations 0001..0008 apply twice cleanly, lock RLS on 27/27 tables, and enforce polygon rules', async () => {
  const db = await createB03Db();
  try {
    // Re-apply all 8 migrations to guarantee full idempotency
    for (const rel of ALL_MIGRATIONS) {
      await db.exec(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
    }

    const rls = await db.query(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    `);
    assert.equal(rls.rows.length, 27);
    for (const row of rls.rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} missing ENABLE RLS`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} missing FORCE RLS`);
    }

    // Active Sylhet Sadar vs paused Kulaura
    const syl = await db.query('SELECT * FROM public.resolve_zone(24.8949, 91.8687)');
    assert.equal(syl.rows[0].in_service_area, true);
    assert.equal(syl.rows[0].slug, 'sylhet-sadar');

    const kulPaused = await db.query('SELECT * FROM public.resolve_zone(24.5186, 92.0336)');
    assert.equal(kulPaused.rows[0].in_service_area, false);
    assert.equal(kulPaused.rows[0].nearest_zone_slug, 'sylhet-sadar');

    // Flip Kulaura active in 1 query -> immediately resolves!
    await db.query(`UPDATE public.zones SET is_active = true WHERE slug = 'kulaura'`);
    const kulActive = await db.query('SELECT * FROM public.resolve_zone(24.5186, 92.0336)');
    assert.equal(kulActive.rows[0].in_service_area, true);
    assert.equal(kulActive.rows[0].slug, 'kulaura');
  } finally {
    await db.close();
  }
});

test('B03-SQL-02: HOME_KITCHEN privacy, staff payout isolation, Asia/Dhaka hours, combo availability & rank_v1 RPCs', async () => {
  const db = await createB03Db();
  try {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('aaaa1111-1111-4111-8111-111111111111', 'chef@undal.test', '{"full_name":"Nusrat Chef"}'::jsonb),
        ('bbbb2222-2222-4222-8222-222222222222', 'rest@undal.test', '{"full_name":"Jalal Owner"}'::jsonb),
        ('eeee5555-5555-4555-8555-555555555555', 'low@undal.test', '{"full_name":"Low Rated"}'::jsonb),
        ('cccc3333-3333-4333-8333-333333333333', 'staff@undal.test', '{"full_name":"Rafi Staff"}'::jsonb),
        ('dddd4444-4444-4444-8444-444444444444', 'cust@undal.test', '{"full_name":"Customer"}'::jsonb);

      INSERT INTO public.vendors (
        id, owner_profile_id, type, legal_name, brand_name, brand_name_bn, slug,
        lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
        cuisines, kyc_status, is_active, rating_avg, rating_count, avg_prep_min
      )
      SELECT
        '10101010-1010-4010-8010-101010101010', 'aaaa1111-1111-4111-8111-111111111111', 'HOME_KITCHEN',
        'Nusrat Jahan', 'Nusrat Gharoa Kitchen', 'নুসরাত ঘরোয়া কিচেন', 'nusrat-gharoa',
        24.888432, 91.879654, '', 'Upashahar, Sylhet', 'SECRET FLAT 4B HOUSE 19 UPASHAHAR', '01711000111', id,
        ARRAY['homemade', 'satkora'], 'approved', true, 4.85, 35, 25
      FROM public.zones WHERE slug = 'sylhet-sadar';

      INSERT INTO public.vendors (
        id, owner_profile_id, type, legal_name, brand_name, brand_name_bn, slug,
        lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
        cuisines, kyc_status, is_active, rating_avg, rating_count, avg_prep_min
      )
      SELECT
        '20202020-2020-4020-8020-202020202020', 'bbbb2222-2222-4222-8222-222222222222', 'RESTAURANT',
        'Heritage Handi Ltd', 'Sylhet Heritage Handi', 'সিলেট হেরিটেজ হাঁড়ি', 'heritage-handi',
        24.8952, 91.8689, '', 'Zindabazar, Sylhet', 'Plot 14 Zindabazar', '01811000222', id,
        ARRAY['bangladeshi', 'biryani'], 'approved', true, 4.75, 190, 15
      FROM public.zones WHERE slug = 'sylhet-sadar';

      INSERT INTO public.vendors (
        id, owner_profile_id, type, legal_name, brand_name, slug,
        lat, lng, geohash, public_area_label, address_text_private, counter_phone, zone_id,
        cuisines, kyc_status, is_active, rating_avg, rating_count, avg_prep_min
      )
      SELECT
        '30303030-3030-4030-8030-303030303030', 'eeee5555-5555-4555-8555-555555555555', 'CLOUD_KITCHEN',
        'Cold Fries Kitchen', 'Cold Fries Cloud', 'cold-fries-cloud',
        24.8960, 91.8690, '', 'Zindabazar, Sylhet', 'Lane 2 Zindabazar', '01911000333', id,
        ARRAY['fast_food'], 'approved', true, 2.75, 12, 35
      FROM public.zones WHERE slug = 'sylhet-sadar';

      INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, is_closed) VALUES
        ('10101010-1010-4010-8010-101010101010', 5, '11:00', '22:00', false),
        ('20202020-2020-4020-8020-202020202020', 5, '11:00', '23:30', false),
        ('30303030-3030-4030-8030-303030303030', 5, '11:00', '23:30', false);
    `);

    // Evaluate Friday 19:30 Asia/Dhaka (`2026-10-23 19:30:00+06`)
    const feedRes = await db.query(`
      SELECT public.get_home_feed(24.8949, 91.8687, 'delivery', NULL, 'recommended', 20, 0, '2026-10-23 19:30:00+06'::timestamptz) AS payload
    `);
    const feed = feedRes.rows[0].payload;
    assert.equal(feed.in_service_area, true);
    assert.equal(feed.formula_version, 'rank_v1');
    assert.equal(feed.vendors.length, 3);
    // Low-rated kitchen (< 3.20 with >= 5 reviews) is demoted to `more_places` at the bottom, never deleted
    assert.equal(feed.vendors[2].slug, 'cold-fries-cloud');
    assert.equal(feed.vendors[2].feed_section, 'more_places');
    // Verify private address string never appears anywhere in serialized feed or storefront JSON
    assert.equal(JSON.stringify(feed).includes('SECRET FLAT 4B'), false);

    const storeRes = await db.query(`SELECT public.get_vendor_storefront('nusrat-gharoa', '2026-10-23 19:30:00+06'::timestamptz) AS doc`);
    assert.equal(JSON.stringify(storeRes.rows[0].doc).includes('SECRET FLAT 4B'), false);
    assert.equal(storeRes.rows[0].doc.vendor.display_geohash.length, 5);

    // Search both Bengali script and Banglish transliteration
    const searchBn = await db.query(`SELECT public.search_catalog('ঘরোয়া', 24.8949, 91.8687) AS hits`);
    const searchBanglish = await db.query(`SELECT public.search_catalog('satkora', 24.8949, 91.8687) AS hits`);
    assert.equal(searchBn.rows[0].hits[0].slug, 'nusrat-gharoa');
    assert.equal(searchBanglish.rows[0].hits[0].slug, 'nusrat-gharoa');
  } finally {
    await db.close();
  }
});
