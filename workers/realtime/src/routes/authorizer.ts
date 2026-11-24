/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The production channel authorizer (`05 §4.3`, D82).
 *
 * Five channel kinds and five different questions, which is why this is a table of rules rather than one
 * predicate:
 *
 * - `rider:<id>`, `vendor:<id>`, `admin:<id>` are identity channels. Only that actor, and only in the kind
 *   their actor type owns. A rider watching a vendor's order queue would see every order in the shop.
 * - `zone:<id>` is the admin map's channel and carries every order in the zone. Admins only, and only in a
 *   zone their token names.
 * - `order:<id>` is answered by `undal-core` through the `OrderViewer` port, because the three facts that
 *   decide it (owner, vendor, assigned rider) are order rows that realtime does not hold. Admins are the
 *   exception: they already read any order through the API, so a hop to be told what `getOrder` would
 *   already have told them is a hop that can only fail.
 *
 * Everything not in that table is refused, including a channel kind added later that nobody taught this
 * function about. A default-allow on an authorization table is a table that gets quieter as it grows.
 */

import type { Channel } from "../sse/channels.ts";
import type { OrderViewer } from "../authority/order-viewer.ts";
import type { ChannelAuthorizer, StreamPrincipal } from "./stream.ts";

/** Whether an admin's token covers a zone. An absent or empty list means every zone. */
function inZoneScope(principal: StreamPrincipal, zoneId: string): boolean {
  const zones = principal.zoneIds;
  if (zones === null || zones === undefined || zones.length === 0) return true;
  return zones.includes(zoneId);
}

/** The channel kinds that name one actor, and the actor type that owns each. */
const IDENTITY_KINDS: Readonly<Record<string, StreamPrincipal["actorType"]>> = {
  rider: "RIDER",
  vendor: "VENDOR_OWNER",
  admin: "ADMIN",
};

/**
 * Build the authorizer over an order viewer.
 *
 * The viewer is a parameter rather than an import so that the refusing deployment (`NO_ORDERS`) and the
 * wired one differ only in what they were given, and so a test of the policy never makes a network call.
 */
export function channelAuthorizer(viewer: OrderViewer): ChannelAuthorizer {
  return {
    async allows(principal: StreamPrincipal, channel: Channel): Promise<boolean> {
      const identityKind = IDENTITY_KINDS[channel.kind];
      if (identityKind !== undefined) {
        return principal.actorType === identityKind && channel.id === principal.actorId;
      }
      if (channel.kind === "zone") {
        return principal.actorType === "ADMIN" && inZoneScope(principal, channel.id);
      }
      if (channel.kind === "order") {
        if (principal.actorType === "ADMIN") return true;
        return viewer.mayWatch({
          actorId: principal.actorId,
          actorType: principal.actorType,
          orderId: channel.id,
        });
      }
      return false;
    },
  };
}
