/**
 * @file workers/api/src/index.ts
 * @description Production Entrypoint for `W1 undal-api` Cloudflare Worker (`Build Response 6` — Part 1 Complete).
 *
 * Implemented in Part 1 (`Build Response 6`):
 *   - `GET /healthz`, `GET /v1/config/public`, `GET /v1/zones/resolve`, `GET /v1/home/feed` (`rank_v1`),
 *     `GET /v1/vendors/:slug`, `GET /v1/vendors/:slug/menu`, `GET /v1/vendors/:slug/reviews`,
 *     `GET /v1/search` (EN + বাংলা + Banglish + zero-PII search telemetry), `GET /v1/seo/sitemap-data`,
 *     `GET /v1/tiles/:z/:x/:y.png` (`30d` OSM Edge Cache with mandatory `User-Agent`)
 *   - Strict Dual-Provider Free Media Storage (`ADR-0006` v2):
 *       * `POST /v1/images/public` -> **Unlimited Free ImgBB** (`100%` of public & platform images, Edge EXIF/GPS strip)
 *       * `POST /v1/images/private-upload-url` -> **Cloudinary Private Vault ONLY** (`vendor_kyc`, `rider_kyc`, etc.)
 *       * `POST /v1/images/private-view-url` -> `120s` signed URL + mandatory `audit_logs` write
 *   - `GET/PATCH /v1/me`, `POST /v1/devices/token`, `GET /v1/notifications`, `PATCH /v1/notifications/read`
 *   - Cart, COD `place_order`, order lifecycle transitions, QR handover, chat & reviews land in `Build Response 7`.
 */

import { createPostgrestDbAdapter } from './db-postgrest.ts';
import { CORS_HEADERS, authenticateRequest, checkRateLimit, clientIp, jsonErr } from './http.ts';
import { handleAccountRoute } from './routes/account.ts';
import { handleCatalogRoute } from './routes/catalog.ts';
import { handleMediaRoute } from './routes/media.ts';
import type { ApiWorkerEnv } from './types.ts';

export type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal, StoredMediaAssetRow } from './types.ts';
export { resetRateLimitBuckets } from './http.ts';

/** Main Cloudflare Worker request handler for `W1 undal-api`. */
export default {
  async fetch(request: Request, env: ApiWorkerEnv): Promise<Response> {
    const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const ip = clientIp(request);

    const ipRate = checkRateLimit(`ip:${ip}:${request.method}`, 120, 60_000);
    if (!ipRate.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, {
        'Retry-After': String(ipRate.retryAfterSeconds),
      });
    }

    const db = env.__dbAdapter ?? createPostgrestDbAdapter(env);
    const auth = await authenticateRequest(request, env, db);
    if (auth.errorCode) {
      return jsonErr(auth.errorCode, requestId);
    }

    try {
      const catalogRes = await handleCatalogRoute(request, url, env, db, auth.principal, requestId);
      if (catalogRes) return catalogRes;

      const mediaRes = await handleMediaRoute(request, url, env, db, auth.principal, requestId);
      if (mediaRes) return mediaRes;

      const accountRes = await handleAccountRoute(request, url, db, auth.principal, requestId);
      if (accountRes) return accountRes;

      return jsonErr(
        'VALIDATION_FAILED',
        requestId,
        {
          path: url.pathname,
          hint: 'Route not registered on W1 undal-api',
        },
        undefined,
        404,
      );
    } catch {
      return jsonErr('SERVER_BUSY', requestId);
    }
  },
};
