-- Undal — 010 support.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Marketing, support and notification records. No promotional row can ever post to the ledger.

CREATE TABLE IF NOT EXISTS `promo_codes` (
  `id`              BINARY(16)   NOT NULL,
  `code`            VARCHAR(24)  NOT NULL,
  `kind`            VARCHAR(16)  NOT NULL CHECK (`kind` IN ('PERCENT','FLAT','FREE_DELIVERY')),
  `value_bps`       INT              NULL CHECK (`value_bps` BETWEEN 0 AND 10000),
  `value_paisa`     BIGINT           NULL CHECK (`value_paisa` >= 0),
  `min_subtotal_paisa` BIGINT    NOT NULL DEFAULT 0,
  `max_discount_paisa` BIGINT        NULL,
  `max_redemptions` INT              NULL,
  `per_user_limit`  INT          NOT NULL DEFAULT 1,
  `starts_at`       DATETIME(6)  NOT NULL,
  `ends_at`         DATETIME(6)      NULL,
  `zone_scope`      JSON             NULL,   -- NULL = global
  `active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`      BINARY(16)       NULL,
  `created_at`      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promo_code` (`code`),
  KEY `idx_promo_active_window` (`active`, `starts_at`, `ends_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `promo_redemptions` (
  `id`            BINARY(16)  NOT NULL,
  `promo_id`      BINARY(16)  NOT NULL REFERENCES promo_codes(id),
  `user_id`       BINARY(16)  NOT NULL REFERENCES users(id),
  `order_id`      BINARY(16)  NOT NULL,
  `discount_paisa` BIGINT     NOT NULL CHECK (`discount_paisa` >= 0),
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_promo_redemption_order` (`promo_id`, `order_id`),
  KEY `idx_promo_redemption_user` (`user_id`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `campaigns` (
  `id`          BINARY(16)   NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `kind`        VARCHAR(24)  NOT NULL CHECK (`kind` IN ('DISCOUNT','FREE_DELIVERY','BONUS','REFERRAL')),
  `starts_at`   DATETIME(6)  NOT NULL,
  `ends_at`     DATETIME(6)      NULL,
  `audience`    JSON             NULL,
  `active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `created_by`  BINARY(16)       NULL,
  `created_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`  DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_campaigns_window` (`active`, `starts_at`, `ends_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `campaign_budgets` (
  `id`             BINARY(16)  NOT NULL,
  `campaign_id`    BINARY(16)  NOT NULL REFERENCES campaigns(id),
  `budget_paisa`   BIGINT      NOT NULL CHECK (`budget_paisa` >= 0),
  `spent_paisa`    BIGINT      NOT NULL DEFAULT 0 CHECK (`spent_paisa` >= 0),
  `period`         VARCHAR(7)  NOT NULL,
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_budget_period` (`campaign_id`, `period`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `campaign_redemptions` (
  `id`           BINARY(16)  NOT NULL,
  `campaign_id`  BINARY(16)  NOT NULL REFERENCES campaigns(id),
  `order_id`     BINARY(16)  NOT NULL,
  `user_id`      BINARY(16)  NOT NULL REFERENCES users(id),
  `amount_paisa` BIGINT      NOT NULL CHECK (`amount_paisa` >= 0),
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_campaign_redemption_order` (`campaign_id`, `order_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `referrals` (
  `id`            BINARY(16)  NOT NULL,
  `referrer_id`   BINARY(16)  NOT NULL REFERENCES users(id),
  `referee_id`    BINARY(16)  NOT NULL REFERENCES users(id),
  `code`          VARCHAR(16) NOT NULL,
  `status`        VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (`status` IN ('PENDING','QUALIFIED','REWARDED','VOID')),
  `reward_paisa`  BIGINT      NOT NULL DEFAULT 0 CHECK (`reward_paisa` >= 0),
  `qualified_at`  DATETIME(6)     NULL,
  `created_at`    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_referral_referee` (`referee_id`),
  KEY `idx_referral_referrer` (`referrer_id`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `loyalty_tiers` (
  `id`               BINARY(16)   NOT NULL,
  `slug`             VARCHAR(24)  NOT NULL,
  `name_en`          VARCHAR(60)  NOT NULL,
  `name_bn`          VARCHAR(60)  NOT NULL,
  `min_orders`       INT          NOT NULL DEFAULT 0,
  `discount_bps`     INT          NOT NULL DEFAULT 0 CHECK (`discount_bps` BETWEEN 0 AND 2000),
  `free_delivery_over_paisa` BIGINT NOT NULL DEFAULT 0,
  `created_at`       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_loyalty_tier_slug` (`slug`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `customer_loyalty` (
  `id`             BINARY(16)  NOT NULL,
  `user_id`        BINARY(16)  NOT NULL REFERENCES users(id),
  `tier_id`        BINARY(16)  NOT NULL REFERENCES loyalty_tiers(id),
  `lifetime_orders` INT        NOT NULL DEFAULT 0,
  `lifetime_spend_paisa` BIGINT NOT NULL DEFAULT 0,
  `points`         INT         NOT NULL DEFAULT 0 CHECK (`points` >= 0),
  `created_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_loyalty_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `reminders` (
  `id`           BINARY(16)  NOT NULL,
  `user_id`      BINARY(16)  NOT NULL REFERENCES users(id),
  `kind`         VARCHAR(24) NOT NULL CHECK (`kind` IN ('CART_ABANDONED','RATING_PENDING','ORDER_AGAIN','CASH_DUE','SHIFT_START')),
  `due_at`       DATETIME(6) NOT NULL,
  `payload`      JSON            NULL,
  `status`       VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED' CHECK (`status` IN ('SCHEDULED','SENT','CANCELLED','FAILED')),
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_reminders_due` (`status`, `due_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `reminder_sends` (
  `id`          BINARY(16)  NOT NULL,
  `reminder_id` BINARY(16)  NOT NULL REFERENCES reminders(id),
  `channel`     VARCHAR(16) NOT NULL CHECK (`channel` IN ('FCM','SMS')),
  `sent_at`     DATETIME(6) NOT NULL,
  `outcome`     VARCHAR(16) NOT NULL CHECK (`outcome` IN ('DELIVERED','FAILED','SUPPRESSED')),
  `error`       VARCHAR(255)    NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_reminder_sends_reminder` (`reminder_id`, `sent_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `support_tickets` (
  `id`           BINARY(16)  NOT NULL,
  `subject`      VARCHAR(200) NOT NULL,
  `requester_kind` VARCHAR(16) NOT NULL CHECK (`requester_kind` IN ('CUSTOMER','VENDOR','RIDER','GUEST')),
  `requester_id` BINARY(16)      NULL,
  `order_id`     BINARY(16)      NULL,
  `priority`     VARCHAR(8)  NOT NULL DEFAULT 'NORMAL' CHECK (`priority` IN ('LOW','NORMAL','HIGH','URGENT')),
  `status`       VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (`status` IN ('OPEN','PENDING','RESOLVED','CLOSED')),
  `assignee_id`  BINARY(16)      NULL,
  `first_response_at` DATETIME(6) NULL,
  `resolved_at`  DATETIME(6)     NULL,
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_support_status` (`status`, `priority`, `created_at`),
  KEY `idx_support_assignee` (`assignee_id`, `status`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `support_messages` (
  `id`          BINARY(16)    NOT NULL,
  `ticket_id`   BINARY(16)    NOT NULL REFERENCES support_tickets(id),
  `author_kind` VARCHAR(16)   NOT NULL CHECK (`author_kind` IN ('CUSTOMER','VENDOR','RIDER','AGENT','SYSTEM')),
  `author_id`   BINARY(16)        NULL,
  `body`        VARCHAR(4000) NOT NULL,
  `internal`    TINYINT(1)    NOT NULL DEFAULT 0,
  `created_at`  DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_support_messages_ticket` (`ticket_id`, `created_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `exceptions` (
  `id`           BINARY(16)  NOT NULL,
  `kind`         VARCHAR(32) NOT NULL CHECK (`kind` IN ('STUCK_ORDER','CASH_SHORT','OFFER_LOOP','LATE_PICKUP','PAYOUT_FAILED','SCHEMA_DRIFT','AUDIT_GAP')),
  `severity`     VARCHAR(8)  NOT NULL DEFAULT 'WARN' CHECK (`severity` IN ('INFO','WARN','ERROR','CRITICAL')),
  `entity_kind`  VARCHAR(24)     NULL,
  `entity_id`    BINARY(16)      NULL,
  `detail`       JSON            NULL,
  `status`       VARCHAR(16) NOT NULL DEFAULT 'OPEN' CHECK (`status` IN ('OPEN','ACKNOWLEDGED','RESOLVED','IGNORED')),
  `resolved_by`  BINARY(16)      NULL,
  `resolved_at`  DATETIME(6)     NULL,
  `created_at`   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_exceptions_status` (`status`, `severity`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `notification_log` (
  `id`          BINARY(16)  NOT NULL,
  `user_id`     BINARY(16)      NULL,
  `rider_id`    BINARY(16)      NULL,
  `channel`     VARCHAR(16) NOT NULL CHECK (`channel` IN ('FCM','SMS','EMAIL')),
  `kind`        VARCHAR(32) NOT NULL,
  `entity_id`   BINARY(16)      NULL,
  `dedupe_key`  VARCHAR(80) NOT NULL,
  `outcome`     VARCHAR(16) NOT NULL CHECK (`outcome` IN ('SENT','DELIVERED','FAILED','SUPPRESSED')),
  `error`       VARCHAR(255)    NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_notification_dedupe` (`dedupe_key`),
  KEY `idx_notification_user` (`user_id`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
