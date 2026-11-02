/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { groupBdt } from "@undal/money";

/** The taka string with its symbol, which is what a sentence quotes. */
function taka(paisa: number): string {
  return groupBdt(paisa).withSymbol;
}

import type { FareBreakdown } from "../../pricing/fallback.ts";

/**
 * Why a delivery costs what it costs, in lines a customer can check.
 *
 * `02 §5.2` asks for a fee-transparency sheet, and the only version of that which survives contact
 * with a support queue is one where each line names a number the customer can verify from their own
 * order: the distance, the rate, the multiplier. "It's calculated automatically" is not an
 * explanation; "3.8 km, ৳14.00 per km beyond the first 2 km, 1.00× because the area is quiet" is.
 *
 * The lines are produced from the same breakdown the price came from, so an explanation cannot
 * describe a fee that was not charged — the failure mode that makes customers distrust every other
 * number on the screen.
 */

/** One explanation line, in both languages, with the figures it refers to. */
export interface ExplanationLine {
  readonly key: string;
  /** The English sentence, already formatted for a receipt. */
  readonly textEn: string;
  /** The Bangla sentence. */
  readonly textBn: string;
  /** The figures the sentence quotes, so a client can re-render it in another layout. */
  readonly values: Readonly<Record<string, number | string>>;
}

/** The facts an explanation needs beyond the breakdown itself. */
export interface ExplainInput {
  readonly breakdown: FareBreakdown;
  readonly distanceM: number;
  readonly baseDistanceM: number;
  readonly perKmPaisa: number;
  readonly weather: string;
  readonly trafficDelayS: number;
}

/** The surge multipliers the app phrases in words rather than basis points. */
function surgeWords(surgeBps: number): { en: string; bn: string } {
  if (surgeBps >= 15_000) return { en: "busy area", bn: "ব্যস্ত এলাকা" };
  if (surgeBps >= 12_000) return { en: "moderately busy", bn: "মাঝারি ব্যস্ত" };
  return { en: "not busy", bn: "ব্যস্ত নয়" };
}

/**
 * Build the explanation.
 *
 * Lines that would say "৳0.00" are dropped, with one exception: the multiplier is always shown, even
 * at 1.00×, because a customer who has heard the word "surge" and cannot find it on the receipt will
 * assume it was applied quietly.
 */
export function explainFare(input: ExplainInput): readonly ExplanationLine[] {
  const { breakdown } = input;
  const lines: ExplanationLine[] = [];

  lines.push({
    key: "distance",
    textEn: `${(input.distanceM / 1000).toFixed(1)} km travelled, first ${(input.baseDistanceM / 1000).toFixed(0)} km included`,
    textBn: `${(input.distanceM / 1000).toFixed(1)} কিমি পথ, প্রথম ${(input.baseDistanceM / 1000).toFixed(0)} কিমি অন্তর্ভুক্ত`,
    values: { distanceM: input.distanceM, baseDistanceM: input.baseDistanceM },
  });

  lines.push({
    key: "base",
    textEn: `Base fare ${taka(breakdown.core.surgedBasePaisa)}`,
    textBn: `বেস ভাড়া ${taka(breakdown.core.surgedBasePaisa)}`,
    values: { surgedBasePaisa: breakdown.core.surgedBasePaisa },
  });

  if (breakdown.core.distancePaisa !== 0)
    lines.push({
      key: "distance_charge",
      textEn: `Distance ${taka(breakdown.core.distancePaisa)} at ${taka(input.perKmPaisa)} per km beyond the included distance`,
      textBn: `দূরত্ব ${taka(breakdown.core.distancePaisa)}, অন্তর্ভুক্ত দূরত্বের পরে প্রতি কিমি ${taka(input.perKmPaisa)}`,
      values: { distancePaisa: breakdown.core.distancePaisa, perKmPaisa: input.perKmPaisa },
    });

  if (breakdown.core.trafficPaisa !== 0)
    lines.push({
      key: "traffic",
      textEn: `Traffic ${taka(breakdown.core.trafficPaisa)} for ${Math.floor(input.trafficDelayS / 300)} five-minute block(s)`,
      textBn: `যানজট ${taka(breakdown.core.trafficPaisa)}, ${Math.floor(input.trafficDelayS / 300)}টি পাঁচ মিনিটের জন্য`,
      values: { trafficPaisa: breakdown.core.trafficPaisa, trafficDelayS: input.trafficDelayS },
    });

  const words = surgeWords(breakdown.surgeBps);
  lines.push({
    key: "surge",
    textEn: `Multiplier ${(breakdown.surgeBps / 10_000).toFixed(2)}× — ${words.en}`,
    textBn: `গুণক ${(breakdown.surgeBps / 10_000).toFixed(2)}× — ${words.bn}`,
    values: { surgeBps: breakdown.surgeBps },
  });

  if (breakdown.weatherPaisa !== 0)
    lines.push({
      key: "weather",
      textEn: `Weather premium ${taka(breakdown.weatherPaisa)} paid by Undal to the rider, not by you`,
      textBn: `আবহাওয়া ভাতা ${taka(breakdown.weatherPaisa)} উন্ডাল রাইডারকে দেয়, আপনি নন`,
      values: { weatherPaisa: breakdown.weatherPaisa, weather: input.weather },
    });

  if (breakdown.smallOrderTotalPaisa !== 0)
    lines.push({
      key: "small_order",
      textEn: `Order fee ${taka(breakdown.smallOrderTotalPaisa)} applies to orders of ৳100 or more`,
      textBn: `অর্ডার ফি ${taka(breakdown.smallOrderTotalPaisa)} ৳১০০ বা তার বেশি অর্ডারে প্রযোজ্য`,
      values: { smallOrderTotalPaisa: breakdown.smallOrderTotalPaisa },
    });

  if (breakdown.roundingDeltaPaisa !== 0)
    lines.push({
      key: "rounding",
      textEn: `Rounded down by ${taka(-breakdown.roundingDeltaPaisa)} to the nearest taka for cash`,
      textBn: `নগদে সুবিধার জন্য ${taka(-breakdown.roundingDeltaPaisa)} কমানো হয়েছে`,
      values: { roundingDeltaPaisa: breakdown.roundingDeltaPaisa },
    });

  return lines;
}
