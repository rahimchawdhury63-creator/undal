/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * Reading and writing the acceptance model (`09 §7.4`, D133, D135).
 *
 * The model is configuration: eight coefficients in `platform_config` under `dispatch.propensity`, per zone, with the
 * all-zero UUID row as the global default. That is the table the schema already has for numbers an operator edits —
 * versioned, audited, effective-dated — so the model needed no table, no migration and no second audit trail.
 *
 * **A zone inherits the global *weights*, not its confidence.** A new zone starts from whatever the global row has
 * learned and a sample count of zero, which means factor 3 is still the rider's own record until this zone has outcomes
 * of its own. Inheriting the samples too would let one busy zone's evidence vouch for a district that has never
 * delivered anything.
 *
 * **The watermark is inside the model.** `trainedThroughMs` is the `responded_at` of the last offer trained on, so a
 * pass that runs on every expiry sweep does the same work once rather than re-learning the same lunch hour every five
 * seconds. It rides in the same JSON row as the weights, because two rows could disagree about which offers have been
 * seen and there is no transaction between them.
 */

import type { Db } from "../db/client.ts";
import { sqlDatetime } from "../db/time.ts";
import {
  PROPENSITY_CONFIG_KEY,
  PROPENSITY_PRIOR,
  readPropensityModel,
  trainModel,
  type PropensityModel,
  type TrainingSample,
} from "../domain/order/propensity.ts";

/** The all-zero UUID `platform_config` uses for a row that applies to every zone (`08`). */
export const GLOBAL_ZONE = "00000000000000000000000000000000";

/** How many answered offers one pass learns from. A bound on a sweep, not on the model. */
export const MAX_TRAINING_SAMPLES = 200;

/** How many zones one sweep trains. Zones beyond this wait for the next expiry, which is seconds away. */
export const MAX_TRAINED_ZONES = 3;

/** The version string written on a model row: the sample count is the version a reader actually wants. */
function versionOf(samples: number): string {
  return `propensity.${String(samples)}`;
}

/** One `platform_config` read for a zone, or `null`. */
async function readOne(db: Db, zoneId: string): Promise<PropensityModel | null> {
  const row = await db.first<{ value: unknown }>(
    "SELECT `value` FROM `platform_config` WHERE `key` = ? AND `zone_id` = ? ORDER BY `effective_at` DESC LIMIT 1",
    [PROPENSITY_CONFIG_KEY, Buffer.from(zoneId, "hex")],
  );
  if (row === null) return null;
  const value = typeof row.value === "string" ? parseJson(row.value) : row.value;
  return readPropensityModel(value);
}

/** A JSON column, parsed, or `null` when it is not JSON. A driver may hand back either form. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The model that applies to a zone: its own row, or the global one.
 *
 * Used by the scorer, which cares about the coefficients; the trainer uses `startingModel` because it also cares whose
 * evidence the sample count represents.
 */
export async function readStoredModel(db: Db, zoneId: string): Promise<PropensityModel | null> {
  return (await readOne(db, zoneId)) ?? (await readOne(db, GLOBAL_ZONE));
}

/** Where a zone's next training pass starts, and how much evidence it already has. */
async function startingModel(db: Db, zoneId: string): Promise<PropensityModel> {
  const own = await readOne(db, zoneId);
  if (own !== null) return own;
  const global = await readOne(db, GLOBAL_ZONE);
  return {
    weights: global === null ? [...PROPENSITY_PRIOR] : global.weights,
    samples: 0,
    trainedThroughMs: 0,
  };
}

/** What a training pass reads: the offer row's recorded vector, its outcome, and when it was answered. */
export interface TrainingRow {
  readonly features: unknown;
  readonly response: unknown;
  readonly responded_at: unknown;
}

/**
 * Parse a vector out of the JSON column.
 *
 * `null` when the column is null (an offer judged without a model, D134) or holds something that is not eight finite
 * numbers — a row written by an older deploy, or by a hand edit. Skipping it is the point: `trainModel` counts only what
 * it applied.
 */
export function sampleFromRow(row: TrainingRow): TrainingSample | null {
  const raw = typeof row.features === "string" ? parseJson(row.features) : row.features;
  if (!Array.isArray(raw) || raw.length !== 8) return null;
  const features = raw.map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : Number.NaN));
  const respondedAtMs = typeof row.responded_at === "string" ? Date.parse(`${row.responded_at.replace(" ", "T")}Z`) : Number.NaN;
  return {
    features,
    accepted: row.response === "ACCEPTED",
    respondedAtMs: Number.isFinite(respondedAtMs) ? respondedAtMs : 0,
  };
}

