/**
 * @file workers/admin/src/routes/dispatch-control.ts
 * @description Super Admin **Domain 2 · Live Dispatch & Logistics (`C22–C40`)** (`07-admin-registry-final.md`):
 *   - Multi-layer Live OSM Map & Zone SDR Shading (`C22–C24`)
 *   - Real-time Order Tower Kanban / Table / Exceptions-Only Filter (`C25–C27`)
 *   - Manual Assign, Reassign with Live `calculateRiderFare()` Recompute, Unassign,
 *     Step-Up Order Cancel, Step-Up Force-Complete & ETA Extension (`C28–C33`)
 *   - Active Fleet Telemetry, Street Cash Monitor, Force Session-End, Batch Break & SLA / Why-This-Rider (`C34–C40`)
 */

import { calculateRiderFare } from '@undal/shared-ts';
import { adminJsonErr, adminJsonOk, authorizeAdminCapability, readJsonBody } from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

export async function handleDispatchControlRoutes(params: {
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

  // --- C22–C24: Live Dispatch Map + Inspector ---
  if (method === 'GET' && path === '/v1/admin/dispatch/map') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.live_map', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getDispatchMapSnapshot(nowMs), requestId);
  }

  const entityMatch = path.match(/^\/v1\/admin\/dispatch\/entity\/(rider|vendor|order)\/([^/]+)$/);
  if (entityMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.live_map', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const found = await db.getDispatchEntityDetail(
      entityMatch[1] as 'rider' | 'vendor' | 'order',
      entityMatch[2]!,
    );
    if (!found) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(found, requestId);
  }

  // --- C25–C27: Order Tower Board (Kanban + Table + Exceptions Only) ---
  if (method === 'GET' && path === '/v1/admin/dispatch/board') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.order_tower', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const exceptionsOnly = url.searchParams.get('exceptions_only') === '1';
    const view = url.searchParams.get('view') === 'table' ? 'table' : 'kanban';
    const orders = await db.listDispatchBoard(exceptionsOnly, nowMs);
    return adminJsonOk({ view, exceptionsOnly, count: orders.length, orders }, requestId);
  }

  // --- C28 & C29: Manual Assign & Reassign with Live Fare Recompute ---
  const assignMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/(assign|reassign)$/);
  if (assignMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.interventions', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const orderId = assignMatch[1]!;
    const mode = assignMatch[2] as 'assign' | 'reassign';
    const body = await readJsonBody<{
      rider_id?: string;
      vehicle_type?: 'motorbike' | 'bicycle';
      to_vendor_km?: number;
      to_customer_km?: number;
      food_payable_after_discount_poisha?: number;
      reason?: string;
    }>(request);
    if (!body?.rider_id) return adminJsonErr('VALIDATION_FAILED', requestId, { required: 'rider_id' });

    let recomputedFarePoisha: number | null = null;
    if (mode === 'reassign' || body.to_customer_km !== undefined) {
      const policy = await db.getFarePolicyConfig();
      const computed = calculateRiderFare(
        {
          vehicleType: body.vehicle_type ?? 'motorbike',
          toVendorKm: body.to_vendor_km ?? 1.0,
          travelDistanceKm: body.to_customer_km ?? 2.5,
          orderFoodPayablePoisha: body.food_payable_after_discount_poisha ?? 30_000,
          activeOrdersInZone: 5,
          activeRidersInZone: 5,
          weatherCondition: 'clear',
          trafficDelayMinutes: 0,
          batchPosition: 1,
          isPriority: false,
        },
        policy,
      );
      recomputedFarePoisha = computed.riderFarePoisha;
    }

    const updated = await db.assignRiderToOrder(orderId, body.rider_id, recomputedFarePoisha, mode);
    if (!updated) return adminJsonErr('ORDER_STATE_ILLEGAL', requestId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: `dispatch.${mode}`,
      entityType: 'order',
      entityId: orderId,
      diff: updated,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated.after, requestId);
  }

  // --- C30: Unassign Rider Back to Auto-Dispatch Pool ---
  const unassignMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/unassign$/);
  if (unassignMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.interventions', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const orderId = unassignMatch[1]!;
    const body = await readJsonBody<{ reason?: string }>(request);
    const updated = await db.unassignRiderFromOrder(orderId);
    if (!updated) return adminJsonErr('ORDER_STATE_ILLEGAL', requestId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'dispatch.unassign',
      entityType: 'order',
      entityId: orderId,
      diff: { after: updated },
      reason: body?.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  // --- C31: Admin Order Cancel (`Step-Up TOTP✓`) ---
  const cancelMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/cancel$/);
  if (cancelMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.interventions', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const orderId = cancelMatch[1]!;
    const body = await readJsonBody<{ reason_key?: string; note?: string }>(request);
    const reasonKey = body?.reason_key ?? 'admin_fraud_suspected';
    const cancelled = await db.adminCancelOrder(orderId, reasonKey, nowMs);
    if (!cancelled) return adminJsonErr('ORDER_STATE_ILLEGAL', requestId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'dispatch.cancel',
      entityType: 'order',
      entityId: orderId,
      diff: cancelled,
      reason: body?.note ?? reasonKey,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(cancelled, requestId);
  }

  // --- C32: Admin Force-Complete Delivery with Evidence & Double-Entry Ledger Write (`Step-Up TOTP✓`) ---
  const forceCompleteMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/force-complete$/);
  if (forceCompleteMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.interventions', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const orderId = forceCompleteMatch[1]!;
    const body = await readJsonBody<{ evidence_public_id?: string; note?: string }>(request);
    if (!body?.evidence_public_id || !body.note) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { required: ['evidence_public_id', 'note'] });
    }
    const completed = await db.adminForceCompleteOrder(
      orderId,
      principal.profileId,
      body.evidence_public_id,
      body.note,
      nowMs,
    );
    if (!completed) return adminJsonErr('ORDER_STATE_ILLEGAL', requestId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'dispatch.force_complete',
      entityType: 'order',
      entityId: orderId,
      diff: completed,
      reason: body.note,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(completed, requestId);
  }

  // --- C33: Extend Prep Time / Promised ETA ---
  const etaMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/eta$/);
  if (etaMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.interventions', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const orderId = etaMatch[1]!;
    const body = await readJsonBody<{ extra_minutes?: number; reason?: string }>(request);
    const extra = Number(body?.extra_minutes ?? 10);
    if (!Number.isFinite(extra) || extra < 1 || extra > 120) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const updated = await db.updateOrderEta(orderId, Math.round(extra));
    if (!updated) return adminJsonErr('ORDER_STATE_ILLEGAL', requestId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'dispatch.eta',
      entityType: 'order',
      entityId: orderId,
      diff: updated,
      reason: body?.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  // --- C34–C36: Fleet Riders, Cash Monitor & Force Session-End ---
  if (method === 'GET' && path === '/v1/admin/fleet/riders') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.fleet', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ riders: await db.listFleetRiders(nowMs) }, requestId);
  }

  if (method === 'GET' && path === '/v1/admin/fleet/cash') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.fleet', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ balances: await db.listFleetCashBalances() }, requestId);
  }

  const endSessMatch = path.match(/^\/v1\/admin\/riders\/([^/]+)\/end-session$/);
  if (endSessMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.fleet', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const riderId = endSessMatch[1]!;
    const body = await readJsonBody<{ reason?: string }>(request);
    const ended = await db.forceEndRiderSession(riderId, nowMs);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'fleet.end_session',
      entityType: 'rider',
      entityId: riderId,
      diff: { ended, endedAtMs: nowMs },
      reason: body?.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ riderId, ended }, requestId);
  }

  // --- C37–C40: Active Batches, Break Batch, SLA Breaches & Why-This-Rider Offers Trace ---
  if (method === 'GET' && path === '/v1/admin/batches') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.batching', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ batches: await db.listActiveBatches() }, requestId);
  }

  const breakBatchMatch = path.match(/^\/v1\/admin\/batches\/([^/]+)\/break$/);
  if (breakBatchMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.batching', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const batchId = breakBatchMatch[1]!;
    const broken = await db.breakOrderBatch(batchId);
    if (!broken) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'dispatch.break_batch',
      entityType: 'order_batch',
      entityId: batchId,
      diff: broken,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(broken, requestId);
  }

  if (method === 'GET' && path === '/v1/admin/sla/breaches') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.sla', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ breaches: await db.listSlaBreaches(nowMs) }, requestId);
  }

  const traceMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/offers-trace$/);
  if (traceMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '2.sla', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ offers: await db.getOrderOffersTrace(traceMatch[1]!) }, requestId);
  }

  return null;
}
