/**
 * @file workers/admin/src/db-postgrest.ts
 * @description Production Supabase PostgREST (`/rest/v1/*` + `/rest/v1/rpc/*`) adapter for
 * `W3 undal-admin` — Part A: Transport + **Domain 1 (`C1–C21`)** & **Domain 3 (`C41–C54`)**
 * (`0` direct TCP sockets — pure stateless Worker `fetch()` under 10ms CPU budget).
 */

import { DEFAULT_FARE_POLICY, type FarePolicyConfig } from '@undal/shared-ts';
import { createPostgrestAdminOps } from './db-postgrest-ops.ts';
import type { LngLatPair } from './geo-polygon.ts';
import type { AdminDbAdapter, AdminWorkerEnv } from './types.ts';

export interface AdminRestTransport {
  restGet<T>(query: string): Promise<T>;
  restWrite<T>(method: 'POST' | 'PATCH' | 'DELETE', query: string, body?: unknown, prefer?: string): Promise<T>;
  rpc<T>(fnName: string, args: Record<string, unknown>): Promise<T>;
}

export function buildAdminRestTransport(env: AdminWorkerEnv, fetchImpl: typeof fetch = fetch): AdminRestTransport {
  const baseUrl = (env.SUPABASE_URL ?? 'https://dry-run.supabase.co').replace(/\/$/, '');
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY ?? 'example-service-role-placeholder';
  const authHeaders = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
  };

  return {
    async restGet<T>(query: string): Promise<T> {
      const res = await fetchImpl(`${baseUrl}/rest/v1/${query}`, { headers: authHeaders });
      if (!res.ok) throw new Error(`PostgREST GET ${query} failed (${res.status})`);
      return (await res.json()) as T;
    },
    async restWrite<T>(
      method: 'POST' | 'PATCH' | 'DELETE',
      query: string,
      body?: unknown,
      prefer = 'return=representation',
    ): Promise<T> {
      const res = await fetchImpl(`${baseUrl}/rest/v1/${query}`, {
        method,
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json',
          Prefer: prefer,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (!res.ok) throw new Error(`PostgREST ${method} ${query} failed (${res.status})`);
      if (prefer === 'return=minimal') return undefined as T;
      return (await res.json()) as T;
    },
    async rpc<T>(fnName: string, args: Record<string, unknown>): Promise<T> {
      const res = await fetchImpl(`${baseUrl}/rest/v1/rpc/${fnName}`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      if (!res.ok) throw new Error(`PostgREST RPC ${fnName} failed (${res.status})`);
      return (await res.json()) as T;
    },
  };
}

export function createAdminPostgrestAdapter(
  env: AdminWorkerEnv,
  fetchImpl: typeof fetch = fetch,
): AdminDbAdapter {
  const t = buildAdminRestTransport(env, fetchImpl);

  return {
    async getAdminPrincipal(profileId) {
      const pRows = await t.restGet<readonly Record<string, unknown>[]>(
        `profiles?select=id,role,full_name,email,phone,status,totp_enrolled_at&id=eq.${encodeURIComponent(profileId)}&limit=1`,
      );
      const p = pRows[0];
      if (!p || p['role'] !== 'admin') return null;

      const userRoles = await t.restGet<readonly { role_id: string }[]>(
        `admin_user_roles?select=role_id&profile_id=eq.${encodeURIComponent(profileId)}`,
      );
      const roleIds = userRoles.map((r) => r.role_id);
      let roleKeys: string[] = [];
      let permissions: string[] = [];
      if (roleIds.length > 0) {
        const inList = roleIds.map((id) => encodeURIComponent(id)).join(',');
        const [rRows, permRows] = await Promise.all([
          t.restGet<readonly { key: string }[]>(`admin_roles?select=key&id=in.(${inList})`),
          t.restGet<readonly { permission: string }[]>(`admin_permissions?select=permission&role_id=in.(${inList})`),
        ]);
        roleKeys = rRows.map((r) => r.key);
        permissions = [...new Set(permRows.map((x) => x.permission))];
      }
      return {
        profileId: String(p['id']),
        fullName: String(p['full_name']),
        email: p['email'] ? String(p['email']) : null,
        phone: p['phone'] ? String(p['phone']) : null,
        status: p['status'] as 'active' | 'suspended' | 'deleted',
        totpEnrolledAtMs: p['totp_enrolled_at'] ? new Date(String(p['totp_enrolled_at'])).getTime() : null,
        roleKeys,
        permissions,
      };
    },

    async enrollAdminTotp(profileId, nowMs) {
      await t.restWrite(
        'PATCH',
        `profiles?id=eq.${encodeURIComponent(profileId)}`,
        { totp_enrolled_at: new Date(nowMs).toISOString() },
        'return=minimal',
      );
    },

    async listAdminUsers() {
      return t.restGet<readonly Record<string, unknown>[]>(
        'profiles?select=id,full_name,email,phone,status,totp_enrolled_at,created_at&role=eq.admin&order=created_at.asc',
      );
    },

    async upsertAdminUser(input) {
      const id = input.profileId ?? crypto.randomUUID();
      const rows = await t.restWrite<readonly Record<string, unknown>[]>(
        'POST',
        'profiles?on_conflict=id',
        {
          id,
          role: 'admin',
          full_name: input.fullName,
          email: input.email,
          ...(input.phone ? { phone: input.phone } : {}),
          status: input.status,
        },
        'resolution=merge-duplicates,return=representation',
      );
      return rows[0] ?? { id, email: input.email, full_name: input.fullName, status: input.status };
    },

    async setAdminUserRoles(profileId, roleKeys, grantedBy) {
      await t.restWrite('DELETE', `admin_user_roles?profile_id=eq.${encodeURIComponent(profileId)}`, undefined, 'return=minimal');
      if (roleKeys.length === 0) return [];
      const inList = roleKeys.map((k) => encodeURIComponent(k)).join(',');
      const found = await t.restGet<readonly { id: string; key: string }[]>(`admin_roles?select=id,key&key=in.(${inList})`);
      if (found.length > 0) {
        await t.restWrite(
          'POST',
          'admin_user_roles',
          found.map((r) => ({ profile_id: profileId, role_id: r.id, granted_by: grantedBy })),
          'return=minimal',
        );
      }
      return found.map((r) => r.key);
    },

    async resetAdminUserTotp(profileId) {
      await t.restWrite('PATCH', `profiles?id=eq.${encodeURIComponent(profileId)}`, { totp_enrolled_at: null }, 'return=minimal');
    },

    async listAdminRoles() {
      const [roles, perms, links] = await Promise.all([
        t.restGet<readonly Record<string, unknown>[]>('admin_roles?select=id,key,name_en,name_bn,is_system&order=key.asc'),
        t.restGet<readonly { role_id: string; permission: string }[]>('admin_permissions?select=role_id,permission'),
        t.restGet<readonly { role_id: string }[]>('admin_user_roles?select=role_id'),
      ]);
      return roles.map((r) => {
        const rid = String(r['id']);
        return {
          id: rid,
          key: String(r['key']),
          nameEn: String(r['name_en']),
          nameBn: String(r['name_bn']),
          isSystem: Boolean(r['is_system']),
          permissions: perms.filter((p) => p.role_id === rid).map((p) => p.permission),
          assignedCount: links.filter((l) => l.role_id === rid).length,
        };
      });
    },

    async createAdminRole(input) {
      const created = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'admin_roles', {
        key: input.key,
        name_en: input.nameEn,
        name_bn: input.nameBn,
        description_en: input.descriptionEn ?? null,
        is_system: false,
      });
      const roleId = String(created[0]!['id']);
      if (input.permissions.length > 0) {
        await t.restWrite(
          'POST',
          'admin_permissions',
          input.permissions.map((permission) => ({ role_id: roleId, permission })),
          'return=minimal',
        );
      }
      return { id: roleId, key: input.key, permissions: input.permissions };
    },

    async setRolePermissions(roleId, permissions) {
      await t.restWrite('DELETE', `admin_permissions?role_id=eq.${encodeURIComponent(roleId)}`, undefined, 'return=minimal');
      const unique = [...new Set(permissions)];
      if (unique.length > 0) {
        await t.restWrite(
          'POST',
          'admin_permissions',
          unique.map((permission) => ({ role_id: roleId, permission })),
          'return=minimal',
        );
      }
      return unique;
    },

    async appendAuditLog(entry) {
      const rows = await t.restWrite<readonly { id: number }[]>('POST', 'audit_logs', {
        actor_id: entry.actorId,
        actor_role: entry.actorRole,
        action: entry.action,
        entity_type: entry.entityType,
        entity_id: entry.entityId,
        diff: entry.diff,
        reason: entry.reason ?? null,
        ip: entry.ip ?? null,
        request_id: entry.requestId,
        created_at: new Date(entry.nowMs).toISOString(),
      });
      return Number(rows[0]?.id ?? 1);
    },

    async queryAuditLogs(filters) {
      const parts = ['select=*', `limit=${filters.limit}`, 'order=id.desc'];
      if (filters.actorId) parts.push(`actor_id=eq.${encodeURIComponent(filters.actorId)}`);
      if (filters.action) parts.push(`action=eq.${encodeURIComponent(filters.action)}`);
      if (filters.entityType) parts.push(`entity_type=eq.${encodeURIComponent(filters.entityType)}`);
      return t.restGet<readonly Record<string, unknown>[]>(`audit_logs?${parts.join('&')}`);
    },

    async getAuditLogById(id) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>(`audit_logs?select=*&id=eq.${id}&limit=1`);
      return rows[0] ?? null;
    },

    async listPlatformSettings(groupKey) {
      const q = groupKey
        ? `platform_settings?select=*&group_key=eq.${encodeURIComponent(groupKey)}&order=key.asc`
        : 'platform_settings?select=*&order=key.asc';
      return t.restGet<readonly Record<string, unknown>[]>(q);
    },

    async updatePlatformSettings(updates, actorId) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(updates)) {
        const cur = await t.restGet<readonly Record<string, unknown>[]>(
          `platform_settings?select=value&key=eq.${encodeURIComponent(key)}&limit=1`,
        );
        before[key] = cur[0]?.['value'] ?? null;
        await t.restWrite(
          'POST',
          'platform_settings?on_conflict=key',
          {
            key,
            group_key: key.split('.')[0] ?? 'ops',
            value: val,
            value_type: typeof val === 'boolean' ? 'boolean' : typeof val === 'number' ? 'number' : typeof val === 'string' ? 'string' : 'json',
            description_en: `Admin managed key ${key}`,
            updated_by: actorId,
          },
          'resolution=merge-duplicates,return=minimal',
        );
        after[key] = val;
      }
      return { before, after };
    },

    async rollbackPlatformSetting(key, targetVersion, actorId) {
      const q = targetVersion
        ? `platform_settings_history?select=*&setting_key=eq.${encodeURIComponent(key)}&version=eq.${targetVersion}&limit=1`
        : `platform_settings_history?select=*&setting_key=eq.${encodeURIComponent(key)}&order=version.desc&limit=2`;
      const rows = await t.restGet<readonly Record<string, unknown>[]>(q);
      const snap = targetVersion ? rows[0] : rows[1] ?? rows[0];
      if (!snap) return null;
      const targetVal = targetVersion ? snap['new_value'] : snap['previous_value'] ?? snap['new_value'];
      const updated = await t.restWrite<readonly Record<string, unknown>[]>(
        'PATCH',
        `platform_settings?key=eq.${encodeURIComponent(key)}`,
        { value: targetVal, updated_by: actorId },
      );
      return {
        key,
        previousValue: snap['new_value'],
        restoredValue: targetVal,
        newVersion: Number(updated[0]?.['version'] ?? 1),
      };
    },

    async getSystemQuotaSnapshot(nowMs) {
      return {
        sampledAtMs: nowMs,
        postgresFreeCapMb: 500,
        rtdbHardLeaseCap: 85,
        rtdbSparkConnLimit: 100,
        workerDailyFreeReqCap: 100_000,
        supabaseStorageBytes: 0,
      };
    },

    async listClientErrors(statusFilter) {
      const rows = await t.restGet<readonly Record<string, unknown>[]>('client_errors?select=*&order=id.desc&limit=100');
      if (!statusFilter) return rows;
      return rows.filter((r) => ((r['meta'] as Record<string, unknown> | undefined)?.['triage_status'] ?? 'open') === statusFilter);
    },

    async triageClientError(errorId, status, note, actorId) {
      const cur = await t.restGet<readonly Record<string, unknown>[]>(`client_errors?select=*&id=eq.${errorId}&limit=1`);
      if (!cur[0]) return null;
      const meta = { ...((cur[0]['meta'] as Record<string, unknown>) ?? {}), triage_status: status, triage_note: note ?? null, triaged_by: actorId };
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('PATCH', `client_errors?id=eq.${errorId}`, { meta });
      return rows[0] ?? null;
    },

    async listZonesAdmin() {
      const rows = await t.restGet<readonly Record<string, unknown>[]>('zones?select=*&order=name_en.asc');
      return rows.map((r) => ({
        id: String(r['id']),
        nameEn: String(r['name_en']),
        nameBn: String(r['name_bn']),
        slug: String(r['slug']),
        polygon: (r['polygon'] as LngLatPair[]) ?? [],
        areaKm2: Number(r['area_km2'] ?? 0),
        centerLat: Number(r['center_lat'] ?? 0),
        centerLng: Number(r['center_lng'] ?? 0),
        roadFactor: Number(r['road_factor'] ?? 1.35),
        isActive: Boolean(r['is_active']),
        feeOverrides: (r['fee_overrides'] as Record<string, unknown>) ?? {},
        config: (r['config'] as Record<string, unknown>) ?? {},
      }));
    },

    async createZoneAdmin(input) {
      const rows = await t.restWrite<readonly Record<string, unknown>[]>('POST', 'zones', {
        name_en: input.nameEn,
        name_bn: input.nameBn,
        slug: input.slug,
        polygon: input.polygon,
        road_factor: input.roadFactor,
        is_active: input.isActive,
        fee_overrides: input.feeOverrides,
        config: input.config,
      });
      return rows[0]!;
    },

    async updateZoneAdmin(zoneId, patch) {
      const beforeRows = await t.restGet<readonly Record<string, unknown>[]>(`zones?select=*&id=eq.${encodeURIComponent(zoneId)}&limit=1`);
      if (!beforeRows[0]) return null;
      const clean: Record<string, unknown> = { ...patch };
      delete clean['reason'];
      const afterRows = await t.restWrite<readonly Record<string, unknown>[]>('PATCH', `zones?id=eq.${encodeURIComponent(zoneId)}`, clean);
      return { before: beforeRows[0], after: afterRows[0] ?? beforeRows[0] };
    },

    async setZoneWeatherOverride(zoneId, condition, ttlMinutes, nowMs) {
      const payload = {
        zone_id: zoneId,
        condition,
        source: 'admin_override',
        fetched_at: new Date(nowMs).toISOString(),
        expires_at: new Date(nowMs + ttlMinutes * 60_000).toISOString(),
      };
      await t.restWrite('POST', 'weather_cache?on_conflict=zone_id', payload, 'resolution=merge-duplicates,return=minimal');
      return payload;
    },

    async getFarePolicyConfig(): Promise<FarePolicyConfig> {
      return DEFAULT_FARE_POLICY;
    },

    ...createPostgrestAdminOps(t),
  };
}
