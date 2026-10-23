/**
 * @file workers/admin/src/routes/governance.ts
 * @description Super Admin **Domain 1 · Governance & Security (`C1–C21`)** (`07-admin-registry-final.md`):
 *   - TOTP 2FA enroll (`POST /v1/admin/auth/totp/enroll`) & `5-min` Step-Up (`POST /v1/admin/auth/step-up`)
 *   - Admin Users (`C1–C3`), Roles Matrix + Diff Preview (`C4–C6`), Active Sessions & Login History (`C7–C9`)
 *   - Immutable Audit Explorer, JSON Diff & Audited CSV Export (`C10–C12`)
 *   - Platform Settings (`72` keys) + Rollback (`C13–C15`), Global/Zone Kill Switches (`C16–C18`),
 *     Deep Health, Free-Tier Quota Gauges & Client Error Inbox (`C19–C21`)
 */

import {
  adminJsonErr,
  adminJsonOk,
  authorizeAdminCapability,
  listLoginHistory,
  listTrackedSessions,
  readJsonBody,
  revokeTrackedSession,
} from '../http.ts';
import { ALL_CANONICAL_ADMIN_PERMISSIONS, computeRolePermissionDiff } from '../rbac.ts';
import {
  buildOtpAuthUri,
  deriveAdminTotpSecretBase32,
  mintStepUpToken,
  verifyTotpCode,
} from '../totp.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from '../types.ts';
import { handleGovernanceSettingsRoutes } from './governance-settings.ts';

