/**
 * @file workers/admin/src/http.ts
 * @description 4-Gate Super-Admin HTTP Security Pipeline (`06-api-contract-final.md §3`,
 * `File 09 §9.2–9.4`), Session Revocation Registry (`C7–C9`), and Standard Envelope Helpers:
 *   Gate 1 -> Verify HS256 Supabase Bearer JWT + check non-revoked `sessionId` (`jti` or token digest)
 *   Gate 2 -> Verify `profiles.role === 'admin'`, `status === 'active'`, AND `totp_enrolled_at != null`
 *   Gate 3 -> Verify granular `Appendix C` RBAC permission (`AUTH_FORBIDDEN_PERMISSION` `403`)
 *   Gate 4 -> Verify `5-minute` `X-Undal-Step-Up` token when `requireStepUp === true` (`AUTH_STEP_UP_REQUIRED` `403`)
 */

import { errEnvelope, okEnvelope, type UndalErrorCode } from '@undal/shared-ts';
import { hasAdminPermission } from './rbac.ts';
import { verifyStepUpToken } from './totp.ts';
import type { AdminDbAdapter, AdminPrincipal, AdminWorkerEnv } from './types.ts';

export const ADMIN_CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Idempotency-Key, X-Undal-Step-Up, X-Request-Id',
};

export interface AdminSessionMeta {
  readonly sessionId: string;
  readonly profileId: string;
  readonly ip: string;
  readonly userAgent: string;
  readonly lastSeenAtMs: number;
  readonly revokedAtMs: number | null;
}

export interface LoginAttemptEntry {
  readonly profileId: string | null;
  readonly ip: string;
  readonly outcome: 'ok' | 'jwt_invalid' | 'suspended' | 'role_mismatch' | 'totp_missing' | 'session_revoked';
  readonly atMs: number;
}

const SESSION_REGISTRY = new Map<string, AdminSessionMeta>();
const LOGIN_HISTORY: LoginAttemptEntry[] = [];

/** Resets in-memory session & login history registries for deterministic test isolation. */
export function resetAdminSessionRegistry(): void {
  SESSION_REGISTRY.clear();
  LOGIN_HISTORY.length = 0;
}

export function listTrackedSessions(): readonly AdminSessionMeta[] {
  return [...SESSION_REGISTRY.values()].sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs);
}

export function revokeTrackedSession(sessionId: string, nowMs: number): AdminSessionMeta | null {
  const cur = SESSION_REGISTRY.get(sessionId);
  if (!cur) {
    const tombstone: AdminSessionMeta = {
      sessionId,
      profileId: 'unknown',
      ip: '0.0.0.0',
      userAgent: 'revoked',
      lastSeenAtMs: nowMs,
      revokedAtMs: nowMs,
    };
    SESSION_REGISTRY.set(sessionId, tombstone);
    return tombstone;
  }
  const updated: AdminSessionMeta = { ...cur, revokedAtMs: nowMs };
  SESSION_REGISTRY.set(sessionId, updated);
  return updated;
}

export function listLoginHistory(): readonly LoginAttemptEntry[] {
  return [...LOGIN_HISTORY].reverse();
}

export function adminJsonOk<T>(data: T, requestId: string, status = 200): Response {
  return Response.json(okEnvelope(data, requestId), {
    status,
    headers: ADMIN_CORS_HEADERS,
  });
}