/**
 * The outcomes a zone has recorded since its watermark, oldest first.
 *
 * `responded_at` rather than `offered_at`, because that is when the label became true; the index on
 * `(rider_id, offered_at)` does not serve this, and the sweep's window is small enough — one watermark, `LIMIT` at 200 —
 * that a scan of answered rows is cheaper than an index nothing else reads.
 */
export async function trainingSamples(
  db: Db,
  zoneId: string,
  sinceMs: number,
  limit: number = MAX_TRAINING_SAMPLES,
): Promise<readonly TrainingSample[]> {
  const rows = await db.query<TrainingRow>(
    "SELECT `f`.`propensity_features` AS `features`, `f`.`response` AS `response`, " +
      "`f`.`responded_at` AS `responded_at` FROM `order_offers` `f` JOIN `orders` `o` ON `o`.`id` = `f`.`order_id` " +
      "WHERE `o`.`zone_id` = ? AND `f`.`response` IN ('ACCEPTED', 'REJECTED', 'EXPIRED') " +
      "AND `f`.`propensity_features` IS NOT NULL AND `f`.`responded_at` > ? " +
      "ORDER BY `f`.`responded_at` ASC LIMIT ?",
    [Buffer.from(zoneId, "hex"), sqlDatetime(new Date(sinceMs)), limit],
  );
  const samples: TrainingSample[] = [];
  for (const row of rows) {
    const sample = sampleFromRow(row);
    if (sample !== null) samples.push(sample);
  }
  return samples;
}

/**
 * Write a new model row.
 *
 * `INSERT` and never `UPDATE`: `platform_config` is effective-dated, so a version is a new row and the old one stays for
 * the replay. `created_by` is the all-zero UUID — the system is the author, and a model that attributed its own training
 * to whichever operator happened to be looking at Brain Lab would be a lie in the audit trail.
 */
export async function writeModel(
  db: Db,
  zoneId: string,
  model: PropensityModel,
  atMs: number,
  reason: string,
): Promise<boolean> {
  const result = await db.execute(
    "INSERT INTO `platform_config` (`key`, `zone_id`, `value`, `version`, `effective_at`, `created_by`, `reason`) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      PROPENSITY_CONFIG_KEY,
      Buffer.from(zoneId, "hex"),
      JSON.stringify({
        weights: model.weights,
        samples: model.samples,
        trainedThroughMs: model.trainedThroughMs,
      }),
      versionOf(model.samples),
      sqlDatetime(new Date(atMs)),
      Buffer.alloc(16),
      reason,
    ],
  );
  return result.affectedRows === 1;
}

/** What one zone's pass did, or `null` when it had nothing to learn from. */
export interface TrainedZone {
  readonly zoneId: string;
  readonly applied: number;
  readonly samples: number;
}

/**
 * Train one zone from the outcomes it has recorded since its watermark.
 *
 * The pass is all-or-nothing per zone: the samples are read, folded in order, and written as one new version. A pass
 * with nothing to read writes nothing at all — no row, no audit line — because a config table that grows a row per
 * sweep is a config table nobody can read the history of.
 */
export async function trainZone(
  db: Db,
  zoneId: string,
  atMs: number,
  limit: number = MAX_TRAINING_SAMPLES,
): Promise<TrainedZone | null> {
  const start = await startingModel(db, zoneId);
  const samples = await trainingSamples(db, zoneId, start.trainedThroughMs, limit);
  if (samples.length === 0) return null;
  const trained = trainModel(start.weights, samples);
  if (trained.applied === 0) return null;
  const model: PropensityModel = {
    weights: trained.weights,
    samples: start.samples + trained.applied,
    trainedThroughMs: trained.throughMs,
  };
  const written = await writeModel(
    db,
    zoneId,
    model,
    atMs,
    `dispatch propensity: ${String(trained.applied)} offer outcome(s) folded in`,
  );
  return written ? { zoneId, applied: trained.applied, samples: model.samples } : null;
}

/**
 * Train the zones an expiry sweep just touched.
 *
 * The sweep is the right trigger and the only one that is free: it is the instant an outcome becomes final (`EXPIRED`)
 * for the offers nobody answered, and it already runs on every alarm tick in every zone (D130, D132). Bounded to
 * `MAX_TRAINED_ZONES` so one busy minute cannot make the sweep a training run.
 */
export async function trainZones(
  db: Db,
  zoneIds: readonly string[],
  atMs: number,
): Promise<readonly TrainedZone[]> {
  const trained: TrainedZone[] = [];
  for (const zoneId of zoneIds.slice(0, MAX_TRAINED_ZONES)) {
    const result = await trainZone(db, zoneId, atMs);
    if (result !== null) trained.push(result);
  }
  return trained;
}
