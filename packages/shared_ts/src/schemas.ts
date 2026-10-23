/**
 * @file packages/shared_ts/src/schemas.ts
 * @description Canonical UNDAL Zod wire & state-machine contracts shared across all 3 Cloudflare Workers
 * (`W1`, `W2`, `W3`) and both React web applications (`customer_web`, `admin_web`).
 *
 * Enforces:
 * - Bangladeshi mobile phone regex `^01[3-9]\d{8}$` (normalising `+8801...` / `8801...` inputs).
 * - Food-only vendor types (`RESTAURANT | HOME_KITCHEN | CLOUD_KITCHEN`, `D-01`).
 * - Monotonic order status transition machine (`File 22` — `DELIVERED -> CANCELLED` strictly illegal!).
 * - Strict **Data-Only FCM payload schema** (`File 07`, `ALM-01` — `.strict()` forbids any `notification` key!).
 */

import { z } from 'zod';
import { fromBengaliDigits } from './money.ts';

/** Normalises `+8801XXXXXXXXX`, `8801XXXXXXXXX`, or Bengali-digit BD numbers to canonical 11-digit `01XXXXXXXXX`. */
export function normalizeBdPhone(raw: string): string {
  const digits = fromBengaliDigits(raw).replace(/[\s()-]/g, '');
  if (digits.startsWith('+880') && digits.length === 14) return `0${digits.slice(4)}`;
  if (digits.startsWith('880') && digits.length === 13) return `0${digits.slice(3)}`;
  return digits;
}

/** Validated Bangladeshi mobile number (`013..019` + 8 digits). */
export const BdPhoneSchema = z
  .string()
  .transform(normalizeBdPhone)
  .refine((v) => /^01[3-9]\d{8}$/.test(v), { message: 'PHONE_INVALID_BD' });

/** Non-negative integer poisha schema banning fractional floating-point numbers on wire. */
export const NonNegativePoishaSchema = z.number().int().min(0).max(1_000_000_000);

/** Food-only kitchen tracks (`Decision D-01` — grocery/shop tracks forbidden). */
export const VendorTypeSchema = z.enum(['RESTAURANT', 'HOME_KITCHEN', 'CLOUD_KITCHEN']);
export type VendorType = z.infer<typeof VendorTypeSchema>;

/** Canonical 14-state order lifecycle (`File 22`). */
export const OrderStatusSchema = z.enum([
  'PLACED',
  'VENDOR_ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'RIDER_ASSIGNED',
  'RIDER_AT_VENDOR',
  'PICKED_UP',
  'RIDER_AT_CUSTOMER',
  'DELIVERED',
  'CANCELLED_CUSTOMER',
  'CANCELLED_VENDOR',
  'CANCELLED_TIMEOUT',
  'CANCELLED_ADMIN',
  'FAILED_DELIVERY',
]);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

/** Exact legal transitions per status (`DELIVERED` is strictly terminal — see `AP-O4`). */
export const LEGAL_ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PLACED: [
    'VENDOR_ACCEPTED',
    'CANCELLED_CUSTOMER',
    'CANCELLED_VENDOR',
    'CANCELLED_TIMEOUT',
    'CANCELLED_ADMIN',
  ],
  VENDOR_ACCEPTED: ['PREPARING', 'READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'CANCELLED_VENDOR', 'CANCELLED_ADMIN'],
  PREPARING: ['READY_FOR_PICKUP', 'RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'CANCELLED_ADMIN'],
  RIDER_ASSIGNED: ['PREPARING', 'READY_FOR_PICKUP', 'RIDER_AT_VENDOR', 'CANCELLED_ADMIN'],
  READY_FOR_PICKUP: ['RIDER_ASSIGNED', 'RIDER_AT_VENDOR', 'PICKED_UP', 'DELIVERED', 'CANCELLED_ADMIN'],
  RIDER_AT_VENDOR: ['READY_FOR_PICKUP', 'PICKED_UP', 'CANCELLED_ADMIN'],
  PICKED_UP: ['RIDER_AT_CUSTOMER', 'DELIVERED', 'FAILED_DELIVERY', 'CANCELLED_ADMIN'],
  RIDER_AT_CUSTOMER: ['DELIVERED', 'FAILED_DELIVERY', 'CANCELLED_ADMIN'],
  DELIVERED: [],
  CANCELLED_CUSTOMER: [],
  CANCELLED_VENDOR: [],
  CANCELLED_TIMEOUT: [],
  CANCELLED_ADMIN: [],
  FAILED_DELIVERY: [],
} as const;

/** Returns `true` iff transitioning `from -> to` is permitted by `File 22`. */
export function isLegalOrderTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Strict **Data-Only FCM HTTP v1 Payload Schema** (`File 07`, Test `ALM-01`).
 * `.strict()` guarantees any accidental `notification` property on `message` or `android` throws immediately!
 */
export const DataOnlyFcmMessageSchema = z
  .object({
    message: z
      .object({
        token: z.string().min(16),
        android: z
          .object({
            priority: z.literal('high'),
            ttl: z.string().regex(/^\d+s$/),
          })
          .strict(),
        data: z.record(z.string(), z.string()),
      })
      .strict(),
  })
  .strict();

export type DataOnlyFcmMessage = z.infer<typeof DataOnlyFcmMessageSchema>;

/** Builds and schema-verifies a guaranteed data-only high-priority Android FCM message (`ALM-01`). */
export function buildDataOnlyFcmPayload(params: {
  readonly token: string;
  readonly ttlSeconds: number;
  readonly data: Readonly<Record<string, string>>;
}): DataOnlyFcmMessage {
  return DataOnlyFcmMessageSchema.parse({
    message: {
      token: params.token,
      android: {
        priority: 'high',
        ttl: `${Math.max(15, Math.trunc(params.ttlSeconds))}s`,
      },
      data: { ...params.data },
    },
  });
}
