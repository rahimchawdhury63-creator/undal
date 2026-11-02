/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import type { Db } from "../db/client.ts";
import { fromHexId } from "../lib/ids.ts";
import type { OrderItemDraft } from "../domain/order/items.ts";
import type { StateEventDraft } from "../domain/order/state-events.ts";
import type { OrderDraft } from "../domain/order/placement.ts";

/**
 * Writing an order, its lines and its first event.
 *
 * Three inserts, one `batch`, because the platform has no interactive transactions (`05 §6.1`) and a
 * placed order whose items are missing is an order nobody can cook or invoice. `batch` is one
 * round trip; if it fails the caller retries the whole placement, which is safe because the order id
 * is minted per attempt and a duplicate code is caught by `uq_orders_code`.
 */

/** The per-side money an order row needs, which a quote's totals do not carry. */
export interface PlacementMoney {
  readonly commissionPaisa: number;
  readonly riderBonusPaisa: number;
  readonly riderPayoutPaisa: number;
  readonly vendorPayoutPaisa: number;
  readonly platformRevenuePaisa: number;
}

/** The customer's standing, which the placement guards read. */
export async function findCustomerStatus(db: Db, userId: Uint8Array): Promise<string | null> {
  const row = await db.first<{ status: string }>("SELECT `status` FROM `users` WHERE `id` = ? LIMIT 1", [userId]);
  return row === null ? null : row.status;
}

/** Whether a zone is live, which decides whether an address is servable. */
export async function findZoneStatus(db: Db, zoneId: Uint8Array): Promise<string | null> {
  const row = await db.first<{ status: string }>("SELECT `status` FROM `zones` WHERE `id` = ? LIMIT 1", [zoneId]);
  return row === null ? null : row.status;
}

/** A `datetime(6)` from a millisecond timestamp, in the format TiDB compares lexically. */
function sqlDatetime(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 23)}000`;
}

/**
 * Insert the order, its lines and its first event.
 *
 * The money is written as integers from the quote that was signed, not recomputed here: an order row
 * that recomputed its own total would be a third pricing implementation, and the invoice would then
 * depend on when it was read.
 */
export async function writePlacement(
  db: Db,
  input: {
    readonly order: OrderDraft;
    readonly items: readonly OrderItemDraft[];
    readonly event: StateEventDraft;
    readonly money: PlacementMoney;
    readonly nowMs: number;
  },
): Promise<void> {
  const { order, money } = input;
  const placedAt = sqlDatetime(input.nowMs);

  const statements = [
    {
      sql:
        "INSERT INTO `orders` (`id`, `code`, `customer_user_id`, `vendor_id`, `zone_id`, `fulfilment`, `state`, " +
        "`pickup_lat_e7`, `pickup_lon_e7`, `delivery_lat_e7`, `delivery_lon_e7`, `customer_note`, `payment_method`, " +
        "`subtotal_paisa`, `discount_paisa`, `delivery_fee_paisa`, `small_order_fee_paisa`, `tax_paisa`, `tip_paisa`, " +
        "`rounding_paisa`, `total_paisa`, `commission_paisa`, `rider_bonus_paisa`, `rider_payout_paisa`, " +
        "`vendor_payout_paisa`, `platform_revenue_paisa`, `fare_source`, `surge_bps`, `weather_condition`, " +
        "`route_distance_m`, `route_duration_s`, `traffic_delay_s`, `distance_source`, `placed_at`, `created_at`, `updated_at`) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COD', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        fromHexId(order.id),
        order.code,
        fromHexId(order.customerUserId),
        fromHexId(order.vendorId),
        fromHexId(order.zoneId),
        order.fulfilment,
        order.state,
        order.pickupLatE7,
        order.pickupLonE7,
        order.deliveryLatE7,
        order.deliveryLonE7,
        order.customerNote,
        order.totals.subtotalPaisa,
        order.totals.discountPaisa,
        order.totals.deliveryFeePaisa,
        order.totals.smallOrderFeePaisa,
        order.totals.taxPaisa,
        order.totals.tipPaisa,
        order.totals.roundingPaisa,
        order.totals.totalPaisa,
        money.commissionPaisa,
        money.riderBonusPaisa,
        money.riderPayoutPaisa,
        money.vendorPayoutPaisa,
        money.platformRevenuePaisa,
        order.fareSource,
        order.surgeBps,
        order.weatherCondition,
        order.routeDistanceM,
        order.routeDurationS,
        order.trafficDelayS,
        "ESTIMATED",
        placedAt,
        placedAt,
        placedAt,
      ],
    },
    ...input.items.map((item) => ({
      sql:
        "INSERT INTO `order_items` (`id`, `order_id`, `item_id`, `variant_id`, `seq`, `name_en`, `name_bn`, " +
        "`unit_price_paisa`, `quantity`, `line_total_paisa`, `notes`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        fromHexId(item.id),
        fromHexId(item.orderId),
        fromHexId(item.itemId),
        item.variantId === null ? null : fromHexId(item.variantId),
        item.seq,
        item.nameEn,
        item.nameBn,
        item.unitPricePaisa,
        item.quantity,
        item.lineTotalPaisa,
        item.notes,
      ],
    })),
    {
      sql:
        "INSERT INTO `order_state_events` (`id`, `order_id`, `seq`, `from_state`, `to_state`, `actor_type`, " +
        "`actor_user_id`, `reason_code`, `reason_text`, `metadata`, `occurred_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      params: [
        fromHexId(input.event.id),
        fromHexId(input.event.orderId),
        input.event.seq,
        input.event.fromState,
        input.event.toState,
        input.event.actorType,
        input.event.actorUserId === null ? null : fromHexId(input.event.actorUserId),
        input.event.reasonCode,
        input.event.reasonText,
        JSON.stringify(input.event.metadata),
        input.event.occurredAt,
      ],
    },
  ];

  await db.batch(statements);
}
