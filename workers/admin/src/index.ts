/**
 * @file workers/admin/src/index.ts
 * @description Production `W3 undal-admin` Cloudflare Worker Entrypoint (`Build Response 10` —
 * Capabilities `C1..C70` across Domains `1–4`):
 *   - 4-Gate Security Middleware (`JWT` -> `admin + active + TOTP enrolled` -> `RBAC` -> `5m Step-Up`)
 *   - Domain 1 (`C1–C21`): Admin Users, Roles Matrix + Diff Preview, Sessions, Audit CSV, Settings + Rollback, Kill Switches, Health & Quotas
 *   - Domain 2 (`C22–C40`): Live Dispatch Map/Board, Assign/Reassign/Unassign/Cancel/Force-Complete/ETA, Fleet Cash, Batches & SLA
 *   - Domain 3 (`C41–C54`): Zones, Circle Generator, Polygon Validator, **Kulaura 1-Tap Launch**, Fees, Weather Override & Fare Simulator
 *   - Domain 4 (`C55–C70`): 3-Track KYC Queue, **`ADR-0006 v2` 120s Private Signed URL + Audit**, Vendor 360, Moderation & Taxonomy
 */

import { createAdminPostgrestAdapter } from './db-postgrest.ts';
import {
  ADMIN_CORS_HEADERS,
  adminJsonErr,
  adminJsonOk,
  authenticateAdminRequest,
} from './http.ts';
import { handleDispatchControlRoutes } from './routes/dispatch-control.ts';
import { handleGovernanceRoutes } from './routes/governance.ts';
import { handleVendorsKycAndCatalogRoutes } from './routes/vendors-kyc.ts';
import { handleZonesAndPricingRoutes } from './routes/zones-pricing.ts';
import type { AdminWorkerEnv } from './types.ts';

export * from './db-postgrest.ts';
export * from './geo-polygon.ts';
export * from './http.ts';
export * from './rbac.ts';
export * from './totp.ts';
export * from './types.ts';

export default {
  async fetch(request: Request, env: AdminWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: ADMIN_CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return adminJsonOk(
        {
          service: env.SERVICE_NAME ?? 'undal-admin',
          capabilitiesTarget: 132,
          capabilitiesImplemented: 70,
          status: 'ok',
        },
        requestId,
      );
    }

    const nowMs = env.nowMs ? env.nowMs() : Date.now();
    const db = env.dbAdapter ?? createAdminPostgrestAdapter(env);

    const auth = await authenticateAdminRequest({
      request,
      requestId,
      env,
      db,
      nowMs,
      allowMissingTotpEnrollment: url.pathname === '/v1/admin/auth/totp/enroll',
    });
    if (!auth.ok) return auth.response;

    try {
      const ctx = {
        request,
        url,
        requestId,
        principal: auth.principal,
        ip: auth.ip,
        env,
        db,
        nowMs,
      };

      const gov = await handleGovernanceRoutes(ctx);
      if (gov) return gov;

      const dispatch = await handleDispatchControlRoutes(ctx);
      if (dispatch) return dispatch;

      const zones = await handleZonesAndPricingRoutes(ctx);
      if (zones) return zones;

      const vendors = await handleVendorsKycAndCatalogRoutes(ctx);
      if (vendors) return vendors;

      return adminJsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { path: url.pathname });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unexpected admin worker error';
      return adminJsonErr('SERVER_BUSY', requestId, { detail });
    }
  },
};
