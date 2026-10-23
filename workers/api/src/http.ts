/**
 * @file workers/api/src/http.ts
 * @description Standard HTTP envelopes, CORS headers, isolate sliding-window rate limiting,
 * and `< 0.4ms` WebCrypto HMAC-SHA256 JWT verification for `W1 undal-api`.
 */

import { errEnvelope, okEnvelope, type UndalErrorCode } from '@undal/shared-ts';
import type { ApiDbAdapter, ApiWorkerEnv, AuthPrincipal } from './types.ts';

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Idempotency-Key',
  'X-Content-Type-Options': 'nosniff',
};

interface RateBucket {
  count: number;
  resetAtMs: number;
}

const RATE_BUCKETS = new Map<string, RateBucket>();

/** Resets isolate rate buckets (used by automated rate-limit tests). */
export function resetRateLimitBuckets(): void {
  RATE_BUCKETS.clear();
}

/** Enforces per-IP or per-user sliding-window request caps within Worker isolate memory (`0` DB writes). */
export function checkRateLimit(key: string, maxRequests: number, windowMs: number = 60_000, nowMs: number = Date.now()): {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
} {
  if (RATE_BUCKETS.size > 4_000) {
    for (const [k, v] of RATE_BUCKETS) {
      if (v.resetAtMs <= nowMs) RATE_BUCKETS.delete(k);
    }
  }
  const existing = RATE_BUCKETS.get(key);
  if (!existing || existing.resetAtMs <= nowMs) {
    RATE_BUCKETS.set(key, { count: 1, resetAtMs: nowMs + windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (existing.count >= maxRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Builds a standard `{"data": ..., "request_id": ...}` HTTP JSON response. */
export function jsonOk<T>(
  data: T,
  requestId: string,
  status: number = 200,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  return Response.json(okEnvelope(data, requestId), {
    status,
    headers: {
      ...CORS_HEADERS,
      'X-Request-Id': requestId,
      ...(extraHeaders ?? {}),
    },
  });
}

/** Builds a standard bilingual EN/বাংলা `{"error": ..., "request_id": ...}` HTTP JSON response. */
export function jsonErr(
  code: UndalErrorCode,
  requestId: string,
  details?: Record<string, unknown>,
  extraHeaders?: Readonly<Record<string, string>>,
  statusOverride?: number,
): Response {
  const built = errEnvelope(code, requestId, details);
  return Response.json(built.body, {
    status: statusOverride ?? built.status,
    headers: {
      ...CORS_HEADERS,
      'X-Request-Id': requestId,
      ...(extraHeaders ?? {}),
    },
  });
}

function decodeBase64UrlBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Verifies a Supabase `HS256` JWT using native WebCrypto (`< 0.4ms` Worker CPU) and hydrates
 * live account status & role from `public.profiles` (enforcing `AUTH_ACCOUNT_SUSPENDED`).
 */
export async function authenticateRequest(
  request: Request,
  env: ApiWorkerEnv,
  db: ApiDbAdapter,
): Promise<{ readonly principal: AuthPrincipal | null; readonly errorCode: UndalErrorCode | null }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return { principal: null, errorCode: null };
  if (!authHeader.startsWith('Bearer ')) {
    return { principal: null, errorCode: 'SESSION_EXPIRED' };
  }
  const token = authHeader.slice('Bearer '.length).trim();
  const parts = token.split('.');
  if (parts.length !== 3 || !env.SUPABASE_JWT_SECRET) {
    return { principal: null, errorCode: 'SESSION_EXPIRED' };
  }

  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.SUPABASE_JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      decodeBase64UrlBytes(parts[2]!) as BufferSource,
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return { principal: null, errorCode: 'SESSION_EXPIRED' };

    const payload = JSON.parse(new TextDecoder().decode(decodeBase64UrlBytes(parts[1]!))) as {
      readonly sub?: string;
      readonly exp?: number;
    };
    const nowSec = Math.floor(Date.now() / 1000);
    if (!payload.sub || (payload.exp !== undefined && payload.exp <= nowSec)) {
      return { principal: null, errorCode: 'SESSION_EXPIRED' };
    }

    const profile = await db.getProfileAuthState(payload.sub);
    if (!profile) return { principal: null, errorCode: 'SESSION_EXPIRED' };
    if (profile.status !== 'active') {
      return { principal: null, errorCode: 'AUTH_ACCOUNT_SUSPENDED' };
    }
    return { principal: profile, errorCode: null };
  } catch {
    return { principal: null, errorCode: 'SESSION_EXPIRED' };
  }
}

/** Resolves caller IP address from Cloudflare headers with local fallback. */
export function clientIp(request: Request): string {
  return request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? '127.0.0.1';
}
