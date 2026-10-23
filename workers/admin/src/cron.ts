/**
 * @file workers/admin/src/cron.ts
 * @description Production Scheduled Cron Engine for `W3 undal-admin` (`wrangler.toml` `4` triggers,
 * respecting the Cloudflare Free `<= 5` Cron Triggers ceiling & `Asia/Dhaka` settlement laws):
 *   1. `"5 18 * * 4"` -> Friday `00:05 Asia/Dhaka` Rider weekly settlement batch (`D-06`)
 *   2. `"5 18 * * 5"` -> Saturday `00:05 Asia/Dhaka` Partner/Vendor weekly settlement batch (`D-06`)
 *   3. `"30 20 * * *"` -> Daily `02:30 Asia/Dhaka` Free-Tier DB Quota Guardian (`prune_ephemeral_rows`)
 *   4. `"0 * * * *"`  -> Hourly MET Norway (`api.met.no` CC BY 4.0) active-zone weather sync
 *                         (preserving unexpired `admin_override` rows per `RSK-04`)
 */

import type { WeatherCondition } from '@undal/shared-ts';
import type { AdminDbAdapter, AdminWorkerEnv } from './types.ts';

/** Result summary returned by `runAdminScheduledCron` for observability & deterministic testing. */
export interface AdminCronRunResult {
  readonly cron: string;
  readonly executedAtIso: string;
  readonly job:
    | 'weekly_rider_settlement'
    | 'weekly_vendor_settlement'
    | 'nightly_quota_prune'
    | 'hourly_weather_and_housekeeping';
  readonly summary: Record<string, unknown>;
}

/** Computes previous 7-day `[periodStart, periodEnd]` (`YYYY-MM-DD`) in `Asia/Dhaka` (`UTC+06:00`). */
export function computeWeeklySettlementWindow(nowMs: number): {
  readonly periodStart: string;
  readonly periodEnd: string;
} {
  const dhakaNowMs = nowMs + 6 * 3_600_000;
  const endDate = new Date(dhakaNowMs - 86_400_000);
  const startDate = new Date(dhakaNowMs - 7 * 86_400_000);
  return {
    periodStart: startDate.toISOString().slice(0, 10),
    periodEnd: endDate.toISOString().slice(0, 10),
  };
}

/** Maps MET Norway symbol / precipitation + temp metrics into canonical UNDAL `WeatherCondition`. */
export function classifyMetNorwayWeather(sample: {
  readonly symbolCode?: string | undefined;
  readonly precipitationMm?: number | undefined;
  readonly airTemperatureC?: number | undefined;
}): WeatherCondition {
  const sym = (sample.symbolCode ?? '').toLowerCase();
  const rainMm = Number(sample.precipitationMm ?? 0);
  const tempC = Number(sample.airTemperatureC ?? 28);
  if (sym.includes('thunder') || sym.includes('heavyrain') || rainMm >= 10) return 'storm';
  if (sym.includes('rain') || sym.includes('shower') || rainMm >= 1.0) return 'rain';
  if (tempC >= 38) return 'extreme_heat';
  return 'clear';
}

/** Executes the matching scheduled job for a Cloudflare `ScheduledController` trigger. */
export async function runAdminScheduledCron(params: {
  readonly cron: string;
  readonly scheduledTimeMs?: number | undefined;
  readonly db: AdminDbAdapter;
  readonly env: AdminWorkerEnv;
  readonly fetchImpl?: typeof fetch | undefined;
}): Promise<AdminCronRunResult> {
  const nowMs = params.scheduledTimeMs ?? params.env.nowMs?.() ?? Date.now();
  const executedAtIso = new Date(nowMs).toISOString();
  const fetchFn = params.fetchImpl ?? fetch;

  // 1. Friday `00:05 Asia/Dhaka` (`5 18 * * 4` UTC) -> Weekly Rider Settlement Invoices
  if (params.cron === '5 18 * * 4') {
    const win = computeWeeklySettlementWindow(nowMs);
    const invoices = await params.db.generateWeeklyInvoicesBatch({
      payeeType: 'rider',
      periodStart: win.periodStart,
      periodEnd: win.periodEnd,
      cashoutFeeBps: 185,
      nowMs,
    });
    return {
      cron: params.cron,
      executedAtIso,
      job: 'weekly_rider_settlement',
      summary: { ...win, generatedCount: invoices.length },
    };
  }

  // 2. Saturday `00:05 Asia/Dhaka` (`5 18 * * 5` UTC) -> Weekly Partner/Vendor Settlement Invoices
  if (params.cron === '5 18 * * 5') {
    const win = computeWeeklySettlementWindow(nowMs);
    const invoices = await params.db.generateWeeklyInvoicesBatch({
      payeeType: 'vendor',
      periodStart: win.periodStart,
      periodEnd: win.periodEnd,
      cashoutFeeBps: 185,
      nowMs,
    });
    return {
      cron: params.cron,
      executedAtIso,
      job: 'weekly_vendor_settlement',
      summary: { ...win, generatedCount: invoices.length },
    };
  }

  // 3. Daily `02:30 Asia/Dhaka` (`30 20 * * *` UTC) -> Nightly Free-Tier DB Quota Prune
  if (params.cron === '30 20 * * *') {
    const pruned = await params.db.runNightlyQuotaPrune(nowMs);
    return {
      cron: params.cron,
      executedAtIso,
      job: 'nightly_quota_prune',
      summary: pruned,
    };
  }

  // 4. Hourly (`0 * * * *`) -> Commercial-free MET Norway (`api.met.no`) active-zone weather sync
  const activeZones = (await params.db.listZonesAdmin()).filter((z) => z.isActive);
  let updatedZones = 0;
  let preservedOverrides = 0;

  for (const zone of activeZones) {
    let condition: WeatherCondition = 'clear';
    try {
      const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${zone.centerLat.toFixed(4)}&lon=${zone.centerLng.toFixed(4)}`;
      const res = await fetchFn(metUrl, {
        headers: { 'User-Agent': 'UndalFoodDeliveryBD/1.0 (ops@undal.app)' },
      });
      if (res.ok) {
        const payload = (await res.json()) as {
          properties?: {
            timeseries?: readonly {
              data?: {
                instant?: { details?: { air_temperature?: number } };
                next_1_hours?: {
                  summary?: { symbol_code?: string };
                  details?: { precipitation_amount?: number };
                };
              };
            }[];
          };
        };
        const first = payload.properties?.timeseries?.[0]?.data;
        condition = classifyMetNorwayWeather({
          symbolCode: first?.next_1_hours?.summary?.symbol_code,
          precipitationMm: first?.next_1_hours?.details?.precipitation_amount,
          airTemperatureC: first?.instant?.details?.air_temperature,
        });
      }
    } catch {
      // Upstream failure leaves existing weather_cache or defaults safely to `clear` (`RSK-04`)
    }
    const outcome = await params.db.refreshActiveZoneWeather(zone.id, condition, 'met_norway', nowMs);
    if (outcome.updated) updatedZones += 1;
    if (outcome.preservedAdminOverride) preservedOverrides += 1;
  }

  return {
    cron: params.cron,
    executedAtIso,
    job: 'hourly_weather_and_housekeeping',
    summary: { activeZones: activeZones.length, updatedZones, preservedOverrides },
  };
}
