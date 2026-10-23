/**
 * @file workers/realtime/src/assignment.ts
 * @description Canonical single-order & batch rider candidate filter, `0..100` multi-factor scorer,
 * vehicle loaded-leg radius guard (`DSP-04`), and `D-23` Solo-Rider decision engine
 * (`Master Guide File 12 §12.2–§12.3` & `Appendix F` `DSP-01`, `DSP-02`, `DSP-04`).
 */

import {
  calculateRiderFare,
  DEFAULT_FARE_POLICY,
  type FarePolicyConfig,
  type WeatherCondition,
} from '@undal/shared-ts';
import { estimateRoadLegFallback, haversineKm } from './geo.ts';
import { classifyPresence } from './presence.ts';
import type {
  AssignmentScoreFactors,
  DispatchOrderSnapshot,
  RiderCandidate,
  ScoredCandidate,
} from './types.ts';

export interface ScoringWeights {
  readonly proximity: number;
  readonly readinessSync: number;
  readonly reliability: number;
  readonly rating: number;
  readonly fairness: number;
  readonly batchFit: number;
  readonly failedHoldPenalty: number;
  readonly lowBatteryPenalty: number;
  readonly poorGpsPenalty: number;
}

/** Exact default weights from `File 12 §12.2`: `34 + 22 + 16 + 10 + 10 + 8 = 100`. */
export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  proximity: 34,
  readinessSync: 22,
  reliability: 16,
  rating: 10,
  fairness: 10,
  batchFit: 8,
  failedHoldPenalty: 15,
  lowBatteryPenalty: 8,
  poorGpsPenalty: 10,
} as const;

export interface RankCandidatesInput {
  readonly order: DispatchOrderSnapshot;
  readonly candidates: readonly RiderCandidate[];
  readonly excludedRiderIds?: ReadonlySet<string>;
  readonly activeOrdersInZone: number;
  readonly weatherCondition: WeatherCondition;
  readonly trafficDelayMinutes?: number;
  readonly roadFactor?: number;
  readonly radiusMultiplier?: number;
  readonly requiredCapacitySlots?: number;
  readonly maxLoadedLegKmOverride?: number;
  readonly totalCodCollectPoishaOverride?: number;
  readonly allowLongDistanceMotorbike?: boolean;
  readonly nowMs: number;
  readonly farePolicy?: FarePolicyConfig;
  readonly weights?: ScoringWeights;
}

/** Maximum concurrent order slots per vehicle type (`File 12 §12.2`). */
export function maxConcurrentCapacity(vehicleType: 'motorbike' | 'bicycle'): number {
  return vehicleType === 'bicycle' ? 2 : 3;
}

/**
 * Computes readiness synchronisation in `[0, 1]` (`File 12 §12.2` Food Heat Law):
 * - Rider arriving `0..5 min` BEFORE `prepReadyAt` is `1.0` (zero hot-food shelf decay, minimal wait).
 * - Arriving much earlier (`> 5 min` early) decays gently to avoid unpaid kitchen waiting.
 * - Arriving AFTER `prepReadyAt` decays sharply (`12 min` late -> `0.0`) to protect food heat.
 */
export function computeReadinessSyncScore(etaToVendorMinutes: number, prepReadyInMinutes: number): number {
  const deltaMin = etaToVendorMinutes - prepReadyInMinutes;
  if (deltaMin >= -5 && deltaMin <= 0) return 1;
  if (deltaMin < -5) {
    const excessEarly = -5 - deltaMin;
    return Math.max(0, 1 - excessEarly / 15);
  }
  return Math.max(0, 1 - deltaMin / 12);
}

/**
 * Filters and scores all eligible riders in `zone_id` for `order`, returning candidates sorted
 * strictly descending by `score` with deterministic tie-breaking (`idleMinutes` desc, `toVendorKm` asc, `riderId` asc).
 */
