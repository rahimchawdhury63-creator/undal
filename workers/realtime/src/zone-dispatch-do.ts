/**
 * @file workers/realtime/src/zone-dispatch-do.ts
 * @description Per-zone `ZoneDispatchDO` Durable Object (`SQLite`/KV storage + serialized mutex)
 * coordinating single-order & bundled multi-order dispatch (`DSP-03`), `35s` cascading offers,
 * first-writer-wins atomic `accept` lock, `D-23` Solo-Rider protection (`DSP-01`, `DSP-02`),
 * and `120s` `VENDOR_UNREACHABLE` auto-protection (`ORD-02`).
 */

import { DEFAULT_FARE_POLICY, okEnvelope } from '@undal/shared-ts';
import { evaluateOfferRejection, maxConcurrentCapacity, rankRiderCandidates } from './assignment.ts';
import { findBestBatchForOrder } from './batcher.ts';
import { createRealtimePostgrestAdapter } from './db-postgrest.ts';
import { classifyPresence } from './presence.ts';
import type {
  DispatchOrderSnapshot,
  DurableNamespaceLike,
  DurableStateLike,
  DurableStorageLike,
  OfferRecord,
  RealtimeDbAdapter,
  RealtimeWorkerEnv,
} from './types.ts';

const OFFER_TTL_MS = 35_000;
const VENDOR_UNREACHABLE_MS = 120_000;
const ADMIN_ESCALATION_UNASSIGNED_MS = 240_000;

interface OrderDispatchState {
  readonly orderId: string;
  readonly zoneId: string;
  readonly vendorProfileId?: string;
  status: 'offering' | 'assigned' | 'queued_no_rider' | 'escalated_admin' | 'cancelled_unreachable';
  activeOfferId: string | null;
  assignedRiderId: string | null;
  batchId: string | null;
  rejectedRiderIds: string[];
  attempts: number;
  radiusMultiplier: number;
  createdAtMs: number;
  updatedAtMs: number;
}

/** Creates a spec-compliant in-memory `DurableStorageLike` backing `ZoneDispatchDO` when run locally. */
export function createMemoryDurableStorage(): DurableStorageLike {
  const map = new Map<string, unknown>();
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const val = map.get(key);
      return val === undefined ? undefined : (structuredClone(val) as T);
    },
    async put<T = unknown>(key: string, value: T): Promise<void> {
      map.set(key, structuredClone(value));
    },
    async delete(key: string): Promise<boolean> {
      return map.delete(key);
    },
    async list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>> {
      const out = new Map<string, T>();
      for (const [k, v] of map.entries()) {
        if (!options?.prefix || k.startsWith(options.prefix)) {
          out.set(k, structuredClone(v) as T);
        }
      }
      return out;
    },
  };
}

/** Creates an isolated per-zone `DurableNamespaceLike` registry for local/integration test execution. */
export function createLocalZoneDispatchNamespace(
  getEnv: () => RealtimeWorkerEnv,
  resolveDb: (env: RealtimeWorkerEnv) => RealtimeDbAdapter,
): DurableNamespaceLike {
  const instances = new Map<string, ZoneDispatchDO>();
  return {
    idFromName(name: string): string {
      return name;
    },
    get(id: unknown) {
      const key = String(id);
      let inst = instances.get(key);
      if (!inst) {
        inst = new ZoneDispatchDO({ storage: createMemoryDurableStorage() }, getEnv(), resolveDb);
        instances.set(key, inst);
      }
      return {
        fetch: (input: RequestInfo | URL, init?: RequestInit) =>
          inst!.fetch(input instanceof Request ? input : new Request(input, init)),
      };
    },
  };
}

