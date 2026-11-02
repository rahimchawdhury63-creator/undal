/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { failure, parseAcceptLanguage, statusFor, type ErrorCode } from "@undal/contracts";

import { loadTokenKeys, type TokenKeys } from "./auth/jwt.ts";
import { createDb, type Db } from "./db/client.ts";
import { logLine } from "./middleware/logging.ts";
import { authenticate } from "./middleware/auth.ts";
import { checkRequirement } from "./middleware/rbac.ts";
import { applyRateLimit } from "./middleware/ratelimit.ts";
import { bodyHashOf, begin as beginIdempotency, finish as finishIdempotency } from "./middleware/idempotency.ts";
import { DEFAULT_MAX_BODY_BYTES, readJsonBody } from "./middleware/body-limit.ts";
import { baseHeaders, failureResponse, successResponse } from "./middleware/envelope.ts";
import { clientIp, clientUserAgent, resolveRequestId } from "./middleware/request-id.ts";
import type { Ctx, Env, RouteDefinition, RouteInput } from "./middleware/context.ts";
import { AUTH_ROUTES } from "./routes/auth.ts";
import { ORDER_ROUTES } from "./routes/orders.ts";
import { QUOTE_ROUTES } from "./routes/quotes.ts";

/**
 * The pipeline, in the order a request meets it: identify, throttle, parse, authenticate,
 * authorise, replay-or-run, answer.
 *
 * The order is the design. Rate limiting before parsing means a flood costs no JSON
 * parsing; authentication before authorisation means a caller who is not who they claim
 * is refused before any permission is consulted; idempotency after authorisation means a
 * replayed response can never be obtained by a caller who has lost the permission to
 * perform the action in the meantime.
 */

/** The routes this Worker serves. Extending the API means adding a module here. */
export const ROUTES: readonly RouteDefinition[] = [...AUTH_ROUTES, ...ORDER_ROUTES, ...QUOTE_ROUTES];

/** A matched route plus the parameters its template captured. */
interface Match {
  readonly route: RouteDefinition;
  readonly params: Record<string, string>;
}

/**
 * Match a method and path against the route table.
 *
 * Literal segments win over templates, which is why the table is scanned twice: a
 * `/v1/auth/sessions` request must not be captured by a `/v1/auth/{id}` template that a
 * later module might add.
 */
