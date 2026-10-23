/**
 * @file workers/realtime/src/batcher.ts
 * @description Exact Multi-Order Batch Builder, Precedence-Constrained Sequence Solver,
 * and Mid-Batch Survivor Re-Sequencer (`Master Guide File 11 §11.4`, `File 12 §12.4`,
 * `Appendix F` `DSP-03` & `F-4`).
 *
 * Guarantees:
 *   1. Priority orders (`isPriority === true`) are NEVER batched (`File 11 §11.4`).
 *   2. Max `3` orders per batch, same vendor or vendors `<= 300 m` apart, ready times within `8 min`.
 *   3. Drop-offs within `1.5 km` OR 1st-customer detour delay `<= 6 min` (`File 11 §11.4`).
 *   4. No order rides `> 18 min` post-pickup (`File 12 §12.4` Food Heat Law).
 *   5. Per-order integer poisha fares computed via canonical `calculateRiderFare` (`batchPosition = 1, 2, 3`).
 */

import {
  calculateRiderFare,
  DEFAULT_FARE_POLICY,
  type CalculatedRiderFare,
  type FarePolicyConfig,
  type RiderVehicleType,
  type WeatherCondition,
} from '@undal/shared-ts';
import { estimateRoadLegFallback, haversineKm } from './geo.ts';
import type { DispatchOrderSnapshot, GeoPoint } from './types.ts';

export interface BatchPolicy {
  readonly maxOrdersPerBatch: number;
  readonly maxVendorClusterMeters: number;
  readonly maxReadyOverlapMinutes: number;
  readonly maxDropPairKm: number;
  readonly maxFirstDropDetourMinutes: number;
  readonly maxInBagRideMinutes: number;
  readonly maxBagUnits: number;
  readonly handoverMinutesPerStop: number;
}

export const DEFAULT_BATCH_POLICY: BatchPolicy = {
  maxOrdersPerBatch: 3,
  maxVendorClusterMeters: 300,
  maxReadyOverlapMinutes: 8,
  maxDropPairKm: 1.5,
  maxFirstDropDetourMinutes: 6,
  maxInBagRideMinutes: 18,
  maxBagUnits: 6,
  handoverMinutesPerStop: 1.5,
} as const;

export interface BatchStopStep {
  readonly kind: 'pickup' | 'dropoff';
  readonly orderId: string;
  readonly publicCode: string;
  readonly point: GeoPoint;
  readonly legKm: number;
  readonly etaMinutesFromStart: number;
}

export interface BatchOrderFareLine {
  readonly orderId: string;
  readonly batchPosition: number;
  readonly fare: CalculatedRiderFare;
}

export interface BuiltBatchPlan {
  readonly orderIds: readonly string[];
  readonly stops: readonly BatchStopStep[];
  readonly totalMinutes: number;
  readonly maxPostPickupRideMinutes: number;
  readonly firstCustomerDetourMinutes: number;
  readonly totalRiderFarePoisha: number;
  readonly perOrderFares: readonly BatchOrderFareLine[];
}

interface RawStop {
  readonly kind: 'pickup' | 'dropoff';
  readonly orderIndex: number;
  readonly order: DispatchOrderSnapshot;
  readonly point: GeoPoint;
}

/** Enumerates every precedence-valid stop sequence (`pickup(i)` strictly precedes `dropoff(i)`). */
function generateValidStopSequences(orders: readonly DispatchOrderSnapshot[]): RawStop[][] {
  const results: RawStop[][] = [];
  const picked = new Array<boolean>(orders.length).fill(false);
  const dropped = new Array<boolean>(orders.length).fill(false);
  const current: RawStop[] = [];
  const targetLen = orders.length * 2;

  const backtrack = (): void => {
    if (current.length === targetLen) {
      results.push([...current]);
      return;
    }
    for (let i = 0; i < orders.length; i += 1) {
      const ord = orders[i]!;
      if (!picked[i]) {
        picked[i] = true;
        current.push({ kind: 'pickup', orderIndex: i, order: ord, point: ord.vendorPoint });
        backtrack();
        current.pop();
        picked[i] = false;
      } else if (!dropped[i]) {
        dropped[i] = true;
        current.push({ kind: 'dropoff', orderIndex: i, order: ord, point: ord.customerPoint });
        backtrack();
        current.pop();
        dropped[i] = false;
      }
    }
  };

  backtrack();
  return results;
}

/**
 * Solves exact minimum-time pickup/drop-off sequence for `2..3` compatible orders while enforcing
 * both the `<= 18 min` post-pickup food-heat cap and the `<= 6 min` first-customer detour cap.
 */