/** Per-zone serialized dispatch coordinator Durable Object (`wrangler.toml` binding `ZONE_DISPATCH`). */
export class ZoneDispatchDO {
  readonly state: DurableStateLike;
  readonly env: RealtimeWorkerEnv;
  private readonly storage: DurableStorageLike;
  private readonly resolveDb?: (env: RealtimeWorkerEnv) => RealtimeDbAdapter;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(
    state: Partial<DurableStateLike>,
    env: RealtimeWorkerEnv,
    resolveDb?: (env: RealtimeWorkerEnv) => RealtimeDbAdapter,
  ) {
    this.storage = state.storage ?? createMemoryDurableStorage();
    this.state = { storage: this.storage, ...(state.blockConcurrencyWhile ? { blockConcurrencyWhile: state.blockConcurrencyWhile } : {}) };
    this.env = env;
    if (resolveDb) this.resolveDb = resolveDb;
  }

  /** Serializes concurrent mutations strictly FIFO (`first-writer-wins` atomic guarantee). */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private getDb(): RealtimeDbAdapter {
    if (this.env.dbAdapter) return this.env.dbAdapter;
    if (this.resolveDb) return this.resolveDb(this.env);
    return createRealtimePostgrestAdapter(this.env);
  }

  private now(): number {
    return this.env.nowMs ? this.env.nowMs() : Date.now();
  }

  private async scheduleNextAlarm(timestampMs: number): Promise<void> {
    if (typeof this.state.storage.setAlarm === 'function') {
      await this.state.storage.setAlarm(timestampMs);
    }
  }

  /** Dispatches or cascades an order to the highest-scoring eligible rider or batch. */
  private async issueNextOfferForOrder(
    order: DispatchOrderSnapshot,
    dispatchState: OrderDispatchState,
    nowMs: number,
  ): Promise<{
    readonly status: OrderDispatchState['status'];
    readonly offer: OfferRecord | null;
    readonly candidateCount: number;
  }> {
    const db = this.getDb();
    if (order.fulfilment === 'pickup') {
      dispatchState.status = 'assigned';
      dispatchState.updatedAtMs = nowMs;
      await this.state.storage.put(`order:${order.orderId}`, dispatchState);
      return { status: 'assigned', offer: null, candidateCount: 0 };
    }

    const [poolOrders, candidates, weatherEntry, farePolicy] = await Promise.all([
      db.listUnassignedZoneOrders(order.zoneId),
      db.listZoneRiderCandidates(order.zoneId, nowMs),
      db.getZoneWeather(order.zoneId, nowMs),
      db.getFarePolicy().catch(() => DEFAULT_FARE_POLICY),
    ]);

    const weather = weatherEntry && weatherEntry.expiresAtMs > nowMs ? weatherEntry.condition : 'clear';
    const activeOrdersCount = Math.max(1, poolOrders.length);
    const liveRidersCount = candidates.filter(
      (c) =>
        classifyPresence(c.lastSeenAtMs, nowMs) === 'LIVE' &&
        c.isActive &&
        c.isOnline &&
        c.kycStatus === 'approved' &&
        !c.cashGateBlocked &&
        c.capacityUsed < maxConcurrentCapacity(c.vehicleType),
    ).length;

    const ranked = rankRiderCandidates({
      order,
      candidates,
      excludedRiderIds: new Set(dispatchState.rejectedRiderIds),
      activeOrdersInZone: activeOrdersCount,
      weatherCondition: weather,
      radiusMultiplier: dispatchState.radiusMultiplier,
      nowMs,
      farePolicy,
    });

    const winner = ranked[0];
    if (!winner) {
      const unassignedAgeMs = nowMs - dispatchState.createdAtMs;
      dispatchState.activeOfferId = null;
      dispatchState.status =
        unassignedAgeMs >= ADMIN_ESCALATION_UNASSIGNED_MS ? 'escalated_admin' : 'queued_no_rider';
      dispatchState.updatedAtMs = nowMs;
      await this.state.storage.put(`order:${order.orderId}`, dispatchState);
      return { status: dispatchState.status, offer: null, candidateCount: 0 };
    }

    // Attempt multi-order batch bundling when compatible unassigned orders exist (`DSP-03`):
    const batchPlan = findBestBatchForOrder({
      seedOrder: order,
      poolOrders,
      riderOrigin: { lat: winner.rider.lat, lng: winner.rider.lng },
      vehicleType: winner.rider.vehicleType,
      activeOrdersInZone: activeOrdersCount,
      activeRidersInZone: liveRidersCount,
      weatherCondition: weather,
      farePolicy,
    });

    const effectiveBatch = batchFitsCheck(
      batchPlan,
      winner.rider.capacityUsed,
      winner.rider.vehicleType,
      poolOrders,
      winner.rider.cashInHandPoisha,
      winner.rider.cashCeilingPoisha,
    );

    const batchId = effectiveBatch ? crypto.randomUUID() : null;
    const offerId = crypto.randomUUID();
    const attemptNumber = dispatchState.attempts + 1;
    const offer: OfferRecord = {
      id: offerId,
      orderId: order.orderId,
      batchId,
      batchOrderIds: effectiveBatch ? effectiveBatch.orderIds : [order.orderId],
      zoneId: order.zoneId,
      riderId: winner.rider.riderId,
      riderProfileId: winner.rider.profileId,
      farePoisha: effectiveBatch ? effectiveBatch.totalRiderFarePoisha : winner.fare.riderFarePoisha,
      fareBreakdown: winner.fare,
      score: winner.score,
      scoreFactors: winner.factors,
      soloRider: ranked.length === 1,
      response: 'pending',
      rejectReason: null,
      offeredAtMs: nowMs,
      expiresAtMs: nowMs + OFFER_TTL_MS,
      respondedAtMs: null,
      attemptNumber,
    };

    dispatchState.status = 'offering';
    dispatchState.activeOfferId = offerId;
    dispatchState.batchId = batchId;
    dispatchState.attempts = attemptNumber;
    dispatchState.updatedAtMs = nowMs;

    await this.state.storage.put(`offer:${offerId}`, offer);
    await this.state.storage.put(`order:${order.orderId}`, dispatchState);
    await db.persistBatchAndOffer(offer);
    await this.scheduleNextAlarm(offer.expiresAtMs);

    return { status: 'offering', offer, candidateCount: ranked.length };
  }

