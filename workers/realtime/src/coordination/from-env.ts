/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Building the coordinator the environment describes, in one place.
 *
 * The Worker, the presence hub and the stream route all need the same coordinator, and three copies of
 * "read the mode, check the binding, construct" is three places for the `sql`-mode refusal to drift. So it
 * is one function, and every caller gets the same answer to the same environment.
 */

import type { Coordinator, CoordinatorMode } from "./coordinator.ts";
import { createCoreSqlExecutor } from "./core-sql.ts";
import { DurableObjectCoordinator } from "./durable-object.ts";
import { TiDBCoordinator } from "./tidb.ts";
import { createTiDBStateStore } from "./tidb-store.ts";
import { readCoordinatorMode } from "../lib/config.ts";

/** The environment keys this factory reads. */
export interface CoordinatorEnv {
  readonly COORDINATION_MODE?: string;
  readonly COORDINATION_ROOM?: DurableObjectNamespace;
  /** Where core is, for the `sql` backend's statements (D90). */
  readonly CORE_BASE_URL?: string;
  /** The token core's internal surface requires. Absent means the surface answers 403, so the mode cannot. */
  readonly INTERNAL_TOKEN?: string;
}

/** Why a coordinator could not be built. */
export interface CoordinatorUnavailable {
  readonly reason: "misconfigured" | "coordinator_not_configured";
  readonly detail: string;
  readonly mode?: string;
}

/** A coordinator, or the reason there is none. */
export type CoordinatorResult =
  | { readonly ok: true; readonly coordinator: Coordinator; readonly mode: CoordinatorMode }
  | { readonly ok: false; readonly error: CoordinatorUnavailable };

/**
 * Build the coordinator.
 *
 * Both backends are real, and each refuses with the reason it cannot be built rather than falling back to
 * the other: a deployment that believes it is on the free path while every socket is being coordinated by a
 * Durable Object is a bill someone did not plan for, and the reverse is a capacity the operator paid for and
 * is not using. The `sql` backend needs core's address and the internal token, because that is where the SQL
 * runs (`D90`) — the coordinator composes statements and core executes them, so a Worker with no address has
 * nowhere to send one.
 */
export function coordinatorFrom(env: CoordinatorEnv): CoordinatorResult {
  let mode;
  try {
    mode = readCoordinatorMode(env.COORDINATION_MODE);
  } catch (error) {
    return {
      ok: false,
      error: { reason: "misconfigured", detail: error instanceof Error ? error.message : String(error) },
    };
  }
  if (mode === "sql") {
    const baseUrl = (env.CORE_BASE_URL ?? "").trim();
    const token = (env.INTERNAL_TOKEN ?? "").trim();
    const missing = [
      baseUrl === "" ? "CORE_BASE_URL" : null,
      token === "" ? "INTERNAL_TOKEN" : null,
    ].filter((name): name is string => name !== null);
    if (missing.length > 0) {
      return {
        ok: false,
        error: {
          reason: "coordinator_not_configured",
          detail: `the sql backend needs ${missing.join(" and ")} so core can run its statements`,
          mode,
        },
      };
    }
    const executor = createCoreSqlExecutor(baseUrl, token);
    return { ok: true, coordinator: new TiDBCoordinator(executor, createTiDBStateStore(executor)), mode };
  }
  if (env.COORDINATION_ROOM === undefined) {
    return {
      ok: false,
      error: {
        reason: "coordinator_not_configured",
        detail: "the durable-object backend needs a COORDINATION_ROOM binding",
        mode,
      },
    };
  }
  return { ok: true, coordinator: new DurableObjectCoordinator(env.COORDINATION_ROOM), mode };
}
