/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { applyRate, floorToTaka } from "@undal/money";

/**
 * The deterministic fare — what Undal charges when the Brain does not answer in time.
 *
 * This is a second implementation of `10 §2–§11`, and it exists on purpose. The Brain is a Python
 * Worker that answers in 400 ms; when it is cold, deploying, or merely slow, the platform still has
 * to price an order, and it must price it *identically* — not approximately — or two customers in the
 * same zone pay differently for the same trip depending on a deploy window. The forty fare vectors
 * in `workers/brain/test/vectors/` are the contract between the two implementations, and
 * `test/pricing-fallback.test.ts` runs all forty through this file.
 *
 * Rules this file inherits from the Brain rather than inventing:
 *
 * - integer paisa everywhere; the supply–demand ratio is the only float, and it is quantised to
 *   basis points by `surgeBps` before it touches money;
 * - one rounding point per component, through `applyRate` (banker's rounding);
 * - `floorToTaka` once, at the end, on the customer's total;
 * - the closure identity asserted before a price is returned, never after.
 */

/** The traffic block every delay is measured in, and the share of an hour it represents. */
export const TRAFFIC_BLOCK_S = 300;

/** One vehicle class's rate card, resolved per zone and per vehicle. */
export interface VehicleRates {
  readonly vehicle: "MOTORBIKE" | "BICYCLE";
  readonly baseFarePaisa: number;
  readonly baseDistanceM: number;
  readonly perKmPaisa: number;
  readonly maxRadiusM: number;
  readonly minPayoutPaisa: number;
  readonly surgeCapBps: number;
  readonly trafficBlockPaisa: number;
  readonly minDeliveryFeePaisa: number;
  readonly maxDeliveryFeePaisa: number;
}

/**
 * One five-minute block of congestion, as `10 §2.1` derives it.
 *
 * The derivation is a function rather than a constant because a rate that is ৳8 for a reason will
 * otherwise be edited to ৳10 by someone who cannot see the reason.
 */
export function trafficBlockPaisa(targetHourlyPaisa: number, coverageBps = 8_000): number {
  const shareOfHour = applyRate(targetHourlyPaisa, Math.trunc((TRAFFIC_BLOCK_S * 10_000) / 3_600));
  return applyRate(shareOfHour, coverageBps);
}

/** The launch rate cards, matching `10 §2` and `fare/constants.py` figure for figure. */
export const LAUNCH_RATES: Readonly<Record<"MOTORBIKE" | "BICYCLE", VehicleRates>> = {
  MOTORBIKE: {
    vehicle: "MOTORBIKE",
    baseFarePaisa: 4_000,
    baseDistanceM: 2_000,
    perKmPaisa: 1_400,
    maxRadiusM: 12_000,
    minPayoutPaisa: 4_000,
    surgeCapBps: 22_000,
    trafficBlockPaisa: trafficBlockPaisa(12_000),
    minDeliveryFeePaisa: 2_500,
    maxDeliveryFeePaisa: 22_000,
  },
  BICYCLE: {
    vehicle: "BICYCLE",
    baseFarePaisa: 2_500,
    baseDistanceM: 2_000,
    perKmPaisa: 800,
    maxRadiusM: 4_000,
    minPayoutPaisa: 2_500,
    surgeCapBps: 22_000,
    trafficBlockPaisa: trafficBlockPaisa(7_500),
    minDeliveryFeePaisa: 2_000,
    maxDeliveryFeePaisa: 12_000,
  },
};

/** The vendor commission, `10 §10`: 15% of the item subtotal. */
export const COMMISSION_BPS = 1_500;

/** The rider's share of the item subtotal, `10 §7`: 3%, paid by the platform, not the vendor. */
export const RIDER_BONUS_BPS = 300;

/** The platform's gross on the delivery line, `10 §6`: 8% of the ride core. */
export const DELIVERY_MARGIN_BPS = 800;

/** VAT, `10 §10`: 5% of commission + order-fee share + delivery margin. */
export const TAX_BPS = 500;

