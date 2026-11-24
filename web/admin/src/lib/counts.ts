/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * The two queue lengths the sidebar shows.
 *
 * They live in a store rather than in the shell's own request because the page that loaded them
 * owns the fetch, and asking the API twice for the same summary on the same navigation is how a
 * console doubles its load for a number it already has. A page publishes what it learned; the
 * sidebar reads it. Before anything is published the counts are absent, not zero — a zero the
 * console has not verified is a claim that nothing is waiting.
 */

import { create } from "zustand";

/** The published queue lengths. */
export interface CountsState {
  readonly settlementsWaiting: number | null;
  readonly declarationsOpen: number | null;
  publish(settlementsWaiting: number | null, declarationsOpen: number | null): void;
}

/** The queue lengths shown in navigation. */
export const useCounts = create<CountsState>((set) => ({
  settlementsWaiting: null,
  declarationsOpen: null,
  publish(settlementsWaiting, declarationsOpen) {
    set({ settlementsWaiting, declarationsOpen });
  },
}));
