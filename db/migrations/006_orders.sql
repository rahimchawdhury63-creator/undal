-- Undal — 006 orders.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- The order core. `order_items` and `order_state_events` deliberately carry no foreign key to the order.

CREATE TABLE IF NOT EXISTS `orders` (
    id                      BINARY(16) PRIMARY KEY,
    code                    VARCHAR(16)  NOT NULL UNIQUE,  -- 'UND-7K2M9QX4'
    customer_user_id        BINARY(16)        NOT NULL REFERENCES users(id),
    vendor_id               BINARY(16)        NOT NULL REFERENCES vendors(id),
    zone_id                 BINARY(16)        NOT NULL REFERENCES zones(id),

    fulfilment              VARCHAR(16)  NOT NULL CHECK (fulfilment IN ('DELIVERY','PICKUP')),
    state                   VARCHAR(24)  NOT NULL
        CHECK (state IN ('DRAFT','PLACED','ACCEPTED','REJECTED','RIDER_SEARCH',
                         'RIDER_ASSIGNED','PICKED_UP','ARRIVED','DELIVERED','SETTLED',
                         'AUTO_CANCELLED','CANCELLED_BY_CUSTOMER','CANCELLED_BY_VENDOR',
                         'CANCELLED_BY_ADMIN','REASSIGNING','DISPUTED')),

    -- Addresses are snapshotted, never referenced, so a later edit cannot rewrite history.
    delivery_address_id     BINARY(16)        REFERENCES addresses(id),
    delivery_snapshot       JSON,
    delivery_lat_e7         INT,
    delivery_lon_e7         INT,
    pickup_lat_e7           INT          NOT NULL,
    pickup_lon_e7           INT          NOT NULL,

    -- Money. Every one of these is paisa. Every one.
    subtotal_paisa          BIGINT NOT NULL DEFAULT 0 CHECK (subtotal_paisa >= 0),
    discount_paisa          BIGINT NOT NULL DEFAULT 0 CHECK (discount_paisa >= 0),
    delivery_fee_paisa      BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_paisa >= 0),
    small_order_fee_paisa   BIGINT NOT NULL DEFAULT 0 CHECK (small_order_fee_paisa >= 0),
    tax_paisa               BIGINT NOT NULL DEFAULT 0 CHECK (tax_paisa >= 0),
    tip_paisa               BIGINT NOT NULL DEFAULT 0 CHECK (tip_paisa >= 0),
    rounding_paisa          BIGINT NOT NULL DEFAULT 0,          -- may be negative
    total_paisa             BIGINT NOT NULL DEFAULT 0 CHECK (total_paisa >= 0),

    commission_paisa        BIGINT NOT NULL DEFAULT 0,
    rider_bonus_paisa       BIGINT NOT NULL DEFAULT 0,
    rider_payout_paisa      BIGINT NOT NULL DEFAULT 0,
    vendor_payout_paisa     BIGINT NOT NULL DEFAULT 0,
    platform_revenue_paisa  BIGINT NOT NULL DEFAULT 0,

    -- Fare provenance, so an invoice can always explain itself.
    fare_source             VARCHAR(16) NOT NULL DEFAULT 'BRAIN'
        CHECK (fare_source IN ('BRAIN','FALLBACK','ADMIN_OVERRIDE')),
    fare_trace_id           BINARY(16),
    surge_bps               BIGINT NOT NULL DEFAULT 10000,
    weather_condition       VARCHAR(16) NOT NULL DEFAULT 'CLEAR',
    route_distance_m        BIGINT,
    route_duration_s        BIGINT,
    traffic_delay_s         BIGINT NOT NULL DEFAULT 0,
    distance_source         VARCHAR(16) NOT NULL DEFAULT 'OSRM'
        CHECK (distance_source IN ('OSRM','ESTIMATED')),

    -- Timing
    placed_at               DATETIME(6),
    accepted_at             DATETIME(6),
    prep_time_s             BIGINT,
    prep_time_source        VARCHAR(16) CHECK (prep_time_source IS NULL OR
                                prep_time_source IN ('SUGGESTED','VENDOR_SET','DEFAULT')),
    ready_at_estimate       DATETIME(6),
    assigned_at             DATETIME(6),
    picked_up_at            DATETIME(6),
    arrived_at              DATETIME(6),
    delivered_at            DATETIME(6),
    settled_at              DATETIME(6),
    eta_min_at_placement    DATETIME(6),
    eta_max_at_placement    DATETIME(6),

    rider_id                BINARY(16) REFERENCES riders(id),
    batch_id                BINARY(16) REFERENCES order_batches(id),

    customer_note           VARCHAR(280),
    payment_method          VARCHAR(16) NOT NULL DEFAULT 'COD' CHECK (payment_method = 'COD'),
    cash_collected_paisa    BIGINT,

    created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_orders_customer (customer_user_id, created_at DESC),
    INDEX idx_orders_vendor_state (vendor_id, state, created_at DESC),
    -- Three partial-index replacements, two of which are load-bearing.
    -- `live_zone_id` is what keeps the command map's index small as history
    -- accumulates; `settled_zone_id` is what keeps weekly invoicing off a scan.
    live_zone_id    BINARY(16) AS (IF(state NOT IN ('SETTLED','DRAFT'), zone_id, NULL)) STORED,
    settled_zone_id BINARY(16) AS (IF(state = 'SETTLED', zone_id, NULL)) STORED,

    INDEX idx_orders_rider (rider_id, created_at DESC),
    INDEX idx_orders_zone_live (live_zone_id, state),
    INDEX idx_orders_code (code),
    INDEX idx_orders_settlement (settled_zone_id, delivered_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_state_events` (
    id              BINARY(16) PRIMARY KEY,
    order_id        BINARY(16)        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    seq             BIGINT        NOT NULL,
    from_state      VARCHAR(24),
    to_state        VARCHAR(24)  NOT NULL,
    actor_type      VARCHAR(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SYSTEM')),
    actor_user_id   BINARY(16) REFERENCES users(id),
    reason_code     VARCHAR(48),
    reason_text     VARCHAR(512),
    metadata        JSON        NOT NULL,   -- undal-core always writes at least '{}'
    occurred_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_order_events_seq (order_id, seq),
    INDEX idx_order_events_order (order_id, occurred_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_items` (
  `id`             BINARY(16)   NOT NULL,
  `order_id`       BINARY(16)   NOT NULL,   -- deliberately no FK: the child outlives the parent's lock
  `item_id`        BINARY(16)   NOT NULL,
  `variant_id`     BINARY(16)       NULL,
  `seq`            INT          NOT NULL,
  `name_en`        VARCHAR(120) NOT NULL,   -- snapshot: a rename must not rewrite a paid order
  `name_bn`        VARCHAR(120) NOT NULL,
  `unit_price_paisa` BIGINT     NOT NULL CHECK (`unit_price_paisa` >= 0),
  `quantity`       INT          NOT NULL CHECK (`quantity` BETWEEN 1 AND 20),
  `line_total_paisa` BIGINT     NOT NULL CHECK (`line_total_paisa` >= 0),
  `notes`          VARCHAR(255)     NULL,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_items_seq` (`order_id`, `seq`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_item_modifiers` (
  `id`              BINARY(16)   NOT NULL,
  `order_item_id`   BINARY(16)   NOT NULL REFERENCES order_items(id),
  `modifier_id`     BINARY(16)       NULL,
  `name_en`         VARCHAR(80)  NOT NULL,
  `name_bn`         VARCHAR(80)  NOT NULL,
  `price_delta_paisa` BIGINT     NOT NULL DEFAULT 0,
  `created_at`      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_item_modifiers_item` (`order_item_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_fees` (
  `id`           BINARY(16)  NOT NULL,
  `order_id`     BINARY(16)  NOT NULL,
  `kind`         VARCHAR(24) NOT NULL CHECK (`kind` IN ('DELIVERY','SMALL_ORDER','SURGE','PLATFORM','PACKAGING','TIP','WEATHER')),
  `amount_paisa` BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `rate_bps`     INT             NULL,   -- the rate that produced it, so the fee is explainable
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_fees_order` (`order_id`, `kind`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_discounts` (
  `id`             BINARY(16)  NOT NULL,
  `order_id`       BINARY(16)  NOT NULL,
  `source`         VARCHAR(24) NOT NULL CHECK (`source` IN ('PROMO','CAMPAIGN','LOYALTY','REFERRAL','MANUAL')),
  `reference_id`   BINARY(16)      NULL,
  `amount_paisa`   BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `funded_by`      VARCHAR(16) NOT NULL CHECK (`funded_by` IN ('PLATFORM','VENDOR')),
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_discounts_order` (`order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_proofs` (
  `id`          BINARY(16)   NOT NULL,
  `order_id`    BINARY(16)   NOT NULL,
  `kind`        VARCHAR(24)  NOT NULL CHECK (`kind` IN ('PICKUP_QR','DELIVERY_PHOTO','HANDOVER_SELFIE','CUSTOMER_SIGNATURE')),
  `media_id`    BINARY(16)       NULL,
  `payload`     JSON             NULL,
  `lat_e7`      INT              NULL,
  `lon_e7`      INT              NULL,
  `captured_at` DATETIME(6)  NOT NULL,
  `created_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_proofs_order` (`order_id`, `kind`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_cancellations` (
  `id`            BINARY(16)   NOT NULL,
  `order_id`      BINARY(16)   NOT NULL,
  `actor_kind`    VARCHAR(16)  NOT NULL CHECK (`actor_kind` IN ('CUSTOMER','VENDOR','RIDER','ADMIN','SYSTEM')),
  `actor_id`      BINARY(16)       NULL,
  `reason_code`   VARCHAR(40)  NOT NULL,
  `reason_text`   VARCHAR(255)     NULL,
  `refund_paisa`  BIGINT       NOT NULL DEFAULT 0 CHECK (`refund_paisa` >= 0),
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_cancellation` (`order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_ratings` (
  `id`           BINARY(16)  NOT NULL,
  `order_id`     BINARY(16)  NOT NULL,
  `target`       VARCHAR(16) NOT NULL CHECK (`target` IN ('VENDOR','RIDER')),
  `stars`        TINYINT     NOT NULL CHECK (`stars` BETWEEN 1 AND 5),
  `comment`      VARCHAR(500)    NULL,
  `tags`         JSON            NULL,
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_order_rating_target` (`order_id`, `target`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_disputes` (
  `id`            BINARY(16)  NOT NULL,
  `order_id`      BINARY(16)  NOT NULL,
  `opened_by_kind` VARCHAR(16) NOT NULL CHECK (`opened_by_kind` IN ('CUSTOMER','VENDOR','RIDER','ADMIN')),
  `opened_by_id`  BINARY(16)      NULL,
  `kind`          VARCHAR(32) NOT NULL CHECK (`kind` IN ('WRONG_ITEM','MISSING_ITEM','COLD_FOOD','LATE','CASH_MISMATCH','DAMAGED','OTHER')),
  `status`        VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (`status` IN ('OPEN','INVESTIGATING','RESOLVED','REJECTED')),
  `resolution_paisa` BIGINT   NOT NULL DEFAULT 0 CHECK (`resolution_paisa` >= 0),
  `resolved_by`   BINARY(16)      NULL,
  `resolved_at`   DATETIME(6)     NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_order_disputes_status` (`status`, `created_at` DESC),
  KEY `idx_order_disputes_order` (`order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `order_dispute_messages` (
  `id`          BINARY(16)   NOT NULL,
  `dispute_id`  BINARY(16)   NOT NULL REFERENCES order_disputes(id),
  `author_kind` VARCHAR(16)  NOT NULL CHECK (`author_kind` IN ('CUSTOMER','VENDOR','RIDER','ADMIN')),
  `author_id`   BINARY(16)       NULL,
  `body`        VARCHAR(2000) NOT NULL,
  `media_id`    BINARY(16)       NULL,
  `created_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_dispute_messages_dispute` (`dispute_id`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
