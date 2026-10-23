/**
 * @file workers/admin/src/index.ts
 * @description Production `W3 undal-admin` Cloudflare Worker Entrypoint (**100.0% COMPLETE** —
 * `Build Responses 10–11` · **All `132 / 132` P0 Super Admin Capabilities (`C1..C132`) across
 * Domains `1–9` + All `4` Scheduled Cron Triggers**):
 *   - 4-Gate Security Middleware (`JWT` -> `admin + active + TOTP enrolled` -> `RBAC` -> `5m Step-Up`)
 *   - Domain 1 (`C1–C21`): Governance, Admin Users/Roles, Session Revocation, Audit CSV, Settings Rollback, Kill Switches, Quotas
 *   - Domain 2 (`C22–C40`): Live Dispatch Map/Board, Assign/Reassign/Unassign/Cancel/Force-Complete/ETA, Fleet Cash, Batches
 *   - Domain 3 (`C41–C54`): Zones, Circle Generator, Polygon Validator, **Kulaura 1-Tap Launch**, Fees, Weather Override & Fare Sim
 *   - Domain 4 (`C55–C70`): 3-Track KYC Queue, **`ADR-0006 v2` 120s Private Signed URL + Audit**, Vendor 360, Moderation & Taxonomy
 *   - Domain 5 (`C71–C89`): Weekly Settlement Invoices (strict verifier ≠ payer dual-control), TrxID Cash Remittances, Adjustments & Reports
 *   - Domain 6 (`C90–C101`): Order 360 Deep Replay, Automated Exceptions, Mid-Order Modify, Goodwill Vouchers & Global Search
 *   - Domain 7 (`C102–C113`): Zero-Ads Growth Engine (`D-11` Flash Box, Campaigns, Vouchers, `ImgBB` Banners, Referrals & Nudges)
 *   - Domain 8 (`C114–C124`): Unified Support Inbox, Live Chats, Root-Cause Disputes, Review Moderation & Customer 360
 *   - Domain 9 (`C125–C132`): Executive KPI Cockpit, Multi-Zone BI, Funnels/Cohorts/Demand, Saved CSV Reports & Zero-Drift Quality
 *   - Scheduled Crons (`scheduled`): `5 18 * * 4` (Fri Rider Settlement), `5 18 * * 5` (Sat Vendor Settlement),
 *     `30 20 * * *` (Nightly Free-Tier Quota Prune), `0 * * * *` (Hourly MET Norway Weather Sync)
 */

import { type AdminCronRunResult, runAdminScheduledCron } from './cron.ts';
import { createAdminPostgrestAdapter } from './db-postgrest.ts';
import {
  ADMIN_CORS_HEADERS,
  adminJsonErr,
  adminJsonOk,
  authenticateAdminRequest,
} from './http.ts';
import { handleDispatchControlRoutes } from './routes/dispatch-control.ts';
import { handleFinanceSettlementRoutes } from './routes/finance-settlement.ts';
import { handleGovernanceRoutes } from './routes/governance.ts';
import { handleOrdersGrowthRoutes } from './routes/orders-growth.ts';
import { handleSupportBiRoutes } from './routes/support-bi.ts';
import { handleVendorsKycAndCatalogRoutes } from './routes/vendors-kyc.ts';
import { handleZonesAndPricingRoutes } from './routes/zones-pricing.ts';
import type { AdminWorkerEnv } from './types.ts';

export * from './cron.ts';
export * from './db-postgrest.ts';
export * from './geo-polygon.ts';
export * from './http.ts';
export * from './rbac.ts';
export * from './totp.ts';
export * from './types.ts';
export * from './types-part2.ts';

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
          capabilitiesImplemented: 132,
          scheduledCrons: 4,
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

      for (const handler of [
        handleGovernanceRoutes,
        handleDispatchControlRoutes,
        handleZonesAndPricingRoutes,
        handleVendorsKycAndCatalogRoutes,
        handleFinanceSettlementRoutes,
        handleOrdersGrowthRoutes,
        handleSupportBiRoutes,
      ]) {
        const res = await handler(ctx);
        if (res) return res;
      }

      return adminJsonErr('AUTH_FORBIDDEN_PERMISSION', requestId, { path: url.pathname });
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unexpected admin worker error';
      return adminJsonErr('SERVER_BUSY', requestId, { detail });
    }
  },

  async scheduled(
    controller: { readonly cron: string; readonly scheduledTime?: number },
    env: AdminWorkerEnv,
  ): Promise<AdminCronRunResult> {
    const db = env.dbAdapter ?? createAdminPostgrestAdapter(env);
    return runAdminScheduledCron({
      cron: controller.cron,
      scheduledTimeMs: controller.scheduledTime,
      db,
      env,
    });
  },
};
