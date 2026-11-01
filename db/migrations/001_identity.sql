-- Undal — 001 identity.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Identity comes first: every other table is owned by a person, a role or a device.

CREATE TABLE IF NOT EXISTS `users` (
    id              BINARY(16) PRIMARY KEY,
    phone           VARCHAR(20)  NOT NULL,
    phone_norm      VARCHAR(20)  NOT NULL,   -- E.164, +8801XXXXXXXXX
    email           VARCHAR(254),
    email_norm      VARCHAR(254),            -- lowercased, dots preserved
    password_hash   VARCHAR(255),            -- Argon2id; NULL only for OAuth-only accounts
    actor_type      VARCHAR(16)  NOT NULL
        CHECK (actor_type IN ('CUSTOMER','VENDOR_OWNER','RIDER','ADMIN')),
    status          VARCHAR(24)  NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE','SUSPENDED','PENDING_REVIEW','DEACTIVATED','BANNED')),
    locale          VARCHAR(5)   NOT NULL DEFAULT 'bn',
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at    DATETIME(6),
    deleted_at      DATETIME(6),

    CONSTRAINT uq_users_phone UNIQUE (phone_norm),
    INDEX idx_users_email (email_norm),
    INDEX idx_users_type_status (actor_type, status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `devices` (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform        VARCHAR(16)  NOT NULL CHECK (platform IN ('ANDROID','WEB')),
    fingerprint     VARCHAR(128) NOT NULL,   -- stable per install, not an advertising id
    model           VARCHAR(128),
    os_version      VARCHAR(32),
    app_version     VARCHAR(32),
    app_flavour     VARCHAR(16)  CHECK (app_flavour IN ('CUSTOMER','PARTNER','RIDER')),
    -- Battery-optimisation posture, needed by the alarm coaching flow (doc 15 §9)
    battery_opt_exempt      TINYINT(1),
    notifications_allowed   TINYINT(1),
    exact_alarm_allowed     TINYINT(1),
    full_screen_intent_allowed TINYINT(1),
    oem_autostart_prompted  TINYINT(1)        NOT NULL DEFAULT false,
    first_seen_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    last_seen_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    UNIQUE INDEX uq_devices_user_fp (user_id, fingerprint)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `device_tokens` (
    id              BINARY(16) PRIMARY KEY,
    device_id       BINARY(16)        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    fcm_token       VARCHAR(512) NOT NULL,
    valid           TINYINT(1)        NOT NULL DEFAULT true,
    invalidated_at  DATETIME(6),
    invalid_reason  VARCHAR(64),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    refreshed_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    -- Partial-index replacement. TiDB has no `INDEX ... WHERE`, so the predicate
    -- moves into a stored generated column and the index stays exactly as small.
    device_id_if_valid BINARY(16) AS (IF(valid, device_id, NULL)) STORED,

    UNIQUE INDEX uq_device_tokens_token (fcm_token),
    INDEX idx_device_tokens_device (device_id_if_valid)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `permissions` (
    `key`       VARCHAR(64) PRIMARY KEY,     -- 'order.reassign', 'finance.invoice.mark_paid'
    domain      VARCHAR(32) NOT NULL,
    description VARCHAR(256) NOT NULL,
    risk        VARCHAR(8)  NOT NULL CHECK (risk IN ('LOW','MEDIUM','HIGH','CRITICAL'))
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_roles` (
    id          BINARY(16) PRIMARY KEY,
    `key`       VARCHAR(48) NOT NULL UNIQUE,
    name        VARCHAR(96) NOT NULL,
    name_bn     VARCHAR(96) NOT NULL,
    is_system   TINYINT(1) NOT NULL DEFAULT false,   -- system roles cannot be deleted
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_role_permissions` (
    role_id         BINARY(16)   NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    permission_key  VARCHAR(64) NOT NULL REFERENCES permissions(`key`),
    PRIMARY KEY (role_id, permission_key)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_user_roles` (
    user_id     BINARY(16) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id     BINARY(16) NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
    zone_scope  JSON ,                     -- NULL = global; otherwise limited to these zones
    granted_by  BINARY(16) NOT NULL REFERENCES users(id),
    granted_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at  DATETIME(6),
    PRIMARY KEY (user_id, role_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `user_profiles` (
  `id`                BINARY(16)   NOT NULL,
  `user_id`           BINARY(16)   NOT NULL REFERENCES users(id),
  `display_name`      VARCHAR(80)  NOT NULL,
  `display_name_bn`   VARCHAR(80)      NULL,
  `avatar_media_id`   BINARY(16)       NULL,
  `locale`            VARCHAR(5)   NOT NULL DEFAULT 'bn' CHECK (`locale` IN ('bn','en')),
  `default_address_id` BINARY(16)      NULL,
  `marketing_opt_in`  TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`        DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_profiles_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `password_history` (
  `id`            BINARY(16)   NOT NULL,
  `user_id`       BINARY(16)   NOT NULL REFERENCES users(id),
  `password_hash` VARCHAR(255) NOT NULL,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_password_history_user_time` (`user_id`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`            BINARY(16)   NOT NULL,
  `phone`         VARCHAR(20)  NOT NULL,
  `ip_hash`       BINARY(32)   NOT NULL,
  `device_hash`   BINARY(32)   NOT NULL,
  `outcome`       VARCHAR(24)  NOT NULL CHECK (`outcome` IN ('SUCCESS','BAD_PASSWORD','LOCKED','UNKNOWN_USER','DEVICE_MISMATCH','TOTP_FAILED')),
  `failed_count`  INT          NOT NULL DEFAULT 0,
  `locked_until`  DATETIME(6)      NULL,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_login_attempts_phone_time` (`phone`, `created_at` DESC),
  KEY `idx_login_attempts_ip_time` (`ip_hash`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `oauth_identities` (
  `id`             BINARY(16)   NOT NULL,
  `user_id`        BINARY(16)   NOT NULL REFERENCES users(id),
  `provider`       VARCHAR(16)  NOT NULL CHECK (`provider` IN ('GOOGLE','FACEBOOK')),
  `provider_sub`   VARCHAR(191) NOT NULL,
  `email`          VARCHAR(255)     NULL,
  `email_verified` TINYINT(1)   NOT NULL DEFAULT 0,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_oauth_provider_sub` (`provider`, `provider_sub`),
  KEY `idx_oauth_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `totp_secrets` (
  `id`             BINARY(16)     NOT NULL,
  `user_id`        BINARY(16)     NOT NULL REFERENCES users(id),
  `secret_cipher`  VARBINARY(255) NOT NULL,
  `confirmed_at`   DATETIME(6)        NULL,
  `last_used_step` BIGINT         NOT NULL DEFAULT 0,
  `created_at`     DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_totp_user` (`user_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `recovery_codes` (
  `id`         BINARY(16)  NOT NULL,
  `user_id`    BINARY(16)  NOT NULL REFERENCES users(id),
  `code_hash`  BINARY(32)  NOT NULL,
  `used_at`    DATETIME(6)     NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recovery_code_hash` (`code_hash`),
  KEY `idx_recovery_user` (`user_id`, `used_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `sessions` (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      BINARY(32)  NOT NULL,   -- SHA-256 of the opaque bearer token
    device_id       BINARY(16)        NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    ip_created      VARCHAR(45)  NOT NULL,
    ua_created      VARCHAR(512) NOT NULL,
    issued_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at      DATETIME(6) NOT NULL,
    last_used_at    DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at      DATETIME(6),
    revoked_reason  VARCHAR(64),

    INDEX idx_sessions_user (user_id, revoked_at),
    UNIQUE INDEX uq_sessions_token (token_hash)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
