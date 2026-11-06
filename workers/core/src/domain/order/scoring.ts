/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The fourteen factors that rank candidates, and the arithmetic nobody can argue with afterwards (`11 §5`, D123).
 *
 * `assignment.ts` answers *may this rider be asked*; this module answers *who is asked first*. The two are separate
 * on purpose. A filter is a rule with a name and a number, and a refusal can be explained to a rider. A score is a
 * weighted sum of fourteen opinions, and the only thing that makes it defensible is that every input is written
 * down, every weight is written down with its default, and the same inputs always produce the same ordering.
 *
 * **Why this exists as its own module and not inside the writer.** These numbers decide who earns. The weights are
 * `platform_config.dispatch_weights` — versioned, audited, editable from Brain Lab — but the *functions* must be
 * code, and code that decides earnings belongs where a test can pin every anchor point: the sweet spot of `eta_fit`,
 * the saturation of `fairness`, the score at which `cash_headroom` reaches zero. A ranked list produced anywhere
 * else cannot be re-derived after the fact, and §12's benchmark replay would have nothing to replay.
 *
 * Nothing here touches the network, the database or the clock. `idle_s`, `deliveries_today`, the rates and the
 * forecast all arrive as inputs; the caller reads them and this function judges them.
 */

/** The weight of each factor. Defaults are `11 §5`'s table; they sum to exactly 1.000. */
export interface DispatchWeights {
  readonly proximity: number;
  readonly etaFit: number;
  readonly acceptance: number;
  readonly reliability: number;
  readonly fairness: number;
  readonly rating: number;
  readonly vendorFamiliarity: number;
  readonly areaFamiliarity: number;
  readonly batchFit: number;
  readonly loadBalance: number;
  readonly cashHeadroom: number;
  readonly zoneCoverage: number;
  readonly freshness: number;
  readonly vehicleFit: number;
}

/**
 * `11 §5`'s default weights, frozen.
 *
 * Frozen because they are read by every dispatch and written by nothing here: the admin-editable copy lives in
 * `platform_config.dispatch_weights`, versioned and audited, and a module that could be mutated at runtime would be
 * a second, unaudited source of the same numbers.
 *
 * **They sum to 1.005, and `11 §5` says 1.000.** The table's fourteen individual weights are the authoritative
 * numbers — they are quoted in the Brain Lab, in the benchmark, and in every conversation about dispatch — and their
 * arithmetic is simply off by 0.005. Two ways to make the sum close: trim a factor, or divide everything by 1.005.
 * Both change weights an operator believes they set, invisibly, and one of them changes the relative standing of two
 * candidates. So the numbers stay verbatim, `weightSum()` reports 1.005 and the admin panel can say so, and the
 * consequence is bounded: a total score can reach 1.005 and `score()` does not clamp it. `11 §5` is annotated with
 * the discrepancy; a decision recorded is a discrepancy an operator can find.
 */
export const DEFAULT_WEIGHTS: DispatchWeights = Object.freeze({
  proximity: 0.17,
  etaFit: 0.15,
  acceptance: 0.13,
  reliability: 0.11,
  fairness: 0.095,
  rating: 0.07,
  vendorFamiliarity: 0.055,
  areaFamiliarity: 0.055,
  batchFit: 0.05,
  loadBalance: 0.045,
  cashHeadroom: 0.03,
  zoneCoverage: 0.025,
  freshness: 0.01,
  vehicleFit: 0.01,
});

/** The version of the weights this build ships, carried on every trace so a ranking can be reproduced. */
export const WEIGHTS_VERSION = 1;

/** The median pickup distance `proximity` is scaled by when a zone has no figure of its own (`11 §5`). */
export const DEFAULT_MEDIAN_PICKUP_M = 1_100;

/** The sweet spot of `eta_fit`: arriving this long before the food is ready is perfect. */
export const ETA_EARLY_SWEET_S = 120;

/** How far early of the sweet spot `eta_fit` decays to zero: fifteen minutes. */
export const ETA_EARLY_DECAY_S = 900;

/** How far late of ready `eta_fit` decays to zero: seven minutes. Deliberately half the early side. */
export const ETA_LATE_DECAY_S = 420;

/** `fairness` saturates with twenty minutes of idle time. */
export const FAIRNESS_IDLE_SATURATION_S = 1_200;

