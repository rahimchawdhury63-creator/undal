#!/usr/bin/env python3
"""Validate Undal's prompt documents, not an implementation of the platform.

Checks use the Python standard library and never call external services. Financial
arithmetic below checks the specification's illustrative vectors only; it neither
approves a legal policy nor tests real application code, invoices, or transfers.
"""

from __future__ import annotations

import csv
import hashlib
import re
import sys
from collections import Counter, defaultdict
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs" / "undal"
ANNEXES = (
    "01-reference-analysis.md",
    "02-product-requirements.md",
    "03-system-architecture.md",
    "04-finance-and-algorithms.md",
    "05-security-and-android.md",
    "06-deployment-and-operations.md",
    "07-delivery-plan-and-acceptance.md",
    "08-feasibility-and-sources.md",
)
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
EXPECTED_COUNTS = {"C": 41, "W": 24, "P": 53, "R": 12}
EXPECTED_DUPLICATES = {
    frozenset(pair)
    for pair in (
        ("P47", "R04"),
        ("P48", "R05"),
        ("P49", "R06"),
        ("P50", "R07"),
        ("P51", "R08"),
        ("P52", "R11"),
    )
}
FAILURES: list[str] = []
PASSES: list[str] = []


def require(condition: bool, description: str) -> None:
    """Collect all failures so a single run gives a useful repair list."""
    if not condition:
        FAILURES.append(description)


