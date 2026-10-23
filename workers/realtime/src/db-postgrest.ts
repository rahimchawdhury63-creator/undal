/**
 * @file workers/realtime/src/db-postgrest.ts
 * @description Zero-TCP-socket Supabase PostgREST `/rest/v1/*` + `/rest/v1/rpc/*` production
 * database adapter for `W2 undal-realtime` (`< 260` lines; composes `db-postgrest-dispatch.ts`).
 */

import type { RiderVehicleType } from '@undal/shared-ts';
import { createPostgrestDispatchMethods } from './db-postgrest-dispatch.ts';
import type {
  AccountRole,
  AuthPrincipal,
  PresenceRecord,
  RealtimeDbAdapter,
  RealtimeWorkerEnv,
  RiderSessionPreFlight,
} from './types.ts';

export function createRealtimePostgrestAdapter(env: RealtimeWorkerEnv): RealtimeDbAdapter {
  const baseUrl = (env.SUPABASE_URL ?? 'https://example.supabase.co').replace(/\/$/, '');
  const apiKey = env.SUPABASE_SERVICE_ROLE_KEY ?? 'example-service-role';
  const fetchFn = env.fetchImpl ?? fetch;

  const restHeaders = (extra?: Record<string, string>): Record<string, string> => ({
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(extra ?? {}),
  });

  async function restGet<T>(pathAndQuery: string): Promise<T> {
    const res = await fetchFn(`${baseUrl}/rest/v1/${pathAndQuery}`, { headers: restHeaders() });
    if (!res.ok) throw new Error(`PostgREST GET ${pathAndQuery} failed (${res.status})`);
    return (await res.json()) as T;
  }

  async function restWrite<T>(
    method: 'POST' | 'PATCH' | 'DELETE',
    pathAndQuery: string,
    body?: unknown,
    prefer: string = 'return=representation',
  ): Promise<T> {
    const res = await fetchFn(`${baseUrl}/rest/v1/${pathAndQuery}`, {
      method,
      headers: restHeaders({ Prefer: prefer }),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PostgREST ${method} ${pathAndQuery} failed (${res.status}): ${txt}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  async function rpc<T>(fnName: string, args: Record<string, unknown>): Promise<T> {
    const res = await fetchFn(`${baseUrl}/rest/v1/rpc/${fnName}`, {
      method: 'POST',
      headers: restHeaders(),
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PostgREST RPC ${fnName} failed (${res.status}): ${txt}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    ...createPostgrestDispatchMethods({ restGet, restWrite }),

    async ping(): Promise<boolean> {
      const rows = await restGet<readonly unknown[]>('zones?select=id&limit=1');
      return Array.isArray(rows);
    },

    async getProfileAuthState(userId: string): Promise<AuthPrincipal | null> {
      const rows = await restGet<readonly { id: string; role: AccountRole; status: AuthPrincipal['status']; email: string | null; phone: string | null }[]>(
        `profiles?select=id,role,status,email,phone&id=eq.${encodeURIComponent(userId)}&limit=1`,
      );
      const r = rows[0];
      return r ? { sub: r.id, role: r.role, status: r.status, email: r.email, phone: r.phone } : null;
    },

    async getOperatorIdentity(profileId: string, role: AccountRole) {
      if (role === 'rider') {
        const rows = await restGet<readonly { id: string; home_zone_id: string }[]>(
          `riders?select=id,home_zone_id&profile_id=eq.${encodeURIComponent(profileId)}&deleted_at=is.null&limit=1`,
        );
        return rows[0] ? { kind: 'rider', refId: rows[0].id, zoneId: rows[0].home_zone_id } : null;
      }
      if (role === 'vendor_owner' || role === 'vendor_staff') {
        const owned = await restGet<readonly { id: string; zone_id: string }[]>(
          `vendors?select=id,zone_id&owner_profile_id=eq.${encodeURIComponent(profileId)}&deleted_at=is.null&limit=1`,
        );
        if (owned[0]) return { kind: 'vendor', refId: owned[0].id, zoneId: owned[0].zone_id };
        const staff = await restGet<readonly { vendor_id: string }[]>(
          `vendor_staff_members?select=vendor_id&profile_id=eq.${encodeURIComponent(profileId)}&limit=1`,
        );
        if (staff[0]) {
          const v = await restGet<readonly { id: string; zone_id: string }[]>(
            `vendors?select=id,zone_id&id=eq.${encodeURIComponent(staff[0].vendor_id)}&limit=1`,
          );
          if (v[0]) return { kind: 'vendor', refId: v[0].id, zoneId: v[0].zone_id };
        }
      }
      return null;
    },

    async upsertPresence(profileId, kind, refId, zoneId, input, nowMs): Promise<PresenceRecord> {
      await rpc('upsert_presence_heartbeat', {
        p_profile_id: profileId,
        p_kind: kind,
        p_ref_id: refId,
        p_zone_id: zoneId,
        p_lat: input.lat ?? null,
        p_lng: input.lng ?? null,
        p_heading: input.heading ?? null,
        p_speed_mps: input.speedMps ?? null,
        p_capacity_used: input.capacityUsed ?? 0,
        p_app_state: input.appState ?? 'fg',
        p_battery_pct: input.batteryPct ?? null,
        p_now: new Date(nowMs).toISOString(),
      });
      const rec = await this.getPresence(profileId);
      if (!rec) throw new Error('Presence row missing immediately after upsert');
      return rec;
    },

    async getPresence(profileId: string): Promise<PresenceRecord | null> {
      const rows = await restGet<readonly Record<string, unknown>[]>(
        `presence_live?select=*&profile_id=eq.${encodeURIComponent(profileId)}&limit=1`,
      );
      const r = rows[0];
      if (!r) return null;
      return {
        profileId: String(r['profile_id']),
        kind: r['kind'] as 'vendor' | 'rider',
        refId: String(r['ref_id']),
        zoneId: String(r['zone_id']),
        lat: r['lat'] !== null && r['lat'] !== undefined ? Number(r['lat']) : null,
        lng: r['lng'] !== null && r['lng'] !== undefined ? Number(r['lng']) : null,
        geohash: r['geohash'] ? String(r['geohash']) : null,
        heading: r['heading'] !== null && r['heading'] !== undefined ? Number(r['heading']) : null,
        speedMps: r['speed_mps'] !== null && r['speed_mps'] !== undefined ? Number(r['speed_mps']) : null,
        capacityUsed: Number(r['capacity_used'] ?? 0),
        appState: (r['app_state'] as 'fg' | 'bg' | 'alarm_service') ?? 'fg',
        batteryPct: r['battery_pct'] !== null && r['battery_pct'] !== undefined ? Number(r['battery_pct']) : null,
        lastSeenAtMs: new Date(String(r['last_seen_at'])).getTime(),
      };
    },

    async getRiderPreFlight(profileId: string): Promise<RiderSessionPreFlight | null> {
      const riders = await restGet<readonly Record<string, unknown>[]>(
        `riders?select=*&profile_id=eq.${encodeURIComponent(profileId)}&deleted_at=is.null&limit=1`,
      );
      const r = riders[0];
      if (!r) return null;
      const riderId = String(r['id']);
      await rpc('sync_rider_cash_gate', { p_rider_id: riderId }).catch(() => null);
      const [refreshed, balRows, docs] = await Promise.all([
        restGet<readonly Record<string, unknown>[]>(`riders?select=*&id=eq.${encodeURIComponent(riderId)}&limit=1`),
        restGet<readonly Record<string, unknown>[]>(`rider_cash_balance_v?select=*&rider_id=eq.${encodeURIComponent(riderId)}&limit=1`),
        restGet<readonly Record<string, unknown>[]>(`rider_documents?select=doc_type,review_status,expires_on&rider_id=eq.${encodeURIComponent(riderId)}`),
      ]);
      const row = refreshed[0] ?? r;
      const bal = balRows[0];
      const todayDhaka = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
      const hasValidDrivingLicense = docs.some(
        (d) =>
          d['doc_type'] === 'driving_license' &&
          d['review_status'] === 'approved' &&
          (!d['expires_on'] || String(d['expires_on']) >= todayDhaka),
      );
      return {
        riderId,
        profileId,
        vehicleType: row['vehicle_type'] as RiderVehicleType,
        dateOfBirthIso: String(row['date_of_birth']),
        kycStatus: String(row['kyc_status']),
        isActive: Boolean(row['is_active']),
        isOnline: Boolean(row['is_online']),
        cashGateBlocked: Boolean(row['cash_gate_blocked']),
        homeZoneId: String(row['home_zone_id']),
        hasValidDrivingLicense,
        unremittedCashPoisha: Number(bal?.['unremitted_cash_poisha'] ?? 0),
        cashCeilingPoisha: Number(bal?.['ceiling_poisha'] ?? 500_000),
        warn80Pct: Boolean(bal?.['warn_80pct'] ?? false),
      };
    },

    async hasFreshShiftSelfie(profileId: string, storagePath: string): Promise<boolean> {
      const rows = await restGet<readonly Record<string, unknown>[]>(
        `media_assets?select=id&owner_profile_id=eq.${encodeURIComponent(profileId)}&category=eq.rider_shift_selfie&cloudinary_public_id=eq.${encodeURIComponent(storagePath)}&limit=1`,
      );
      return rows.length > 0;
    },

    async startRiderShift(params) {
      const nowIso = new Date(params.nowMs).toISOString();
      await restWrite(
        'PATCH',
        `rider_shifts?rider_id=eq.${encodeURIComponent(params.riderId)}&ended_at=is.null`,
        { ended_at: nowIso, end_reason: 'normal' },
      );
      const inserted = await restWrite<readonly { id: string; started_at: string }[]>('POST', 'rider_shifts', {
        rider_id: params.riderId,
        zone_id: params.zoneId,
        started_at: nowIso,
        vehicle_confirmed: params.vehicleType,
        start_selfie_path: params.selfiePath,
      });
      await restWrite('PATCH', `riders?id=eq.${encodeURIComponent(params.riderId)}`, { is_online: true });
      await this.upsertPresence(
        params.profileId,
        'rider',
        params.riderId,
        params.zoneId,
        { kind: 'rider', lat: params.lat, lng: params.lng, capacityUsed: 0, appState: 'fg' },
        params.nowMs,
      );
      return { shiftId: inserted[0]!.id, startedAtIso: inserted[0]!.started_at };
    },

    async endRiderShift(params) {
      const nowIso = new Date(params.nowMs).toISOString();
      const updatedShifts = await restWrite<readonly { id: string }[]>(
        'PATCH',
        `rider_shifts?rider_id=eq.${encodeURIComponent(params.riderId)}&ended_at=is.null`,
        { ended_at: nowIso, end_reason: params.endReason },
      );
      const balRows = await restGet<readonly Record<string, unknown>[]>(
        `rider_cash_balance_v?select=*&rider_id=eq.${encodeURIComponent(params.riderId)}&limit=1`,
      );
      const unremitted = Number(balRows[0]?.['unremitted_cash_poisha'] ?? 0);
      const ceiling = Number(balRows[0]?.['ceiling_poisha'] ?? 500_000);
      const shouldBlock = unremitted > 0;
      await restWrite('PATCH', `riders?id=eq.${encodeURIComponent(params.riderId)}`, {
        is_online: false,
        cash_gate_blocked: shouldBlock,
      });
      return {
        shiftEnded: updatedShifts.length > 0,
        unremittedCashPoisha: unremitted,
        cashCeilingPoisha: ceiling,
        cashGateBlocked: shouldBlock,
      };
    },
  };
}
