-- Undal — D1: live rider tracking. Licensed under PASVL-1.0.
--
-- D1 holds only what may be lost. `rider_positions` is a ring buffer of 120
-- points per rider and `rider_current` is one row per online rider; both are
-- deleted when a shift ends, so an erased rider leaves nothing behind within
-- five seconds. No order, no payment and no person lives here.

CREATE TABLE IF NOT EXISTS rider_positions (
    rider_id        TEXT    NOT NULL,
    seq             INTEGER NOT NULL,
    lat             REAL    NOT NULL,
    lon             REAL    NOT NULL,
    accuracy_m      INTEGER NOT NULL,
    bearing_deg     INTEGER,
    speed_mps       REAL,
    battery_pct     INTEGER,
    is_moving       INTEGER NOT NULL DEFAULT 1,
    order_id        TEXT,
    recorded_at     INTEGER NOT NULL,   -- device clock, epoch ms
    received_at     INTEGER NOT NULL,   -- edge clock, epoch ms
    PRIMARY KEY (rider_id, seq)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_positions_recent
    ON rider_positions (rider_id, seq DESC);

CREATE TABLE IF NOT EXISTS rider_current (
    rider_id        TEXT    PRIMARY KEY,
    shift_id        TEXT    NOT NULL,
    zone_id         TEXT    NOT NULL,
    vehicle         TEXT    NOT NULL,
    lat             REAL    NOT NULL,
    lon             REAL    NOT NULL,
    bearing_deg     INTEGER,
    speed_mps       REAL,
    accuracy_m      INTEGER NOT NULL,
    state           TEXT    NOT NULL,   -- ONLINE | ON_ORDER | BREAK
    active_order_id TEXT,
    batch_size      INTEGER NOT NULL DEFAULT 0,
    battery_pct     INTEGER,
    updated_at      INTEGER NOT NULL,
    stale_after     INTEGER NOT NULL    -- updated_at + current cadence ceiling x 2
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_current_zone ON rider_current (zone_id, state);
