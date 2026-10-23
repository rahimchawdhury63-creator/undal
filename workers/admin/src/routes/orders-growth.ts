/**
 * @file workers/admin/src/routes/orders-growth.ts
 * @description Domain 6 (Order 360, Exceptions, Mid-Order Modify & Global Search · `C90–C101`) +
 * Domain 7 (Zero-Ads Growth Engine: Flash Box, Campaigns, Vouchers, ImgBB Banners, Referrals &
 * Bilingual Lifecycle Nudges · `C102–C113`):
 *   - Strict constitutional enforcement of `D-11` (**ZERO paid ranking ads anywhere**; vendors are
 *     never enrolled into discounts without explicit `campaign_vendors` opt-in)
 *   - Strict enforcement of `ADR-0006 v2` (`POST /v1/admin/banners` accepts ONLY public `ImgBB`
 *     HTTPS URLs — never Supabase Storage and never Cloudinary private vault URLs)
 */

import {
  adminJsonErr,
  adminJsonOk,
  authorizeAdminCapability,
  readJsonBody,
} from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

const NUDGE_DRAFTS = new Map<
  string,
  {
    readonly id: string;
    readonly titleEn: string;
    readonly titleBn: string;
    readonly bodyEn: string;
    readonly bodyBn: string;
    readonly maxPerWeek: number;
    readonly recipientIds: readonly string[];
  }
>();

const RESOLVED_EXCEPTIONS = new Map<string, Record<string, unknown>>();