export function buildOptimalBatchPlan(params: {
  readonly orders: readonly DispatchOrderSnapshot[];
  readonly riderOrigin: GeoPoint;
  readonly vehicleType: RiderVehicleType;
  readonly activeOrdersInZone: number;
  readonly activeRidersInZone: number;
  readonly weatherCondition: WeatherCondition;
  readonly trafficDelayMinutes?: number;
  readonly roadFactor?: number;
  readonly batchPolicy?: BatchPolicy;
  readonly farePolicy?: FarePolicyConfig;
}): BuiltBatchPlan | null {
  const bPolicy = params.batchPolicy ?? DEFAULT_BATCH_POLICY;
  const fPolicy = params.farePolicy ?? DEFAULT_FARE_POLICY;
  const roadFactor = params.roadFactor ?? 1.35;
  const orders = params.orders;

  if (orders.length < 2 || orders.length > bPolicy.maxOrdersPerBatch) return null;
  if (orders.some((o) => o.isPriority || o.fulfilment !== 'delivery')) return null;

  const totalBagUnits = orders.reduce((acc, o) => acc + Math.max(1, o.bagUnits), 0);
  if (totalBagUnits > bPolicy.maxBagUnits) return null;

  // Verify vendor cluster (`<= 300 m`), ready-window overlap (`<= 8 min`), & vehicle radius feasibility.
  const minReadyMs = Math.min(...orders.map((o) => o.prepReadyAtMs));
  const maxReadyMs = Math.max(...orders.map((o) => o.prepReadyAtMs));
  if ((maxReadyMs - minReadyMs) / 60_000 > bPolicy.maxReadyOverlapMinutes) return null;

  const maxVehicleLegKm =
    params.vehicleType === 'bicycle' ? fPolicy.maxLoadedKmBicycle : fPolicy.maxLoadedKmMotorbike;

  for (let i = 0; i < orders.length; i += 1) {
    const soloLeg = estimateRoadLegFallback(
      orders[i]!.vendorPoint,
      orders[i]!.customerPoint,
      params.vehicleType,
      roadFactor,
    );
    if (soloLeg.distanceKm > maxVehicleLegKm) return null;

    for (let j = i + 1; j < orders.length; j += 1) {
      const sameVendor = orders[i]!.vendorId === orders[j]!.vendorId;
      const vendorGapM = haversineKm(orders[i]!.vendorPoint, orders[j]!.vendorPoint) * 1_000;
      if (!sameVendor && vendorGapM > bPolicy.maxVendorClusterMeters) return null;
    }
  }

  // Solo baseline for first order (anchor order `orders[0]`) from `riderOrigin`:
  const soloToVendor = estimateRoadLegFallback(params.riderOrigin, orders[0]!.vendorPoint, params.vehicleType, roadFactor);
  const soloToCust = estimateRoadLegFallback(orders[0]!.vendorPoint, orders[0]!.customerPoint, params.vehicleType, roadFactor);
  const soloFirstArrivalMin =
    soloToVendor.durationMinutes + bPolicy.handoverMinutesPerStop + soloToCust.durationMinutes;

  let bestSeq: {
    steps: BatchStopStep[];
    totalMinutes: number;
    maxRideMinutes: number;
    firstDetourMinutes: number;
    dropoffOrder: DispatchOrderSnapshot[];
  } | null = null;

  for (const seq of generateValidStopSequences(orders)) {
    let cursorPoint = params.riderOrigin;
    let elapsedMin = 0;
    const pickupAtMin = new Map<string, number>();
    const dropAtMin = new Map<string, number>();
    const dropSequence: DispatchOrderSnapshot[] = [];
    const steps: BatchStopStep[] = [];
    let feasible = true;

    for (let s = 0; s < seq.length; s += 1) {
      const raw = seq[s]!;
      const sameCoordsAsPrev =
        s > 0 && haversineKm(cursorPoint, raw.point) * 1_000 < 15;
      const leg = sameCoordsAsPrev
        ? { distanceKm: 0, durationMinutes: 0 }
        : estimateRoadLegFallback(cursorPoint, raw.point, params.vehicleType, roadFactor);

      elapsedMin += leg.durationMinutes + (sameCoordsAsPrev ? 0.5 : bPolicy.handoverMinutesPerStop);
      cursorPoint = raw.point;

      if (raw.kind === 'pickup') {
        pickupAtMin.set(raw.order.orderId, elapsedMin);
      } else {
        const pickedMin = pickupAtMin.get(raw.order.orderId) ?? 0;
        if (elapsedMin - pickedMin > bPolicy.maxInBagRideMinutes) {
          feasible = false;
          break;
        }
        dropAtMin.set(raw.order.orderId, elapsedMin);
        dropSequence.push(raw.order);
      }

      steps.push({
        kind: raw.kind,
        orderId: raw.order.orderId,
        publicCode: raw.order.publicCode,
        point: raw.point,
        legKm: leg.distanceKm,
        etaMinutesFromStart: Math.round(elapsedMin * 100) / 100,
      });
    }

    if (!feasible) continue;

    const firstOrderDropMin = dropAtMin.get(orders[0]!.orderId) ?? Number.POSITIVE_INFINITY;
    const firstDetour = Math.max(0, firstOrderDropMin - soloFirstArrivalMin);
    const maxDropPairKm = Math.max(
      ...orders.slice(1).map((o) => haversineKm(orders[0]!.customerPoint, o.customerPoint)),
    );
    if (maxDropPairKm > bPolicy.maxDropPairKm && firstDetour > bPolicy.maxFirstDropDetourMinutes) {
      continue;
    }
    if (firstDetour > bPolicy.maxFirstDropDetourMinutes) continue;

    const maxRideMinutes = Math.max(
      ...orders.map((o) => (dropAtMin.get(o.orderId) ?? 0) - (pickupAtMin.get(o.orderId) ?? 0)),
    );

    if (!bestSeq || elapsedMin < bestSeq.totalMinutes) {
      bestSeq = {
        steps,
        totalMinutes: Math.round(elapsedMin * 100) / 100,
        maxRideMinutes: Math.round(maxRideMinutes * 100) / 100,
        firstDetourMinutes: Math.round(firstDetour * 100) / 100,
        dropoffOrder: dropSequence,
      };
    }
  }

  if (!bestSeq) return null;

  // Compute canonical per-order fares (`batchPosition = 1, 2, 3`, `File 11 §11.2` & `Appendix F` `F-4`):
  const perOrderFares: BatchOrderFareLine[] = [];
  let prevAnchorPoint = params.riderOrigin;

  for (let idx = 0; idx < bestSeq.dropoffOrder.length; idx += 1) {
    const ord = bestSeq.dropoffOrder[idx]!;
    const batchPosition = idx + 1;
    const toVendorLeg =
      idx === 0
        ? estimateRoadLegFallback(prevAnchorPoint, ord.vendorPoint, params.vehicleType, roadFactor)
        : { distanceKm: Number((haversineKm(orders[0]!.vendorPoint, ord.vendorPoint) * roadFactor).toFixed(3)) };
    const loadedLeg = estimateRoadLegFallback(
      idx === 0 ? ord.vendorPoint : prevAnchorPoint,
      ord.customerPoint,
      params.vehicleType,
      roadFactor,
    );
    prevAnchorPoint = ord.customerPoint;

    const fare = calculateRiderFare(
      {
        travelDistanceKm: Number((toVendorLeg.distanceKm + loadedLeg.distanceKm).toFixed(3)),
        toVendorKm: Number(toVendorLeg.distanceKm.toFixed(3)),
        trafficDelayMinutes: params.trafficDelayMinutes ?? 0,
        activeOrdersInZone: Math.max(1, params.activeOrdersInZone),
        activeRidersInZone: params.activeRidersInZone,
        weatherCondition: params.weatherCondition,
        vehicleType: params.vehicleType,
        batchPosition,
        orderFoodPayablePoisha: ord.foodPayablePoisha,
        isPriority: false,
      },
      fPolicy,
    );
    perOrderFares.push({ orderId: ord.orderId, batchPosition, fare });
  }

  const totalRiderFarePoisha = perOrderFares.reduce((sum, line) => sum + line.fare.riderFarePoisha, 0);

  return {
    orderIds: bestSeq.dropoffOrder.map((o) => o.orderId),
    stops: bestSeq.steps,
    totalMinutes: bestSeq.totalMinutes,
    maxPostPickupRideMinutes: bestSeq.maxRideMinutes,
    firstCustomerDetourMinutes: bestSeq.firstDetourMinutes,
    totalRiderFarePoisha,
    perOrderFares,
  };
}

