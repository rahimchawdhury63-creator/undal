-- Undal — the free coordinator's row store. Licensed under PASVL-1.0.
--
-- The `sql` coordination backend keeps three things that are not orders: the wave plan for a
-- dispatch, a zone's open-dispatch counter, and the row that says a device is present. None of
-- them needs cross-process atomicity — the claim does, and the claim is `dispatch_locks` — so they
-- live together in one table with a key, a value and an expiry rather than in a second Cloudflare
-- product.
--
-- D77 named Workers KV for this and D89 retired that choice on arithmetic: KV's free tier allows
-- 1 000 writes and 1 000 lists a day, and one vendor's eight-hour shift is 1 921 stamped presence
-- writes even after D89 cut the write per beat down to a write per 15 s. TiDB is where the free
-- tier actually is, and it is also what `14 §2` and `14 §3.3` have always said presence lives in.
--
-- `state_value` is opaque JSON text: the database never filters on it, and a future version of the
-- coordinator can change the shape of a wave plan without a migration. `expires_at` is what makes a
-- row self-retiring — a session whose device vanished without a close event stops being read as
-- present when the clock passes it, and a sweeper can delete it later without knowing what it meant.
--
-- The key is bounded at 191 characters because utf8mb4 indexes 191 characters in 768 bytes, the
-- largest key MySQL accepts on an InnoDB index without a prefix length. Every key this platform
-- writes is `kind:zone:role:actor:device` and well under it; the bound is what keeps a long id from
-- failing at the database instead of at the caller.

CREATE TABLE IF NOT EXISTS `coordination_state` (
    `state_key`   VARCHAR(191) NOT NULL PRIMARY KEY,
    `state_value` LONGTEXT     NOT NULL,
    `expires_at`  DATETIME(6)      NULL,
    `updated_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    -- The sweeper's read: everything that has run out. The hot path reads by key and never uses it.
    INDEX `idx_coordination_state_expiry` (`expires_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