  /** Durable Object alarm callback sweeping expired offers & `120s` unreachable vendors. */
  async alarm(): Promise<void> {
    await this.runExclusive(async () => {
      await this.sweepInternal(this.now());
    });
  }

  private async sweepInternal(nowMs: number): Promise<{
    readonly expiredOffers: number;
    readonly cascadedOffers: number;
    readonly vendorUnreachableCancelled: number;
  }> {
    const db = this.getDb();
    let expiredOffers = 0;
    let cascadedOffers = 0;
    let vendorUnreachableCancelled = 0;

    const offerEntries = await this.state.storage.list<OfferRecord>({ prefix: 'offer:' });
    for (const [key, offer] of offerEntries.entries()) {
      if (offer.response === 'pending' && nowMs >= offer.expiresAtMs) {
        const expired: OfferRecord = { ...offer, response: 'expired', respondedAtMs: nowMs };
        await this.state.storage.put(key, expired);
        await db.persistOfferDecision(expired);
        expiredOffers += 1;

        const ordState = await this.state.storage.get<OrderDispatchState>(`order:${offer.orderId}`);
        const order = await db.getDispatchOrder(offer.orderId);
        if (ordState && order && ordState.status === 'offering') {
          ordState.rejectedRiderIds = [...new Set([...ordState.rejectedRiderIds, offer.riderId])];
          if (ordState.attempts >= 3 || nowMs - ordState.createdAtMs >= 90_000) {
            ordState.radiusMultiplier = 1.1;
          }
          const next = await this.issueNextOfferForOrder(order, ordState, nowMs);
          if (next.offer) cascadedOffers += 1;
        }
      }
    }

    const orderEntries = await this.state.storage.list<OrderDispatchState>({ prefix: 'order:' });
    for (const [key, ordState] of orderEntries.entries()) {
      if (ordState.status === 'cancelled_unreachable' || ordState.status === 'assigned') continue;
      const order = await db.getDispatchOrder(ordState.orderId);
      if (order && order.status === 'PLACED' && nowMs - order.placedAtMs >= VENDOR_UNREACHABLE_MS) {
        const vendorPres = ordState.vendorProfileId ? await db.getPresence(ordState.vendorProfileId) : null;
        if (!vendorPres || classifyPresence(vendorPres.lastSeenAtMs, nowMs) === 'OFFLINE') {
          const cancelled = await db.markVendorUnreachable(order.orderId, nowMs);
          if (cancelled) {
            ordState.status = 'cancelled_unreachable';
            ordState.updatedAtMs = nowMs;
            await this.state.storage.put(key, ordState);
            vendorUnreachableCancelled += 1;
          }
        }
      }
    }

    return { expiredOffers, cascadedOffers, vendorUnreachableCancelled };
  }

