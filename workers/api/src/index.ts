/**
 * @file workers/api/src/index.ts
 * @description Production Entrypoint for `W1 undal-api` Cloudflare Worker (`Build Responses 6–7` — Complete).
 *
 * Route Domains Registered (`100%` of `File 06 §1` `W1 undal-api` contract):
 *   1. `routes/catalog.ts`   — `/healthz`, `/v1/config/public`, `/v1/zones/resolve`, `/v1/home/feed`,
 *                              `/v1/vendors/:slug`, `/menu`, `/reviews`, `/v1/search`, `/v1/seo/sitemap-data`,
 *                              `/v1/tiles/:z/:x/:y.png` (`30d` OSM Edge Cache)
 *   2. `routes/media.ts`     — `ADR-0006 v2` Dual Free Media Law (`POST /v1/images/public` -> Unlimited ImgBB;
 *                              `POST /v1/images/private-upload-url` & `private-view-url` -> Cloudinary Private Vault)
 *   3. `routes/account.ts`   — `/v1/me`, `/v1/addresses`, `/v1/favourites/:vendorId`, `/v1/devices/token`, `/v1/notifications`
 *   4. `routes/cart.ts`      — `/v1/cart`, `/v1/cart/items`, `/v1/cart/voucher`, `/v1/cart/validate` (`price_order`)
 *   5. `routes/orders.ts`    — `POST /v1/orders` (`place_order` + `W2` HMAC webhook), `GET /v1/orders*`, `/live` (`ETag`),
 *                              full 14-state transitions, GPS geofences, HMAC QR handover, `HOME_KITCHEN` address shield
 *   6. `routes/social.ts`    — `/v1/orders/:id/review`, `/v1/reviews/:id/reply`, `/v1/chats/:orderId/messages` (`24h` lock),
 *                              `/v1/support/threads*`
 *   7. `routes/operators.ts` — `/v1/partner/*` (store, menu CRUD, KYC, finance) & `/v1/rider/*` (KYC, `TrxID` remittances, finance)
 */

import { createPostgrestDbAdapter } from './db-postgrest.ts';
import { mapDomainErrorToResponse } from './domain-errors.ts';
import { CORS_HEADERS, authenticateRequest, checkRateLimit, clientIp, jsonErr } from './http.ts';
import { handleAccountRoute } from './routes/account.ts';
import { handleCartRoute } from './routes/cart.ts';
import { handleCatalogRoute } from './routes/catalog.ts';
import { handleMediaRoute } from './routes/media.ts';
import { handleOperatorsRoute } from './routes/operators.ts';
import { handleOrdersRoute } from './routes/orders.ts';
import { handleSocialRoute } from './routes/social.ts';
import type { ApiWorkerEnv } from './types.ts';

export type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal, OrderAccessContext, StoredMediaAssetRow } from './types.ts';
export { resetRateLimitBuckets } from './http.ts';
export { computePickupQrTokenHex, haversineMeters } from './domain-errors.ts';

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

      const cartRes = await handleCartRoute(request, url, db, auth.principal, requestId);
      if (cartRes) return cartRes;

      const ordersRes = await handleOrdersRoute(request, url, env, db, auth.principal, requestId);
      if (ordersRes) return ordersRes;

      const socialRes = await handleSocialRoute(request, url, db, auth.principal, requestId);
      if (socialRes) return socialRes;

      const operatorsRes = await handleOperatorsRoute(request, url, db, auth.principal, requestId);
      if (operatorsRes) return operatorsRes;

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
    } catch (err) {
      return mapDomainErrorToResponse(err, requestId);
    }
  },
};
