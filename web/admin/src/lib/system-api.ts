/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The configuration register's wire shape.
 */

import { apiCall } from "./api.ts";

/** One current configuration row. */
export interface ConfigEntry {
  readonly key: string;
  readonly zoneId: string;
  readonly scope: "GLOBAL" | "ZONE";
  readonly value: unknown;
  readonly redacted: boolean;
  readonly version: string;
  readonly effectiveAt: string;
  readonly reason: string;
}

/** The configuration register: the current value of every key, newest row per key and zone. */
export async function listPlatformConfig(
  token: string,
  query: { prefix?: string | null; zoneId?: string | null; limit?: number } = {},
): Promise<{ readonly entries: readonly ConfigEntry[]; readonly totalKeys: number; readonly limit: number }> {
  return apiCall("/v1/system/config", { token, query });
}
