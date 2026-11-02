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

import type { Coordinator } from "./coordinator.ts";
import { DurableObjectCoordinator } from "./durable-object.ts";
import { readCoordinatorMode } from "../lib/config.ts";

/** The environment keys this factory reads. */
export interface CoordinatorEnv {
  readonly COORDINATION_MODE?: string;
  readonly COORDINATION_ROOM?: DurableObjectNamespace;
}

/** Why a coordinator could not be built. */
export interface CoordinatorUnavailable {
  readonly reason: "misconfigured" | "coordinator_not_configured";
  readonly detail: string;
  readonly mode?: string;
}

/** A coordinator, or the reason there is none. */
export type CoordinatorResult =
  | { readonly ok: true; readonly coordinator: Coordinator; readonly mode: "durable-object" }
  | { readonly ok: false; readonly error: CoordinatorUnavailable };

/**
 * Build the coordinator.
 *
 * Only the `durable-object` mode can be built here. The `sql` backend composes its statements over a
 * `SqlExecutor` that is filled by core's internal surface (`D77`), which does not exist yet — so rather
 * than pretend, this reports `coordinator_not_configured` with the mode in it.
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
  if (mode !== "durable-object" || env.COORDINATION_ROOM === undefined) {
    return {
      ok: false,
      error: {
        reason: "coordinator_not_configured",
        detail: "the sql backend needs core's internal surface before a coordinator can be built",
        mode,
      },
    };
  }
  return { ok: true, coordinator: new DurableObjectCoordinator(env.COORDINATION_ROOM), mode };
}
