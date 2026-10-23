/**
 * @file workers/api/src/index.ts
 * @description Entrypoint shell for `W1 undal-api` Cloudflare Worker (`Build Response 1`).
 * Full catalog, search, ImgBB proxy, signed URLs, cart & COD order routes land in `Build Responses 6–7`.
 */

import { errEnvelope, okEnvelope } from '@undal/shared-ts';

export interface ApiWorkerEnv {
  readonly SERVICE_NAME?: string;
  readonly ENVIRONMENT?: string;
}

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
};

/** Handles HTTP requests arriving at `W1 undal-api`. */
export default {
  async fetch(request: Request, env: ApiWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json(
        okEnvelope(
          {
            service: env.SERVICE_NAME ?? 'undal-api',
            environment: env.ENVIRONMENT ?? 'development',
            status: 'ok',
          },
          requestId,
        ),
        { status: 200, headers: CORS_HEADERS },
      );
    }

    const notFound = errEnvelope('VALIDATION_FAILED', requestId, {
      path: url.pathname,
      hint: 'Route not registered on W1 undal-api',
    });
    return Response.json(notFound.body, {
      status: 404,
      headers: CORS_HEADERS,
    });
  },
};
