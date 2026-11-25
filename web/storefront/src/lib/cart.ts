/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 * SPDX-License-Identifier: LicenseRef-PASVL-1.0
 *
 * The cart.
 *
 * One kitchen per order, because a single rider collects from a single counter. The store holds
 * integer paisa and nothing else — no formatted strings, no floats — so the line total the
 * customer sees and the line total the server re-prices are the same arithmetic. It survives a
 * refresh in `localStorage`, which is the one piece of global client state in the storefront and
 * the reason a guest can build a cart before signing in.
 */

import { create } from "zustand";

/** A chosen option, snapshotted with its price so a menu edit cannot rewrite a cart total. */
export interface CartModifier {
  readonly id: string;
  readonly nameEn: string;
  readonly nameBn: string;
  readonly priceDeltaPaisa: number;
}

/** One line of the cart. */
export interface CartLine {
  /** A stable key: the item plus its options, so the same dish with different options is two lines. */
  readonly key: string;
  readonly itemId: string;
  readonly name: string;
  readonly nameBn: string | null;
  readonly unitPricePaisa: number;
  readonly modifiers: readonly CartModifier[];
  readonly quantity: number;
  readonly note: string | null;
  readonly imageUrl: string | null;
}

/** The vendor a cart belongs to. */
export interface CartVendor {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly nameBn: string | null;
}

/** The cart's state and the operations a screen performs on it. */
export interface CartState {
  readonly vendor: CartVendor | null;
  readonly lines: readonly CartLine[];
  readonly fulfilment: "DELIVERY" | "PICKUP";
  /** Add a line, replacing an identical one and refusing a line from another kitchen. */
  add(line: Omit<CartLine, "key">, vendor: CartVendor): { readonly ok: true } | { readonly ok: false; readonly reason: "OTHER_VENDOR" };
  setQuantity(key: string, quantity: number): void;
  remove(key: string): void;
  setNote(key: string, note: string | null): void;
  setFulfilment(fulfilment: "DELIVERY" | "PICKUP"): void;
  clear(): void;
  /** Quantity of one item across every option set, for the menu's stepper. */
  quantityOf(itemId: string): number;
}

/** The key an item and its options hash to: the same dish with the same options is one line. */
export function lineKey(itemId: string, modifierIds: readonly string[], note: string | null): string {
  const options = [...modifierIds].sort().join(",");
  return `${itemId}|${options}|${note ?? ""}`;
}

/** What one line costs: unit price plus options, times quantity. Integer paisa throughout. */
export function lineTotalPaisa(line: CartLine): number {
  const options = line.modifiers.reduce((sum, modifier) => sum + modifier.priceDeltaPaisa, 0);
  return (line.unitPricePaisa + options) * line.quantity;
}

/** What the cart costs before delivery, fees and tax. */
export function subtotalPaisa(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalPaisa(line), 0);
}

/** How many items are in the cart, counting quantities. */
export function itemCount(lines: readonly CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

const KEY = "undal.cart.v1";

interface Persisted {
  readonly vendor: CartVendor | null;
  readonly lines: readonly CartLine[];
  readonly fulfilment: "DELIVERY" | "PICKUP";
}

function readPersisted(): Persisted {
  if (typeof window === "undefined") return { vendor: null, lines: [], fulfilment: "DELIVERY" };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw === null) return { vendor: null, lines: [], fulfilment: "DELIVERY" };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const lines = Array.isArray(parsed.lines) ? parsed.lines.filter((line) => typeof line?.key === "string") : [];
    return {
      vendor: parsed.vendor ?? null,
      lines,
      fulfilment: parsed.fulfilment === "PICKUP" ? "PICKUP" : "DELIVERY",
    };
  } catch {
    return { vendor: null, lines: [], fulfilment: "DELIVERY" };
  }
}

const initial = readPersisted();

/**
 * The cart store: read it with a selector, or call an action on it.
 * `useCart.getState()` is how non-React code (the persistence subscriber) reads it.
 */
export const useCart = create<CartState>((set, get) => ({
  vendor: initial.vendor,
  lines: initial.lines,
  fulfilment: initial.fulfilment,

  add(line, vendor) {
    const state = get();
    if (state.vendor !== null && state.vendor.id !== vendor.id) {
      return { ok: false, reason: "OTHER_VENDOR" } as const;
    }
    const key = lineKey(line.itemId, line.modifiers.map((modifier) => modifier.id), line.note);
    const existing = state.lines.find((candidate) => candidate.key === key);
    const lines =
      existing === undefined
        ? [...state.lines, { ...line, key }]
        : state.lines.map((candidate) =>
            candidate.key === key ? { ...candidate, quantity: candidate.quantity + line.quantity } : candidate,
          );
    set({ vendor, lines });
    return { ok: true } as const;
  },

  setQuantity(key, quantity) {
    const lines =
      quantity <= 0
        ? get().lines.filter((line) => line.key !== key)
        : get().lines.map((line) => (line.key === key ? { ...line, quantity } : line));
    const vendor = lines.length === 0 ? null : get().vendor;
    set({ lines, vendor });
  },

  remove(key) {
    const lines = get().lines.filter((line) => line.key !== key);
    set({ lines, vendor: lines.length === 0 ? null : get().vendor });
  },

  setNote(key, note) {
    set({ lines: get().lines.map((line) => (line.key === key ? { ...line, note } : line)) });
  },

  setFulfilment(fulfilment) {
    set({ fulfilment });
  },

  clear() {
    set({ vendor: null, lines: [], fulfilment: "DELIVERY" });
  },

  quantityOf(itemId) {
    return get()
      .lines.filter((line) => line.itemId === itemId)
      .reduce((sum, line) => sum + line.quantity, 0);
  },
}));

/**
 * Persist on change, once, outside React.
 *
 * `localStorage` is unavailable in private modes on some browsers and in the prerender pass; a
 * failed write must never break a cart operation, so it is swallowed deliberately rather than
 * surfaced as an error a customer can do nothing about.
 */
if (typeof window !== "undefined") {
  useCart.subscribe((state) => {
    try {
      window.localStorage.setItem(
        KEY,
        JSON.stringify({ vendor: state.vendor, lines: state.lines, fulfilment: state.fulfilment }),
      );
    } catch {
      // Storage is optional; the cart still works for this tab.
    }
  });
}
