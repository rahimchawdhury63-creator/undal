--
-- Undal — the rider who cannot settle, and what the platform does about it. Licensed under PASVL-1.0.
--
-- `25 §7` opens with a screen and four buttons: "I was robbed or lost the money", "I have an emergency", "I disagree
-- with this amount", "I'll settle part of it now". The section's closing line is the design rule those buttons encode —
-- "The block exists to collect money from people who have it and are about to go home — not to punish people who do not"
-- — and until now the platform had no way to hear any of it. A rider robbed at 11 pm could submit a settlement they
-- could not pay, or stay blocked.
--
-- This table is the hearing. One row is one declaration: what the rider said, when, and what the platform did about it.
-- It is a table rather than a column on `riders` for three reasons the specification states directly: the emergency path
-- is "limited to once per 30 days", which is a query over history rather than a flag; every path is "logged", and a
-- log that lives in a column holds one entry; and a declaration is evidence a human will read later, so it needs its
-- own id in the audit chain's `resource_id`.
--
-- `kind` is a closed list of the three declarations that matter to cash. The fourth button in `§7` — "I'll settle part of
-- it now" — is not a declaration at all: it is a settlement for less than the balance, which is a different route and a
-- different table.
--
-- `lifted_until` is the contract with the block. A declaration that lifts it writes the instant the lift ends — 24 hours
-- for an emergency, `NULL` for a path that opens a case and holds the lift until a human closes it — and the door and
-- the read both compute the rider's state from it the same way they compute the two-hour rule (D142) and an escalation
-- (D146). `NULL` therefore means "lifted with no expiry", not "not lifted": a robbed rider is not put back behind the
-- block at midnight by a timer.
--
-- `routed_to_review` marks the second emergency inside the window. `§7` says that use "routes to a human instead of being
-- refused", so it still lifts — every path in `§7` lifts — and the flag is what a reviewer sorts by in the morning.

CREATE TABLE IF NOT EXISTS `rider_cash_declarations` (
  `id`               BINARY(16)  NOT NULL,
  `rider_id`         BINARY(16)  NOT NULL REFERENCES riders(id),
  `kind`             VARCHAR(16) NOT NULL CHECK (`kind` IN ('EMERGENCY','ROBBED','DISPUTE')),
  `note`             VARCHAR(280)    NULL,
  `lifted_until`     DATETIME(6)     NULL,
  `routed_to_review` TINYINT(1)  NOT NULL DEFAULT 0,
  `created_at`       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cash_declaration_rider` (`rider_id`, `kind`, `created_at` DESC),
  KEY `idx_cash_declaration_review` (`routed_to_review`, `created_at` DESC)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