def check_documents() -> None:
    """Check required files, safe local links, maintained-file size, and secrets."""
    required = [ROOT / "README.md", ROOT / "UNDAL_BUILD_PROMPT.md"]
    required += [DOCS / name for name in ANNEXES]
    required += [DOCS / "github-actions.env.example", DOCS / "reference-inventory.tsv"]
    for path in required:
        require(path.is_file(), f"Missing required file: {path.relative_to(ROOT)}")
    if any(not path.is_file() for path in required):
        return

    maintained = required + [ROOT / ".gitignore", Path(__file__).resolve()]
    for path in maintained:
        text = path.read_text(encoding="utf-8")
        require(len(text.splitlines()) <= 500, f"Over 500 lines: {path.name}")
        require(text.endswith("\n"), f"Missing final newline: {path.name}")
        require(all(line == line.rstrip() for line in text.splitlines()),
                f"Trailing whitespace: {path.name}")
        require("\x00" not in text, f"Unexpected NUL byte in {path.name}")
        require(
            not re.search(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----", text),
            f"Possible private key in {path.name}",
        )
        require(
            not re.search(r"IMGBB_API_KEY\s*=\s*['\"]?[0-9a-fA-F]{32}\b", text),
            f"Possible embedded imgbb credential in {path.name}",
        )

    markdown = [path for path in required if path.suffix == ".md"]
    for path in markdown:
        for target in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", path.read_text()):
            parsed = urlsplit(target)
            if parsed.scheme or target.startswith("#"):
                continue
            linked = (path.parent / unquote(parsed.path)).resolve()
            require(linked.is_relative_to(ROOT), f"Link escapes repository: {target}")
            require(linked.exists(), f"Broken link in {path.name}: {target}")

    master = (ROOT / "UNDAL_BUILD_PROMPT.md").read_text()
    for name in ANNEXES:
        require(f"docs/undal/{name}" in master, f"Master omits annex: {name}")
    require("BEGIN BUILD PROMPT" in master, "Master prompt start marker missing")
    require("END BUILD PROMPT" in master, "Master prompt end marker missing")
    PASSES.append("Required documents, local links, line caps, and secret-pattern checks")


def check_inventory() -> None:
    """Match all reference assets to one reviewed ID and verify byte-level integrity."""
    inventory = DOCS / "reference-inventory.tsv"
    if not inventory.exists():
        return
    with inventory.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        require(
            reader.fieldnames == ["id", "path", "width", "height", "sha256"],
            "Unexpected inventory columns",
        )
        rows = list(reader)

    ids = [row["id"] for row in rows]
    paths = [row["path"] for row in rows]
    require(len(rows) == 130, f"Expected 130 image records, found {len(rows)}")
    require(len(set(ids)) == len(ids), "Duplicate inventory IDs")
    require(len(set(paths)) == len(paths), "Duplicate inventory paths")
    require(dict(Counter(identifier[:1] for identifier in ids)) == EXPECTED_COUNTS,
            "Reference group counts do not match the reviewed set")

    images = {
        path.relative_to(ROOT).as_posix()
        for path in (ROOT / "reference-images").rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    }
    require(set(paths) == images, "Inventory does not exactly cover reference images")
    hashes: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        require(bool(re.fullmatch(r"[CWPR]\d{2}", row["id"])), "Invalid image ID")
        path = (ROOT / row["path"]).resolve()
        require(path.is_relative_to(ROOT / "reference-images"), "Unsafe inventory path")
        if not path.is_file():
            FAILURES.append(f"Missing image: {row['path']}")
            continue
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        require(actual_hash == row["sha256"], f"Changed image bytes: {row['id']}")
        require(int(row["width"]) > 0 and int(row["height"]) > 0,
                f"Invalid dimensions: {row['id']}")
        hashes[actual_hash].append(row["id"])

    duplicates = {frozenset(group) for group in hashes.values() if len(group) > 1}
    require(duplicates == EXPECTED_DUPLICATES, "Exact duplicate image groups changed")
    require(len(hashes) == 124, f"Expected 124 unique image contents: {len(hashes)}")
    analysis = (DOCS / ANNEXES[0]).read_text()
    reviewed = re.findall(r"^\| ([CWPR]\d{2}) `", analysis, flags=re.MULTILINE)
    require(Counter(reviewed) == Counter(ids), "Not every image has exactly one review row")
    markers = list((ROOT / "reference-images").rglob("*.txt"))
    require(len(markers) == 5, "Expected five supplied text marker files")
    for path in markers:
        require(not path.read_text().strip(), f"Nonempty reference marker: {path.name}")
    PASSES.append("130 reviewed image paths/hashes, 124 unique images, and six duplicate pairs")


def check_stage_plan() -> None:
    """Ensure the promised two-plus-thirty plan has no missing or duplicate stages."""
    path = DOCS / "07-delivery-plan-and-acceptance.md"
    if not path.exists():
        return
    text = path.read_text()
    analysis = re.findall(r"^### (ANALYSIS-\d{2}) — Response (\d{2}):", text, re.MULTILINE)
    builds = re.findall(r"^\| (BUILD-\d{2}) / (\d{2}) \|", text, re.MULTILINE)
    require(analysis == [("ANALYSIS-01", "01"), ("ANALYSIS-02", "02")],
            "Analysis plan must contain exactly responses 01 and 02")
    expected = [(f"BUILD-{stage:02d}", f"{stage + 2:02d}") for stage in range(1, 31)]
    require(builds == expected, "Build plan must contain ordered stages 01–30 / responses 03–32")
    PASSES.append("Exactly two analysis stages plus thirty ordered build stages")


def check_configuration_example() -> None:
    """Check example-only configuration does not look accidentally operational."""
    path = DOCS / "github-actions.env.example"
    if not path.exists():
        return
    entries: dict[str, str] = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, separator, value = line.partition("=")
        require(bool(separator), f"Invalid example configuration line: {line}")
        require(bool(re.fullmatch(r"[A-Z][A-Z0-9_]*", key)), f"Invalid key: {key}")
        require(key not in entries, f"Repeated example configuration key: {key}")
        entries[key] = value
    private = (
        "IMGBB_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN",
        "SUPABASE_DB_URL", "FIREBASE_SERVICE_ACCOUNT_JSON", "CLOUDFLARE_API_TOKEN",
        "INITIAL_SUPER_ADMIN_PASSWORD", "SIGNING_BOOTSTRAP_SECRETS_TOKEN",
        "SIGNING_BACKUP_PASSPHRASE", "OPERATIONS_GITHUB_APP_PRIVATE_KEY",
        "CUSTOMER_KEYSTORE_BASE64", "PARTNER_KEYSTORE_BASE64", "RIDER_KEYSTORE_BASE64",
        "R2_INVOICE_WRITER_ACCESS_KEY_ID", "R2_INVOICE_WRITER_SECRET_ACCESS_KEY",
    )
    for key in private:
        require(key in entries and not entries[key], f"Example secret must be blank: {key}")
    require(entries.get("VENDOR_DEDUCTION_CLASSIFICATION") == "unapproved",
            "Example must not pretend the 5% policy is approved")
    require(entries.get("RIDER_BONUS_FUNDING") == "unapproved",
            "Example must not pretend bonus funding is approved")
    require(entries.get("DO_STORAGE_BACKEND") == "sqlite", "Free-plan DO backend must be SQLite")
    for key, expected in (
        ("PRIVATE_MEDIA_BACKEND", "cloudflare_r2"),
        ("R2_STORAGE_CLASS", "Standard"),
        ("R2_PUBLIC_ACCESS_ENABLED", "false"),
        ("PRIVATE_MEDIA_DELIVERY_MODE", "authenticated_worker"),
        ("R2_ACCOUNT_SETUP_CONFIRMED", "false"),
    ):
        require(entries.get(key) == expected, f"Unsafe/missing R2 example value: {key}")
    buckets = [entries.get(key) for key in (
        "R2_PRIVATE_EVIDENCE_BUCKET", "R2_PRIVATE_INVOICES_BUCKET",
    )]
    require(all(buckets) and len(set(buckets)) == 2, "Private R2 bucket names must be distinct")
    for key in ("R2_STANDARD_STORAGE_BUDGET_BYTES", "R2_MONTHLY_CLASS_A_OPERATION_BUDGET",
                "R2_MONTHLY_CLASS_B_OPERATION_BUDGET", "R2_QUOTA_RESERVE_PERCENT"):
        require(key in entries, f"Missing R2 budget configuration: {key}")
    for key in ("PRIVATE_EVIDENCE_BUCKET", "INVOICE_PDF_BUCKET", "PRIVATE_STORAGE_BUDGET_BYTES"):
        require(key not in entries, f"Obsolete non-R2 storage configuration: {key}")
    PASSES.append("Example configuration, blank secrets, private Standard R2, and readiness gates")


def check_private_r2_contract() -> None:
    """Catch contradictory storage instructions without claiming live R2 was tested."""
    master = (ROOT / "UNDAL_BUILD_PROMPT.md").read_text()
    require("- **Cloudflare R2:**" in master, "Master must explicitly require private R2")
    require(not re.search(r"Do not add[^\n]*\bR2\b", master),
            "Approved R2 storage must not remain in the forbidden-service list")
    documents = [ROOT / "README.md", ROOT / "UNDAL_BUILD_PROMPT.md"]
    documents += [DOCS / name for name in ANNEXES]
    for path in documents:
        text = path.read_text()
        for obsolete in (
            "Use private Supabase Storage", "Private Supabase Storage metadata",
            "Supabase Postgres + Auth + private Storage", "buckets/RLS",
        ):
            require(obsolete not in text, f"Legacy private-storage instruction in {path.name}")
        require(not re.search(r"Supabase RLS (?:also )?(?:directly )?protects R2 objects", text),
                f"Incorrect R2 authorization claim in {path.name}")
    for name in ("03-system-architecture.md", "05-security-and-android.md"):
        text = (DOCS / name).read_text()
        for contract in (
            "Supabase RLS protects metadata only;", "r2.dev", "custom domains",
            "Cache-Control: private, no-store", "Standard", "Class A", "Class B",
        ):
            require(contract in text, f"Missing private R2 boundary in {name}: {contract}")
    PASSES.append("Private R2 contract consistency (not live bucket/access tests)")


def check_document_arithmetic() -> None:
    """Validate printed example arithmetic only, not actual Undal business code."""
    printed = (DOCS / "04-finance-and-algorithms.md").read_text()
    for expected in (
        "total **148.98**", "total **32.00**", "storm-adjusted **49.00**",
        "**2.20, 1.40, 1.20, 1.00**", "**BDT 100 due from vendor**",
        "750 − 600 − 148.98 = 1.02",
    ):
        require(expected in printed, f"Printed financial vector missing/changed: {expected}")
    gross = Decimal("1000")
    vendor_discount = gross * Decimal("0.25")
    eligible = gross - vendor_discount
    commission = eligible * Decimal("0.15")
    levy = eligible * Decimal("0.05")
    bonus = eligible * Decimal("0.03")
    food = eligible - Decimal("50")
    vendor_net = eligible - commission - levy
    rider_core = (Decimal("30") * Decimal("1.78") + Decimal("42") + Decimal("10"))
    rider_net = rider_core * Decimal("1.20") + bonus
    require(vendor_net == Decimal("600"), "FIN-01 vendor example does not reconcile")
    require(rider_net == Decimal("148.98"), "FARE-01 example does not reconcile")
    require(food + Decimal("50") - vendor_net - rider_net == Decimal("1.02"),
            "FIN-01 remaining platform cash does not reconcile")
    require(vendor_net - food == Decimal("-100"), "FIN-02 pickup net amount is incorrect")
    require(Decimal("20") + Decimal("1.5") * Decimal("8") == Decimal("32"),
            "FARE-02 bicycle example is incorrect")
    require((Decimal("30") + Decimal("5")) * Decimal("1.4") == Decimal("49"),
            "FARE-03 storm example is incorrect")
    for riders, expected in ((0, 22000), (5, 14000), (10, 12000), (11, 10000)):
        orders = 10
        if 2 * riders < orders:
            actual = 22000 - (14000 * riders // orders)
        elif riders <= orders:
            actual = 16000 - (4000 * riders // orders)
        else:
            actual = 10000
        require(actual == expected, f"FARE-04 multiplier error for R={riders}")
    require([seconds // 300 for seconds in (299, 300, 599, 600)] == [0, 1, 1, 2],
            "FARE-06 traffic-step example is incorrect")
    PASSES.append("Illustrative specification arithmetic (not application/payment tests)")


def main() -> int:
    """Run all checks without credentials, installed apps, or external requests."""
    for check in (
        check_documents, check_inventory, check_stage_plan,
        check_configuration_example, check_private_r2_contract, check_document_arithmetic,
    ):
        try:
            before = len(FAILURES)
            check()
            if len(FAILURES) > before:
                print(f"FAIL: {check.__name__}")
        except (OSError, ValueError, KeyError) as error:
            FAILURES.append(f"{check.__name__}: {error}")
    if FAILURES:
        for failure in FAILURES:
            print(f"ERROR: {failure}", file=sys.stderr)
        return 1
    for passed in PASSES:
        print(f"PASS: {passed}")
    print("Specification bundle valid. No Undal application was built or tested by this script.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
