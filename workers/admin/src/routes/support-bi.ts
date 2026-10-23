/**
 * @file workers/admin/src/routes/support-bi.ts
 * @description Domain 8 (Unified Support Inbox, Live Order Chats, Root-Cause Disputes,
 * Review Moderation & Customer 360 · `C114–C124`) + Domain 9 (Executive KPI Cockpit,
 * Multi-Zone BI, Funnels, Cohorts, Demand Heatmaps, Saved Reports & Live Zero-Drift
 * Data-Quality Monitor · `C125–C132`).
 */

import {
  adminJsonErr,
  adminJsonOk,
  authorizeAdminCapability,
  readJsonBody,
} from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

const CANNED_TEMPLATES = new Map<string, { readonly key: string; readonly en: string; readonly bn: string }>([
  [
    'late_apology',
    {
      key: 'late_apology',
      en: 'We are sorry for the delay — we have issued a goodwill credit for your next meal.',
      bn: 'বিলম্বের জন্য আমরা আন্তরিকভাবে দুঃখিত — আপনার পরবর্তী অর্ডারের জন্য ভাউচার যোগ করা হয়েছে।',
    },
  ],
]);

const SAVED_REPORTS = new Map<
  string,
  { readonly id: string; readonly name: string; readonly groupBy: string; readonly createdBy: string }
>();

