/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The Google access token for FCM, minted from the service account (`15 §2.2`, D83).
 *
 * The service account is a secret that may send any push to any device on the platform, so it exists only
 * as a Worker secret and only this module reads it. `googleapis` is not a dependency: it does not run on
 * Workers, and pulling it in for one RS256 signature would be megabytes for a hundred lines of WebCrypto.
 *
 * Two details are deliberate:
 *
 * - **The cache is in isolate memory, not KV.** A token lives an hour; a KV read per send would be a paid
 *   request per alarm for a value that changes twelve times a day per isolate, and a cold isolate can
 *   simply mint a new one — the mint is a WebCrypto signature and one fetch. `15 §2.2`'s example caches
 *   in KV; that is a deviation, and D83 records why.
 * - **Refresh is single-flight.** The first alarm of a busy minute arrives while twenty vendors are being
 *   woken at once; twenty simultaneous token mints would each be a fresh signature and a fresh HTTPS
 *   round trip, and Google would rate-limit the burst at exactly the worst moment. One promise is shared,
 *   and a failure clears it so the next caller retries rather than inheriting a dead token.
 */

/** The fields of the service-account JSON this module uses. */
export interface ServiceAccount {
  /** `project_id`, which selects the FCM endpoint. */
  readonly projectId: string;
  /** `client_email`, the `iss` of the assertion. */
  readonly clientEmail: string;
  /** The PEM private key, PKCS#8. */
  readonly privateKey: string;
}

/** Google's token endpoint, and the scope FCM wants. */
export const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
/** The only scope this Worker ever asks for. */
export const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** How long a minted token is reused before it is replaced. */
export const REFRESH_MARGIN_MS = 300_000;

/** What a caller needs from the token module. */
export interface TokenSource {
  get(): Promise<string>;
}

/** How a token source is built, so a test can supply its own transport and clock without a real account. */
export interface TokenSourceDeps {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  /** The token endpoint, overridable in a test. */
  readonly endpoint?: string;
  readonly marginMs?: number;
}

/**
 * Read the service-account JSON.
 *
 * The private key arrives with escaped newlines whenever it has travelled through an environment
 * variable, and PEM parsing fails on `\n` as two characters with an error that says nothing useful. Both
 * shapes are accepted here, once, rather than at every call site.
 */
export function parseServiceAccount(raw: string): ServiceAccount {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new TypeError("the service account is not JSON");
  }
  const fields = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
  const projectId = fields["project_id"];
  const clientEmail = fields["client_email"];
  const privateKey = fields["private_key"];
  if (typeof projectId !== "string" || projectId === "") throw new TypeError("the service account has no project_id");
  if (typeof clientEmail !== "string" || clientEmail === "") throw new TypeError("the service account has no client_email");
  if (typeof privateKey !== "string" || privateKey === "") throw new TypeError("the service account has no private_key");
  return { projectId, clientEmail, privateKey: privateKey.replace(/\\n/gu, "\n") };
}

/** The base64url alphabet, without padding. */
function base64url(bytes: Uint8Array): string {
  const binary = [...bytes].map((byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** The DER bytes of a PEM `PRIVATE KEY` block. */
function pemBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/gu, "")
    .replace(/-----END [^-]+-----/gu, "")
    .replace(/\s+/gu, "");
  if (body === "") throw new TypeError("the private key is empty");
  const binary = atob(body);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Sign the assertion Google accepts: RS256 over `header.payload`.
 *
 * `aud` is the token endpoint rather than the FCM API, and `scope` is the only scope that grants
 * `messages:send`. A token minted for a wider scope would be able to do more than this Worker has any
 * reason to do, and the difference is one string here.
 */
export async function mintAssertion(account: ServiceAccount, nowMs: number): Promise<string> {
  const header = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = {
    iss: account.clientEmail,
    scope: FCM_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: Math.floor(nowMs / 1_000),
    exp: Math.floor(nowMs / 1_000) + 3_600,
  };
  const payload = base64url(new TextEncoder().encode(JSON.stringify(claim)));
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemBytes(account.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`;
}

/** One cached token. `expiresAtMs` is when it stops being used, not when Google stops accepting it. */
interface CachedToken {
  readonly value: string;
  readonly expiresAtMs: number;
}

/**
 * Build the token source.
 *
 * The returned object holds the cache, so two Workers in two isolates each mint their own token — which is
 * correct: a token is cheap, and a shared one would need a shared store.
 */
export function createTokenSource(account: ServiceAccount, deps: TokenSourceDeps = {}): TokenSource {
  const transport = deps.fetch ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const endpoint = deps.endpoint ?? TOKEN_ENDPOINT;
  const marginMs = deps.marginMs ?? REFRESH_MARGIN_MS;
  let cached: CachedToken | null = null;
  let inFlight: Promise<CachedToken> | null = null;

  const mint = async (): Promise<CachedToken> => {
    const assertion = await mintAssertion(account, now());
    const response = await transport(endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });
    if (!response.ok) {
      // The body is Google's error, and it names the cause (a wrong scope reads differently from a
      // revoked key). It is thrown rather than logged because the caller is about to fail a send.
      throw new Error(`fcm token refused: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    const value = body.access_token;
    const lifetimeSeconds = typeof body.expires_in === "number" ? body.expires_in : 3_600;
    if (typeof value !== "string" || value === "") throw new Error("fcm token response had no access_token");
    return { value, expiresAtMs: now() + lifetimeSeconds * 1_000 - marginMs };
  };

  return {
    async get(): Promise<string> {
      if (cached !== null && now() < cached.expiresAtMs) return cached.value;
      if (inFlight === null) {
        inFlight = mint()
          .then((token) => {
            cached = token;
            return token;
          })
          .finally(() => {
            // A failure must not be inherited: the next caller retries rather than re-reading a rejected
            // promise, which would turn one bad minute into a dead Worker.
            inFlight = null;
          });
      }
      return (await inFlight).value;
    },
  };
}
