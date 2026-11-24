/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The two coordinators, as a test fixture.
 *
 * Both suites — the coordination one and the latency one — have to run against the same pair, and a
 * second copy of the wiring would be a second thing to forget. `FixedClock` starts at the instant each
 * backend is built, so a test that advances time is advancing the same clock the coordinator reads.
 */

import { FixedClock } from "../../src/lib/clock.ts";
import { CoordinationRoom, DurableObjectCoordinator } from "../../src/coordination/durable-object.ts";
import { TiDBCoordinator } from "../../src/coordination/tidb.ts";
import type { Coordinator } from "../../src/coordination/coordinator.ts";
import { FakeNamespace, MemorySql, MemoryStore, fakeState } from "./fakes.ts";

/** The instant every fixture clock starts at. */
export const T0 = 1_700_000_000_000;

/** One built coordinator and the doubles behind it. */
export interface Backend {
  readonly coordinator: Coordinator;
  readonly clock: FixedClock;
  readonly sql?: MemorySql;
  readonly store?: MemoryStore;
}

/** A named way to build a backend. */
export interface BackendSpec {
  readonly name: string;
  readonly make: () => Backend;
}

/** The backend pair, in the order the documents list them. */
export const BACKENDS: readonly BackendSpec[] = [
  {
    name: "durable-object",
    make: () => {
      const clock = new FixedClock(T0);
      const namespace = new FakeNamespace(() => new CoordinationRoom(fakeState(), clock));
      const coordinator = new DurableObjectCoordinator(namespace as unknown as DurableObjectNamespace, clock);
      return { coordinator, clock };
    },
  },
  {
    name: "sql",
    make: () => {
      const clock = new FixedClock(T0);
      const sql = new MemorySql();
      const store = new MemoryStore();
      const coordinator = new TiDBCoordinator(sql, store, clock);
      return { coordinator, clock, sql, store };
    },
  },
];

/** The nearest-rank percentile, which is what the latency test quotes. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new RangeError("no values");
  if (!(fraction > 0 && fraction <= 1)) throw new RangeError(`not a fraction: ${String(fraction)}`);
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[rank] as number;
}

/** A tiny deterministic generator, so a thousand simulated losses are the same thousand every run. */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
