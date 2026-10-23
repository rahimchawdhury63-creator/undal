/**
 * @file workers/realtime/src/index.ts
 * @description Complete `W2 undal-realtime` Cloudflare Worker entrypoint (`Build Responses 8 & 9` — 100% of `W2`):
 * - Per-zone serialized `ZoneDispatchDO` (`SQLite`/KV atomic single & batched dispatch + `D-23`)
 * - Operator presence (`POST /v1/presence/ping`) & Rider pre-flight sessions (`start` / `end` + Cash Gate)
 * - Cross-Worker `HMAC-SHA256` `POST /v1/dispatch/order-placed` + atomic `POST /v1/offers/:id/accept|reject`
 * - `POST /v1/realtime/token` (`< 85 / 100` Spark lease broker + RS256 Firebase custom token or `5000ms` poll fallback)
 * - `POST /v1/alerts/test` + `dispatchDataOnlyFcm` (`ALM-01` high-priority data-only FCM HTTP v1 + `UNREGISTERED` pruning)
 * - `GET /v1/cashgate/config` (`UNDAL_BKASH_NUMBER` / `UNDAL_NAGAD_NUMBER` strictly from Worker secrets for approved riders)
 * - `60s`-cached `GET /v1/zone/:id/sdr` + throttled `POST /v1/geo/{geocode,reverse,route}`
 * - Cron sweep (`weather_cache` + offer expiry cascade + closed RTDB room `> 1h` & stale presence `> 10m` pruning)
 */

import { createRealtimePostgrestAdapter } from './db-postgrest.ts';
import { resolveZoneWeather } from './geo.ts';
import {
  authenticateRealtimeRequest,
  CORS_HEADERS,
  jsonErr,
  jsonOk,
} from './http.ts';
import { GLOBAL_RTDB_LEASE_BROKER, RtdbRoomClient } from './rtdb-broker.ts';
import { handleDispatchAndGeoRoutes } from './routes/dispatch-geo.ts';
import { handlePresenceAndSessionRoutes } from './routes/presence-session.ts';
import { handleRealtimeTokenAndAlertRoutes } from './routes/realtime-alerts.ts';
import type { RealtimeWorkerEnv } from './types.ts';
import { createLocalZoneDispatchNamespace, ZoneDispatchDO } from './zone-dispatch-do.ts';

export * from './assignment.ts';
export * from './batcher.ts';
export * from './db-postgrest.ts';
export * from './dispatch-fanout.ts';
export * from './fcm-sender.ts';
export * from './geo.ts';
export * from './google-auth.ts';
export * from './http.ts';
export * from './presence.ts';
export * from './rtdb-broker.ts';
export * from './rtdb-rules-eval.ts';
export * from './types.ts';
export { createLocalZoneDispatchNamespace, ZoneDispatchDO };

let fallbackLocalNamespace: ReturnType<typeof createLocalZoneDispatchNamespace> | null = null;
let latestEnvRef: RealtimeWorkerEnv = {};

function getZoneDispatchNamespace(env: RealtimeWorkerEnv) {
  latestEnvRef = env;
  if (env.ZONE_DISPATCH) return env.ZONE_DISPATCH;
  if (!fallbackLocalNamespace) {
    fallbackLocalNamespace = createLocalZoneDispatchNamespace(
      () => latestEnvRef,
      (currentEnv) => currentEnv.dbAdapter ?? createRealtimePostgrestAdapter(currentEnv),
    );
  }
  return fallbackLocalNamespace;
}

