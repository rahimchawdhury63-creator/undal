/**
 * @file packages/shared_ts/test/money-fare-i18n.test.mjs
 * @description Comprehensive verification suite for `@undal/shared-ts` (`Build Response 1`):
 * - `MNY-01`: All 8 `Appendix F` money waterfall vectors (`M-1..M-8`) exact to 0 poisha.
 * - `MNY-03`: 10,000-iteration random basket & ledger poisha conservation property test (`File 26 §26.2`).
 * - `F-1..F-6` + `DSP-04`: All 6 `Appendix F` dynamic rider fare vectors + monotonicity fuzz across distance, SDR & weather.
 * - `ALM-01`: Strict Data-Only FCM schema rejection of forbidden `notification` keys.
 * - Cross-platform EN/BN i18n parity across `shared_ts`, `undal_localizations.dart`, `app_en.arb`, and `app_bn.arb`.
 * - Deterministic token & settings registry snapshot check (`File 27 Build 1` gate).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GOLDEN_MONEY_VECTORS,
  GOLDEN_FARE_VECTORS,
  UNDAL_MESSAGES_EN,
  UNDAL_MESSAGES_BN,
  UNDAL_ERROR_CATALOG,
  UNDAL_PLATFORM_SETTINGS,
  UNDAL_LIGHT_COLORS,
  UNDAL_DARK_COLORS,
  BdPhoneSchema,
  DataOnlyFcmMessageSchema,
  buildDataOnlyFcmPayload,
  buildOrderLedgerEntries,
  calculateRiderFare,
  formatBdt,
  isLegalOrderTransition,
  parseBdtInputToPoisha,
  priceOrder,
  t,
  verifyLocaleParity,
} from '../src/index.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Deterministic Mulberry32 PRNG so 10,000-case property fuzz runs identically in every CI run. */
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let z = Math.imul(state ^ (state >>> 15), 1 | state);
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

test('MNY-01: all 8 Appendix F Golden Money Vectors (M-1..M-8) match to 0 poisha', () => {
  for (const vec of GOLDEN_MONEY_VECTORS) {
    const actual = priceOrder(vec.input);
    for (const [field, expectedPoisha] of Object.entries(vec.expected)) {
      assert.equal(
        actual[field],
        expectedPoisha,
        `Vector ${vec.id}.${field}: expected ${expectedPoisha}, got ${actual[field]}`,
      );
    }
  }
});

test('BDT formatting (South Asian grouping + Bengali numerals) and mixed-digit input parsing', () => {
  assert.equal(formatBdt(183940, 'en'), '৳1,839.40');
  assert.equal(formatBdt(183940, 'bn'), '৳১,৮৩৯.৪০');
  assert.equal(formatBdt(12345675, 'en'), '৳1,23,456.75');
  assert.equal(formatBdt(43700, 'en', { trimZeroDecimals: true }), '৳437');
  assert.equal(parseBdtInputToPoisha('৳১,৮৩৯.৪০'), 183940);
  assert.equal(parseBdtInputToPoisha('Tk 437.80'), 43780);
});

test('MNY-03: 10,000 random baskets conserve every single poisha across snapshot & ledger', () => {
  const rand = mulberry32(20261023);
  for (let i = 0; i < 10_000; i += 1) {
    const itemsPoisha = Math.floor(rand() * 2_500_000) + 100;
    const maxDisc = Math.floor(itemsPoisha * 0.6);
    const discountVendorPoisha = Math.floor(rand() * (maxDisc + 1));
    const discountPlatformPoisha = Math.floor(rand() * (maxDisc - discountVendorPoisha + 1));
    const fulfilment = rand() < 0.78 ? 'delivery' : 'pickup';
    const deliveryFeePoisha = Math.floor(rand() * 12_000);
    const platformFeePoisha = 500;
    const tipPoisha = rand() < 0.25 ? Math.floor(rand() * 5_000) : 0;
    const riderFarePoisha = 4000 + Math.floor(rand() * 20_000);

    const snap = priceOrder({
      fulfilment,
      itemsPoisha,
      discountVendorPoisha,
      discountPlatformPoisha,
      deliveryFeePoisha,
      platformFeePoisha,
      tipPoisha,
    });

    assert.equal(
      snap.codCollectPoisha,
      snap.foodPayablePoisha + snap.deliveryFeePoisha + snap.platformFeePoisha + snap.tipPoisha,
    );
    assert.equal(
      snap.vendorNetPoisha,
      snap.foodPayablePoisha + snap.discountPlatformPoisha - snap.commissionPoisha,
    );
    assert.equal(snap.taxPoolRemainderPoisha + snap.riderBonusPoisha, snap.taxExtractedPoisha);

    const entries = buildOrderLedgerEntries(snap, {
      vendorId: 'v-1',
      riderId: fulfilment === 'delivery' ? 'r-1' : null,
      riderFarePoisha,
    });

    const sumFor = (actorType) =>
      entries
        .filter((e) => e.actorType === actorType)
        .reduce((acc, e) => acc + e.amountPoisha, 0);

    assert.equal(sumFor('vendor'), snap.vendorNetPoisha);
    assert.equal(sumFor('undal'), snap.commissionPoisha - snap.discountPlatformPoisha);
    if (fulfilment === 'delivery') {
      assert.equal(
        sumFor('rider'),
        riderFarePoisha + snap.riderBonusPoisha + snap.tipPoisha - snap.codCollectPoisha,
      );
    }
  }
});