export function rankRiderCandidates(input: RankCandidatesInput): readonly ScoredCandidate[] {
  const policy = input.farePolicy ?? DEFAULT_FARE_POLICY;
  const weights = input.weights ?? DEFAULT_SCORING_WEIGHTS;
  const roadFactor = input.roadFactor ?? 1.35;
  const radiusMult = Math.max(1, input.radiusMultiplier ?? 1);
  const slotsNeeded = Math.max(1, input.requiredCapacitySlots ?? 1);
  const codNeeded = input.totalCodCollectPoishaOverride ?? input.order.codCollectPoisha;

  const vendorToCustomerLeg = estimateRoadLegFallback(
    input.order.vendorPoint,
    input.order.customerPoint,
    'motorbike',
    roadFactor,
  );
  const maxLoadedLegKm = input.maxLoadedLegKmOverride ?? vendorToCustomerLeg.distanceKm;
  const prepReadyInMin = Math.max(0, (input.order.prepReadyAtMs - input.nowMs) / 60_000);

  // Count total LIVE approved riders with free capacity in the zone for exact SDR calculation.
  const activeRidersInZone = input.candidates.filter(
    (c) =>
      classifyPresence(c.lastSeenAtMs, input.nowMs) === 'LIVE' &&
      c.isActive &&
      c.isOnline &&
      c.kycStatus === 'approved' &&
      !c.cashGateBlocked &&
      c.capacityUsed < maxConcurrentCapacity(c.vehicleType),
  ).length;

  const scored: ScoredCandidate[] = [];

  for (const candidate of input.candidates) {
    if (input.excludedRiderIds?.has(candidate.riderId)) continue;
    if (classifyPresence(candidate.lastSeenAtMs, input.nowMs) !== 'LIVE') continue;
    if (!candidate.isActive || !candidate.isOnline || candidate.kycStatus !== 'approved') continue;
    if (candidate.cashGateBlocked) continue;
    if (candidate.capacityUsed + slotsNeeded > maxConcurrentCapacity(candidate.vehicleType)) continue;
    if (candidate.cashInHandPoisha + codNeeded > candidate.cashCeilingPoisha) continue;

    // Hard vehicle loaded-leg radius guard (`File 11 §11.2`, `DSP-04`):
    // Bicycle NEVER receives loaded legs > maxLoadedKmBicycle (default 4.0 km).
    if (candidate.vehicleType === 'bicycle') {
      if (maxLoadedLegKm > policy.maxLoadedKmBicycle * radiusMult) continue;
    } else if (!input.allowLongDistanceMotorbike) {
      if (maxLoadedLegKm > policy.maxLoadedKmMotorbike * radiusMult) continue;
    }

    const toVendorLeg = estimateRoadLegFallback(
      { lat: candidate.lat, lng: candidate.lng },
      input.order.vendorPoint,
      candidate.vehicleType,
      roadFactor,
    );

    const proximity = Math.max(0, 1 - Math.min(1, toVendorLeg.durationMinutes / 12));
    const readinessSync = computeReadinessSyncScore(toVendorLeg.durationMinutes, prepReadyInMin);
    const reliability = Math.min(
      1,
      Math.max(0, (candidate.completionRate30d / 100) * Math.min(1, Math.max(0, candidate.acceptanceHealth))),
    );
    const rating =
      candidate.ratingCount >= 5
        ? Math.min(1, Math.max(0, candidate.ratingAvg90d / 5))
        : 0.8;
    const fairness = Math.min(1, Math.max(0, candidate.idleMinutes / 45));

    const sameVendorHeading = candidate.headingVendorId === input.order.vendorId;
    const corridorHeading =
      candidate.headingDropPoint !== null &&
      haversineKm(candidate.headingDropPoint, input.order.customerPoint) <= 1.2;
    const batchFit = sameVendorHeading || corridorHeading ? 1 : 0;

    let penalties = 0;
    if (candidate.hasFailedDeliveryHold) penalties += weights.failedHoldPenalty;
    if (candidate.batteryPct !== null && candidate.batteryPct < 15) penalties += weights.lowBatteryPenalty;
    if (candidate.accuracyM > 100) penalties += weights.poorGpsPenalty;

    const rawScore =
      weights.proximity * proximity +
      weights.readinessSync * readinessSync +
      weights.reliability * reliability +
      weights.rating * rating +
      weights.fairness * fairness +
      weights.batchFit * batchFit -
      penalties;
    const roundedScore = Math.max(0, Math.min(100, Math.round(rawScore)));

    const fare = calculateRiderFare(
      {
        travelDistanceKm: Number((toVendorLeg.distanceKm + maxLoadedLegKm).toFixed(3)),
        toVendorKm: Number(toVendorLeg.distanceKm.toFixed(3)),
        trafficDelayMinutes: input.trafficDelayMinutes ?? 0,
        activeOrdersInZone: Math.max(1, input.activeOrdersInZone),
        activeRidersInZone,
        weatherCondition: input.weatherCondition,
        vehicleType: candidate.vehicleType,
        batchPosition: 1,
        orderFoodPayablePoisha: input.order.foodPayablePoisha,
        isPriority: input.order.isPriority,
      },
      policy,
    );

    const factors: AssignmentScoreFactors = {
      proximity: Math.round(proximity * 1000) / 1000,
      readinessSync: Math.round(readinessSync * 1000) / 1000,
      reliability: Math.round(reliability * 1000) / 1000,
      rating: Math.round(rating * 1000) / 1000,
      fairness: Math.round(fairness * 1000) / 1000,
      batchFit,
      penalties,
      etaToVendorMinutes: toVendorLeg.durationMinutes,
      toVendorKm: toVendorLeg.distanceKm,
      loadedKm: maxLoadedLegKm,
    };

    scored.push({ rider: candidate, score: roundedScore, factors, fare });
  }

  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.rider.idleMinutes !== a.rider.idleMinutes) return b.rider.idleMinutes - a.rider.idleMinutes;
    if (a.factors.toVendorKm !== b.factors.toVendorKm) return a.factors.toVendorKm - b.factors.toVendorKm;
    return a.rider.riderId.localeCompare(b.rider.riderId);
  });
}

