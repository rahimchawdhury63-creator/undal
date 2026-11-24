-- Undal — 002 geography.sql
-- Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
--
-- Statement-level idempotent: every statement carries IF NOT EXISTS, so TiDB's
-- auto-committing DDL can be re-run after a failure without a rollback story.
-- Applied in filename order; recorded in `schema_migrations`.
--
-- Zones and addresses before anything that is delivered. `cell_id` is a generated column, not a column the app writes.

CREATE TABLE IF NOT EXISTS `zones` (
    id              BINARY(16) PRIMARY KEY,
    code            VARCHAR(24)  NOT NULL UNIQUE,   -- 'SYL-CENTRAL'
    name            VARCHAR(96)  NOT NULL,
    name_bn         VARCHAR(96)  NOT NULL,
    country         VARCHAR(2)   NOT NULL DEFAULT 'BD',
    city            VARCHAR(64)  NOT NULL,
    currency        VARCHAR(3)   NOT NULL DEFAULT 'BDT',
    timezone        VARCHAR(48)  NOT NULL DEFAULT 'Asia/Dhaka',
    status          VARCHAR(16)  NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT','ACTIVE','PAUSED','RETIRED')),
    -- Geometry. TiDB has no spatial types, so a zone's shape is a GeoJSON ring and
    -- every hot predicate is an integer comparison. Design and parity test: §4.1.
    polygon         JSON        NOT NULL,   -- closed ring, [[lon_e7, lat_e7], ...]
    polygon_version BIGINT      NOT NULL DEFAULT 1,
    bbox_min_lat_e7 INT         NOT NULL,
    bbox_max_lat_e7 INT         NOT NULL,
    bbox_min_lon_e7 INT         NOT NULL,
    bbox_max_lon_e7 INT         NOT NULL,
    centroid_lat_e7 INT         NOT NULL,
    centroid_lon_e7 INT         NOT NULL,
    area_sq_km      DOUBLE      NOT NULL,
    created_by      BINARY(16)        NOT NULL REFERENCES users(id),
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_zones_bbox (bbox_min_lat_e7, bbox_max_lat_e7, bbox_min_lon_e7, bbox_max_lon_e7),
    INDEX idx_zones_status (status)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `addresses` (
    id              BINARY(16) PRIMARY KEY,
    user_id         BINARY(16)        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label           VARCHAR(32)  NOT NULL DEFAULT 'OTHER'
        CHECK (label IN ('HOME','WORK','OTHER')),
    custom_label    VARCHAR(48),
    recipient_name  VARCHAR(96),
    recipient_phone VARCHAR(20),
    line1           VARCHAR(256) NOT NULL,
    line2           VARCHAR(256),
    landmark        VARCHAR(128),
    floor_flat      VARCHAR(64),
    area            VARCHAR(96),
    city            VARCHAR(64)  NOT NULL,
    postcode        VARCHAR(12),
    lat_e7          INT          NOT NULL,
    lon_e7          INT          NOT NULL,
    cell_id         BIGINT AS (FLOOR(lat_e7 / 44920) * 1000000 + FLOOR(lon_e7 / 49520)) STORED,
    zone_id         BINARY(16)        REFERENCES zones(id),
    delivery_note   VARCHAR(280),
    is_default      TINYINT(1)        NOT NULL DEFAULT false,
    created_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    deleted_at      DATETIME(6),

    INDEX idx_addresses_user (user_id, deleted_at),
    INDEX idx_addresses_cell (cell_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `cell_zone` (
    cell_id         BIGINT     NOT NULL,
    zone_id         BINARY(16) NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    coverage        TINYINT(1) NOT NULL,   -- 1 = cell lies wholly inside, 0 = cell straddles an edge
    polygon_version BIGINT     NOT NULL,
    PRIMARY KEY (cell_id, zone_id),
    INDEX idx_cell_zone_zone (zone_id)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `zone_pricing` (
    id                      BINARY(16) PRIMARY KEY,
    zone_id                 BINARY(16) NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    vehicle                 VARCHAR(16) NOT NULL CHECK (vehicle IN ('MOTORBIKE','BICYCLE')),
    base_fare_paisa         BIGINT NOT NULL CHECK (base_fare_paisa >= 0),
    base_distance_m         BIGINT NOT NULL DEFAULT 2000,
    per_km_paisa            BIGINT NOT NULL CHECK (per_km_paisa >= 0),
    max_radius_m            BIGINT NOT NULL,
    min_payout_paisa        BIGINT NOT NULL,
    surge_cap_bps           BIGINT NOT NULL DEFAULT 22000,   -- 2.2x
    effective_from          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    effective_to            DATETIME(6),
    created_by              BINARY(16) NOT NULL REFERENCES users(id),

    INDEX idx_zone_pricing_lookup (zone_id, vehicle, effective_from DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `zone_polygons` (
  `id`          BINARY(16)  NOT NULL,
  `zone_id`     BINARY(16)  NOT NULL REFERENCES zones(id),
  `version`     INT         NOT NULL,
  `ring`        JSON        NOT NULL,   -- [[lat_e7, lon_e7], ...] closed, >= 3 corners
  `bbox_min_lat_e7` INT     NOT NULL,
  `bbox_min_lon_e7` INT     NOT NULL,
  `bbox_max_lat_e7` INT     NOT NULL,
  `bbox_max_lon_e7` INT     NOT NULL,
  `active`      TINYINT(1)  NOT NULL DEFAULT 1,
  `created_by`  BINARY(16)  NOT NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_zone_polygon_version` (`zone_id`, `version`),
  KEY `idx_zone_polygon_active` (`zone_id`, `active`, `version` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `zone_hours` (
  `id`          BINARY(16)  NOT NULL,
  `zone_id`     BINARY(16)  NOT NULL REFERENCES zones(id),
  `weekday`     TINYINT     NOT NULL CHECK (`weekday` BETWEEN 0 AND 6),
  `opens_at`    TIME        NOT NULL,
  `closes_at`   TIME        NOT NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_zone_hours` (`zone_id`, `weekday`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `address_labels` (
  `id`          BINARY(16)  NOT NULL,
  `user_id`     BINARY(16)  NOT NULL REFERENCES users(id),
  `label_en`    VARCHAR(40) NOT NULL,
  `label_bn`    VARCHAR(40) NOT NULL,
  `created_at`  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_address_label_user` (`user_id`, `label_en`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

CREATE TABLE IF NOT EXISTS `geocode_cache` (
  `id`             BINARY(16)   NOT NULL,
  `query_hash`     BINARY(32)   NOT NULL,   -- SHA-256 of the normalised query
  `query_text`     VARCHAR(255) NOT NULL,
  `lat_e7`         INT          NOT NULL,
  `lon_e7`         INT          NOT NULL,
  `cell_id`        BIGINT AS (FLOOR(`lat_e7` / 44920) * 1000000 + FLOOR(`lon_e7` / 49520)) STORED,
  `provider`       VARCHAR(16)  NOT NULL CHECK (`provider` IN ('NOMINATIM','MANUAL')),
  `hit_count`      INT          NOT NULL DEFAULT 0,
  `expires_at`     DATETIME(6)  NOT NULL,
  `created_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`     DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_geocode_query` (`query_hash`),
  KEY `idx_geocode_expiry` (`expires_at`)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
