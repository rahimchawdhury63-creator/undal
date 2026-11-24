-- Undal — 000 smoke. Licensed under PASVL-1.0.
--
-- The first migration and the only one that proves the connection works before
-- anything else assumes it: it creates the migration ledger itself, then a
-- canary table with one row whose timestamp must come back in UTC. If a
-- connection is running with the server's local time zone, the canary answers
-- with a Dhaka wall clock and the whole run stops here rather than six months
-- later inside an invoice.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version`         VARCHAR(16)   NOT NULL,
  `statement_index` INT           NOT NULL,
  `checksum`        VARBINARY(32) NOT NULL,
  `applied_at`      DATETIME(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `applied_by`      VARCHAR(128)  NOT NULL,
  PRIMARY KEY (`version`, `statement_index`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `_smoke` (
  `id`         BINARY(16)  NOT NULL,
  -- schema-data: one canary row, not business data. It exists so `migrate` can
  -- prove a write reaches the server and comes back with a UTC timestamp.
  `note`       VARCHAR(64) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
