/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The third erasure trigger: a presence absence erases the live channel (`07 §6`, D99).
 *
 * `§6.1` lists five triggers and one of them is the only one nobody presses: *the presence engine declares the
 * rider offline*. The other four are a rider or an operator deciding; this one is a phone that died, a tunnel,
 * a flat battery. It is the trigger the five-second promise is really about, because a device that is gone
 * cannot ask to be forgotten.
 *
 * The hook is `PresenceHub`'s `onPublished`: the hub reports an absence at the instant its alarm publishes it,
 * and this module turns that report into a deletion. Two properties are decisions rather than plumbing:
 *
 * 1. **The erasure happens at publication, not on a later sweep.** `§6.1` promises five seconds, and D91's
 *    detection budget already spends two of them proving the device is silent. A second scheduled job that
 *    erased "shortly after" would add a window with no owner; erasing in the same breath as the publication
 *    makes the promise a property of the alarm's latency.
 * 2. **A failed erasure does not fail the absence.** The ledger has already been swept and the coordinator
 *    told; throwing here would abort the alarm and delay every other absence in the zone. The failure is
 *    reported to the caller so an operator can see it, and the next shift's first flush overwrites the ring
 *    anyway — a stale trail is a wrong answer to "where is my rider", not a permanent one.
 *
 * The module does not ask what kind of actor was absent. The id is the key, and a customer's id has no rows in
 * D1: the deletion is a no-op that costs one batched statement. Branching on the role would mean the erasure
 * depends on a field that a future vendor live-tracking feature would have to remember to add to.
 */

import type { AbsenceRecord } from "../presence/ledger.ts";
import type { PositionStore } from "./store.ts";

/** What an erasure handler is: a function the hub can await while publishing an absence. */
export type AbsenceEraser = (record: AbsenceRecord) => Promise<void>;

/** How a failed erasure is reported. It is a callback rather than a throw, because the alarm must continue. */
export type ErasureFailureReporter = (record: AbsenceRecord, error: unknown) => void;

/**
 * Build the absence handler for a room.
 *
 * A deployment without a D1 binding gets a handler that does nothing: presence still publishes, and a
 * platform without a live-position database is a platform with nothing to erase.
 */
export function absenceEraser(store: PositionStore | null | undefined, onFailure?: ErasureFailureReporter): AbsenceEraser {
  if (store === null || store === undefined) return async () => {};
  return async (record: AbsenceRecord): Promise<void> => {
    try {
      await store.erase(record.actorId);
    } catch (error) {
      // Reported, not rethrown: the absence is already published and the rest of the alarm still has work.
      onFailure?.(record, error);
    }
  };
}
