/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * When a connection dies, what the platform records and how long it waits before saying so.
 *
 * The two-second promise is made of three numbers: the transport notices a dead socket in under 200 ms, an
 * *involuntary* close waits 1 500 ms for the device to come back, and the publication itself costs two store
 * operations on the free path — the row that marks the device gone and the read that proves it (D91). A
 * deliberate close waits for nothing, because the user told us they were leaving.
 *
 * Nothing in this file reads a clock. That is what lets the test that proves the promise run a
 * thousand losses in a millisecond instead of half an hour, and it is why the bound is arithmetic
 * here rather than a benchmark that fails on a noisy CI runner.
 */

import { HEARTBEAT_DEADLINE_MS, RECONNECT_GRACE_MS } from "../coordination/coordinator.ts";

/** The client's heartbeat cadence, in milliseconds (`14 §3.1`). */
export const HEARTBEAT_INTERVAL_MS = 750;

/** Missed acknowledgements after which the client tears its own socket down: 3 × 750 = 2 250 ms. */
export const MISSED_ACKS_BEFORE_TEARDOWN = 3;

/**
 * Heartbeats a silent device is allowed to miss.
 *
 * Two beats is 1 500 ms, which sits under the 2 000 ms deadline with 500 ms to spare. One lost packet
 * is routine on a mobile network; two in a row is the point at which the deadline is the only thing
 * that still knows the device is there.
 */
export const MISSED_BEATS_TOLERATED = 2;

/** The close code an app sends when the user turns presence off (`14 §2`). */
export const CLOSE_GOING_OFFLINE = 4_001;

/** The close code the server sends when the heartbeat deadline fires (`14 §3.2`). */
export const CLOSE_HEARTBEAT_TIMEOUT = 4_408;

/** The reconnect grace for an involuntary close. */
export const PRESENCE_GRACE_MS = RECONNECT_GRACE_MS;

/** What a transport close is assumed to cost before the grace even starts. */
export const TRANSPORT_CLOSE_BUDGET_MS = 200;

/**
 * What one store operation is assumed to cost on the free path (D91).
 *
 * Same colo, one indexed statement and one service binding in between. It is a budget rather than a
 * measurement, and deliberately so: it is the cost the two seconds are *allowed* to pay, so a store that
 * turns out slower than this shows up as a latency regression against a stated allowance rather than as a
 * promise nobody noticed was broken.
 */
export const PRESENCE_STORE_OP_MS = 50;

/** The operations a publication costs before anyone else can see it: the marking write and the reader's read. */
export const PRESENCE_STORE_OPS = 2;

/** What the two seconds keep for the database. */
export const PRESENCE_STORE_BUDGET_MS = PRESENCE_STORE_OP_MS * PRESENCE_STORE_OPS;

/** The number the brief names, and the one the latency test asserts. */
export const MAX_DETECTION_MS = 2_000;

/**
 * The most grace an operator may configure.
 *
 * Derived, not chosen: the two seconds minus the transport's estimate minus the database's allowance. It was
 * 1 800 until D91, which was right while the absence lived in a Durable Object's memory and became wrong the
 * moment the free path had to write a row and read it back.
 */
export const MAX_PRESENCE_GRACE_MS = MAX_DETECTION_MS - TRANSPORT_CLOSE_BUDGET_MS - PRESENCE_STORE_BUDGET_MS;

/** Why a device stopped being present. The first two are published; the third is the user's choice. */
export type AbsenceReason = "USER_OFFLINE" | "TRANSPORT_CLOSED" | "HEARTBEAT_TIMEOUT";

/** The close event as the runtime reports it. */
export interface CloseEvent {
  readonly code: number;
  readonly clean: boolean;
}

/** What a close means for presence, before anything is scheduled. */
export interface AbsenceOrder {
  readonly reason: AbsenceReason;
  readonly graceMs: number;
  readonly deliberate: boolean;
}

/** Clamp a configured grace into the range the two-second promise allows. */
export function clampGrace(graceMs: number = PRESENCE_GRACE_MS): number {
  if (!Number.isFinite(graceMs)) throw new RangeError(`not a duration: ${String(graceMs)}`);
  return Math.min(Math.max(0, Math.trunc(graceMs)), MAX_PRESENCE_GRACE_MS);
}

/**
 * Read a close event.
 *
 * A close is deliberate only when it was clean **and** carried `4001`. A clean `1000` — a tab closed,
 * a phone rebooted politely — is still a loss of presence, and treating it as deliberate would let a
 * rider's battery saver take them off the dispatch list without a trace.
 */
export function absenceFor(close: CloseEvent, graceMs: number = PRESENCE_GRACE_MS): AbsenceOrder {
  const deliberate = close.clean && close.code === CLOSE_GOING_OFFLINE;
  return {
    reason: deliberate ? "USER_OFFLINE" : "TRANSPORT_CLOSED",
    graceMs: deliberate ? 0 : clampGrace(graceMs),
    deliberate,
  };
}

/** The instant an absence becomes publishable. */
export function publishAtMs(closedAtMs: number, order: AbsenceOrder): number {
  return closedAtMs + order.graceMs;
}

/**
 * The worst-case detection an operator's configuration can produce.
 *
 * Three terms, not two: the transport's 200 ms, the grace, and the database's allowance. At the default
 * 1 500 ms that is 1 800 ms — inside the brief's 2 000 ms with 200 ms spare — and at the maximum grace it is
 * exactly 2 000 ms, which is what makes the maximum the maximum rather than a number somebody liked.
 */
export function worstCaseDetectionMs(graceMs: number = PRESENCE_GRACE_MS): number {
  return TRANSPORT_CLOSE_BUDGET_MS + clampGrace(graceMs) + PRESENCE_STORE_BUDGET_MS;
}

/** Whether the configuration still keeps the platform inside the brief's two seconds. */
export function isWithinDetectionBudget(graceMs: number = PRESENCE_GRACE_MS): boolean {
  return worstCaseDetectionMs(graceMs) <= MAX_DETECTION_MS;
}
