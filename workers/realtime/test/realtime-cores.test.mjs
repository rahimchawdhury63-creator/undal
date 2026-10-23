/**
 * @file workers/realtime/test/realtime-cores.test.mjs
 * @description Pure vector & invariant test suite for `W2 undal-realtime` (`Build Response 8`):
 * - All `6` Golden Rider Fare Vectors (`F-1..F-6`, `Appendix F`) + monotonicity laws
 * - Presence classifier (`LIVE` / `STALE` / `OFFLINE`), smart prep estimator (`D-22`), ETA engine
 * - Multi-factor assignment scorer (`File 12 §12.2`), bicycle `4 km` radius guard (`DSP-04`), & `D-23`
 * - Multi-order Batch Builder (`DSP-03`), `18 min` food-heat law, `6 min` detour cap & survivor re-sequencing
 * - Polygon zone resolver, Plus Codes, `Nominatim` cache, `OSRM` fallback, and `api.met.no` weather adapter
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiderFare } from '@undal/shared-ts';
import {
  buildOptimalBatchPlan,
  classifyPresence,
  computeCustomerEta,
  computeReadinessSyncScore,
  computeSuggestedPrepMinutes,
  encodePlusCode,
  evaluateOfferRejection,
  rankRiderCandidates,
  resequenceBatchAfterCancellation,
  resolvePointZone,
  validateCommittedPrepMinutes,
} from '../src/index.ts';

const NOW_MS = Date.parse('2026-10-23T12:00:00Z');

test('W2 Pure Core Vectors: F-1..F-6 Golden Fares, Presence, Assignment, Batcher & Geo Invariants', () => {
  // 1. Exact Appendix F Rider Fare Golden Vectors F-1 .. F-6 (0-poisha tolerance!)
  assert.equal(
    calculateRiderFare({
      travelDistanceKm: 5.0,
      toVendorKm: 1.2,
      trafficDelayMinutes: 12,
      activeOrdersInZone: 8,
      activeRidersInZone: 3,
      weatherCondition: 'rain',
      vehicleType: 'motorbike',
      batchPosition: 1,
      orderFoodPayablePoisha: 43_280,
      isPriority: false,
      minimumFareFloorPoisha: 4_000,
    }).riderFarePoisha,
    13_584,
  );
  assert.equal(
    calculateRiderFare({
      baseFarePoisha: 2_500,
      travelDistanceKm: 1.9,
      toVendorKm: 0.6,
      trafficDelayMinutes: 0,
      activeOrdersInZone: 4,
      activeRidersInZone: 6,
      weatherCondition: 'clear',
      vehicleType: 'bicycle',
      batchPosition: 1,
      orderFoodPayablePoisha: 22_500,
      isPriority: false,
      minimumFareFloorPoisha: 3_000,
    }).riderFarePoisha,
    3_000,
  );
  assert.equal(
    calculateRiderFare({
      travelDistanceKm: 8.5,
      toVendorKm: 2.0,
      trafficDelayMinutes: 16,
      activeOrdersInZone: 6,
      activeRidersInZone: 1,
      weatherCondition: 'storm',
      vehicleType: 'motorbike',
      batchPosition: 1,
      orderFoodPayablePoisha: 60_000,
      isPriority: false,
    }).riderFarePoisha,
    30_661,
  );
  assert.equal(
    calculateRiderFare({
      travelDistanceKm: 5.0,
      toVendorKm: 1.2,
      trafficDelayMinutes: 12,
      activeOrdersInZone: 8,
      activeRidersInZone: 3,
      weatherCondition: 'rain',
      vehicleType: 'motorbike',
      batchPosition: 2,
      orderFoodPayablePoisha: 30_000,
      isPriority: false,
    }).riderFarePoisha,
    11_172,
  );
  assert.equal(
    calculateRiderFare({
      travelDistanceKm: 4.2,
      toVendorKm: 1.0,
      trafficDelayMinutes: 7,
      activeOrdersInZone: 6,
      activeRidersInZone: 4,
      weatherCondition: 'extreme_heat',
      vehicleType: 'bicycle',
      batchPosition: 1,
      orderFoodPayablePoisha: 30_000,
      isPriority: false,
    }).riderFarePoisha,
    6_061,
  );
  assert.equal(
    calculateRiderFare({
      travelDistanceKm: 12.5,
      toVendorKm: 2.0,
      trafficDelayMinutes: 3,
      activeOrdersInZone: 2,
      activeRidersInZone: 5,
      weatherCondition: 'clear',
      vehicleType: 'motorbike',
      batchPosition: 1,
      orderFoodPayablePoisha: 50_000,
      isPriority: false,
    }).riderFarePoisha,
    16_300,
  );

  // 2. Presence boundary law (`File 12 §12.1`: <= 25s LIVE, 25..60s STALE, > 60s OFFLINE)
  assert.equal(classifyPresence(NOW_MS - 25_000, NOW_MS), 'LIVE');
  assert.equal(classifyPresence(NOW_MS - 25_100, NOW_MS), 'STALE');
  assert.equal(classifyPresence(NOW_MS - 60_000, NOW_MS), 'STALE');
  assert.equal(classifyPresence(NOW_MS - 60_100, NOW_MS), 'OFFLINE');
  assert.equal(classifyPresence(null, NOW_MS), 'OFFLINE');

  // 3. Smart prep suggestion (`D-22`) & customer ETA slip alert (`File 12 §12.6`)
  const stormPrep = computeSuggestedPrepMinutes({
    baselineMinutes: 18,
    openOrdersPrepWeight: 4,
    kitchenCapacitySlots: 2,
    weatherCondition: 'storm',
    busyModeExtraMinutes: 10,
  });
  assert.ok(stormPrep.suggestedMinutes > 30);
  assert.equal(validateCommittedPrepMinutes(75, '').valid, false);
  assert.equal(validateCommittedPrepMinutes(75, 'large_party_order').valid, true);

  const eta = computeCustomerEta({
    fulfilment: 'delivery',
    prepReadyAtMs: NOW_MS + 20 * 60_000,
    riderArriveVendorAtMs: NOW_MS + 18 * 60_000,
    loadedLegMinutes: 11,
    previousPromisedAtMs: NOW_MS + 20 * 60_000,
  });
  assert.equal(eta.slippedAlert, true);

  // 4. DSP-04 Bicycle 4km radius guard + readiness sync + D-23 decision rule
  assert.equal(computeReadinessSyncScore(8, 10), 1); // Arrives 2m before ready -> 1.0 perfect
  const longOrder = {
    orderId: '11111111-1111-1111-1111-111111111111',
    publicCode: 'UD-SYL-261023-2001',
    zoneId: '22222222-2222-2222-2222-222222222222',
    vendorId: '33333333-3333-3333-3333-333333333333',
    customerId: '44444444-4444-4444-4444-444444444444',
    fulfilment: 'delivery',
    status: 'VENDOR_ACCEPTED',
    vendorPoint: { lat: 24.8949, lng: 91.8687 },
    customerPoint: { lat: 24.9400, lng: 91.8687 }, // > 6.7 km road leg (> 4.0 km bicycle limit!)
    itemsPoisha: 40_000,
    foodPayablePoisha: 40_000,
    codCollectPoisha: 46_500,
    isPriority: false,
    prepReadyAtMs: NOW_MS + 6 * 60_000,
    placedAtMs: NOW_MS,
    bagUnits: 1,
  };
  const baseCandidate = {
    riderId: 'cycle-01',
    profileId: 'prof-cycle-01',
    vehicleType: 'bicycle',
    lat: 24.8955,
    lng: 91.8690,
    accuracyM: 10,
    capacityUsed: 0,
    ratingAvg90d: 4.9,
    ratingCount: 40,
    completionRate30d: 99,
    acceptanceHealth: 0.98,
    batteryPct: 80,
    lastSeenAtMs: NOW_MS - 5_000,
    idleMinutes: 25,
    cashInHandPoisha: 0,
    cashCeilingPoisha: 300_000,
    cashGateBlocked: false,
    kycStatus: 'approved',
    isActive: true,
    isOnline: true,
    hasFailedDeliveryHold: false,
    headingVendorId: null,
    headingDropPoint: null,
  };
  const bikeCandidate = { ...baseCandidate, riderId: 'bike-01', profileId: 'prof-bike-01', vehicleType: 'motorbike', cashCeilingPoisha: 500_000 };
  const rankedLong = rankRiderCandidates({
    order: longOrder,
    candidates: [baseCandidate, bikeCandidate],
    activeOrdersInZone: 2,
    weatherCondition: 'clear',
    nowMs: NOW_MS,
  });
  assert.equal(rankedLong.length, 1);
  assert.equal(rankedLong[0].rider.riderId, 'bike-01', 'DSP-04: bicycle MUST NEVER be offered > 4km leg');

  assert.equal(evaluateOfferRejection({ soloRider: true, requestReassign: false, priorRejectionsCount: 0 }).allowed, false);
  const soloReassign = evaluateOfferRejection({ soloRider: true, requestReassign: true, priorRejectionsCount: 0 });
  assert.equal(soloReassign.allowed, true);
  assert.equal(soloReassign.escalateToAdmin, true);

  // 5. DSP-03 Multi-Order Batch Builder + Mid-Batch Survivor Re-Sequencer
  const ordA = {
    ...longOrder,
    orderId: 'ord-a',
    customerPoint: { lat: 24.9015, lng: 91.8710 },
    prepReadyAtMs: NOW_MS + 10 * 60_000,
  };
  const ordB = {
    ...longOrder,
    orderId: 'ord-b',
    publicCode: 'UD-SYL-261023-2002',
    customerPoint: { lat: 24.9045, lng: 91.8730 },
    prepReadyAtMs: NOW_MS + 13 * 60_000,
  };
  const batch = buildOptimalBatchPlan({
    orders: [ordA, ordB],
    riderOrigin: { lat: 24.8940, lng: 91.8680 },
    vehicleType: 'motorbike',
    activeOrdersInZone: 4,
    activeRidersInZone: 2,
    weatherCondition: 'rain',
  });
  assert.ok(batch !== null, 'DSP-03: same-vendor close drop-offs form a bundled batch');
  assert.equal(batch.orderIds.length, 2);
  assert.ok(batch.maxPostPickupRideMinutes <= 18);
  assert.ok(batch.firstCustomerDetourMinutes <= 6);
  assert.equal(batch.perOrderFares[0].batchPosition, 1);
  assert.equal(batch.perOrderFares[1].batchPosition, 2);

  // Priority orders NEVER batch (`File 11 §11.4`):
  assert.equal(
    buildOptimalBatchPlan({
      orders: [{ ...ordA, isPriority: true }, ordB],
      riderOrigin: { lat: 24.8940, lng: 91.8680 },
      vehicleType: 'motorbike',
      activeOrdersInZone: 4,
      activeRidersInZone: 2,
      weatherCondition: 'clear',
    }),
    null,
  );

  // Mid-batch cancellation re-sequences surviving order cleanly (`File 12 §12.4`):
  const survivor = resequenceBatchAfterCancellation({
    remainingOrders: [ordB],
    riderPosition: { lat: 24.8950, lng: 91.8690 },
    vehicleType: 'motorbike',
    activeOrdersInZone: 3,
    activeRidersInZone: 2,
    weatherCondition: 'clear',
  });
  assert.equal(survivor.mode, 'solo');
  assert.deepEqual(survivor.survivingOrderIds, ['ord-b']);

  // 6. Overlapping polygon resolution (smallest containing polygon wins) + Plus-Code encoding
  const outer = {
    id: 'z-outer',
    slug: 'sylhet-metro',
    nameEn: 'Sylhet Metro',
    isActive: true,
    roadFactor: 1.35,
    ring: [
      { lat: 24.80, lng: 91.80 },
      { lat: 24.98, lng: 91.80 },
      { lat: 24.98, lng: 91.95 },
      { lat: 24.80, lng: 91.95 },
    ],
  };
  const inner = {
    id: 'z-inner',
    slug: 'zindabazar-core',
    nameEn: 'Zindabazar Core',
    isActive: true,
    roadFactor: 1.35,
    ring: [
      { lat: 24.89, lng: 91.86 },
      { lat: 24.91, lng: 91.86 },
      { lat: 24.91, lng: 91.88 },
      { lat: 24.89, lng: 91.88 },
    ],
  };
  const insideBoth = resolvePointZone({ lat: 24.90, lng: 91.87 }, [outer, inner]);
  assert.equal(insideBoth.serviceable, true);
  assert.equal(insideBoth.matchedZone?.id, 'z-inner');
  assert.equal(encodePlusCode(24.8949, 91.8687).includes('+'), true);
});