export function matchRoute(routes: readonly RouteDefinition[], method: string, pathname: string): Match | null {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  let templated: Match | null = null;

  for (const route of routes) {
    if (route.method !== method) continue;
    const pattern = route.path.split("/").filter((segment) => segment !== "");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    let literal = true;
    let matched = true;
    for (const [index, part] of pattern.entries()) {
      const actual = segments[index] as string;
      if (part.startsWith("{") && part.endsWith("}")) {
        literal = false;
        params[part.slice(1, -1)] = decodeURIComponent(actual);
      } else if (part !== actual) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (literal) return { route, params };
    templated ??= { route, params };
  }
  return templated;
}

/** Cached signing keys, keyed by the secret that produced them. */
const keyCache = new Map<string, TokenKeys>();

/**
 * Load the signing keys for an environment.
 *
 * Importing an Ed25519 key costs a WebCrypto call, and a Worker isolate serves thousands
 * of requests with the same secret; caching by the secret's own bytes means a rotation
 * takes effect on the next cold start rather than requiring a flush that does not exist.
 */
export async function tokenKeys(env: Env): Promise<TokenKeys[]> {
  const secrets = [env.JWT_SIGNING_KEY, env.JWT_PREVIOUS_KEY].filter((secret): secret is string => typeof secret === "string" && secret !== "");
  const keys: TokenKeys[] = [];
  for (const secret of secrets) {
    const cached = keyCache.get(secret);
    if (cached !== undefined) {
      keys.push(cached);
      continue;
    }
    const loaded = await loadTokenKeys(secret);
    keyCache.set(secret, loaded);
    keys.push(loaded);
  }
  return keys;
}

/** What the app needs injected in a test. */
export interface AppDependencies {
  readonly db?: Db;
  readonly now?: () => number;
}

/**
 * Build the fetch handler.
 *
 * Every response goes through `baseHeaders`, so `cache-control: no-store` and the request
 * id are on the 200s and the 500s alike; a client that cannot cache an order state also
 * cannot cache an error and retry into it for an hour.
 */
export function createApp(routes: readonly RouteDefinition[] = ROUTES, dependencies: AppDependencies = {}) {
  return async function handle(request: Request, env: Env): Promise<Response> {
    const startedAtMs = Date.now();
    const now = dependencies.now ?? (() => Date.now());
    const requestId = resolveRequestId(request);
    const url = new URL(request.url);
    const locale = parseAcceptLanguage(request.headers.get("Accept-Language"));
    const ip = clientIp(request);

    const db = dependencies.db ?? createDb(env.TIDB_DATABASE_URL);
    const base = {
      env,
      db,
      url,
      request,
      requestId,
      ip,
      userAgent: clientUserAgent(request),
      locale,
      startedAtMs,
      waitUntil: () => undefined,
    };

    if (url.pathname === "/health" && request.method === "GET") {
      return successResponse({ worker: "undal-core", status: "ok", apiBase: env.PUBLIC_API_BASE }, locale, requestId);
    }

    const match = matchRoute(routes, request.method, url.pathname);
    if (match === null) {
      // D38: an unknown path on a versioned API is a resource this build does not serve.
      return new Response(
        JSON.stringify(failure("NOT_IMPLEMENTED", { requestId, details: { method: request.method, path: url.pathname } })),
        { status: 501, headers: baseHeaders(requestId) },
      );
    }

    try {
      const rate = await applyRateLimit({ ...base, keys: [], principal: null }, match.route.group);
      if (!rate.ok) {
        return failureResponse(rate.error, locale, requestId, {
          ...(typeof rate.error.details?.retryAfterSeconds === "number"
            ? { "Retry-After": String(rate.error.details.retryAfterSeconds) }
            : {}),
        });
      }

      // A GET has no body by definition; reading one would refuse the request for a
      // missing Content-Type and answer 400 to a perfectly good query.
      const bodyLimit = match.route.maxBodyBytes ?? (request.method === "GET" ? 0 : DEFAULT_MAX_BODY_BYTES);
      const body = await readJsonBody(request, bodyLimit);
      if (!body.ok) return failureResponse(body.error, locale, requestId);

      const keys = await tokenKeys(env);
      const anonymous = match.route.permission === "*";
      const readsToken = !anonymous || match.route.optionalAuth === true;
      const authed = readsToken ? await authenticate({ ...base, keys, principal: null } as Ctx) : null;
      // A required token that fails is a refusal; an optional one that fails is a guest.
      if (!anonymous && authed !== null && !authed.ok) return failureResponse(authed.error, locale, requestId);
      const principal = authed !== null && authed.ok ? authed.value : null;

      const ctx: Ctx = { ...base, keys, principal };
      const reason = request.headers.get("X-Undal-Reason");
      const permitted = checkRequirement(ctx, match.route.permission, {
        write: match.route.write === true,
        reasonRequired: match.route.reasonRequired === true,
        reason,
      });
      if (!permitted.ok) return failureResponse(permitted.error, locale, requestId);

      const input: RouteInput = { params: match.params, body: body.value, reason };
      const replayable = match.route.write === true && match.route.method !== "GET";
      const bodyHash = await bodyHashOf(body.value);

      if (replayable) {
        const idempotency = await beginIdempotency(ctx, match.route.path, bodyHash);
        if (!idempotency.ok) return failureResponse(idempotency.error, locale, requestId);
        if (idempotency.value.kind === "REPLAY") return idempotency.value.response;

        const response = await match.route.run(ctx, input);
        const finished = await finishIdempotency(ctx, idempotency.value.key, response, bodyHash);
        return withCommonHeaders(finished, requestId);
      }

      const response = await match.route.run(ctx, input);
      return withCommonHeaders(response, requestId);
    } catch (error) {
      logLine(env.LOG_LEVEL, "error", "request.failed", {
        requestId,
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
        durationMs: now() - startedAtMs,
      });
      return new Response(
        JSON.stringify(failure("INTERNAL", { requestId })),
        { status: statusFor("INTERNAL" as ErrorCode), headers: baseHeaders(requestId) },
      );
    }
  };
}

/** Ensure a handler-built response carries the common headers even when it set its own. */
function withCommonHeaders(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Undal-Request-Id", requestId);
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