export default {
  async fetch(request: Request, env: RealtimeWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const nowMs = env.nowMs ? env.nowMs() : Date.now();
    const db = env.dbAdapter ?? createRealtimePostgrestAdapter(env);

    if (request.method === 'GET' && url.pathname === '/healthz') {
      const cap = Number(env.RTDB_LEASE_HARD_CAP ?? '85');
      const dbLeases = env.dbAdapter ? await db.getActiveRtdbLeaseCount(nowMs) : 0;
      const activeLeases = Math.max(dbLeases, GLOBAL_RTDB_LEASE_BROKER.countActive(nowMs));
      return jsonOk(
        {
          service: env.SERVICE_NAME ?? 'undal-realtime',
          rtdbLeaseCap: cap,
          activeRtdbLeases: activeLeases,
          realtimeMode: env.REALTIME_MODE ?? 'rtdb',
          status: 'ok',
        },
        requestId,
      );
    }

    const auth = await authenticateRealtimeRequest(request, env, db, nowMs);
    if (auth.errorCode) {
      return jsonErr(auth.errorCode, requestId);
    }

    try {
      const realtimeAlertRes = await handleRealtimeTokenAndAlertRoutes({
        request,
        pathname: url.pathname,
        requestId,
        principal: auth.principal,
        env,
        db,
        nowMs,
      });
      if (realtimeAlertRes) return realtimeAlertRes;

      const presenceRes = await handlePresenceAndSessionRoutes({
        request,
        pathname: url.pathname,
        requestId,
        principal: auth.principal,
        db,
        nowMs,
      });
      if (presenceRes) return presenceRes;

      const dispatchGeoRes = await handleDispatchAndGeoRoutes({
        request,
        pathname: url.pathname,
        requestId,
        principal: auth.principal,
        env,
        db,
        zoneDispatchNs: getZoneDispatchNamespace(env),
        nowMs,
      });
      if (dispatchGeoRes) return dispatchGeoRes;

      return jsonErr('VALIDATION_FAILED', requestId, { path: url.pathname }, undefined, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected realtime worker error';
      return jsonErr('SERVER_BUSY', requestId, { detail: message });
    }
  },

  // Cron trigger (`every 5 minutes`): refreshes weather, sweeps offer expiries & prunes closed RTDB rooms (`RT-01`).
  async scheduled(_controller: unknown, env: RealtimeWorkerEnv): Promise<{
    readonly sweptZones: number;
    readonly expiredOffers: number;
    readonly vendorUnreachableCancelled: number;
    readonly prunedRooms: number;
    readonly prunedPresence: number;
  }> {
    const nowMs = env.nowMs ? env.nowMs() : Date.now();
    const db = env.dbAdapter ?? createRealtimePostgrestAdapter(env);
    const ns = getZoneDispatchNamespace(env);
    const zones = await db.listZones();
    let expiredOffers = 0;
    let vendorUnreachableCancelled = 0;
    let sweptZones = 0;

    for (const zone of zones.filter((z) => z.isActive)) {
      sweptZones += 1;
      await resolveZoneWeather({
        zoneId: zone.id,
        center: zone.ring[0] ?? { lat: 24.8949, lng: 91.8687 },
        db,
        fetchImpl: env.fetchImpl ?? fetch,
        metNorwayBaseUrl: env.MET_NORWAY_BASE_URL ?? 'https://api.met.no',
        openMeteoBaseUrl: env.OPEN_METEO_BASE_URL ?? 'https://api.open-meteo.com',
        contactEmail: env.NOMINATIM_CONTACT_EMAIL ?? 'ops@undal.app',
        nowMs,
      });
      const stub = ns.get(ns.idFromName(zone.id));
      const res = await stub.fetch('https://zone-dispatch/sweep', { method: 'POST' });
      if (res.ok) {
        const summary = (await res.json()) as {
          expiredOffers?: number;
          vendorUnreachableCancelled?: number;
        };
        expiredOffers += summary.expiredOffers ?? 0;
        vendorUnreachableCancelled += summary.vendorUnreachableCancelled ?? 0;
      }
    }

    const rtdb = new RtdbRoomClient({
      rtdbUrl: env.FIREBASE_RTDB_URL,
      serviceAccountJson: env.FIREBASE_SERVICE_ACCOUNT_JSON,
      fetchImpl: env.fetchImpl ?? fetch,
    });
    const sweep = await rtdb.sweepExpiredNodes(nowMs);

    return {
      sweptZones,
      expiredOffers,
      vendorUnreachableCancelled,
      prunedRooms: sweep.deletedRooms,
      prunedPresence: sweep.deletedPresenceNodes,
    };
  },
};
