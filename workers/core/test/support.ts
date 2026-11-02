/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { KVNamespace } from "@cloudflare/workers-types";

import type { Env } from "../src/middleware/context.ts";

/**
 * Test doubles: a KV namespace that behaves like KV, and an environment that names every
 * binding the Worker declares.
 *
 * The KV double stores JSON and honours `expirationTtl` only by remembering it, because
 * a test that depends on a real clock is a test that fails in February. Everything else
 * — the eventual consistency, the per-PoP copies — is deliberately not modelled: the rate
 * limiter documents that it tolerates overshoot, so the double tests the arithmetic, and
 * the arithmetic is what the assertions are about.
 */

/** The stored entry, with the TTL it was written under. */
interface Entry {
  readonly value: string;
  readonly expirationTtl?: number;
}

/** An in-memory `KVNamespace` covering the four methods this Worker uses. */
export class FakeKv {
  readonly entries = new Map<string, Entry>();

  async get<T>(key: string, type?: "text" | "json"): Promise<T | string | null> {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    return type === "json" ? (JSON.parse(entry.value) as T) : entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.entries.set(key, { value, ...(options?.expirationTtl === undefined ? {} : { expirationTtl: options.expirationTtl }) });
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async list(): Promise<{ keys: { name: string }[]; list_complete: true }> {
    return { keys: [...this.entries.keys()].map((name) => ({ name })), list_complete: true };
  }
}

/** A test environment with every binding present and no real secrets. */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    TIDB_DATABASE_URL: "mysql://user:pass@example.invalid:4000/undal",
    JWT_SIGNING_KEY: "",
    TOTP_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    ORDER_QR_SECRET: "test-qr-secret",
    RATE_LIMIT: new FakeKv() as unknown as KVNamespace,
    PUBLIC_API_BASE: "https://api.undal.app",
    LOG_LEVEL: "error",
    ENVIRONMENT: "test",
    INTERNAL_TOKEN: "test-internal-token",
    ...overrides,
  };
}