export async function handleGovernanceRoutes(params: {
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
  const pepper = env.ADMIN_TOTP_PEPPER ?? 'example-default-totp-pepper';
  const primaryRole = principal.roleKeys[0] ?? 'admin';

  // --- Auth: Initial TOTP 2FA Enrollment & Step-Up Token Minting ---
  if (method === 'POST' && path === '/v1/admin/auth/totp/enroll') {
    await db.enrollAdminTotp(principal.profileId, nowMs);
    const secretBase32 = await deriveAdminTotpSecretBase32({
      profileId: principal.profileId,
      enrolledEpochMs: nowMs,
      pepper,
    });
    const uri = buildOtpAuthUri({
      accountLabel: principal.email ?? principal.profileId,
      secretBase32,
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.totp.enroll',
      entityType: 'profile',
      entityId: principal.profileId,
      diff: { enrolledAtMs: nowMs },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ enrolledAtMs: nowMs, secretBase32, otpauthUri: uri }, requestId);
  }

  if (method === 'POST' && path === '/v1/admin/auth/step-up') {
    const body = await readJsonBody<{ code?: string }>(request);
    if (!body?.code || principal.totpEnrolledAtMs === null) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { field: 'code' });
    }
    const secretBase32 = await deriveAdminTotpSecretBase32({
      profileId: principal.profileId,
      enrolledEpochMs: principal.totpEnrolledAtMs,
      pepper,
    });
    const ok = await verifyTotpCode({ secretBase32, code: body.code, nowMs });
    if (!ok) {
      return adminJsonErr('AUTH_STEP_UP_REQUIRED', requestId, { reason: 'invalid_totp_code' });
    }
    const minted = await mintStepUpToken({ profileId: principal.profileId, pepper, nowMs });
    return adminJsonOk(minted, requestId);
  }

  // --- C1–C3: Admin Users ---
  if (path === '/v1/admin/users' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.admin_users', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ users: await db.listAdminUsers() }, requestId);
  }

  if (path === '/v1/admin/users' && (method === 'POST' || method === 'PATCH')) {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.admin_users', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      profile_id?: string;
      email?: string;
      full_name?: string;
      phone?: string;
      status?: 'active' | 'suspended';
    }>(request);
    if (!body?.email || !body.full_name) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { required: ['email', 'full_name'] });
    }
    const saved = await db.upsertAdminUser({
      profileId: body.profile_id,
      email: body.email.trim(),
      fullName: body.full_name.trim(),
      phone: body.phone,
      status: body.status ?? 'active',
      nowMs,
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.user.upsert',
      entityType: 'profile',
      entityId: String(saved['id']),
      diff: { after: saved },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(saved, requestId, method === 'POST' ? 201 : 200);
  }

  const userRolesMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/roles$/);
  if (userRolesMatch && method === 'PUT') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.admin_users', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const targetId = userRolesMatch[1]!;
    const body = await readJsonBody<{ roles?: string[] }>(request);
    if (!Array.isArray(body?.roles)) {
      return adminJsonErr('VALIDATION_FAILED', requestId, { field: 'roles' });
    }
    const updatedRoles = await db.setAdminUserRoles(targetId, body.roles, principal.profileId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.user.roles',
      entityType: 'profile',
      entityId: targetId,
      diff: { roles: updatedRoles },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ profileId: targetId, roles: updatedRoles }, requestId);
  }

  const resetTotpMatch = path.match(/^\/v1\/admin\/users\/([^/]+)\/reset-totp$/);
  if (resetTotpMatch && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.admin_users', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const targetId = resetTotpMatch[1]!;
    await db.resetAdminUserTotp(targetId);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.user.reset_auth',
      entityType: 'profile',
      entityId: targetId,
      diff: { totpResetAtMs: nowMs },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ profileId: targetId, totpReset: true }, requestId);
  }

  // --- C4–C6: Roles Matrix ---
  if (path === '/v1/admin/roles' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.roles_matrix', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk(
      { roles: await db.listAdminRoles(), catalogue: ALL_CANONICAL_ADMIN_PERMISSIONS },
      requestId,
    );
  }

  if (path === '/v1/admin/roles' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.roles_matrix', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{
      key?: string;
      name_en?: string;
      name_bn?: string;
      description_en?: string;
      permissions?: string[];
    }>(request);
    if (!body?.key || !body.name_en || !body.name_bn || !/^[a-z][a-z0-9_]{1,48}$/.test(body.key)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const created = await db.createAdminRole({
      key: body.key,
      nameEn: body.name_en,
      nameBn: body.name_bn,
      descriptionEn: body.description_en,
      permissions: body.permissions ?? [],
    });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.role.create',
      entityType: 'admin_role',
      entityId: created.id,
      diff: { after: created },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk(created, requestId, 201);
  }

  if (path === '/v1/admin/roles/preview-diff' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.roles_matrix', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const body = await readJsonBody<{ role_id?: string; permissions?: string[] }>(request);
    const roles = await db.listAdminRoles();
    const target = roles.find((r) => r.id === body?.role_id || r.key === body?.role_id);
    if (!target || !Array.isArray(body?.permissions)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    return adminJsonOk(
      computeRolePermissionDiff({
        currentPermissions: target.permissions,
        nextPermissions: body.permissions,
        assignedUserCount: target.assignedCount,
      }),
      requestId,
    );
  }

  const rolePermsMatch = path.match(/^\/v1\/admin\/roles\/([^/]+)\/permissions$/);
  if (rolePermsMatch && method === 'PUT') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.roles_matrix', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const roleId = rolePermsMatch[1]!;
    const body = await readJsonBody<{ permissions?: string[] }>(request);
    if (!Array.isArray(body?.permissions)) {
      return adminJsonErr('VALIDATION_FAILED', requestId);
    }
    const updated = await db.setRolePermissions(roleId, body.permissions);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.role.perms',
      entityType: 'admin_role',
      entityId: roleId,
      diff: { permissions: updated },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ roleId, permissions: updated }, requestId);
  }

  // --- C7–C9: Active Sessions, Revocation & Login History ---
  if (path === '/v1/admin/sessions' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.sessions', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ sessions: listTrackedSessions() }, requestId);
  }

  if (path === '/v1/admin/sessions/history' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.sessions', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    return adminJsonOk({ attempts: listLoginHistory() }, requestId);
  }

  const sessRevokeMatch = path.match(/^\/v1\/admin\/sessions\/([^/]+)$/);
  if (sessRevokeMatch && method === 'DELETE') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.sessions', mode: 'write', requireStepUp: true, env, nowMs,
    });
    if (deny) return deny;
    const sessId = sessRevokeMatch[1]!;
    const revoked = revokeTrackedSession(sessId, nowMs);
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.session.revoke',
      entityType: 'admin_session',
      entityId: sessId,
      diff: { revokedAtMs: nowMs },
      ip,
      requestId,
      nowMs,
    });
    return adminJsonOk({ revoked }, requestId);
  }

  // --- C10–C12: Audit Logs Search, Diff & CSV Export ---
  if (path === '/v1/admin/audit' && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.audit_logs', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const rows = await db.queryAuditLogs({
      actorId: url.searchParams.get('actor_id') ?? undefined,
      action: url.searchParams.get('action') ?? undefined,
      entityType: url.searchParams.get('entity_type') ?? undefined,
      limit: Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '50'))),
    });
    return adminJsonOk({ items: rows }, requestId);
  }

  if (path === '/v1/admin/audit/export' && method === 'POST') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.audit_logs', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const rows = await db.queryAuditLogs({ limit: 500 });
    await db.appendAuditLog({
      actorId: principal.profileId,
      actorRole: primaryRole,
      action: 'admin.audit.export',
      entityType: 'audit_logs',
      entityId: 'csv_export',
      diff: { exportedRows: rows.length },
      ip,
      requestId,
      nowMs,
    });
    const csvHeader = 'id,actor_id,actor_role,action,entity_type,entity_id,request_id,created_at';
    const csvLines = rows.map((r) =>
      [r['id'], r['actor_id'] ?? '', r['actor_role'], r['action'], r['entity_type'], r['entity_id'], r['request_id'], r['created_at']]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(','),
    );
    return adminJsonOk({ format: 'csv', count: rows.length, csv: [csvHeader, ...csvLines].join('\n') }, requestId);
  }

  const auditDetailMatch = path.match(/^\/v1\/admin\/audit\/(\d+)$/);
  if (auditDetailMatch && method === 'GET') {
    const deny = await authorizeAdminCapability({
      request, requestId, principal, permission: '1.audit_logs', mode: 'read', env, nowMs,
    });
    if (deny) return deny;
    const row = await db.getAuditLogById(Number(auditDetailMatch[1]));
    if (!row) return adminJsonErr('VALIDATION_FAILED', requestId, undefined, 404);
    return adminJsonOk(row, requestId);
  }

  return handleGovernanceSettingsRoutes(params);
}
