/**
 * @file workers/admin/src/totp.ts
 * @description RFC 6238 `TOTP-SHA1` (`6` digits, `30s` step, `±1` skew window) + `5-minute`
 * `HMAC-SHA256` Step-Up Proof Token (`X-Undal-Step-Up`) for `W3 undal-admin` (`File 09 §9.2`).
 *
 * Uses WebCrypto exclusively (`0` external npm dependencies; `< 0.4ms` CPU per verification).
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const STEP_UP_TTL_SECONDS = 300; // 5-minute window per `06-api-contract-final.md §3`

/** Encodes raw bytes as RFC 4648 Base32 (without trailing `=` padding) for `otpauth://` URIs. */
export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    value = (value << 8) | bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/** Decodes an RFC 4648 Base32 secret string into raw bytes. */
export function decodeBase32(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 1) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]!);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/**
 * Derives a deterministic per-admin `160-bit` TOTP secret from `(profileId, enrolledEpochMs, pepper)`
 * so stateless `W3` isolates verify TOTP codes using `profiles.totp_enrolled_at` + Worker secret `ADMIN_TOTP_PEPPER`
 * without storing plaintext TOTP seeds in SQL tables (`File 09 §9.2`).
 */
export async function deriveAdminTotpSecretBase32(params: {
  readonly profileId: string;
  readonly enrolledEpochMs: number;
  readonly pepper: string;
}): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(params.pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`undal-totp-v1:${params.profileId}:${params.enrolledEpochMs}`),
  );
  return encodeBase32(new Uint8Array(mac).slice(0, 20));
}

/** Builds a standard `otpauth://totp/...` URI compatible with Google Authenticator / Aegis / Ente Auth. */
export function buildOtpAuthUri(params: {
  readonly accountLabel: string;
  readonly secretBase32: string;
  readonly issuer?: string;
}): string {
  const issuer = params.issuer ?? 'Undal Admin';
  const label = encodeURIComponent(`${issuer}:${params.accountLabel}`);
  return `otpauth://totp/${label}?secret=${params.secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Generates the exact 6-digit RFC 6238 `TOTP-SHA1` code for `nowMs` + `stepOffset` (`-1`, `0`, `+1`). */
export async function generateTotpCode(
  secretBase32: string,
  nowMs: number,
  stepOffset = 0,
): Promise<string> {
  const counter = Math.floor(nowMs / 1_000 / STEP_SECONDS) + stepOffset;
  const counterBytes = new Uint8Array(8);
  let rem = counter;
  for (let i = 7; i >= 0; i -= 1) {
    counterBytes[i] = rem & 0xff;
    rem = Math.floor(rem / 256);
  }
  const key = await crypto.subtle.importKey(
    'raw',
    decodeBase32(secretBase32) as BufferSource,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes));
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Constant-time verifies a `6`-digit TOTP code across `[-1, 0, +1]` `30s` windows (`±30s` clock skew). */
export async function verifyTotpCode(params: {
  readonly secretBase32: string;
  readonly code: string;
  readonly nowMs: number;
}): Promise<boolean> {
  const normalized = params.code.trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = await generateTotpCode(params.secretBase32, params.nowMs, offset);
    let diff = 0;
    for (let i = 0; i < 6; i += 1) {
      diff |= normalized.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff === 0) return true;
  }
  return false;
}

async function signStepUpHmac(payload: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Mints a `5-minute` (`300s`) `X-Undal-Step-Up` token after successful RFC 6238 code verification. */
export async function mintStepUpToken(params: {
  readonly profileId: string;
  readonly pepper: string;
  readonly nowMs: number;
}): Promise<{ readonly token: string; readonly expiresAtMs: number; readonly ttlSeconds: number }> {
  const expiresAtMs = params.nowMs + STEP_UP_TTL_SECONDS * 1_000;
  const body = `${params.profileId}.${expiresAtMs}`;
  const sig = await signStepUpHmac(body, params.pepper);
  return {
    token: `${body}.${sig}`,
    expiresAtMs,
    ttlSeconds: STEP_UP_TTL_SECONDS,
  };
}

/** Verifies `X-Undal-Step-Up` header belongs to `profileId` and is unexpired at `nowMs`. */
export async function verifyStepUpToken(params: {
  readonly headerValue: string | null;
  readonly profileId: string;
  readonly pepper: string;
  readonly nowMs: number;
}): Promise<boolean> {
  if (!params.headerValue) return false;
  const parts = params.headerValue.trim().split('.');
  if (parts.length !== 3) return false;
  const [uid, expRaw, sigHex] = parts;
  if (uid !== params.profileId) return false;
  const expMs = Number(expRaw);
  if (!Number.isFinite(expMs) || params.nowMs >= expMs) return false;
  const expected = await signStepUpHmac(`${uid}.${expRaw}`, params.pepper);
  if (expected.length !== sigHex!.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ sigHex!.charCodeAt(i);
  }
  return diff === 0;
}
