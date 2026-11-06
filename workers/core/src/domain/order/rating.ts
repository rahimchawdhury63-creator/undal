/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The rating a customer leaves after a delivery (`17 §8.1`, `11 §5` factor 6).
 *
 * Two numbers and a sentence, and three decisions the corpus leaves to the building agent:
 *
 * **Food and delivery are separate ratings.** `17 §8.1` says so in one line — "conflating them punishes a rider for a
 * cold kitchen and a vendor for a slow rider". A single five-star row would have made the rider's factor 6 a measure of
 * how good the restaurant is, and the vendor's rank a measure of traffic. So a row names its `target`, and the same
 * order can carry one of each.
 *
 * **The window opens at delivery and lasts seven days.** `08` fixes the closing refusal (`ORDER_RATING_WINDOW_CLOSED`)
 * but not the length. A week is the shortest interval in which a weekly customer still gets to rate the order they are
 * thinking about, and the longest in which the answer is still a memory of the meal rather than of the month. Before
 * delivery there is nothing to rate, so the rating does not exist yet — the route answers `ORDER_NOT_FOUND`, exactly as
 * it does for an order that is not yours, because a resource that has not been created is not a resource you are
 * forbidden from.
 *
 * **A rating can be corrected while its window is open.** The first tap is not always the intended one — the sheet's
 * five faces are 40 px apart and the customer may be walking — and the alternative is a support ticket an operator
 * resolves by editing a table by hand. The correction is a new audit row with the old value in `before`; the rating's
 * `created_at` stays where it was, because that is when the customer first answered.
 *
 * Nothing here touches the database or the clock: the caller supplies `nowMs`, so the window is a function and not a
 * side effect.
 */

/** How long after delivery a rating is still accepted: seven days, in milliseconds. */
export const RATING_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** The longest comment `order_ratings.comment` holds, in characters (`VARCHAR(500)`). */
export const MAX_RATING_COMMENT = 500;

/** How many tag chips one rating may carry. The sheet offers six; a client that sends more is guessing. */
export const MAX_RATING_TAGS = 6;

/**
 * The chips the customer app offers (`17 §8.1`).
 *
 * A closed set, because factor 6 reads only the stars and an operator reads the tags: free text in a `JSON` column that
 * nothing parses is a place to lose meaning in. The list is the sheet's, in the sheet's order.
 */
export const RATING_TAGS = ["HOT", "FAST", "POLITE", "PACKAGING", "CAREFUL", "FRIENDLY"] as const;

/** What a rating can be about. Food and delivery, never both. */
export type RatingTarget = "VENDOR" | "RIDER";

/** A rating the customer has stated, validated but not yet stored. */
export interface RatingDraft {
  readonly target: RatingTarget;
  readonly stars: number;
  readonly comment: string | null;
  readonly tags: readonly string[];
}

/** A validation refusal, in the shape the envelope wants: the code plus its documented details. */
export interface RatingRefused {
  readonly ok: false;
  readonly code: "VALIDATION_ENUM" | "VALIDATION_RANGE" | "VALIDATION_TOO_LONG" | "VALIDATION_FAILED";
  readonly details: Readonly<Record<string, unknown>>;
}

/** The body, read and checked, or the first reason it is not a rating. */
export type RatingBody = { readonly ok: true; readonly draft: RatingDraft } | RatingRefused;

/** One line of the body, or `undefined` when the field is absent. */
function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

/**
 * Read the request body into a draft.
 *
 * Every refusal carries the field the app should highlight, which is the only thing a customer can act on: the sheet is
 * a set of five taps, so a rejected rating is a bug or a stale client rather than something to explain at length.
 */
export function parseRatingBody(body: unknown): RatingBody {
  if (typeof body !== "object" || body === null) return { ok: false, code: "VALIDATION_FAILED", details: { field: "body" } };

  const target = field(body, "target");
  if (target !== "VENDOR" && target !== "RIDER")
    return { ok: false, code: "VALIDATION_ENUM", details: { field: "target", allowed: ["VENDOR", "RIDER"] } };

  const stars = field(body, "stars");
  if (typeof stars !== "number" || !Number.isInteger(stars) || stars < 1 || stars > 5)
    return { ok: false, code: "VALIDATION_RANGE", details: { field: "stars", min: 1, max: 5 } };

  const rawComment = field(body, "comment");
  if (rawComment !== undefined && rawComment !== null && typeof rawComment !== "string")
    return { ok: false, code: "VALIDATION_FAILED", details: { field: "comment" } };
  // Trimmed rather than rejected: a comment of spaces is a comment the customer did not write, and storing it would
  // make "has a comment" mean something it does not.
  const comment = typeof rawComment === "string" ? rawComment.trim() : "";
  if (comment.length > MAX_RATING_COMMENT)
    return { ok: false, code: "VALIDATION_TOO_LONG", details: { field: "comment", max_length: MAX_RATING_COMMENT } };

  const rawTags = field(body, "tags");
  const tags: string[] = [];
  if (rawTags !== undefined && rawTags !== null) {
    if (!Array.isArray(rawTags) || rawTags.length > MAX_RATING_TAGS)
      return { ok: false, code: "VALIDATION_ENUM", details: { field: "tags", allowed: [...RATING_TAGS] } };
    for (const tag of rawTags) {
      if (typeof tag !== "string" || !(RATING_TAGS as readonly string[]).includes(tag))
        return { ok: false, code: "VALIDATION_ENUM", details: { field: "tags", allowed: [...RATING_TAGS] } };
      // A chip tapped twice is one chip. The set is what the vendor's dashboard counts.
      if (!tags.includes(tag)) tags.push(tag);
    }
  }

  return {
    ok: true,
    draft: { target, stars, comment: comment.length === 0 ? null : comment, tags },
  };
}

/**
 * Whether a rider rating is even possible for this order.
 *
 * A pickup order has a vendor and no rider, so `target: "RIDER"` asks about somebody who was never part of it. The
 * honest answer is a validation refusal naming the target, not a stored row pointing at nobody.
 */
export function targetAllowed(fulfilment: string, target: RatingTarget): boolean {
  return target === "VENDOR" || fulfilment === "DELIVERY";
}

/** When the window closes, and whether it is still open at `nowMs`. */
export interface RatingWindow {
  /** The instant `ORDER_RATING_WINDOW_CLOSED` starts being the answer, in epoch ms. */
  readonly closesAtMs: number;
  /** Whether `nowMs` is inside the window. The route reads this and nothing else. */
  readonly open: boolean;
}

/**
 * The window for one delivery.
 *
 * `deliveredAtMs` is `orders.delivered_at`, which the state machine writes when the order reaches `DELIVERED`; a null
 * one means the order has not been delivered and the caller must not be here at all.
 */
export function ratingWindow(deliveredAtMs: number, nowMs: number): RatingWindow {
  const closesAtMs = deliveredAtMs + RATING_WINDOW_MS;
  return { closesAtMs, open: nowMs < closesAtMs };
}
