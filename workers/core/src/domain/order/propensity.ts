/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The acceptance-propensity model (`09 §7.4`, D133).
 *
 * Factor 3 of the score answers *will this rider take this offer*, and until now it answered it with a rate: the Wilson
 * lower bound of everything that rider had ever answered. A rate is honest and it is not conditioned — a rider who
 * accepts four offers in five will not accept a ৳40 order two kilometres the wrong way at 23:00, and the rate cannot
 * say so. The offer's own features can.
 *
 * **Eight coefficients, and no more.** `09 §7.4` fixes that number for a reason that is not statistical: eight numbers
 * fit in one screen of the admin panel, and an operator who can see that payout has a positive weight and distance a
 * negative one knows the model is sane. Eighty coefficients predict more accurately and are unfalsifiable by anybody
 * who has to trust them.
 *
 * **The signs live in the weights, not the features.** Every feature is normalised to `[0, 1]` — a distance is *how far*
 * a rider is, not how much that costs — so the coefficient table reads as a table of opinions rather than a table of
 * units. A negative weight on `pickup` is the whole sentence "farther is worse".
 *
 * **It shrinks towards the record.** A fresh zone has no model, and a model trained on eleven offers is a rumour. So the
 * figure factor 3 receives is a blend: `samples / 50` of the model against `1 − samples / 50` of the rider's own Wilson
 * rate, which is exactly the confidence arithmetic `11 §5` already applies to every other rate in the table.
 *
 * Nothing here touches the database or the clock. The weights arrive from `platform_config` (`dispatch.propensity`,
 * versioned and audited), the features from the candidate's own facts, and the update below is the `09 §7.4` step
 * verbatim — one call per recorded outcome, with the learning rate and the L2 term as the document states them.
 */

/**
 * The eight features, in the order the weights are stored.
 *
 * The order is the wire format of `platform_config.dispatch.propensity.value.weights`, so it is a constant and not a
 * comment: a reordering would silently reinterpret every trained zone's coefficients.
 */
export const PROPENSITY_FEATURES = [
  "payout",
  "pickup",
  "trip",
  "idle",
  "todSin",
  "todCos",
  "weather",
  "batch",
] as const;

/** How many coefficients a model has. */
export const PROPENSITY_SIZE = PROPENSITY_FEATURES.length;

/** The learning rate `09 §7.4` specifies for its online step. */
export const PROPENSITY_LR = 0.01;

/** The L2 term `09 §7.4` specifies. Small enough to keep the weights bounded, large enough to matter after thousands. */
export const PROPENSITY_L2 = 0.001;

/** The logit is clamped here before the sigmoid, as the document's own snippet does. */
export const MAX_LOGIT = 30;

/** The number of recorded outcomes at which the model is trusted completely. */
export const PROPENSITY_FULL_TRUST = 50;

/** The payout that normalises feature 1 to 1: ৳100, a good delivery in Sylhet. */
export const PAYOUT_UNIT_PAISA = 10_000;

/** The pickup distance that normalises feature 2 to 1: two kilometres. */
export const PICKUP_UNIT_M = 2_000;

/** The trip distance that normalises feature 3 to 1: eight kilometres. */
export const TRIP_UNIT_M = 8_000;

/** The idle time that normalises feature 4 to 1: twenty minutes. */
export const IDLE_UNIT_S = 1_200;

/**
 * What a zone starts with before it has trained anything.
 *
 * Not zeros: a zeroed model answers 0.5 for every offer, which is not a prior — it is a shrug that would still move
 * factor 3 by the shrinkage weight. These are the signs `09 §7.4` claims an operator should be able to check by eye:
 * a better payout helps, distance and trip length hurt, a rider who has been waiting is likelier to take the next one,
 * bad weather hurts, and a batched offer is harder to accept.
 */
export const PROPENSITY_PRIOR: readonly number[] = Object.freeze([
  1.2, // payout
  -0.9, // pickup distance
  -0.4, // total trip distance
  0.6, // idle time
  0.0, // time of day, sine — the prior has no opinion, the zone's own record fills them in
  0.0, // time of day, cosine
  -0.8, // weather severity
  -1.0, // batch flag
]);

/**
 * What one recorded offer looks like to the model: the features, and whether the rider took it.
 *
 * `weight` is how much the outcome counts, and it exists because `11 §9.3` already decided that an **expired** offer
 * counts at half the strength of an explicit refusal. A rider who did nothing may have been riding, in a lift, or on a
 * call; silence is ambiguous and ambiguity should not be learned at full strength. The factor that reads the record
 * applies that rule to a rate; this is the same rule applied to a gradient.
 */
export interface PropensitySample {
  readonly features: readonly number[];
  readonly accepted: boolean;
  /** `1` for a decision the rider made; `EXPIRY_WEIGHT` for silence. Absent means `1`. */
  readonly weight?: number;
}

/** How much an expired offer counts against a model, from `11 §9.3`: half of a refusal, because silence is ambiguous. */
export const EXPIRY_WEIGHT = 0.5;

