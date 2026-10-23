/**
 * @file workers/admin/src/index.ts
 * @description Entrypoint shell for `W3 undal-admin` Cloudflare Worker (`Build Response 1`).
 * Full 132-capability RBAC + Step-Up TOTP endpoints & Friday/Saturday settlement crons land in `Build 10–11`.
 */

import { errEnvelope, okEnvelope } from '@undal/shared-ts';

export interface AdminWorkerEnv {
  readonly SERVICE_NAME?: string;
}

export default {
  async fetch(request: Request, env: AdminWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json(
        okEnvelope(
          {
            service: env.SERVICE_NAME ?? 'undal-admin',
            capabilitiesTarget: 132,
            status: 'ok',
          },
          requestId,
        ),
      );
    }

    const notFound = errEnvelope('AUTH_FORBIDDEN_PERMISSION', requestId, { path: url.pathname });
    return Response.json(notFound.body, { status: notFound.status });
  },
};