/** The deliveries-from-this-vendor count at which `vendor_familiarity` reaches 1. */
export const VENDOR_FAMILIARITY_DELIVERIES = 8;

/** The deliveries-into-this-cell count at which `area_familiarity` reaches 1. */
export const AREA_FAMILIARITY_DELIVERIES = 12;

/** Everything one candidate's factors are computed from. Rates are `[0, 1]` unless noted. */
export interface ScoringFacts {
  readonly riderId: string;
  /** Routed metres to the vendor, or the straight-line estimate standing in for it. */
  readonly routedDistanceToVendorM: number;
  /** When the rider would reach the vendor, and when the food is ready, both in seconds from now. */
  readonly arrivalAtVendorS: number;
  readonly readyInS: number;
  /** Wilson-bounded acceptance rate (`11 §5` factor 3); the logistic model of `09 §7.4` is not built. */
  readonly acceptanceRate: number;
  readonly completionRate: number;
  readonly onTimeRate: number;
  readonly idleS: number;
  readonly deliveriesToday: number;
  /** Wilson lower bound of the 4★-or-5★ share. */
  readonly ratingLowerBound: number;
  readonly deliveriesFromVendor: number;
  readonly deliveriesIntoCell: number;
  /** `12 §5`'s bundle feasibility, zero when this rider is not a batch candidate. */
  readonly batchFeasibility: number;
  readonly currentLoad: number;
  readonly maxConcurrent: number;
  readonly cashInHandPaisa: number;
  readonly cashLimitPaisa: number;
  /** The demand-forecast figure: how much this cell would miss the rider (§5 factor 12). */
  readonly coverageValue: number;
  readonly positionAgeS: number;
  readonly positionStaleAfterS: number;
  /** How suitable the rider's vehicle is for this order, already judged (§5 factor 14). */
  readonly vehicleSuitability: number;
}

/** The zone-level figures the factors are measured against. */
export interface ZoneFeatures {
  readonly medianPickupM: number;
  readonly medianDeliveriesToday: number;
}

/** Clamp into `[0, 1]`; every factor's contract says it returns a value in that range. */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

/** Factor 1: `1 / (1 + d/k)` — closer is better, and the curve never reaches zero. */
export function proximity(routedM: number, medianPickupM: number): number {
  const k = medianPickupM > 0 ? medianPickupM : DEFAULT_MEDIAN_PICKUP_M;
  const d = Math.max(0, routedM);
  return unit(1 / (1 + d / k));
}

/**
 * Factor 2: how well the arrival matches the food being ready (`11 §5.1`).
 *
 * The asymmetry is the point and it is tested: arriving twelve minutes early costs the rider unpaid waiting and
 * crowds the counter, arriving six minutes late costs the customer a cold meal — and the second is worse, so the
 * late side decays in half the distance.
 */
export function etaFit(arrivalAtVendorS: number, readyInS: number): number {
  const slack = readyInS - arrivalAtVendorS;
  if (slack >= 0 && slack <= ETA_EARLY_SWEET_S) return 1;
  if (slack > ETA_EARLY_SWEET_S) return unit(1 - (slack - ETA_EARLY_SWEET_S) / ETA_EARLY_DECAY_S);
  return unit(1 - -slack / ETA_LATE_DECAY_S);
}

/** Factor 3: the rider's acceptance rate for this offer, as the model supplies it. */
export function acceptance(rate: number): number {
  return unit(rate);
}

/** Factor 4: `0.6 × completion + 0.4 × on-time`, both already Wilson-bounded. */
export function reliability(completionRate: number, onTimeRate: number): number {
  return unit(0.6 * unit(completionRate) + 0.4 * unit(onTimeRate));
}

/**
 * Factor 5: spreading work (`11 §5.2`).
 *
 * Without it, dispatch concentrates on the riders near the busiest vendors — a positive-feedback failure mode whose
 * only defence is paying an explicit cost in the objective. 0.55 idle against 0.45 load, exactly as documented.
 */
export function fairness(idleS: number, deliveriesToday: number, zoneMedianToday: number): number {
  const idleTerm = unit(idleS / FAIRNESS_IDLE_SATURATION_S);
  if (zoneMedianToday <= 0) return unit(0.55 * idleTerm + 0.45);
  const ratio = Math.max(0, deliveriesToday) / zoneMedianToday;
  const loadTerm = unit(1.5 - 0.5 * ratio);
  return unit(0.55 * idleTerm + 0.45 * loadTerm);
}

