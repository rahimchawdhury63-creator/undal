/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { stubDb } from "../src/db/client.ts";
import { assertClosed, isClosed, sumPaisa, LedgerImbalanceError } from "../src/domain/ledger/closure.ts";
import { postEntry } from "../src/domain/ledger/post-entry.ts";
import { reverseEntry, reversePostings } from "../src/domain/ledger/reverse.ts";
import { trialBalance } from "../src/domain/ledger/trial-balance.ts";
import { accountBalance, balancesFromDb, kindOfCode } from "../src/domain/ledger/balance.ts";
import {
  checkLedgerBalance,
  exceptionFromImbalance,
  imbalanceException,
  LEDGER_IMBALANCE_SEVERITY,
  LEDGER_IMBALANCE_TRIGGER,
} from "../src/domain/ledger/imbalance.ts";
import { naturalBalance, PLATFORM_ACCOUNTS, riderAccount, riderCashAccount, vendorAccount } from "../src/domain/ledger/accounts.ts";
import type { AccountKind, Posting, PostingSet } from "../src/domain/ledger/types.ts";
import {
  adjustment,
  bundleCredit,
  cashSettled,
  cashWriteOff,
  invoiceAccrual,
  loyalty,
  orderCancelled,
  orderDelivered,
  orderDeliveredPickup,
  promoPlatform,
  promoVendor,
  refundCredit,
  riderBonusPlatform,
  riderPayout,
  riderPenalty,
  rounding,
  tip,
  vendorPayout,
  weatherSubsidy,
  deliveredBreakdown,
} from "../src/domain/money/postings/index.ts";
import { Lcg } from "./generators/ledger.ts";

/**
 * The three properties `24 §12` names, plus the reversal invariants.
 *
 * `ledger-closure` runs ten thousand generated cases through every posting set; the trial
 * balance runs over a hundred thousand postings; the reversal tests prove a correction is a
 * mirror and not a deletion. The generator is committed and the seed is fixed, so a failure
 * here is reproducible on any machine from the seed alone.
 */

const VENDOR = "0193f2a1-7c3e-7890-abcd-ef0123456789";
const RIDER = "0193f2a1-7c3e-7890-abcd-ef01234567bb";
const ORDER = "0193f2a1-7c3e-7890-abcd-ef01234567cc";
const CUSTOMER = "0193f2a1-7c3e-7890-abcd-ef01234567dd";
const INVOICE = "0193f2a1-7c3e-7890-abcd-ef01234567ee";

/** Build one random posting set, choosing the generator and its inputs from the same seed. */
function randomSet(rng: Lcg): PostingSet {
  const subtotal = rng.between(1_000, 500_000);
  const rideCore = rng.between(2_500, 22_000);
  const amount = rng.between(100, 100_000);
  const choice = rng.between(0, 20);

  switch (choice) {
    case 0:
    case 1:
    case 2:
      return orderDelivered({
        orderId: ORDER,
        vendorId: VENDOR,
        riderId: RIDER,
        subtotalPaisa: subtotal,
        rideCorePaisa: rideCore,
        ...(rng.chance(1, 2) ? { tipPaisa: rng.between(0, 20_000) } : {}),
        ...(rng.chance(1, 3)
          ? {
              smallOrderFeePaisa: 2_500,
              smallOrderRiderSharePaisa: rng.between(0, 1_000),
              smallOrderVendorSharePaisa: rng.between(0, 1_000),
            }
          : {}),
      });
    case 3:
      return orderDeliveredPickup({ orderId: ORDER, vendorId: VENDOR, subtotalPaisa: subtotal, smallOrderFeePaisa: rng.between(0, 2_500) });
    case 4:
      return orderCancelled({
        orderId: ORDER,
        vendorId: VENDOR,
        customerId: CUSTOMER,
        preparedCostPaisa: amount,
        refundedToCustomerPaisa: rng.between(0, amount),
      });
    case 5:
      return refundCredit({ orderId: ORDER, customerId: CUSTOMER, amountPaisa: amount });
    case 6:
      return tip({ orderId: ORDER, riderId: RIDER, amountPaisa: amount });
    case 7:
      return promoPlatform({ orderId: ORDER, amountPaisa: amount });
    case 8:
      return promoVendor({ orderId: ORDER, vendorId: VENDOR, amountPaisa: amount });
    case 9:
      return weatherSubsidy({ orderId: ORDER, riderId: RIDER, amountPaisa: amount });
    case 10:
      return rounding({ orderId: ORDER, deltaPaisa: -rng.between(1, 100) });
    case 11:
      return bundleCredit({ orderId: ORDER, amountPaisa: amount });
    case 12:
      return riderBonusPlatform({ orderId: ORDER, riderId: RIDER, subtotalPaisa: subtotal });
    case 13:
      return riderPenalty({ riderId: RIDER, amountPaisa: amount, reason: "generated case" });
    case 14:
      return loyalty({ customerId: CUSTOMER, amountPaisa: amount, direction: rng.chance(1, 2) ? "ISSUE" : "REDEEM" });
    case 15:
      return invoiceAccrual({ vendorId: VENDOR, amountPaisa: amount, invoiceId: INVOICE });
    case 16:
      return riderPayout({ riderId: RIDER, amountPaisa: amount });
    case 17:
      return vendorPayout({ vendorId: VENDOR, amountPaisa: amount });
    case 18:
      return cashSettled({ riderId: RIDER, amountPaisa: amount });
    case 19:
      return cashWriteOff({ riderId: RIDER, amountPaisa: amount, reason: "generated case" });
    default:
      return adjustment({
        debitCode: "PLATFORM:EXPENSE_COMPENSATION",
        creditTarget: { kind: "VENDOR", id: VENDOR },
        amountPaisa: amount,
        reason: "generated adjustment",
      });
  }
}

