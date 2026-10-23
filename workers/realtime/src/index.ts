/**
 * @file workers/realtime/src/index.ts
 * @description Entrypoint shell for `W2 undal-realtime` Cloudflare Worker + `ZoneDispatchDO`
 * SQLite Durable Object (`Build Response 1`). Full dispatch, RTDB lease & data-only FCM routes
 * land in `Build Responses 8–9`.
 */

import { errEnvelope, okEnvelope } from '@undal/shared-ts';

export interface RealtimeWorkerEnv {
  readonly SERVICE_NAME?: string;
  readonly RTDB_LEASE_HARD_CAP?: string;
}

/** Per-zone SQLite Durable Object shell expanded into full dispatch state machine in `Build 8`. */
export class ZoneDispatchDO {
  readonly state: unknown;
  readonly env: RealtimeWorkerEnv;

  constructor(state: unknown, env: RealtimeWorkerEnv) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    return Response.json(okEnvelope({ durableObject: 'ZoneDispatchDO', status: 'ready' }, requestId));
  }
}

export default {
  async fetch(request: Request, env: RealtimeWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json(
        okEnvelope(
          {
            service: env.SERVICE_NAME ?? 'undal-realtime',
            rtdbLeaseCap: Number(env.RTDB_LEASE_HARD_CAP ?? '85'),
            status: 'ok',
          },
          requestId,
        ),
      );
    }

    const notFound = errEnvelope('VALIDATION_FAILED', requestId, { path: url.pathname });
    return Response.json(notFound.body, { status: 404 });
  },
};
