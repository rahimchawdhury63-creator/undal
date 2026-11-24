/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { uuidBytes } from "../middleware/auth.ts";

/**
 * Keyset cursors, in one place (`25 §7`–`§8`, D157–D158).
 *
 * A cursor names the last row a caller has seen, so the next page starts strictly after it. Opaque on purpose: a client
 * that parsed it would depend on the sort key, and the sort key is ours to change. `(created_at, id)` is the pair because
 * both queues sort by submission time and a tie is possible — two riders submitting in the same microsecond, or one
 * reviewer paging a list that was written in a burst at eleven at night.
 *
 * The encoding is `btoa("created_at|id")`: base64 of two ASCII columns, which every runtime this code runs on has
 * (`workerd` and Node both provide `btoa`/`atob`), and no dependency to add. It is not signed. A cursor is an ordering
 * hint, not a capability: the statement it feeds is still filtered by permission, and a forged one can only name a
 * position in a list the caller may already read.
 */

/** The pair a keyset statement compares against. */
export interface KeysetCursor {
  readonly createdAt: string;
  readonly id: Uint8Array;
}

/** A cursor for a page's last row. */
export function encodeCursor(createdAt: string, id: string): string {
  return btoa(`${createdAt}|${id}`);
}

/** Decode a cursor, or `null` for anything that is not one this code wrote. */
export function decodeCursor(raw: string): KeysetCursor | null {
  let decoded: string;
  try {
    decoded = atob(raw);
  } catch {
    return null;
  }
  const split = decoded.lastIndexOf("|");
  if (split <= 0) return null;
  const createdAt = decoded.slice(0, split);
  const hex = decoded.slice(split + 1);
  // `DATETIME(6)` as `sqlDatetime` writes it; anything else is a cursor from another list or another age.
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?$/u.test(createdAt)) return null;
  try {
    return { createdAt, id: uuidBytes(hex) };
  } catch {
    return null;
  }
}
