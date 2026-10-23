/**
 * @file packages/shared_ts/src/money.ts
 * @description Canonical UNDAL Money, VAT Extraction (`5/105`), Commission (`15%`),
 * Rider Bonus (`3%`), Ledger Waterfall & BDT Formatter (`Master Guide File 10` & `Appendix F`).
 *
 * Every money figure in UNDAL is stored and transported in integer **poisha** (`100 poisha = ৳1`).
 * Matches SQL (`Build 4`) and Dart (`package:undal_core`) poisha-for-poisha across all vectors.
 */

import { roundHalfUpDiv, toSafePoishaBigInt } from './rational.ts';

/** Supported locale identifiers across all 5 UNDAL surfaces (`D-20`). */
export type UndalLocale = 'en' | 'bn';

/** Supported order fulfilment modes (`D-24`). */
export type FulfilmentMode = 'delivery' | 'pickup';

/** Admin-configurable platform money policy (`Appendix M` group `money.*`). */
export interface MoneyPolicyConfig {
  /** Default vendor commission percentage on discounted food payable (`15` = 15%). */
  readonly commissionPct: number;
  /** VAT percentage already included inside menu prices (`5` -> `5 / 105` extraction, `D-08`). */
  readonly vatInclusivePct: number;
  /** Rider food-value bonus percentage allocated out of extracted tax stream (`3` = 3%, `D-07`). */
  readonly riderBonusPct: number;
  /** Customer platform service fee on delivery orders (`500` poisha = `৳5.00`; `0` on pickup). */
  readonly defaultPlatformFeePoisha: number;
}

/** Canonical default money policy matching `Appendix F` & `Appendix M`. */
export const DEFAULT_MONEY_POLICY: MoneyPolicyConfig = {
  commissionPct: 15,
  vatInclusivePct: 5,
  riderBonusPct: 3,
  defaultPlatformFeePoisha: 500,
} as const;

/** Input to `priceOrder()` representing a validated single-vendor basket. */
export interface OrderPricingInput {
  readonly fulfilment: FulfilmentMode;
  readonly itemsPoisha: number;
  readonly discountVendorPoisha: number;
  readonly discountPlatformPoisha: number;
  readonly deliveryFeePoisha?: number;
  readonly platformFeePoisha?: number;
  readonly tipPoisha?: number;
  readonly commissionPctOverride?: number;
}

/** Immutable integer-poisha money snapshot persisted onto `orders` (`File 10 §10.2`). */
export interface OrderMoneySnapshot {
  readonly fulfilment: FulfilmentMode;
  readonly itemsPoisha: number;
  readonly discountVendorPoisha: number;
  readonly discountPlatformPoisha: number;
  readonly discountTotalPoisha: number;
  readonly foodPayablePoisha: number;
  readonly taxExtractedPoisha: number;
  readonly deliveryFeePoisha: number;
  readonly platformFeePoisha: number;
  readonly tipPoisha: number;
  readonly codCollectPoisha: number;
  readonly commissionPoisha: number;
  readonly riderBonusPoisha: number;
  readonly taxPoolRemainderPoisha: number;
  readonly vendorNetPoisha: number;
}

/** Signed double-checked ledger entry row mirroring `public.ledger_entries` (`File 10 §10.4`). */
export interface ComputedLedgerEntry {
  readonly actorType: 'vendor' | 'rider' | 'undal';
  readonly actorId: string | null;
  readonly kind:
    | 'vendor_payable'
    | 'commission'
    | 'rider_fare'
    | 'rider_bonus'
    | 'tip'
    | 'cod_liability'
    | 'discount_fund';
  readonly amountPoisha: number;
  readonly memo: string;
}

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

/**
 * Replaces ASCII digits `0-9` with Bengali digits `০-৯` (`File 25 §25.3`).
 */
export function toBengaliDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => BENGALI_DIGITS[Number(d)] ?? d);
}

/**
 * Normalises Bengali digits `০-৯` (and Arabic-Indic digits) back to ASCII `0-9` for input parsing.
 */
export function fromBengaliDigits(input: string): string {
  return input.replace(/[০-৯]/g, (ch) => String(ch.charCodeAt(0) - 0x09e6));
}

/**
 * Formats integer poisha as South Asian `৳` BDT currency (`৳1,839.40` or `৳১,৮৩৯.৪০`).
 * Uses Indian/Bangladeshi `3,2,2` grouping (`৳1,23,456.75`).
 */
export function formatBdt(
  poisha: number,
  locale: UndalLocale = 'en',
  options: { readonly trimZeroDecimals?: boolean } = {},
): string {
  if (!Number.isSafeInteger(poisha)) {
    throw new RangeError(`poisha must be a safe integer; received ${poisha}`);
  }
  const negative = poisha < 0;
  const abs = Math.abs(poisha);
  const takaInt = Math.floor(abs / 100);
  const poishaPart = String(abs % 100).padStart(2, '0');

  const rawInt = String(takaInt);
  const groupedInt =
    rawInt.length <= 3
      ? rawInt
      : `${rawInt.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${rawInt.slice(-3)}`;

  const showDecimals = !(options.trimZeroDecimals && poishaPart === '00');
  const formattedDigits = showDecimals ? `${groupedInt}.${poishaPart}` : groupedInt;
  const localizedDigits = locale === 'bn' ? toBengaliDigits(formattedDigits) : formattedDigits;
  return `${negative ? '-' : ''}৳${localizedDigits}`;
}

