/**
 * @file workers/realtime/src/google-auth.ts
 * @description Zero-dependency WebCrypto `RS256` Google Service-Account credential parser,
 * `55-minute`-cached OAuth2 access-token minter (for FCM HTTP v1 & Firebase RTDB REST),
 * and `15-minute` Firebase Auth Custom Token signer (`File 06 §6.4`, `File 07 §7.5`, `B09`).
 */

export interface FirebaseServiceAccount {
  readonly projectId: string;
  readonly clientEmail: string;
  readonly privateKeyDerBase64: string;
  readonly tokenUri: string;
}

interface CachedAccessToken {
  readonly accessToken: string;
  readonly expiresAtMs: number;
}

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/firebase.messaging',
  'https://www.googleapis.com/auth/firebase.database',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const IDENTITY_TOOLKIT_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

const ACCESS_TOKEN_CACHE = new Map<string, CachedAccessToken>();

/** Clears isolate access-token cache (used by deterministic unit tests). */
export function resetGoogleAccessTokenCache(): void {
  ACCESS_TOKEN_CACHE.clear();
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64ToBytes(cleanB64: string): Uint8Array {
  const normalized = cleanB64.replace(/-/g, '+').replace(/\x5f/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Parses `FIREBASE_SERVICE_ACCOUNT_JSON` (accepting either PEM-wrapped PKCS#8 `private_key`
 * from Google Cloud Console OR raw base64 PKCS#8 DER bytes in tests).
 */
export function parseServiceAccountJson(rawJson: string): FirebaseServiceAccount {
  const parsed = JSON.parse(rawJson) as {
    readonly project_id?: string;
    readonly client_email?: string;
    readonly private_key?: string;
    readonly token_uri?: string;
  };
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error('Invalid FIREBASE_SERVICE_ACCOUNT_JSON: missing project_id, client_email, or private_key.');
  }
  const strippedDerB64 = parsed.private_key
    .replace(/-----[A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKeyDerBase64: strippedDerB64,
    tokenUri: parsed.token_uri ?? 'https://oauth2.googleapis.com/token',
  };
}

/** Signs an `RS256` JWT using WebCrypto `RSASSA-PKCS1-v1_5` (`< 0.5 ms` Worker CPU). */
export async function signRs256Jwt(
  payload: Record<string, unknown>,
  privateKeyDerBase64: string,
): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    base64ToBytes(privateKeyDerBase64) as BufferSource,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const encodedHeader = utf8ToBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const encodedPayload = utf8ToBase64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/**
 * Mints a `15-minute` (`900s`) Firebase Auth Custom Token (`File 06 §6.4` & `06-api-contract-final.md` `B09`)
 * embedding minimal custom claims (`role`, optional `vendor_id` / `rider_id`).
 */
export async function mintFirebaseCustomToken(params: {
  readonly serviceAccount: FirebaseServiceAccount;
  readonly uid: string;
  readonly claims: Readonly<Record<string, string>>;
  readonly nowMs: number;
  readonly ttlSeconds?: number;
}): Promise<{ readonly token: string; readonly expiresInSeconds: number }> {
  const iat = Math.floor(params.nowMs / 1_000);
  const ttlSeconds = Math.min(3_600, Math.max(60, params.ttlSeconds ?? 900));
  const token = await signRs256Jwt(
    {
      iss: params.serviceAccount.clientEmail,
      sub: params.serviceAccount.clientEmail,
      aud: IDENTITY_TOOLKIT_AUD,
      iat,
      exp: iat + ttlSeconds,
      uid: params.uid,
      claims: params.claims,
    },
    params.serviceAccount.privateKeyDerBase64,
  );
  return { token, expiresInSeconds: ttlSeconds };
}

/**
 * Obtains a Google OAuth2 bearer access token for FCM HTTP v1 & Firebase RTDB REST,
 * caching valid tokens for `55 minutes` in isolate memory (`File 07 §7.5`).
 */
export async function getGoogleAccessToken(params: {
  readonly serviceAccount: FirebaseServiceAccount;
  readonly fetchImpl: typeof fetch;
  readonly nowMs: number;
}): Promise<string> {
  const cacheKey = `${params.serviceAccount.projectId}:${params.serviceAccount.clientEmail}`;
  const cached = ACCESS_TOKEN_CACHE.get(cacheKey);
  if (cached && cached.expiresAtMs - 60_000 > params.nowMs) {
    return cached.accessToken;
  }

  const iat = Math.floor(params.nowMs / 1_000);
  const assertion = await signRs256Jwt(
    {
      iss: params.serviceAccount.clientEmail,
      scope: GOOGLE_SCOPES,
      aud: params.serviceAccount.tokenUri,
      iat,
      exp: iat + 3_600,
    },
    params.serviceAccount.privateKeyDerBase64,
  );

  const res = await params.fetchImpl(params.serviceAccount.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(4_000),
  });
  if (!res.ok) {
    throw new Error(`Google OAuth2 token exchange failed (${res.status})`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Google OAuth2 response missing access_token');
  }
  const ttlMs = Math.min(55 * 60_000, Math.max(60_000, (data.expires_in ?? 3_600) * 1_000 - 300_000));
  ACCESS_TOKEN_CACHE.set(cacheKey, {
    accessToken: data.access_token,
    expiresAtMs: params.nowMs + ttlMs,
  });
  return data.access_token;
}
