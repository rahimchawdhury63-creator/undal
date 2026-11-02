/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * `VendorAlarm`: one Durable Object per order, holding the two-minute ladder (`14 §4.1`, D84).
 *
 * The ladder itself is data (`presence/escalation.ts`): a table of instants and what happens at each. What
 * this room adds is the three things a table cannot do — it survives the isolate, it wakes itself, and it
 * has somewhere to send the consequences.
 *
 * **Survives the isolate.** The record is one storage key per order. An order that was published at
 * 12:00:03 and alarmed at 12:00:11 keeps its ladder even if the process that published it is long gone,
 * which is the whole reason the rungs are stored rather than `setTimeout`ed: a cold start between 8 s and
 * 120 s must not silently forgive a vendor for never answering.
 *
 * **Wakes itself.** Every run computes the next instant any unfired rung is due and arms a single alarm
 * there. One alarm rather than nine timers, and it is re-armed after each run from the record — so a run
 * that fires three rungs at once (an alarm that arrived late) leaves the room correct rather than ahead.
 *
 * **Has somewhere to send the consequences.** Three ports, and the room refuses to begin without the first
 * two: pushes go through `PushSender` (`15 §2`), catalogue events through a `FrameStore` so the watchers see
 * them, and the terminal cancellation through `OrderCanceller` — a request to `undal-core`, because the
 * order's state is core's to write and this Worker may not write it.
 *
 * A room without a sender refuses to begin rather than keeping a ladder it cannot ring. A room without a
 * canceller still runs: it reaches 120 s, records that the order was *not* cancelled and why, and emits the
 * exception the operator acts on. A ladder that lies about having cancelled is worse than one that says it
 * could not.
 */

import type { Clock } from "../lib/clock.ts";
import { systemClock } from "../lib/clock.ts";
import {
  ESCALATION_STEPS,
  fireDue,
  hasFired,
  isHalted,
  noteProbeReply,
  noteSeen,
  startLadder,
} from "../presence/escalation.ts";
import type { LadderAction, LadderState } from "../presence/escalation.ts";
import { buildOrderPush, withToken } from "../fcm/payload.ts";
import type { OrderPushInput } from "../fcm/payload.ts";
import type { PushSender, SendOutcome } from "../fcm/sender.ts";
import type { FrameStore } from "../sse/store.ts";
import { DurableObjectFrameStore } from "../sse/durable-store.ts";
import { createCoreCanceller } from "../authority/core-cancel.ts";
import { fcmFrom } from "../fcm/from-env.ts";
import type { FcmEnv } from "../fcm/from-env.ts";

/** The storage key the ladder lives under. One key, so a write is one write. */
export const ALARM_KEY = "alarm:record";

/** The request to core that actually cancels the order (`14 §4.1`, `11 §6`). */
export interface OrderCanceller {
  cancel(input: { readonly orderCode: string; readonly elapsedSeconds: number }): Promise<{
    readonly cancelled: boolean;
    readonly reason: string;
  }>;
}

/** What `begin` is given. */
export interface BeginInput {
  readonly orderCode: string;
  readonly zoneId: string;
  /** The push fields, without the attempt — each rung numbers its own. */
  readonly push: Omit<OrderPushInput, "attempt">;
  /** The vendor's devices; every one of them is rung. */
  readonly devices: readonly string[];
  /** When the order was published to the vendor. Defaults to now. */
  readonly publishedAtMs?: number;
}

/** One push, as it happened. `outcome` is `SENT` or the sender's reason. */
export interface PushRecord {
  readonly attempt: number;
  readonly atMs: number;
  readonly outcome: string;
  readonly messageId: string | null;
  readonly device: string;
}

/** The record the room keeps. */
export interface AlarmRecord {
  readonly orderCode: string;
  readonly zoneId: string;
  readonly push: Omit<OrderPushInput, "attempt">;
  readonly devices: readonly string[];
  readonly ladder: LadderState;
  readonly pushes: readonly PushRecord[];
  readonly cancellation: { readonly atMs: number; readonly cancelled: boolean; readonly reason: string } | null;
}

