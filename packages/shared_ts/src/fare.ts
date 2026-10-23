/**
 * @file packages/shared_ts/src/fare.ts
 * @description Canonical UNDAL Dynamic Rider Fare, Surge, Weather, Traffic & Batching Engine
 * (`Master Guide File 11` & `Appendix F` Golden Vectors `F-1..F-6`).
 *
 * Computed in exact arbitrary-precision `BigInt` rational arithmetic so SQL, Cloudflare Workers (TS),
 * and Flutter (`package:undal_core`) agree to `0` poisha across every input combination.
 */

import { factorToPpm, kmToMetersInt, roundHalfUpDiv, toSafePoishaBigInt } from './rational.ts';

/** Rider vehicle tracks in v1 (`File 11 §11.1`, `File 21 §21.3`). */
export type RiderVehicleType = 'motorbike' | 'bicycle';

/** Weather states recognised by the dynamic fare engine (`File 11 §11.1`). */
export type WeatherCondition = 'clear' | 'rain' | 'storm' | 'extreme_heat';

/** Zone/platform configurable rider fare policy (`Appendix M` group `fare.*` + `dispatch.*`). */
export interface FarePolicyConfig {
  readonly baseMotorbikePoisha: number;
  readonly baseBicyclePoisha: number;
  readonly perKmMotorbikePoisha: number;
  readonly perKmBicyclePoisha: number;
  readonly includedKm: number;
  readonly deadheadFactor: number;
  readonly floorMotorbikePoisha: number;
  readonly floorBicyclePoisha: number;
  readonly surgeMidLow: number;
  readonly surgeMidHigh: number;
  readonly surgeSevereLow: number;
  readonly surgeSevereCap: number;
  readonly weatherRainPct: number;
  readonly weatherStormPct: number;
  readonly weatherHeatPct: number;
  readonly trafficBlockMinutes: number;
  readonly trafficBlockPoisha: number;
  readonly batchFactor2: number;
  readonly batchFactor3: number;
  readonly priorityUpliftPoisha: number;
  readonly waitCompPerMinPoisha: number;
  readonly waitGraceMinutes: number;
  readonly maxLoadedKmBicycle: number;
  readonly maxLoadedKmMotorbike: number;
}

/** Canonical defaults matching `Appendix M` & `Appendix F` 100%. */
export const DEFAULT_FARE_POLICY: FarePolicyConfig = {
  baseMotorbikePoisha: 3000,
  baseBicyclePoisha: 2500,
  perKmMotorbikePoisha: 1400,
  perKmBicyclePoisha: 800,
  includedKm: 2.0,
  deadheadFactor: 0.5,
  floorMotorbikePoisha: 4000,
  floorBicyclePoisha: 3000,
  surgeMidLow: 1.2,
  surgeMidHigh: 1.4,
  surgeSevereLow: 1.5,
  surgeSevereCap: 2.2,
  weatherRainPct: 20,
  weatherStormPct: 40,
  weatherHeatPct: 10,
  trafficBlockMinutes: 5,
  trafficBlockPoisha: 400,
  batchFactor2: 0.6,
  batchFactor3: 0.5,
  priorityUpliftPoisha: 1000,
  waitCompPerMinPoisha: 200,
  waitGraceMinutes: 10,
  maxLoadedKmBicycle: 4.0,
  maxLoadedKmMotorbike: 12.0,
} as const;

/** Input contract matching `File 11 §11.1` `FareInputs` verbatim. */
export interface FareInputs {
  readonly baseFarePoisha?: number;
  readonly perKmRatePoisha?: number;
  readonly includedKm?: number;
  readonly minimumFareFloorPoisha?: number;
  readonly travelDistanceKm: number;
  readonly toVendorKm: number;
  readonly trafficDelayMinutes: number;
  readonly activeOrdersInZone: number;
  readonly activeRidersInZone: number;
  readonly weatherCondition: WeatherCondition;
  readonly vehicleType: RiderVehicleType;
  readonly batchPosition: number;
  readonly orderFoodPayablePoisha: number;
  readonly isPriority: boolean;
}