/**
 * Parses a user-entered BDT Taka string in either English or Bengali numerals into integer poisha.
 */
export function parseBdtInputToPoisha(rawInput: string): number {
  const cleaned = fromBengaliDigits(rawInput)
    .replace(/৳|BDT|Tk|,/gi, '')
    .trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Invalid BDT money input: "${rawInput}"`);
  }
  const [taka = '0', decimals = ''] = cleaned.split('.');
  const poisha = Number(taka) * 100 + Number(decimals.padEnd(2, '0'));
  if (!Number.isSafeInteger(poisha)) {
    throw new RangeError(`BDT input exceeds safe integer poisha range: "${rawInput}"`);
  }
  return poisha;
}

/**
 * Executes the canonical UNDAL order money waterfall (`File 10 §10.2`) in exact `BigInt` poisha.
 */
export function priceOrder(
  input: OrderPricingInput,
  policy: MoneyPolicyConfig = DEFAULT_MONEY_POLICY,
): OrderMoneySnapshot {
  const items = toSafePoishaBigInt(input.itemsPoisha, 'itemsPoisha');
  const discV = toSafePoishaBigInt(input.discountVendorPoisha, 'discountVendorPoisha');
  const discP = toSafePoishaBigInt(input.discountPlatformPoisha, 'discountPlatformPoisha');
  if (items < 0n || discV < 0n || discP < 0n) {
    throw new RangeError('Order money inputs cannot be negative.');
  }

  const discTotal = discV + discP;
  if (discTotal > items) {
    throw new RangeError(`Total discount (${discTotal}) cannot exceed items (${items}).`);
  }

  const isPickup = input.fulfilment === 'pickup';
  const deliveryFee = isPickup
    ? 0n
    : toSafePoishaBigInt(input.deliveryFeePoisha ?? 0, 'deliveryFeePoisha');
  const platformFee = isPickup
    ? 0n
    : toSafePoishaBigInt(
        input.platformFeePoisha ?? policy.defaultPlatformFeePoisha,
        'platformFeePoisha',
      );
  const tip = isPickup ? 0n : toSafePoishaBigInt(input.tipPoisha ?? 0, 'tipPoisha');

  const foodPayable = items - discTotal;
  const vatNum = BigInt(Math.round(policy.vatInclusivePct * 100));
  const taxExtracted = roundHalfUpDiv(foodPayable * vatNum, 10_000n + vatNum);

  const commBps = BigInt(Math.round((input.commissionPctOverride ?? policy.commissionPct) * 100));
  const bonusBps = BigInt(Math.round(policy.riderBonusPct * 100));

  const commission = roundHalfUpDiv(foodPayable * commBps, 10_000n);
  const riderBonus = roundHalfUpDiv(foodPayable * bonusBps, 10_000n);
  const taxPoolRemainder = taxExtracted - riderBonus;

  // File 10 §10.2 exact funding formula:
  // foodPayable already deducted BOTH vendor & platform discounts, so Undal reimburses discountPlatform:
  const vendorNet = foodPayable + discP - commission;
  const codCollect = foodPayable + deliveryFee + platformFee + tip;

  return {
    fulfilment: input.fulfilment,
    itemsPoisha: Number(items),
    discountVendorPoisha: Number(discV),
    discountPlatformPoisha: Number(discP),
    discountTotalPoisha: Number(discTotal),
    foodPayablePoisha: Number(foodPayable),
    taxExtractedPoisha: Number(taxExtracted),
    deliveryFeePoisha: Number(deliveryFee),
    platformFeePoisha: Number(platformFee),
    tipPoisha: Number(tip),
    codCollectPoisha: Number(codCollect),
    commissionPoisha: Number(commission),
    riderBonusPoisha: Number(riderBonus),
    taxPoolRemainderPoisha: Number(taxPoolRemainder),
    vendorNetPoisha: Number(vendorNet),
  };
}

/**
 * Generates the append-only ledger rows recorded when an order completes (`File 10 §10.4`).
 */
export function buildOrderLedgerEntries(
  snapshot: OrderMoneySnapshot,
  params: { readonly vendorId: string; readonly riderId: string | null; readonly riderFarePoisha: number },
): readonly ComputedLedgerEntry[] {
  const entries: ComputedLedgerEntry[] = [
    {
      actorType: 'vendor',
      actorId: params.vendorId,
      kind: 'vendor_payable',
      amountPoisha: snapshot.foodPayablePoisha + snapshot.discountPlatformPoisha,
      memo: 'Food payable plus Undal-funded promotion reimbursement',
    },
    {
      actorType: 'vendor',
      actorId: params.vendorId,
      kind: 'commission',
      amountPoisha: -snapshot.commissionPoisha,
      memo: 'Undal food commission deduction',
    },
    {
      actorType: 'undal',
      actorId: null,
      kind: 'commission',
      amountPoisha: snapshot.commissionPoisha,
      memo: 'Undal food commission revenue',
    },
  ];

  if (snapshot.discountPlatformPoisha > 0) {
    entries.push({
      actorType: 'undal',
      actorId: null,
      kind: 'discount_fund',
      amountPoisha: -snapshot.discountPlatformPoisha,
      memo: 'Undal platform-funded campaign/voucher subsidy',
    });
  }

  if (snapshot.fulfilment === 'delivery' && params.riderId) {
    entries.push(
      {
        actorType: 'rider',
        actorId: params.riderId,
        kind: 'rider_fare',
        amountPoisha: params.riderFarePoisha,
        memo: 'Completed delivery dynamic rider fare',
      },
      {
        actorType: 'rider',
        actorId: params.riderId,
        kind: 'rider_bonus',
        amountPoisha: snapshot.riderBonusPoisha,
        memo: '3% food-value rider bonus allocation',
      },
      {
        actorType: 'rider',
        actorId: params.riderId,
        kind: 'cod_liability',
        amountPoisha: -snapshot.codCollectPoisha,
        memo: 'Cash on Delivery collected from customer (owed until remitted)',
      },
    );
    if (snapshot.tipPoisha > 0) {
      entries.push({
        actorType: 'rider',
        actorId: params.riderId,
        kind: 'tip',
        amountPoisha: snapshot.tipPoisha,
        memo: '100% customer tip allocated to rider',
      });
    }
  }

  return entries;
}

/** Canonical 8 Golden Money Vectors from `Appendix F` verified in SQL + TS + Dart (`MNY-01`). */
export const GOLDEN_MONEY_VECTORS = [
  {
    id: 'M-1',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 54100, discountVendorPoisha: 10820, discountPlatformPoisha: 0, deliveryFeePoisha: 0, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 43280, taxExtractedPoisha: 2061, commissionPoisha: 6492, riderBonusPoisha: 1298, vendorNetPoisha: 36788, codCollectPoisha: 43780 },
  },
  {
    id: 'M-2',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 30000, discountVendorPoisha: 0, discountPlatformPoisha: 0, deliveryFeePoisha: 6000, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 30000, taxExtractedPoisha: 1429, commissionPoisha: 4500, riderBonusPoisha: 900, vendorNetPoisha: 25500, codCollectPoisha: 36500 },
  },
  {
    id: 'M-3',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 40000, discountVendorPoisha: 5000, discountPlatformPoisha: 5000, deliveryFeePoisha: 2000, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 30000, taxExtractedPoisha: 1429, commissionPoisha: 4500, riderBonusPoisha: 900, vendorNetPoisha: 30500, codCollectPoisha: 32500 },
  },
  {
    id: 'M-4',
    input: { fulfilment: 'pickup' as const, itemsPoisha: 25000, discountVendorPoisha: 2500, discountPlatformPoisha: 0 },
    expected: { foodPayablePoisha: 22500, taxExtractedPoisha: 1071, commissionPoisha: 3375, riderBonusPoisha: 675, vendorNetPoisha: 19125, codCollectPoisha: 22500 },
  },
  {
    id: 'M-5',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 270500, discountVendorPoisha: 54100, discountPlatformPoisha: 0, deliveryFeePoisha: 13000, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 216400, taxExtractedPoisha: 10305, commissionPoisha: 32460, riderBonusPoisha: 6492, vendorNetPoisha: 183940, codCollectPoisha: 229900 },
  },
  {
    id: 'M-6',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 9900, discountVendorPoisha: 0, discountPlatformPoisha: 0, deliveryFeePoisha: 5000, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 9900, taxExtractedPoisha: 471, commissionPoisha: 1485, riderBonusPoisha: 297, vendorNetPoisha: 8415, codCollectPoisha: 15400 },
  },
  {
    id: 'M-7',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 35000, discountVendorPoisha: 0, discountPlatformPoisha: 11000, deliveryFeePoisha: 5000, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 24000, taxExtractedPoisha: 1143, commissionPoisha: 3600, riderBonusPoisha: 720, vendorNetPoisha: 31400, codCollectPoisha: 29500 },
  },
  {
    id: 'M-8',
    input: { fulfilment: 'delivery' as const, itemsPoisha: 18000, discountVendorPoisha: 1800, discountPlatformPoisha: 0, deliveryFeePoisha: 0, platformFeePoisha: 500, tipPoisha: 0 },
    expected: { foodPayablePoisha: 16200, taxExtractedPoisha: 771, commissionPoisha: 2430, riderBonusPoisha: 486, vendorNetPoisha: 13770, codCollectPoisha: 16700 },
  },
] as const;
