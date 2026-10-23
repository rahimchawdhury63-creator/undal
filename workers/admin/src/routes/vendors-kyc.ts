/**
 * @file workers/admin/src/routes/vendors-kyc.ts
 * @description Super Admin **Domain 4 · Vendor & Menu Hub (`C55–C70`)** + **`ADR-0006 v2` Private
 * Cloudinary Signed View (`POST /v1/images/private-view-url`, `120s <= 600s`)**:
 *   - 3-Track KYC Pipeline (`RESTAURANT`, `HOME_KITCHEN`, `CLOUD_KITCHEN` + `Rider`),
 *     Audited Private Document Signed URLs (`C56`), Per-Document & Application Decisions (`C57–C58`),
 *     and `30d/7d/expired` Document Expiry Watchlist (`C59`)
 *   - Vendor 360 Profile/Commission/Payout (`C60`), `rank_v1` Inspector (`C61`), Finance Tab (`C62`),
 *     Reviews Tab (`C63`), Emergency Pause (`C64`), and Step-Up Suspend/Reactivate (`C65`)
 *   - Menu Moderation (`AP-9` duplicate spam queue, hide/flag, inflated `compare_at_poisha` alerts `C66–C68`)
 *   - Bilingual EN/বাংলা Cuisine Taxonomy & Cross-Vendor Dish Search (`C69–C70`)
 */

import { isPrivateCloudinaryCategory, signCloudinaryAuthenticatedUrl } from '@undal/shared-ts';
import { adminJsonErr, adminJsonOk, authorizeAdminCapability, readJsonBody } from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

