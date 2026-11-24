/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The training pass (`09 §7.4`, D135).
 *
 * D133 shipped the model, D134 the evidence, and this is the loop between them: read the outcomes a zone has recorded
 * since its watermark, fold them in order, write a new version. The assertions are the three that make it safe to run on
 * every expiry sweep — a pass with nothing to read writes **nothing at all**, the watermark moves so the same lunch hour
 * is not learned five times a minute, and a zone inherits the global *weights* without inheriting the global *confidence*.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EXPIRY_WEIGHT,
  PROPENSITY_CONFIG_KEY,
  PROPENSITY_FULL_TRUST,
  PROPENSITY_PRIOR,
  learnStep,
  predictAcceptance,
  readPropensityModel,
  trainModel,
  type TrainingSample,
} from "../src/domain/order/propensity.ts";
import type { TrainingRow } from "../src/repositories/propensity.ts";
import {
  GLOBAL_ZONE,
  MAX_TRAINED_ZONES,
  sampleFromRow,
  trainZone,
  trainZones,
  trainingSamples,
} from "../src/repositories/propensity.ts";
import { stubDb } from "../src/db/client.ts";

const ZONE_HEX = "0193f2a17c3e7890abcdef0123456703";
const OTHER_ZONE_HEX = "0193f2a17c3e7890abcdef0123456705";
const T0 = 1_700_000_000_000;

