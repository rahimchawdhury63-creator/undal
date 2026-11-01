-- Undal — session security. Licensed under PASVL-1.0.
--
-- Two tables the specification requires by behaviour but never named: refresh-token
-- rotation with family reuse detection (doc 27 §2.3), and the security event that
-- reuse raises. Both are DDL-only and idempotent like every other migration; the
-- indexes are the reads the auth middleware makes on every refresh, so they are
-- written here rather than added later by whoever notices the latency.

CREATE TABLE IF NOT EXISTS `refresh_tokens` (
    id              BINARY(16)   PRIMARY KEY,
    session_id      BINARY(16)   NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    -- Every rotation keeps the family id, which is how one replayed token can
    -- invalidate every descendant without walking a linked list at request time.
    family_id       BINARY(16)   NOT NULL,
    token_hash      BINARY(32)   NOT NULL,          -- SHA-256 of the opaque 256-bit token
    issued_at       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at      DATETIME(6)  NOT NULL,
    used_at         DATETIME(6)      NULL,          -- set on rotation; a second use is theft
    revoked_at      DATETIME(6)      NULL,
    revoked_reason  VARCHAR(48)      NULL,
    replaced_by     BINARY(16)       NULL,

    UNIQUE INDEX uq_refresh_token_hash (token_hash),
    INDEX idx_refresh_family (family_id, used_at),
    INDEX idx_refresh_session (session_id),
    INDEX idx_refresh_expiry (expires_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

-- `CHECK` here is documentation plus the generated validator (D43): TiDB parses it and
-- enforces nothing, and the middleware refuses an unknown kind before it writes.
CREATE TABLE IF NOT EXISTS `security_events` (
    id          BINARY(16)  PRIMARY KEY,
    kind        VARCHAR(32) NOT NULL
        CHECK (`kind` IN ('TOKEN_REUSE','STEP_UP_FAILED','LOCKOUT','DEVICE_MISMATCH',
                          'IMPERSONATION','PASSWORD_CHANGED','RBAC_CHANGED','RECOVERY_CODE_USED',
                          'SECRET_ROTATED','BREAK_GLASS')),
    severity    VARCHAR(8)  NOT NULL CHECK (`severity` IN ('INFO','NOTICE','WARNING','CRITICAL')),
    actor_id    BINARY(16)      NULL,
    subject_id  BINARY(16)      NULL,
    request_id  BINARY(16)  NOT NULL,
    ip          VARBINARY(16)   NULL,               -- INET6_ATON, IPv4 and IPv6 alike
    detail      JSON            NULL,
    created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),

    INDEX idx_security_kind_time (kind, created_at),
    INDEX idx_security_actor (actor_id, created_at)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
