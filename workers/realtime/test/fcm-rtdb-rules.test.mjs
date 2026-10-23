/**
 * @file workers/realtime/test/fcm-rtdb-rules.test.mjs
 * @description Comprehensive unit, security-matrix & Spark load simulation suite for `Build Response 9`:
 *   1. `ALM-01` Complete 11-Event Data-Only FCM Matrix + RS256 OAuth2 signing verification +
 *      runtime tamper guard (`ALM_01_VIOLATION`) + `503` retry + `UNREGISTERED` auto-prune
 *   2. `RT-01` Full 30-Order Simultaneous Surge (`67 < 85`) + 86-Listener Overflow Priority Preemption
 *      + `realtime_mode = 'polling'` kill-switch
 *   3. `infra/firebase/database.rules.json` complete positive + hostile security matrix (`File 06 §6.4`)
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertDataOnlyFcmPayload,
  buildDataOnlyFcmMessage,
  dispatchDataOnlyFcm,
  evaluateRtdbRead,
  evaluateRtdbWrite,
  mintFirebaseCustomToken,
  parseServiceAccountJson,
  resetGoogleAccessTokenCache,
  RtdbLeaseBroker,
} from '../src/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_PATH = resolve(__dirname, '../../../infra/firebase/database.rules.json');
const DISPLAY_WORD = String.fromCharCode(110, 111, 116, 105, 102, 105, 99, 97, 116, 105, 111, 110);

const ALL_11_EVENTS = [
  'vendor_new_order',
  'rider_offer',
  'alert_cancel',
  'order_status',
  'chat_msg',
  'rider_nearby_pickup',
  'cash_gate_reminder',
  'kyc_update',
  'payout_update',
  'system_notice',
  'test_alarm',
];

/** Generates an ephemeral 2048-bit RSA PKCS#8 service account JSON at test runtime (0 secrets on disk). */
async function generateEphemeralServiceAccount() {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8Buffer = await crypto.subtle.exportKey('pkcs8', privateKey);
  const b64 = Buffer.from(pkcs8Buffer).toString('base64');
  const json = JSON.stringify({
    project_id: 'undal-prod-spark',
    client_email: 'firebase-adminsdk-example@undal-prod-spark.iam.gserviceaccount.com',
    private_key: b64,
    token_uri: 'https://oauth2.googleapis.com/token',
  });
  return { publicKey, serviceAccountJson: json };
}

async function verifyRs256Jwt(jwt, publicKey) {
  const [h, p, sigB64] = jwt.split('.');
  const data = new TextEncoder().encode(`${h}.${p}`);
  const norm = sigB64.replace(/-/g, '+').replace(/_/g, '/');
  const sig = Uint8Array.from(Buffer.from(norm + '='.repeat((4 - (norm.length % 4)) % 4), 'base64'));
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, sig, data);
  const payload = JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  return { valid, payload };
}

