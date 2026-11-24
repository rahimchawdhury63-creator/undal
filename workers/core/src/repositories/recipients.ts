/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Who a push is addressed to (D93).
 *
 * A ring needs three facts that live in three tables: the vendor's owner, the tokens that owner's devices
 * registered, and the area the customer's address names. They are one module because they answer one question
 * — *whose phone should ring, and what should it say* — and because a caller that reached into three
 * repositories to assemble a notification would eventually assemble it slightly differently than the next
 * caller.
 *
 * Every function here is a read and none of them throws on "nothing found": a vendor with no registered device
 * is a real state, and the ring's job is to notice it and say so, not to fail an order that is already placed.
 */

import type { Db } from "../db/client.ts";

/** The most devices one vendor's ring will address. A shop with more than five reception phones is a bug. */
export const MAX_VENDOR_DEVICES = 5;

/**
 * The user who owns a vendor.
 *
 * `vendors.owner_user_id` rather than a staff table, because staff do not exist yet: when they do, this is the
 * one place that learns about them, and the ring keeps ringing whoever it returns.
 */
export async function vendorOwnerUserId(db: Db, vendorId: Uint8Array): Promise<Uint8Array | null> {
  const row = await db.first<{ owner_user_id: Uint8Array }>(
    "SELECT `owner_user_id` FROM `vendors` WHERE `id` = ?",
    [vendorId],
  );
  return row === null ? null : new Uint8Array(row.owner_user_id);
}

/**
 * The live FCM tokens of a user's devices.
 *
 * `valid` is the whole point: a token FCM has already told us is unregistered is not a phone, and ringing it
 * is a failed dispatch logged against a vendor who was never going to hear it. Newest first, so a vendor who
 * reinstalled the app has their current phone first in the list.
 */
export async function tokensForUser(db: Db, userId: Uint8Array): Promise<readonly string[]> {
  const rows = await db.query<{ fcm_token: string }>(
    "SELECT `t`.`fcm_token` FROM `device_tokens` `t` JOIN `devices` `d` ON `d`.`id` = `t`.`device_id` " +
      "WHERE `d`.`user_id` = ? AND `t`.`valid` = 1 ORDER BY `t`.`refreshed_at` DESC LIMIT ?",
    [userId, MAX_VENDOR_DEVICES],
  );
  return rows.map((row) => String(row.fcm_token)).filter((token) => token !== "");
}

/**
 * The address the order is being delivered to, or `null`.
 *
 * Read back from the order rather than passed in: the draft a placement builds carries coordinates, and the
 * address row is what knows the label a vendor recognises. One read here beats threading an optional field
 * through the placement plan for a display string.
 */
export async function deliveryAddressIdOf(db: Db, orderId: Uint8Array): Promise<Uint8Array | null> {
  const row = await db.first<{ delivery_address_id: Uint8Array | null }>(
    "SELECT `delivery_address_id` FROM `orders` WHERE `id` = ?",
    [orderId],
  );
  const value = row?.delivery_address_id ?? null;
  return value === null ? null : new Uint8Array(value);
}

/**
 * The area the customer's address names, or `null`.
 *
 * `addresses.area` is nullable and often is: a customer who pinned a map point typed no area. The payload
 * carries an empty string in that case rather than inventing one, because a vendor reading "Mirpur" when the
 * order is in Sylhet is worse than reading nothing.
 */
export async function areaForAddress(db: Db, addressId: Uint8Array | null): Promise<string | null> {
  if (addressId === null) return null;
  const row = await db.first<{ area: string | null }>("SELECT `area` FROM `addresses` WHERE `id` = ?", [addressId]);
  const area = row?.area ?? null;
  return area === null || area.trim() === "" ? null : area.trim();
}