/** Weather premiums, `10 §7`. The customer never pays these; the platform does. */
export const WEATHER_PREMIUM_BPS: Readonly<Record<WeatherCondition, number>> = {
  CLEAR: 0,
  RAIN: 2_000,
  STORM: 4_000,
  EXTREME_HEAT: 1_500,
};

/** The weather conditions the engine will price, which is also the set it can explain. */
export type WeatherCondition = "CLEAR" | "RAIN" | "STORM" | "EXTREME_HEAT";

/**
 * Below this confidence the weather reading is a guess, and a guess earns no premium.
 *
 * Expressed in basis points like every other ratio in the platform: a `0.5` in a money path is the
 * first float, and the rule that keeps pricing exact is that there is never a first one.
 */
export const WEATHER_CONFIDENCE_FLOOR_BPS = 5_000;

/** The order fee applies at or above this post-discount subtotal, `10 §8`. */
export const SMALL_ORDER_THRESHOLD_PAISA = 10_000;

/** The order fee itself, ৳25. */
export const SMALL_ORDER_FEE_PAISA = 2_500;

/** The rider's ৳5 of the order fee, collected from the customer and passed straight through. */
export const SMALL_ORDER_RIDER_PAISA = 500;

/** The vendor's ৳5 of the order fee, a contribution towards the packaging it does not charge for. */
export const SMALL_ORDER_VENDOR_PAISA = 500;

/** The platform's ৳15: the fee less the two shares, and asserted to be their complement. */
export const SMALL_ORDER_PAYOUT_PAISA = SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA - SMALL_ORDER_VENDOR_PAISA;

/** The pickup fee, ৳20: no rider exists, so the rider's share is not collected at all. */
export const SMALL_ORDER_PICKUP_FEE_PAISA = SMALL_ORDER_FEE_PAISA - SMALL_ORDER_RIDER_PAISA;

/** The share of the base fare a bundled order is rebuilt on, `10 §11`. */
export const BUNDLE_BASE_BPS = 5_500;

/** The flat bonus a bundled order carries, `10 §11`. */
export const BUNDLE_BONUS_PAISA = 1_200;

/** The multiplier every zone starts at, and the floor of the published range (`10 §4`). */
export const SURGE_NONE_BPS = 10_000;

/** The highest multiplier a zone may publish, `10 §4`: 2.2×. */
export const SURGE_CEILING_BPS = 22_000;

/** Everything a fallback price depends on. No clock, no I/O, no configuration read. */
export interface FareInput {
  readonly rates: VehicleRates;
  readonly fulfilment: "DELIVERY" | "PICKUP";
  /**
   * The multiplier published for the zone when the order was priced, in basis points.
   *
   * Supplied, never derived: the curve that turns rider counts into a multiplier is the Brain's,
   * and it is the one float in pricing. A second float implementation in Core would be a second
   * answer to "what does this trip cost", which is the thing `10 §4.4` exists to prevent.
   */
  readonly surgeBps: number;
  readonly routedDistanceM: number;
  readonly trafficDelayS: number;
  readonly weather: WeatherCondition;
  /** How far the weather feed trusts its own reading, in basis points (0..10 000). */
  readonly weatherConfidenceBps: number;
  readonly itemSubtotalPaisa: number;
  readonly tipPaisa: number;
  readonly batchPosition?: number | undefined;
  readonly batchMarginalDistanceM?: number | undefined;
  readonly commissionBps?: number | undefined;
  readonly riderBonusBps?: number | undefined;
}

/** An input the engine refuses, with the field named so the caller can fix it. */
export class FareInputError extends Error {
  readonly code = "MONEY_FARE_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "FareInputError";
  }
}

/** The arithmetic does not close. Raised before a price is returned, never after. */
export class ClosureViolation extends Error {
  readonly code = "MONEY_INVOICE_UNBALANCED";

  constructor(message: string) {
    super(message);
    this.name = "ClosureViolation";
  }
}