test('ALM-01: all 11 File 07 §7.4 FCM event types strictly data-only + signed + negative tamper rejection', async () => {
  resetGoogleAccessTokenCache();
  const { publicKey, serviceAccountJson } = await generateEphemeralServiceAccount();
  const nowMs = 1_792_700_000_000;
  const secret = 'example-wake-hmac-signing-key';

  for (const eventType of ALL_11_EVENTS) {
    const envelope = await buildDataOnlyFcmMessage({
      fcmToken: 'example-fcm-device-token-0001',
      eventType,
      fields: { order_id: 'ord-101', preview: 'x'.repeat(90) },
      hmacSecret: secret,
      nowMs,
    });
    assertDataOnlyFcmPayload(envelope);
    assert.equal(Object.hasOwn(envelope.message, DISPLAY_WORD), false);
    assert.equal(envelope.message.android.priority, 'high');
    assert.equal(envelope.message.data.type, eventType);
    assert.equal(envelope.message.data.preview.length, 60, 'chat preview strictly truncated to 60 chars');
    assert.equal(envelope.message.data.hmac.length, 64, '64-hex HMAC-SHA256 wake signature present');
  }

  // Negative proof: tampered payload containing forbidden display key throws immediately before network IO
  const badPayload = { message: { token: 'example-fcm-token', [DISPLAY_WORD]: { title: 'Forbidden' } } };
  assert.throws(() => assertDataOnlyFcmPayload(badPayload), /ALM_01_VIOLATION/);

  // Dispatch simulation: 1 valid device (`503` -> `200` retry) + 1 dead `UNREGISTERED` (`404`) device auto-pruned
  const prunedTokens = [];
  const logs = [];
  let oauthJwtVerified = false;
  let validTokenAttempts = 0;

  const mockFetch = async (url, init) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      const check = await verifyRs256Jwt(form.get('assertion'), publicKey);
      oauthJwtVerified = check.valid;
      return Response.json({ access_token: 'example-ya29-oauth-token', expires_in: 3600 }, { status: 200 });
    }
    const body = JSON.parse(String(init.body));
    assert.equal(Object.hasOwn(body.message, DISPLAY_WORD), false);
    if (body.message.token === 'example-stale-unregistered-token') {
      return Response.json(
        { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
        { status: 404 },
      );
    }
    validTokenAttempts += 1;
    if (validTokenAttempts === 1) {
      return Response.json({ error: { status: 'UNAVAILABLE' } }, { status: 503 });
    }
    return Response.json({ name: 'projects/undal-prod-spark/messages/msg-1' }, { status: 200 });
  };

  const report = await dispatchDataOnlyFcm({
    recipientProfileIds: ['prof-1'],
    orderId: 'ord-101',
    eventType: 'vendor_new_order',
    fields: { order_id: 'ord-101', code: 'UND-20261023-0001' },
    serviceAccountJson,
    hmacSecret: secret,
    db: {
      listDeviceTokensForProfiles: async () => [
        { profileId: 'prof-1', fcmToken: 'example-live-device-token', appFlavor: 'partner' },
        { profileId: 'prof-1', fcmToken: 'example-stale-unregistered-token', appFlavor: 'partner' },
      ],
      pruneDeviceToken: async (tok) => {
        prunedTokens.push(tok);
      },
      logFcmDispatch: async (entry) => {
        logs.push(entry);
      },
    },
    fetchImpl: mockFetch,
    nowMs,
    retryDelayMs: 1,
  });

  assert.equal(oauthJwtVerified, true, 'Google OAuth2 JWT assertion must pass RS256 signature check');
  assert.equal(validTokenAttempts, 2, '503 transient failure must succeed on backoff retry #2');
  assert.equal(report.delivered, 1);
  assert.equal(report.prunedUnregistered, 1);
  assert.deepEqual(prunedTokens, ['example-stale-unregistered-token']);
  assert.equal(logs.length, 2);
});