export type OfferRejectionOutcome =
  | {
      readonly allowed: false;
      readonly errorCode: 'OFFER_NOT_REJECTABLE';
      readonly nextAction: 'prompt_request_reassign';
    }
  | {
      readonly allowed: true;
      readonly nextResponseState: 'rejected' | 'reassign_requested';
      readonly widenRadius: boolean;
      readonly escalateToAdmin: boolean;
    };

/**
 * Enforces `D-23` Solo-Rider protection (`File 12 §12.3`, `DSP-01`, `DSP-02`):
 * - When `soloRider === true` (zero backup riders at offer time), raw `"reject"` is refused with
 *   `OFFER_NOT_REJECTABLE` (`409`) so the UI surfaces `"Request reassign"` with structured reason chips.
 * - When the solo rider submits `requestReassign = true` with a reason chip, the offer transitions to
 *   `'reassign_requested'`, widens radius `+10%`, and alerts Admin Dispatch Tower if still unmatched.
 */
export function evaluateOfferRejection(params: {
  readonly soloRider: boolean;
  readonly requestReassign: boolean;
  readonly priorRejectionsCount: number;
}): OfferRejectionOutcome {
  if (params.soloRider && !params.requestReassign) {
    return {
      allowed: false,
      errorCode: 'OFFER_NOT_REJECTABLE',
      nextAction: 'prompt_request_reassign',
    };
  }
  if (params.soloRider && params.requestReassign) {
    return {
      allowed: true,
      nextResponseState: 'reassign_requested',
      widenRadius: true,
      escalateToAdmin: true,
    };
  }
  const totalRejections = params.priorRejectionsCount + 1;
  return {
    allowed: true,
    nextResponseState: 'rejected',
    widenRadius: totalRejections >= 3,
    escalateToAdmin: false,
  };
}