/** The three components of the ride core, kept separate so an explanation can name them. */
export interface RideCore {
  readonly surgedBasePaisa: number;
  readonly distancePaisa: number;
  readonly trafficPaisa: number;
  readonly totalPaisa: number;
}

/** Every number a fallback price contains, in the same shape the Brain's breakdown has. */
export interface FareBreakdown {
  readonly core: RideCore;
  readonly surgeBps: number;
  readonly deliveryFeePaisa: number;
  readonly deliveryMarginPaisa: number;
  readonly smallOrderTotalPaisa: number;
  readonly smallOrderRiderPaisa: number;
  readonly smallOrderVendorPaisa: number;
  readonly smallOrderPlatformPaisa: number;
  readonly commissionPaisa: number;
  readonly riderBonusPaisa: number;
  readonly taxableBasePaisa: number;
  readonly taxPaisa: number;
  readonly weatherPaisa: number;
  readonly bundlePaisa: number;
  readonly tipPaisa: number;
  readonly customerTotalPaisa: number;
  readonly roundingDeltaPaisa: number;
  readonly vendorPayoutPaisa: number;
  readonly riderPayoutPaisa: number;
  readonly platformCommissionPaisa: number;
  readonly platformSmallOrderPaisa: number;
  readonly platformDeliveryNetPaisa: number;
  readonly platformWeatherExpensePaisa: number;
  readonly platformTaxPayablePaisa: number;
  readonly platformRoundingExpensePaisa: number;
}

/** What the trip itself is worth: the surged base, the distance beyond it, and whole traffic blocks. */
export function rideCore(routedDistanceM: number, trafficDelayS: number, surge: number, rates: VehicleRates): RideCore {
  if (routedDistanceM < 0) throw new FareInputError(`negative distance ${routedDistanceM}`);
  if (trafficDelayS < 0) throw new FareInputError(`negative traffic delay ${trafficDelayS}`);

  const surgedBase = applyRate(rates.baseFarePaisa, surge);
  const billableM = Math.max(0, routedDistanceM - rates.baseDistanceM);
  const distance = Math.trunc((billableM * rates.perKmPaisa) / 1000);
  const traffic = Math.trunc(trafficDelayS / TRAFFIC_BLOCK_S) * rates.trafficBlockPaisa;

  return { surgedBasePaisa: surgedBase, distancePaisa: distance, trafficPaisa: traffic, totalPaisa: surgedBase + distance + traffic };
}

/** The delivery fee: the core plus 8%, clamped. A pickup pays nothing. */
export function deliveryFeePaisa(core: RideCore, fulfilment: "DELIVERY" | "PICKUP", rates: VehicleRates): number {
  if (fulfilment === "PICKUP") return 0;
  const margin = applyRate(core.totalPaisa, DELIVERY_MARGIN_BPS);
  const fee = core.totalPaisa + margin;
  return Math.max(rates.minDeliveryFeePaisa, Math.min(rates.maxDeliveryFeePaisa, fee));
}

/** The order fee and its split, evaluated on the post-discount subtotal. */
export function smallOrderFee(
  itemSubtotalPaisa: number,
  fulfilment: "DELIVERY" | "PICKUP",
): { totalPaisa: number; riderPaisa: number; vendorPaisa: number; platformPaisa: number } {
  if (itemSubtotalPaisa < SMALL_ORDER_THRESHOLD_PAISA) return { totalPaisa: 0, riderPaisa: 0, vendorPaisa: 0, platformPaisa: 0 };
  if (fulfilment === "DELIVERY")
    return {
      totalPaisa: SMALL_ORDER_FEE_PAISA,
      riderPaisa: SMALL_ORDER_RIDER_PAISA,
      vendorPaisa: SMALL_ORDER_VENDOR_PAISA,
      platformPaisa: SMALL_ORDER_PAYOUT_PAISA,
    };
  return {
    totalPaisa: SMALL_ORDER_PICKUP_FEE_PAISA,
    riderPaisa: 0,
    vendorPaisa: SMALL_ORDER_VENDOR_PAISA,
    platformPaisa: SMALL_ORDER_PICKUP_FEE_PAISA - SMALL_ORDER_VENDOR_PAISA,
  };
}