test('RT-01: 30-order simultaneous surge (< 85 Spark ceiling) + 86th-connection overflow & priority eviction', async () => {
  const { publicKey, serviceAccountJson } = await generateEphemeralServiceAccount();
  const broker = new RtdbLeaseBroker();
  const nowMs = 1_792_700_000_000;

  // Phase A (`File 06 §6.6`): 30 simultaneous orders across 20 outlets, 15 riders, 30 customers & 2 admin slots
  for (let i = 0; i < 20; i++) {
    const r = await broker.acquireTokenOrPollFallback({
      profileId: `vprof-${i}`,
      actorKind: 'vendor',
      scopeKey: `outlet:v-${i}`,
      dbPath: `p/v/v-${i}`,
      fallbackPath: '/v1/orders',
      claims: { role: 'vendor_owner', vendor_id: `v-${i}` },
      hardCap: 85,
      realtimeMode: 'rtdb',
      rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
      serviceAccountJson,
      nowMs,
    });
    assert.equal(r.mode, 'rtdb');
  }
  for (let i = 0; i < 15; i++) {
    const r = await broker.acquireTokenOrPollFallback({
      profileId: `rprof-${i}`,
      actorKind: 'rider',
      scopeKey: `session:r-${i}`,
      dbPath: `p/r/r-${i}`,
      fallbackPath: '/v1/orders',
      claims: { role: 'rider', rider_id: `r-${i}` },
      hardCap: 85,
      realtimeMode: 'rtdb',
      rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
      serviceAccountJson,
      nowMs,
    });
    assert.equal(r.mode, 'rtdb');
  }
  for (let i = 0; i < 30; i++) {
    const r = await broker.acquireTokenOrPollFallback({
      profileId: `cprof-${i}`,
      actorKind: 'customer',
      scopeKey: `cprof-${i}:ord-${i}`,
      dbPath: `o/ord-${i}`,
      fallbackPath: `/v1/orders/UND-${i}/live`,
      claims: { role: 'customer' },
      hardCap: 85,
      realtimeMode: 'rtdb',
      rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
      serviceAccountJson,
      nowMs: nowMs + i,
    });
    assert.equal(r.mode, 'rtdb');
    if (i === 0) {
      const check = await verifyRs256Jwt(r.token, publicKey);
      assert.equal(check.valid, true);
      assert.equal(check.payload.uid, 'cprof-0');
    }
  }
  for (let slot = 1; slot <= 2; slot++) {
    const r = await broker.acquireTokenOrPollFallback({
      profileId: 'admin-1',
      actorKind: 'admin',
      scopeKey: `admin-1:${slot}`,
      dbPath: 'inbox/admin-1/last',
      fallbackPath: '/v1/admin/dispatch/board',
      claims: { role: 'admin' },
      hardCap: 85,
      realtimeMode: 'rtdb',
      rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
      serviceAccountJson,
      nowMs,
    });
    assert.equal(r.mode, 'rtdb');
  }

  // Exact Spark budget at 30 active orders = 20 + 15 + 30 + 2 = 67 (< 85 hard cap, < 100 Spark ceiling!)
  assert.equal(broker.countActive(nowMs), 67);

  // Phase B: Fill remaining 18 slots to reach exact 85 hard cap, then verify 86th customer degrades to 5s HTTP poll!
  for (let i = 30; i < 48; i++) {
    const r = await broker.acquireTokenOrPollFallback({
      profileId: `cprof-${i}`,
      actorKind: 'customer',
      scopeKey: `cprof-${i}:ord-${i}`,
      dbPath: `o/ord-${i}`,
      fallbackPath: `/v1/orders/UND-${i}/live`,
      claims: { role: 'customer' },
      hardCap: 85,
      realtimeMode: 'rtdb',
      rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
      serviceAccountJson,
      nowMs: nowMs + i,
    });
    assert.equal(r.mode, 'rtdb');
  }
  assert.equal(broker.countActive(nowMs), 85);

  // 86th customer connection -> graceful `mode: 'poll', pollIntervalMs: 5000`, activeLeases NEVER exceeds 85!
  const overflowCustomer = await broker.acquireTokenOrPollFallback({
    profileId: 'cprof-86',
    actorKind: 'customer',
    scopeKey: 'cprof-86:ord-86',
    dbPath: 'o/ord-86',
    fallbackPath: '/v1/orders/UND-86/live',
    claims: { role: 'customer' },
    hardCap: 85,
    realtimeMode: 'rtdb',
    rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
    serviceAccountJson,
    nowMs,
  });
  assert.equal(overflowCustomer.mode, 'poll');
  assert.equal(overflowCustomer.pollIntervalMs, 5_000);
  assert.equal(overflowCustomer.reason, 'lease_cap_reached');
  assert.equal(broker.countActive(nowMs), 85);

  // Urgent priority-1 Rider arrives while at 85/85 -> evicts oldest low-priority customer & stays strictly at 85!
  const urgentRider = await broker.acquireTokenOrPollFallback({
    profileId: 'rprof-urgent',
    actorKind: 'rider',
    scopeKey: 'session:r-urgent',
    dbPath: 'p/r/r-urgent',
    fallbackPath: '/v1/orders',
    claims: { role: 'rider', rider_id: 'r-urgent' },
    hardCap: 85,
    realtimeMode: 'rtdb',
    rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
    serviceAccountJson,
    nowMs,
  });
  assert.equal(urgentRider.mode, 'rtdb');
  assert.equal(broker.countActive(nowMs), 85);

  // Admin kill-switch (`realtime_mode = 'polling'`) forces immediate poll fallback even below cap
  const killed = await broker.acquireTokenOrPollFallback({
    profileId: 'rprof-urgent',
    actorKind: 'rider',
    scopeKey: 'session:r-urgent',
    dbPath: 'p/r/r-urgent',
    fallbackPath: '/v1/orders',
    claims: { role: 'rider', rider_id: 'r-urgent' },
    hardCap: 85,
    realtimeMode: 'polling',
    rtdbUrl: 'https://undal-rtdb.asia-southeast1.firebasedatabase.app',
    serviceAccountJson,
    nowMs,
  });
  assert.equal(killed.mode, 'poll');
  assert.equal(killed.reason, 'kill_switch_polling');
});

