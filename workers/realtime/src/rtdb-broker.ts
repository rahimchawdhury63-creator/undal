/**
 * @file workers/realtime/src/rtdb-broker.ts
 * @description Firebase Realtime Database Spark-Plan `100`-Connection Survival Economy (`File 06`, `RT-01`):
 *   1. `RtdbLeaseBroker`: enforces `RTDB_LEASE_HARD_CAP` (`default 85 / 100`), role priority,
 *      per-actor dedupe (`1` conn/order customer, `1` conn/outlet vendor, `<= 2` rider, `<= 2` admin),
 *      `realtime_mode = 'rtdb' | 'polling'` kill-switch, and seamless `5000ms` HTTP polling degradation.
 *   2. `RtdbRoomClient`: writes tiny single-letter ephemeral nodes (`o/{orderId}`, `p/v/{id}`, `p/r/{id}`)
 *      via service-account OAuth2 REST and prunes closed rooms (`> 1h`) + stale presence (`> 10m`).
 */

import { getGoogleAccessToken, mintFirebaseCustomToken, parseServiceAccountJson } from './google-auth.ts';
import type { GeoPoint } from './types.ts';

export type LeaseActorKind = 'rider' | 'vendor' | 'customer' | 'admin';

export interface ActiveRtdbLease {
  readonly leaseKey: string;
  readonly profileId: string;
  readonly actorKind: LeaseActorKind;
  readonly dbPath: string;
  readonly grantedAtMs: number;
  readonly expiresAtMs: number;
}

export type RealtimeTokenGrant =
  | {
      readonly mode: 'rtdb';
      readonly token: string;
      readonly expiresInSeconds: number;
      readonly dbUrl: string;
      readonly dbPath: string;
      readonly activeLeases: number;
      readonly hardCap: number;
    }
  | {
      readonly mode: 'poll';
      readonly pollIntervalMs: 5_000;
      readonly fallbackPath: string;
      readonly reason: 'lease_cap_reached' | 'kill_switch_polling' | 'rtdb_not_configured';
      readonly activeLeases: number;
      readonly hardCap: number;
    };

/** Priority-aware Spark connection lease manager (`File 06 §6.2`). */
export class RtdbLeaseBroker {
  private readonly leases = new Map<string, ActiveRtdbLease>();