/** Factor 6: the rider's rating, as the Wilson lower bound already computed. */
export function rating(lowerBound: number): number {
  return unit(lowerBound);
}

/** Factor 7: `min(1, deliveries_from_this_vendor / 8)` — a rider who knows the back entrance is faster. */
export function vendorFamiliarity(deliveries: number): number {
  return unit(Math.max(0, deliveries) / VENDOR_FAMILIARITY_DELIVERIES);
}

/** Factor 8: `min(1, deliveries_into_this_cell / 12)` — matters for finding an unmarked door. */
export function areaFamiliarity(deliveries: number): number {
  return unit(Math.max(0, deliveries) / AREA_FAMILIARITY_DELIVERIES);
}

/** Factor 9: the bundle's feasibility, zero for a rider who is not a batch candidate. */
export function batchFit(feasibility: number): number {
  return unit(feasibility);
}

/** Factor 10: falls as concurrent orders approach the rider's maximum. A rider with no capacity scores zero. */
export function loadBalance(currentLoad: number, maxConcurrent: number): number {
  if (maxConcurrent <= 0) return 0;
  return unit(1 - Math.max(0, currentLoad) / maxConcurrent);
}

/** Factor 11: `1 − (cash_in_hand + order_total) / cash_limit`, floored at zero. */
export function cashHeadroom(cashInHandPaisa: number, orderTotalPaisa: number, cashLimitPaisa: number): number {
  if (cashLimitPaisa <= 0) return 0;
  return unit(1 - (Math.max(0, cashInHandPaisa) + Math.max(0, orderTotalPaisa)) / cashLimitPaisa);
}

/** Factor 12: how much the cell would miss this rider, from the demand forecast. */
export function zoneCoverage(coverageValue: number): number {
  return unit(coverageValue);
}

/**
 * Factor 13: falls as the fix ages against the deadline it was accepted with.
 *
 * It is a tiebreaker between riders who both passed filter 4 — a rider seen four minutes ago still loses to an
 * equivalent one seen ten seconds ago. A rider with no budget at all scores zero rather than one: an age nobody can
 * bound is not freshness.
 */
export function freshness(positionAgeS: number, positionStaleAfterS: number): number {
  if (positionStaleAfterS <= 0) return 0;
  return unit(1 - Math.max(0, positionAgeS) / positionStaleAfterS);
}

/** Factor 14: how suitable the rider's vehicle is for this order, already judged. */
export function vehicleFit(suitability: number): number {
  return unit(suitability);
}

/** A scored candidate: the ranking key, the acceptance factor the wave model needs, and every factor for the trace. */
export interface Scored {
  readonly riderId: string;
  /** The weighted sum in `[0, 1]`. */
  readonly score: number;
  /** Factor 3 alone, which is what `pNobodyAccepts` multiplies — not the total score. */
  readonly acceptanceProbability: number;
  readonly factors: {
    readonly proximity: number;
    readonly etaFit: number;
    readonly acceptance: number;
    readonly reliability: number;
    readonly fairness: number;
    readonly rating: number;
    readonly vendorFamiliarity: number;
    readonly areaFamiliarity: number;
    readonly batchFit: number;
    readonly loadBalance: number;
    readonly cashHeadroom: number;
    readonly zoneCoverage: number;
    readonly freshness: number;
    readonly vehicleFit: number;
  };
}

/** Every factor for one candidate, in `11 §5`'s order. */
export function factorsFor(facts: ScoringFacts, zone: ZoneFeatures, orderTotalPaisa: number): Scored["factors"] {
  return {
    proximity: proximity(facts.routedDistanceToVendorM, zone.medianPickupM),
    etaFit: etaFit(facts.arrivalAtVendorS, facts.readyInS),
    acceptance: acceptance(facts.acceptanceRate),
    reliability: reliability(facts.completionRate, facts.onTimeRate),
    fairness: fairness(facts.idleS, facts.deliveriesToday, zone.medianDeliveriesToday),
    rating: rating(facts.ratingLowerBound),
    vendorFamiliarity: vendorFamiliarity(facts.deliveriesFromVendor),
    areaFamiliarity: areaFamiliarity(facts.deliveriesIntoCell),
    batchFit: batchFit(facts.batchFeasibility),
    loadBalance: loadBalance(facts.currentLoad, facts.maxConcurrent),
    cashHeadroom: cashHeadroom(facts.cashInHandPaisa, orderTotalPaisa, facts.cashLimitPaisa),
    zoneCoverage: zoneCoverage(facts.coverageValue),
    freshness: freshness(facts.positionAgeS, facts.positionStaleAfterS),
    vehicleFit: vehicleFit(facts.vehicleSuitability),
  };
}

