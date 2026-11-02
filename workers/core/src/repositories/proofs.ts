/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { fromHexId, toHexId, newId } from "../lib/ids.ts";
import type { ProofCapture } from "../domain/order/evidence.ts";

/**
 * Writing an `order_proofs` row.
 *
 * One insert and nothing else: the decision that a capture *is* evidence belongs to
 * `domain/order/evidence.ts`, and this module would be the wrong place to repeat it. The row keeps
 * the media id, the parsed payload and the position, because the three together are what a dispute
 * panel actually looks at — a photograph without a position proves a meal existed, not that it
 * arrived.
 */

/** The SQL timestamp a `datetime(6)` column wants. */
function sqlDatetime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000`;
}

/** Insert one proof and return its id. */
export async function insertProof(db: Db, capture: ProofCapture): Promise<string> {
  const id = toHexId(newId());
  await db.execute(
    "INSERT INTO `order_proofs` (`id`, `order_id`, `kind`, `media_id`, `payload`, `lat_e7`, `lon_e7`, `captured_at`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      fromHexId(id),
      fromHexId(capture.orderId),
      capture.kind,
      capture.mediaId === null ? null : fromHexId(capture.mediaId),
      capture.payload === null ? null : JSON.stringify(capture.payload),
      capture.point === null ? null : capture.point.latE7,
      capture.point === null ? null : capture.point.lonE7,
      sqlDatetime(capture.capturedAtMs),
    ],
  );
  return id;
}

/** Whether an order already has a proof of a kind, which is how a second scan is refused. */
export async function hasProofOfKind(db: Db, orderId: Uint8Array, kind: ProofCapture["kind"]): Promise<boolean> {
  const row = await db.first<{ id: Uint8Array }>("SELECT `id` FROM `order_proofs` WHERE `order_id` = ? AND `kind` = ? LIMIT 1", [orderId, kind]);
  return row !== null;
}