  /** Removes all expired leases as of `nowMs`. */
  pruneExpired(nowMs: number): number {
    let removed = 0;
    for (const [k, lease] of this.leases.entries()) {
      if (lease.expiresAtMs <= nowMs) {
        this.leases.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  /** Current live lease count (`<= hardCap`). */
  countActive(nowMs: number): number {
    this.pruneExpired(nowMs);
    return this.leases.size;
  }

  /** Explicitly releases a client connection lease on terminal state or background detach (`> 60s`). */
  releaseLease(leaseKey: string): boolean {
    return this.leases.delete(leaseKey);
  }

  /** Clears all in-memory leases (used in deterministic simulation suites). */
  reset(): void {
    this.leases.clear();
  }

  /**
   * Acquires or renews a deduplicated RTDB connection lease when `< hardCap` (`default 85/100`),
   * or cleanly degrades to `5000ms` HTTP polling without throwing (`RT-01`!).
   */
  async acquireTokenOrPollFallback(params: {
    readonly profileId: string;
    readonly actorKind: LeaseActorKind;
    readonly scopeKey: string;
    readonly dbPath: string;
    readonly fallbackPath: string;
    readonly claims: Readonly<Record<string, string>>;
    readonly hardCap: number;
    readonly realtimeMode: 'rtdb' | 'polling';
    readonly rtdbUrl: string | undefined;
    readonly serviceAccountJson: string | undefined;
    readonly nowMs: number;
    readonly ttlSeconds?: number;
  }): Promise<RealtimeTokenGrant> {
    this.pruneExpired(params.nowMs);
    const cap = Math.min(95, Math.max(1, params.hardCap));

    if (params.realtimeMode === 'polling') {
      return {
        mode: 'poll',
        pollIntervalMs: 5_000,
        fallbackPath: params.fallbackPath,
        reason: 'kill_switch_polling',
        activeLeases: this.leases.size,
        hardCap: cap,
      };
    }

    if (!params.rtdbUrl || !params.serviceAccountJson) {
      return {
        mode: 'poll',
        pollIntervalMs: 5_000,
        fallbackPath: params.fallbackPath,
        reason: 'rtdb_not_configured',
        activeLeases: this.leases.size,
        hardCap: cap,
      };
    }

    // Deduplicate per `(actorKind, scopeKey)` per `File 06 §6.2` (`1/order`, `1/outlet-device`, `<=2/admin`).
    const leaseKey = `${params.actorKind}:${params.scopeKey}`;
    const existing = this.leases.get(leaseKey);
    if (!existing && this.leases.size >= cap) {
      // High-priority rider/vendor work can evict the oldest low-priority admin/customer tracking lease!
      let evicted = false;
      if (params.actorKind === 'rider' || params.actorKind === 'vendor') {
        for (const [candKey, cand] of this.leases.entries()) {
          if (cand.actorKind === 'admin' || cand.actorKind === 'customer') {
            this.leases.delete(candKey);
            evicted = true;
            break;
          }
        }
      }
      if (!evicted) {
        return {
          mode: 'poll',
          pollIntervalMs: 5_000,
          fallbackPath: params.fallbackPath,
          reason: 'lease_cap_reached',
          activeLeases: this.leases.size,
          hardCap: cap,
        };
      }
    }

    const sa = parseServiceAccountJson(params.serviceAccountJson);
    const ttlSeconds = Math.min(900, Math.max(60, params.ttlSeconds ?? 900));
    const minted = await mintFirebaseCustomToken({
      serviceAccount: sa,
      uid: params.profileId,
      claims: params.claims,
      nowMs: params.nowMs,
      ttlSeconds,
    });

    this.leases.set(leaseKey, {
      leaseKey,
      profileId: params.profileId,
      actorKind: params.actorKind,
      dbPath: params.dbPath,
      grantedAtMs: params.nowMs,
      expiresAtMs: params.nowMs + ttlSeconds * 1_000,
    });

    return {
      mode: 'rtdb',
      token: minted.token,
      expiresInSeconds: minted.expiresInSeconds,
      dbUrl: params.rtdbUrl.replace(/\/$/, ''),
      dbPath: params.dbPath,
      activeLeases: this.leases.size,
      hardCap: cap,
    };
  }
}

export const GLOBAL_RTDB_LEASE_BROKER = new RtdbLeaseBroker();

/** Rounds WGS-84 coordinates to `5 dp` (`~1.1 m` precision) per `File 06 §6.1` download quota law. */
function round5(n: number): number {
  return Math.round(n * 100_000) / 100_000;
}

/** Server-side Firebase RTDB REST writer & hourly orphan sweeper (`File 06 §6.1, §6.5`). */
export class RtdbRoomClient {
  private readonly rtdbUrl: string | undefined;
  private readonly serviceAccountJson: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    readonly rtdbUrl: string | undefined;
    readonly serviceAccountJson: string | undefined;
    readonly fetchImpl: typeof fetch;
  }) {
    this.rtdbUrl = opts.rtdbUrl;
    this.serviceAccountJson = opts.serviceAccountJson;
    this.fetchImpl = opts.fetchImpl;
  }

  private async request(
    method: 'GET' | 'PUT' | 'PATCH' | 'DELETE',
    dbPath: string,
    body: unknown,
    nowMs: number,
  ): Promise<unknown> {
    if (!this.rtdbUrl || !this.serviceAccountJson) return null;
    const sa = parseServiceAccountJson(this.serviceAccountJson);
    const accessToken = await getGoogleAccessToken({
      serviceAccount: sa,
      fetchImpl: this.fetchImpl,
      nowMs,
    });
    const cleanPath = dbPath.replace(/^\/+/, '');
    const url = `${this.rtdbUrl.replace(/\/$/, '')}/${cleanPath}.json`;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(3_500),
    });
    if (!res.ok) return null;
    const txt = await res.text();
    return txt ? (JSON.parse(txt) as unknown) : null;
  }

  /** Creates or updates compact active-order room `o/{orderId}` (`File 06 §6.1`). */
  async upsertOrderRoom(params: {
    readonly orderId: string;
    readonly customerId: string;
    readonly vendorId: string;
    readonly riderId: string | null;
    readonly zoneId: string;
    readonly status: string;
    readonly etaEpochSec: number;
    readonly vendorPoint: GeoPoint;
    readonly customerPoint: GeoPoint;
    readonly currentOffer?: { readonly riderId: string; readonly expEpochSec: number } | null;
    readonly closedAtMs?: number | null;
    readonly nowMs: number;
  }): Promise<void> {
    await this.request(
      'PATCH',
      `o/${params.orderId}`,
      {
        meta: {
          cid: params.customerId,
          vid: params.vendorId,
          rid: params.riderId,
          z: params.zoneId,
          closed_at: params.closedAtMs ?? null,
        },
        s: params.status.toLowerCase(),
        eta: Math.round(params.etaEpochSec),
        v: { la: round5(params.vendorPoint.lat), ln: round5(params.vendorPoint.lng) },
        c: { la: round5(params.customerPoint.lat), ln: round5(params.customerPoint.lng) },
        offer: params.currentOffer
          ? { riderId: params.currentOffer.riderId, exp: params.currentOffer.expEpochSec }
          : null,
      },
      params.nowMs,
    );
  }

  /** Patches compact room assignment/status fields (`RIDER_ASSIGNED` or terminal `closed_at`). */
  async patchOrderRoomResolution(params: {
    readonly orderId: string;
    readonly status: string;
    readonly riderId: string | null;
    readonly closedAtMs?: number | null;
    readonly nowMs: number;
  }): Promise<void> {
    const existing = (await this.request('GET', `o/${params.orderId}/meta`, undefined, params.nowMs)) as
      | Record<string, unknown>
      | null;
    await this.request(
      'PATCH',
      `o/${params.orderId}`,
      {
        meta: {
          ...(existing ?? {}),
          rid: params.riderId,
          ...(params.closedAtMs !== undefined ? { closed_at: params.closedAtMs } : {}),
        },
        s: params.status.toLowerCase(),
        offer: null,
      },
      params.nowMs,
    );
  }

  /** Deletes rooms closed `> 1h` and presence nodes stale `> 10m` (`File 06 §6.5`). */
  async sweepExpiredNodes(nowMs: number): Promise<{
    readonly deletedRooms: number;
    readonly deletedPresenceNodes: number;
  }> {
    let deletedRooms = 0;
    let deletedPresenceNodes = 0;
    if (!this.rtdbUrl || !this.serviceAccountJson) {
      return { deletedRooms, deletedPresenceNodes };
    }

    const rooms = (await this.request('GET', 'o', undefined, nowMs)) as Record<
      string,
      { meta?: { closed_at?: number | null } }
    > | null;
    if (rooms && typeof rooms === 'object') {
      for (const [orderId, room] of Object.entries(rooms)) {
        const closedAt = room?.meta?.closed_at;
        if (typeof closedAt === 'number' && nowMs - closedAt > 3_600_000) {
          await this.request('DELETE', `o/${orderId}`, undefined, nowMs);
          deletedRooms += 1;
        }
      }
    }

    for (const bucket of ['p/v', 'p/r'] as const) {
      const nodes = (await this.request('GET', bucket, undefined, nowMs)) as Record<
        string,
        { ts?: number }
      > | null;
      if (!nodes || typeof nodes !== 'object') continue;
      for (const [actorId, val] of Object.entries(nodes)) {
        if (typeof val?.ts === 'number' && nowMs - val.ts > 600_000) {
          await this.request('DELETE', `${bucket}/${actorId}`, undefined, nowMs);
          deletedPresenceNodes += 1;
        }
      }
    }

    return { deletedRooms, deletedPresenceNodes };
  }
}
