/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * From a planned wave to the row that writes it (`11 §7`, D124).
 *
 * Two things are pinned here that a plausible wiring gets wrong. **Ranking is the weighted score, confidence is the
 * acceptance probability** — collapsing them makes the wave model multiply a sum of fourteen factors as though it
 * were a probability. And **a wave has one expiry**, from `WAVE_SCHEDULE`, not eight clock reads that happen to be
 * close.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planWaves, waveExpiryMs, type ScoredCandidate } from "../src/domain/order/assignment.ts";
import { planWaveWrite } from "../src/domain/order/dispatch-plan.ts";

const A = "0193f2a17c3e7890abcdef0123456711";
const B = "0193f2a17c3e7890abcdef0123456712";
const C = "0193f2a17c3e7890abcdef0123456713";

function candidate(riderId: string, score: number, acceptanceProbability: number): ScoredCandidate {
  return { riderId, score, acceptanceProbability };
}

const NOW = 1_700_000_000_000;

describe("ranking is the score, confidence is the acceptance (D124)", () => {
  test("a wave is ordered by the weighted score, not by who tends to say yes", () => {
    // `C` accepts most often but is worst on the fourteen factors; the planner must ask `A` first.
    const waves = planWaves([candidate(C, 0.2, 0.9), candidate(A, 0.8, 0.3)]);
    assert.deepEqual(waves[0]?.riderIds, [A, C]);
  });

  test("the confidence arithmetic still uses the acceptance probability", () => {
    const [wave] = planWaves([candidate(A, 0.9, 0.5), candidate(B, 0.8, 0.25)]);
    assert.ok(wave !== undefined);
    assert.ok(Math.abs(wave.pNone - 0.5 * 0.75) < 1e-12, `pNone was ${String(wave.pNone)}`);
  });

  test("with no scores at all, ranking falls back to acceptance and stays deterministic", () => {
    const waves = planWaves([
      { riderId: B, acceptanceProbability: 0.2 },
      { riderId: A, acceptanceProbability: 0.8 },
    ]);
    assert.deepEqual(waves[0]?.riderIds, [A, B]);
  });

  test("ranks are sequential from one, in the planner's order", () => {
    const scored = [candidate(A, 0.9, 0.4), candidate(B, 0.5, 0.4), candidate(C, 0.1, 0.4)];
    const wave = planWaves(scored)[0];
    assert.ok(wave !== undefined);
    const planned = planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 8_400, scored });
    assert.deepEqual(
      planned.offers.map((offer) => offer.rankInWave),
      [1, 2, 3],
    );
    assert.equal(planned.offers[0]?.score, 0.9);
    assert.equal(planned.offers[2]?.score, 0.1);
  });
});

describe("a wave has one expiry (D124)", () => {
  test("wave one expires twenty-five seconds after it starts", () => {
    const scored = [candidate(A, 0.9, 0.4), candidate(B, 0.8, 0.4)];
    const wave = planWaves(scored)[0];
    assert.ok(wave !== undefined);
    const planned = planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 8_400, scored });
    assert.equal(planned.expiresAtMs, NOW + 25_000);
    assert.equal(planned.expiresAtMs, waveExpiryMs(NOW, 1));
  });

  test("a later wave carries its own shorter budget", () => {
    assert.equal(waveExpiryMs(NOW, 3), NOW + 22_000);
    assert.equal(waveExpiryMs(NOW, 5), NOW + 20_000);
  });

  test("every offer in the wave carries the order's payout, not a share of it", () => {
    const scored = [candidate(A, 0.9, 0.4), candidate(B, 0.8, 0.4)];
    const wave = planWaves(scored)[0];
    assert.ok(wave !== undefined);
    const planned = planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 8_400, scored });
    assert.deepEqual(
      planned.offers.map((offer) => offer.payoutPaisa),
      [8_400, 8_400],
    );
  });

  test("the rider ids come back as the bytes an offer row points at", () => {
    const scored = [candidate(A, 0.9, 0.4)];
    const wave = planWaves(scored)[0];
    assert.ok(wave !== undefined);
    const [offer] = planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 1, scored }).offers;
    assert.equal(Buffer.from(offer?.riderId ?? new Uint8Array()).toString("hex"), A);
  });
});

describe("a plan that contradicts itself is refused (D124)", () => {
  test("a wave naming a rider nobody scored throws rather than writing a guessed score", () => {
    const scored = [candidate(A, 0.9, 0.4)];
    const wave = planWaves([candidate(A, 0.9, 0.4), candidate(B, 0.8, 0.4)])[0];
    assert.ok(wave !== undefined);
    assert.throws(() => planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 1, scored }), RangeError);
  });

  test("pNone travels with the plan, so the trace can record why the wave was sized that way", () => {
    const scored = [candidate(A, 0.9, 0.4)];
    const wave = planWaves(scored)[0];
    assert.ok(wave !== undefined);
    assert.equal(planWaveWrite(wave, { nowMs: NOW, payoutPaisa: 1, scored }).pNone, wave.pNone);
  });
});