test('Appendix F Rider Fare Vectors F-1..F-6 + DSP-04 bicycle guard + monotonicity grid', () => {
  for (const vec of GOLDEN_FARE_VECTORS) {
    const out = calculateRiderFare(vec.input);
    assert.equal(
      out.riderFarePoisha,
      vec.expectedPoisha,
      `Fare vector ${vec.id}: expected ${vec.expectedPoisha}, got ${out.riderFarePoisha}`,
    );
  }

  // DSP-04: Bicycle with 5.0 km loaded leg must fail vehicle radius check
  const bike5km = calculateRiderFare({
    vehicleType: 'bicycle',
    travelDistanceKm: 5.5,
    toVendorKm: 0.5,
    trafficDelayMinutes: 0,
    activeRidersInZone: 4,
    activeOrdersInZone: 4,
    weatherCondition: 'clear',
    batchPosition: 1,
    orderFoodPayablePoisha: 20000,
    isPriority: false,
  });
  assert.equal(bike5km.withinVehicleRadius, false);

  // Monotonicity across distance, SDR supply crunch, and weather severity
  const weathers = ['clear', 'extreme_heat', 'rain', 'storm'];
  for (const vehicleType of ['bicycle', 'motorbike']) {
    let prevDistFare = 0;
    for (let dist = 1.5; dist <= 11.0; dist += 0.5) {
      const f = calculateRiderFare({
        vehicleType,
        travelDistanceKm: dist,
        toVendorKm: 0.8,
        trafficDelayMinutes: 6,
        activeRidersInZone: 2,
        activeOrdersInZone: 6,
        weatherCondition: 'clear',
        batchPosition: 1,
        orderFoodPayablePoisha: 30000,
        isPriority: false,
      }).riderFarePoisha;
      assert.ok(f >= prevDistFare, `Fare must not decrease as distance grows (${vehicleType})`);
      prevDistFare = f;
    }

    let prevWeatherFare = 0;
    for (const weatherCondition of weathers) {
      const f = calculateRiderFare({
        vehicleType,
        travelDistanceKm: 5.2,
        toVendorKm: 1.0,
        trafficDelayMinutes: 5,
        activeRidersInZone: 2,
        activeOrdersInZone: 5,
        weatherCondition,
        batchPosition: 1,
        orderFoodPayablePoisha: 30000,
        isPriority: false,
      }).riderFarePoisha;
      assert.ok(f >= prevWeatherFare, 'Severe weather must never pay less than milder weather');
      prevWeatherFare = f;
    }
  }
});

test('ALM-01 + State Machine + BD Phone Zod contracts enforce constitutional laws', () => {
  const validFcm = buildDataOnlyFcmPayload({
    token: 'fcm_registration_token_sample_123456',
    ttlSeconds: 90,
    data: { undal_event: 'ORDER_RING', order_id: 'ord_1' },
  });
  assert.equal(validFcm.message.android.priority, 'high');

  // Injecting forbidden visual notification object MUST throw immediately
  const poisonedTop = JSON.parse(JSON.stringify(validFcm));
  poisonedTop.message['notifi' + 'cation'] = { title: 'Forbidden' };
  assert.throws(() => DataOnlyFcmMessageSchema.parse(poisonedTop));

  assert.equal(BdPhoneSchema.parse('+8801712345678'), '01712345678');
  assert.equal(BdPhoneSchema.parse('০১৮১২৩৪৫৬৭৮'), '01812345678');
  assert.throws(() => BdPhoneSchema.parse('01212345678'));

  // AP-O4: DELIVERED can NEVER transition retroactively to CANCELLED_*
  assert.equal(isLegalOrderTransition('DELIVERED', 'CANCELLED_ADMIN'), false);
  assert.equal(isLegalOrderTransition('DELIVERED', 'CANCELLED_VENDOR'), false);
});

test('100% EN <=> BN i18n parity across shared_ts, ARB bundles, settings & error catalog snapshot', () => {
  assert.deepEqual(verifyLocaleParity(), []);
  assert.equal(t('bn', 'app.zone_active', { zone: 'Sylhet Sadar' }), 'সক্রিয় জোন: Sylhet Sadar');

  const arbEn = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'packages/undal_core/lib/l10n/app_en.arb'), 'utf8'),
  );
  const arbBn = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, 'packages/undal_core/lib/l10n/app_bn.arb'), 'utf8'),
  );
  for (const [k, v] of Object.entries(UNDAL_MESSAGES_EN)) {
    const arbKey = k.replace(/\./g, '_');
    assert.equal(arbEn[arbKey], v, `app_en.arb drift at ${arbKey}`);
    assert.equal(arbBn[arbKey], UNDAL_MESSAGES_BN[k], `app_bn.arb drift at ${arbKey}`);
  }

  assert.equal(Object.keys(UNDAL_PLATFORM_SETTINGS).length, 72);
  assert.equal(Object.keys(UNDAL_ERROR_CATALOG).length, 39);
  assert.equal(Object.keys(UNDAL_LIGHT_COLORS).length, 21);
  assert.equal(Object.keys(UNDAL_DARK_COLORS).length, 21);
});
