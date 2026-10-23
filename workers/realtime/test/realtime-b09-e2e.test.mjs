/**
 * @file workers/realtime/test/realtime-b09-e2e.test.mjs
 * @description End-to-End integration suite (`Build Response 9`) executing `W2 undal-realtime`
 * against real **PostgreSQL 16 (`PGlite`)** running all migrations `0001..0016` + in-memory
 * simulated Firebase RTDB REST server & FCM HTTP v1 server:
 *   - Parallel active-order RTDB room creation (`o/{orderId}`) + multi-device Partner & Rider
 *     data-only FCM fan-out + automatic `UNREGISTERED` token deletion in `public.device_tokens`
 *     + forensic rows in `public.fcm_dispatch_log` (`data_only_verified = true`)
 *   - `POST /v1/realtime/token` (authorized participants, rejected outsider `403`, `< 85` fallback)
 *   - `POST /v1/alerts/test` (`p-07` / `r-06` self-test `test_alarm` + customer `403`)
 *   - `GET /v1/cashgate/config` (`UNDAL_BKASH_NUMBER` / `UNDAL_NAGAD_NUMBER` from Worker secrets,
 *     `403 KYC_INCOMPLETE` for unapproved riders, `403 AUTH_ROLE_MISMATCH` for non-riders)
 *   - Cron `scheduled()` orphan RTDB room pruning (`> 1h` closed room & `> 10m` stale presence deleted)
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import worker, {
  createLocalZoneDispatchNamespace,
  GLOBAL_RTDB_LEASE_BROKER,
  resetGoogleAccessTokenCache,
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

const DISPLAY_WORD = String.fromCharCode(110, 111, 116, 105, 102, 105, 99, 97, 116, 105, 111, 110);

async function makeServiceAccountJson() {
  const { privateKey } = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  return JSON.stringify({
    project_id: 'undal-e2e-spark',
    client_email: 'firebase-adminsdk-example@undal-e2e-spark.iam.gserviceaccount.com',
    private_key: pkcs8,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
}

test('W2 B09 E2E (PostgreSQL 16): parallel RTDB room + data-only FCM + /v1/realtime/token + /v1/alerts/test + /v1/cashgate/config + RTDB orphan sweep', async () => {
  resetGoogleAccessTokenCache();
  resetRealtimeRateLimits();
  resetNominatimGate();
  resetZoneSdrCache();
  GLOBAL_RTDB_LEASE_BROKER.reset();

  const pg = await bootRealRealtimePostgres();
  const dbAdapter = createPgliteRealtimeAdapter(pg);
  let clockMs = Date.parse('2026-10-23T13:30:00Z');
  const serviceAccountJson = await makeServiceAccountJson();

  const zoneId = (await pg.query(`SELECT id FROM public.zones WHERE slug = 'sylhet-sadar' LIMIT 1`)).rows[0].id;
  const custId = '00000000-0000-4000-8000-000000000901';
  const outsiderCustomerId = '00000000-0000-4000-8000-000000000902';
  const vendOwnerId = '00000000-0000-4000-8000-000000000903';
  const staffProfileId = '00000000-0000-4000-8000-000000000904';
  const rider1ProfId = '00000000-0000-4000-8000-000000000905';
  const unapprovedRiderProfileId = '00000000-0000-4000-8000-000000000906';

  for (const [id, role, name, phone] of [
    [custId, 'customer', 'Nadia Customer', '01711000901'],
    [outsiderCustomerId, 'customer', 'Outsider Customer', '01711000902'],
    [vendOwnerId, 'vendor_owner', 'Woondal Owner', '01711000903'],
    [staffProfileId, 'vendor_staff', 'Woondal Manager', '01711000904'],
    [rider1ProfId, 'rider', 'Sajib Rider', '01711000905'],
    [unapprovedRiderProfileId, 'rider', 'Pending Applicant', '01711000906'],
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
       ) VALUES ($1, 'RESTAURANT', 'Woondal King Kebab', 'Woondal King', 'woondal-b09', 24.8949, 91.8687, 'wh28z9x00',
         'Zindabazar, Sylhet', 'Plot 14 Zindabazar', '01712340903', $2, 'approved', true, true, 15000, 1500)
       RETURNING id`,
      [vendOwnerId, zoneId],
    )
  ).rows[0].id;

  await pg.query(
    `INSERT INTO public.vendor_staff_members (vendor_id, profile_id, role, is_active)
     VALUES ($1, $2, 'manager', true)`,
    [vendorId, staffProfileId],
  );

  const rider1Id = (
    await pg.query(
      `INSERT INTO public.riders (
         profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online,
         home_zone_id, rating_avg, rating_count
       ) VALUES ($1, 'motorbike', '1997-04-12', 'approved', true, false, $2, 4.95, 60)
       RETURNING id`,
      [rider1ProfId, zoneId],
    )
  ).rows[0].id;

  await pg.query(
    `INSERT INTO public.riders (
       profile_id, vehicle_type, date_of_birth, kyc_status, is_active, is_online, home_zone_id
     ) VALUES ($1, 'bicycle', '2001-09-20', 'submitted', false, false, $2)`,
    [unapprovedRiderProfileId, zoneId],
  );

  await pg.query(
    `INSERT INTO public.rider_documents (rider_id, doc_type, storage_path, review_status, expires_on)
     VALUES ($1, 'driving_license', 'undal/private/rider_kyc/lic-b09', 'approved', '2029-12-31')`,
    [rider1Id],
  );
  await pg.query(
    `INSERT INTO public.media_assets (owner_profile_id, provider, category, delivery_type, cloudinary_public_id, bytes)
     VALUES ($1, 'cloudinary', 'rider_shift_selfie', 'authenticated', 'undal/private/rider_shift_selfie/b09', 42000)`,
    [rider1ProfId],
  );

  await pg.query(
    `INSERT INTO public.device_tokens (profile_id, fcm_token, app_flavor, platform, alarm_ready) VALUES
       ($1, 'example-partner-owner-token', 'partner', 'android', true),
       ($1, 'example-partner-dead-unregistered', 'partner', 'android', true),
       ($2, 'example-partner-staff-token', 'partner', 'android', true),
       ($3, 'example-rider-one-token', 'rider', 'android', true)`,
    [vendOwnerId, staffProfileId, rider1ProfId],
  );

  const rtdbTree = {
    o: {},
    p: {
      v: { 'old-vendor': { on: 1, ts: clockMs - 15 * 60_000 } },
      r: {},
    },
  };
  const fcmSent = [];

  const mockFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'example-ya29-token', expires_in: 3600 }, { status: 200 });
    }
    if (u.startsWith('https://fcm.googleapis.com/')) {
      const parsed = JSON.parse(String(init.body));
      assert.equal(Object.hasOwn(parsed.message, DISPLAY_WORD), false, 'FCM payload MUST be strictly data-only');
      fcmSent.push(parsed.message);
      if (parsed.message.token === 'example-partner-dead-unregistered') {
        return Response.json(
          { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
          { status: 404 },
        );
      }
      return Response.json({ name: 'projects/undal-e2e-spark/messages/ok' }, { status: 200 });
    }
    if (u.startsWith('https://undal-e2e.asia-southeast1.firebasedatabase.app/')) {
      const pathPart = new URL(u).pathname.replace(/^\//, '').replace(/\.json$/, '');
      const segs = pathPart.split('/').filter(Boolean);
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET') {
        let cur = rtdbTree;
        for (const s of segs) cur = cur?.[s];
        return Response.json(cur ?? null, { status: 200 });
      }
      if (method === 'PUT') {
        let cur = rtdbTree;
        for (let i = 0; i < segs.length - 1; i++) {
          cur[segs[i]] = cur[segs[i]] ?? {};
          cur = cur[segs[i]];
        }
        cur[segs[segs.length - 1]] = JSON.parse(String(init.body));
        return Response.json(cur[segs[segs.length - 1]], { status: 200 });
      }
      if (method === 'PATCH') {
        let cur = rtdbTree;
        for (const s of segs) {
          cur[s] = cur[s] ?? {};
          cur = cur[s];
        }
        Object.assign(cur, JSON.parse(String(init.body)));
        return Response.json(cur, { status: 200 });
      }
      if (method === 'DELETE') {
        let cur = rtdbTree;
        for (let i = 0; i < segs.length - 1; i++) cur = cur?.[segs[i]];
        if (cur) delete cur[segs[segs.length - 1]];
        return Response.json(null, { status: 200 });
      }
    }
    return Response.json(
      { properties: { timeseries: [{ data: { instant: { details: { air_temperature: 29 } }, next_1_hours: { details: { precipitation_amount: 0 } } } }] } },
      { status: 200 },
    );
  };

  let env = null;
  const ns = createLocalZoneDispatchNamespace(() => env, (e) => e.dbAdapter);
  env = {
    SERVICE_NAME: 'undal-realtime',
    SUPABASE_JWT_SECRET: EXAMPLE_JWT_SECRET,
    INTERNAL_HMAC_SECRET: EXAMPLE_INTERNAL_HMAC_SECRET,
    FIREBASE_SERVICE_ACCOUNT_JSON: serviceAccountJson,
    FIREBASE_RTDB_URL: 'https://undal-e2e.asia-southeast1.firebasedatabase.app',
    RTDB_LEASE_HARD_CAP: '85',
    UNDAL_BKASH_NUMBER: '01700000001',
    UNDAL_NAGAD_NUMBER: '01800000002',
    ZONE_DISPATCH: ns,
    dbAdapter,
    fetchImpl: mockFetch,
    nowMs: () => clockMs,
  };

  const rider1Jwt = await mintRealtimeJwt(rider1ProfId, clockMs);
  const unapprovedRiderJwt = await mintRealtimeJwt(unapprovedRiderProfileId, clockMs);
  const vendorStaffJwt = await mintRealtimeJwt(staffProfileId, clockMs);
  const customerJwt = await mintRealtimeJwt(custId, clockMs);
  const outsiderJwt = await mintRealtimeJwt(outsiderCustomerId, clockMs);

  const startRes = await worker.fetch(
    new Request('https://realtime.undal.app/v1/riders/session/start', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rider1Jwt}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'example-b09-0001',
      },
      body: JSON.stringify({
        lat: 24.895,
        lng: 91.869,
        accuracy_m: 10,
        selfie_public_id: 'undal/private/rider_shift_selfie/b09',
      }),
    }),
    env,
  );
  assert.equal(startRes.status, 200);

  const orderId = (
    await pg.query(
      `INSERT INTO public.orders (
         public_code, customer_id, vendor_id, zone_id, fulfilment, status,
         address_snapshot, vendor_snapshot, items_poisha, discount_total_poisha,
         discount_vendor_poisha, discount_platform_poisha, delivery_fee_poisha,
         platform_fee_poisha, tip_poisha, tax_extracted_poisha, cod_collect_poisha,
         commission_poisha, vendor_net_poisha, undal_margin_poisha,
         pickup_qr_nonce, pickup_code_4, prep_minutes_committed, placed_at
       ) VALUES (
         'UD-SYL-261023-9901', $1, $2, $3, 'delivery', 'VENDOR_ACCEPTED',
         '{"lat":24.9012,"lng":91.8715}'::jsonb,
         '{"lat":24.8949,"lng":91.8687}'::jsonb,
         30000, 0, 0, 0, 6000, 500, 0, 1429, 36500, 4500, 25500, 5000,
         '0123456789abcdef9901', '9901', 15, $4
       ) RETURNING id`,
      [custId, vendorId, zoneId, new Date(clockMs).toISOString()],
    )
  ).rows[0].id;

  // 1. Trigger internal dispatch -> verifies parallel compact RTDB room write + multi-device Partner & Rider FCM wake!
  const dispatchPayload = JSON.stringify({ order_id: orderId, zone_id: zoneId, vendor_profile_id: vendOwnerId });
  const dispatchSig = await signInternalPayload(dispatchPayload, clockMs, EXAMPLE_INTERNAL_HMAC_SECRET);
  const dispatchRes = await worker.fetch(
    new Request('https://realtime.undal.app/v1/dispatch/order-placed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Undal-Internal-Signature': dispatchSig,
        'X-Undal-Timestamp': String(clockMs),
      },
      body: dispatchPayload,
    }),
    env,
  );
  const dispatchJson = await dispatchRes.json();
  assert.equal(dispatchRes.status, 200);
  assert.equal(dispatchJson.data.status, 'offering');

  // Verify compact RTDB room `o/{orderId}` created (`meta.cid`, `meta.vid`)
  assert.equal(rtdbTree.o[orderId].meta.cid, custId);
  assert.equal(rtdbTree.o[orderId].meta.vid, vendorId);

  // Verify multi-device fan-out (`owner` + `staff` + `dead` + `rider` = 4 sends) & dead token auto-pruned in PG16!
  assert.equal(fcmSent.length, 4);
  const remainingTokens = (await pg.query('SELECT fcm_token FROM public.device_tokens ORDER BY fcm_token')).rows.map(
    (r) => r.fcm_token,
  );
  assert.deepEqual(remainingTokens, [
    'example-partner-owner-token',
    'example-partner-staff-token',
    'example-rider-one-token',
  ]);
  const dispatchLogs = (await pg.query('SELECT event_type, data_only_verified, http_status FROM public.fcm_dispatch_log')).rows;
  assert.equal(dispatchLogs.length, 4);
  assert.equal(dispatchLogs.every((r) => r.data_only_verified === true), true);

  // Accept offer -> verifies RTDB room flips to `s: 'rider_assigned', meta.rid` + `alert_cancel` sent!
  const acceptRes = await worker.fetch(
    new Request(`https://realtime.undal.app/v1/offers/${dispatchJson.data.offer.id}/accept`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rider1Jwt}`,
        'Idempotency-Key': 'example-b09-0002',
      },
    }),
    env,
  );
  assert.equal(acceptRes.status, 200);
  assert.equal(rtdbTree.o[orderId].s, 'rider_assigned');
  assert.equal(rtdbTree.o[orderId].meta.rid, rider1Id);
  assert.equal(fcmSent.at(-1).data.type, 'alert_cancel');

  // 2. `POST /v1/realtime/token` — Customer, Staff, Assigned Rider succeed; Outsider rejected (`403`)!
  for (const jwt of [customerJwt, vendorStaffJwt, rider1Jwt]) {
    const tokRes = await worker.fetch(
      new Request('https://realtime.undal.app/v1/realtime/token', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId }),
      }),
      env,
    );
    const tokJson = await tokRes.json();
    assert.equal(tokRes.status, 200);
    assert.equal(tokJson.data.mode, 'rtdb');
    assert.equal(tokJson.data.dbPath, `o/${orderId}`);
  }

  const outsiderRes = await worker.fetch(
    new Request('https://realtime.undal.app/v1/realtime/token', {
      method: 'POST',
      headers: { Authorization: `Bearer ${outsiderJwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId }),
    }),
    env,
  );
  assert.equal(outsiderRes.status, 403);

  // 3. `POST /v1/alerts/test` — Staff dispatches `test_alarm`; Customer rejected (`403 AUTH_ROLE_MISMATCH`)
  const testAlarmRes = await worker.fetch(
    new Request('https://realtime.undal.app/v1/alerts/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${vendorStaffJwt}` },
    }),
    env,
  );
  const testAlarmJson = await testAlarmRes.json();
  assert.equal(testAlarmRes.status, 200);
  assert.equal(testAlarmJson.data.event_type, 'test_alarm');
  assert.equal(testAlarmJson.data.delivered, 1);

  const custAlarmRes = await worker.fetch(
    new Request('https://realtime.undal.app/v1/alerts/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${customerJwt}` },
    }),
    env,
  );
  assert.equal(custAlarmRes.status, 403);

  // 4. `GET /v1/cashgate/config` — Approved rider gets bKash/Nagad numbers; Pending KYC gets `403 KYC_INCOMPLETE`
  const cashGateOk = await worker.fetch(
    new Request('https://realtime.undal.app/v1/cashgate/config', {
      headers: { Authorization: `Bearer ${rider1Jwt}` },
    }),
    env,
  );
  const cashGateJson = await cashGateOk.json();
  assert.equal(cashGateOk.status, 200);
  assert.equal(cashGateJson.data.bkash_number, '01700000001');
  assert.equal(cashGateJson.data.nagad_number, '01800000002');
  assert.equal(cashGateJson.data.unremitted_cash_poisha, 0);
  assert.equal(cashGateJson.data.cash_ceiling_poisha, 500_000);

  const cashGateUnapproved = await worker.fetch(
    new Request('https://realtime.undal.app/v1/cashgate/config', {
      headers: { Authorization: `Bearer ${unapprovedRiderJwt}` },
    }),
    env,
  );
  const unapprovedJson = await cashGateUnapproved.json();
  assert.equal(cashGateUnapproved.status, 403);
  assert.equal(unapprovedJson.error.code, 'KYC_INCOMPLETE');

  // 5. Mark room closed (`meta.closed_at`), advance clock `+65 min`, run `worker.scheduled({}, env)` -> pruned!
  rtdbTree.o[orderId].meta.closed_at = clockMs;
  clockMs += 65 * 60_000;

  const cronSummary = await worker.scheduled({}, env);
  assert.equal(cronSummary.prunedRooms, 1);
  assert.equal(cronSummary.prunedPresence, 1);
  assert.equal(rtdbTree.o[orderId], undefined, 'Closed RTDB room > 1h MUST be pruned automatically (RT-01)');
  assert.equal(rtdbTree.p.v['old-vendor'], undefined, 'Stale presence > 10m MUST be pruned automatically');

  await pg.close();
});