/** Refuse an input that would produce an arithmetic answer to a nonsense question. */
function validate(input: FareInput): void {
  if (input.fulfilment !== "DELIVERY" && input.fulfilment !== "PICKUP")
    throw new FareInputError(`fulfilment must be DELIVERY or PICKUP, got ${String(input.fulfilment)}`);
  if (input.routedDistanceM < 0) throw new FareInputError(`routed distance cannot be negative: ${input.routedDistanceM}`);
  if (input.routedDistanceM > input.rates.maxRadiusM * 2)
    throw new FareInputError(`routed distance ${input.routedDistanceM} m exceeds twice the vehicle radius`);
  if (input.trafficDelayS < 0) throw new FareInputError(`traffic delay cannot be negative: ${input.trafficDelayS}`);
  if (!Number.isInteger(input.surgeBps) || input.surgeBps < SURGE_NONE_BPS || input.surgeBps > SURGE_CEILING_BPS)
    throw new FareInputError(`surge ${input.surgeBps} bps is not a published multiplier in ${SURGE_NONE_BPS}..${SURGE_CEILING_BPS}`);
  if (input.weather in WEATHER_PREMIUM_BPS === false) throw new FareInputError(`unknown weather condition ${String(input.weather)}`);
  if (!Number.isInteger(input.weatherConfidenceBps) || input.weatherConfidenceBps < 0 || input.weatherConfidenceBps > 10_000)
    throw new FareInputError(`weather confidence must be 0..10000 bps, got ${input.weatherConfidenceBps}`);
  if (input.itemSubtotalPaisa < 0) throw new FareInputError(`item subtotal cannot be negative: ${input.itemSubtotalPaisa}`);
  if (input.tipPaisa < 0) throw new FareInputError(`tip cannot be negative: ${input.tipPaisa}`);
  const commission = input.commissionBps ?? COMMISSION_BPS;
  const bonus = input.riderBonusBps ?? RIDER_BONUS_BPS;
  if (commission < 0 || commission > 5_000) throw new FareInputError(`commission ${commission} bps is outside 0..5000`);
  if (bonus < 0 || bonus > 5_000) throw new FareInputError(`rider bonus ${bonus} bps is outside 0..5000`);
  if ((input.batchPosition ?? 0) < 0) throw new FareInputError(`batch position cannot be negative: ${String(input.batchPosition)}`);
  if ((input.batchPosition ?? 0) > 0 && (input.batchMarginalDistanceM ?? 0) <= 0)
    throw new FareInputError("a bundled order after the first must carry its marginal detour");
  if (input.fulfilment === "PICKUP" && (input.batchPosition ?? 0) > 0) throw new FareInputError("a pickup cannot be part of a bundle");
}

/** The premium the platform pays for this weather, or zero when the reading is untrusted. */
function weatherPremiumBps(input: FareInput): number {
  if (input.weatherConfidenceBps < WEATHER_CONFIDENCE_FLOOR_BPS) return 0;
  return WEATHER_PREMIUM_BPS[input.weather];
}

/** The delta a bundled order's fare carries: a reduced base, a marginal detour, and a flat bonus. */
function bundleAdjustment(core: RideCore, rates: VehicleRates, batchPosition: number, marginalDistanceM: number): number {
  if (batchPosition === 0) return 0;
  const reducedBase = applyRate(rates.baseFarePaisa, BUNDLE_BASE_BPS);
  const marginalM = Math.max(0, marginalDistanceM - rates.baseDistanceM);
  const marginalDistance = Math.trunc((marginalM * rates.perKmPaisa) / 1000);
  return reducedBase + marginalDistance + BUNDLE_BONUS_PAISA - core.totalPaisa;
}

/**
 * Price one order, deterministically, and prove the arithmetic closes before returning.
 *
 * The identity is the same one `fare/assemble.py` asserts, with the delivery line as a residual
 * (`fee − rider fare`) rather than as `margin − weather`, because a bundle and the minimum-payout
 * floor both move the rider's fare off the core (D58).
 */
