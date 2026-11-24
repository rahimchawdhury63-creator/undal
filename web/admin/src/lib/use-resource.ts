/*
 * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
 *
 * One hook for every screen that reads the API.
 *
 * A console is a wall of numbers that a reviewer refreshes between decisions, so the three states
 * that matter are explicit: what is on screen, what failed (with its request id), and whether a
 * newer answer is on its way. A stale answer stays visible while the next one loads — blanking the
 * queue on every refresh is how a reviewer loses the row they were reading.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError, type ApiError } from "./api.ts";

/** The result of one read. `data` is `null` only before the first successful response. */
export interface Resource<T> {
  readonly data: T | null;
  readonly error: ApiError | null;
  readonly loading: boolean;
  reload(): void;
}

/**
 * Read once on mount and on demand.
 *
 * `deps` is the filter set; changing it refetches. `stale-while-revalidate` is deliberate: the
 * previous page stays readable until the new one arrives, and an error leaves the last good data
 * in place rather than replacing a queue with an apology.
 */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>, deps: readonly unknown[] = []): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    setLoading(true);
    void loadRef
      .current(controller.signal)
      .then((value) => {
        if (!live) return;
        setData(value);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!live) return;
        setError(toApiError(failure));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
      controller.abort();
    };
    // The dependency list is the caller's; the loader itself is read through a ref so an inline
    // arrow does not re-run the request on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}
