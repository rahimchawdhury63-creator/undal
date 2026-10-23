/**
 * @file workers/realtime/test/realtime-e2e-pg16.test.mjs
 * @description End-to-End integration test suite for `W2 undal-realtime` against **real PostgreSQL 16**
 * (`PGlite` WASM) + `ZoneDispatchDO` + `createRealtimePostgrestAdapter` wire protocol:
 * - Rider pre-flight session start/end (`KYC_INCOMPLETE`, `GPS_INACCURATE`, `CASH_GATE_ACTIVE` `CSH-01`)
 * - Presence heartbeat ingest (`POST /v1/presence/ping`) into `UNLOGGED public.presence_live`
 * - `HMAC`-verified `POST /v1/dispatch/order-placed` + atomic race-free `accept` + `DSP-01` cascade
 * - `DSP-02` (`D-23` Solo-Rider protection -> `409 OFFER_NOT_REJECTABLE` vs `request_reassign`)
 * - `DSP-03` Multi-order bundled `order_batches` dispatch & assignment
 * - `ORD-02` `120s` unreachable kitchen auto-cancel via `scheduled()` cron sweep
 * - `GET /v1/zone/:id/sdr` + `/v1/geo/{geocode,reverse,route}` + `createRealtimePostgrestAdapter`
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  createLocalZoneDispatchNamespace,
  createRealtimePostgrestAdapter,
  resetNominatimGate,
  resetRealtimeRateLimits,
  signInternalPayload,
} from '../src/index.ts';
import { resetZoneSdrCache } from '../src/routes/dispatch-geo.ts';
import {
  bootRealRealtimePostgres,
  createPgliteRealtimeAdapter,
  EXAMPLE_INTERNAL_HMAC_SECRET,
  EXAMPLE_JWT_SECRET,
  mintRealtimeJwt,
} from './_helpers/pglite-realtime-harness.mjs';

test('W2 undal-realtime E2E on Real PostgreSQL 16 + ZoneDispatchDO: Sessions, Cash Gate, Dispatch Cascade, D-23, Batching, ORD-02 & Geo', async () => {
  resetRealtimeRateLimits();
  resetNominatimGate();
  resetZoneSdrCache();

  const pg = await bootRealRealtimePostgres();
  const dbAdapter = createPgliteRealtimeAdapter(pg);
  let clockMs = Date.parse('2026-10-23T13:00:00Z');

  const zoneId = (await pg.query(`SELECT id FROM public.zones WHERE slug = 'sylhet-sadar' LIMIT 1`)).rows[0].id;
  const custId = '00000000-0000-4000-8000-000000000101';
  const vendOwnerId = '00000000-0000-4000-8000-000000000201';
  const rider1ProfId = '00000000-0000-4000-8000-000000000301';
  const rider2ProfId = '00000000-0000-4000-8000-000000000302';

  for (const [id, role, name, phone] of [
    [custId, 'customer', 'Tanvir Customer', '01711000101'],
    [vendOwnerId, 'vendor_owner', 'Panshi Owner', '01711000201'],
    [rider1ProfId, 'rider', 'Karim Rider One', '01711000301'],
    [rider2ProfId, 'rider', 'Rahim Rider Two', '01711000302'],
  ]) {
    await pg.query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, `${id}@example.com`]);
    await pg.query(
      `INSERT INTO public.profiles (id, role, status, full_name, phone) VALUES ($1, $2, 'active', $3, $4)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = 'active', full_name = EXCLUDED.full_name, phone = EXCLUDED.phone`,
      [id, role, name, phone],
    );
  }

  const vendorId = (
    await pg.query(
      `INSERT INTO public.vendors (
         owner_profile_id, type, legal_name, brand_name, slug, lat, lng, geohash,
         public_area_label, address_text_private, counter_phone, zone_id,
         kyc_status, is_active, accepts_pickup, min_order_poisha, commission_bps
       ) VALUES ($1, 'RESTAURANT', 'Panshi Foods', 'Panshi Inn', 'panshi-w2', 24.8949, 91.8687, 'wh28z9x00',
         'Zindabazar, Sylhet', 'Plot 9 Zindabazar', '01712340001', $2, 'approved', true, true, 15000, 1500)
       RETURNING id`,
      [vendOwnerId, zoneId],
    )
  ).rows[0].id;

  const rider1Id = (
    await pg.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id, rating_avg, rating_count)
       VALUES ($1, 'motorbike', '1998-05-10', 'approved', true, false, $2, 4.90, 50) RETURNING id`,
      [rider1ProfId, zoneId],
    )
  ).rows[0].id;

  const rider2Id = (
    await pg.query(
      `INSERT INTO public.riders (profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id, rating_avg, rating_count)
       VALUES ($1, 'motorbike', '1999-02-14', 'approved', true, false, $2, 4.70, 30) RETURNING id`,
      [rider2ProfId, zoneId],
    )
  ).rows[0].id;

  const mockUpstreamFetch = async (input) => {
    const u = String(input);
    if (u.includes('/weatherapi/locationforecast/')) {
      return Response.json({
        properties: {
          timeseries: [{ data: { instant: { details: { air_temperature: 29 } }, next_1_hours: { details: { precipitation_amount: 1.8 } } } }],
        },
      });
    }
    if (u.includes('/search?')) {
      return Response.json([{ display_name: 'Zindabazar Point, Sylhet', lat: '24.89490', lon: '91.86870' }]);
    }
    if (u.includes('/reverse?')) return Response.json({ display_name: 'Amberkhana, Sylhet' });
    if (u.includes('/route/v1/')) {
      return Response.json({ routes: [{ distance: 2600, duration: 480, geometry: 'poly_syl_01' }] });
    }
    return new Response('not found', { status: 404 });
  };

  let env = null;
  const localDoNs = createLocalZoneDispatchNamespace(() => env, (e) => e.dbAdapter);
  env = {
    SERVICE_NAME: 'undal-realtime',
    RTDB_LEASE_HARD_CAP: '85',
    SUPABASE_JWT_SECRET: EXAMPLE_JWT_SECRET,
    INTERNAL_HMAC_SECRET: EXAMPLE_INTERNAL_HMAC_SECRET,
    NOMINATIM_CONTACT_EMAIL: 'ops@example.com',
    ZONE_DISPATCH: localDoNs,
    dbAdapter,
    fetchImpl: mockUpstreamFetch,
    nowMs: () => clockMs,
  };

  const callW2 = (path, init = {}) => worker.fetch(new Request(`https://realtime.undal.app${path}`, init), env);
  const authJson = (jwt, idemKey, extra = {}) => ({
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    ...(idemKey ? { 'Idempotency-Key': idemKey } : {}),
    ...extra,
  });

  const rider1Jwt = await mintRealtimeJwt(rider1ProfId, clockMs);
  const rider2Jwt = await mintRealtimeJwt(rider2ProfId, clockMs);
  const vendorJwt = await mintRealtimeJwt(vendOwnerId, clockMs);

  // 1. Pre-flight blocks motorbike without driving_license (`KYC_INCOMPLETE` 403):
  const blockedNoLic = await callW2('/v1/riders/session/start', {
    method: 'POST',
    headers: authJson(rider1Jwt, 'example-0000-0101'),
    body: JSON.stringify({ lat: 24.8951, lng: 91.8690, accuracy_m: 12, selfie_public_id: 'undal/private/rider_shift_selfie/r1' }),
  });
  assert.equal(blockedNoLic.status, 403);
  assert.equal((await blockedNoLic.json()).error.code, 'KYC_INCOMPLETE');

  for (const [rId, pId, tag] of [
    [rider1Id, rider1ProfId, 'undal/private/rider_shift_selfie/r1'],
    [rider2Id, rider2ProfId, 'undal/private/rider_shift_selfie/r2'],
  ]) {
    await pg.query(
      `INSERT INTO public.rider_documents (rider_id, doc_type, storage_path, review_status, expires_on)
       VALUES ($1, 'driving_license', 'undal/private/rider_kyc/lic', 'approved', '2028-12-31')`,
      [rId],
    );
    await pg.query(
      `INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, bytes)
       VALUES ($1, 'cloudinary', 'rider_shift_selfie', 'authenticated', $2, 42000)`,
      [pId, tag],
    );
  }

  // Rejects inaccurate GPS > 50m (`GPS_INACCURATE` 422):
  const badGps = await callW2('/v1/riders/session/start', {
    method: 'POST',
    headers: authJson(rider1Jwt, 'example-0000-0102'),
    body: JSON.stringify({ lat: 24.8951, lng: 91.8690, accuracy_m: 95, selfie_public_id: 'undal/private/rider_shift_selfie/r1' }),
  });
  assert.equal(badGps.status, 422);
  assert.equal((await badGps.json()).error.code, 'GPS_INACCURATE');

  // Both riders start online sessions + idempotent replay verified:
  const startBodyR1 = JSON.stringify({ lat: 24.8950, lng: 91.8689, accuracy_m: 10, selfie_public_id: 'undal/private/rider_shift_selfie/r1' });
  assert.equal((await callW2('/v1/riders/session/start', { method: 'POST', headers: authJson(rider1Jwt, 'example-0000-0103'), body: startBodyR1 })).status, 200);
  const startR1Replay = await callW2('/v1/riders/session/start', { method: 'POST', headers: authJson(rider1Jwt, 'example-0000-0103'), body: startBodyR1 });
  assert.equal(startR1Replay.headers.get('X-Idempotent-Replay'), 'true');

  assert.equal(
    (
      await callW2('/v1/riders/session/start', {
        method: 'POST',
        headers: authJson(rider2Jwt, 'example-0000-0104'),
        body: JSON.stringify({ lat: 24.9090, lng: 91.8820, accuracy_m: 12, selfie_public_id: 'undal/private/rider_shift_selfie/r2' }),
      })
    ).status,
    200,
  );

  // Vendor heartbeat writes `LIVE` state in `UNLOGGED public.presence_live`:
  const vendPing = await callW2('/v1/presence/ping', {
    method: 'POST',
    headers: authJson(vendorJwt, null),
    body: JSON.stringify({ kind: 'vendor', lat: 24.8949, lng: 91.8687, app_state: 'fg' }),
  });
  assert.equal((await vendPing.json()).data.status, 'LIVE');

  async function insertOrder(codeSuffix, lat = 24.9012, lng = 91.8715, status = 'VENDOR_ACCEPTED') {
    const row = (
      await pg.query(
        `INSERT INTO public.orders (
           public_code, customer_id, vendor_id, zone_id, fulfilment, status,
           address_snapshot, vendor_snapshot, items_poisha, discount_total_poisha,
           discount_vendor_poisha, discount_platform_poisha, delivery_fee_poisha,
           platform_fee_poisha, tip_poisha, tax_extracted_poisha, cod_collect_poisha,
           commission_poisha, vendor_net_poisha, undal_margin_poisha,
           pickup_qr_nonce, pickup_code_4, prep_minutes_committed, placed_at
         ) VALUES (
           $1, $2, $3, $4, 'delivery', $5,
           jsonb_build_object('lat', $6::float8, 'lng', $7::float8),
           '{"lat":24.8949,"lng":91.8687}'::jsonb,
           30000, 0, 0, 0, 6000, 500, 0, 1429, 36500, 4500, 25500, 5000,
           '0123456789abcdef0123', '4821', 15, $8
         ) RETURNING id`,
        [`UD-SYL-261023-${codeSuffix}`, custId, vendorId, zoneId, status, lat, lng, new Date(clockMs).toISOString()],
      )
    ).rows[0];
    return row.id;
  }

  async function triggerDispatch(orderId) {
    const raw = JSON.stringify({ order_id: orderId, zone_id: zoneId, vendor_profile_id: vendOwnerId });
    const sig = await signInternalPayload(raw, clockMs, EXAMPLE_INTERNAL_HMAC_SECRET);
    return callW2('/v1/dispatch/order-placed', {
      method: 'POST',
      headers: { 'X-Undal-Internal-Signature': sig, 'X-Undal-Timestamp': String(clockMs) },
      body: raw,
    });
  }

  // 2. DSP-01: Dispatch Order #1 -> reject invalid HMAC -> valid HMAC -> Rider 1 rejects -> cascades to Rider 2 -> atomic race!
  const ord1 = await insertOrder('3101');
  const badHmacRes = await callW2('/v1/dispatch/order-placed', {
    method: 'POST',
    headers: { 'X-Undal-Internal-Signature': 'deadbeef', 'X-Undal-Timestamp': String(clockMs) },
    body: JSON.stringify({ order_id: ord1, zone_id: zoneId }),
  });
  assert.equal(badHmacRes.status, 401);

  const dispData1 = (await (await triggerDispatch(ord1)).json()).data;
  assert.equal(dispData1.offer.riderId, rider1Id);
  assert.equal(dispData1.offer.soloRider, false);

  const rejData1 = (
    await (
      await callW2(`/v1/offers/${dispData1.offer.id}/reject`, {
        method: 'POST',
        headers: authJson(rider1Jwt, 'example-0000-0105'),
        body: JSON.stringify({ reason: 'too_far' }),
      })
    ).json()
  ).data;
  assert.equal(rejData1.cascadedOffer.riderId, rider2Id);

  const [raceWin, raceLose] = await Promise.all([
    callW2(`/v1/offers/${rejData1.cascadedOffer.id}/accept`, { method: 'POST', headers: authJson(rider2Jwt, 'example-0000-0106') }),
    callW2(`/v1/offers/${rejData1.cascadedOffer.id}/accept`, { method: 'POST', headers: authJson(rider1Jwt, 'example-0000-0107') }),
  ]);
  assert.equal(raceWin.status, 200);
  assert.equal(raceLose.status, 410);
  const ord1Db = (await pg.query('SELECT status, rider_id FROM public.orders WHERE id = $1', [ord1])).rows[0];
  assert.equal(ord1Db.status, 'RIDER_ASSIGNED');
  assert.equal(ord1Db.rider_id, rider2Id);

  // 3. DSP-02 (`D-23` Solo-Rider Guard): End Rider 2 shift -> Rider 1 is solo -> 409 OFFER_NOT_REJECTABLE -> request_reassign escalates!
  await callW2('/v1/riders/session/end', { method: 'POST', headers: authJson(rider2Jwt, 'example-0000-0108') });
  const ordSolo = await insertOrder('3102');
  const soloDisp = (await (await triggerDispatch(ordSolo)).json()).data;
  assert.equal(soloDisp.offer.soloRider, true);

  const soloBlocked = await callW2(`/v1/offers/${soloDisp.offer.id}/reject`, {
    method: 'POST',
    headers: authJson(rider1Jwt, 'example-0000-0109'),
    body: JSON.stringify({ reason: 'too_far', request_reassign: false }),
  });
  assert.equal(soloBlocked.status, 409);
  assert.equal((await soloBlocked.json()).error.code, 'OFFER_NOT_REJECTABLE');

  const soloEscalated = await callW2(`/v1/offers/${soloDisp.offer.id}/reject`, {
    method: 'POST',
    headers: authJson(rider1Jwt, 'example-0000-0110'),
    body: JSON.stringify({ reason: 'vehicle_issue', request_reassign: true }),
  });
  assert.equal((await soloEscalated.json()).data.dispatchStatus, 'escalated_admin');
  await pg.query(`UPDATE public.orders SET status = 'CANCELLED_ADMIN' WHERE id = $1`, [ordSolo]);

  // 4. DSP-03 Multi-Order Bundled Dispatch (`order_batches` + atomic 2-order assignment):
  const batchOrdA = await insertOrder('3103', 24.9010, 91.8710);
  const batchOrdB = await insertOrder('3104', 24.9035, 91.8725);
  const batchDisp = (await (await triggerDispatch(batchOrdA)).json()).data;
  assert.equal(batchDisp.offer.batchOrderIds.length, 2);
  assert.equal(
    (await callW2(`/v1/offers/${batchDisp.offer.id}/accept`, { method: 'POST', headers: authJson(rider1Jwt, 'example-0000-0111') })).status,
    200,
  );
  const assignedBatch = (await pg.query('SELECT status, batch_id FROM public.orders WHERE id IN ($1, $2)', [batchOrdA, batchOrdB])).rows;
  assert.equal(assignedBatch.every((r) => r.status === 'RIDER_ASSIGNED' && r.batch_id === batchDisp.offer.batchId), true);

  // 5. ORD-02: Unreachable kitchen (`PLACED` > 120s while vendor presence `OFFLINE`) auto-cancelled on cron sweep:
  const ordUnreach = await insertOrder('3105', 24.9012, 91.8715, 'PLACED');
  await triggerDispatch(ordUnreach);
  clockMs += 130_000;
  const sweepSummary = await worker.scheduled({}, env);
  assert.equal(sweepSummary.vendorUnreachableCancelled, 1);
  assert.equal((await pg.query('SELECT status FROM public.orders WHERE id = $1', [ordUnreach])).rows[0].status, 'CANCELLED_TIMEOUT');

  // 6. CSH-01 Cash Gate End-to-End: Rider 1 collects COD -> ends shift -> next session start blocked (`403 CASH_GATE_ACTIVE`):
  const freshR1Jwt = await mintRealtimeJwt(rider1ProfId, clockMs);
  await pg.query(
    `INSERT INTO public.ledger_entries (actor_type, actor_id, order_id, kind, amount_poisha, memo)
     VALUES ('rider', $1, $2, 'cod_liability', -36500, 'COD collected on delivery')`,
    [rider1Id, ord1],
  );
  const endWithCash = (
    await (await callW2('/v1/riders/session/end', { method: 'POST', headers: authJson(freshR1Jwt, 'example-0000-0112') })).json()
  ).data;
  assert.equal(endWithCash.cash_gate_blocked, true);
  assert.equal(endWithCash.unremitted_cash_poisha, 36_500);

  const gatedStart = await callW2('/v1/riders/session/start', {
    method: 'POST',
    headers: authJson(freshR1Jwt, 'example-0000-0113'),
    body: startBodyR1,
  });
  assert.equal(gatedStart.status, 403);
  assert.equal((await gatedStart.json()).error.code, 'CASH_GATE_ACTIVE');

  // 7. Zone SDR & Geo Proxy endpoints + `createRealtimePostgrestAdapter` wire check:
  const freshCustJwt = await mintRealtimeJwt(custId, clockMs);
  const sdrRes = await callW2(`/v1/zone/${zoneId}/sdr`, { headers: { Authorization: `Bearer ${freshR1Jwt}` } });
  assert.equal((await sdrRes.json()).data.weatherCondition, 'rain');

  const geoRes = await callW2('/v1/geo/geocode', {
    method: 'POST',
    headers: authJson(freshCustJwt, null),
    body: JSON.stringify({ query: 'Zindabazar Sylhet', lang: 'en' }),
  });
  assert.equal((await geoRes.json()).data.places[0].serviceable, true);

  const revRes = await callW2('/v1/geo/reverse', {
    method: 'POST',
    headers: authJson(freshCustJwt, null),
    body: JSON.stringify({ lat: 24.8949, lng: 91.8687, lang: 'en' }),
  });
  assert.equal(revRes.status, 200);

  const routeRes = await callW2('/v1/geo/route', {
    method: 'POST',
    headers: authJson(freshCustJwt, null),
    body: JSON.stringify({ origin_lat: 24.8949, origin_lng: 91.8687, dest_lat: 24.9012, dest_lng: 91.8715, vehicle_type: 'motorbike' }),
  });
  assert.equal((await routeRes.json()).data.source, 'osrm');

  const wireCalls = [];
  const restAdapter = createRealtimePostgrestAdapter({
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'example-service-role-key',
    fetchImpl: async (url) => {
      wireCalls.push(String(url));
      return Response.json([{ id: zoneId }]);
    },
  });
  assert.equal(await restAdapter.ping(), true);
  assert.equal(wireCalls[0], 'https://example.supabase.co/rest/v1/zones?select=id&limit=1');
});