export function priceOrder(input: FareInput): FareBreakdown {
  validate(input);

  const surge = input.surgeBps;
  const core = rideCore(input.routedDistanceM, input.trafficDelayS, surge, input.rates);

  const fee = deliveryFeePaisa(core, input.fulfilment, input.rates);
  const margin = fee - core.totalPaisa;
  const orderFee = smallOrderFee(input.itemSubtotalPaisa, input.fulfilment);

  const commission = applyRate(input.itemSubtotalPaisa, input.commissionBps ?? COMMISSION_BPS);
  const bonus = applyRate(input.itemSubtotalPaisa, input.riderBonusBps ?? RIDER_BONUS_BPS);

  const taxableBase = commission + orderFee.platformPaisa + margin;
  const tax = applyRate(taxableBase, TAX_BPS);

  const weather = applyRate(core.totalPaisa, weatherPremiumBps(input));
  const bundle = bundleAdjustment(core, input.rates, input.batchPosition ?? 0, input.batchMarginalDistanceM ?? 0);

  // The floor applies to the fare, never to the total: a tip is the customer's gift and must not be
  // the thing that lifts a fare above the guarantee.
  const riderFare = Math.max(input.rates.minPayoutPaisa, core.totalPaisa + weather + bundle);
  const riderPayout = riderFare + bonus + orderFee.riderPaisa + input.tipPaisa;

  const preRound = input.itemSubtotalPaisa + fee + orderFee.totalPaisa + tax + input.tipPaisa;
  const floored = floorToTaka(preRound);
  const customerTotal = floored.total as number;
  const roundingDelta = floored.delta as number;

  const vendorPayout = input.itemSubtotalPaisa - commission - bonus + orderFee.vendorPaisa;
  // `-0` is not `0`: it survives into JSON as `-0` and fails an exact comparison, so the negation is
  // guarded rather than trusted. (The money law's `floorToTaka` already refuses to emit `-0`.)
  const roundingExpense = roundingDelta === 0 ? 0 : -roundingDelta;
  const deliveryNet = fee - riderFare;

  const components = vendorPayout + riderPayout + commission + orderFee.platformPaisa + deliveryNet + tax - roundingExpense;
  if (customerTotal !== components)
    throw new ClosureViolation(
      `fare does not close: customer=${customerTotal} components=${components} drift=${customerTotal - components} ` +
        `(vendor=${vendorPayout} rider=${riderPayout} commission=${commission} small=${orderFee.platformPaisa} ` +
        `delivery_net=${deliveryNet} margin=${margin} weather=${weather} tax=${tax} rounding=${roundingExpense}, surge=${surge} bps)`,
    );
  if (riderPayout < 0 || vendorPayout < 0) throw new ClosureViolation("a counterparty cannot be owed a negative amount");

  return {
    core,
    surgeBps: surge,
    deliveryFeePaisa: fee,
    deliveryMarginPaisa: margin,
    smallOrderTotalPaisa: orderFee.totalPaisa,
    smallOrderRiderPaisa: orderFee.riderPaisa,
    smallOrderVendorPaisa: orderFee.vendorPaisa,
    smallOrderPlatformPaisa: orderFee.platformPaisa,
    commissionPaisa: commission,
    riderBonusPaisa: bonus,
    taxableBasePaisa: taxableBase,
    taxPaisa: tax,
    weatherPaisa: weather,
    bundlePaisa: bundle,
    tipPaisa: input.tipPaisa,
    customerTotalPaisa: customerTotal,
    roundingDeltaPaisa: roundingDelta,
    vendorPayoutPaisa: vendorPayout,
    riderPayoutPaisa: riderPayout,
    platformCommissionPaisa: commission,
    platformSmallOrderPaisa: orderFee.platformPaisa,
    platformDeliveryNetPaisa: deliveryNet,
    platformWeatherExpensePaisa: weather,
    platformTaxPayablePaisa: tax,
    platformRoundingExpensePaisa: roundingExpense,
  };
}