/** The bindings a room builds its own ports from. */
export interface VendorAlarmEnv extends FcmEnv {
  readonly PUBLIC_API_BASE?: string;
  readonly CORE_BASE_URL?: string;
  readonly INTERNAL_TOKEN?: string;
  /** The rings the room's events are recorded in. */
  readonly STREAM_ROOM?: DurableObjectNamespace;
}

/** What the room is built with. Every port is optional so a deployment that has not wired one says so. */
export interface VendorAlarmDeps {
  readonly clock?: Clock;
  readonly push?: PushSender | null;
  readonly signingKey?: string | null;
  readonly store?: FrameStore | null;
  readonly cancel?: OrderCanceller | null;
}

/** The instant the next unfired rung is due, or `null` when the ladder is finished or stopped. */
export function nextDueAt(ladder: LadderState): number | null {
  if (isHalted(ladder)) return null;
  const pending = ESCALATION_STEPS.filter((step) => !hasFired(ladder, step.action));
  if (pending.length === 0) return null;
  // `ESCALATION_STEPS` is ordered, so the first pending rung is the next instant.
  return ladder.publishedAtMs + (pending[0]?.atMs ?? 0);
}

/** The catalogue event a rung publishes, if it publishes one. The catalogue is closed (`08 §9.1`). */
export function eventFor(action: LadderAction): string | null {
  if (action === "MARK_UNREACHABLE") return "vendor.unreachable";
  if (action === "RAISE_EXCEPTION") return "admin.exception_raised";
  return null;
}

/** The attempt number a push rung carries. */
function attemptFor(action: LadderAction): 2 | 3 | null {
  if (action === "FCM_SECOND") return 2;
  if (action === "FCM_THIRD") return 3;
  return null;
}

/** One order's ladder. */
export class VendorAlarm {
  private readonly state: DurableObjectState;
  private readonly clock: Clock;
  private readonly push: PushSender | null;
  private readonly signingKey: string | null;
  private readonly store: FrameStore | null;
  private readonly cancel: OrderCanceller | null;

  /**
   * The runtime constructs with `(state, env)`; a test constructs with its own ports.
   *
   * Everything the room sends is built here rather than imported at the call site, so a deployment's
   * configuration is read once and a room that cannot push refuses `begin` instead of keeping a ladder it
   * cannot ring.
   */
  constructor(state: DurableObjectState, env: VendorAlarmEnv = {}, deps: VendorAlarmDeps = {}) {
    this.state = state;
    this.clock = deps.clock ?? systemClock;

    const fcm = fcmFrom(env);
    this.push = deps.push === undefined ? (fcm.ok ? fcm.sender : null) : deps.push;
    this.signingKey = deps.signingKey === undefined ? (fcm.ok ? fcm.signingKey : null) : deps.signingKey;
    this.store =
      deps.store === undefined
        ? (env.STREAM_ROOM === undefined ? null : new DurableObjectFrameStore(env.STREAM_ROOM, this.clock))
        : deps.store;
    this.cancel =
      deps.cancel === undefined
        ? (env.INTERNAL_TOKEN === undefined || env.INTERNAL_TOKEN === ""
            ? null
            : createCoreCanceller(env.CORE_BASE_URL ?? env.PUBLIC_API_BASE ?? "", env.INTERNAL_TOKEN))
        : deps.cancel;
  }

