/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 */

import { fromHexId, sha256, toHexId } from "../../lib/ids.ts";

/** The two cash decisions that may eventually use a durable financial operation. */
export type CashOperationAction = "SETTLEMENT_APPROVAL" | "CASH_WRITE_OFF";

/** JSON accepted for canonical business inputs and stored result data. */
export type CashJson = null | boolean | number | string | readonly CashJson[] | { readonly [key: string]: CashJson };
/** A response's data, without the HTTP envelope or request ID. */
export type CashJsonObject = { readonly [key: string]: CashJson };

/** Inputs must be validated by the business route before identity is constructed. */
export interface CashOperationInput {
  readonly actorId: string;
  readonly action: CashOperationAction;
  readonly targetId: string;
  readonly idempotencyKey: string;
  readonly payload: unknown;
}

/** Hashed key and canonical request identity; raw keys and payloads are not stored. */
export interface CashOperationIdentity {
  readonly actorId: Uint8Array;
  readonly action: CashOperationAction;
  readonly targetId: Uint8Array;
  readonly keyHash: Uint8Array;
  readonly requestHash: Uint8Array;
}

const MAX_JSON_BYTES = 8_192;
const MAX_DEPTH = 16;
const MAX_NODES = 1_024;
const UUID = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/iu;

/** Parse a UUID without accepting malformed dash placement. */
export function cashOperationUuid(value: string): Uint8Array {
  if (typeof value !== "string" || !UUID.test(value)) throw new RangeError("invalid cash operation UUID");
  return fromHexId(value);
}

/** Normalize JSON with sorted object keys and strict size, depth and integer limits. */
export function canonicalCashJson(value: unknown): { readonly value: CashJson; readonly text: string } {
  const seen = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): CashJson {
    nodes += 1;
    if (nodes > MAX_NODES || depth > MAX_DEPTH) throw new RangeError("cash operation JSON too complex");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new RangeError("cash operation JSON numbers must be safe integers");
      return item;
    }
    if (typeof item !== "object" || seen.has(item)) throw new RangeError("invalid cash operation JSON");
    seen.add(item);
    try {
      if (Array.isArray(item)) {
        const array: CashJson[] = [];
        for (let index = 0; index < item.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(item, index);
          if (descriptor === undefined || !("value" in descriptor)) throw new RangeError("invalid cash operation array");
          array.push(visit(descriptor.value, depth + 1));
        }
        return array;
      }
      const prototype = Object.getPrototypeOf(item) as unknown;
      if (prototype !== Object.prototype && prototype !== null) throw new RangeError("invalid cash operation object");
      if (Object.getOwnPropertySymbols(item).length !== 0) throw new RangeError("invalid cash operation object");
      const result: Record<string, CashJson> = Object.create(null) as Record<string, CashJson>;
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (descriptor === undefined || !("value" in descriptor)) throw new RangeError("invalid cash operation property");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      seen.delete(item);
    }
  }
  const normalized = visit(value, 0);
  const text = JSON.stringify(normalized);
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new RangeError("cash operation JSON too large");
  return { value: normalized, text };
}

/** Build a stable, versioned identity. The key is scoped to the actor and action. */
export async function prepareCashOperation(input: CashOperationInput): Promise<CashOperationIdentity> {
  if (input.action !== "SETTLEMENT_APPROVAL" && input.action !== "CASH_WRITE_OFF") throw new RangeError("invalid cash operation action");
  if (typeof input.idempotencyKey !== "string" || !/^[\x21-\x7e]{1,64}$/u.test(input.idempotencyKey)) {
    throw new RangeError("invalid cash operation idempotency key");
  }
  const actorId = cashOperationUuid(input.actorId);
  const targetId = cashOperationUuid(input.targetId);
  const payload = canonicalCashJson(input.payload);
  const request = JSON.stringify(["undal.cash-operation.v1", toHexId(actorId), input.action, toHexId(targetId), payload.value]);
  return { actorId, action: input.action, targetId, keyHash: await sha256(input.idempotencyKey), requestHash: await sha256(request) };
}
