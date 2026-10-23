/**
 * @file workers/api/src/routes/catalog.ts
 * @description Public catalog, `rank_v1` home feed, privacy-redacted storefronts, Banglish search,
 * SSG SEO sitemap feed, and 30-day cached OpenStreetMap tile proxy for `W1 undal-api` (`Build Response 6`).
 */

import { CORS_HEADERS, jsonErr, jsonOk } from '../http.ts';
import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal } from '../types.ts';

function parseCoordinatePair(url: URL): { readonly lat: number; readonly lng: number } | null {
  const rawLat = url.searchParams.get('lat');
  const rawLng = url.searchParams.get('lng');
  if (rawLat === null || rawLng === null) return null;
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return null;
  }
  return { lat, lng };
}

/** Handles all public catalog, zone, search, SEO, and OSM tile routes on `W1 undal-api`. */
export async function handleCatalogRoute(
  request: Request,
  url: URL,
  env: ApiWorkerEnv,
  db: ApiDbAdapter,
  principal: AuthPrincipal | null,
  requestId: string,
): Promise<Response | null> {
  if (request.method !== 'GET') return null;
  const path = url.pathname;

  if (path === '/healthz') {
    let dbHealthy = false;
    try {
      dbHealthy = await db.ping();
    } catch {
      dbHealthy = false;
    }
    return jsonOk(
      {
        service: env.SERVICE_NAME ?? 'undal-api',
        environment: env.ENVIRONMENT ?? 'development',
        status: 'ok',
        db_reachable: dbHealthy,
        storage_law: {
          public_images: 'imgbb_unlimited',
          sensitive_compliance_only: 'cloudinary_private_vault',
          supabase_storage_bytes: 0,
        },
      },
      requestId,
    );
  }

  if (path === '/v1/config/public') {
    const settings = await db.getPublicSettings();
    return jsonOk({ settings }, requestId, 200, {
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    });
  }

  if (path === '/v1/zones/resolve') {
    const coords = parseCoordinatePair(url);
    if (!coords) {
      return jsonErr('LOCATION_REQUIRED', requestId, { hint: 'Query parameters lat and lng are required.' });
    }
    const zone = await db.resolveZone(coords.lat, coords.lng);
    return jsonOk(zone, requestId, 200, {
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    });
  }

  if (path === '/v1/home/feed') {
    const coords = parseCoordinatePair(url);
    if (!coords) {
      return jsonErr('LOCATION_REQUIRED', requestId, { hint: 'Query parameters lat and lng are required.' });
    }
    const modeRaw = url.searchParams.get('mode') ?? 'delivery';
    if (modeRaw !== 'delivery' && modeRaw !== 'pickup') {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'mode' });
    }
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20') || 20, 1), 50);
    const offset = Math.max(Number(url.searchParams.get('cursor') ?? '0') || 0, 0);
    const cuisine = url.searchParams.get('cuisine')?.trim() || null;
    const sort = url.searchParams.get('sort')?.trim() || 'recommended';

    const payload = await db.getHomeFeed({
      lat: coords.lat,
      lng: coords.lng,
      fulfilment: modeRaw,
      cuisine,
      sort,
      limit,
      offset,
    });
    const cacheHeader = principal ? 'private, no-store' : 'public, max-age=15, s-maxage=30';
    return jsonOk(
      {
        ...payload.feed,
        banners: payload.banners,
        flash_campaigns: payload.flashCampaigns,
        next_cursor: Array.isArray(payload.feed.vendors) && payload.feed.vendors.length === limit ? String(offset + limit) : null,
      },
      requestId,
      200,
      { 'Cache-Control': cacheHeader },
    );
  }

  const vendorMatch = /^\/v1\/vendors\/([a-z0-9][a-z0-9-]{1,80})(?:\/(menu|reviews))?$/.exec(path);
  if (vendorMatch) {
    const slug = vendorMatch[1]!;
    const subroute = vendorMatch[2];
    if (!subroute) {
      const vendor = await db.getVendorHeader(slug);
      if (!vendor) return jsonErr('VALIDATION_FAILED', requestId, { slug, reason: 'VENDOR_NOT_FOUND' });
      return jsonOk({ vendor }, requestId, 200, { 'Cache-Control': 'public, max-age=15, s-maxage=30' });
    }
    if (subroute === 'menu') {
      const storefront = await db.getVendorMenuDetail(slug);
      if (!storefront) return jsonErr('VALIDATION_FAILED', requestId, { slug, reason: 'VENDOR_NOT_FOUND' });
      return jsonOk(storefront, requestId, 200, { 'Cache-Control': 'public, max-age=15, s-maxage=30' });
    }
    if (subroute === 'reviews') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20') || 20, 1), 50);
      const cursor = url.searchParams.get('cursor');
      const reviews = await db.getVendorReviews(slug, limit, cursor);
      const last = reviews[reviews.length - 1];
      return jsonOk(
        {
          reviews,
          next_cursor: reviews.length === limit && typeof last?.created_at === 'string' ? last.created_at : null,
        },
        requestId,
        200,
        { 'Cache-Control': 'public, max-age=30, s-maxage=60' },
      );
    }
  }

  if (path === '/v1/search') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 1 || q.length > 120) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'q' });
    }
    const coords = parseCoordinatePair(url);
    if (!coords) {
      return jsonErr('LOCATION_REQUIRED', requestId);
    }
    const modeRaw = url.searchParams.get('mode') === 'pickup' ? 'pickup' : 'delivery';
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '20') || 20, 1), 50);
    const results = await db.searchCatalog({
      query: q,
      lat: coords.lat,
      lng: coords.lng,
      fulfilment: modeRaw,
      limit,
    });
    return jsonOk({ query: q, count: results.length, results }, requestId);
  }

  if (path === '/v1/seo/sitemap-data') {
    const seo = await db.getSeoSitemapData();
    return jsonOk(seo, requestId, 200, { 'Cache-Control': 'public, max-age=300, s-maxage=900' });
  }

  // 30-day Cloudflare Edge OSM Tile Proxy (`File 14 §14.1`: prevents raw OSM scraping & adds mandatory User-Agent)
  const tileMatch = /^\/v1\/tiles\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/.exec(path);
  if (tileMatch) {
    const z = Number(tileMatch[1]);
    const x = Number(tileMatch[2]);
    const y = Number(tileMatch[3]);
    const maxCoord = 1 << z;
    if (z > 19 || x >= maxCoord || y >= maxCoord) {
      return jsonErr('VALIDATION_FAILED', requestId, { reason: 'TILE_OUT_OF_RANGE' });
    }
    const fetcher = env.__fetchImpl ?? fetch;
    const upstream = await fetcher(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, {
      headers: {
        'User-Agent': 'UndalFoodBD/1.0 (+https://undal.app; contact: ops@undal.app)',
      },
    });
    if (!upstream.ok) {
      return jsonErr('SERVER_BUSY', requestId, { upstream_status: upstream.status });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, immutable',
        'X-Request-Id': requestId,
      },
    });
  }

  return null;
}