/**
 * The labels a model may learn from, and how much each one counts.
 *
 * A denylist rather than `response !== 'ACCEPTED'`: a `WITHDRAWN` offer was withdrawn for reasons that have nothing to
 * do with this rider's preference — the vendor closed, an admin reassigned, the customer cancelled — and a `CANCELLED`
 * one never reached a decision at all. Both would teach the model that this offer was refused, which is a fact nobody
 * established. `null` means the row is not evidence.
 */
export function labelWeight(response: unknown): number | null {
  if (response === "ACCEPTED" || response === "REJECTED") return 1;
  if (response === "EXPIRED") return EXPIRY_WEIGHT;
  return null;
}

/**
 * The `platform_config` key the model lives under (`09 §7.4`).
 *
 * Versioned and audited like every other number an operator owns, per zone, with the all-zero UUID row as the global
 * default — the mechanism the schema already provides, so the model needed no table of its own.
 */
export const PROPENSITY_CONFIG_KEY = "dispatch.propensity";

/** The model as this platform stores it: eight coefficients, how many outcomes produced them, and how far it has read. */
export interface PropensityModel {
  readonly weights: readonly number[];
  readonly samples: number;
  /**
   * The `responded_at` of the last offer this model was trained on, in ms (D135).
   *
   * The watermark is the model's own cursor: a training pass reads the outcomes *after* it and moves it forward, so a
   * pass that runs every few seconds does the same work once. Zero means the model has never been trained and the next
   * pass starts from the oldest recorded offer.
   */
  readonly trainedThroughMs: number;
}