function bytes(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/** An `order_offers` row as the training read returns one. */
function row(features: number[] | null, accepted: boolean, respondedAtMs = T0): TrainingRow {
  return {
    features: features === null ? null : JSON.stringify(features),
    response: accepted ? "ACCEPTED" : "EXPIRED",
    responded_at: new Date(respondedAtMs).toISOString().replace("T", " ").replace("Z", "000"),
  };
}

interface Options {
  readonly zoneModel?: Record<string, unknown>;
  readonly globalModel?: Record<string, unknown>;
  readonly rows?: readonly TrainingRow[];
  readonly written?: number;
}

/**
 * A stub whose `platform_config` reader answers zone-first and global-second.
 *
 * `stubDb` matches a statement by its SQL alone, and both reads are the same statement; the only thing that differs is
 * the bound zone. So the handler looks at the parameters instead, which is exactly the distinction under test.
 */
function configDb(options: Options = {}): ReturnType<typeof stubDb> & { readonly inserts: () => readonly unknown[][] } {
  const calls: { sql: string; params: readonly unknown[] }[] = [];
  const inserted: unknown[][] = [];
  const rowsFor = (sql: string, params: readonly unknown[]): unknown[] => {
    calls.push({ sql, params });
    if (/FROM `platform_config`/u.test(sql)) {
      const zone = Buffer.from(params[1] as Uint8Array).toString("hex");
      const value = zone === GLOBAL_ZONE ? options.globalModel : options.zoneModel;
      return value === undefined ? [] : [{ value: JSON.stringify(value) }];
    }
    if (/FROM `order_offers`/u.test(sql)) return options.rows === undefined ? [] : [...options.rows];
    throw new Error(`unexpected statement: ${sql}`);
  };
  const fake = {
    calls,
    async query(sql: string, params: readonly unknown[] = []) {
      return rowsFor(sql, params);
    },
    async first(sql: string, params: readonly unknown[] = []) {
      const rows = rowsFor(sql, params);
      return rows.length > 0 ? rows[0] : null;
    },
    async execute(sql: string, params: readonly unknown[] = []) {
      calls.push({ sql, params });
      if (!/INSERT INTO `platform_config`/u.test(sql)) throw new Error(`unexpected statement: ${sql}`);
      inserted.push([...params]);
      return { affectedRows: options.written ?? 1 };
    },
    async batch() {
      throw new Error("a training pass is not a batch");
    },
    inserts: () => inserted,
  };
  return fake as unknown as ReturnType<typeof stubDb> & { readonly inserts: () => readonly unknown[][] };
}

const VECTOR = [0.84, 0.15, 0.3, 0.5, 0.62, 0.38, 0, 0];

describe("folding outcomes into the weights (D135)", () => {
  const sample = (accepted: boolean, respondedAtMs = T0, weight = 1): TrainingSample => ({
    features: VECTOR,
    accepted,
    weight,
    respondedAtMs,
  });

  test("the samples are applied in the order given, which is why the caller sorts them", () => {
    const forward = trainModel(PROPENSITY_PRIOR, [sample(false), sample(false), sample(true)]);
    const backward = trainModel(PROPENSITY_PRIOR, [sample(false), sample(false), sample(true)].reverse());
    assert.notDeepEqual(forward.weights, backward.weights, "stochastic gradient descent is order-dependent");
    assert.equal(forward.applied, 3);
  });

  test("one accepted offer moves the weights exactly as one step does", () => {
    const trained = trainModel(PROPENSITY_PRIOR, [sample(true)]);
    assert.deepEqual(trained.weights, learnStep(PROPENSITY_PRIOR, { features: VECTOR, accepted: true }));
  });

  test("the watermark is the latest outcome the pass read", () => {
    const trained = trainModel(PROPENSITY_PRIOR, [sample(true, T0 + 500), sample(false, T0 + 9_000)]);
    assert.equal(trained.throughMs, T0 + 9_000);
  });

  test("a vector that is not eight numbers is skipped, and the rest still taught", () => {
    const trained = trainModel(PROPENSITY_PRIOR, [
      { features: [0.1, 0.2], accepted: true, weight: 1, respondedAtMs: T0 },
      sample(true),
    ]);
    assert.equal(trained.applied, 1, "one bad row does not stop the pass");
  });

  test("an expired offer teaches half of what a refusal teaches (D136)", () => {
    const refused = trainModel(PROPENSITY_PRIOR, [sample(false, T0, 1)]);
    const silent = trainModel(PROPENSITY_PRIOR, [sample(false, T0, EXPIRY_WEIGHT)]);
    const start = PROPENSITY_PRIOR[0] as number;
    const refusedMove = (refused.weights[0] as number) - start;
    const silentMove = (silent.weights[0] as number) - start;
    assert.ok(Math.abs(refusedMove) > Math.abs(silentMove), "silence is weaker evidence than a no");
    assert.ok(Math.abs(silentMove / refusedMove - 0.5) < 0.02, `ratio ${String(silentMove / refusedMove)}`);
    assert.equal(silent.applied, 1, "the row was still folded in, at half strength");
  });

  test("a withdrawn offer is not a refusal the model can learn from", () => {
    const withdrawn = sampleFromRow({ features: JSON.stringify(VECTOR), response: "WITHDRAWN", responded_at: "2023-11-14 22:13:20.000000" });
    assert.equal(withdrawn, null);
    const expired = sampleFromRow({ features: JSON.stringify(VECTOR), response: "EXPIRED", responded_at: "2023-11-14 22:13:20.000000" });
    assert.equal(expired?.weight, EXPIRY_WEIGHT);
    assert.equal(expired?.accepted, false);
  });

  test("no samples is no change at all", () => {
    const trained = trainModel(PROPENSITY_PRIOR, []);
    assert.deepEqual(trained.weights, [...PROPENSITY_PRIOR]);
    assert.equal(trained.applied, 0);
  });

  test("a row is read as a sample, and a null column is not one", () => {
    assert.deepEqual(sampleFromRow(row(VECTOR, true)), {
      features: VECTOR,
      accepted: true,
      weight: 1,
      respondedAtMs: T0,
    });
    assert.equal(sampleFromRow(row(null, true)), null, "an offer judged without a model is not evidence");
    assert.equal(sampleFromRow({ features: "[1,2]", response: "ACCEPTED", responded_at: "nonsense" }), null);
  });
});

describe("training a zone (D135)", () => {
  test("a pass with nothing to read writes nothing at all", async () => {
    const db = configDb({ rows: [] });
    assert.equal(await trainZone(db, ZONE_HEX, T0), null);
    assert.equal(db.inserts().length, 0, "a config table that grows a row per sweep is unreadable history");
  });

  test("the outcomes since the watermark become one new version", async () => {
    const db = configDb({
      zoneModel: { weights: [...PROPENSITY_PRIOR], samples: 4, trainedThroughMs: T0 - 1 },
      rows: [row(VECTOR, true), row(VECTOR, false)],
    });
    const trained = await trainZone(db, ZONE_HEX, T0 + 60_000);
    assert.deepEqual(trained, { zoneId: ZONE_HEX, applied: 2, samples: 6 });
    const select = db.calls.find((call) => /FROM `order_offers`/u.test(call.sql));
    assert.deepEqual(select?.params.slice(1), [
      new Date(T0 - 1).toISOString().replace("T", " ").replace("Z", "000"),
      200,
    ]);
    const insert = db.calls.find((call) => /INSERT INTO `platform_config`/u.test(call.sql));
    assert.notEqual(insert, undefined);
    assert.equal(insert?.params[0], PROPENSITY_CONFIG_KEY);
    assert.deepEqual(insert?.params[1], Buffer.from(ZONE_HEX, "hex"));
    const value = readPropensityModel(JSON.parse(String(insert?.params[2])));
    assert.equal(value?.samples, 6);
    assert.equal(value?.trainedThroughMs, T0, "the watermark is the last outcome read");
    assert.equal(insert?.params[3], "propensity.6", "the version a reader wants is the sample count");
    assert.deepEqual(insert?.params[5], Buffer.alloc(16), "the system is the author, not an operator");
  });

  test("a new zone inherits the global weights and none of its confidence", async () => {
    const globalWeights = PROPENSITY_PRIOR.map((weight) => weight * 2);
    const db = configDb({
      globalModel: { weights: globalWeights, samples: PROPENSITY_FULL_TRUST, trainedThroughMs: T0 },
      rows: [row(VECTOR, true)],
    });
    const trained = await trainZone(db, ZONE_HEX, T0 + 1_000);
    assert.equal(trained?.applied, 1);
    assert.equal(trained?.samples, 1, "one outcome in this zone is one sample, whatever the global row has seen");
    const insert = db.calls.find((call) => /INSERT INTO `platform_config`/u.test(call.sql));
    const value = readPropensityModel(JSON.parse(String(insert?.params[2])));
    assert.deepEqual(value?.weights, learnStep(globalWeights, { features: VECTOR, accepted: true }));
  });

  test("a learned pass actually changes what the zone predicts", async () => {
    const db = configDb({
      rows: Array.from({ length: 20 }, () => row([1, 1, 1, 1, 0.5, 0.5, 0, 0], true)),
    });
    await trainZone(db, ZONE_HEX, T0 + 1_000);
    const insert = db.calls.find((call) => /INSERT INTO `platform_config`/u.test(call.sql));
    const trained = readPropensityModel(JSON.parse(String(insert?.params[2])));
    const featureVector = [1, 1, 1, 1, 0.5, 0.5, 0, 0];
    assert.ok(
      predictAcceptance(trained?.weights ?? [], featureVector) > predictAcceptance(PROPENSITY_PRIOR, featureVector),
      "twenty accepted offers of this shape should make this shape look likelier",
    );
  });

  test("a refused write is not a trained zone", async () => {
    const db = configDb({ written: 0, rows: [row(VECTOR, true)] });
    assert.equal(await trainZone(db, ZONE_HEX, T0), null);
  });

  test("the sweep trains at most a handful of zones per call", async () => {
    const db = configDb({ rows: [row(VECTOR, true)] });
    const zones = Array.from({ length: MAX_TRAINED_ZONES + 2 }, (_, index) =>
      index === 0 ? ZONE_HEX : OTHER_ZONE_HEX,
    );
    const trained = await trainZones(db, zones, T0);
    assert.ok(trained.length <= MAX_TRAINED_ZONES);
    const reads = db.calls.filter((call) => /FROM `order_offers`/u.test(call.sql));
    assert.ok(reads.length <= MAX_TRAINED_ZONES, "one busy minute must not turn a sweep into a training run");
  });
});

describe("reading the evidence", () => {
  test("only answered, vector-bearing offers in this zone are read, oldest first", async () => {
    const db = configDb({ rows: [] });
    await trainingSamples(db, ZONE_HEX, T0, 50);
    const call = db.calls[0];
    assert.match(call?.sql ?? "", /`response` IN \('ACCEPTED', 'REJECTED', 'EXPIRED'\)/u);
    assert.match(call?.sql ?? "", /`propensity_features` IS NOT NULL/u);
    assert.match(call?.sql ?? "", /ORDER BY `f`\.`responded_at` ASC/u);
    assert.deepEqual(call?.params, [
      Buffer.from(ZONE_HEX, "hex"),
      new Date(T0).toISOString().replace("T", " ").replace("Z", "000"),
      50,
    ]);
  });
});
