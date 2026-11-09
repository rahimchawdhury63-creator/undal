"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Regression tests for migration-derived column expectations and drift comparison.
"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import expected
import verify_schema


class SchemaExtractorTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, name: str, text: str) -> None:
        (self.directory / name).write_text(text, encoding="utf-8")

    def test_quoted_unquoted_multiline_generated_and_alter(self) -> None:
        self.write("001.sql", """
            CREATE TABLE IF NOT EXISTS `example` (
                id BINARY(16) PRIMARY KEY,
                `label` VARCHAR(40) DEFAULT 'one,two',
                amount BIGINT NOT NULL CHECK (amount IN (1, 2)),
                value INT AS (IF(amount > 1, 2, 3)) STORED,
                INDEX idx_amount (amount),
                CONSTRAINT chk_amount CHECK (amount >= 0)
            ) ENGINE = InnoDB;
            ALTER TABLE `example` ADD COLUMN next_value
              BIGINT AS (IF(amount > 0, 1, 0)) STORED,
              ADD COLUMN `extra` TINYINT(1) NULL, ADD INDEX `extra_ix` (`extra`);
        """)
        table = expected.build(self.directory)["tables"]["example"]
        self.assertEqual(table["columns"], [
            {"name": "id", "type": "BINARY(16)"}, {"name": "label", "type": "VARCHAR(40)"},
            {"name": "amount", "type": "BIGINT"}, {"name": "value", "type": "INT"},
            {"name": "next_value", "type": "BIGINT"}, {"name": "extra", "type": "TINYINT(1)"},
        ])
        self.assertEqual(table["generated"], ["value", "next_value"])

    def test_unsupported_column_or_schema_change_is_a_failure(self) -> None:
        for statement in [
            "CREATE TABLE IF NOT EXISTS `x` (id SOMETHING NOT NULL) ENGINE = InnoDB;",
            "CREATE TABLE IF NOT EXISTS `x` (id BIGINT) ENGINE = InnoDB; ALTER TABLE `x` DROP COLUMN id;",
            "CREATE TABLE IF NOT EXISTS `x` (id BIGINT) ENGINE = InnoDB; ALTER TABLE `x` MODIFY COLUMN id INT;",
            "CREATE TABLE `x` (id BIGINT);",
        ]:
            self.write("001.sql", statement)
            with self.assertRaises(SystemExit):
                expected.build(self.directory)

    def test_duplicate_and_empty_definitions_fail(self) -> None:
        for statement in [
            "CREATE TABLE IF NOT EXISTS `x` (id BIGINT, `id` INT) ENGINE = InnoDB;",
            "CREATE TABLE IF NOT EXISTS `x` (PRIMARY KEY (`id`)) ENGINE = InnoDB;",
            "CREATE TABLE IF NOT EXISTS `x` (id BIGINT) ENGINE = InnoDB; ALTER TABLE `x` ADD COLUMN id INT;",
            "CREATE TABLE IF NOT EXISTS `x` (id BIGINT,, x INT) ENGINE = InnoDB;",
        ]:
            self.write("001.sql", statement)
            with self.assertRaises(SystemExit):
                expected.build(self.directory)

    def test_repository_ledger_and_audit_columns_are_complete(self) -> None:
        tables = expected.build()["tables"]
        self.assertEqual([c["name"] for c in tables["ledger_entries"]["columns"]],
                         ["id", "entry_type", "order_id", "invoice_id", "settlement_id", "description", "occurred_at", "created_at", "created_by", "reverses_id"])
        self.assertEqual(len(tables["ledger_accounts"]["columns"]), 7)
        self.assertEqual(len(tables["ledger_postings"]["columns"]), 5)
        self.assertEqual(len(tables["audit_log"]["columns"]), 19)
        self.assertIn("delivery_cell", tables["orders"]["generated"])
        self.assertTrue(all(table["columns"] for table in tables.values()))


class SchemaCompareTest(unittest.TestCase):
    def test_missing_extra_and_type_drift_are_reported(self) -> None:
        expected_doc = {"tables": {"x": {"columns": [{"name": "id", "type": "BIGINT"},
                                                        {"name": "amount", "type": "BIGINT UNSIGNED"},
                                                        {"name": "name", "type": "VARCHAR(10)"}]}}}
        live = {"x": {"id": "bigint(20)", "amount": "bigint(20)", "unknown": "INT"}, "other": {"id": "INT"}}
        problems = verify_schema.compare(expected_doc, live)
        self.assertEqual(len(problems), 4)
        self.assertTrue(any("type drift `x`.`amount`" in item for item in problems))
        self.assertTrue(any("missing column `x`.`name`" in item for item in problems))
        self.assertTrue(any("unexpected column `x`.`unknown`" in item for item in problems))
        self.assertTrue(any("unexpected table `other`" in item for item in problems))

    def test_type_normalization_preserves_real_sizes_and_signedness(self) -> None:
        self.assertEqual(verify_schema.canonical_type("bigint(20) unsigned"), "BIGINT UNSIGNED")
        self.assertEqual(verify_schema.canonical_type("integer(11)"), "INT")
        self.assertEqual(verify_schema.canonical_type("tinyint(1)"), "TINYINT")
        self.assertNotEqual(verify_schema.canonical_type("VARCHAR(20)"), verify_schema.canonical_type("VARCHAR(40)"))
        self.assertNotEqual(verify_schema.canonical_type("BIGINT UNSIGNED"), verify_schema.canonical_type("BIGINT"))
        self.assertNotEqual(verify_schema.canonical_type("DATETIME(6)"), verify_schema.canonical_type("DATETIME"))

    def test_complete_inventory_detects_missing_ledger_column(self) -> None:
        doc = expected.build()
        live = {name: {col["name"]: col["type"] for col in table["columns"]}
                for name, table in doc["tables"].items()}
        self.assertEqual(verify_schema.compare(doc, live), [])
        del live["ledger_postings"]["amount_paisa"]
        problems = verify_schema.compare(doc, live)
        self.assertEqual(problems, ["missing column `ledger_postings`.`amount_paisa`"])

    def test_missing_table_and_empty_expectations_are_not_success(self) -> None:
        doc = {"tables": {"x": {"columns": [{"name": "id", "type": "INT"}]}, "y": {"columns": []}}}
        self.assertEqual(len(verify_schema.compare(doc, {})), 2)


if __name__ == "__main__":
    unittest.main()