/** Whether a value can be a coefficient vector: eight finite numbers, no more and no fewer. */
export function isPropensityWeights(value: unknown): value is readonly number[] {
  return (
    Array.isArray(value) &&
    value.length === PROPENSITY_SIZE &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

/**
 * Read a model out of a `platform_config` value.
 *
 * `null` — not a thrown error — when the row is shaped like something else: a config row is edited by a human in Brain
 * Lab, and a typo there must degrade to "use the record" rather than failing a dispatch. The samples count is clamped
 * to `[0, PROPENSITY_FULL_TRUST]` because it only ever weights a blend.
 */
export function readPropensityModel(value: unknown): PropensityModel | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { weights?: unknown; samples?: unknown };
  if (!isPropensityWeights(record.weights)) return null;
  const samples = typeof record.samples === "number" && Number.isFinite(record.samples) ? record.samples : 0;
  const through = (record as { trainedThroughMs?: unknown }).trainedThroughMs;
  return {
    weights: [...record.weights],
    samples: Math.min(PROPENSITY_FULL_TRUST, Math.max(0, Math.trunc(samples))),
    // A watermark that is not a finite instant is `0`: replaying the record is recoverable, skipping it is not.
    trainedThroughMs: typeof through === "number" && Number.isFinite(through) && through > 0 ? Math.trunc(through) : 0,
  };
}

/** The logistic function, with the logit clamped as `09 §7.4`'s snippet clamps it. */
export function sigmoid(logit: number): number {
  const z = Number.isFinite(logit) ? Math.max(-MAX_LOGIT, Math.min(MAX_LOGIT, logit)) : 0;
  return 1 / (1 + Math.exp(-z));
}

/** The probability a rider with these features accepts: `sigmoid(w · x)`. */
export function predictAcceptance(weights: readonly number[], features: readonly number[]): number {
  if (!isPropensityWeights(weights) || features.length !== PROPENSITY_SIZE) return 0.5;
  let logit = 0;
  for (let index = 0; index < PROPENSITY_SIZE; index += 1) {
    const feature = features[index] as number;
    logit += (weights[index] as number) * (Number.isFinite(feature) ? feature : 0);
  }
  return sigmoid(logit);
}

/**
 * One stochastic-gradient step, as `09 §7.4` writes it.
 *
 * `g = p − y` is the logistic loss's gradient, and the L2 term is applied to the weight rather than to the gradient so
 * that a weight decays every step whether or not its feature was present. The result is a new vector: the caller owns
 * the old one, because a model that mutates itself cannot be replayed against a trace.
 */
export function learnStep(
  weights: readonly number[],
  sample: PropensitySample,
  lr: number = PROPENSITY_LR,
): readonly number[] {
  if (!isPropensityWeights(weights) || sample.features.length !== PROPENSITY_SIZE) return weights;
  // A weight of 2 is not twice the evidence, it is a caller's mistake; and a zero-weight sample would still decay the
  // weights through the L2 term, which is a change nobody asked for.
  const raw = sample.weight === undefined ? 1 : sample.weight;
  const weight = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 1;
  if (weight === 0) return weights;
  const predicted = predictAcceptance(weights, sample.features);
  const gradient = weight * (predicted - (sample.accepted ? 1 : 0));
  return weights.map((current, index) => {
    const feature = sample.features[index] as number;
    const value = Number.isFinite(feature) ? feature : 0;
    return current - lr * (gradient * value + PROPENSITY_L2 * current);
  });
}

/**
 * The blend factor 3 receives: the model, weighted by how much evidence stands behind it.
 *
 * At `PROPENSITY_FULL_TRUST` recorded outcomes the model is trusted outright; at zero it is not consulted at all, and
 * the rider's own Wilson rate is the answer — which is what factor 3 was before this module existed. Between the two the
 * answer is a weighted average, so a zone's first fifty offers do not lurch from one estimator to another.
 */
export function blendPropensity(modelProbability: number, historicalRate: number, samples: number): number {
  const evidence = Number.isFinite(samples) ? Math.min(PROPENSITY_FULL_TRUST, Math.max(0, samples)) : 0;
  const trust = evidence / PROPENSITY_FULL_TRUST;
  const model = Number.isFinite(modelProbability) ? Math.max(0, Math.min(1, modelProbability)) : 0.5;
  const historical = Number.isFinite(historicalRate) ? Math.max(0, Math.min(1, historicalRate)) : 0;
  return trust * model + (1 - trust) * historical;
}

/** One solved offer, as the training pass reads it: its features, its outcome and when it was answered. */
export interface TrainingSample {
  readonly features: readonly number[];
  /** `true` for `ACCEPTED`; a rejection and an expiry are both "did not accept", which is what the model predicts. */
  readonly accepted: boolean;
  /** How much the outcome counts: `1` for a refusal, `EXPIRY_WEIGHT` for silence (`11 §9.3`). */
  readonly weight: number;
  readonly respondedAtMs: number;
}

/** What one training pass did. */
export interface TrainingResult {
  readonly weights: readonly number[];
  readonly applied: number;
  readonly throughMs: number;
}

/**
 * Fold the recorded outcomes into the weights, oldest first (`09 §7.4`, D135).
 *
 * Order matters — this is stochastic gradient descent, not a closed form — so the caller sorts by `responded_at` and
 * this function trusts that order. A sample whose vector is not eight finite numbers is *skipped* rather than throwing:
 * a config row and an offer row can disagree about the model's shape after a deploy, and the honest response to one bad
 * row is to learn from the other ninety-nine, not to stop learning until a human notices.
 */
export function trainModel(weights: readonly number[], samples: readonly TrainingSample[]): TrainingResult {
  let current = isPropensityWeights(weights) ? [...weights] : [...PROPENSITY_PRIOR];
  let applied = 0;
  let throughMs = 0;
  for (const sample of samples) {
    throughMs = Math.max(throughMs, sample.respondedAtMs);
    if (!isPropensityWeights(sample.features)) continue;
    current = [...learnStep(current, { features: sample.features, accepted: sample.accepted, weight: sample.weight })];
    applied += 1;
  }
  return { weights: current, applied, throughMs };
}

/** Everything the eight features are built from. Distances are metres, the payout is paisa, the clock is UTC ms. */
export interface PropensityInputs {
  readonly payoutPaisa: number;
  readonly pickupDistanceM: number;
  readonly tripDistanceM: number;
  readonly idleS: number;
  readonly atMs: number;
  /** `0..1`, from `09 §8`'s weather premium; absent means the deployment has no weather and the feature is zero. */
  readonly weatherSeverity?: number;
  /** Whether the offer is part of a bundle (`11 §5` factor 9). */
  readonly batch?: boolean;
}

/** A ratio, clamped to `[0, 1]`; a feature is a magnitude, never a sign. */
function scaled(value: number, unit: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(unit) || unit <= 0) return 0;
  return Math.max(0, Math.min(1, value / unit));
}

/**
 * The eight features for one candidate and one offer.
 *
 * Time of day is a sine/cosine pair rather than an hour, because 23:59 and 00:01 are two minutes apart in a rider's
 * life and fifty-nine hours apart as a number. The pair is over the **Asia/Dhaka** day, which is the business day every
 * other timestamp in this platform is expressed in.
 */
export function propensityFeatures(inputs: PropensityInputs): readonly number[] {
  const minutes = ((Math.floor(inputs.atMs / 60_000) + 360) % 1_440 + 1_440) % 1_440;
  const angle = (2 * Math.PI * minutes) / 1_440;
  const weather = Number.isFinite(inputs.weatherSeverity) ? Math.max(0, Math.min(1, inputs.weatherSeverity ?? 0)) : 0;
  return [
    scaled(inputs.payoutPaisa, PAYOUT_UNIT_PAISA),
    scaled(inputs.pickupDistanceM, PICKUP_UNIT_M),
    scaled(inputs.tripDistanceM, TRIP_UNIT_M),
    scaled(inputs.idleS, IDLE_UNIT_S),
    Number((Math.sin(angle) / 2 + 0.5).toFixed(6)),
    Number((Math.cos(angle) / 2 + 0.5).toFixed(6)),
    weather,
    inputs.batch === true ? 1 : 0,
  ];
}
