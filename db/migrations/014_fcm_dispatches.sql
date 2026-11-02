-- Undal — FCM dispatch log. Licensed under PASVL-1.0.
--
-- `15 §8` asks for the table that closes the delivery loop: every push we send is a row
-- here, and every `alarm_received` the device sends back fills in `received_at`. The gap
-- between `sent_at` and `received_at` is the number the admin panel's device matrix is
-- built from, and it is the only way to tell a vendor "your phone, specifically, is not
-- receiving alarms" instead of guessing.
--
-- `message_id` is FCM's own name for the accepted message and is NULL when FCM rejected
-- the send before accepting it — an unregistered token has no id, and a row that claimed
-- one would be a receipt for something that never happened. `outcome` carries the reason
-- in exactly those cases.
--
-- The table is written by `undal-core` on `undal-realtime`'s behalf: realtime holds the
-- sockets and the service account, core holds the database (D86). Both columns that point
-- at other rows are nullable, because a dispatch outlives the order it announced and the
-- device it was addressed to, and a delivery record that vanishes with its subject cannot
-- answer "was this vendor ever reachable last week".

CREATE TABLE IF NOT EXISTS `fcm_dispatches` (
    id           BINARY(16)   PRIMARY KEY,
    order_id     BINARY(16)       NULL REFERENCES orders(id) ON DELETE SET NULL,
    device_id    BINARY(16)       NULL REFERENCES devices(id) ON DELETE SET NULL,
    fcm_token    VARCHAR(512) NOT NULL,
    attempt      TINYINT      NOT NULL,
    outcome      VARCHAR(24)  NOT NULL,
    message_id   VARCHAR(256)     NULL,
    sent_at      DATETIME(6)  NOT NULL,
    received_at  DATETIME(6)      NULL,
    created_at   DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    -- The three reads the panel makes: one order's attempts, one device token's record,
    -- and the receipt sweep that fills in `received_at` from the socket's `alarm_received`.
    INDEX idx_fcm_dispatches_order (order_id, sent_at),
    INDEX idx_fcm_dispatches_token (fcm_token, sent_at),
    INDEX idx_fcm_dispatches_receipt (sent_at, received_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
