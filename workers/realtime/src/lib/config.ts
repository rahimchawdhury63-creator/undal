/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The one variable that changes this Worker's behaviour.
 *
 * `COORDINATION_MODE` selects the coordinator backend (`05 §4.2`, `14 §3.3`): `durable-object` needs
 * the Workers paid plan and is the preferred path, `sql` runs on the free tier against one conditional
 * `UPDATE`. The default is `sql`, because that is what the platform launches on and a deploy that
 * forgets the variable must not silently promise something the account cannot pay for.
 *
 * A value that is neither is *refused*, not defaulted. There are only two backends and both are real,
 * so a typo is a deploy that would otherwise run one of them while the operator believes it is running
 * the other — the exact confusion the health endpoint exists to prevent.
 */

import type { CoordinatorMode } from "../coordination/coordinator.ts";

/** Every value `COORDINATION_MODE` may take. */
export const COORDINATION_MODES: readonly CoordinatorMode[] = ["sql", "durable-object"];

/** The mode a Worker with no configuration runs: the free path. */
export const DEFAULT_COORDINATION_MODE: CoordinatorMode = "sql";

/** Whether a string is one of the two backends. */
export function isCoordinatorMode(value: string): value is CoordinatorMode {
  return (COORDINATION_MODES as readonly string[]).includes(value);
}

/**
 * Read `COORDINATION_MODE` from the environment.
 *
 * An unset or blank variable is the default; anything else must be one of the two documented values.
 */
export function readCoordinatorMode(raw: string | undefined): CoordinatorMode {
  const value = (raw ?? "").trim();
  if (value === "") return DEFAULT_COORDINATION_MODE;
  if (!isCoordinatorMode(value)) {
    throw new RangeError(`COORDINATION_MODE must be one of ${COORDINATION_MODES.join(", ")}, got ${value}`);
  }
  return value;
}