/** Output contract returned to dispatch, Admin Fare Simulator (`C53`), and `"Why this fare?"` UI (`r-09`). */
export interface CalculatedRiderFare {
  readonly riderFarePoisha: number;
  readonly foodBonusPoisha: number;
  readonly baseAppliedPoisha: number;
  readonly loadedKm: number;
  readonly billableKm: number;
  readonly distancePayPoisha: number;
  readonly sdr: number;
  readonly surgeMultiplier: number;
  readonly weatherPct: number;
  readonly trafficBlocks: number;
  readonly trafficPayPoisha: number;
  readonly priorityUpliftPoisha: number;
  readonly floorApplied: boolean;
  readonly withinVehicleRadius: boolean;
}

/**
 * Computes exact rider payout fare in integer poisha using pure `BigInt` rational math (`File 11 §11.2`).
 */
export function calculateRiderFare(
  input: FareInputs,
  policy: FarePolicyConfig = DEFAULT_FARE_POLICY,
): CalculatedRiderFare {
  const isBike = input.vehicleType === 'motorbike';
  const basePoisha = toSafePoishaBigInt(
    input.baseFarePoisha ?? (isBike ? policy.baseMotorbikePoisha : policy.baseBicyclePoisha),
    'baseFarePoisha',
  );
  const perKmPoisha = toSafePoishaBigInt(
    input.perKmRatePoisha ?? (isBike ? policy.perKmMotorbikePoisha : policy.perKmBicyclePoisha),
    'perKmRatePoisha',
  );
  const floorPoisha = toSafePoishaBigInt(
    input.minimumFareFloorPoisha ??
      (isBike ? policy.floorMotorbikePoisha : policy.floorBicyclePoisha),
    'minimumFareFloorPoisha',
  );

  // Distances in integer meters (1 km = 1000 m), billable stored in 0.5-meter half-units (* 2) so 0.5x deadhead is exact
  const travelM = kmToMetersInt(input.travelDistanceKm, 'travelDistanceKm');
  const toVendorM = kmToMetersInt(input.toVendorKm, 'toVendorKm');
  const includedM = kmToMetersInt(input.includedKm ?? policy.includedKm, 'includedKm');
  const deadheadPpm = factorToPpm(policy.deadheadFactor, 'deadheadFactor');

  const loadedM = travelM > toVendorM ? travelM - toVendorM : 0n;
  const excessLoadedM = loadedM > includedM ? loadedM - includedM : 0n;
  // billableNanoKm in 10^-9 km (= excessLoadedM * 1_000_000 + toVendorM * deadheadPpm)
  const billableNanoKm = excessLoadedM * 1_000_000n + toVendorM * deadheadPpm;

  // Batch base factor: pos 1 -> 1.0, pos 2 -> 0.60, pos >= 3 -> 0.50 (File 11 §11.2 & Appendix F F-4)
  const batchBasePpm =
    input.batchPosition <= 1
      ? 1_000_000n
      : input.batchPosition === 2
        ? factorToPpm(policy.batchFactor2, 'batchFactor2')
        : factorToPpm(policy.batchFactor3, 'batchFactor3');

  const effectiveBaseNanoPoisha = basePoisha * batchBasePpm * 1_000n; // scaled by 10^9
  const distanceNanoPoisha = perKmPoisha * billableNanoKm;            // scaled by 10^9
  const subtotalNanoPoisha = effectiveBaseNanoPoisha + distanceNanoPoisha;

  // Exact rational SDR = activeRiders / max(1, activeOrders)
  const riders = BigInt(Math.max(0, Math.trunc(input.activeRidersInZone)));
  const ordersDen = BigInt(Math.max(1, Math.trunc(input.activeOrdersInZone)));

  // Compute exact rational surgeNum / surgeDen without early rounding!
  // Band 1: riders >= ordersDen -> 1 / 1
  // Band 2: 0.5 <= riders/ordersDen < 1.0 -> midLow + ((1 - R/O) / 0.5) * (midHigh - midLow)
  //         = midLow + 2 * (O - R) / O * (midHigh - midLow)
  // Band 3: riders/ordersDen < 0.5 -> severeLow + ((0.5 - R/O) / 0.5) * (severeCap - severeLow)
  //         = severeLow + (O - 2R) / O * (severeCap - severeLow)
  let surgeNum: bigint;
  const surgeDen = ordersDen * 1_000_000n;
  if (riders >= ordersDen) {
    surgeNum = surgeDen;
  } else if (riders * 2n >= ordersDen) {
    const lowPpm = factorToPpm(policy.surgeMidLow, 'surgeMidLow');
    const spanPpm = factorToPpm(policy.surgeMidHigh - policy.surgeMidLow, 'surgeMidSpan');
    surgeNum = lowPpm * ordersDen + 2n * (ordersDen - riders) * spanPpm;
  } else {
    const lowPpm = factorToPpm(policy.surgeSevereLow, 'surgeSevereLow');
    const spanPpm = factorToPpm(policy.surgeSevereCap - policy.surgeSevereLow, 'surgeSevereSpan');
    surgeNum = lowPpm * ordersDen + (ordersDen - 2n * riders) * spanPpm;
  }

  const weatherPct =
    input.weatherCondition === 'rain'
      ? policy.weatherRainPct
      : input.weatherCondition === 'storm'
        ? policy.weatherStormPct
        : input.weatherCondition === 'extreme_heat'
          ? policy.weatherHeatPct
          : 0;
  const weatherBps = BigInt(Math.round((100 + weatherPct) * 100)); // e.g. 120% -> 12000 / 10000

  const delayMin = Math.max(0, Math.floor(input.trafficDelayMinutes));
  const trafficBlocks = BigInt(Math.floor(delayMin / policy.trafficBlockMinutes));
  const trafficPay = trafficBlocks * toSafePoishaBigInt(policy.trafficBlockPoisha, 'trafficBlockPoisha');
  const priorityPay = input.isPriority
    ? toSafePoishaBigInt(policy.priorityUpliftPoisha, 'priorityUpliftPoisha')
    : 0n;

  // Exact single-step rational product:
  // surgedWeatherPoisha = (subtotalNanoPoisha / 10^9) * (surgeNum / surgeDen) * (weatherBps / 10_000)
  const totalNum =
    subtotalNanoPoisha * surgeNum * weatherBps +
    (trafficPay + priorityPay) * 1_000_000_000n * surgeDen * 10_000n;
  const totalDen = 1_000_000_000n * surgeDen * 10_000n;

  const roundedPoisha = roundHalfUpDiv(totalNum, totalDen);
  const finalPoisha = roundedPoisha < floorPoisha ? floorPoisha : roundedPoisha;

  const foodPayable = toSafePoishaBigInt(input.orderFoodPayablePoisha, 'orderFoodPayablePoisha');
  const foodBonus = roundHalfUpDiv(foodPayable * 3n, 100n);
  const maxRadiusKm = isBike ? policy.maxLoadedKmMotorbike : policy.maxLoadedKmBicycle;
  const loadedKmNum = Number(loadedM) / 1000;

  return {
    riderFarePoisha: Number(finalPoisha),
    foodBonusPoisha: Number(foodBonus),
    baseAppliedPoisha: Number(roundHalfUpDiv(effectiveBaseNanoPoisha, 1_000_000_000n)),
    loadedKm: loadedKmNum,
    billableKm: Number(billableNanoKm) / 1_000_000_000,
    distancePayPoisha: Number(roundHalfUpDiv(distanceNanoPoisha, 1_000_000_000n)),
    sdr: Number(riders) / Number(ordersDen),
    surgeMultiplier: Number(surgeNum) / Number(surgeDen),
    weatherPct,
    trafficBlocks: Number(trafficBlocks),
    trafficPayPoisha: Number(trafficPay),
    priorityUpliftPoisha: Number(priorityPay),
    floorApplied: roundedPoisha < floorPoisha,
    withinVehicleRadius: loadedKmNum <= maxRadiusKm,
  };
}

