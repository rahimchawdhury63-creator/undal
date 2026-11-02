/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

/**
 * The server's half of the heartbeat (`14 §3.1`).
 *
 * The client sends `{"t":"hb","s":<seq>}` every 750 ms. The server echoes the sequence, resets a
 * deadline to `now + 2 000 ms`, and the device is absent when that deadline passes in silence. The
 * sequence number exists for two reasons and both matter: the client detects a lost acknowledgement
 * (three in a row and it reconnects itself, rather than waiting for a server that has already given
 * up on it), and the server can tell a stale beat from a fresh one after a reconnect that raced a
 * retransmission.
 */

import { HEARTBEAT_DEADLINE_MS } from "../coordination/coordinator.ts";
import { HEARTBEAT_INTERVAL_MS, MISSED_ACKS_BEFORE_TEARDOWN } from "./policy.ts";

/** One device's heartbeat counters. */
export interface HeartbeatState {
  /** The highest sequence number the server has accepted, or `-1` before the first beat. */
  readonly seq: number;
  /** When the last *fresh* beat arrived. */
  readonly lastBeatMs: number;
  /** When the device connected. Present even before a beat so a fresh socket has a deadline. */
  readonly startedAtMs: number;
}

/** The acknowledgement the server sends back. */
export interface HeartbeatAck {
  readonly seq: number;
  readonly nowMs: number;
  readonly deadlineMs: number;
  /** True when the beat carried a sequence the server had already seen; the deadline did not move. */
  readonly stale: boolean;
}

/** A device that has just connected, before its first beat. */
export function startHeartbeat(atMs: number): HeartbeatState {
  return { seq: -1, lastBeatMs: atMs, startedAtMs: atMs };
}

/**
 * Accept a beat.
 *
 * A beat whose sequence is not greater than the last one is acknowledged but ignored: after a
 * reconnect, a retransmitted packet from the old socket must not extend the new socket's deadline,
 * because the old socket is exactly the thing that is suspected of being dead.
 */
export function recordBeat(
  state: HeartbeatState,
  seq: number,
  atMs: number,
): { readonly state: HeartbeatState; readonly ack: HeartbeatAck } {
  if (!Number.isInteger(seq) || seq < 0) throw new RangeError(`not a heartbeat sequence: ${String(seq)}`);
  if (seq <= state.seq) {
    return {
      state,
      ack: { seq: state.seq, nowMs: atMs, deadlineMs: deadlineOf(state), stale: true },
    };
  }
  const next: HeartbeatState = { ...state, seq, lastBeatMs: atMs };
  return {
    state: next,
    ack: { seq, nowMs: atMs, deadlineMs: deadlineOf(next), stale: false },
  };
}

/** The instant the device becomes absent if it says nothing more. */
export function deadlineOf(state: HeartbeatState): number {
  return state.lastBeatMs + HEARTBEAT_DEADLINE_MS;
}

/** Whether the deadline has passed. Exactly on the deadline is still present (`>`, not `>=`). */
export function isSilent(state: HeartbeatState, atMs: number): boolean {
  return atMs > deadlineOf(state);
}

/** How many beats the device has missed, rounded down. */
export function missedBeats(state: HeartbeatState, atMs: number): number {
  const silence = atMs - state.lastBeatMs;
  return silence <= 0 ? 0 : Math.floor(silence / HEARTBEAT_INTERVAL_MS);
}

/** When the next beat is due, so a test — or a client — can assert the cadence. */
export function nextBeatDueMs(state: HeartbeatState): number {
  return state.lastBeatMs + HEARTBEAT_INTERVAL_MS;
}

/**
 * Whether the *client* should stop waiting and reconnect.
 *
 * Three missed acknowledgements is 2 250 ms, by which time the server has already published the
 * absence at 2 000 ms. The client does not need to know that; it needs to stop sending beats into a
 * socket that is not answering.
 */
export function shouldClientTearDown(lastAckMs: number, atMs: number): boolean {
  return atMs - lastAckMs >= MISSED_ACKS_BEFORE_TEARDOWN * HEARTBEAT_INTERVAL_MS;
}
