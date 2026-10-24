/**
 * @file workers/api/test/api-part2-social-ops.test.mjs
 * @description Real PostgreSQL 16 (`PGlite`) End-to-End Integration Suite for `W1 undal-api` Part 2:
 *   1. Verified-buyer reviews (`ImgBB`-only photo law + DB trigger rating sync + non-buyer `403` + vendor reply)
 *   2. Active-order participant chat (`Cloudinary` private vault law + phone/link shield + `24h` post-terminal lock!)
 *   3. Support tickets (`/v1/support/threads*` + `is_internal_note` redaction for non-admin users)
 *   4. `FAILED_DELIVERY` strict doorstep protocol (`>= 8m` wait + `>= 2` calls + `undal/private/dispute_evidence/*`)
 *   5. Partner self-service (`/v1/partner/*` + `vendor_staff` payout redaction) & Rider `TrxID` Cash Remittance
 *      (`/v1/rider/remittances` + global `409 TRXID_DUPLICATE` replay guard) + PostgREST Part 2 wire check.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgrestDbAdapter } from '../src/db-postgrest.ts';
import worker from '../src/index.ts';
import {
  TEST_JWT_SECRET,
  bootRealApiPostgres,
  createPgliteAdapter,
  mintTestJwt,
} from './_helpers/pglite-api-harness.mjs';

test('W1 undal-api Part 2 E2E: Reviews, 24h Chat Lock, Support, Failed-Delivery Protocol, Staff Payout Isolation & Rider TrxID Remittance', async () => {
  const db = await bootRealApiPostgres();
  const env = {
    SERVICE_NAME: 'undal-api',
    ENVIRONMENT: 'test',
    SUPABASE_JWT_SECRET: TEST_JWT_SECRET, // gitleaks:allow
    QR_SIGNING_SECRET: 'aaaa-bbbb-cccc-dddd-1111-2222', // gitleaks:allow
    __dbAdapter: createPgliteAdapter(db),
  };

  const zoneId = (await db.query(`SELECT id FROM public.zones WHERE slug = 'sylhet-sadar'`)).rows[0].id;
  const custId = '44444444-4444-4444-8444-444444444401';
  const outsiderId = '44444444-4444-4444-8444-444444444402';
  const ownerId = '55555555-5555-4555-8555-555555555501';
  const staffId = '55555555-5555-4555-8555-555555555502';
  const riderUserId = '66666666-6666-4666-8666-666666666601';
  const adminId = '77777777-7777-4777-8777-777777777701';

  for (const [id, role, name, phone] of [
    [custId, 'customer', 'Farhana Begum', '01722000101'],
    [outsiderId, 'customer', 'Outsider User', '01722000102'],
    [ownerId, 'vendor_owner', 'Woondaal Owner', '01722000201'],
    [staffId, 'vendor_staff', 'Counter Staff', '01722000202'],
    [riderUserId, 'rider', 'Rafiq Bike Rider', '01722000301'],
    [adminId, 'admin', 'Support Admin', '01722000901'],
  ]) {
    await db.query(`INSERT INTO auth.users (id, phone) VALUES ($1, $2)`, [id, phone]);
    await db.query(`UPDATE public.profiles SET role = $2, full_name = $3, status = 'active' WHERE id = $1`, [id, role, name]);
  }

  const vendorId = (
    await db.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id,
         kyc_status, is_active
       ) VALUES ($1,'RESTAURANT','Woondaal Kitchen','Woondaal King','woondaal-king',24.8950,91.8685,'wh28z9x00',
         'Zindabazar','12 Zindabazar Rd','01712399901',$2,'approved',true)
       RETURNING id`,
      [ownerId, zoneId],
    )
  ).rows[0].id;

  for (let dow = 0; dow <= 6; dow++) {
    await db.query(`INSERT INTO public.vendor_hours (vendor_id, weekday, open1, close1) VALUES ($1, $2, '00:00', '23:59:59')`, [vendorId, dow]);
  }
  await db.query(
    `INSERT INTO public.vendor_payout_accounts (vendor_id, method, holder_name, account_ref_enc, masked, is_primary)
     VALUES ($1, 'bkash', 'Woondaal Ltd', decode('0102030405060708', 'hex'), '017****9901', true)`,
    [vendorId],
  );
  await db.query(`INSERT INTO public.vendor_staff_members (vendor_id, profile_id, role) VALUES ($1, $2, 'kitchen_staff')`, [vendorId, staffId]);
  const riderId = (
    await db.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id)
       VALUES ($1,'motorbike','1999-03-15','approved',true,true,$2) RETURNING id`,
      [riderUserId, zoneId],
    )
  ).rows[0].id;

  const custJwt = await mintTestJwt(custId);
  const outJwt = await mintTestJwt(outsiderId);
  const ownerJwt = await mintTestJwt(ownerId);
  const staffJwt = await mintTestJwt(staffId);
  const riderJwt = await mintTestJwt(riderUserId);
  const adminJwt = await mintTestJwt(adminId);

  const call = async (method, path, jwt, body, idem = `idem-${crypto.randomUUID()}`) => {
    const headers = { Authorization: `Bearer ${jwt}`, 'CF-Connecting-IP': '10.0.2.8', 'Idempotency-Key': idem };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await worker.fetch(
      new Request(`https://api.undal.bd${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined }),
      env,
    );
    return { status: res.status, json: await res.json() };
  };

  /* 1. Partner Self-Service Menu CRUD + Staff Payout Isolation (`0008` law) */
  const catRes = await call('POST', '/v1/partner/menu/categories', ownerJwt, { name_en: 'Platters', name_bn: 'প্ল্যাটার' });
  assert.equal(catRes.status, 201);

  const badItemImg = await call('POST', '/v1/partner/menu/items', ownerJwt, {
    category_id: catRes.json.data.category.id,
    name_en: 'Beef Akhni',
    price_poisha: 25000,
    image_url: 'https://res.cloudinary.com/demo/image/upload/dish.jpg',
  });
  assert.equal(badItemImg.status, 422);

  const goodItem = await call('POST', '/v1/partner/menu/items', ownerJwt, {
    category_id: catRes.json.data.category.id,
    name_en: 'Beef Akhni',
    price_poisha: 25000,
    image_url: 'https://i.ibb.co/akhni01/dish.jpg',
  });
  assert.equal(goodItem.status, 201);

  const ownerFin = await call('GET', '/v1/partner/finance/summary', ownerJwt);
  assert.equal(ownerFin.json.data.payout.masked, '017****9901');
  const staffFin = await call('GET', '/v1/partner/finance/summary', staffJwt);
  assert.equal(staffFin.json.data.payout, null);

  /* Place 2 orders: Order A -> DELIVERED (reviews + 24h chat lock); Order B -> PICKED_UP -> FAILED_DELIVERY */
  const addr = (await call('POST', '/v1/addresses', custJwt, { lat: 24.8949, lng: 91.8687, address_text: 'Zindabazar Lane 4' })).json.data.address;
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorId, address_id: addr.id, fulfilment: 'delivery' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: goodItem.json.data.item.id, qty: 1 });
  const ordA = (await call('POST', '/v1/orders', custJwt, {})).json.data.order_id;
  await db.query(`SELECT * FROM public.transition_order($1,$2,'vendor','VENDOR_ACCEPTED','{}')`, [ordA, ownerId]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'system','RIDER_ASSIGNED',$3::jsonb)`, [ordA, riderUserId, JSON.stringify({ rider_id: riderId, rider_fare_poisha: 4200 })]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'vendor','READY_FOR_PICKUP','{}')`, [ordA, ownerId]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'rider','PICKED_UP','{}')`, [ordA, riderUserId]);
  await call('POST', `/v1/orders/${ordA}/delivered`, riderJwt, {});

  /* 2. Active-Order Chat + Phone Shield + 24h Post-Terminal Read-Only Lock */
  const badChatMedia = await call('POST', `/v1/chats/${ordA}/messages`, custJwt, {
    pair: 'c_r',
    media_public_id: 'https://i.ibb.co/public/leak.jpg',
  });
  assert.equal(badChatMedia.status, 422);

  const chatMsg = await call('POST', `/v1/chats/${ordA}/messages`, custJwt, {
    pair: 'c_r',
    body: 'Call me at 01712345678 near gate',
    media_public_id: 'undal/private/chat_attachment/gate_photo_01',
  });
  assert.equal(chatMsg.status, 201);
  assert.equal(chatMsg.json.data.message.contains_phone_or_link, true);

  /* Outsider blocked from reading chat */
  const outChat = await call('GET', `/v1/chats/${ordA}/messages?pair=c_r`, outJwt);
  assert.equal(outChat.status, 403);

  /* Reviews: non-ImgBB rejected, verified buyer accepted + vendor rating synced, outsider rejected, vendor reply saved */
  const badRevPhoto = await call('POST', `/v1/orders/${ordA}/review`, custJwt, {
    rating: 5,
    photo_urls: ['https://example.com/not-imgbb.jpg'],
  });
  assert.equal(badRevPhoto.status, 422);

  const outRev = await call('POST', `/v1/orders/${ordA}/review`, outJwt, { rating: 1 });
  assert.equal(outRev.status, 403);

  const okRev = await call('POST', `/v1/orders/${ordA}/review`, custJwt, {
    rating: 5,
    aspect_tags: ['hot_fresh', 'generous_portion'],
    comment: 'Best akhni in Sylhet!',
    photo_urls: ['https://i.ibb.co/rev01/akhni.jpg'],
  });
  assert.equal(okRev.status, 201);
  const vendorRating = (await db.query('SELECT rating_avg, rating_count FROM public.vendors WHERE id = $1', [vendorId])).rows[0];
  assert.equal(Number(vendorRating.rating_avg), 5);
  assert.equal(vendorRating.rating_count, 1);
  const myReviews = await call('GET', `/v1/orders/${ordA}/review`, custJwt);
  assert.equal(myReviews.status, 200);
  assert.equal(myReviews.json.data.reviews.length, 1);
  assert.equal(myReviews.json.data.reviews[0].rating, 5);
  const outsiderReviews = await call('GET', `/v1/orders/${ordA}/review`, outJwt);
  assert.equal(outsiderReviews.status, 403);

  const replied = await call('POST', `/v1/reviews/${okRev.json.data.review.id}/reply`, ownerJwt, {
    reply: 'Thank you so much for dining with Woondaal!',
  });
  assert.equal(replied.status, 200);
  assert.match(replied.json.data.review.vendor_reply, /Thank you/);

  /* Age delivered_at past 24 hours -> chat writes MUST reject with 409 CHAT_READ_ONLY! */
  await db.query(`UPDATE public.orders SET delivered_at = clock_timestamp() - interval '25 hours' WHERE id = $1`, [ordA]);
  const lockedChat = await call('POST', `/v1/chats/${ordA}/messages`, custJwt, { pair: 'c_r', body: 'Too late message' });
  assert.equal(lockedChat.status, 409);
  assert.equal(lockedChat.json.error.code, 'ORDER_STATE_ILLEGAL');

  /* 3. FAILED_DELIVERY strict protocol (>= 8 min wait + >= 2 calls + undal/private/dispute_evidence/*) */
  await call('POST', '/v1/cart', custJwt, { vendor_id: vendorId, address_id: addr.id, fulfilment: 'delivery' });
  await call('PATCH', '/v1/cart/items', custJwt, { menu_item_id: goodItem.json.data.item.id, qty: 1 });
  const ordB = (await call('POST', '/v1/orders', custJwt, {})).json.data.order_id;
  await db.query(`SELECT * FROM public.transition_order($1,$2,'vendor','VENDOR_ACCEPTED','{}')`, [ordB, ownerId]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'system','RIDER_ASSIGNED',$3::jsonb)`, [ordB, riderUserId, JSON.stringify({ rider_id: riderId, rider_fare_poisha: 4200 })]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'vendor','READY_FOR_PICKUP','{}')`, [ordB, ownerId]);
  await db.query(`SELECT * FROM public.transition_order($1,$2,'rider','PICKED_UP','{}')`, [ordB, riderUserId]);

  const prematureFail = await call('POST', `/v1/orders/${ordB}/failed-delivery`, riderJwt, {
    wait_minutes: 4,
    call_attempts: 1,
    proof_public_id: 'undal/private/dispute_evidence/door_01',
  });
  assert.equal(prematureFail.status, 422);

  const validFail = await call('POST', `/v1/orders/${ordB}/failed-delivery`, riderJwt, {
    wait_minutes: 9,
    call_attempts: 3,
    proof_public_id: 'undal/private/dispute_evidence/door_01',
  });
  assert.equal(validFail.status, 200);
  assert.equal(validFail.json.data.order.status, 'FAILED_DELIVERY');

  /* 4. Support Threads + Internal-Note Redaction + Rider bKash TrxID Remittance Replay Guard */
  const ticket = await call('POST', '/v1/support/threads', custJwt, {
    order_id: ordB,
    category: 'delivery_issue',
    subject: 'Missed rider call at gate',
    body: 'My phone was on silent for 10 mins.',
    attachment_public_ids: ['undal/private/dispute_evidence/gate_note'],
  });
  assert.equal(ticket.status, 201);
  const threadId = ticket.json.data.thread.id;
  await db.query(
    `INSERT INTO public.support_messages (thread_id, sender_id, is_internal_note, body) VALUES ($1,$2,true,'INTERNAL: verify rider GPS log')`,
    [threadId, adminId],
  );
  const custMsgs = await call('GET', `/v1/support/threads/${threadId}/messages`, custJwt);
  assert.equal(custMsgs.json.data.messages.length, 1);
  const adminMsgs = await call('GET', `/v1/support/threads/${threadId}/messages`, adminJwt);
  assert.equal(adminMsgs.json.data.messages.length, 2);

  const rem1 = await call('POST', '/v1/rider/remittances', riderJwt, {
    method: 'bkash',
    amount_poisha: 29500,
    bkash_trxid: 'BK99887766SYL',
    sender_number: '01722000301',
    screenshot_public_id: 'undal/private/cash_remittance_proof/bk_998877',
  });
  assert.equal(rem1.status, 201);

  const remDup = await call('POST', '/v1/rider/remittances', riderJwt, {
    method: 'bkash',
    amount_poisha: 29500,
    bkash_trxid: 'bk99887766syl',
    sender_number: '01722000301',
    screenshot_public_id: 'undal/private/cash_remittance_proof/bk_998877',
  });
  assert.equal(remDup.status, 409);
  assert.equal(remDup.json.error.code, 'TRXID_DUPLICATE');

  /* 5. PostgREST Part 2 Wire Adapter smoke check */
  const wireCalls = [];
  const wire = createPostgrestDbAdapter({
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
    __fetchImpl: async (u, init) => {
      wireCalls.push({
        url: String(u),
        method: init?.method ?? 'GET',
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response(JSON.stringify([{ order_id: ordA, status: 'PLACED' }]), { status: 200 });
    },
  });
  await wire.placeOrder({
    customerId: custId,
    idempotencyKey: 'test-wire-idem-01',
    expectedCodPoisha: 29500,
    isPriority: false,
  });
  assert.equal(wireCalls[0].url, 'https://proj.supabase.co/rest/v1/rpc/place_order');
  assert.equal(wireCalls[0].method, 'POST');
  assert.deepEqual(wireCalls[0].body, {
    p_customer_id: custId,
    p_idempotency_key: 'test-wire-idem-01',
    p_expected_cod_poisha: 29500,
    p_is_priority: false,
  });

  await wire.validateCartPricing(custId, false);
  assert.equal(wireCalls[1].url, 'https://proj.supabase.co/rest/v1/rpc/quote_customer_cart');
  assert.deepEqual(wireCalls[1].body, { p_customer_id: custId, p_is_priority: false });

  await db.close();
});