  async fetch(request: Request): Promise<Response> {
    return this.runExclusive(async () => {
      const url = new URL(request.url);
      const nowMs = this.now();
      const db = this.getDb();

      if (request.method === 'GET' && url.pathname === '/status') {
        const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
        const orders = await this.storage.list<OrderDispatchState>({ prefix: 'order:' });
        return Response.json(
          okEnvelope(
            { durableObject: 'ZoneDispatchDO', status: 'ready', activeTrackedOrders: orders.size },
            requestId,
          ),
        );
      }

      if (request.method === 'POST' && url.pathname === '/dispatch/order') {
        const body = (await request.json()) as { orderId: string; vendorProfileId?: string };
        const order = await db.getDispatchOrder(body.orderId);
        if (!order) {
          return Response.json({ error: 'ORDER_STATE_ILLEGAL' }, { status: 404 });
        }
        const existing = await this.state.storage.get<OrderDispatchState>(`order:${order.orderId}`);
        const stateObj: OrderDispatchState = existing ?? {
          orderId: order.orderId,
          zoneId: order.zoneId,
          ...(body.vendorProfileId !== undefined ? { vendorProfileId: body.vendorProfileId } : {}),
          status: 'offering',
          activeOfferId: null,
          assignedRiderId: null,
          batchId: null,
          rejectedRiderIds: [],
          attempts: 0,
          radiusMultiplier: 1,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
        };
        const issued = await this.issueNextOfferForOrder(order, stateObj, nowMs);
        return Response.json(issued, { status: 200 });
      }

      if (request.method === 'POST' && url.pathname === '/offers/accept') {
        const body = (await request.json()) as { offerId: string; riderId: string };
        const offer = await this.state.storage.get<OfferRecord>(`offer:${body.offerId}`);
        if (!offer || offer.riderId !== body.riderId) {
          return Response.json({ error: 'OFFER_EXPIRED' }, { status: 410 });
        }
        if (offer.response !== 'pending' || nowMs >= offer.expiresAtMs) {
          if (offer.response === 'pending') {
            const expired: OfferRecord = { ...offer, response: 'expired', respondedAtMs: nowMs };
            await this.state.storage.put(`offer:${offer.id}`, expired);
            await db.persistOfferDecision(expired);
          }
          return Response.json({ error: 'OFFER_EXPIRED' }, { status: 410 });
        }
        const ordState = await this.state.storage.get<OrderDispatchState>(`order:${offer.orderId}`);
        if (ordState && ordState.assignedRiderId !== null) {
          return Response.json({ error: 'OFFER_EXPIRED' }, { status: 410 });
        }

        const accepted: OfferRecord = { ...offer, response: 'accepted', respondedAtMs: nowMs };
        await this.state.storage.put(`offer:${offer.id}`, accepted);
        if (ordState) {
          ordState.status = 'assigned';
          ordState.assignedRiderId = body.riderId;
          ordState.updatedAtMs = nowMs;
          await this.state.storage.put(`order:${offer.orderId}`, ordState);
        }
        await db.persistOfferDecision(accepted);
        return Response.json({ status: 'accepted', offer: accepted }, { status: 200 });
      }

      if (request.method === 'POST' && url.pathname === '/offers/reject') {
        const body = (await request.json()) as {
          offerId: string;
          riderId: string;
          reason: string;
          requestReassign: boolean;
        };
        const offer = await this.state.storage.get<OfferRecord>(`offer:${body.offerId}`);
        if (!offer || offer.riderId !== body.riderId) {
          return Response.json({ error: 'OFFER_EXPIRED' }, { status: 410 });
        }
        if (offer.response !== 'pending' || nowMs >= offer.expiresAtMs) {
          return Response.json({ error: 'OFFER_EXPIRED' }, { status: 410 });
        }

        const ordState = await this.state.storage.get<OrderDispatchState>(`order:${offer.orderId}`);
        const decision = evaluateOfferRejection({
          soloRider: offer.soloRider,
          requestReassign: body.requestReassign,
          priorRejectionsCount: ordState?.rejectedRiderIds.length ?? 0,
        });
        if (!decision.allowed) {
          return Response.json(
            { error: decision.errorCode, soloRider: true, nextAction: decision.nextAction },
            { status: 409 },
          );
        }

        const updated: OfferRecord = {
          ...offer,
          response: decision.nextResponseState,
          rejectReason: body.reason,
          respondedAtMs: nowMs,
        };
        await this.state.storage.put(`offer:${offer.id}`, updated);
        await db.persistOfferDecision(updated);

        let nextOffer: OfferRecord | null = null;
        let nextStatus: OrderDispatchState['status'] = decision.escalateToAdmin ? 'escalated_admin' : 'queued_no_rider';
        const order = await db.getDispatchOrder(offer.orderId);
        if (ordState && order) {
          ordState.rejectedRiderIds = [...new Set([...ordState.rejectedRiderIds, body.riderId])];
          if (decision.widenRadius) ordState.radiusMultiplier = 1.1;
          const cascaded = await this.issueNextOfferForOrder(order, ordState, nowMs);
          nextOffer = cascaded.offer;
          nextStatus = !cascaded.offer && decision.escalateToAdmin ? 'escalated_admin' : cascaded.status;
          if (!cascaded.offer && decision.escalateToAdmin) {
            ordState.status = 'escalated_admin';
            await this.state.storage.put(`order:${offer.orderId}`, ordState);
          }
        }
        return Response.json(
          {
            status: decision.nextResponseState,
            offer: updated,
            cascadedOffer: nextOffer,
            dispatchStatus: nextStatus,
          },
          { status: 200 },
        );
      }

      if (request.method === 'POST' && url.pathname === '/sweep') {
        const result = await this.sweepInternal(nowMs);
        return Response.json(result, { status: 200 });
      }

      return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    });
  }
}

function batchFitsCheck(
  batchPlan: ReturnType<typeof findBestBatchForOrder>,
  capacityUsed: number,
  vehicleType: 'motorbike' | 'bicycle',
  poolOrders: readonly DispatchOrderSnapshot[],
  cashInHandPoisha: number,
  cashCeilingPoisha: number,
): ReturnType<typeof findBestBatchForOrder> {
  if (!batchPlan) return null;
  if (capacityUsed + batchPlan.orderIds.length > maxConcurrentCapacity(vehicleType)) return null;
  const totalBatchCod = batchPlan.orderIds.reduce((sum, id) => {
    const found = poolOrders.find((o) => o.orderId === id);
    return sum + (found?.codCollectPoisha ?? 0);
  }, 0);
  if (cashInHandPoisha + totalBatchCod > cashCeilingPoisha) return null;
  return batchPlan;
}