export async function handleVendorsKycAndCatalogRoutes(params: {
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

  // --- C55: 3-Track Vendor + Rider KYC Kanban Queue ---
  if (method === 'GET' && path === '/v1/admin/kyc/queue') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.pipeline', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getKycQueue(), requestId);
  }

  // --- C56: Audited Short-Lived (`<= 600s`, default `120s`) Private Cloudinary View URL (`ADR-0006 v2`) ---
  if (
    method === 'POST' &&
    (path === '/v1/images/private-view-url' || path === '/v1/admin/kyc/private-view-url')
  ) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.pipeline', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ public_id?: string; ttl_seconds?: number; reason?: string }>(request);
    if (!body?.public_id) return adminJsonErr('VALIDATION_FAILED', requestId, { required: 'public_id' });

    const asset = await db.getMediaAssetByPublicId(body.public_id);
    if (!asset) return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'asset_not_found' }, 404);
    if (asset.provider !== 'cloudinary' || !isPrivateCloudinaryCategory(asset.category)) {
      return adminJsonErr('VALIDATION_FAILED', requestId, {
        reason: 'public_imgbb_assets_do_not_use_cloudinary_signed_urls',
      });
    }

    const signed = await signCloudinaryAuthenticatedUrl({
      cloudName: env.UNDAL_CLOUDINARY_CLOUD_NAME ?? 'undal-private-vault',
      apiSecret: env.CLOUDINARY_API_SECRET ?? 'example-cloudinary-signing-key',
      publicId: body.public_id,
      ttlSeconds: Math.min(600, Math.max(30, Number(body.ttl_seconds ?? 120))),
      nowEpochSeconds: Math.floor(nowMs / 1_000),
      pdfPageThumbnail: asset.format === 'pdf',
    });

    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'kyc.doc.view',
      entityType: 'media_asset',
      entityId: asset.id,
      diff: {
        publicId: body.public_id,
        category: asset.category,
        expiresAtEpochSeconds: signed.expiresAtEpochSeconds,
      },
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });

    return adminJsonOk(
      {
        provider: 'cloudinary',
        category: asset.category,
        signedUrl: signed.signedUrl,
        expiresAtEpochSeconds: signed.expiresAtEpochSeconds,
      },
      requestId,
    );
  }

  // --- C57 & C58: Per-Document & Overall KYC Approve / Request-Fix / Reject ---
  const kycDecideMatch = path.match(/^\/v1\/admin\/kyc\/(vendor|rider)\/([^/]+)\/decide$/);
  if (kycDecideMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.pipeline', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const targetType = kycDecideMatch[1] as 'vendor' | 'rider';
    const targetId = kycDecideMatch[2]!;
    const body = await readJsonBody<{
      decision?: 'approved' | 'needs_fix' | 'rejected';
      note?: string;
      document_decisions?: { docId: string; status: 'approved' | 'needs_fix' | 'rejected'; note?: string }[];
    }>(request);
    if (!body?.decision || !['approved', 'needs_fix', 'rejected'].includes(body.decision)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const decided = await db.decideKycApplication({
      targetType,
      targetId,
      decision: body.decision,
      documentDecisions: body.document_decisions,
      note: body.note,
      reviewerId: principal.profileId,
    });
    if (!decided) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: body.decision === 'rejected' ? 'kyc.reject' : 'kyc.doc.decide',
      entityType: targetType,
      entityId: targetId,
      diff: decided,
      reason: body.note,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(decided, requestId);
  }

  // --- C59: Expiring Trade / Driving Licences & Tax Tokens Watchlist (`30d / 7d / expired`) ---
  if (method === 'GET' && path === '/v1/admin/kyc/expiring') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.pipeline', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const withinDays = Math.min(90, Math.max(0, Number(url.searchParams.get('days') ?? '30')));
    return adminJsonOk({ items: await db.listExpiringDocuments(withinDays, nowMs) }, requestId);
  }

  // --- C60–C65: Vendor 360 Profile, Ranking, Finance, Reviews, Emergency Pause & Suspend ---
  const vendorRankingMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)\/ranking$/);
  if (vendorRankingMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const data = await db.getVendorRankingBreakdown(vendorRankingMatch[1]!);
    if (!data) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(data, requestId);
  }

  const vendorFinanceMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)\/finance$/);
  if (vendorFinanceMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getVendorFinanceTab(vendorFinanceMatch[1]!), requestId);
  }

  const vendorReviewsMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)\/reviews$/);
  if (vendorReviewsMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getVendorReviewsTab(vendorReviewsMatch[1]!), requestId);
  }

  const vendorPauseMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)\/pause$/);
  if (vendorPauseMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const vendorId = vendorPauseMatch[1]!;
    const body = await readJsonBody<{ minutes?: number; reason?: string }>(request);
    const reason = body?.reason?.trim() ?? 'Admin emergency kitchen pause';
    const pause = await db.createVendorEmergencyPause(
      vendorId,
      Math.min(1_440, Math.max(5, Number(body?.minutes ?? 60))),
      reason,
      principal.profileId,
      nowMs,
    );
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'vendor.emergency_pause',
      entityType: 'vendor',
      entityId: vendorId,
      diff: { pause },
      reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(pause, requestId);
  }

  const vendorSuspendMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)\/suspend$/);
  if (vendorSuspendMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const vendorId = vendorSuspendMatch[1]!;
    const body = await readJsonBody<{ suspended?: boolean; reason?: string }>(request);
    const updated = await db.setVendorSuspension(vendorId, Boolean(body?.suspended ?? true));
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'vendor.suspend',
      entityType: 'vendor',
      entityId: vendorId,
      diff: updated,
      reason: body?.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  const vendorBaseMatch = path.match(/^\/v1\/admin\/vendors\/([^/]+)$/);
  if (vendorBaseMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.vendor_360', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const vendor = await db.getVendor360(vendorBaseMatch[1]!);
    if (!vendor) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(vendor, requestId);
  }

  if (vendorBaseMatch && method === 'PATCH') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (!body) return adminJsonErr('VALIDATION_FAILED', requestId);
    const sensitiveEdit = 'commission_bps' in body || 'payout' in body;
    const deny = await authorizeAdminCapability({
      request,
      requestId,
      principal,
      permission: '4.vendor_360',
      mode: 'write',
      requireStepUp: sensitiveEdit,
      env,
      nowMs,
    });
    if (deny) return deny;
    const vendorId = vendorBaseMatch[1]!;
    const updated = await db.patchVendor360(vendorId, body);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'vendor.update',
      entityType: 'vendor',
      entityId: vendorId,
      diff: updated,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated.after, requestId);
  }

  // --- C66–C68: Menu Moderation & Price-Parity Alerts ---
  if (method === 'GET' && path === '/v1/admin/menu/moderation') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.menu_moderation', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.listMenuModerationQueue(), requestId);
  }

  const modItemMatch = path.match(/^\/v1\/admin\/menu\/items\/([^/]+)\/moderate$/);
  if (modItemMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.menu_moderation', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const itemId = modItemMatch[1]!;
    const body = await readJsonBody<{ action?: 'hide' | 'approve' | 'flag_photo'; note?: string }>(request);
    if (!body?.action || !['hide', 'approve', 'flag_photo'].includes(body.action)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const updated = await db.moderateMenuItem(itemId, body.action, body.note);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'menu.moderate',
      entityType: 'menu_item',
      entityId: itemId,
      diff: updated,
      reason: body.note,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  if (method === 'GET' && path === '/v1/admin/menu/price-alerts') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.menu_moderation', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ alerts: await db.listMenuPriceAlerts() }, requestId);
  }

  // --- C69 & C70: Bilingual Cuisine Taxonomy & Cross-Vendor Dish Search ---
  if (path === '/v1/admin/taxonomy' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.catalog', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ items: await db.listTaxonomy() }, requestId);
  }

  if (path === '/v1/admin/taxonomy' && (method === 'POST' || method === 'PATCH')) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.catalog', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      key?: string;
      name_en?: string;
      name_bn?: string;
      parent_key?: string | null;
      synonyms?: string[];
      sort?: number;
      is_active?: boolean;
    }>(request);
    if (!body?.key || !body.name_en || !body.name_bn) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const saved = await db.upsertTaxonomyItem({
      key: body.key,
      nameEn: body.name_en,
      nameBn: body.name_bn,
      parentKey: body.parent_key ?? null,
      synonyms: body.synonyms ?? [],
      sort: Number(body.sort ?? 0),
      isActive: body.is_active !== false,
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'catalog.taxonomy',
      entityType: 'cuisine_taxonomy',
      entityId: body.key,
      diff: { after: saved },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(saved, requestId, method === 'POST' ? 201 : 200);
  }

  if (method === 'GET' && path === '/v1/admin/catalog/search') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '4.catalog', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { items: await db.searchCatalogItems(url.searchParams.get('q') ?? '') },
      requestId,
    );
  }

  return null;
}
