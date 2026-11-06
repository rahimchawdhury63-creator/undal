/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The settlement a rider submits at the end of a shift (`25 §5`, D141).
 *
 * This module is the five fields and the three comparisons the platform makes about them, and it is pure: the body
 * arrives, a claim or a refusal leaves, and nothing here reads a database or a clock. That matters because every rule
 * below is one somebody will argue about — a rider whose bKash number is not the one on file, a name spelled differently
 * from the NID — and an argument about money should be resolvable by reading one file rather than by replaying a request.
 *
 * **The transaction ID is the identity of the payment.** Ten alphanumeric characters, uppercased before anything else
 * happens, because `bKash` prints them in upper case and a rider's keyboard may not: `9h5k2m8p1q` and `9H5K2M8P1Q` are
 * the same transfer, and treating them as two would let one payment settle two debts. The format check exists to catch
 * the transposed digit *before* a reviewer spends four minutes on it.
 *
 * **A mismatch is a flag, not a refusal.** `25 §6` lists the number and name comparisons as "pass / flag" and the selfie
 * comparison as "advisory — never decisive", and the reason is written in the document: face comparison is a hint for a
 * human, not an authority. So this module answers `numberMatches` and `nameMatches` and lets the route store them
 * beside the claim. Refusing a rider whose number changed last week would trap them behind a screen they cannot pass.
 *
 * **The amount is not negotiable here.** `25 §5` says the field is pre-filled and read-only, so the only sane amounts are
 * "what is owed" and "less, through the partial path in §7". This module does not accept an amount at all: the caller
 * takes it from the balance, and the request's number is compared against it by the route, which is the only place that
 * knows the balance.
 */

/** bKash's "Send Money" transaction IDs are ten alphanumeric characters (`25 §5`). */
export const TRX_ID_PATTERN = /^[A-Z0-9]{10}$/u;

/** A Bangladeshi mobile number: `01`, then an operator digit from 3 to 9, then eight more. */
export const BKASH_NUMBER_PATTERN = /^01[3-9]\d{8}$/u;

/** How long an account name may be — `rider_cash_settlements.account_name` is `VARCHAR(96)`. */
export const MAX_ACCOUNT_NAME = 96;

/** How long a proof URL may be: the same `VARCHAR(512)` the shift selfie uses (`26`). */
export const MAX_PROOF_URL = 512;

/**
 * How long a review may take before the block lifts on its own (`25 §8`).
 *
 * The document calls this "the most important rule in this document", and the reason is in the sentence after it: it
 * converts an open-ended detention into a bounded procedure with the platform carrying the cost of its own slowness. A
 * rider is blocked because the platform has not looked at their screenshot yet, and two hours is long enough for a
 * queue and short enough that nobody loses an evening to it.
 */
export const AUTO_LIFT_MS = 2 * 60 * 60 * 1_000;

/**
 * Whether a pending submission has waited long enough that the block should lift by itself.
 *
 * `submittedAtMs` is `rider_cash_settlements.created_at`, and `null` means no claim is pending — a rider who has not
 * submitted is not being kept waiting by anybody. An unparseable timestamp is treated as *not* due: the one thing this
 * rule must never do is release a block on the strength of a clock it could not read, because the block is the
 * platform's only collection mechanism and a rider's livelihood is on the other side of the mistake.
 */
export function autoLiftDue(submittedAtMs: number | null, nowMs: number): boolean {
  if (submittedAtMs === null || !Number.isFinite(submittedAtMs) || !Number.isFinite(nowMs)) return false;
  return nowMs - submittedAtMs >= AUTO_LIFT_MS;
}

/** How similar a typed name must be to the name on file before it stops being flagged (`nameSimilarity`'s output). */
export const NAME_MATCH_THRESHOLD = 0.75;

/** The methods `rider_cash_settlements.method` accepts. */
export const SETTLEMENT_METHODS = ["BKASH", "NAGAD", "CASH_TO_OPS"] as const;

/** One settlement method. */
export type SettlementMethod = (typeof SETTLEMENT_METHODS)[number];

/** A submission that passed every local check, and the two comparisons the platform made about it. */
export interface SettlementDraft {
  readonly trxId: string;
  readonly bkashNumber: string;
  readonly accountName: string;
  /** The Cloudinary link to the confirmation screenshot (`26` treats it as a sensitive document). */
  readonly screenshotUrl: string;
  /** The imgbb link to the rider's selfie, per the brief. */
  readonly selfieUrl: string;
  /** The amount the rider says they sent, in paisa. The route compares it to the balance. */
  readonly amountPaisa: number;
  readonly method: SettlementMethod;
}

