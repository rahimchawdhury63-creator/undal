/**
 * @file workers/realtime/src/db-helpers.ts
 * @description Pure order-state helpers shared by PostgREST and PGlite `RealtimeDbAdapter` backends.
 */

/** Returns `true` when `status` can legally transition directly to `RIDER_ASSIGNED` in PostgreSQL (`0011`). */
export function islegalAssignTransition(status: string): boolean {
  return (
    status === 'VENDOR_ACCEPTED' ||
    status === 'PREPARING' ||
    status === 'READY_FOR_PICKUP'
  );
}
