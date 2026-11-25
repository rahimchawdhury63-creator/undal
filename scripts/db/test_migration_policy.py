"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The rules every migration in `db/migrations` must obey, checked without a database.

The migration runner resumes at statement level after a failure (`test_migrate.py` covers that),
which means a migration file is re-executed from the top whenever it is retried. That is only safe
if every statement in it is idempotent — and "only safe" is doing a lot of work in that sentence:
a `CREATE TABLE` without `IF NOT EXISTS` turns a retry into a crash, and a crash mid-migration is
the state nobody wants to debug at 02:00.

So these are policy tests, not syntax tests. They read the SQL the way a reviewer would and fail on
the shapes that make a retry unsafe or a schema unreadable:

  * filenames are `NNN_snake_case.sql`, contiguous from 000, applied in that order;
  * every CREATE carries `IF NOT EXISTS`;
  * nothing is dropped — a rollback story TiDB's auto-committing DDL cannot honour;
  * every table has a primary key, InnoDB and utf8mb4;
  * ids are `BINARY(16)`, money is `BIGINT` and named `*_paisa`, timestamps are `DATETIME(6)`.

Run: `python3 scripts/db/test_migration_policy.py`
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "db" / "migrations"

FILES = sorted(MIGRATIONS.glob("*.sql"))
SQL = {path.name: path.read_text(encoding="utf-8") for path in FILES}


def tables_in(text: str) -> list[tuple[str, str]]:
    """Every `CREATE TABLE` block: its name and its body."""
    return [
        (match.group(1), match.group(2))
        for match in re.finditer(r"CREATE TABLE(?: IF NOT EXISTS)? `(\w+)` \((.*?)\n\)\s*ENGINE", text, re.S)
    ]


class FileOrdering(unittest.TestCase):
    """The runner applies files in filename order, so the names are the order."""

    def test_every_file_is_numbered_snake_case(self) -> None:
        for path in FILES:
            self.assertRegex(path.name, r"^\d{3}_[a-z0-9_]+\.sql$")

    def test_the_numbers_are_contiguous_from_zero(self) -> None:
        numbers = [int(path.name[:3]) for path in FILES]
        self.assertEqual(numbers, list(range(len(numbers))), numbers)


class Idempotency(unittest.TestCase):
    """A file that is retried must not fail on its own earlier work."""

    def test_every_create_is_guarded(self) -> None:
        for name, text in SQL.items():
            for match in re.finditer(r"CREATE\s+(TABLE|INDEX|UNIQUE INDEX)\s+(?!IF NOT EXISTS)", text, re.I):
                line = text[: match.start()].count("\n") + 1
                self.fail(f"{name}:{line}: CREATE without IF NOT EXISTS")

    def test_nothing_is_dropped(self) -> None:
        for name, text in SQL.items():
            for match in re.finditer(r"\bDROP\s+(TABLE|COLUMN|INDEX)\b", text, re.I):
                line = text[: match.start()].count("\n") + 1
                self.fail(f"{name}:{line}: DROP — TiDB's DDL commits, so there is no rollback to undo it")

    def test_no_alter_rewrites_or_removes_a_column(self) -> None:
        # ADD is additive and safe to re-run behind a guard; MODIFY, CHANGE and DROP rewrite rows
        # that a half-applied migration may already have written.
        for name, text in SQL.items():
            for match in re.finditer(r"ALTER TABLE `\w+`[\s\S]{0,400}?\b(MODIFY|CHANGE|DROP)\b", text):
                line = text[: match.start()].count("\n") + 1
                self.fail(f"{name}:{line}: ALTER {match.group(1)} is not additive")