describe("ledger-closure: 10 000 generated cases", () => {
  test("every generated posting set sums to zero and obeys the money law", () => {
    const rng = new Lcg();
    let cases = 0;
    let delivered = 0;
    for (let index = 0; index < 10_000; index += 1) {
      const set = randomSet(rng);
      assert.equal(sumPaisa(set.postings), 0, `${set.entryType} case ${index}`);
      assert.ok(set.postings.length >= 2, `${set.entryType} case ${index}`);
      for (const posting of set.postings) {
        assert.ok(Number.isSafeInteger(posting.amountPaisa), `${set.entryType} ${posting.account.code}`);
        assert.notEqual(posting.amountPaisa, 0, `${set.entryType} ${posting.account.code}`);
      }
      if (set.entryType === "ORDER_DELIVERED") delivered += 1;
      cases += 1;
    }
    assert.equal(cases, 10_000);
    assert.ok(delivered > 1_000, "the generator must exercise the canonical order posting");
  });

  test("the rounding delta never exceeds ninety-nine paisa and is never positive", () => {
    const rng = new Lcg(0x1234_5678_9abc_def0n);
    for (let index = 0; index < 2_000; index += 1) {
      const money = deliveredBreakdown({
        orderId: ORDER,
        vendorId: VENDOR,
        riderId: RIDER,
        subtotalPaisa: rng.between(1_000, 500_000),
        rideCorePaisa: rng.between(2_500, 22_000),
      });
      assert.ok(money.roundingDeltaPaisa <= 0, `delta ${money.roundingDeltaPaisa}`);
      assert.ok(money.roundingDeltaPaisa > -100, `delta ${money.roundingDeltaPaisa}`);
      assert.equal(money.cashCollectedPaisa % 100, 0);
      assert.equal(money.cashCollectedPaisa - money.roundingDeltaPaisa, money.rawTotalPaisa);
    }
  });
});

describe("trial balance", () => {
  test("zero over a hundred thousand postings", () => {
    const rng = new Lcg(0xfeed_face_dead_beefn);
    const postings: Posting[] = [];
    const kinds = new Map<string, AccountKind>();
    for (let index = 0; index < 35_000; index += 1) {
      const set = randomSet(rng);
      for (const posting of set.postings) {
        postings.push(posting);
        kinds.set(posting.account.code, posting.account.kind);
      }
    }
    assert.ok(postings.length >= 100_000, `only ${postings.length} postings`);

    const balance = trialBalance(postings, kinds);
    assert.equal(balance.differencePaisa, 0);
    assert.equal(balance.debitTotalPaisa, balance.creditTotalPaisa);
  });

  test("the natural balance flips a liability's sign and leaves an asset alone", () => {
    assert.equal(naturalBalance("LIABILITY", -36_900), 36_900);
    assert.equal(naturalBalance("REVENUE", -6_750), 6_750);
    assert.equal(naturalBalance("ASSET", 52_400), 52_400);
    assert.equal(naturalBalance("EXPENSE", 6), 6);
  });
});