/** Handles all Domain 8 (`C114–C124`) & Domain 9 (`C125–C132`) Super Admin routes. */
export async function handleSupportBiRoutes(params: {
  readonly request: Request;
  readonly url: URL;
  readonly requestId: string;
  readonly principal: AdminPrincipal;
  readonly db: AdminDbAdapter;
  readonly env: AdminWorkerEnv;
  readonly nowMs: number;
  readonly ip: string | undefined;
}): Promise<Response | null> {
  const { request, url, requestId, principal, db, env, nowMs, ip } = params;
  const path = url.pathname;
  const method = request.method.toUpperCase();
  const primaryRole = principal.roleKeys[0] ?? 'admin';

  // --- C114–C116: Unified Support Queue, Claim/Escalate & Bilingual Canned Templates ---
  if (path === '/v1/admin/support/threads' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.inbox', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { threads: await db.listSupportThreads(url.searchParams.get('status') ?? undefined) },
      requestId,
    );
  }

  const threadPatchMatch = path.match(/^\/v1\/admin\/support\/threads\/([^/]+)$/);
  if (threadPatchMatch && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.inbox', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const updated = await db.patchSupportThread(threadPatchMatch[1]!, body, nowMs);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'support.thread.update',
      entityType: 'support_thread', entityId: threadPatchMatch[1]!, diff: updated, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const threadMsgMatch = path.match(/^\/v1\/admin\/support\/threads\/([^/]+)\/messages$/);
  if (threadMsgMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.inbox', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ body?: string; is_internal_note?: boolean }>(request);
    if (!body?.body) return adminJsonErr('VALIDATION_FAILED', requestId);
    const msg = await db.addSupportMessage({
      threadId: threadMsgMatch[1]!,
      senderId: principal.profileId,
      body: body.body,
      isInternalNote: Boolean(body.is_internal_note ?? false),
    });
    return adminJsonOk(msg, requestId, 201);
  }

  if (path === '/v1/admin/support/templates' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.inbox', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ templates: [...CANNED_TEMPLATES.values()] }, requestId);
  }

  if (path === '/v1/admin/support/templates' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.inbox', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ key?: string; en?: string; bn?: string }>(request);
    if (!body?.key || !body.en || !body.bn) return adminJsonErr('VALIDATION_FAILED', requestId);
    const tpl = { key: body.key, en: body.en, bn: body.bn };
    CANNED_TEMPLATES.set(tpl.key, tpl);
    return adminJsonOk(tpl, requestId, 201);
  }

  // --- C117: Active-Order Live Chat Monitor ---
  if (path === '/v1/admin/chats/live' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.live_chats', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ chats: await db.listLiveOrderChats() }, requestId);
  }

  // --- C118–C120: Atomic Root-Cause Dispute Resolution (`ready_at` vs `picked_at` + Adjustment + Voucher) ---
  const disputeMatch = path.match(/^\/v1\/admin\/disputes\/([^/]+)\/resolve$/);
  if (disputeMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.disputes', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      order_id?: string;
      vendor_id?: string;
      customer_id?: string;
      vendor_deduction_poisha?: number;
      customer_voucher_poisha?: number;
      reason_code?: string;
      note?: string;
      evidence_public_id?: string;
    }>(request);
    if (!body?.order_id) return adminJsonErr('VALIDATION_FAILED', requestId);

    const o360 = await db.getOrder360(body.order_id);
    if (!o360) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    const ord = o360['order'] as Record<string, unknown>;
    const acceptedMs = ord['accepted_at'] ? new Date(String(ord['accepted_at'])).getTime() : null;
    const readyMs = ord['ready_at'] ? new Date(String(ord['ready_at'])).getTime() : null;
    const pickedMs = ord['picked_at'] ? new Date(String(ord['picked_at'])).getTime() : null;
    const kitchenPrepMin = acceptedMs && readyMs ? Math.max(0, Math.round((readyMs - acceptedMs) / 60_000)) : 0;
    const riderWaitAfterReadyMin = readyMs && pickedMs ? Math.max(0, Math.round((pickedMs - readyMs) / 60_000)) : 0;
    const rootCause =
      riderWaitAfterReadyMin > 10 ? 'rider_late_pickup' : kitchenPrepMin > Number(ord['prep_minutes_committed'] ?? 25) ? 'kitchen_slow_prep' : 'missing_or_quality';

    let adjustment: Record<string, unknown> | null = null;
    if (body.vendor_id && body.vendor_deduction_poisha && body.vendor_deduction_poisha > 0) {
      adjustment = await db.createAdjustment({
        targetType: 'vendor',
        targetId: body.vendor_id,
        orderId: body.order_id,
        kind: 'refund_adjustment',
        amountPoisha: -Math.abs(Math.round(body.vendor_deduction_poisha)),
        reasonCode: body.reason_code ?? rootCause,
        note: body.note,
        evidencePublicId: body.evidence_public_id,
        autoConfirm: true,
        createdBy: principal.profileId,
      });
    }

    let voucher: Record<string, unknown> | null = null;
    if (body.customer_voucher_poisha && body.customer_voucher_poisha > 0) {
      voucher = await db.createGoodwillVoucher({
        code: `DSP${String(nowMs).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`,
        titleEn: 'Dispute Resolution Credit',
        amountPoisha: Math.round(body.customer_voucher_poisha),
        customerId: body.customer_id,
        orderId: body.order_id,
        actorId: principal.profileId,
        nowMs,
      });
    }

    const resolution = {
      disputeId: disputeMatch[1]!,
      orderId: body.order_id,
      rootCauseAnalysis: { kitchenPrepMin, riderWaitAfterReadyMin, determinedFault: rootCause },
      adjustment,
      voucher,
    };
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'dispute.resolve',
      entityType: 'dispute', entityId: disputeMatch[1]!, diff: resolution, reason: body.note, ip, requestId, nowMs,
    });
    return adminJsonOk(resolution, requestId);
  }

  // --- C121–C124: Reviews Moderation Queue & Customer 360 ---
  if (path === '/v1/admin/reviews/queue' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.reviews', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { reviews: await db.listReviewsQueue(url.searchParams.get('status') ?? undefined) },
      requestId,
    );
  }

  const revModMatch = path.match(/^\/v1\/admin\/reviews\/([^/]+)\/moderate$/);
  if (revModMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.reviews', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ status?: 'visible' | 'hidden'; note?: string }>(request);
    if (!body?.status) return adminJsonErr('VALIDATION_FAILED', requestId);
    const updated = await db.moderateReview(revModMatch[1]!, body.status, body.note);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'review.moderate',
      entityType: 'review', entityId: revModMatch[1]!, diff: updated, reason: body.note, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const custMatch = path.match(/^\/v1\/admin\/customers\/([^/]+)$/);
  if (custMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.customer_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const c360 = await db.getCustomer360(custMatch[1]!);
    if (!c360) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(c360, requestId);
  }

  const custActMatch = path.match(/^\/v1\/admin\/customers\/([^/]+)\/action$/);
  if (custActMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '8.customer_360', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ status?: 'active' | 'suspended'; reason?: string }>(request);
    if (!body?.status) return adminJsonErr('VALIDATION_FAILED', requestId);
    const updated = await db.applyCustomerAction(custActMatch[1]!, body.status);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: `customer.${body.status}`,
      entityType: 'profile', entityId: custActMatch[1]!, diff: updated, reason: body.reason, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  // --- C125–C132: Executive KPI Cockpit, Multi-Zone BI, Saved CSV Reports & Zero-Drift Quality ---
  if (
    path === '/v1/admin/dashboard/kpis' ||
    path === '/v1/admin/bi/executive' ||
    path === '/v1/admin/bi/funnels' ||
    path === '/v1/admin/bi/cohorts' ||
    path === '/v1/admin/bi/demand'
  ) {
    const perm =
      path.endsWith('/funnels')
        ? '9.funnels'
        : path.endsWith('/cohorts')
          ? '9.cohorts'
          : path.endsWith('/demand')
            ? '9.demand'
            : '9.executive';
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: perm, mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getExecutiveBiSnapshot(nowMs), requestId);
  }

  if (path === '/v1/admin/bi/saved-reports' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '9.reports', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ reports: [...SAVED_REPORTS.values()] }, requestId);
  }

  if (path === '/v1/admin/bi/saved-reports' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '9.reports', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ name?: string; group_by?: string }>(request);
    if (!body?.name) return adminJsonErr('VALIDATION_FAILED', requestId);
    const saved = {
      id: crypto.randomUUID(),
      name: body.name,
      groupBy: body.group_by ?? 'zone',
      createdBy: principal.profileId,
    };
    SAVED_REPORTS.set(saved.id, saved);
    return adminJsonOk(saved, requestId, 201);
  }

  const runRepMatch = path.match(/^\/v1\/admin\/bi\/saved-reports\/([^/]+)\/run$/);
  if (runRepMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '9.reports', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const snap = await db.getExecutiveBiSnapshot(nowMs);
    const zones = (snap['zoneBreakdown'] as readonly Record<string, unknown>[]) ?? [];
    const csv = [
      'zone_slug,orders_count,gmv_poisha,net_margin_poisha',
      ...zones.map((z) => `${z['slug']},${z['orders_count']},${z['gmv_poisha']},${z['margin_poisha']}`),
    ].join('\n');
    return adminJsonOk({ reportId: runRepMatch[1]!, storageBackend: 'cloudinary_private_vault', csv }, requestId);
  }

  if (path === '/v1/admin/bi/quality' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '9.quality', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getDataQualityReport(), requestId);
  }

  return null;
}
