"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Tests for the SQL linter: that it joins what the code joins, and that it fails when it should.

The second half matters more. A schema checker that has only ever printed zero findings is
indistinguishable from a checker that reads nothing, so these tests feed it a statement naming
a column no migration created and require it to say so.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import lint_sql  # noqa: E402

try:
    from sqlglot.schema import MappingSchema
except ImportError:  # pragma: no cover - the skip is the point
    MappingSchema = None  # type: ignore[assignment]

DOCUMENT = json.loads(lint_sql.EXPECTED.read_text(encoding="utf-8"))
SCHEMA = lint_sql.schema_of(DOCUMENT)


@unittest.skipIf(MappingSchema is None, "sqlglot is not installed")
class StatementExtraction(unittest.TestCase):
    """What counts as one statement, and what is a statement plus an error message."""

    def setUp(self) -> None:
        self.directory = Path(self.id().replace(".", "_"))
        self.directory.mkdir(exist_ok=True)

    def tearDown(self) -> None:
        for path in self.directory.iterdir():
            path.unlink()
        self.directory.rmdir()

    def extract(self, source: str) -> list[str]:
        """Write a TypeScript fragment, then read the statements back out of it."""
        path = self.directory / "sample.ts"
        path.write_text(source, encoding="utf-8")
        return lint_sql.statements(path)

    def test_joins_a_concatenated_statement(self) -> None:
        found = self.extract('const a = "SELECT `id` FROM `zones` " + "WHERE `status` = ?";')
        self.assertEqual(found, ["SELECT `id` FROM `zones` WHERE `status` = ?"])

    def test_does_not_glue_a_following_error_code_onto_a_statement(self) -> None:
        found = self.extract(
            'const a = db.query("SELECT `id` FROM `zones`");\nconst code = "ZONE_NOT_FOUND";'
        )
        self.assertEqual(found, ["SELECT `id` FROM `zones`"])

    def test_ignores_a_statement_whose_tail_is_decided_at_run_time(self) -> None:
        found = self.extract('const a = "SELECT `id` FROM `zones` " + `WHERE ${where} ORDER BY id`;')
        self.assertEqual(found, [])

    def test_ignores_a_keyword_that_is_a_word_in_a_list(self) -> None:
        self.assertEqual(self.extract('const keys = ["delete", "update"];'), [])


@unittest.skipIf(MappingSchema is None, "sqlglot is not installed")
class SchemaValidation(unittest.TestCase):
    """The checks themselves, against the schema the migrations produce."""

    def setUp(self) -> None:
        self.mapping = MappingSchema(SCHEMA, dialect="mysql")

    def check(self, statement: str) -> list[str]:
        return lint_sql.findings_for(statement, SCHEMA, self.mapping)

    def test_accepts_a_statement_the_schema_allows(self) -> None:
        self.assertEqual(
            self.check("SELECT `o`.`state`, `o`.`total_paisa` FROM `orders` `o` WHERE `o`.`zone_id` = ?"),
            [],
        )

    def test_rejects_a_column_no_migration_created(self) -> None:
        # This is the mistake that shipped: `orders` has a `state`, not a `status`.
        findings = self.check("SELECT COUNT(*) AS `live` FROM `orders` WHERE `status` = 'PLACED'")
        self.assertEqual(len(findings), 1)
        self.assertIn("status", findings[0])

    def test_rejects_a_table_no_migration_created(self) -> None:
        findings = self.check("SELECT `id` FROM `zoness`")
        # Two findings, both honest: the table is not in the schema, and the column cannot be
        # resolved without it. The test asserts the table is named, not how many times.
        self.assertTrue(any("zoness" in finding for finding in findings), findings)

    def test_accepts_the_bind_marker_list_the_code_swaps_in(self) -> None:
        self.assertEqual(
            self.check("SELECT `rider_id` FROM `rider_stats` WHERE `rider_id` IN (IDS) GROUP BY `rider_id`"),
            [],
        )


if __name__ == "__main__":
    unittest.main(verbosity=2)