  /** Serve the room's own HTTP surface. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/begin") return this.begin(await readBody(request));
    if (request.method === "POST" && url.pathname === "/seen") return this.seen(await readBody(request));
    if (request.method === "POST" && url.pathname === "/reply") return this.reply(await readBody(request));
    if (request.method === "GET" && url.pathname === "/state") {
      const record = await this.load();
      return json(
        { record, nextAlarmAtMs: record === null ? null : nextDueAt(record.ladder) },
        record === null ? 404 : 200,
      );
    }
    return json({ ok: false, error: { code: "NOT_IMPLEMENTED", path: url.pathname } }, 501);
  }

  /**
   * Start a ladder, and ring the first alarm.
   *
   * The first push is the `PUBLISH` rung: the order is on the vendor's screen and the phone rings. It is
   * sent here rather than waited for, because the ladder's 8-second probe assumes the alarm started now.
   */
  private async begin(body: BeginInput | null): Promise<Response> {
    if (this.push === null || this.signingKey === null) {
      return json({ ok: false, error: { code: "NOT_IMPLEMENTED", reason: "push_not_configured" } }, 501);
    }
    if (body === null || typeof body.orderCode !== "string" || body.orderCode === "") {
      return json({ ok: false, error: { code: "VALIDATION_FAILED", field: "orderCode" } }, 422);
    }
    const publishedAtMs = body.publishedAtMs ?? this.clock.nowMs();
    const ladder = startLadder(body.orderCode, publishedAtMs);
    const record: AlarmRecord = {
      orderCode: body.orderCode,
      zoneId: body.zoneId,
      push: body.push,
      devices: [...body.devices],
      // `PUBLISH` fires as part of beginning: the ladder is armed at the instant the order is published.
      ladder: { ...ladder, fired: [{ action: "PUBLISH", atMs: publishedAtMs }] },
      pushes: [],
      cancellation: null,
    };
    const pushes = await this.ring(record, 1);
    const saved: AlarmRecord = { ...record, pushes };
    await this.save(saved);
    const next = nextDueAt(saved.ladder);
    await this.arm(next);
    return json({ orderCode: saved.orderCode, ladder: saved.ladder, nextAlarmAtMs: next, pushes });
  }

  /** The vendor answered. The ladder stops where it stands. */
  private async seen(body: { atMs?: number } | null): Promise<Response> {
    const record = await this.load();
    if (record === null) return json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const atMs = body?.atMs ?? this.clock.nowMs();
    const saved: AlarmRecord = { ...record, ladder: noteSeen(record.ladder, atMs) };
    await this.save(saved);
    await this.arm(nextDueAt(saved.ladder));
    return json({ ladder: saved.ladder, nextAlarmAtMs: nextDueAt(saved.ladder) });
  }

  /** A probe reply. Inside the window it restores the vendor; outside it is only a late hello. */
  private async reply(body: { atMs?: number } | null): Promise<Response> {
    const record = await this.load();
    if (record === null) return json({ ok: false, error: { code: "NOT_FOUND" } }, 404);
    const atMs = body?.atMs ?? this.clock.nowMs();
    const saved: AlarmRecord = { ...record, ladder: noteProbeReply(record.ladder, atMs) };
    await this.save(saved);
    await this.arm(nextDueAt(saved.ladder));
    return json({ ladder: saved.ladder, nextAlarmAtMs: nextDueAt(saved.ladder) });
  }

  /**
   * The deadline sweep: fire everything due, then arm the next rung.
   *
   * The alarm is not trusted to arrive on time — it is trusted to arrive. A late one fires several rungs at
   * once, in the order the table lists them, which is why the pushes are numbered by rung rather than by
   * arrival.
   */
  async alarm(): Promise<void> {
    await this.run();
  }

  /** Fire what is due at `atMs` (default: now) and re-arm. Returns what fired, for the tests. */
  async run(atMs: number = this.clock.nowMs()): Promise<{ fired: readonly LadderAction[]; nextAlarmAtMs: number | null }> {
    const record = await this.load();
    if (record === null) return { fired: [], nextAlarmAtMs: null };

    const { ladder, fired } = fireDue(record.ladder, atMs);
    let saved: AlarmRecord = { ...record, ladder };
    const pushes = [...saved.pushes];

    for (const step of fired) {
      const attempt = attemptFor(step.action);
      if (attempt !== null && this.push !== null) {
        pushes.push(...(await this.ring(saved, attempt, atMs)));
        continue;
      }
      if (step.action === "AUTO_CANCEL") {
        saved = { ...saved, cancellation: await this.autoCancel(saved, atMs) };
        continue;
      }
      const event = eventFor(step.action);
      if (event !== null) await this.emit(saved, event, step.action, atMs);
    }

    saved = { ...saved, pushes };
    await this.save(saved);
    const next = nextDueAt(saved.ladder);
    await this.arm(next);
    return { fired: fired.map((step) => step.action), nextAlarmAtMs: next };
  }

