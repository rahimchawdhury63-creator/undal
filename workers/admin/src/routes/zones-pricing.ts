/**
 * @file workers/admin/src/routes/zones-pricing.ts
 * @description Super Admin **Domain 3 · Geofencing & Dynamic Pricing (`C41–C54`)** (`07-admin-registry-final.md`):
 *   - Delivery Zones CRUD, 1-Click Circle Polygon Generator (`C42`), **Kulaura 1-Tap Activation (`C43`)**,
 *     and Polygon Self-Intersection & Overlap Validator (`C44`)
 *   - Per-Zone Delivery Fee Tiers & Free-Delivery Thresholds (`C45–C46`, `Step-Up TOTP✓`)
 *   - Vehicle Fare Rates, SDR Surge Bands, Weather Override, Traffic & Batch/Wait Rules (`C48–C52`, `C54`)
 *   - Live Interactive **Fare Simulator** (`C53`) executing canonical `@undal/shared-ts` `calculateRiderFare()`
 */

import { calculateRiderFare } from '@undal/shared-ts';
import { generateCirclePolygon, validateZonePolygon, type LngLatPair } from '../geo-polygon.ts';
import { adminJsonErr, adminJsonOk, authorizeAdminCapability, readJsonBody } from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

export async function handleZonesAndPricingRoutes(params: {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly principal: AdminPrincipal;
  readonly ip: string;
  readonly env: AdminWorkerEnv;
  readonly db: AdminDbAdapter;
  readonly nowMs: number;
}): Promise<Response | null> {
  const { request, url, requestId, principal, ip, env, db, nowMs } = params;
  const path = url.pathname;
  const method = request.method;
  const primaryRole = principal.roleKeys[0] ?? 'admin';

  // --- C41: List & Create Delivery Zone ---
  if (path === '/v1/admin/zones' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.zones', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ zones: await db.listZonesAdmin() }, requestId);
  }

  if (path === '/v1/admin/zones' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.zones', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      name_en?: string;
      name_bn?: string;
      slug?: string;
      polygon?: LngLatPair[];
      road_factor?: number;
      is_active?: boolean;
      fee_overrides?: Record<string, unknown>;
      config?: Record<string, unknown>;
    }>(request);
    if (!body?.name_en || !body.name_bn || !body.slug || !Array.isArray(body.polygon)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const existing = await db.listZonesAdmin();
    const check = validateZonePolygon({ polygon: body.polygon, existingZones: existing });
    if (!check.valid) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { geometry: check });
    }
    const created = await db.createZoneAdmin({
      nameEn: body.name_en,
      nameBn: body.name_bn,
      slug: body.slug,
      polygon: body.polygon,
      roadFactor: Number(body.road_factor ?? 1.35),
      isActive: Boolean(body.is_active),
      feeOverrides: body.fee_overrides ?? {},
      config: body.config ?? {},
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'zone.create',
      entityType: 'zone',
      entityId: String(created['id']),
      diff: { after: created, areaKm2: check.areaKm2 },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(created, requestId, 201);
  }

  // --- C42: 1-Click N-Point Circle Polygon Preview ---
  if (path === '/v1/admin/zones/circle-preview' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.zones', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      center_lat?: number;
      center_lng?: number;
      radius_km?: number;
      vertices?: number;
    }>(request);
    if (
      typeof body?.center_lat !== 'number' ||
      typeof body.center_lng !== 'number' ||
      typeof body.radius_km !== 'number' ||
      body.radius_km <= 0.2 ||
      body.radius_km > 50
    ) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const polygon = generateCirclePolygon({
      centerLat: body.center_lat,
      centerLng: body.center_lng,
      radiusKm: body.radius_km,
      ...(body.vertices !== undefined ? { vertices: body.vertices } : {}),
    });
    return adminJsonOk({ polygon, vertexCount: polygon.length }, requestId);
  }

  // --- C44: Polygon Self-Intersection & Cross-Zone Overlap Validator ---
  if (path === '/v1/admin/zones/validate' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.zones', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ polygon?: LngLatPair[]; exclude_zone_id?: string }>(request);
    if (!Array.isArray(body?.polygon)) return adminJsonErr('VALIDATION_FAILED', requestId);
    const existing = await db.listZonesAdmin();
    return adminJsonOk(
      validateZonePolygon({
        polygon: body.polygon,
        existingZones: existing,
        excludeZoneId: body.exclude_zone_id,
      }),
      requestId,
    );
  }

  // --- C45 & C46: Per-Zone Customer Delivery Fee Tiers & Free-Delivery Threshold (`Step-Up TOTP✓`) ---
  const zoneFeesMatch = path.match(/^\/v1\/admin\/zones\/([^/]+)\/fees$/);
  if (zoneFeesMatch && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.delivery_fees', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const zoneId = zoneFeesMatch[1]!;
    const body = await readJsonBody<{
      tiers_poisha?: readonly { max_km: number; fee_poisha: number }[];
      free_delivery_min_poisha?: number | null;
      reason?: string;
    }>(request);
    if (!body) return adminJsonErr('VALIDATION_FAILED', requestId);
    if (body.tiers_poisha !== undefined) {
      if (!Array.isArray(body.tiers_poisha) || body.tiers_poisha.length > 20) {
        return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'invalid_fee_tiers' });
      }
      let lastKm = 0;
      for (const tier of body.tiers_poisha) {
        if (!Number.isFinite(tier.max_km) || tier.max_km <= lastKm || !Number.isSafeInteger(tier.fee_poisha) || tier.fee_poisha < 0) {
          return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'tiers_require_sorted_distance_and_integer_fee' });
        }
        lastKm = tier.max_km;
      }
    }
    if (body.free_delivery_min_poisha != null &&
      (!Number.isSafeInteger(body.free_delivery_min_poisha) || body.free_delivery_min_poisha < 0)) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'free_delivery_min_must_be_integer_poisha' });
    }
    const updated = await db.updateZoneAdmin(zoneId, { fee_overrides: body });
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'pricing.delivery_tiers',
      entityType: 'zone',
      entityId: zoneId,
      diff: updated,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated.after, requestId);
  }

  // --- C50: Manual Per-Zone Rain / Storm Weather Override ---
  const weatherOverrideMatch = path.match(/^\/v1\/admin\/zones\/([^/]+)\/weather-override$/);
  if (weatherOverrideMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.fare_engine', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const zoneId = weatherOverrideMatch[1]!;
    const body = await readJsonBody<{
      condition?: 'clear' | 'extreme_heat' | 'rain' | 'storm';
      ttl_minutes?: number;
      reason?: string;
    }>(request);
    if (!body?.condition || !['clear', 'extreme_heat', 'rain', 'storm'].includes(body.condition)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const saved = await db.setZoneWeatherOverride(
      zoneId,
      body.condition,
      Math.min(720, Math.max(5, Number(body.ttl_minutes ?? 60))),
      nowMs,
    );
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'fare.weather_override',
      entityType: 'weather_cache',
      entityId: zoneId,
      diff: { after: saved },
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(saved, requestId);
  }

  // --- C43 & C54: Edit Zone Vertices, Activate/Pause (Kulaura 1-Tap Launch!) & Radii (`Step-Up TOTP✓`) ---
  const zonePatchMatch = path.match(/^\/v1\/admin\/zones\/([^/]+)$/);
  if (zonePatchMatch && method === 'PATCH') {
    const body = await readJsonBody<{
      name_en?: string;
      name_bn?: string;
      polygon?: LngLatPair[];
      road_factor?: number;
      is_active?: boolean;
      config?: Record<string, unknown>;
      reason?: string;
    }>(request);
    if (!body) return adminJsonErr('VALIDATION_FAILED', requestId);
    const perm = body.config && Object.keys(body).every((k) => k === 'config' || k === 'reason')
      ? '3.radii'
      : '3.zones';
    const deny = await authorizeAdminCapability({
      request,
      requestId,
      principal,
      permission: perm,
      mode: 'write',
      requireStepUp: perm === '3.zones',
      env,
      nowMs,
    });
    if (deny) return deny;

    const zoneId = zonePatchMatch[1]!;
    if (Array.isArray(body.polygon)) {
      const existing = await db.listZonesAdmin();
      const check = validateZonePolygon({
        polygon: body.polygon,
        existingZones: existing,
        excludeZoneId: zoneId,
      });
      if (!check.valid) return adminJsonErr('VALIDATION_FAILED', requestId, { geometry: check });
    }
    const updated = await db.updateZoneAdmin(zoneId, body);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: perm === '3.radii' ? 'zone.radii' : 'zone.update',
      entityType: 'zone',
      entityId: zoneId,
      diff: updated,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated.after, requestId);
  }

  // --- C48, C49, C51, C52: Dynamic Rider Fare Engine Parameters (`Step-Up TOTP✓`) ---
  if (path === '/v1/admin/fare-config' && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.fare_engine', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ updates?: Record<string, number>; reason?: string }>(request);
    if (!body?.updates || Object.keys(body.updates).length === 0) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    for (const [k, v] of Object.entries(body.updates)) {
      if (!k.startsWith('fare.') || typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        return adminJsonErr('VALIDATION_FAILED', requestId, { invalidKey: k });
      }
      if (k === 'fare.surge_severe_cap' && v > 2.5) {
        return adminJsonErr('VALIDATION_FAILED', requestId, { invalidKey: k });
      }
    }
    const diff = await db.updatePlatformSettings(body.updates, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'fare.config.update',
      entityType: 'platform_settings',
      entityId: Object.keys(body.updates).join(','),
      diff,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(diff, requestId);
  }

  // --- C53: Live Interactive Fare Simulator ---
  if (path === '/v1/admin/fare/simulate' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '3.fare_engine', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      vehicle?: 'motorbike' | 'bicycle';
      to_vendor_km?: number;
      to_customer_km?: number;
      food_payable_after_discount_poisha?: number;
      active_orders_in_zone?: number;
      active_riders_in_zone?: number;
      weather?: 'clear' | 'extreme_heat' | 'rain' | 'storm';
      traffic_delay_minutes?: number;
      batch_index?: number;
      priority?: boolean;
    }>(request);
    const policy = await db.getFarePolicyConfig();
    const breakdown = calculateRiderFare(
      {
        vehicleType: body?.vehicle ?? 'motorbike',
        toVendorKm: Number(body?.to_vendor_km ?? 1.2),
        travelDistanceKm: Number(body?.to_customer_km ?? 3.4),
        orderFoodPayablePoisha: Math.round(Number(body?.food_payable_after_discount_poisha ?? 40_000)),
        activeOrdersInZone: Math.round(Number(body?.active_orders_in_zone ?? 5)),
        activeRidersInZone: Math.round(Number(body?.active_riders_in_zone ?? 5)),
        weatherCondition: body?.weather ?? 'clear',
        trafficDelayMinutes: Number(body?.traffic_delay_minutes ?? 0),
        batchPosition: Math.round(Number(body?.batch_index ?? 1)),
        isPriority: Boolean(body?.priority ?? false),
      },
      policy,
    );
    return adminJsonOk({ policy, breakdown }, requestId);
  }

  return null;
}
