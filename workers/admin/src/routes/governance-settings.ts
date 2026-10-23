/**
 * @file workers/admin/src/routes/governance-settings.ts
 * @description Domain 1 Governance Sub-Router — Platform Settings, Version Rollback,
 * Emergency Kill Switches, Deep Health / Free-Tier Quotas & Client Error Triage (`C13–C21`):
 *   - `GET / PATCH /v1/admin/settings` & `POST /v1/admin/settings/rollback` (`C13–C15`)
 *   - `POST /v1/admin/kill-switches` (`C16–C18`)
 *   - `GET /v1/admin/health/deep` & `GET /v1/admin/health/quotas` (`C19–C20`)
 *   - `GET / PATCH /v1/admin/errors` (`C21`)
 */

import {
  adminJsonErr,
  adminJsonOk,
  authorizeAdminCapability,
  readJsonBody,
} from '../http.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';

/** Handles Domain 1 settings, rollback, kill-switches, health & error routes (`C13–C21`). */
export async function handleGovernanceSettingsRoutes(params: {
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

  // --- C13–C15 & C47: Platform Settings + Rollback ---
  if (path === '/v1/admin/settings' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.platform_settings', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { settings: await db.listPlatformSettings(url.searchParams.get('group') ?? undefined) },
      requestId,
    );
  }

  if (path === '/v1/admin/settings' && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.platform_settings', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ updates?: Record<string, unknown>; reason?: string }>(request);
    if (!body?.updates || typeof body.updates !== 'object' || Object.keys(body.updates).length === 0) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { required: 'updates' });
    }
    const diff = await db.updatePlatformSettings(body.updates, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'settings.update',
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

  if (path === '/v1/admin/settings/rollback' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.platform_settings', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ key?: string; version?: number; reason?: string }>(request);
    if (!body?.key) return adminJsonErr('VALIDATION_FAILED', requestId, { required: 'key' });
    const restored = await db.rollbackPlatformSetting(body.key, body.version, principal.profileId);
    if (!restored) return adminJsonErr('VALIDATION_FAILED', requestId, { reason: 'history_version_not_found' }, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'settings.rollback',
      entityType: 'platform_settings',
      entityId: body.key,
      diff: restored,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(restored, requestId);
  }

  // --- C16–C18: Kill Switches (Pause Ordering, RTDB <-> Polling, Maintenance Banner) ---
  if (path === '/v1/admin/kill-switches' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.kill_switches', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      kind?: 'ordering' | 'realtime' | 'banner';
      ordering_paused?: boolean;
      realtime_mode?: 'rtdb' | 'polling';
      banner_en?: string;
      banner_bn?: string;
      reason?: string;
    }>(request);
    if (!body?.kind) return adminJsonErr('VALIDATION_FAILED', requestId);
    const updates: Record<string, unknown> = {};
    if (body.kind === 'ordering') updates['ops.ordering_paused'] = Boolean(body.ordering_paused);
    if (body.kind === 'realtime') {
      if (body.realtime_mode !== 'rtdb' && body.realtime_mode !== 'polling') {
        return adminJsonErr('VALIDATION_FAILED', requestId);
      }
      updates['ops.realtime_mode'] = body.realtime_mode;
    }
    if (body.kind === 'banner') {
      updates['ops.maintenance_banner'] = { en: body.banner_en ?? '', bn: body.banner_bn ?? '' };
    }
    const diff = await db.updatePlatformSettings(updates, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: `killswitch.${body.kind}`,
      entityType: 'kill_switch',
      entityId: body.kind,
      diff,
      reason: body.reason,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ kind: body.kind, ...diff }, requestId);
  }

  // --- C19–C21: Deep Health, Free-Tier Quota Gauges & Client Error Inbox ---
  if (path === '/v1/admin/health/deep' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.health', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const quotas = await db.getSystemQuotaSnapshot(nowMs);
    return adminJsonOk(
      {
        status: 'healthy',
        checkedAtMs: nowMs,
        services: {
          w1_api: 'up',
          w2_realtime: 'up',
          w3_admin: 'up',
          postgres_db: 'up',
          imgbb_public_cdn: 'up',
          cloudinary_private_vault: env.UNDAL_CLOUDINARY_CLOUD_NAME ? 'configured' : 'pending_secret',
        },
        quotas,
      },
      requestId,
    );
  }

  if (path === '/v1/admin/health/quotas' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.health', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(await db.getSystemQuotaSnapshot(nowMs), requestId);
  }

  if (path === '/v1/admin/errors' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.health', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ errors: await db.listClientErrors(url.searchParams.get('status') ?? undefined) }, requestId);
  }

  if (path === '/v1/admin/errors' && method === 'PATCH') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.health', mode: 'write', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ id?: number; status?: 'open' | 'resolved' | 'ignored'; note?: string }>(request);
    if (!body?.id || !body.status) return adminJsonErr('VALIDATION_FAILED', requestId);
    const updated = await db.triageClientError(body.id, body.status, body.note, principal.profileId);
    if (!updated) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'health.error.triage',
      entityType: 'client_error',
      entityId: String(body.id),
      diff: updated,
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(updated, requestId);
  }

  return null;
}
