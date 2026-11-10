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


def Uint8Array16(byte: int) -> bytes:
    """Sixteen identical bytes, as a `BINARY(16)` column reads back."""
    return bytes([byte]) * 16


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

    def fetchone(self) -> tuple:
        return (0,)


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


class HousekeepingTest(unittest.TestCase):
    """The nightly jobs, against a scripted cursor: a chain that breaks is a failure."""

    def test_a_broken_stored_link_is_reported_without_claiming_payload_proof(self) -> None:
        import housekeeping

        class Cursor(FakeCursor):
            def fetchall(self):  # noqa: ANN201
                return [(1, None, bytes([1]) * 32), (2, bytes([3]) * 32, bytes([2]) * 32)]

        connection = FakeConnection()
        connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
        report = housekeeping.audit_chain(connection)
        self.assertEqual(report["rows"], 2)
        self.assertEqual(report["status"], "BREAK")
        self.assertFalse(report["payloads_verified"])
        self.assertEqual(report["broken"][0]["reason"], "LINK")

    def test_the_chain_reproduces_the_shared_vectors(self) -> None:
        """The TypeScript writer and this verifier must agree, or one of them is wrong."""
        import hashlib
        import json as jsonlib

        import housekeeping

        root = Path(__file__).resolve().parents[2]
        vectors = jsonlib.loads((root / "db" / "fixtures" / "audit_chain_vectors.json").read_text(encoding="utf-8"))
        previous = b"\x00" * 32
        for vector in vectors["vectors"]:
            digest = hashlib.sha256(housekeeping.digest_input(vector["entry"]).encode("utf-8")).hexdigest()
            self.assertEqual(digest, vector["payloadDigestHex"])
            link = hashlib.sha256(previous + bytes.fromhex(digest)).hexdigest()
            self.assertEqual(link, vector["hashHex"])
            previous = bytes.fromhex(link)

    def test_an_orphan_count_is_a_failure(self) -> None:
        import housekeeping

        class Cursor(FakeCursor):
            def fetchone(self):  # noqa: ANN201
                return (3,)

        connection = FakeConnection()
        connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
        report = housekeeping.orphans(connection)
        self.assertEqual(report, {"order_items": 3, "order_state_events": 3, "order_offers": 3})

    def test_retention_is_a_read_only_count_and_deletion_is_disabled(self) -> None:
        import housekeeping

        dry = FakeConnection()
        housekeeping.retention(dry, apply=False)
        self.assertEqual(dry.commits, 0)
        self.assertTrue(all(statement.startswith("SELECT ") for statement in dry.executed))
        with self.assertRaisesRegex(RuntimeError, "disabled"):
            housekeeping.retention(dry, apply=True)
        self.assertFalse(any(statement.startswith("DELETE ") for statement in dry.executed))


class MigrationLedgerReadTest(unittest.TestCase):
    def test_only_missing_ledger_is_treated_as_fresh(self) -> None:
        class Cursor(FakeCursor):
            def execute(self, statement: str, params: tuple | None = None) -> None:
                raise RuntimeError(1146, "table does not exist")
        connection = FakeConnection()
        connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
        self.assertEqual(migrate.read_ledger(connection), {})

    def test_permissions_and_connection_errors_do_not_replay_all_migrations(self) -> None:
        for error in (RuntimeError(1044, "access denied"), RuntimeError(2006, "server gone"), TimeoutError("network")):
            class Cursor(FakeCursor):
                def execute(self, statement: str, params: tuple | None = None) -> None:
                    raise error
            connection = FakeConnection()
            connection.cursor = lambda: Cursor(connection)  # type: ignore[method-assign]
            with self.assertRaises(type(error)):
                migrate.read_ledger(connection)


class MigrationConnectionTest(unittest.TestCase):
    def test_uses_certificate_and_hostname_verifying_tls_context(self) -> None:
        import ssl
        import types
        from unittest.mock import patch

        captured: dict = {}
        fake = types.SimpleNamespace(connect=lambda **kwargs: captured.update(kwargs) or object())
        with patch.dict(sys.modules, {"pymysql": fake}):
            migrate.connect("mysql://reader:secret@db.example:4000/undal")
        context = captured["ssl"]
        self.assertIsInstance(context, ssl.SSLContext)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)
        self.assertFalse(captured["autocommit"])


class MigrationCliSafetyTest(unittest.TestCase):
    def test_custom_ledger_is_rejected_instead_of_silently_ignored(self) -> None:
        with self.assertRaisesRegex(SystemExit, "unsupported migration ledger"):
            migrate.main(["--dry-run", "--ledger", "other_ledger"])

    def test_retention_cli_is_read_only_without_any_flag(self) -> None:
        import contextlib
        import io
        import os
        import housekeeping
        from unittest.mock import patch

        connection = FakeConnection()
        with patch.dict(os.environ, {"TIDB_DATABASE_URL": "mysql://not-a-real-server"}), \
             patch.object(migrate, "connect", return_value=connection), \
             contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(housekeeping.main(["retention"]), 0)
        self.assertTrue(all(sql.startswith("SELECT ") for sql in connection.executed))
        self.assertEqual(connection.commits, 0)


if __name__ == "__main__":
    unittest.main()
