/**
 * @file workers/realtime/src/presence.ts
 * @description Pure deterministic Presence state classifier (`LIVE` / `STALE` / `OFFLINE`),
 * smart kitchen prep-time estimator (`D-22`), and customer ETA calculator (`File 12 §12.1, §12.5, §12.6`).
 */

import type { WeatherCondition } from '@undal/shared-ts';
import type { PresenceStatus } from './types.ts';

export interface PresenceThresholds {
  /** Maximum age in seconds for `'LIVE'` state (`File 12 §12.1` default `25s`). */
  readonly liveMaxSeconds: number;
  /** Maximum age in seconds for `'STALE'` before becoming `'OFFLINE'` (`File 12 §12.1` default `60s`). */
  readonly staleMaxSeconds: number;
}

export const DEFAULT_PRESENCE_THRESHOLDS: PresenceThresholds = {
  liveMaxSeconds: 25,
  staleMaxSeconds: 60,
} as const;

/**
 * Classifies an operator's live availability strictly from server clock elapsed time (`D-05`):
 * - `<= 25s`: `'LIVE'` (eligible for new orders/offers)
 * - `(25s, 60s]`: `'STALE'` (keeps current assigned work; excluded from new offers)
 * - `> 60s` or missing heartbeat: `'OFFLINE'` (kitchen hidden from feed; rider excluded)
 */
export function classifyPresence(
  lastSeenAtMs: number | null | undefined,
  nowMs: number,
  thresholds: PresenceThresholds = DEFAULT_PRESENCE_THRESHOLDS,
): PresenceStatus {
  if (lastSeenAtMs === null || lastSeenAtMs === undefined || !Number.isFinite(lastSeenAtMs)) {
    return 'OFFLINE';
  }
  const elapsedSeconds = Math.max(0, (nowMs - lastSeenAtMs) / 1_000);
  if (elapsedSeconds <= thresholds.liveMaxSeconds) return 'LIVE';
  if (elapsedSeconds <= thresholds.staleMaxSeconds) return 'STALE';
  return 'OFFLINE';
}

/**
 * Returns client heartbeat interval guidance (`06-firebase-rtdb-realtime-economy.md` & `06-api-contract-final.md`):
 * - Rider active delivery: `15s`
 * - Vendor foreground or Rider foreground shift: `10s`
 * - Rider idle background session: `45s`
 */
export function recommendedHeartbeatSeconds(params: {
  readonly kind: 'vendor' | 'rider';
  readonly appState: 'fg' | 'bg' | 'alarm_service';
  readonly capacityUsed: number;
}): number {
  if (params.kind === 'rider' && params.capacityUsed > 0) return 15;
  if (params.appState === 'fg') return 10;
  return 45;
}

export interface PrepSuggestionInput {
  readonly baselineMinutes: number;
  readonly openOrdersPrepWeight: number;
  readonly kitchenCapacitySlots: number;
  readonly weatherCondition: WeatherCondition;
  readonly peakHourAdderMinutes?: number;
  readonly busyModeExtraMinutes?: number;
}

/**
 * Computes smart default kitchen prep minutes (`File 12 §12.5`, `D-22`):
 * `clamp(5, 200, round(baseline * loadFactor + weatherAdder + peakAdder + busyModeExtra))`.
 */
export function computeSuggestedPrepMinutes(input: PrepSuggestionInput): {
  readonly suggestedMinutes: number;
  readonly loadFactor: number;
  readonly weatherAdderMinutes: number;
} {
  const capacity = Math.max(1, input.kitchenCapacitySlots);
  const rawLoad = Math.max(1, 1 + Math.max(0, input.openOrdersPrepWeight - 1) * (0.35 / capacity * 2));
  const loadFactor = Math.min(2.5, Math.round(rawLoad * 1000) / 1000);
  const weatherAdderMinutes =
    input.weatherCondition === 'storm'
      ? 5
      : input.weatherCondition === 'rain'
        ? 2
        : 0;
  const raw =
    input.baselineMinutes * loadFactor +
    weatherAdderMinutes +
    (input.peakHourAdderMinutes ?? 0) +
    (input.busyModeExtraMinutes ?? 0);
  const suggestedMinutes = Math.min(200, Math.max(5, Math.round(raw)));
  return {
    suggestedMinutes,
    loadFactor,
    weatherAdderMinutes,
  };
}