describe("reversal invariants", () => {
  test("the mirror negates every posting and closes", () => {
    const set = orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 });
    const mirrored = reversePostings(set.postings);
    assert.equal(mirrored.length, set.postings.length);
    assert.equal(sumPaisa(mirrored), 0);
    for (const [index, posting] of mirrored.entries()) {
      assert.equal(posting.amountPaisa, -(set.postings[index]?.amountPaisa ?? 0));
      assert.equal(posting.account.code, set.postings[index]?.account.code);
    }
    assert.equal(sumPaisa([...set.postings, ...mirrored]), 0);
  });

  test("an entry that does not exist, and one already reversed, are refused", async () => {
    const missing = stubDb([{ match: /FROM `ledger_entries` WHERE `id` = \?/u, rows: [] }]);
    await assert.rejects(reverseEntry(missing, { entryId: ORDER, reason: "operator error correction" }), /does not exist/u);

    const reversed = stubDb([
      { match: /FROM `ledger_entries` WHERE `id` = \?/u, rows: [{ id: new Uint8Array(16), entry_type: "ORDER_DELIVERED", description: "x", order_id: null, invoice_id: null, settlement_id: null }] },
      { match: /FROM `ledger_entries` WHERE `reverses_id` = \?/u, rows: [{ id: new Uint8Array(16) }] },
    ]);
    await assert.rejects(reverseEntry(reversed, { entryId: ORDER, reason: "operator error correction" }), /already reversed/u);
  });
});

describe("postEntry", () => {
  const baseHandlers = [
    { match: /COUNT\(\*\) AS entries/u, rows: [{ entries: 41 }] },
    { match: /INSERT IGNORE INTO `ledger_accounts`/u, affectedRows: 1 },
    { match: /INSERT INTO `ledger_entries`/u, affectedRows: 1 },
    { match: /SELECT `id` FROM `ledger_accounts`/u, rows: [{ id: new Uint8Array(16).fill(7) }] },
    { match: /INSERT INTO `ledger_postings`/u, affectedRows: 7 },
    { match: /SUM\(`amount_paisa`\)/u, rows: [{ total: 0 }] },
  ];

  test("writes the entry, the postings, and confirms the sum from the rows", async () => {
    const db = stubDb(baseHandlers);
    const posted = await postEntry(db, orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 }));
    assert.equal(posted.sumPaisa, 0);
    assert.equal(posted.seq, 42);
    const statements = db.calls.map((call) => call.sql);
    assert.ok(statements.some((sql) => sql.includes("INSERT IGNORE INTO `ledger_accounts`")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO `ledger_entries`")));
    assert.ok(statements.some((sql) => sql.includes("INSERT INTO `ledger_postings`")));
  });

  test("refuses a set that cannot close before it touches the database", async () => {
    const db = stubDb(baseHandlers);
    await assert.rejects(
      postEntry(db, {
        entryType: "ADJUSTMENT",
        description: "broken",
        postings: [
          { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: 100 },
          { account: vendorAccount(VENDOR), amountPaisa: -90 },
        ],
      }),
      LedgerImbalanceError,
    );
    assert.equal(db.calls.length, 0);
  });

  test("rolls the entry back when the database's own sum is not zero", async () => {
    const db = stubDb([
      ...baseHandlers.filter((handler) => !handler.match.source.includes("SUM")),
      { match: /SUM\(`amount_paisa`\)/u, rows: [{ total: 5 }] },
      { match: /DELETE FROM `ledger_postings`/u, affectedRows: 2 },
      { match: /DELETE FROM `ledger_entries`/u, affectedRows: 1 },
    ]);
    await assert.rejects(
      postEntry(db, riderPayout({ riderId: RIDER, amountPaisa: 500 })),
      LedgerImbalanceError,
    );
    assert.ok(db.calls.some((call) => call.sql.startsWith("DELETE FROM `ledger_postings`")));
  });

  test("a zero posting and a one-sided set are both refused", () => {
    assert.throws(
      () =>
        assertClosed("ADJUSTMENT", [
          { account: riderAccount(RIDER), amountPaisa: 0 },
          { account: PLATFORM_ACCOUNTS.BANK, amountPaisa: 0 },
        ]),
      /zero posting/u,
    );
    assert.throws(() => assertClosed("TIP", [{ account: riderCashAccount(RIDER), amountPaisa: 500 }]), LedgerImbalanceError);
    assert.equal(isClosed([]), true);
  });
});