  /**
   * The last rung.
   *
   * The request goes to core, which owns the order state and will refuse it if the vendor accepted in the
   * meantime. A room with no canceller records the refusal instead of pretending: the operator's exception
   * is then the only thing standing between a silent vendor and an order nobody is cooking.
   */
  private async autoCancel(record: AlarmRecord, atMs: number): Promise<AlarmRecord["cancellation"]> {
    const elapsedSeconds = Math.floor((atMs - record.ladder.publishedAtMs) / 1_000);
    if (this.cancel === null) {
      await this.emit(record, "admin.exception_raised", "AUTO_CANCEL", atMs, { reason: "canceller_not_configured" });
      return { atMs, cancelled: false, reason: "canceller_not_configured" };
    }
    let answer: { cancelled: boolean; reason: string };
    try {
      answer = await this.cancel.cancel({ orderCode: record.orderCode, elapsedSeconds });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.emit(record, "admin.exception_raised", "AUTO_CANCEL", atMs, { reason });
      return { atMs, cancelled: false, reason };
    }
    if (answer.cancelled) {
      // Core moved the order; the watchers are told here, because this Worker holds the sockets.
      await this.emit(record, "order.cancelled", "AUTO_CANCEL", atMs, {
        orderId: record.orderCode,
        cancelledBy: "SYSTEM",
        reason: "VENDOR_DEVICE_UNREACHABLE",
      });
    }
    return { atMs, cancelled: answer.cancelled, reason: answer.reason };
  }

  /** Send one push to every device of the vendor, and record each answer. */
  private async ring(record: AlarmRecord, attempt: 1 | 2 | 3, atMs: number = this.clock.nowMs()): Promise<readonly PushRecord[]> {
    if (this.push === null || this.signingKey === null) return [];
    const envelope = await buildOrderPush(
      {
        ...record.push,
        attempt,
        issuedAtMs: atMs,
        expiresAtMs: atMs + record.push.alarmMaxMs,
      },
      this.signingKey,
    );
    const outcomes: SendOutcome[] = await Promise.all(
      record.devices.map((device) => this.push?.send(withToken(envelope, device)) ?? Promise.resolve({ ok: false, reason: "TRANSIENT", detail: "no sender" } as const)),
    );
    return record.devices.map((device, index) => {
      const outcome = outcomes[index];
      return {
        attempt,
        atMs,
        device,
        outcome: outcome !== undefined && outcome.ok ? "SENT" : ((outcome as { reason?: string } | undefined)?.reason ?? "TRANSIENT"),
        messageId: outcome !== undefined && outcome.ok ? outcome.messageId : null,
      };
    });
  }

  /** Publish a catalogue event to the order's watchers and the zone's admin map. */
  private async emit(
    record: AlarmRecord,
    event: string,
    action: LadderAction,
    atMs: number,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    if (this.store === null) return;
    const payload = { orderId: record.orderCode, action, ...data };
    await this.store.record({ kind: "order", id: record.orderCode }, { kind: event, data: payload, atMs });
    await this.store.record({ kind: "zone", id: record.zoneId }, { kind: event, data: payload, atMs });
  }

  private async load(): Promise<AlarmRecord | null> {
    return (await this.state.storage.get<AlarmRecord>(ALARM_KEY)) ?? null;
  }

  private async save(record: AlarmRecord): Promise<void> {
    await this.state.storage.put(ALARM_KEY, record);
  }

  /** Arm at the next rung, or disarm when there is nothing left to fire. */
  private async arm(atMs: number | null): Promise<void> {
    if (atMs === null) {
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.setAlarm(atMs);
  }
}

/** JSON with no caching, the same shape the other rooms answer with. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** A body, or `null` when it is not JSON. */
async function readBody(request: Request): Promise<never | null> {
  try {
    return (await request.json()) as never;
  } catch {
    return null;
  }
}
