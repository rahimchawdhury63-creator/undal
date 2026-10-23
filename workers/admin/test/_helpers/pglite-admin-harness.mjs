/**
 * @file workers/admin/test/_helpers/pglite-admin-harness.mjs
 * @description Real PostgreSQL 16 (`PGlite` WASM + `pg_trgm`) harness applying all `16 / 16`
 * production migrations and implementing `AdminDbAdapter` directly over live SQL tables, triggers,
 * views, and double-entry ledger invariants (`0` fake SQL mocks!).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { DEFAULT_FARE_POLICY } from '@undal/shared-ts';
import { buildPgliteAdminOpsMethods } from './pglite-admin-harness-ops.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
export const EXAMPLE_ADMIN_JWT_SECRET = 'example-undal-w3-jwt-secret-32-chars!!';
export const EXAMPLE_ADMIN_TOTP_PEPPER = 'example-undal-w3-totp-pepper-32-chars!!';
export const EXAMPLE_CLOUDINARY_SECRET = 'example-cloudinary-api-secret-key';

/** Boots a fresh PostgreSQL 16 (`PGlite`) instance with all `16 / 16` production migrations. */
export async function bootRealAdminPostgres() {
  const db = new PGlite({ extensions: { pg_trgm } });
  await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests/_bootstrap_supabase_local.sql'), 'utf8'));
  const files = fs
    .readdirSync(path.join(REPO_ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations', file), 'utf8'));
  }
  return db;
}

/** Wraps real PostgreSQL 16 (`PGlite`) as `AdminDbAdapter` for `W3 undal-admin` E2E tests. */
export function createPgliteAdminAdapter(db) {
  return {
    async getAdminPrincipal(profileId) {
      const p = (
        await db.query(
          'SELECT id, role, full_name, email, phone, status, totp_enrolled_at FROM public.profiles WHERE id = $1 LIMIT 1',
          [profileId],
        )
      ).rows[0];
      if (!p || p.role !== 'admin') return null;

      const rRows = (
        await db.query(
          `SELECT ar.id, ar.key
           FROM public.admin_user_roles aur
           JOIN public.admin_roles ar ON ar.id = aur.role_id
           WHERE aur.profile_id = $1`,
          [profileId],
        )
      ).rows;
      const roleIds = rRows.map((r) => r.id);
      let permissions = [];
      if (roleIds.length > 0) {
        permissions = (
          await db.query(
            'SELECT DISTINCT permission FROM public.admin_permissions WHERE role_id = ANY($1::uuid[])',
            [roleIds],
          )
        ).rows.map((r) => String(r.permission));
      }
      return {
        profileId: String(p.id),
        fullName: String(p.full_name),
        email: p.email ? String(p.email) : null,
        phone: p.phone ? String(p.phone) : null,
        status: p.status,
        totpEnrolledAtMs: p.totp_enrolled_at ? new Date(p.totp_enrolled_at).getTime() : null,
        roleKeys: rRows.map((r) => String(r.key)),
        permissions,
      };
    },

    async enrollAdminTotp(profileId, nowMs) {
      await db.query('UPDATE public.profiles SET totp_enrolled_at = $2 WHERE id = $1', [
        profileId,
        new Date(nowMs).toISOString(),
      ]);
    },

    async listAdminUsers() {
      return (
        await db.query(
          `SELECT id, full_name, email, phone, status, totp_enrolled_at, created_at
           FROM public.profiles WHERE role = 'admin' ORDER BY created_at ASC`,
        )
      ).rows;
    },

    async upsertAdminUser(input) {
      const id = input.profileId ?? crypto.randomUUID();
      await db.query('INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
        id,
        input.email,
      ]);
      const r = (
        await db.query(
          `INSERT INTO public.profiles (id, role, full_name, email, phone, status)
           VALUES ($1, 'admin', $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             role = 'admin', full_name = EXCLUDED.full_name, email = EXCLUDED.email,
             phone = coalesce(EXCLUDED.phone, public.profiles.phone), status = EXCLUDED.status
           RETURNING *`,
          [id, input.fullName, input.email, input.phone ?? null, input.status],
        )
      ).rows[0];
      return r;
    },

    async setAdminUserRoles(profileId, roleKeys, grantedBy) {
      await db.query('DELETE FROM public.admin_user_roles WHERE profile_id = $1', [profileId]);
      if (roleKeys.length === 0) return [];
      const found = (
        await db.query('SELECT id, key FROM public.admin_roles WHERE key = ANY($1::text[])', [roleKeys])
      ).rows;
      for (const r of found) {
        await db.query(
          'INSERT INTO public.admin_user_roles (profile_id, role_id, granted_by) VALUES ($1, $2, $3)',
          [profileId, r.id, grantedBy],
        );
      }
      return found.map((r) => String(r.key));
    },

    async resetAdminUserTotp(profileId) {
      await db.query('UPDATE public.profiles SET totp_enrolled_at = NULL WHERE id = $1', [profileId]);
    },

    async listAdminRoles() {
      const roles = (await db.query('SELECT * FROM public.admin_roles ORDER BY key ASC')).rows;
      const perms = (await db.query('SELECT role_id, permission FROM public.admin_permissions')).rows;
      const links = (await db.query('SELECT role_id FROM public.admin_user_roles')).rows;
      return roles.map((r) => ({
        id: String(r.id),
        key: String(r.key),
        nameEn: String(r.name_en),
        nameBn: String(r.name_bn),
        isSystem: Boolean(r.is_system),
        permissions: perms.filter((p) => p.role_id === r.id).map((p) => String(p.permission)),
        assignedCount: links.filter((l) => l.role_id === r.id).length,
      }));
    },

    async createAdminRole(input) {
      const row = (
        await db.query(
          `INSERT INTO public.admin_roles (key, name_en, name_bn, description_en, is_system)
           VALUES ($1, $2, $3, $4, false) RETURNING id`,
          [input.key, input.nameEn, input.nameBn, input.descriptionEn ?? null],
        )
      ).rows[0];
      for (const perm of input.permissions) {
        await db.query('INSERT INTO public.admin_permissions (role_id, permission) VALUES ($1, $2)', [
          row.id,
          perm,
        ]);
      }
      return { id: String(row.id), key: input.key, permissions: input.permissions };
    },

    async setRolePermissions(roleId, permissions) {
      await db.query('DELETE FROM public.admin_permissions WHERE role_id = $1', [roleId]);
      const unique = [...new Set(permissions)];
      for (const perm of unique) {
        await db.query('INSERT INTO public.admin_permissions (role_id, permission) VALUES ($1, $2)', [
          roleId,
          perm,
        ]);
      }
      return unique;
    },

    async appendAuditLog(entry) {
      const r = (
        await db.query(
          `INSERT INTO public.audit_logs (
             actor_id, actor_role, action, entity_type, entity_id, diff, reason, ip, request_id, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING id`,
          [
            entry.actorId,
            entry.actorRole,
            entry.action,
            entry.entityType,
            entry.entityId,
            JSON.stringify(entry.diff),
            entry.reason ?? null,
            entry.ip ?? null,
            entry.requestId,
            new Date(entry.nowMs).toISOString(),
          ],
        )
      ).rows[0];
      return Number(r.id);
    },

    async queryAuditLogs(filters) {
      const clauses = [];
      const vals = [];
      if (filters.actorId) {
        vals.push(filters.actorId);
        clauses.push(`actor_id = $${vals.length}`);
      }
      if (filters.action) {
        vals.push(filters.action);
        clauses.push(`action = $${vals.length}`);
      }
      if (filters.entityType) {
        vals.push(filters.entityType);
        clauses.push(`entity_type = $${vals.length}`);
      }
      vals.push(filters.limit);
      const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
      return (await db.query(`SELECT * FROM public.audit_logs ${where} ORDER BY id DESC LIMIT $${vals.length}`, vals)).rows;
    },

    async getAuditLogById(id) {
      return (await db.query('SELECT * FROM public.audit_logs WHERE id = $1 LIMIT 1', [id])).rows[0] ?? null;
    },

    async listPlatformSettings(groupKey) {
      if (groupKey) {
        return (await db.query('SELECT * FROM public.platform_settings WHERE group_key = $1 ORDER BY key ASC', [groupKey])).rows;
      }
      return (await db.query('SELECT * FROM public.platform_settings ORDER BY key ASC')).rows;
    },

    async updatePlatformSettings(updates, actorId) {
      const before = {};
      const after = {};
      for (const [k, v] of Object.entries(updates)) {
        const cur = (await db.query('SELECT value FROM public.platform_settings WHERE key = $1 LIMIT 1', [k])).rows[0];
        before[k] = cur ? cur.value : null;
        const vType = typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'json';
        await db.query(
          `INSERT INTO public.platform_settings (key, group_key, value, value_type, description_en, updated_by)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by`,
          [k, k.split('.')[0] ?? 'ops', JSON.stringify(v), vType, `Admin managed setting ${k}`, actorId],
        );
        after[k] = v;
      }
      return { before, after };
    },

    async rollbackPlatformSetting(key, targetVersion, actorId) {
      const snap = targetVersion
        ? (
            await db.query(
              'SELECT * FROM public.platform_settings_history WHERE setting_key = $1 AND version = $2 LIMIT 1',
              [key, targetVersion],
            )
          ).rows[0]
        : (
            await db.query(
              'SELECT * FROM public.platform_settings_history WHERE setting_key = $1 ORDER BY version DESC LIMIT 1',
              [key],
            )
          ).rows[0];
      if (!snap) return null;
      const targetVal = targetVersion ? snap.new_value : snap.previous_value ?? snap.new_value;
      const upd = (
        await db.query(
          'UPDATE public.platform_settings SET value = $2::jsonb, updated_by = $3 WHERE key = $1 RETURNING version',
          [key, JSON.stringify(targetVal), actorId],
        )
      ).rows[0];
      return {
        key,
        previousValue: snap.new_value,
        restoredValue: targetVal,
        newVersion: Number(upd?.version ?? 1),
      };
    },

    async getSystemQuotaSnapshot(nowMs) {
      const counts = (
        await db.query(
          `SELECT
             (SELECT count(*)::int FROM public.orders) AS orders_count,
             (SELECT count(*)::int FROM public.media_assets WHERE provider = 'imgbb') AS imgbb_public_assets,
             (SELECT count(*)::int FROM public.media_assets WHERE provider = 'cloudinary') AS cloudinary_private_assets`,
        )
      ).rows[0];
      return {
        sampledAtMs: nowMs,
        postgresFreeCapMb: 500,
        rtdbHardLeaseCap: 85,
        rtdbSparkConnLimit: 100,
        supabaseStorageBytes: 0,
        ...counts,
      };
    },

    async listClientErrors(statusFilter) {
      const rows = (await db.query('SELECT * FROM public.client_errors ORDER BY id DESC LIMIT 100')).rows;
      if (!statusFilter) return rows;
      return rows.filter((r) => (r.meta?.triage_status ?? 'open') === statusFilter);
    },

    async triageClientError(errorId, status, note, actorId) {
      const cur = (await db.query('SELECT * FROM public.client_errors WHERE id = $1 LIMIT 1', [errorId])).rows[0];
      if (!cur) return null;
      const meta = { ...(cur.meta ?? {}), triage_status: status, triage_note: note ?? null, triaged_by: actorId };
      return (await db.query('UPDATE public.client_errors SET meta = $2::jsonb WHERE id = $1 RETURNING *', [errorId, JSON.stringify(meta)])).rows[0];
    },

    async listZonesAdmin() {
      const rows = (await db.query('SELECT * FROM public.zones ORDER BY name_en ASC')).rows;
      return rows.map((r) => ({
        id: String(r.id),
        nameEn: String(r.name_en),
        nameBn: String(r.name_bn),
        slug: String(r.slug),
        polygon: r.polygon,
        areaKm2: Number(r.area_km2),
        centerLat: Number(r.center_lat),
        centerLng: Number(r.center_lng),
        roadFactor: Number(r.road_factor),
        isActive: Boolean(r.is_active),
        feeOverrides: r.fee_overrides ?? {},
        config: r.config ?? {},
      }));
    },

    async createZoneAdmin(input) {
      return (
        await db.query(
          `INSERT INTO public.zones (name_en, name_bn, slug, polygon, road_factor, is_active, fee_overrides, config)
           VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb) RETURNING *`,
          [
            input.nameEn,
            input.nameBn,
            input.slug,
            JSON.stringify(input.polygon),
            input.roadFactor,
            input.isActive,
            JSON.stringify(input.feeOverrides),
            JSON.stringify(input.config),
          ],
        )
      ).rows[0];
    },

    async updateZoneAdmin(zoneId, patch) {
      const before = (await db.query('SELECT * FROM public.zones WHERE id = $1 LIMIT 1', [zoneId])).rows[0];
      if (!before) return null;
      const after = (
        await db.query(
          `UPDATE public.zones SET
             name_en = coalesce($2, name_en),
             name_bn = coalesce($3, name_bn),
             polygon = coalesce($4::jsonb, polygon),
             road_factor = coalesce($5, road_factor),
             is_active = coalesce($6, is_active),
             fee_overrides = coalesce($7::jsonb, fee_overrides),
             config = coalesce($8::jsonb, config)
           WHERE id = $1 RETURNING *`,
          [
            zoneId,
            patch.name_en ?? null,
            patch.name_bn ?? null,
            patch.polygon ? JSON.stringify(patch.polygon) : null,
            patch.road_factor ?? null,
            patch.is_active ?? null,
            patch.fee_overrides ? JSON.stringify(patch.fee_overrides) : null,
            patch.config ? JSON.stringify(patch.config) : null,
          ],
        )
      ).rows[0];
      return { before, after };
    },

    async setZoneWeatherOverride(zoneId, condition, ttlMinutes, nowMs) {
      return (
        await db.query(
          `INSERT INTO public.weather_cache (zone_id, condition, source, fetched_at, expires_at)
           VALUES ($1, $2, 'admin_override', $3, $4)
           ON CONFLICT (zone_id) DO UPDATE SET
             condition = EXCLUDED.condition, source = 'admin_override',
             fetched_at = EXCLUDED.fetched_at, expires_at = EXCLUDED.expires_at
           RETURNING *`,
          [zoneId, condition, new Date(nowMs).toISOString(), new Date(nowMs + ttlMinutes * 60_000).toISOString()],
        )
      ).rows[0];
    },

    async getFarePolicyConfig() {
      const rows = (await db.query(`SELECT key, value FROM public.platform_settings WHERE group_key = 'fare'`)).rows;
      const map = Object.fromEntries(rows.map((r) => [r.key, Number(r.value)]));
      return {
        ...DEFAULT_FARE_POLICY,
        baseMotorbikePoisha: map['fare.base_motorbike_poisha'] ?? DEFAULT_FARE_POLICY.baseMotorbikePoisha,
        baseBicyclePoisha: map['fare.base_bicycle_poisha'] ?? DEFAULT_FARE_POLICY.baseBicyclePoisha,
      };
    },

    ...buildPgliteAdminOpsMethods(db),
  };
}
