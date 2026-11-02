/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import type { Db } from "../db/client.ts";
import type { Principal } from "../rbac/guard.ts";
import type { RouteGroup } from "../ratelimit/limits.ts";
import type { TokenKeys } from "../auth/jwt.ts";

/**
 * Everything a route may touch, assembled once per request.
 *
 * A route receives this and nothing else: no globals, no module-level singleton, no
 * import of the environment. That is what makes a handler testable with a stub database
 * and a stub KV, and it is why the Worker has no code path that reads `process.env`.
 */

/** The bindings and secrets this Worker declares, named as `docs/29` names them. */
export interface Env {
  readonly TIDB_DATABASE_URL: string;
  readonly JWT_SIGNING_KEY: string;
  readonly JWT_PREVIOUS_KEY?: string;
  readonly TOTP_ENCRYPTION_KEY: string;
  readonly ORDER_QR_SECRET: string;
  /** KV namespace for rate-limit buckets and idempotency records. */
  readonly RATE_LIMIT: KVNamespace;
  readonly PUBLIC_API_BASE: string;
  /**
   * Where `undal-realtime` is, for the broadcasts a transition sends (`D85`).
   *
   * Absent, an order still moves and the watchers find out on their next read — the same degradation the
   * realtime client already promises, decided once here rather than at every call site.
   */
  readonly REALTIME_BASE?: string;
  readonly LOG_LEVEL: string;
  readonly ENVIRONMENT: "production" | "staging" | "preview" | "test";
  /**
   * The bearer token `undal-realtime` presents when it asks a question only this Worker can answer
   * (D82). Absent, the internal surface refuses everybody rather than answering whoever asks.
   */
  readonly INTERNAL_TOKEN?: string;
  readonly GOOGLE_OAUTH_CLIENT_ID?: string;
  readonly GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

/** The per-request context handed to a route. */
export interface Ctx {
  readonly env: Env;
  readonly db: Db;
  readonly url: URL;
  readonly request: Request;
  /** Echoed on every response and every log line. */
  readonly requestId: string;
  /** The caller's address, or `unknown` when the runtime does not supply one. */
  readonly ip: string;
  readonly userAgent: string;
  /** Signing keys: the current one first, the rotation predecessor second. */
  readonly keys: readonly TokenKeys[];
  /** Set by the auth middleware; `null` on a public route. */
  readonly principal: Principal | null;
  /** The locale the response bodies should be built in. */
  readonly locale: "bn" | "en";
  readonly startedAtMs: number;
  /** Work that must not block the response, like an audit row or a push. */
  readonly waitUntil: (promise: Promise<unknown>) => void;
}

/** What a route declares about itself. */
export interface RouteDefinition {
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  /** The path template, with `{param}` segments. */
  readonly path: string;
  /** The permission key the caller must hold, which is what makes coverage checkable. */
  readonly permission: string;
  /** Whether the route mutates state; impersonation sessions may not. */
  readonly write?: boolean;
  /**
   * A `POST` that changes no rows.
   *
   * Quoting is the only such route today: it computes and signs a price, and writes nothing. Saying
   * so in the declaration is what lets the audit-coverage rule stay strict about every other
   * mutating verb, and what stops the next reader wondering why a POST has no audit row.
   */
  readonly readOnly?: true;
  /**
   * Whether an anonymous route still reads a token when one is presented.
   *
   * A guest may price a cart; a signed-in customer pricing the same cart gets a quote that records
   * who asked, so the discount they are entitled to and the customer the order belongs to are the
   * same person. Without this flag a `*` route would silently drop the caller's identity.
   */
  readonly optionalAuth?: boolean;
  /** Whether the request carries a mandatory reason. */
  readonly reasonRequired?: boolean;
  /** The rate-limit group this route belongs to. */
  readonly group: RouteGroup;
  /** Body size cap in bytes; `0` means the route reads no body. */
  readonly maxBodyBytes?: number;
  /** The handler. */
  readonly run: (ctx: Ctx, input: RouteInput) => Promise<Response>;
}

/** The parsed pieces of a request a handler may need. */
export interface RouteInput {
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly reason: string | null;
}
