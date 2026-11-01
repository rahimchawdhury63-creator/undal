-- Undal — 004 menu.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- The catalogue: menus, items, variants and modifier groups. Prices are integer paisa, always.

CREATE TABLE IF NOT EXISTS `modifier_groups` (
    id              BINARY(16) PRIMARY KEY,
    vendor_id       BINARY(16)        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    name            VARCHAR(96)  NOT NULL,
    name_bn         VARCHAR(96),
    selection       VARCHAR(16)  NOT NULL CHECK (selection IN ('SINGLE','MULTIPLE')),
    min_select      SMALLINT        NOT NULL DEFAULT 0 CHECK (min_select >= 0),
    max_select      SMALLINT        NOT NULL DEFAULT 1 CHECK (max_select >= 1),
    is_required     TINYINT(1)        NOT NULL DEFAULT false,
    sort_order      BIGINT        NOT NULL DEFAULT 0,
    CHECK (max_select >= min_select),
    CHECK (NOT is_required OR min_select >= 1)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `menus` (
  `id`         BINARY(16)  NOT NULL,
  `vendor_id`  BINARY(16)  NOT NULL REFERENCES vendors(id),
  `name_en`    VARCHAR(80) NOT NULL DEFAULT 'Main menu',
  `name_bn`    VARCHAR(80) NOT NULL DEFAULT 'প্রধান মেনু',
  `active`     TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_menus_vendor` (`vendor_id`, `active`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `menu_sections` (
  `id`          BINARY(16)  NOT NULL,
  `menu_id`     BINARY(16)  NOT NULL REFERENCES menus(id),
  `name_en`     VARCHAR(80) NOT NULL,
  `name_bn`     VARCHAR(80) NOT NULL,
  `sort_order`  INT         NOT NULL DEFAULT 0,
  `active`      TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_menu_sections_menu` (`menu_id`, `active`, `sort_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `modifiers` (
  `id`             BINARY(16)   NOT NULL,
  `group_id`       BINARY(16)   NOT NULL REFERENCES modifier_groups(id),
  `name_en`        VARCHAR(60)  NOT NULL,
  `name_bn`        VARCHAR(60)  NOT NULL,
  `price_delta_paisa` BIGINT    NOT NULL DEFAULT 0,
  `available`      TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_modifiers_group` (`group_id`, `available`, `sort_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `tags` (
  `id`         BINARY(16)  NOT NULL,
  `slug`       VARCHAR(40) NOT NULL,
  `name_en`    VARCHAR(40) NOT NULL,
  `name_bn`    VARCHAR(40) NOT NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tags_slug` (`slug`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `menu_items` (
    id                  BINARY(16) PRIMARY KEY,
    vendor_id           BINARY(16)        NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    section_id          BINARY(16)        NOT NULL REFERENCES menu_sections(id) ON DELETE CASCADE,
    name                VARCHAR(128) NOT NULL,
    name_bn             VARCHAR(128),
    description         VARCHAR(600),
    description_bn      VARCHAR(600),
    price_paisa         BIGINT        NOT NULL CHECK (price_paisa >= 0),
    compare_at_paisa    BIGINT        CHECK (compare_at_paisa IS NULL OR compare_at_paisa > price_paisa),
    image_url           VARCHAR(512),
    image_blurhash      VARCHAR(48),
    image_is_cutout     TINYINT(1)        NOT NULL DEFAULT false,  -- drives the overflow treatment (doc 03 §10)
    prep_time_s         BIGINT        NOT NULL DEFAULT 600,
    calories            BIGINT,
    spice_level         SMALLINT        CHECK (spice_level BETWEEN 0 AND 3),
    is_vegetarian       TINYINT(1)        NOT NULL DEFAULT false,
    is_halal            TINYINT(1)        NOT NULL DEFAULT true,
    contains_allergens  JSON        NOT NULL,   -- array of allergen codes; '[]' when none
    availability        VARCHAR(16)  NOT NULL DEFAULT 'AVAILABLE'
        CHECK (availability IN ('AVAILABLE','SOLD_OUT','HIDDEN','SCHEDULED')),
    sold_out_until      DATETIME(6),
    sort_order          BIGINT        NOT NULL DEFAULT 0,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at          DATETIME(6),

    INDEX idx_items_vendor_section (vendor_id, section_id, sort_order, deleted_at),
    INDEX idx_items_availability (vendor_id, availability, deleted_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_variants` (
  `id`            BINARY(16)   NOT NULL,
  `item_id`       BINARY(16)   NOT NULL REFERENCES menu_items(id),
  `name_en`       VARCHAR(60)  NOT NULL,
  `name_bn`       VARCHAR(60)  NOT NULL,
  `price_paisa`   BIGINT       NOT NULL CHECK (`price_paisa` >= 0),
  `is_default`    TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`    INT          NOT NULL DEFAULT 0,
  `created_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`    DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_item_variants_item` (`item_id`, `sort_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_modifier_groups` (
  `id`         BINARY(16)  NOT NULL,
  `item_id`    BINARY(16)  NOT NULL REFERENCES menu_items(id),
  `group_id`   BINARY(16)  NOT NULL REFERENCES modifier_groups(id),
  `sort_order` INT         NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_modifier_group` (`item_id`, `group_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_availability` (
  `id`         BINARY(16)  NOT NULL,
  `item_id`    BINARY(16)  NOT NULL REFERENCES menu_items(id),
  `weekday`    TINYINT         NULL CHECK (`weekday` BETWEEN 0 AND 6),
  `starts_at`  TIME            NULL,
  `ends_at`    TIME            NULL,
  `available`  TINYINT(1)  NOT NULL DEFAULT 1,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_item_availability_item` (`item_id`, `weekday`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_tags` (
  `id`        BINARY(16)  NOT NULL,
  `item_id`   BINARY(16)  NOT NULL REFERENCES menu_items(id),
  `tag_id`    BINARY(16)  NOT NULL REFERENCES tags(id),
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_tag` (`item_id`, `tag_id`),
  KEY `idx_item_tags_tag` (`tag_id`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_stats` (
  `id`              BINARY(16)  NOT NULL,
  `item_id`         BINARY(16)  NOT NULL REFERENCES menu_items(id),
  `stat_date`       DATE        NOT NULL,
  `orders_count`    INT         NOT NULL DEFAULT 0 CHECK (`orders_count` >= 0),
  `quantity_sold`   INT         NOT NULL DEFAULT 0 CHECK (`quantity_sold` >= 0),
  `revenue_paisa`   BIGINT      NOT NULL DEFAULT 0 CHECK (`revenue_paisa` >= 0),
  `sold_out_minutes` INT        NOT NULL DEFAULT 0,
  `created_at`      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_stats_day` (`item_id`, `stat_date`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `item_media` (
  `id`         BINARY(16)  NOT NULL,
  `item_id`    BINARY(16)  NOT NULL REFERENCES menu_items(id),
  `media_id`   BINARY(16)  NOT NULL,
  `kind`       VARCHAR(16) NOT NULL DEFAULT 'PHOTO' CHECK (`kind` IN ('PHOTO','THUMBNAIL')),
  `sort_order` INT         NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_media` (`item_id`, `media_id`),
  KEY `idx_item_media_order` (`item_id`, `kind`, `sort_order`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