/** Handles all Domain 6 (`C90–C101`) & Domain 7 (`C102–C113`) Super Admin routes. */
export async function handleOrdersGrowthRoutes(params: {
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

  // --- C101: Global Instant Order Search (`UD-*`, BD Phone, Customer/Vendor Name) ---
  if (path === '/v1/admin/orders/search' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.search', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const q = (url.searchParams.get('q') ?? '').trim();
    return adminJsonOk({ query: q, orders: await db.searchOrdersGlobal(q) }, requestId);
  }

  // --- C90–C95: Order 360 Deep Replay (Events + Money + Fare + Chats + FCM Proofs + Dwell) ---
  const order360Match = path.match(/^\/v1\/admin\/orders\/([^/]+)\/360$/);
  if (order360Match && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.order_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const detail = await db.getOrder360(order360Match[1]!);
    if (!detail) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(detail, requestId);
  }

  // --- C96–C97: Automated Operational Exceptions Rules & Resolution ---
  if (path === '/v1/admin/exceptions/rules' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.exceptions', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ settings: await db.listPlatformSettings('ops') }, requestId);
  }

  if (path === '/v1/admin/exceptions/rules' && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.exceptions', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ updates?: Record<string, unknown> }>(request);
    if (!body?.updates) return adminJsonErr('VALIDATION_FAILED', requestId);
    const diff = await db.updatePlatformSettings(body.updates, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'exception.rules_update',
      entityType: 'platform_settings', entityId: 'ops.exceptions', diff, ip, requestId, nowMs,
    });
    return adminJsonOk(diff, requestId);
  }

  const excResolveMatch = path.match(/^\/v1\/admin\/exceptions\/([^/]+)\/resolve$/);
  if (excResolveMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.exceptions', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ note?: string }>(request);
    const record = {
      id: excResolveMatch[1]!,
      resolvedBy: principal.profileId,
      resolvedAtMs: nowMs,
      note: body?.note ?? null,
    };
    RESOLVED_EXCEPTIONS.set(record.id, record);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'exception.resolve',
      entityType: 'exception', entityId: record.id, diff: record, reason: body?.note, ip, requestId, nowMs,
    });
    return adminJsonOk(record, requestId);
  }

  // --- C98–C100: Mid-Order Pin/Item Adjustment & Step-Up Goodwill Compensation Voucher ---
  const modifyMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/modify$/);
  if (modifyMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.modify', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      address_snapshot?: Record<string, unknown>;
      refund_item_id?: string;
      refunded_qty?: number;
      reason?: string;
    }>(request);
    const updated = await db.modifyOrderMidFlight({
      orderId: modifyMatch[1]!,
      addressSnapshot: body?.address_snapshot,
      refundItemId: body?.refund_item_id,
      refundedQty: body?.refunded_qty,
    });
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'order.modify',
      entityType: 'order', entityId: modifyMatch[1]!, diff: updated, reason: body?.reason, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const gwMatch = path.match(/^\/v1\/admin\/orders\/([^/]+)\/goodwill-voucher$/);
  if (gwMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '6.modify', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ amount_poisha?: number; customer_id?: string; reason?: string }>(request);
    if (!body?.amount_poisha || body.amount_poisha <= 0) return adminJsonErr('VALIDATION_FAILED', requestId);
    const code = `GW${String(nowMs).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
    const voucher = await db.createGoodwillVoucher({
      code,
      titleEn: `Goodwill Credit (${gwMatch[1]!.slice(0, 8)})`,
      amountPoisha: Math.round(body.amount_poisha),
      customerId: body.customer_id,
      orderId: gwMatch[1]!,
      actorId: principal.profileId,
      nowMs,
    });
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'order.goodwill_voucher',
      entityType: 'voucher', entityId: String(voucher['id']), diff: voucher, reason: body.reason, ip, requestId, nowMs,
    });
    return adminJsonOk(voucher, requestId, 201);
  }

  // --- C102–C106: Zero-Ads Growth Campaigns & Flash Box Engine (`D-11`) ---
  if (path === '/v1/admin/campaigns' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.campaigns', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ campaigns: await db.listCampaigns() }, requestId);
  }

  if (path === '/v1/admin/campaigns' && method === 'POST') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    const perm = body?.['kind'] === 'flash_box' ? '7.flash_box' : '7.campaigns';
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: perm, mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    // Constitutional `D-11` guard: reject any paid-ad / sponsored ranking payload strictly!
    if (body?.['kind'] === 'paid_ad' || body?.['sponsored_rank'] === true) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'D11_PAID_RANKING_ADS_FORBIDDEN' });
    }
    if (!body?.['slug'] || !body['kind'] || !body['title_en'] || !body['title_bn']) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const created = await db.createCampaign(body, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'campaign.create',
      entityType: 'campaign', entityId: String(created['id']), diff: created, ip, requestId, nowMs,
    });
    return adminJsonOk(created, requestId, 201);
  }

  const campPatchMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)$/);
  if (campPatchMatch && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.flash_box', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = (await readJsonBody<Record<string, unknown>>(request)) ?? {};
    const updated = await db.patchCampaign(campPatchMatch[1]!, body);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'campaign.update',
      entityType: 'campaign', entityId: campPatchMatch[1]!, diff: updated, ip, requestId, nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const campVendorsMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)\/vendors$/);
  if (campVendorsMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.campaigns', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ vendor_id?: string; is_active?: boolean }>(request);
    if (!body?.vendor_id) return adminJsonErr('VALIDATION_FAILED', requestId);
    const link = await db.optInCampaignVendor(
      campVendorsMatch[1]!, body.vendor_id, principal.profileId, body.is_active ?? true,
    );
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'campaign.vendor_opt_in',
      entityType: 'campaign_vendor', entityId: `${campVendorsMatch[1]!}:${body.vendor_id}`, diff: link, ip, requestId, nowMs,
    });
    return adminJsonOk(link, requestId);
  }

  const campStatsMatch = path.match(/^\/v1\/admin\/campaigns\/([^/]+)\/stats$/);
  if (campStatsMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.campaigns', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const stats = await db.getCampaignStats(campStatsMatch[1]!);
    if (!stats) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(stats, requestId);
  }

  // --- C107–C108: Vouchers & Multi-Account Redemption Audit ---
  if (path === '/v1/admin/vouchers' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.vouchers', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ vouchers: await db.listVouchers() }, requestId);
  }

  if (path === '/v1/admin/vouchers' && (method === 'POST' || method === 'PATCH')) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.vouchers', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body?.['code'] || !body['title_en'] || !body['kind'] || !body['value_num']) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const saved = await db.upsertVoucher(body, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'voucher.upsert',
      entityType: 'voucher', entityId: String(saved['id']), diff: saved, ip, requestId, nowMs,
    });
    return adminJsonOk(saved, requestId, method === 'POST' ? 201 : 200);
  }

  if (path === '/v1/admin/vouchers/redemptions' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.vouchers', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ redemptions: await db.listVoucherRedemptions() }, requestId);
  }

  // --- C109–C113: ImgBB Home Banners (`ADR-0006 v2`), Referrals & Lifecycle Nudges ---
  if (path === '/v1/admin/banners' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.banners', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ banners: await db.listBanners() }, requestId);
  }

  if (path === '/v1/admin/banners' && (method === 'POST' || method === 'PATCH')) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.banners', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<Record<string, unknown>>(request);
    const imgUrl = String(body?.['image_url'] ?? '');
    // `ADR-0006 v2` enforcement: public banners MUST live on ImgBB CDN (`ibb.co`), NEVER Cloudinary or Supabase Storage!
    if (!imgUrl.startsWith('https://i.ibb.co/')) {
      return adminJsonErr('VALIDATION_FAILED', requestId, {
        reason: 'ADR_0006_PUBLIC_BANNER_MUST_USE_IMGBB_CDN',
      });
    }
    const banner = await db.upsertBanner(body ?? {}, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'banner.upsert',
      entityType: 'banner', entityId: String(banner['id']), diff: banner, ip, requestId, nowMs,
    });
    return adminJsonOk(banner, requestId, method === 'POST' ? 201 : 200);
  }

  const bannerDelMatch = path.match(/^\/v1\/admin\/banners\/([^/]+)$/);
  if (bannerDelMatch && method === 'DELETE') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.banners', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ deleted: await db.deleteBanner(bannerDelMatch[1]!) }, requestId);
  }

  if (path === '/v1/admin/referrals' && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.referrals', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ customer_reward_poisha?: number; rider_reward_poisha?: number }>(request);
    const diff = await db.updatePlatformSettings(
      {
        'growth.referral_customer_poisha': Math.round(Number(body?.customer_reward_poisha ?? 5000)),
        'growth.referral_rider_poisha': Math.round(Number(body?.rider_reward_poisha ?? 10000)),
      },
      principal.profileId,
    );
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'referrals.update',
      entityType: 'platform_settings', entityId: 'growth.referrals', diff, ip, requestId, nowMs,
    });
    return adminJsonOk(diff, requestId);
  }

  if (path === '/v1/admin/nudges/draft' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.nudges', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      title_en?: string;
      title_bn?: string;
      body_en?: string;
      body_bn?: string;
      recipient_ids?: readonly string[];
      max_per_week?: number;
    }>(request);
    if (!body?.title_en || !body.title_bn || !body.body_en || !body.body_bn) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const draft = {
      id: crypto.randomUUID(),
      titleEn: body.title_en,
      titleBn: body.title_bn,
      bodyEn: body.body_en,
      bodyBn: body.body_bn,
      maxPerWeek: Math.min(3, Math.max(1, Number(body.max_per_week ?? 2))),
      recipientIds: body.recipient_ids ?? [],
    };
    NUDGE_DRAFTS.set(draft.id, draft);
    return adminJsonOk(draft, requestId, 201);
  }

  if (path === '/v1/admin/nudges/preview' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.nudges', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ draft_id?: string }>(request);
    const draft = body?.draft_id ? NUDGE_DRAFTS.get(body.draft_id) : undefined;
    if (!draft) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk({ draft, estimatedReach: draft.recipientIds.length, antiSpamCapPerWeek: draft.maxPerWeek }, requestId);
  }

  const nudgeSendMatch = path.match(/^\/v1\/admin\/nudges\/([^/]+)\/send$/);
  if (nudgeSendMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '7.nudges', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const draft = NUDGE_DRAFTS.get(nudgeSendMatch[1]!);
    if (!draft) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    const sent = await db.dispatchNudgeNotifications({
      recipientIds: draft.recipientIds,
      titleEn: draft.titleEn,
      titleBn: draft.titleBn,
      bodyEn: draft.bodyEn,
      bodyBn: draft.bodyBn,
      campaignTag: `nudge:${draft.id}`,
    });
    await db.appendAuditLog({
      actorId: principal.profileId, actorRole: primaryRole, action: 'nudge.send',
      entityType: 'nudge', entityId: draft.id, diff: sent, ip, requestId, nowMs,
    });
    return adminJsonOk(sent, requestId);
  }

  return null;
}