/**
 * Computes automatic rider wait compensation at kitchen (`File 11 §11.3`: `৳2/min` beyond `10m` grace).
 */
export function computeVendorWaitCompPoisha(
  excessWaitMinutes: number,
  policy: FarePolicyConfig = DEFAULT_FARE_POLICY,
): number {
  const billableMins = Math.max(0, Math.floor(excessWaitMinutes - policy.waitGraceMinutes));
  return billableMins * policy.waitCompPerMinPoisha;
}

/** Canonical 6 Golden Fare Vectors from `Appendix F` verified across TS + Dart + SQL (`F-1..F-6`). */
export const GOLDEN_FARE_VECTORS = [
  {
    id: 'F-1',
    input: {
      vehicleType: 'motorbike' as const,
      travelDistanceKm: 5.0,
      toVendorKm: 1.2,
      trafficDelayMinutes: 12,
      activeRidersInZone: 3,
      activeOrdersInZone: 8,
      weatherCondition: 'rain' as const,
      batchPosition: 1,
      orderFoodPayablePoisha: 43280,
      isPriority: false,
    },
    expectedPoisha: 13584,
  },
  {
    id: 'F-2',
    input: {
      vehicleType: 'bicycle' as const,
      travelDistanceKm: 2.3,
      toVendorKm: 0.6,
      trafficDelayMinutes: 0,
      activeRidersInZone: 5,
      activeOrdersInZone: 3,
      weatherCondition: 'clear' as const,
      batchPosition: 1,
      orderFoodPayablePoisha: 22500,
      isPriority: false,
    },
    expectedPoisha: 3000,
  },
  {
    id: 'F-3',
    input: {
      vehicleType: 'motorbike' as const,
      travelDistanceKm: 8.5,
      toVendorKm: 2.0,
      trafficDelayMinutes: 16,
      activeRidersInZone: 1,
      activeOrdersInZone: 6,
      weatherCondition: 'storm' as const,
      batchPosition: 1,
      orderFoodPayablePoisha: 216400,
      isPriority: false,
    },
    expectedPoisha: 30661,
  },
  {
    id: 'F-4',
    input: {
      vehicleType: 'motorbike' as const,
      travelDistanceKm: 5.0,
      toVendorKm: 1.2,
      trafficDelayMinutes: 12,
      activeRidersInZone: 3,
      activeOrdersInZone: 8,
      weatherCondition: 'rain' as const,
      batchPosition: 2,
      orderFoodPayablePoisha: 30000,
      isPriority: false,
    },
    expectedPoisha: 11172,
  },
  {
    id: 'F-5',
    input: {
      vehicleType: 'bicycle' as const,
      travelDistanceKm: 4.1,
      toVendorKm: 0.8,
      trafficDelayMinutes: 7,
      activeRidersInZone: 2,
      activeOrdersInZone: 3,
      weatherCondition: 'extreme_heat' as const,
      batchPosition: 1,
      orderFoodPayablePoisha: 30000,
      isPriority: false,
    },
    expectedPoisha: 6061,
  },
  {
    id: 'F-6',
    input: {
      vehicleType: 'motorbike' as const,
      travelDistanceKm: 12.5,
      toVendorKm: 2.0,
      trafficDelayMinutes: 3,
      activeRidersInZone: 6,
      activeOrdersInZone: 4,
      weatherCondition: 'clear' as const,
      batchPosition: 1,
      orderFoodPayablePoisha: 54100,
      isPriority: false,
    },
    expectedPoisha: 16300,
  },
] as const;