export function adminJsonErr(
  code: UndalErrorCode,
  requestId: string,
  details?: Record<string, unknown>,
  statusOverride?: number,
): Response {
  const built = errEnvelope(code, requestId, details);
  return Response.json(built.body, {
    status: statusOverride ?? built.status,
    headers: ADMIN_CORS_HEADERS,
  });
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function utf8Base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Signs an `HS256` JWT (used in integration tests and token fixtures). */
export async function signAdminHs256Jwt(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const header = utf8Base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = utf8Base64Url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)),
  );
  let bin = '';
  for (let i = 0; i < sig.length; i += 1) bin += String.fromCharCode(sig[i]!);
  return `${header}.${body}.${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

async function verifyHs256Jwt(
  token: string,
  secret: string,
  nowMs: number,
): Promise<{ readonly sub: string; readonly jti: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlToBytes(s) as BufferSource,
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(p))) as {
      sub?: string;
      exp?: number;
      jti?: string;
    };
    if (!payload.sub) return null;
    if (typeof payload.exp === 'number' && payload.exp * 1_000 <= nowMs) return null;
    return { sub: payload.sub, jti: payload.jti ?? `sess-${payload.sub.slice(0, 8)}-${s.slice(0, 10)}` };
  } catch {
    return null;
  }
}

export type AdminAuthGuardResult =
  | { readonly ok: true; readonly principal: AdminPrincipal; readonly ip: string }
  | { readonly ok: false; readonly response: Response };

/**
 * Authenticates bearer JWT (`Gate 1` + `Gate 2`). Set `allowMissingTotpEnrollment: true` ONLY on
 * `POST /v1/admin/auth/totp/enroll` so newly created admins can complete initial TOTP enrollment.
 */
export async function authenticateAdminRequest(params: {
  readonly request: Request;
  readonly requestId: string;
  readonly env: AdminWorkerEnv;
  readonly db: AdminDbAdapter;
  readonly nowMs: number;
  readonly allowMissingTotpEnrollment?: boolean;
}): Promise<AdminAuthGuardResult> {
  const { request, requestId, env, db, nowMs } = params;
  const ip = request.headers.get('cf-connecting-ip') ?? '127.0.0.1';
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ') || !env.SUPABASE_JWT_SECRET) {
    LOGIN_HISTORY.push({ profileId: null, ip, outcome: 'jwt_invalid', atMs: nowMs });
    return { ok: false, response: adminJsonErr('AUTH_FORBIDDEN_PERMISSION', requestId) };
  }

  const verified = await verifyHs256Jwt(authHeader.slice(7).trim(), env.SUPABASE_JWT_SECRET, nowMs);
  if (!verified) {
    LOGIN_HISTORY.push({ profileId: null, ip, outcome: 'jwt_invalid', atMs: nowMs });
    return { ok: false, response: adminJsonErr('SESSION_EXPIRED', requestId) };
  }

  const existingSess = SESSION_REGISTRY.get(verified.jti);
  if (existingSess?.revokedAtMs) {
    LOGIN_HISTORY.push({ profileId: verified.sub, ip, outcome: 'session_revoked', atMs: nowMs });
    return { ok: false, response: adminJsonErr('SESSION_EXPIRED', requestId, { reason: 'session_revoked' }) };
  }

  const record = await db.getAdminPrincipal(verified.sub);
  if (!record) {
    LOGIN_HISTORY.push({ profileId: verified.sub, ip, outcome: 'role_mismatch', atMs: nowMs });
    return { ok: false, response: adminJsonErr('AUTH_ROLE_MISMATCH', requestId) };
  }
  if (record.status !== 'active') {
    LOGIN_HISTORY.push({ profileId: verified.sub, ip, outcome: 'suspended', atMs: nowMs });
    return { ok: false, response: adminJsonErr('AUTH_ACCOUNT_SUSPENDED', requestId) };
  }
  if (!params.allowMissingTotpEnrollment && record.totpEnrolledAtMs === null) {
    LOGIN_HISTORY.push({ profileId: verified.sub, ip, outcome: 'totp_missing', atMs: nowMs });
    return { ok: false, response: adminJsonErr('AUTH_TOTP_REQUIRED', requestId) };
  }

  SESSION_REGISTRY.set(verified.jti, {
    sessionId: verified.jti,
    profileId: verified.sub,
    ip,
    userAgent: request.headers.get('user-agent') ?? 'undal-admin-web',
    lastSeenAtMs: nowMs,
    revokedAtMs: null,
  });
  LOGIN_HISTORY.push({ profileId: verified.sub, ip, outcome: 'ok', atMs: nowMs });

  return {
    ok: true,
    principal: { ...record, sessionId: verified.jti },
    ip,
  };
}

/** Enforces `Gate 3` (`RBAC`) + `Gate 4` (`5-min Step-Up TOTP`) in one call (`06-api-contract-final.md §3`). */
export async function authorizeAdminCapability(params: {
  readonly request: Request;
  readonly requestId: string;
  readonly principal: AdminPrincipal;
  readonly permission: string;
  readonly mode: 'read' | 'write';
  readonly requireStepUp?: boolean;
  readonly env: AdminWorkerEnv;
  readonly nowMs: number;
}): Promise<Response | null> {
  const allowed = hasAdminPermission({
    roleKeys: params.principal.roleKeys,
    grants: params.principal.permissions,
    requiredPermission: params.permission,
    mode: params.mode,
  });
  if (!allowed) {
    return adminJsonErr('AUTH_FORBIDDEN_PERMISSION', params.requestId, {
      required: params.permission,
      mode: params.mode,
    });
  }

  if (params.requireStepUp) {
    const pepper = params.env.ADMIN_TOTP_PEPPER ?? 'example-default-totp-pepper';
    const stepUpOk = await verifyStepUpToken({
      headerValue: params.request.headers.get('x-undal-step-up'),
      profileId: params.principal.profileId,
      pepper,
      nowMs: params.nowMs,
    });
    if (!stepUpOk) {
      return adminJsonErr('AUTH_STEP_UP_REQUIRED', params.requestId, {
        required_header: 'X-Undal-Step-Up',
      });
    }
  }

  return null;
}

export async function readJsonBody<T extends Record<string, unknown>>(request: Request): Promise<T | null> {
  try {
    const txt = await request.text();
    if (!txt.trim()) return {} as T;
    const parsed = JSON.parse(txt) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
  } catch {
    return null;
  }
}
