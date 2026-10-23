/**
 * @file workers/realtime/src/routes/presence-session.ts
 * @description Operator presence heartbeat (`POST /v1/presence/ping`) and Rider pre-flight session
 * start/end (`POST /v1/riders/session/start`, `POST /v1/riders/session/end`) routes on `W2 undal-realtime`
 * (`Master Guide File 06`, `File 12 §12.1`, `File 14 §14.6`, `File 23 §23.2`, `CSH-01`, `CSH-02`).
 */

import { errEnvelope, okEnvelope } from '@undal/shared-ts';
import { isValidCoord } from '../geo.ts';
import { checkRateLimit, executeIdempotent, jsonErr, jsonOk } from '../http.ts';
import { classifyPresence, recommendedHeartbeatSeconds } from '../presence.ts';
import type { AuthPrincipal, RealtimeDbAdapter } from '../types.ts';

/** Handles `POST /v1/presence/ping`, `POST /v1/riders/session/start`, and `POST /v1/riders/session/end`. */
export async function handlePresenceAndSessionRoutes(params: {
  readonly request: Request;
  readonly pathname: string;
  readonly requestId: string;
  readonly principal: AuthPrincipal | null;
  readonly db: RealtimeDbAdapter;
  readonly nowMs: number;
}): Promise<Response | null> {
  const { request, pathname, requestId, principal, db, nowMs } = params;

  if (request.method === 'POST' && pathname === '/v1/presence/ping') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (
      principal.role !== 'vendor_owner' &&
      principal.role !== 'vendor_staff' &&
      principal.role !== 'rider'
    ) {
      return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    }
    const rl = checkRateLimit(`pres:${principal.sub}`, 20, 60_000, nowMs);
    if (!rl.allowed) {
      return jsonErr('RATE_LIMITED', requestId, undefined, { 'Retry-After': String(rl.retryAfterSeconds) });
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return jsonErr('VALIDATION_FAILED', requestId);
    }

    const identity = await db.getOperatorIdentity(principal.sub, principal.role);
    if (!identity) return jsonErr('AUTH_ROLE_MISMATCH', requestId);

    const hasLat = body['lat'] !== undefined && body['lat'] !== null;
    const hasLng = body['lng'] !== undefined && body['lng'] !== null;
    if (identity.kind === 'rider' && (!hasLat || !hasLng)) {
      return jsonErr('LOCATION_REQUIRED', requestId);
    }
    if ((hasLat || hasLng) && !isValidCoord(body['lat'], body['lng'])) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'lat/lng' });
    }
    const accuracyM = typeof body['accuracy_m'] === 'number' ? body['accuracy_m'] : 15;
    if (!Number.isFinite(accuracyM) || accuracyM < 0) {
      return jsonErr('VALIDATION_FAILED', requestId, { field: 'accuracy_m' });
    }

    const appStateRaw = body['app_state'];
    const appState: 'fg' | 'bg' | 'alarm_service' =
      appStateRaw === 'bg' || appStateRaw === 'alarm_service' ? appStateRaw : 'fg';
    const capacityUsed =
      typeof body['capacity_used'] === 'number' && Number.isInteger(body['capacity_used'])
        ? Math.min(3, Math.max(0, body['capacity_used']))
        : 0;

    const record = await db.upsertPresence(
      principal.sub,
      identity.kind,
      identity.refId,
      identity.zoneId,
      {
        kind: identity.kind,
        ...(hasLat ? { lat: Number(body['lat']) } : {}),
        ...(hasLng ? { lng: Number(body['lng']) } : {}),
        accuracyM,
        ...(typeof body['heading'] === 'number' ? { heading: body['heading'] } : {}),
        ...(typeof body['speed_mps'] === 'number' ? { speedMps: body['speed_mps'] } : {}),
        capacityUsed,
        appState,
        ...(typeof body['battery_pct'] === 'number' ? { batteryPct: Math.round(body['battery_pct']) } : {}),
      },
      nowMs,
    );

    return jsonOk(
      {
        status: classifyPresence(record.lastSeenAtMs, nowMs),
        zone_id: record.zoneId,
        geohash: record.geohash,
        gps_quality_warning: accuracyM > 100,
        next_ping_seconds: recommendedHeartbeatSeconds({
          kind: identity.kind,
          appState,
          capacityUsed,
        }),
        last_seen_at: new Date(record.lastSeenAtMs).toISOString(),
      },
      requestId,
    );
  }

  if (request.method === 'POST' && pathname === '/v1/riders/session/start') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (principal.role !== 'rider') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    const rawBody = await request.text();

    return executeIdempotent({
      request,
      rawBody,
      actorId: principal.sub,
      endpoint: pathname,
      requestId,
      db,
      nowMs,
      handler: async () => {
        let body: Record<string, unknown>;
        try {
          body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
        } catch {
          return errEnvelope('VALIDATION_FAILED', requestId);
        }

        const pre = await db.getRiderPreFlight(principal.sub);
        if (!pre || pre.kycStatus !== 'approved' || !pre.isActive) {
          return errEnvelope('KYC_INCOMPLETE', requestId, { reason: 'kyc_not_approved' });
        }
        if (pre.vehicleType === 'motorbike' && !pre.hasValidDrivingLicense) {
          return errEnvelope('KYC_INCOMPLETE', requestId, { reason: 'driving_license_missing_or_expired' });
        }
        if (pre.cashGateBlocked || pre.unremittedCashPoisha >= pre.cashCeilingPoisha) {
          return errEnvelope('CASH_GATE_ACTIVE', requestId, {
            unremitted_cash_poisha: pre.unremittedCashPoisha,
            ceiling_poisha: pre.cashCeilingPoisha,
          });
        }

        const lat = body['lat'];
        const lng = body['lng'];
        if (!isValidCoord(lat, lng)) {
          return errEnvelope('LOCATION_REQUIRED', requestId);
        }
        const accuracyM = typeof body['accuracy_m'] === 'number' ? body['accuracy_m'] : 15;
        if (accuracyM > 50) {
          return errEnvelope('GPS_INACCURATE', requestId, { accuracy_m: accuracyM, max_allowed_m: 50 });
        }

        const selfiePath = typeof body['selfie_public_id'] === 'string' ? body['selfie_public_id'].trim() : '';
        if (!selfiePath || !(await db.hasFreshShiftSelfie(principal.sub, selfiePath, nowMs))) {
          return errEnvelope('KYC_INCOMPLETE', requestId, { reason: 'shift_selfie_required' });
        }

        const started = await db.startRiderShift({
          riderId: pre.riderId,
          zoneId: pre.homeZoneId,
          vehicleType: pre.vehicleType,
          selfiePath,
          lat: Number(lat),
          lng: Number(lng),
          profileId: principal.sub,
          nowMs,
        });

        return {
          status: 200,
          body: okEnvelope(
            {
              shift_id: started.shiftId,
              rider_id: pre.riderId,
              zone_id: pre.homeZoneId,
              vehicle_type: pre.vehicleType,
              started_at: started.startedAtIso,
              cash_in_hand_poisha: pre.unremittedCashPoisha,
              cash_ceiling_poisha: pre.cashCeilingPoisha,
              warn_80pct: pre.warn80Pct,
              status: 'ONLINE',
            },
            requestId,
          ),
        };
      },
    });
  }

  if (request.method === 'POST' && pathname === '/v1/riders/session/end') {
    if (!principal) return jsonErr('SESSION_EXPIRED', requestId);
    if (principal.role !== 'rider') return jsonErr('AUTH_ROLE_MISMATCH', requestId);
    const rawBody = await request.text();

    return executeIdempotent({
      request,
      rawBody,
      actorId: principal.sub,
      endpoint: pathname,
      requestId,
      db,
      nowMs,
      handler: async () => {
        const pre = await db.getRiderPreFlight(principal.sub);
        if (!pre) return errEnvelope('AUTH_ROLE_MISMATCH', requestId);

        const ended = await db.endRiderShift({
          riderId: pre.riderId,
          endReason: pre.unremittedCashPoisha > 0 ? 'cash_gate' : 'normal',
          nowMs,
        });

        return {
          status: 200,
          body: okEnvelope(
            {
              rider_id: pre.riderId,
              shift_ended: ended.shiftEnded,
              status: 'OFFLINE',
              unremitted_cash_poisha: ended.unremittedCashPoisha,
              cash_ceiling_poisha: ended.cashCeilingPoisha,
              cash_gate_blocked: ended.cashGateBlocked,
              remittance_required: ended.unremittedCashPoisha > 0,
            },
            requestId,
          ),
        };
      },
    });
  }

  return null;
}