describe("balances", () => {
  test("a kind is decided by the code, and an owned asset is an asset", () => {
    assert.equal(kindOfCode("PLATFORM:REVENUE_COMMISSION"), "REVENUE");
    assert.equal(kindOfCode("PLATFORM:TAX_PAYABLE"), "LIABILITY");
    assert.equal(kindOfCode(`RIDER_CASH:${RIDER}`), "ASSET");
    assert.equal(kindOfCode(`VENDOR:${VENDOR}`), "LIABILITY");
    assert.throws(() => kindOfCode("NOT_A_CODE"), /unknown account code/u);
  });

  test("the in-memory balance reports both sides of a set", () => {
    const set = orderDelivered({ orderId: ORDER, vendorId: VENDOR, riderId: RIDER, subtotalPaisa: 45_000, rideCorePaisa: 6_520 });
    const vendorLines = set.postings.filter((posting) => posting.account.code === `VENDOR:${VENDOR}`);
    const balance = accountBalance(vendorLines);
    assert.equal(balance.signedPaisa, -36_900);
    assert.equal(balance.naturalPaisa, 36_900, "the vendor is owed, not owing");
    assert.equal(balance.kind, "LIABILITY");
  });

  test("the database balance reads one grouped query and converts the driver's strings", async () => {
    const db = stubDb([
      { match: /FROM `ledger_accounts` a/u, rows: [{ code: `VENDOR:${VENDOR}`, kind: "LIABILITY", signed: "-36900", postings: 3 }] },
    ]);
    const balances = await balancesFromDb(db);
    assert.equal(balances.length, 1);
    assert.equal(balances[0]?.signedPaisa, -36_900);
    assert.equal(balances[0]?.naturalPaisa, 36_900);
    assert.equal(db.calls.length, 1, "one query, not one per account");
  });
});

describe("the LEDGER_IMBALANCE exception", () => {
  const balanced = { lines: [{ accountCode: "PLATFORM:BANK", rawPaisa: 500, naturalPaisa: 500 }], debitTotalPaisa: 500, creditTotalPaisa: 500, differencePaisa: 0 };
  const drifted = {
    lines: [
      { accountCode: "PLATFORM:BANK", rawPaisa: 52_400, naturalPaisa: 52_400 },
      { accountCode: `VENDOR:${VENDOR}`, rawPaisa: -36_900, naturalPaisa: 36_900 },
      { accountCode: "PLATFORM:TAX_PAYABLE", rawPaisa: -364, naturalPaisa: 364 },
    ],
    debitTotalPaisa: 52_400,
    creditTotalPaisa: 36_900,
    differencePaisa: 15_500,
  };

  test("a balanced ledger raises nothing at all", () => {
    assert.equal(imbalanceException(balanced), null);
  });

  test("a drift raises CRITICAL, immediately, naming the accounts by size", () => {
    const exception = imbalanceException(drifted);
    assert.ok(exception !== null);
    assert.equal(exception.trigger, LEDGER_IMBALANCE_TRIGGER);
    assert.equal(exception.severity, LEDGER_IMBALANCE_SEVERITY);
    assert.equal(exception.slaSeconds, 0, "immediate, not a queue with a timer");
    assert.equal(exception.differencePaisa, 15_500);
    assert.deepEqual(
      exception.accounts.map((account) => account.code),
      ["PLATFORM:BANK", `VENDOR:${VENDOR}`, "PLATFORM:TAX_PAYABLE"],
      "largest drift first, so the page names a starting point",
    );
    assert.match(exception.messageEn, /drift 15500 paisa/u);
    assert.match(exception.messageBn, /ব্যবধান/u, "the page carries both languages");
  });

  test("a posting set that fails in memory becomes the same exception, not a different one", () => {
    const error = new LedgerImbalanceError("ORDER_DELIVERED", 250, [
      { account: riderCashAccount(RIDER), amountPaisa: 500 },
      { account: vendorAccount(VENDOR), amountPaisa: -250 },
    ]);
    const exception = exceptionFromImbalance(error);
    assert.equal(exception.trigger, "LEDGER_IMBALANCE");
    assert.equal(exception.differencePaisa, 250);
    assert.equal(exception.debitTotalPaisa, 500);
    assert.equal(exception.creditTotalPaisa, -250);
    assert.match(exception.messageEn, /ORDER_DELIVERED posting set did not close/u);
  });

  test("the sweep reads the database and answers the same way", async () => {
    const clean = stubDb([{ match: /SUM\(p\.`amount_paisa`\)/u, rows: [
      { code: "PLATFORM:BANK", kind: "ASSET", total: "100" },
      { code: `VENDOR:${VENDOR}`, kind: "LIABILITY", total: "-100" },
    ] }]);
    assert.equal(await checkLedgerBalance(clean, { fromIso: "2026-11-01 00:00:00.000000", toIso: "2026-11-02 00:00:00.000000" }), null);

    const dirty = stubDb([{ match: /SUM\(p\.`amount_paisa`\)/u, rows: [
      { code: "PLATFORM:BANK", kind: "ASSET", total: "100" },
      { code: `VENDOR:${VENDOR}`, kind: "LIABILITY", total: "-90" },
    ] }]);
    const exception = await checkLedgerBalance(dirty, { fromIso: "2026-11-01 00:00:00.000000", toIso: "2026-11-02 00:00:00.000000" });
    assert.ok(exception !== null);
    assert.equal(exception.differencePaisa, 10);
  });
});