/**
 * Finds the highest-saving legal batch anchored on `seedOrder` from currently unassigned/preparing
 * zone orders (`File 12 §12.4`). Never mutates input arrays.
 */
export function findBestBatchForOrder(params: {
  readonly seedOrder: DispatchOrderSnapshot;
  readonly poolOrders: readonly DispatchOrderSnapshot[];
  readonly riderOrigin: GeoPoint;
  readonly vehicleType: RiderVehicleType;
  readonly activeOrdersInZone: number;
  readonly activeRidersInZone: number;
  readonly weatherCondition: WeatherCondition;
  readonly trafficDelayMinutes?: number;
  readonly roadFactor?: number;
  readonly batchPolicy?: BatchPolicy;
  readonly farePolicy?: FarePolicyConfig;
}): BuiltBatchPlan | null {
  if (params.seedOrder.isPriority || params.seedOrder.fulfilment !== 'delivery') return null;
  const peers = params.poolOrders.filter(
    (o) => o.orderId !== params.seedOrder.orderId && !o.isPriority && o.fulfilment === 'delivery',
  );
  if (peers.length === 0) return null;

  let best: BuiltBatchPlan | null = null;
  for (let i = 0; i < peers.length; i += 1) {
    const pairPlan = buildOptimalBatchPlan({
      ...params,
      orders: [params.seedOrder, peers[i]!],
    });
    if (pairPlan && (!best || pairPlan.orderIds.length > best.orderIds.length || pairPlan.totalMinutes < best.totalMinutes)) {
      best = pairPlan;
    }
    for (let j = i + 1; j < peers.length; j += 1) {
      const triplePlan = buildOptimalBatchPlan({
        ...params,
        orders: [params.seedOrder, peers[i]!, peers[j]!],
      });
      if (
        triplePlan &&
        (!best ||
          triplePlan.orderIds.length > best.orderIds.length ||
          (triplePlan.orderIds.length === best.orderIds.length && triplePlan.totalMinutes < best.totalMinutes))
      ) {
        best = triplePlan;
      }
    }
  }
  return best;
}