/** A refusal, in the shape the envelope wants: code plus the details `08 §6` documents for it. */
export interface SettlementRefused {
  readonly ok: false;
  readonly code:
    | "CASH_TRXID_INVALID"
    | "CASH_SELFIE_REQUIRED"
    | "VALIDATION_REQUIRED"
    | "VALIDATION_ENUM"
    | "VALIDATION_FAILED"
    | "VALIDATION_TOO_LONG"
    | "VALIDATION_PHONE_INVALID"
    | "VALIDATION_RANGE";
  readonly details: Readonly<Record<string, unknown>>;
}

/** The body, read and checked, or the first reason it is not a settlement. */
export type SettlementBody = { readonly ok: true; readonly draft: SettlementDraft } | SettlementRefused;

/** One line of the body, or `undefined` when absent. */
function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
}

/**
 * The transaction ID as the payment is identified: trimmed and uppercased.
 *
 * Uppercasing is not cosmetic — it is what makes the uniqueness rule meaningful. Two spellings of one transfer are one
 * payment, and `uq_cash_settlement_trx` can only enforce that if every writer normalises first.
 */
export function normaliseTrxId(raw: string): string {
  return raw.trim().toUpperCase();
}

/** The digits of a phone number, which is all two spellings of one number have in common. */
function digitsOf(value: string): string {
  return value.replace(/\D/gu, "");
}

/** Whether the number the rider typed is the number on file for their payouts. */
export function sameNumber(onFile: string | null, typed: string): boolean {
  const theirs = onFile === null ? "" : digitsOf(onFile);
  const mine = digitsOf(typed);
  if (theirs.length === 0 || mine.length === 0) return false;
  // Compare the last eleven digits: `+8801812345678`, `8801812345678` and `01812345678` are one number.
  return theirs.slice(-11) === mine.slice(-11);
}

/**
 * How alike two names are, in `[0, 1]`, using the Dice coefficient over character bigrams.
 *
 * Chosen over edit distance because names differ by spelling and word order rather than by typing: "Md Karim Rahman" and
 * "Karim Rahman Md" are the same person, and Levenshtein calls them distant while bigram overlap calls them close.
 * Normalisation strips everything but letters, so punctuation, case and the Bengali/English separator fuss do not count.
 * `0` when either side has nothing to compare.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  const right = b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
  if (left.length < 2 || right.length < 2) return left.length === 0 || right.length === 0 ? 0 : left === right ? 1 : 0;
  const bigrams = (value: string): Map<string, number> => {
    const out = new Map<string, number>();
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2);
      out.set(gram, (out.get(gram) ?? 0) + 1);
    }
    return out;
  };
  const theirs = bigrams(left);
  const mine = bigrams(right);
  let shared = 0;
  for (const [gram, count] of mine) {
    const other = theirs.get(gram) ?? 0;
    shared += Math.min(count, other);
  }
  const total = left.length - 1 + (right.length - 1);
  return total === 0 ? 0 : (2 * shared) / total;
}

/** An https URL of at most `MAX_PROOF_URL`, or `null`. The app uploads to Cloudinary and imgbb (`26`). */
function proofUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_PROOF_URL) return null;
  return value.startsWith("https://") ? value : null;
}

/**
 * Read the request body into a claim.
 *
 * The order of the checks is the order the screen asks for them, so the first refusal is the field the rider is looking
 * at: transaction ID, then number, then name, then screenshot, then selfie. `method` defaults to `BKASH` because that is
 * the only method the brief mentions and the only one the screen offers.
 */