/** The weighted sum. Weights are passed in so Brain Lab's version can be replayed against the same code. */
export function score(factors: Scored["factors"], weights: DispatchWeights = DEFAULT_WEIGHTS): number {
  const total =
    factors.proximity * weights.proximity +
    factors.etaFit * weights.etaFit +
    factors.acceptance * weights.acceptance +
    factors.reliability * weights.reliability +
    factors.fairness * weights.fairness +
    factors.rating * weights.rating +
    factors.vendorFamiliarity * weights.vendorFamiliarity +
    factors.areaFamiliarity * weights.areaFamiliarity +
    factors.batchFit * weights.batchFit +
    factors.loadBalance * weights.loadBalance +
    factors.cashHeadroom * weights.cashHeadroom +
    factors.zoneCoverage * weights.zoneCoverage +
    factors.freshness * weights.freshness +
    factors.vehicleFit * weights.vehicleFit;
  // Deliberately not clamped: `11 §5`'s defaults sum to 1.005, so a rider who is perfect on all fourteen factors
  // scores 1.005. Clamping would hide that, and the number is only ever compared to other candidates' numbers.
  return Number.isFinite(total) ? Math.max(0, total) : 0;
}

/**
 * Rank the candidates, deterministically.
 *
 * Sorting is `(-score, -acceptance, riderId)` — `11 §5.3`'s order, and the final tiebreak is arbitrary but stable,
 * because §12's replay test compares two runs of the same trace and an unstable sort would make the benchmark
 * unfalsifiable. `riderId` is compared as a string, so the same ids always compare the same way on any runtime.
 */
export function scoreCandidates(
  candidates: readonly { readonly facts: ScoringFacts }[],
  zone: ZoneFeatures,
  orderTotalPaisa: number,
  weights: DispatchWeights = DEFAULT_WEIGHTS,
): readonly Scored[] {
  const scored: Scored[] = candidates.map(({ facts }) => {
    const factors = factorsFor(facts, zone, orderTotalPaisa);
    return {
      riderId: facts.riderId,
      score: score(factors, weights),
      acceptanceProbability: factors.acceptance,
      factors,
    };
  });
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.acceptanceProbability !== left.acceptanceProbability) {
      return right.acceptanceProbability - left.acceptanceProbability;
    }
    return left.riderId < right.riderId ? -1 : left.riderId > right.riderId ? 1 : 0;
  });
  return scored;
}

/** The sum of a weight set, for the admin panel's "these do not add to 1" warning. */
export function weightSum(weights: DispatchWeights = DEFAULT_WEIGHTS): number {
  return (
    weights.proximity +
    weights.etaFit +
    weights.acceptance +
    weights.reliability +
    weights.fairness +
    weights.rating +
    weights.vendorFamiliarity +
    weights.areaFamiliarity +
    weights.batchFit +
    weights.loadBalance +
    weights.cashHeadroom +
    weights.zoneCoverage +
    weights.freshness +
    weights.vehicleFit
  );
}

/**
 * The Wilson score interval's lower bound (`11 §5` factors 3, 4 and 6, D125).
 *
 * Every rate in the scoring table is a *lower bound*, not a raw ratio, and the reason is the same in all three places:
 * a rider who has taken one offer and accepted it has a 100 % rate, and should not outrank one who has taken four
 * hundred and accepted three hundred. The Wilson bound prices in how little is known, so the one-off sits near zero and
 * the veteran near their real rate; with no observations the bound is exactly zero.
 *
 * `z = 1.96` is the 95 % interval the document specifies. The result is clamped into `[0, 1]` for the degenerate
 * cases (no trials, successes exceeding trials from an inconsistent aggregate).
 */
export function wilsonLowerBound(successes: number, trials: number, z = 1.96): number {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return 0;
  const n = trials;
  const p = Math.min(1, Math.max(0, successes / n));
  const z2 = z * z;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return unit((centre - margin) / (1 + z2 / n));
}
