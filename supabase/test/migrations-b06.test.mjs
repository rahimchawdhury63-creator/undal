/**
 * @file supabase/test/migrations-b06.test.mjs
 * @description PostgreSQL 16 checkout quote, integer-poisha itemization, priority-fee parity,
 * first-order voucher eligibility, and atomic COD placement coverage for Build Response 14.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function bootCheckoutDb() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests/_bootstrap_supabase_local.sql'), 'utf8'));
  const migrations = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter((file) => file.endsWith('.sql')).sort();
  for (const migration of migrations) {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations', migration), 'utf8'));
  }
  return db;
}

test('B06-SQL-01: W1 quotes carry server-priced item lines and configurable priority fee into COD orders', async () => {
  const db = await bootCheckoutDb();
  try {
    const customerId = 'd6001111-1111-4111-8111-111111111111';
    const ownerId = 'd6002222-2222-4222-8222-222222222222';
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
        ('${customerId}', 'checkout-customer@undal.test', '{"full_name":"Checkout Customer"}'::jsonb),
        ('${ownerId}', 'checkout-owner@undal.test', '{"full_name":"Checkout Owner"}'::jsonb);
      UPDATE public.profiles SET status = 'active', trust_score = 80 WHERE id = '${customerId}';
      UPDATE public.profiles SET role = 'vendor_owner', status = 'active' WHERE id = '${ownerId}';
      UPDATE public.platform_settings SET value = '2375'::jsonb WHERE key = 'money.priority_delivery_fee_poisha';
      INSERT INTO public.vendors (
        id, owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
        public_area_label, address_text_private, counter_phone, zone_id, kyc_status, is_active,
        accepts_pickup, min_order_poisha, commission_bps
      ) SELECT
        'd6003333-3333-4333-8333-333333333333', '${ownerId}', 'RESTAURANT', 'Checkout Foods',
        'Checkout Kitchen', 'checkout-kitchen', 24.8949, 91.8687, '', 'Zindabazar, Sylhet',
        'Private street', '01712345678', id, 'approved', true, true, 10000, 1500
      FROM public.zones WHERE slug = 'sylhet-sadar';
      INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1, is_closed)
      SELECT 'd6003333-3333-4333-8333-333333333333', day, '00:00', '23:59:59', false
      FROM generate_series(0, 6) AS day;
      INSERT INTO public.menu_categories (id, vendor_id, name_en)
      VALUES ('d6004444-4444-4444-8444-444444444444', 'd6003333-3333-4333-8333-333333333333', 'Meals');
      INSERT INTO public.menu_items (id, vendor_id, category_id, name_en, name_bn, price_poisha)
      VALUES ('d6005555-5555-4555-8555-555555555555', 'd6003333-3333-4333-8333-333333333333', 'd6004444-4444-4444-8444-444444444444', 'Shatkora Bowl', 'সাতকরা বাটি', 25000);
      INSERT INTO public.customer_addresses (id, profile_id, label, lat, lng, geohash, address_text, is_default)
      VALUES ('d6006666-6666-4666-8666-666666666666', '${customerId}', 'Home', 24.8949, 91.8687, '', 'Zindabazar, Sylhet', true);
      INSERT INTO public.vouchers (
        id, code, title_en, kind, value_num, min_order_poisha, max_uses_per_user,
        first_order_only, budget_cap_poisha, starts_at, ends_at, is_active
      ) VALUES (
        'd6007777-7777-4777-8777-777777777777', 'FIRSTONLY', 'First order offer', 'flat',
        1000, 0, 1, true, 100000, clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day', true
      );
      INSERT INTO public.carts (id, customer_id, vendor_id, address_id, fulfilment, voucher_code, tip_poisha)
      VALUES ('d6008888-8888-4888-8888-888888888888', '${customerId}', 'd6003333-3333-4333-8333-333333333333', 'd6006666-6666-4666-8666-666666666666', 'delivery', 'FIRSTONLY', 1500);
      INSERT INTO public.cart_items (cart_id, menu_item_id, qty, unit_snapshot_poisha)
      VALUES ('d6008888-8888-4888-8888-888888888888', 'd6005555-5555-4555-8555-555555555555', 2, 25000);
    `);

    const standard = (await db.query(
      `SELECT public.quote_customer_cart($1, 0, 0, false) AS quote`, [customerId],
    )).rows[0].quote;
    const priority = (await db.query(
      `SELECT public.quote_customer_cart($1, 0, 0, true) AS quote`, [customerId],
    )).rows[0].quote;
    assert.equal(standard.line_items.length, 1);
    assert.deepEqual(
      { name: standard.line_items[0].name_en, qty: standard.line_items[0].qty, unit: standard.line_items[0].unit_poisha, line: standard.line_items[0].line_poisha },
      { name: 'Shatkora Bowl', qty: 2, unit: 25000, line: 50000 },
    );
    assert.equal(priority.priority_delivery_fee_poisha, 2375);
    assert.equal(priority.delivery_fee_poisha - standard.delivery_fee_poisha, 2375);
    assert.equal(priority.cod_collect_poisha - standard.cod_collect_poisha, 2375);

    const placed = (await db.query(
      `SELECT public.place_order($1, 'b06-priority-cod-order', $2, 0, 0, true) AS receipt`,
      [customerId, priority.cod_collect_poisha],
    )).rows[0].receipt;
    assert.equal(placed.status, 'PLACED');
    assert.equal(placed.cod_collect_poisha, priority.cod_collect_poisha);
    const order = (await db.query('SELECT is_priority, delivery_fee_poisha FROM public.orders WHERE id = $1', [placed.order_id])).rows[0];
    assert.equal(order.is_priority, true);
    assert.equal(Number(order.delivery_fee_poisha), priority.delivery_fee_poisha);

    await db.query(
      `INSERT INTO public.cart_items (cart_id, menu_item_id, qty, unit_snapshot_poisha)
       VALUES ('d6008888-8888-4888-8888-888888888888', 'd6005555-5555-4555-8555-555555555555', 1, 25000)`,
    );
    await assert.rejects(
      db.query(`SELECT public.quote_customer_cart($1, 0, 0, false)`, [customerId]),
      /VOUCHER_FIRST_ORDER_ONLY/,
    );
  } finally {
    await db.close();
  }
});
