/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Waking a zone room that has no sockets (`11 §7`, D132).
 *
 * A Durable Object's alarm survives the request that armed it and fires whether or not anybody is connected — which is
 * exactly what a quiet zone needs and exactly what it cannot get on its own, because nothing dials a room nobody is
 * holding. The one thing that does reach such a room is the broadcast of the wave itself: core announces an offer, the
 * Worker forwards it, and addressing the room wakes the object.
 *
 * So the announcement carries the wake with it. This client posts the instants (`hubs/dispatch-deadline.ts` works out
 * which) to the room's `/internal/wake`, and the room arms its own alarm. From then on the loop sustains itself: the
 * alarm fires, the tick advances the wave, core announces the next one, and that announcement arms the next wake.
 *
 * **A failure here is a missed wake, not a failed broadcast.** The frame is already recorded and the offer already
 * announced; the tick runs at the next instant any other zone's alarm produces. The answer is a boolean so the route
 * can count what it managed.
 */

/** Where a zone room takes its wake instants. Kept beside the room's route so the two cannot drift. */
export const ZONE_WAKE_PATH = "/internal/wake";

/** The addressing a wake needs: `get`/`idFromName` is how every other room in this Worker is reached. */
export interface WakeNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): { fetch(request: Request): Promise<Response> };
}

/** How the wake is posted, so a test can supply a transport. */
export interface WakeDeps {
  readonly namespace: WakeNamespace;
  /** Overrides the stub call. Receives the zone and the request to deliver; a test records instead. */
  readonly send?: (zoneId: string, request: Request) => Promise<Response>;
}

/**
 * Build the wake. One call per announced wave, addressed by zone.
 *
 * The zone is the *same* name the socket route uses (`zone:{id}`), because a second naming scheme would be a second
 * room holding nothing.
 */
export function zoneWake(deps: WakeDeps): (zoneId: string, atMs: readonly number[]) => Promise<boolean> {
  const send =
    deps.send ??
    ((zoneId: string, request: Request) =>
      deps.namespace.get(deps.namespace.idFromName(`zone:${zoneId}`)).fetch(request));
  return async (zoneId, atMs) => {
    if (zoneId === "" || atMs.length === 0) return false;
    const request = new Request(`https://zone-hub${ZONE_WAKE_PATH}?zone=${encodeURIComponent(zoneId)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ atMs }),
    });
    try {
      return (await send(zoneId, request)).ok;
    } catch {
      // A room that cannot be reached is a room that will not tick; the caller's log line is the whole record.
      return false;
    }
  };
}