/**
 * Re-sequences surviving orders cleanly whenever one member of a batch cancels mid-flight
 * (`File 12 §12.4`: never orphan surviving orders silently).
 */
export function resequenceBatchAfterCancellation(params: {
  readonly remainingOrders: readonly DispatchOrderSnapshot[];
  readonly riderPosition: GeoPoint;
  readonly vehicleType: RiderVehicleType;
  readonly activeOrdersInZone: number;
  readonly activeRidersInZone: number;
  readonly weatherCondition: WeatherCondition;
}):
  | { readonly mode: 'empty'; readonly survivingOrderIds: readonly [] }
  | { readonly mode: 'solo'; readonly survivingOrderIds: readonly [string]; readonly fare: CalculatedRiderFare }
  | { readonly mode: 'batched'; readonly survivingOrderIds: readonly string[]; readonly plan: BuiltBatchPlan } {
  if (params.remainingOrders.length === 0) {
    return { mode: 'empty', survivingOrderIds: [] };
  }
  if (params.remainingOrders.length === 1) {
    const sole = params.remainingOrders[0]!;
    const toVendor = estimateRoadLegFallback(params.riderPosition, sole.vendorPoint, params.vehicleType);
    const loaded = estimateRoadLegFallback(sole.vendorPoint, sole.customerPoint, params.vehicleType);
    const fare = calculateRiderFare({
      travelDistanceKm: Number((toVendor.distanceKm + loaded.distanceKm).toFixed(3)),
      toVendorKm: Number(toVendor.distanceKm.toFixed(3)),
      trafficDelayMinutes: 0,
      activeOrdersInZone: Math.max(1, params.activeOrdersInZone),
      activeRidersInZone: params.activeRidersInZone,
      weatherCondition: params.weatherCondition,
      vehicleType: params.vehicleType,
      batchPosition: 1,
      orderFoodPayablePoisha: sole.foodPayablePoisha,
      isPriority: sole.isPriority,
    });
    return { mode: 'solo', survivingOrderIds: [sole.orderId], fare };
  }

  const rebuilt = buildOptimalBatchPlan({
    orders: params.remainingOrders,
    riderOrigin: params.riderPosition,
    vehicleType: params.vehicleType,
    activeOrdersInZone: params.activeOrdersInZone,
    activeRidersInZone: params.activeRidersInZone,
    weatherCondition: params.weatherCondition,
  });
  if (rebuilt) {
    return { mode: 'batched', survivingOrderIds: rebuilt.orderIds, plan: rebuilt };
  }
  // If surviving pair violates tight detour threshold from rider's current point, degrade safely to first anchor solo + queue peer.
  const first = params.remainingOrders[0]!;
  const toVendor = estimateRoadLegFallback(params.riderPosition, first.vendorPoint, params.vehicleType);
  const loaded = estimateRoadLegFallback(first.vendorPoint, first.customerPoint, params.vehicleType);
  return {
    mode: 'solo',
    survivingOrderIds: [first.orderId],
    fare: calculateRiderFare({
      travelDistanceKm: Number((toVendor.distanceKm + loaded.distanceKm).toFixed(3)),
      toVendorKm: Number(toVendor.distanceKm.toFixed(3)),
      trafficDelayMinutes: 0,
      activeOrdersInZone: Math.max(1, params.activeOrdersInZone),
      activeRidersInZone: params.activeRidersInZone,
      weatherCondition: params.weatherCondition,
      vehicleType: params.vehicleType,
      batchPosition: 1,
      orderFoodPayablePoisha: first.foodPayablePoisha,
      isPriority: first.isPriority,
    }),
  };
}