export function parseSettlement(body: unknown): SettlementBody {
  if (typeof body !== "object" || body === null) return { ok: false, code: "VALIDATION_FAILED", details: { field: "body" } };

  const rawTrxId = field(body, "trxId");
  const trxId = typeof rawTrxId === "string" ? normaliseTrxId(rawTrxId) : "";
  if (!TRX_ID_PATTERN.test(trxId))
    return { ok: false, code: "CASH_TRXID_INVALID", details: { pattern: TRX_ID_PATTERN.source } };

  const rawNumber = field(body, "bkashNumber");
  const bkashNumber = typeof rawNumber === "string" ? digitsOf(rawNumber) : "";
  if (!BKASH_NUMBER_PATTERN.test(bkashNumber))
    return { ok: false, code: "VALIDATION_PHONE_INVALID", details: { field: "bkashNumber" } };

  const rawName = field(body, "accountName");
  const accountName = typeof rawName === "string" ? rawName.trim() : "";
  if (accountName.length === 0) return { ok: false, code: "VALIDATION_REQUIRED", details: { field: "accountName" } };
  if (accountName.length > MAX_ACCOUNT_NAME)
    return { ok: false, code: "VALIDATION_TOO_LONG", details: { field: "accountName", max_length: MAX_ACCOUNT_NAME } };

  const screenshotUrl = proofUrl(field(body, "screenshotUrl"));
  if (screenshotUrl === null) return { ok: false, code: "VALIDATION_REQUIRED", details: { field: "screenshotUrl" } };

  const selfieUrl = proofUrl(field(body, "selfieUrl"));
  // The brief asks for a selfie and the contract has a code for its absence, so this one is not a generic validation
  // failure: `CASH_SELFIE_REQUIRED` is the message the screen shows next to the camera button.
  if (selfieUrl === null) return { ok: false, code: "CASH_SELFIE_REQUIRED", details: {} };

  const rawAmount = field(body, "amountPaisa");
  if (typeof rawAmount !== "number" || !Number.isInteger(rawAmount) || rawAmount < 0)
    return { ok: false, code: "VALIDATION_RANGE", details: { field: "amountPaisa", min: 0, max: 2_147_483_647 } };

  const rawMethod = field(body, "method");
  const method = rawMethod === undefined ? "BKASH" : rawMethod;
  if (typeof method !== "string" || !(SETTLEMENT_METHODS as readonly string[]).includes(method))
    return { ok: false, code: "VALIDATION_ENUM", details: { field: "method", allowed: [...SETTLEMENT_METHODS] } };

  return {
    ok: true,
    draft: {
      trxId,
      bkashNumber,
      accountName,
      screenshotUrl,
      selfieUrl,
      amountPaisa: rawAmount,
      method: method as SettlementMethod,
    },
  };
}

/** What the platform concluded about the claim, stored beside it so a reviewer sees the same verdict the rider did. */
export interface SettlementChecks {
  readonly numberMatches: boolean | null;
  readonly nameMatches: boolean | null;
}

/**
 * Compare the claim against the rider's payout details on file.
 *
 * `null` for either check when there is nothing on file to compare against — a rider who never gave a payout number has
 * a number that matches nothing, and calling that `false` would flag them for the platform's own omission.
 */
export function checkClaim(
  draft: SettlementDraft,
  onFile: { readonly payoutNumber: string | null; readonly payoutName: string | null; readonly fullName: string | null },
): SettlementChecks {
  const numberMatches = onFile.payoutNumber === null ? null : sameNumber(onFile.payoutNumber, draft.bkashNumber);
  const reference = onFile.payoutName ?? onFile.fullName;
  const nameMatches = reference === null ? null : nameSimilarity(reference, draft.accountName) >= NAME_MATCH_THRESHOLD;
  return { numberMatches, nameMatches };
}

/**
 * The nine reasons a reviewer may refuse a settlement, in `25 §6.2`'s order (D144).
 *
 * A closed list rather than free text, because this string is not a note for a file: the rider's blocking screen
 * translates it into Bangla, renders the specific instruction that goes with it, and offers the correction path that
 * makes the refusal survivable. A reviewer typing prose would be inventing a translation at 1 am.
 *
 * `OTHER` is the escape hatch and therefore the one entry that is incomplete on its own — see `parseRefusal`, which
 * requires the reviewer's sentence beside it. A code the rider cannot act on is a wall with a label.
 */
export const REJECTION_REASONS = [
  "TRXID_NOT_FOUND",
  "TRXID_ALREADY_USED",
  "AMOUNT_MISMATCH",
  "SCREENSHOT_UNREADABLE",
  "SCREENSHOT_MISMATCH",
  "SELFIE_UNCLEAR",
  "NUMBER_MISMATCH",
  "PAYMENT_NOT_RECEIVED",
  "OTHER",
] as const;

/** One of the nine. */
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Whether a string is one of the nine, for a body that arrives as `unknown`. */
export function isRejectionReason(value: unknown): value is RejectionReason {
  return typeof value === "string" && (REJECTION_REASONS as readonly string[]).includes(value);
}

/**
 * The audit register's word for the same decision.
 *
 * Two vocabularies meet in this route: the settlement's nine codes are what the *rider* reads, and the audit register's
 * codes are what the *platform* groups by. They are not the same list, and forcing one to be the other would either
 * narrow the rider's screen to two reasons or put nine settlement words into a register every other action shares. So the
 * audit row carries the nearest register code — `CASH_COUNTED_SHORT` when the money is the problem, `SETTLEMENT_DISPUTED`
 * otherwise — and the settlement row carries the precise one the rider is shown.
 */
export function auditReasonFor(reason: RejectionReason): string {
  return reason === "AMOUNT_MISMATCH" ? "CASH_COUNTED_SHORT" : "SETTLEMENT_DISPUTED";
}

/** `OTHER` alone tells a rider nothing, so it is the one code that must arrive with a sentence. */
export function refusalNeedsNote(reason: RejectionReason): boolean {
  return reason === "OTHER";
}
