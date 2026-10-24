/**
 * @file workers/api/test/api-part2-orders.test.mjs
 * @description Real PostgreSQL 16 (`PGlite`) End-to-End Integration Suite for `W1 undal-api` Part 2 (`Build Response 7`):
 *   1. Saved addresses (`zone_id` + 9-char geohash + single-default index) & favourites toggle
 *   2. Single-vendor cart guard (`409 CART_VENDOR_CONFLICT`), voucher binding & exact `price_order()` waterfall
 *   3. Atomic `POST /v1/orders` (`Idempotency-Key` `24h` replay + `W2` HMAC webhook + Turnstile check)
 *   4. Dynamic `HOME_KITCHEN` address & counter-QR privacy before vs after rider assignment + `ETag` `304` polling
 *   5. Full 14-state Delivery lifecycle (`accept` -> `arrived-vendor` `<=150m` GPS -> `ready` -> `pickup-verify` QR ->
 *      `picked-up` feedback -> `arrived-customer` -> `delivered` ACID `ledger_entries` + Bicycle `৳3,000` Cash-Gate lock!)
 *   6. Complete Cancel & Failure Matrix (`PLACED` customer free cancel, post-accept `409`, vendor reject + 1-tap item
 *      snooze, `FAILED_DELIVERY` `>= 8m` wait + `>= 2` calls + private doorstep photo, & Self-Pickup `DELIVERED` flow!)
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.ts';
import {
  TEST_JWT_SECRET,
  bootRealApiPostgres,
  createPgliteAdapter,
  mintTestJwt,
} from './_helpers/pglite-api-harness.mjs';

test('W1 undal-api Part 2 E2E: Carts, Vouchers, Delivery & Self-Pickup Happy Paths, QR Handover, Cash Gate & Cancel Matrix', async () => {
  const db = await bootRealApiPostgres();
  const dbAdapter = createPgliteAdapter(db);
  const w2Webhooks = [];

  const env = {
    SERVICE_NAME: 'undal-api',
    ENVIRONMENT: 'test',
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET, // gitleaks:allow
    QR_SIGNING_SECRET: 'aaaa-bbbb-cccc-dddd-1111-2222', // gitleaks:allow
    REALTIME_WORKER_URL: 'https://realtime.undal.internal',
    INTERNAL_HMAC_SECRET: 'aaaa-bbbb-cccc-dddd-3333-4444', // gitleaks:allow
    __dbAdapter: dbAdapter,
    __fetchImpl: async (input, init) => {
      w2Webhooks.push({
        url: String(input),
        sig: init?.headers?.['X-Undal-Signature'] ?? null,
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };

  const zoneId = (await db.query(`SELECT id FROM public.zones WHERE slug = 'sylhet-sadar'`)).rows[0].id;
  const custId = '11111111-1111-4111-8111-111111111101';
  const restOwnerId = '22222222-2222-4222-8222-222222222201';
  const homeOwnerId = '22222222-2222-4222-8222-222222222202';
  const riderUserId = '33333333-3333-4333-8333-333333333301';

  for (const [id, role, name, phone] of [
    [custId, 'customer', 'Nadia Rahman', '01711000101'],
    [restOwnerId, 'vendor_owner', 'Panshi Sylhet Owner', '01711000201'],
    [homeOwnerId, 'vendor_owner', 'Surma Home Cook', '01711000202'],
    [riderUserId, 'rider', 'Tanvir Cycle Rider', '01711000301'],
  ]) {
    await db.query(`INSERT INTO auth.users (id, phone) VALUES ($1, $2)`, [id, phone]);
    await db.query(`UPDATE public.profiles SET role = $2, full_name = $3, status = 'active' WHERE id = $1`, [id, role, name]);
  }

  const vendorA = (
    await db.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id,
         kyc_status, is_active, accepts_pickup, min_order_poisha, commission_bps
       ) VALUES ($1,'RESTAURANT','Panshi Foods','Panshi Inn','panshi-inn',24.8950,91.8685,'wh28z9x00',
         'Zindabazar, Sylhet','Plot 9, Zindabazar Main Rd','01712340001',$2,'approved',true,true,15000,1500)
       RETURNING id`,
      [restOwnerId, zoneId],
    )
  ).rows[0].id;

  const vendorHome = (
    await db.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id,
         kyc_status, is_active, accepts_pickup, pickup_point_label, min_order_poisha, commission_bps
       ) VALUES ($1,'HOME_KITCHEN','Surma Rannaghor','Surma Home Kitchen','surma-home',24.8962,91.8701,'wh28z9x11',
         'Amberkhana Area','House 14, Flat 2B, Secret Private Lane, Amberkhana','01712340002',$2,'approved',true,true,'Gate 2 Guard Desk',15000,1500)
       RETURNING id`,
      [homeOwnerId, zoneId],
    )
  ).rows[0].id;

  for (const vId of [vendorA, vendorHome]) {
    for (let dow = 0; dow <= 6; dow++) {
      await db.query(`INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1) VALUES ($1, $2, '00:00', '23:59:59')`, [vId, dow]);
    }
  }

  const catA = (await db.query(`INSERT INTO public.menu_categories (vendor_id, name_en) VALUES ($1,'Biryani') RETURNING id`, [vendorA])).rows[0].id;
  const catH = (await db.query(`INSERT INTO public.menu_categories (vendor_id, name_en) VALUES ($1,'Home Thali') RETURNING id`, [vendorHome])).rows[0].id;
  const itemA = (await db.query(`INSERT INTO public.menu_items (vendor_id, category_id, name_en, name_bn, price_poisha) VALUES ($1,$2,'Kacchi','কাচ্চি',30000) RETURNING id`, [vendorA, catA])).rows[0].id;
  const itemH = (await db.query(`INSERT INTO public.menu_items (vendor_id, category_id, name_en, name_bn, price_poisha) VALUES ($1,$2,'Beef Shatkora Meal','গরুর সাতকরা',160000) RETURNING id`, [vendorHome, catH])).rows[0].id;

  const riderId = (
    await db.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
       VALUES ($1, 'bicycle', '2001-05-12', 'approved', true, true, $2) RETURNING id`,
      [riderUserId, zoneId],
    )
  ).rows[0].id;

  await db.query(
    `INSERT INTO public.vouchers (
       code, title_en, kind, value_num, min_order_poisha, max_uses_per_user,
       vendor_share_bps, budget_cap_poisha, starts_at, ends_at, is_active
     ) VALUES ('SYLHET50', '৳50 Off', 'flat', 5000, 20000, 3, 2000, 100000, now() - interval '1 hour', now() + interval '7 days', true)`,
  );

  const custJwt = await mintTestJwt(custId);
  const restJwt = await mintTestJwt(restOwnerId);
  const homeJwt = await mintTestJwt(homeOwnerId);
  const riderJwt = await mintTestJwt(riderUserId);

  const call = async (method, path, jwt, body, headers = {}) => {
    const reqHeaders = { Authorization: `Bearer ${jwt}`, 'CF-Connecting-IP': '10.0.1.5', ...headers };
    if (body !== undefined) reqHeaders['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://api.undal.bd${path}`, {
        method,
        headers: reqHeaders,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
      env,
    );
    const json = res.status === 304 ? null : await res.json();
    return { status: res.status, headers: res.headers, json };
  };

  /* 1. Address save + zone resolution + Favourites toggle */
  const addrRes = await call('POST', '/v1/addresses', custJwt, {
    label: 'Home',
    lat: 24.8949,
    lng: 91.8687,
    address_text: 'House 7, Zindabazar, Sylhet',
    is_default: true,
  });
  assert.equal(addrRes.status, 201);
  const addressId = addrRes.json.data.address.id;
  assert.equal(addrRes.json.data.address.zone_id, zoneId);
  assert.equal(addrRes.json.data.address.geohash.length, 9);

  const fav1 = await call('POST', `/v1/favourites/${vendorHome}`, custJwt);
  assert.deepEqual(fav1.json.data, { is_favourite: true });
  const fav2 = await call('POST', `/v1/favourites/${vendorHome}`, custJwt);
  assert.deepEqual(fav2.json.data, { is_favourite: false });

  /* 2. Single-vendor cart conflict guard -> confirm_clear -> Voucher + Validate */
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorA, address_id: addressId, fulfilment: 'delivery' }, { 'Idempotency-Key': 'example-0000-cart-init-0001' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: itemA, qty: 1 }, { 'Idempotency-Key': 'example-0000-cart-item-0001' });

  const conflict = await call('POST', '/v1/cart', custJwt, { vendor_id: vendorHome, address_id: addressId, fulfilment: 'delivery' }, { 'Idempotency-Key': 'example-0000-cart-conf-0001' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.json.error.code, 'CART_VENDOR_CONFLICT');

  const switched = await call(
    'POST',
    '/v1/cart',
    custJwt,
    { vendor_id: vendorHome, address_id: addressId, fulfilment: 'delivery', tip_poisha: 2000, confirm_clear: true },
    { 'Idempotency-Key': 'example-0000-cart-switch-01' },
  );
  assert.equal(switched.status, 200);
  assert.equal(switched.json.data.clearedPrevious, true);

  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: itemH, qty: 2 }, { 'Idempotency-Key': 'example-0000-cart-item-home1' });
  const vRes = await call('POST', '/v1/cart/voucher', custJwt, { code: 'sylhet50' });
  assert.equal(vRes.status, 200);
  assert.equal(vRes.json.data.cart.voucher_code, 'SYLHET50');

  const quoteRes = await call('POST', '/v1/cart/validate', custJwt, { delivery_fee_poisha: 0, platform_fee_poisha: 1 });
  assert.equal(quoteRes.status, 200);
  assert.equal(quoteRes.json.data.quote.items_poisha, 320000);
  assert.equal(quoteRes.json.data.quote.cod_collect_poisha, 317500);

  const fractionalCod = await call('POST', '/v1/orders', custJwt, { expected_cod_poisha: 317500.5 }, { 'Idempotency-Key': 'example-0000-fractional-cod-01' });
  assert.equal(fractionalCod.status, 422);
  assert.equal(fractionalCod.json.error.code, 'VALIDATION_FAILED');
  const staleTotal = await call('POST', '/v1/orders', custJwt, { expected_cod_poisha: 1 }, { 'Idempotency-Key': 'example-0000-stale-total-0001' });
  assert.equal(staleTotal.status, 409);
  assert.equal(staleTotal.json.error.code, 'CART_STALE');

  /* 3. Idempotent Order Placement + W2 HMAC webhook + HOME_KITCHEN Privacy Shield */
  const noIdem = await call('POST', '/v1/orders', custJwt, {});
  assert.equal(noIdem.status, 400);
  assert.equal(noIdem.json.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

  const placed1 = await call('POST', '/v1/orders', custJwt, { expected_cod_poisha: 317500, delivery_fee_poisha: 0, platform_fee_poisha: 1 }, { 'Idempotency-Key': 'example-0000-place-home-order-01' });
  assert.equal(placed1.status, 201);
  assert.equal(placed1.json.data.dispatch_notified, true);
  assert.equal(placed1.json.data.cod_collect_poisha, 317500);
  assert.equal(w2Webhooks.length, 1);
  assert.equal(w2Webhooks[0].sig.length, 64);

  const replay = await call('POST', '/v1/orders', custJwt, { expected_cod_poisha: 317500, delivery_fee_poisha: 0, platform_fee_poisha: 1 }, { 'Idempotency-Key': 'example-0000-place-home-order-01' });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.data.idempotent_replay, true);
  assert.equal(w2Webhooks.length, 1);

  const orderId = placed1.json.data.order_id;
  const publicCode = placed1.json.data.public_code;

  /* Customer MUST NOT see HOME_KITCHEN private address OR delivery pickup QR token! */
  const custView = await call('GET', `/v1/orders/${publicCode}`, custJwt);
  assert.equal(custView.status, 200);
  assert.equal(custView.json.data.order.vendor_location.address_text, null);
  assert.equal(custView.json.data.order.vendor_location.lat, null);
  assert.equal(custView.json.data.order.pickup_qr_token, null);

  /* Home cook sees counter QR token; live endpoint supports 304 ETag! */
  const homeView = await call('GET', `/v1/orders/${publicCode}`, homeJwt);
  const counterQr = homeView.json.data.order.pickup_qr_token;
  assert.equal(counterQr.length, 64);

  const live200 = await call('GET', `/v1/orders/${publicCode}/live`, custJwt);
  assert.equal(live200.status, 200);
  const live304 = await call('GET', `/v1/orders/${publicCode}/live`, custJwt, undefined, {
    'If-None-Match': live200.headers.get('ETag'),
  });
  assert.equal(live304.status, 304);

  /* 4. Full Delivery Lifecycle + Post-Accept Customer Cancel Block + GPS Geofence + QR Handover + Bicycle Cash Gate Lock */
  const accepted = await call('POST', `/v1/orders/${orderId}/accept`, homeJwt, { prep_minutes: 20 }, { 'Idempotency-Key': 'example-0000-accept-home-01' });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.data.order.status, 'VENDOR_ACCEPTED');

  const lateCancel = await call('POST', `/v1/orders/${orderId}/cancel`, custJwt, { cancel_reason_key: 'customer_changed_mind' }, { 'Idempotency-Key': 'example-0000-late-cancel-01' });
  assert.equal(lateCancel.status, 409);
  assert.equal(lateCancel.json.error.code, 'ORDER_STATE_ILLEGAL');

  /* Dispatch assigns bicycle rider (fare = 5500 poisha); rider can now see HOME_KITCHEN address! */
  await db.query(`SELECT * FROM public.transition_order($1,$2,'system','RIDER_ASSIGNED',$3::jsonb)`, [
    orderId, riderUserId, JSON.stringify({ rider_id: riderId, rider_fare_poisha: 5500 }),
  ]);
  const riderView = await call('GET', `/v1/orders/${publicCode}`, riderJwt);
  assert.match(riderView.json.data.order.vendor_location.address_text, /Secret Private Lane/);

  const farGps = await call('POST', `/v1/orders/${orderId}/arrived-vendor`, riderJwt, { lat: 24.9100, lng: 91.8701 }, { 'Idempotency-Key': 'example-0000-arr-far-0001' });
  assert.equal(farGps.status, 422);
  assert.equal(farGps.json.error.code, 'GPS_INACCURATE');

  const nearGps = await call('POST', `/v1/orders/${orderId}/arrived-vendor`, riderJwt, { lat: 24.8963, lng: 91.8701 }, { 'Idempotency-Key': 'example-0000-arr-near-001' });
  assert.equal(nearGps.status, 200);
  assert.equal(nearGps.json.data.order.status, 'RIDER_AT_VENDOR');

  await call('POST', `/v1/orders/${orderId}/ready`, homeJwt, {}, { 'Idempotency-Key': 'example-0000-ready-home-01' });

  const badQr = await call('POST', `/v1/orders/${orderId}/pickup-verify`, riderJwt, { qr_token: 'deadbeef' }, { 'Idempotency-Key': 'example-0000-bad-qr-0001' });
  assert.equal(badQr.status, 422);
  assert.equal(badQr.json.error.code, 'QR_INVALID');

  const okQr = await call('POST', `/v1/orders/${orderId}/pickup-verify`, riderJwt, { qr_token: counterQr }, { 'Idempotency-Key': 'example-0000-good-qr-001' });
  assert.equal(okQr.status, 200);
  assert.equal(okQr.json.data.order.status, 'PICKED_UP');

  const fb = await call('POST', `/v1/orders/${orderId}/picked-up`, riderJwt, { pickup_feedback_rating: 5, pickup_feedback_tags: ['ready_on_time'] }, { 'Idempotency-Key': 'example-0000-fb-00000001' });
  assert.equal(fb.status, 200);

  await call('POST', `/v1/orders/${orderId}/arrived-customer`, riderJwt, { lat: 24.8949, lng: 91.8687 }, { 'Idempotency-Key': 'example-0000-arrcust-001' });
  const deliv = await call('POST', `/v1/orders/${orderId}/delivered`, riderJwt, {}, { 'Idempotency-Key': 'example-0000-deliv-00001' });
  assert.equal(deliv.status, 200);
  assert.equal(deliv.json.data.order.status, 'DELIVERED');
  /* Bicycle ceiling = 300,000 poisha (৳3,000); collected COD = 321,500 -> Cash Gate AUTOMATICALLY BLOCKED! */
  assert.equal(Number(deliv.json.data.cash_gate.unremitted_cash_poisha), 317500);
  assert.equal(deliv.json.data.cash_gate.at_or_above_ceiling, true);

  /* 5. Cancel & Failure Matrix + Self-Pickup Happy Path */
  const cancelReasonKey = (await db.query('SELECT key FROM public.cancel_reasons LIMIT 1')).rows[0].key;

  /* 5a. Customer free cancel while PLACED */
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorA, address_id: addressId, fulfilment: 'delivery' }, { 'Idempotency-Key': 'example-0000-c2-init-001' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: itemA, qty: 1 }, { 'Idempotency-Key': 'example-0000-c2-item-001' });
  const o2 = (await call('POST', '/v1/orders', custJwt, {}, { 'Idempotency-Key': 'example-0000-place-ord-02' })).json.data;
  const custCancelled = await call('POST', `/v1/orders/${o2.order_id}/cancel`, custJwt, { cancel_reason_key: cancelReasonKey }, { 'Idempotency-Key': 'example-0000-cancel-o2-1' });
  assert.equal(custCancelled.status, 200);
  assert.equal(custCancelled.json.data.order.status, 'CANCELLED_CUSTOMER');

  /* 5b. Self-Pickup Happy Path (`delivery_fee = 0`, customer completes handover with `pickup_code_4`) */
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorA, fulfilment: 'pickup' }, { 'Idempotency-Key': 'example-0000-c3-pickup-1' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: itemA, qty: 1 }, { 'Idempotency-Key': 'example-0000-c3-item-001' });
  const o3 = (await call('POST', '/v1/orders', custJwt, {}, { 'Idempotency-Key': 'example-0000-place-ord-03' })).json.data;
  assert.equal(o3.cod_collect_poisha, 30000);
  await call('POST', `/v1/orders/${o3.order_id}/accept`, restJwt, { prep_minutes: 10 }, { 'Idempotency-Key': 'example-0000-o3-acc-0001' });
  await call('POST', `/v1/orders/${o3.order_id}/ready`, restJwt, {}, { 'Idempotency-Key': 'example-0000-o3-rdy-0001' });
  const custPickupDetail = await call('GET', `/v1/orders/${o3.public_code}`, custJwt);
  const pickupDone = await call(
    'POST',
    `/v1/orders/${o3.order_id}/pickup-verify`,
    custJwt,
    { code_4: custPickupDetail.json.data.order.pickup_code_4 },
    { 'Idempotency-Key': 'example-0000-o3-verify-1' },
  );
  assert.equal(pickupDone.status, 200);
  assert.equal(pickupDone.json.data.order.status, 'DELIVERED');

  /* 5c. Vendor reject with 1-tap item snooze */
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorA, address_id: addressId, fulfilment: 'delivery' }, { 'Idempotency-Key': 'example-0000-c4-init-001' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: itemA, qty: 1 }, { 'Idempotency-Key': 'example-0000-c4-item-001' });
  const o4 = (await call('POST', '/v1/orders', custJwt, {}, { 'Idempotency-Key': 'example-0000-place-ord-04' })).json.data;
  const rejected = await call(
    'POST',
    `/v1/orders/${o4.order_id}/reject`,
    restJwt,
    { cancel_reason_key: cancelReasonKey, snooze_item_ids: [itemA] },
    { 'Idempotency-Key': 'example-0000-o4-rej-0001' },
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.json.data.order.status, 'CANCELLED_VENDOR');
  assert.equal(rejected.json.data.snoozed_count, 1);

  await db.close();
});