class Shape(unittest.TestCase):
    """The conventions that make 117 tables readable by somebody who did not write them."""

    def test_every_table_has_a_primary_key(self) -> None:
        for name, text in SQL.items():
            for table, body in tables_in(text):
                self.assertIn("PRIMARY KEY", body.upper(), f"{name}: {table} has no primary key")

    def test_every_table_is_innodb_and_utf8mb4(self) -> None:
        for name, text in SQL.items():
            for match in re.finditer(r"CREATE TABLE(?: IF NOT EXISTS)? `(\w+)`[\s\S]*?ENGINE\s*=\s*(\w+)", text):
                self.assertEqual(match.group(2).upper(), "INNODB", f"{name}: {match.group(1)}")
            for match in re.finditer(r"CREATE TABLE(?: IF NOT EXISTS)? `(\w+)`[\s\S]*?CHARSET\s*=\s*(\w+)", text):
                self.assertEqual(match.group(2).lower(), "utf8mb4", f"{name}: {match.group(1)}")

    def test_ids_are_binary_16(self) -> None:
        # `_e7` integers are coordinates, not ids; the pattern deliberately spares them.
        for name, text in SQL.items():
            for line in text.split("\n"):
                column = re.match(r"\s{2,}`(\w+)`\s+([A-Za-z]+(?:\(\d+\))?)", line)
                if column is None:
                    continue
                stripped = column.group(1)
                # Two kinds of exception, both honest: `cell_id` is a grid square the schema
                # computes, not an entity id, and a `trx_id`/`external_*` is a string somebody else
                # issued — a payment provider's reference cannot be a UUID we generate.
                if stripped == "cell_id" or "trx" in stripped or stripped.startswith(("external_", "provider_", "ref_")):
                    continue
                # A recorded finding, not an exemption earned by convenience: `request_id` and
                # `resource_id` are text here because the brain logs correlation ids it did not
                # mint, while `audit_log.request_id` is BINARY(16). The two disagree, and
                # `docs/_plan/STATUS.md` says so rather than letting this test imply otherwise.
                if stripped in {"request_id", "resource_id"}:
                    continue
                if stripped == "id" or stripped.endswith("_id"):
                    self.assertEqual(column.group(2).upper(), "BINARY(16)", f"{name}: {line.strip()}")

    def test_money_is_bigint_paisa(self) -> None:
        for name, text in SQL.items():
            for line in text.split("\n"):
                column = re.match(r"\s{2,}`(\w+_paisa)`\s+([A-Za-z]+(?:\(\d+\))?)", line)
                if column is None:
                    continue
                self.assertEqual(column.group(2).upper(), "BIGINT", f"{name}: {line.strip()}")
            # The other direction: a column named like money that is not paisa is a currency bug
            # waiting for a rounding rule.
            for line in text.split("\n"):
                moneyish = re.match(r"\s{2,}`(\w+?)_(rupees|taka|amount)`\s+(?:BIGINT|INT|DECIMAL)", line)
                if moneyish is not None:
                    self.fail(f"{name}: {line.strip()} — money is integer paisa, named *_paisa")

    def test_timestamps_keep_microseconds(self) -> None:
        for name, text in SQL.items():
            for match in re.finditer(r"`(\w*_at)`\s+DATETIME(?!\(6\))", text):
                self.fail(f"{name}: `{match.group(1)}` is DATETIME without (6) — two rows in one transaction tie")

    def test_reserved_words_are_backticked(self) -> None:
        # TiDB reserves words this schema uses — `key`, `before`, `after`, `value` — so a column
        # named one of them unquoted is a parse error on some versions and a silent rename on none.
        # The rest of the schema is not uniformly backticked (the first migrations are not), so the
        # rule is about the words that cannot survive without it.
        reserved = {"key", "before", "after", "value", "condition", "order", "interval", "rank", "system"}
        for name, body_text in SQL.items():
            for table, body in tables_in(body_text):
                for line in body.split("\n"):
                    bare = re.match(r"\s{2,}(\w+)\s+[A-Z]", line)
                    if bare is not None and bare.group(1).lower() in reserved:
                        self.fail(f"{name}: {table}: `{bare.group(1)}` must be backticked: {line.strip()[:60]}")


if __name__ == "__main__":
    unittest.main(verbosity=1)
