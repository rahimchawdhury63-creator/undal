"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The migration runner, tested against a fake connection.

Statement-level resume is the whole design, and the failure it prevents is the
expensive one: a migration that fails on statement 7 of 12 must resume at 7, not
re-run the first six into a schema that half-exists.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import migrate  # noqa: E402


class FakeCursor:
    def __init__(self, connection: "FakeConnection") -> None:
        self.connection = connection
        self.rows: list[tuple] = []
        self.rowcount = 0

    def __enter__(self) -> "FakeCursor":
        return self

    def __exit__(self, *exc: object) -> None:
        return None

    def execute(self, statement: str, params: tuple | None = None) -> None:
        self.connection.executed.append(statement)
        if params is not None and "INSERT INTO" in statement:
            self.connection.ledger.append(params)

    def fetchall(self) -> list[tuple]:
        return self.rows


class FakeConnection:
    """Records statements; fails on demand so the resume path can be exercised."""

    def __init__(self, fail_on: str | None = None) -> None:
        self.executed: list[str] = []
        self.ledger: list[tuple] = []
        self.commits = 0
        self.fail_on = fail_on

    def cursor(self) -> FakeCursor:
        return FakeCursor(self)

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        return None


def write(directory: Path, name: str, sql: str) -> None:
    (directory / name).write_text(sql, encoding="utf-8")


class MigrationRunnerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        write(self.directory, "001_a.sql", "CREATE TABLE IF NOT EXISTS `a` (`id` BINARY(16));")
        write(
            self.directory,
            "002_b.sql",
            "CREATE TABLE IF NOT EXISTS `b` (`id` BINARY(16));\n"
            "ALTER TABLE `b` ADD CONSTRAINT `chk_b` CHECK (`id` IS NOT NULL);",
        )

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_plan_covers_every_statement_in_filename_order(self) -> None:
        plan = migrate.build_plan(self.directory, {}, dry_run=True)
        self.assertEqual(len(plan), 3)
        self.assertEqual([step.version for step in plan], ["001_a", "002_b", "002_b"])
        self.assertEqual([step.statement_index for step in plan], [1, 1, 2])

    def test_applied_statements_are_skipped_on_a_second_run(self) -> None:
        first = FakeConnection()
        plan = migrate.build_plan(self.directory, {}, dry_run=False)
        migrate.apply(first, plan, "run-1")
        self.assertEqual(len(first.ledger), 3)

        applied = {version: {} for version in ("001_a", "002_b")}
        for version, index, checksum, _ in first.ledger:
            applied[version][index] = checksum
        second = migrate.build_plan(self.directory, applied, dry_run=False)
        self.assertEqual(second, [])

    def test_a_partially_applied_file_resumes_at_the_first_missing_statement(self) -> None:
        applied = {"001_a": {1: migrate._checksum_bytes(migrate.read_migration(self.directory / "001_a.sql")[0])}}
        plan = migrate.build_plan(self.directory, applied, dry_run=False)
        self.assertEqual([(step.version, step.statement_index) for step in plan], [("002_b", 1), ("002_b", 2)])

    def test_a_tampered_migration_is_refused(self) -> None:
        checksum = migrate.read_migration(self.directory / "001_a.sql")[0]
        write(self.directory, "001_a.sql", "CREATE TABLE IF NOT EXISTS `a` (`id` BINARY(16), `x` INT);")
        applied = {"001_a": {1: migrate._checksum_bytes(checksum)}}
        with self.assertRaises(SystemExit):
            migrate.build_plan(self.directory, applied, dry_run=False)

    def test_every_statement_gets_its_own_ledger_row_and_commit(self) -> None:
        connection = FakeConnection()
        plan = migrate.build_plan(self.directory, {}, dry_run=False)
        count = migrate.apply(connection, plan, "actions/run/1")
        self.assertEqual(count, 3)
        self.assertEqual(connection.commits, 3)
        self.assertEqual([row[0] for row in connection.ledger], ["001_a", "002_b", "002_b"])
        self.assertTrue(all(row[3] == "actions/run/1" for row in connection.ledger))

    def test_the_connection_pins_utc(self) -> None:
        connection = FakeConnection()
        migrate.apply(connection, [], "run")
        self.assertIn("SET time_zone = '+00:00'", connection.executed)


if __name__ == "__main__":
    unittest.main()


class HousekeepingTest(unittest.TestCase):
    """The nightly jobs, against a scripted cursor: a chain that breaks is a failure."""

    def test_a_link_that_does_not_recompute_is_reported(self) -> None:
        import hashlib

        import housekeeping

        payload = hashlib.sha256(b"row-1").digest()
        good = hashlib.sha256(b"\x00" * 32 + payload).digest()

        class Cursor(FakeCursor):
            def fetchall(self):  # noqa: ANN201
                return [(1, b"\x00" * 32, good, payload), (2, b"\x11" * 32, b"\x22" * 32, payload)]

        connection = FakeConnection()
        connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
        report = housekeeping.audit_chain(connection)
        self.assertEqual(report["rows"], 2)
        self.assertEqual([entry["seq"] for entry in report["broken"]], [2])

    def test_an_orphan_count_is_a_failure(self) -> None:
        import housekeeping

        class Cursor(FakeCursor):
            def fetchone(self):  # noqa: ANN201
                return (3,)

        connection = FakeConnection()
        connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
        report = housekeeping.orphans(connection)
        self.assertEqual(report, {"order_items": 3, "order_state_events": 3, "order_offers": 3})

    def test_retention_commits_only_when_applying(self) -> None:
        import housekeeping

        dry = FakeConnection()
        housekeeping.retention(dry, apply=False)
        self.assertEqual(dry.commits, 0)

        live = FakeConnection()
        housekeeping.retention(live, apply=True)
        self.assertGreaterEqual(live.commits, 1)