/** Validates vendor-committed prep minutes (`> 60 min` requires a structured reason chip per `File 12 §12.5`). */
export function validateCommittedPrepMinutes(
  committedMinutes: number,
  reasonChip?: string | null,
): { readonly valid: boolean; readonly requiresReasonChip: boolean } {
  if (!Number.isInteger(committedMinutes) || committedMinutes < 3 || committedMinutes > 240) {
    return { valid: false, requiresReasonChip: false };
  }
  if (committedMinutes > 60 && (!reasonChip || reasonChip.trim().length < 2)) {
    return { valid: false, requiresReasonChip: true };
  }
  return { valid: true, requiresReasonChip: committedMinutes > 60 };
}

export interface CustomerEtaInput {
  readonly fulfilment: 'delivery' | 'pickup';
  readonly prepReadyAtMs: number;
  readonly riderArriveVendorAtMs?: number;
  readonly loadedLegMinutes?: number;
  readonly handoverBufferMinutes?: number;
  readonly previousPromisedAtMs?: number;
}

/**
 * Computes customer-facing ETA (`File 12 §12.6`):
 * - Delivery: `max(prepReadyAt, riderArriveVendorAt) + loadedLeg + 2 min handover`, displayed as `±5 min` range,
 *   raising `slippedAlert = true` whenever delay exceeds `10 min` beyond prior promise.
 * - Pickup: `prepReadyAt` only.
 */
export function computeCustomerEta(input: CustomerEtaInput): {
  readonly promisedAtMs: number;
  readonly rangeEarliestAtMs: number;
  readonly rangeLatestAtMs: number;
  readonly slippedMinutes: number;
  readonly slippedAlert: boolean;
} {
  if (input.fulfilment === 'pickup') {
    const promisedAtMs = input.prepReadyAtMs;
    const slipMs =
      input.previousPromisedAtMs !== undefined ? Math.max(0, promisedAtMs - input.previousPromisedAtMs) : 0;
    const slippedMinutes = Math.round(slipMs / 60_000);
    return {
      promisedAtMs,
      rangeEarliestAtMs: promisedAtMs - 2 * 60_000,
      rangeLatestAtMs: promisedAtMs + 3 * 60_000,
      slippedMinutes,
      slippedAlert: slippedMinutes > 10,
    };
  }

  const departVendorAtMs = Math.max(
    input.prepReadyAtMs,
    input.riderArriveVendorAtMs ?? input.prepReadyAtMs,
  );
  const loadedMs = Math.max(1, input.loadedLegMinutes ?? 10) * 60_000;
  const bufferMs = Math.max(0, input.handoverBufferMinutes ?? 2) * 60_000;
  const promisedAtMs = Math.round(departVendorAtMs + loadedMs + bufferMs);
  const slipMs =
    input.previousPromisedAtMs !== undefined ? Math.max(0, promisedAtMs - input.previousPromisedAtMs) : 0;
  const slippedMinutes = Math.round(slipMs / 60_000);

  return {
    promisedAtMs,
    rangeEarliestAtMs: promisedAtMs - 5 * 60_000,
    rangeLatestAtMs: promisedAtMs + 5 * 60_000,
    slippedMinutes,
    slippedAlert: slippedMinutes > 10,
  };
}

/**
 * Ideal dispatch offset rule (`File 12 §12.5`): dispatch rider so arrival at kitchen lands `~2 min` before food ready.
 */
export function computeIdealDispatchAtMs(
  prepReadyAtMs: number,
  expectedRiderToVendorMinutes: number,
): number {
  const leadMs = (Math.max(1, expectedRiderToVendorMinutes) + 2) * 60_000;
  return Math.round(prepReadyAtMs - leadMs);
}