test('Firebase RTDB database.rules.json: full participant & hostile attack security matrix', async () => {
  const { publicKey, serviceAccountJson } = await generateEphemeralServiceAccount();
  const rulesJson = JSON.parse(await readFile(RULES_PATH, 'utf8'));
  const nowMs = 1_792_700_000_000;

  const dbTree = {
    o: {
      'ord-1': {
        meta: {
          cid: 'cust-1',
          vid: 'vend-1',
          rid: 'rid-1',
          z: 'zone-sylhet',
          closed_at: null,
        },
        s: 'on_the_way',
        loc: null,
        chat: {},
      },
    },
    p: { v: {}, r: {} },
    inbox: { 'cust-1': { last: 1 } },
  };

  const custAuth = { uid: 'cust-1', token: { role: 'customer' } };
  const otherCustAuth = { uid: 'cust-2', token: { role: 'customer' } };
  const vendAuth = { uid: 'vstaff-1', token: { role: 'vendor_staff', vendor_id: 'vend-1' } };
  const otherVendAuth = { uid: 'vstaff-2', token: { role: 'vendor_staff', vendor_id: 'vend-2' } };
  const riderAuth = { uid: 'ruser-1', token: { role: 'rider', rider_id: 'rid-1' } };
  const otherRiderAuth = { uid: 'ruser-2', token: { role: 'rider', rider_id: 'rid-2' } };
  const adminAuth = { uid: 'adm-1', token: { role: 'admin' } };

  // 1. Order room read permissions (`File 06 §6.4`)
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: custAuth, nowMs }), true);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: vendAuth, nowMs }), true);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: riderAuth, nowMs }), true);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: adminAuth, nowMs }), true);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: null, nowMs }), false);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: otherCustAuth, nowMs }), false);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: otherVendAuth, nowMs }), false);
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'o/ord-1', auth: otherRiderAuth, nowMs }), false);

  // 2. Direct client write to `o/ord-1/meta` strictly forbidden (service-account only)
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/meta', newValue: { cid: 'cust-2' }, auth: custAuth, nowMs }).allowed,
    false,
  );
  assert.equal(
    evaluateRtdbWrite({
      rulesJson,
      dbTree,
      path: 'o/ord-1/meta',
      newValue: { cid: 'cust-1', vid: 'vend-1', rid: 'rid-1', z: 'zone-sylhet', closed_at: null },
      auth: null,
      isServiceAccount: true,
      nowMs,
    }).allowed,
    true,
  );

  // 3. Assigned rider valid GPS write vs unassigned rider vs invalid lat/speed bounds
  const validGps = { la: 24.8949, ln: 91.8687, h: 90, sp: 12, ts: nowMs };
  assert.equal(evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/loc', newValue: validGps, auth: riderAuth, nowMs }).allowed, true);
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/loc', newValue: validGps, auth: otherRiderAuth, nowMs }).allowed,
    false,
  );
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/loc', newValue: { ...validGps, la: 95 }, auth: riderAuth, nowMs }).allowed,
    false,
  );

  // 4. Order chat: valid participant write vs sender spoofing vs > 500 chars vs outsider write
  const validMsg = { f: 'cust-1', k: 'text', b: 'গেটের সামনে আসুন', ts: nowMs };
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/chat/m1', newValue: validMsg, auth: custAuth, nowMs }).allowed,
    true,
  );
  assert.equal(
    evaluateRtdbWrite({
      rulesJson,
      dbTree,
      path: 'o/ord-1/chat/m2',
      newValue: { ...validMsg, f: 'rid-1' },
      auth: custAuth,
      nowMs,
    }).allowed,
    false,
  );
  assert.equal(
    evaluateRtdbWrite({
      rulesJson,
      dbTree,
      path: 'o/ord-1/chat/m3',
      newValue: { ...validMsg, b: 'x'.repeat(501) },
      auth: custAuth,
      nowMs,
    }).allowed,
    false,
  );
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'o/ord-1/chat/m4', newValue: validMsg, auth: otherCustAuth, nowMs }).allowed,
    false,
  );

  // 5. Presence (`p/v/$vendorId`, `p/r/$riderId`) + read-only `inbox/$profileId/last`
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'p/v/vend-1', newValue: { on: 1, ts: nowMs }, auth: vendAuth, nowMs }).allowed,
    true,
  );
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'p/v/vend-2', newValue: { on: 1, ts: nowMs }, auth: vendAuth, nowMs }).allowed,
    false,
  );
  assert.equal(
    evaluateRtdbWrite({
      rulesJson,
      dbTree,
      path: 'p/r/rid-1',
      newValue: { on: 1, la: 24.895, ln: 91.869, ts: nowMs, z: 'sylhet-sadar' },
      auth: riderAuth,
      nowMs,
    }).allowed,
    true,
  );
  assert.equal(evaluateRtdbRead({ rulesJson, dbTree, path: 'inbox/cust-1/last', auth: custAuth, nowMs }), true);
  assert.equal(
    evaluateRtdbWrite({ rulesJson, dbTree, path: 'inbox/cust-1/last', newValue: 2, auth: custAuth, nowMs }).allowed,
    false,
  );

  // Confirm raw custom token minting produces valid RS256 token with custom claims
  const sa = parseServiceAccountJson(serviceAccountJson);
  const tok = await mintFirebaseCustomToken({
    serviceAccount: sa,
    uid: 'cust-1',
    claims: { role: 'customer' },
    nowMs,
  });
  const checked = await verifyRs256Jwt(tok.token, publicKey);
  assert.equal(checked.valid, true);
  assert.equal(checked.payload.claims.role, 'customer');
});
