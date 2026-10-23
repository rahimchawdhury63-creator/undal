/**
 * @file workers/realtime/src/http.ts
 * @description Standard JSON envelopes, CORS headers, isolate rate-limiting, `< 0.4ms` WebCrypto
 * `HS256` JWT verification, cross-Worker `X-Undal-Internal-Signature` HMAC verification, and
 * `Idempotency-Key` SHA-256 replay protection for `W2 undal-realtime`.
 */

import { errEnvelope, okEnvelope, type UndalErrorCode } from '@undal/shared-ts';
import type { AuthPrincipal, RealtimeDbAdapter, RealtimeWorkerEnv } from './types.ts';

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, Idempotency-Key, X-Undal-Internal-Signature, X-Undal-Signature, X-Undal-Timestamp',
  'X-Content-Type-Options': 'nosniff',
};

interface RateBucket {
  count: number;
  resetAtMs: number;
}

const RATE_BUCKETS = new Map<string, RateBucket>();

/** Resets isolate rate buckets between deterministic automated test cases. */
export function resetRealtimeRateLimits(): void {
  RATE_BUCKETS.clear();
}

/** Sliding-window isolate memory rate limiter (`0` database writes). */
export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number = 60_000,
  nowMs: number = Date.now(),
): { readonly allowed: boolean; readonly retryAfterSeconds: number } {
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
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAtMs - nowMs) / 1_000)) };
  }
  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Returns standard `{"data": ..., "request_id": ...}` response. */
export function jsonOk<T>(
  data: T,
  requestId: string,
  status: number = 200,
  extraHeaders?: Readonly<Record<string, string>>,
): Response {
  return Response.json(okEnvelope(data, requestId), {
    status,
    headers: { ...CORS_HEADERS, 'X-Request-Id': requestId, ...(extraHeaders ?? {}) },
  });
}

/** Returns standard bilingual EN/বাংলা `{"error": ..., "request_id": ...}` response. */
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
    headers: { ...CORS_HEADERS, 'X-Request-Id': requestId, ...(extraHeaders ?? {}) },
  });
}

function decodeBase64UrlBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/\x5f/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexDecode(hex: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Computes SHA-256 hex digest of an arbitrary UTF-8 string. */
export async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return hexEncode(new Uint8Array(buf));
}

/** Computes cross-Worker `HMAC-SHA256` signature over `<timestampMs>.<rawBody>` (`File 08 §8.4`). */
export async function signInternalPayload(
  rawBody: string,
  timestampMs: number,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestampMs}.${rawBody}`),
  );
  return hexEncode(new Uint8Array(sig));
}

/** Verifies cross-Worker `HMAC-SHA256` headers (`X-Undal-Internal-Signature` or `W1` `X-Undal-Signature`). */
export async function verifyInternalHmacRequest(
  rawBody: string,
  headers: Headers,
  secret: string | undefined,
  nowMs: number,
): Promise<boolean> {
  if (!secret) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );

  const directSig = headers.get('X-Undal-Signature')?.trim();
  if (directSig) {
    const bytes = hexDecode(directSig);
    if (!bytes) return false;
    return crypto.subtle.verify('HMAC', key, bytes as BufferSource, new TextEncoder().encode(rawBody));
  }

  const sigHex = headers.get('X-Undal-Internal-Signature')?.trim();
  const tsRaw = headers.get('X-Undal-Timestamp')?.trim();
  if (!sigHex || !tsRaw) return false;
  const tsMs = Number(tsRaw);
  if (!Number.isFinite(tsMs) || Math.abs(nowMs - tsMs) > 5 * 60_000) return false;
  const sigBytes = hexDecode(sigHex);
  if (!sigBytes) return false;

  return crypto.subtle.verify(
    'HMAC',
    key,
    sigBytes as BufferSource,
    new TextEncoder().encode(`${tsMs}.${rawBody}`),
  );
}

/** Verifies Supabase `HS256` bearer JWT and hydrates caller role & active status from `profiles`. */
export async function authenticateRealtimeRequest(
  request: Request,
  env: RealtimeWorkerEnv,
  db: RealtimeDbAdapter,
  nowMs: number,
): Promise<{ readonly principal: AuthPrincipal | null; readonly errorCode: UndalErrorCode | null }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return { principal: null, errorCode: null };
  if (!authHeader.startsWith('Bearer ')) return { principal: null, errorCode: 'SESSION_EXPIRED' };
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
    if (!payload.sub || (payload.exp !== undefined && payload.exp <= Math.floor(nowMs / 1_000))) {
      return { principal: null, errorCode: 'SESSION_EXPIRED' };
    }

    const profile = await db.getProfileAuthState(payload.sub);
    if (!profile) return { principal: null, errorCode: 'SESSION_EXPIRED' };
    if (profile.status !== 'active') return { principal: null, errorCode: 'AUTH_ACCOUNT_SUSPENDED' };
    return { principal: profile, errorCode: null };
  } catch {
    return { principal: null, errorCode: 'SESSION_EXPIRED' };
  }
}

/** Enforces `Idempotency-Key` SHA-256 body fingerprint & cached response replay (`24h` window). */
export async function executeIdempotent(params: {
  readonly request: Request;
  readonly rawBody: string;
  readonly actorId: string;
  readonly endpoint: string;
  readonly requestId: string;
  readonly db: RealtimeDbAdapter;
  readonly nowMs: number;
  readonly handler: () => Promise<{ readonly status: number; readonly body: Record<string, unknown> }>;
}): Promise<Response> {
  const idemKey = params.request.headers.get('Idempotency-Key')?.trim();
  if (!idemKey || idemKey.length < 8 || idemKey.length > 128) {
    return jsonErr('IDEMPOTENCY_KEY_REQUIRED', params.requestId);
  }
  const fingerprint = await sha256Hex(`${params.endpoint}:${params.rawBody}`);
  const existing = await params.db.getIdempotencyRecord(idemKey, params.actorId, params.nowMs);
  if (existing) {
    if (existing.requestHash !== fingerprint) {
      return jsonErr('VALIDATION_FAILED', params.requestId, { reason: 'IDEMPOTENCY_CONFLICT' }, undefined, 409);
    }
    return Response.json(existing.body, {
      status: existing.status,
      headers: { ...CORS_HEADERS, 'X-Request-Id': params.requestId, 'X-Idempotent-Replay': 'true' },
    });
  }

  const outcome = await params.handler();
  await params.db.saveIdempotencyRecord(
    idemKey,
    params.actorId,
    params.endpoint,
    fingerprint,
    outcome.status,
    outcome.body,
    params.nowMs,
  );
  return Response.json(outcome.body, {
    status: outcome.status,
    headers: { ...CORS_HEADERS, 'X-Request-Id': params.requestId },
  });
}
