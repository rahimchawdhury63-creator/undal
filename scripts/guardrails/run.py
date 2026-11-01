"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

The guardrail runner: dispatches all thirty-one rules, and can prove each one
still fails when it should.

`--fixtures` is the part that matters. A guardrail nobody has watched fail is
indistinguishable from a guardrail that passes everything, so every rule ships a
`bad` fixture it must reject and a `good` fixture it must accept, and CI runs
both on every push.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from lib import Finding, relative, repo_root  # noqa: E402

#: Every guardrail, in the order `28 §3.1` lists them.
RULES = (
    "no_local_tooling",
    "no_placeholders",
    "no_seed_data",
    "secret_scan",
    "line_budget",
    "doc_coverage",
    "money_integrity",
    "dependency_licence_and_cost",
    "lockfile_drift",
    "anti_ad_invariant",
    "customer_bill_purity",
    "ledger_closure",
    "i18n_completeness",
    "osm_attribution",
    "latency_budget",
    "fcm_payload_purity",
    "no_cron",
    "responsive_matrix",
    "perf_budget",
    "lighthouse_budget",
    "prerender_verify",
    "a11y",
    "audit_coverage",
    "license_headers",
    "token_purity",
    "contrast",
    "no_fixed_width",
    "no_layout_animation",
    "no_postgres_dialect",
    "geo_parity",
    "check_constraint_parity",
)


def _load(name: str):
    return importlib.import_module(f"rules.{name}")


def run_all(root: Path, only: list[str] | None) -> list[Finding]:
    findings: list[Finding] = []
    for name in RULES:
        if only and name not in only:
            continue
        module = _load(name)
        module_root = root
        findings.extend(module.check(module_root))
    return findings


def run_fixtures(only: list[str] | None) -> list[str]:
    """Each rule must reject its `bad` fixture and accept its `good` fixture."""
    failures: list[str] = []
    fixtures = Path(__file__).resolve().parent / "fixtures"
    for name in RULES:
        if only and name not in only:
            continue
        module = _load(name)
        directory = fixtures / name
        bad = directory / "bad"
        good = directory / "good"
        if not bad.is_dir() or not good.is_dir():
            failures.append(f"{name}: fixture pair missing under {directory}")
            continue
        if not module.check(bad):
            failures.append(f"{name}: accepted its bad fixture")
        if module.check(good):
            failures.append(f"{name}: rejected its good fixture")
    return failures


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Undal repository guardrails")
    parser.add_argument("--fixtures", action="store_true", help="prove every rule can fail")
    parser.add_argument("--only", nargs="*", metavar="RULE", help="limit to named rules")
    parser.add_argument("--root", default=None, help="scan a different tree")
    args = parser.parse_args(argv)

    root = Path(args.root).resolve() if args.root else repo_root()

    if args.fixtures:
        failures = run_fixtures(args.only)
        for failure in failures:
            print(f"FIXTURE FAIL {failure}")
        print(f"guardrail fixtures: {len(RULES) if not args.only else len(args.only)} rules, {len(failures)} broken")
        return 1 if failures else 0

    findings = run_all(root, args.only)
    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity != "error"]
    for finding in findings:
        print(finding.render())
    scanned = len(RULES) if not args.only else len(args.only)
    print(f"guardrails: {scanned} rules, {len(errors)} errors, {len(warnings)} warnings")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
