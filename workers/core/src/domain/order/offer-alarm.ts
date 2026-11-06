/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * What a rider is told when an offer is written (`11 §7`, D127).
 *
 * An offer row nobody hears about is a folder of unclaimed rows. This module builds the message that turns one into
 * an alarm, and it is pure for the same reason the scoring is: the text is a product decision (`15 §9`'s coaching
 * flow, the Bangla copy rules of `05`) and it should be possible to read it, diff it and test it without a device.
 *
 * **Data only.** The message carries `title`/`body` as *fields of the payload*, not as a platform alert object: the
 * rider app builds its own full-screen alarm from the data, because on several Android builds letting the OS draw
 * the alert means the full-screen intent never appears and a rider misses an order worth ৳1 800 (`fcm-payload-purity`,
 * `15 §9`). The data carries everything the app needs to draw it — the order code, the offer, the payout, and how
 * long is left — so the alarm is correct even if the send is delayed.
 *
 * **Both languages, always.** A rider in Sylhet reads Bangla by default and English if they chose it; the app picks.
 * Sending one language and translating on the device would mean shipping two builds of every string.
 */

/** The alarm for one offer, as the broadcast and the push both carry it. */
export interface OfferAlarm {
  /**
   * The catalogue name (`08 §9.1`) the stream and the app both switch on.
   *
   * `offer.new`, not the `order.offer` this file first spelled: the catalogue carries an Offer *group*, and realtime's
   * ring refuses a name it does not carry — so D127's spelling was an alarm that never reached a single socket (D132).
   */
  readonly event: "offer.new";
  readonly title: { readonly en: string; readonly bn: string };
  readonly body: { readonly en: string; readonly bn: string };
  /** Everything the app needs to render the alarm without a second request. */
  readonly data: {
    readonly orderCode: string;
    readonly offerId: string;
    readonly payoutPaisa: number;
    readonly pickupDistanceM: number;
    readonly expiresAtMs: number;
    /** Seconds left when the alarm was built, so a late arrival shows a truthful countdown. */
    readonly secondsRemaining: number;
  };
}

/** What the alarm is built from: the offer, and where it came from. */
export interface OfferAlarmInput {
  readonly orderCode: string;
  readonly offerId: string;
  readonly payoutPaisa: number;
  readonly pickupDistanceM: number;
  readonly expiresAtMs: number;
  readonly nowMs: number;
}

/** Taka from paisa, for the copy — integer arithmetic, because money in this platform is never a float. */
function taka(paisa: number): number {
  return Math.floor(Math.max(0, paisa) / 100);
}

/** Metres, trimmed to the precision a rider actually uses: "1.2 km". */
function distance(distanceM: number): string {
  if (distanceM < 1_000) return `${String(Math.max(0, Math.round(distanceM)))} m`;
  const tenths = Math.round(Math.max(0, distanceM) / 100);
  return `${String(Math.floor(tenths / 10))}.${String(tenths % 10)} km`;
}

/**
 * Build the alarm.
 *
 * `secondsRemaining` is computed here from the offer's own expiry rather than passed in, so the app cannot be handed a
 * countdown that disagrees with the row it is counting down. It floors at zero: an offer that is already expired still
 * produces a message, because the app has to be able to say "too late" rather than show nothing.
 */
export function offerAlarm(input: OfferAlarmInput): OfferAlarm {
  const secondsRemaining = Math.max(0, Math.floor((input.expiresAtMs - input.nowMs) / 1000));
  const pay = taka(input.payoutPaisa);
  const where = distance(input.pickupDistanceM);
  return {
    event: "offer.new",
    title: { en: "New delivery", bn: "নতুন ডেলিভারি" },
    body: {
      en: `৳${String(pay)} · ${where} to pick up · ${String(secondsRemaining)}s to accept`,
      bn: `৳${String(pay)} · পিকআপ ${where} · নিতে ${String(secondsRemaining)} সেকেন্ড`,
    },
    data: {
      orderCode: input.orderCode,
      offerId: input.offerId,
      payoutPaisa: input.payoutPaisa,
      pickupDistanceM: Math.max(0, Math.round(input.pickupDistanceM)),
      expiresAtMs: input.expiresAtMs,
      secondsRemaining,
    },
  };
}
