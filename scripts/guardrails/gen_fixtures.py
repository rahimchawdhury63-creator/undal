"""
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0

Writes the good/bad fixture pair for every guardrail.

A guardrail that has never rejected anything is a comment with a cron. Each pair
here contains exactly one violation (the `bad` side) and the same tree with that
violation removed (the `good` side), so `run.py --fixtures` proves the rule still
bites and does not bite innocent code.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

FIXTURES = Path(__file__).resolve().parent / "fixtures"

HEADER = "/*\n * Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.\n * SPDX-License-Identifier: LicenseRef-PASVL-1.0\n */\n\n"


def _long_file(lines: int) -> str:
    body = "".join(f"export const value{index} = {index};\n" for index in range(lines))
    return HEADER + body


def _row(code: str, en: str, bn: str) -> str:
    return f'  ["{code}", 422, "{en}", "{bn}", false, "{{}}"],\n'


CASES: dict[str, tuple[dict[str, str], dict[str, str]]] = {
    "no_local_tooling": (
        {"docs/run.md": "# Run\n\n```bash\n$ npm install\n```\n"},
        {"docs/run.md": "# Run\n\nClick *Run workflow* in the Actions tab.\n"},
    ),
    "no_placeholders": (
        {"src/feature.ts": HEADER + "// TODO: wire this up\nexport const a = 1;\n"},
        {"src/feature.ts": HEADER + "export const a = 1;\n"},
    ),
    "no_seed_data": (
        {"db/migrations/002_vendors.sql": "INSERT INTO `vendors` (`id`, `name`) VALUES (1, 'Kacchi Bhai');\n"},
        {
            "db/migrations/002_roles.sql": "-- schema-data: RBAC roles are schema, not business data\nINSERT INTO `roles` (`id`, `name`) VALUES (1, 'SUPER_ADMIN');\n"
        },
    ),
    "secret_scan": (
        {"src/config.ts": HEADER + 'export const key = "AKIAIOSFODNN7EXAMPLE";\n'},
        {"src/config.ts": HEADER + 'export const key = process.env.SOME_KEY ?? "";\n'},
    ),
    "line_budget": (
        {"src/huge.ts": _long_file(705)},
        {"src/small.ts": _long_file(20)},
    ),
    "doc_coverage": (
        {"src/undocumented.ts": HEADER + "export function computeTotal(): number {\n  return 0;\n}\n"},
        {"src/documented.ts": HEADER + "/** Why: the total is shown before payment. */\nexport function computeTotal(): number {\n  return 0;\n}\n"},
    ),
    "money_integrity": (
        {"packages/money/src/rate.ts": HEADER + "export const margin = 0.08;\n"},
        {"packages/money/src/rate.ts": HEADER + "export const marginBps = 800;\n"},
    ),
    "dependency_licence_and_cost": (
        {"package.json": json.dumps({"dependencies": {"twilio": "5.0.0"}})},
        {"package.json": json.dumps({"dependencies": {"hono": "4.6.3"}})},
    ),
    "lockfile_drift": (
        {"package.json": json.dumps({"dependencies": {"hono": "4.6.3"}}), "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .: {}\n"},
        {"package.json": json.dumps({"dependencies": {"hono": "4.6.3"}}), "pnpm-lock.yaml": "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      hono: 4.6.3\n"},
    ),
    "anti_ad_invariant": (
        {"rank/src/score.ts": HEADER + 'import { applyRate } from "../../money/src/index.ts";\nexport interface RankInput { revenueBdt: number }\n'},
        {"rank/src/score.ts": HEADER + "export interface RankInput { acceptanceRate: number }\n"},
    ),
    "customer_bill_purity": (
        {"packages/pricing/purity_bill.json": json.dumps({"customer": [{"kind": "platform_ad", "amount_paisa": 500, "customer_caused": False}]})},
        {"packages/pricing/purity_bill.json": json.dumps({"customer": [{"kind": "delivery_fee", "amount_paisa": 7_042, "customer_caused": True}]})},
    ),
    "ledger_closure": (
        {"packages/pricing/vector_postings.json": json.dumps([{"postings": [{"amount_paisa": 54_900}, {"amount_paisa": -54_800}]}])},
        {"packages/pricing/vector_postings.json": json.dumps([{"postings": [{"amount_paisa": 54_900}, {"amount_paisa": -54_900}]}])},
    ),
    "i18n_completeness": (
        {"packages/contracts/src/errors/rows/auth.ts": "export const AUTH_ROWS = [\n" + _row("AUTH_TEST", "Sign in.", "") + "] as const;\n"},
        {"packages/contracts/src/errors/rows/auth.ts": "export const AUTH_ROWS = [\n" + _row("AUTH_TEST", "Sign in.", "সাইন ইন করুন।") + "] as const;\n"},
    ),
    "osm_attribution": (
        {"web/map/MapView.tsx": "import maplibregl from 'maplibre-gl';\nexport const MapView = () => <div />;\n"},
        {"web/map/MapView.tsx": "import maplibregl from 'maplibre-gl';\nexport const MapView = () => <div>© OpenStreetMap contributors</div>;\n"},
    ),
    "latency_budget": (
        {".artifacts/bench/latency.json": json.dumps({"endpoints": [{"endpoint": "GET /v1/vendors", "p95_ms": 420, "budget_ms": 180}]})},
        {".artifacts/bench/latency.json": json.dumps({"endpoints": [{"endpoint": "GET /v1/vendors", "p95_ms": 120, "budget_ms": 180}]})},
    ),
    "fcm_payload_purity": (
        {"workers/realtime/src/push.ts": HEADER + "export const payload = { notification: { title: 'New order' } };\n"},
        {"workers/realtime/src/push.ts": HEADER + "export const payload = { data: { type: 'ORDER_NEW' }, android: { priority: 'high' } };\n"},
    ),
    "no_cron": (
        {"workers/core/wrangler.toml": "[triggers]\ncrons = [\"*/5 * * * *\"]\n"},
        {"workers/core/wrangler.toml": "name = \"undal-core\"\nmain = \"src/index.ts\"\n"},
    ),
    "responsive_matrix": (
        {".artifacts/responsive/matrix.json": json.dumps({"cells": [{"width": 200, "overflow_x": True, "clipped_controls": 0}]})},
        {".artifacts/responsive/matrix.json": json.dumps({"cells": [{"width": 200, "overflow_x": False, "clipped_controls": 0, "small_targets": []}]})},
    ),
    "perf_budget": (
        {".artifacts/perf/budgets.json": json.dumps({"metrics": [{"metric": "cold_start_ms", "value": 4200, "budget": 1800}]})},
        {".artifacts/perf/budgets.json": json.dumps({"metrics": [{"metric": "cold_start_ms", "value": 1400, "budget": 1800}]})},
    ),
    "lighthouse_budget": (
        {".artifacts/lighthouse/summary.json": json.dumps({"routes": [{"route": "/", "categories": {"performance": 72}}]})},
        {".artifacts/lighthouse/summary.json": json.dumps({"routes": [{"route": "/", "categories": {"performance": 97}}]})},
    ),
    "prerender_verify": (
        {".artifacts/prerender/report.json": json.dumps({"routes": [{"route": "/vendor/kacchi-bhai", "has_content_without_js": False}]})},
        {".artifacts/prerender/report.json": json.dumps({"routes": [{"route": "/vendor/kacchi-bhai", "has_content_without_js": True}]})},
    ),
    "a11y": (
        {".artifacts/a11y/report.json": json.dumps({"pages": [{"route": "/checkout", "violations": [{"id": "color-contrast", "impact": "serious"}]}]})},
        {".artifacts/a11y/report.json": json.dumps({"pages": [{"route": "/checkout", "violations": [{"id": "region", "impact": "minor"}]}]})},
    ),
    "audit_coverage": (
        {"workers/core/src/routes/order.ts": HEADER + "export const route = { method: 'POST', path: '/v1/orders' };\n"},
        {"workers/core/src/routes/order.ts": HEADER + "export const route = { method: 'POST', path: '/v1/orders' };\nexport async function handler() { await audit.write({}); }\n"},
    ),
    "license_headers": (
        {"src/bare.ts": "export const a = 1;\n"},
        {"src/honest.ts": HEADER + "export const a = 1;\n"},
    ),
    "token_purity": (
        {"web/storefront/src/features/vendor/Card.tsx": "export const card = { color: '#1B5E20' };\n"},
        {"web/storefront/src/features/vendor/Card.tsx": "export const card = { color: 'var(--color-brand-green)' };\n"},
    ),
    "contrast": (
        {"packages/tokens/tokens.json": json.dumps({"contrast_pairs": [{"foreground": "#1B5E20", "background": "#E91E63"}]})},
        {"packages/tokens/tokens.json": json.dumps({"contrast_pairs": [{"foreground": "#1B5E20", "background": "#FFF8E1"}]})},
    ),
    "no_fixed_width": (
        {"web/storefront/src/features/vendor/card.css": ".card { width: 320px; }\n"},
        {"web/storefront/src/features/vendor/card.css": ".card { width: 44px; }\n"},
    ),
    "no_layout_animation": (
        {"web/storefront/src/features/vendor/sheet.css": ".sheet { transition: height 200ms ease-out; }\n"},
        {"web/storefront/src/features/vendor/sheet.css": ".sheet { transition: transform 200ms ease-out; }\n"},
    ),
    "no_postgres_dialect": (
        {"db/migrations/003_zones.sql": "CREATE TABLE `zones` (`id` UUID NOT NULL);\n"},
        {"db/migrations/003_zones.sql": "CREATE TABLE `zones` (`id` BINARY(16) NOT NULL);\n"},
    ),
    "geo_parity": (
        {".artifacts/geo/parity.json": json.dumps({"mismatches": [{"case": "point-in-polygon/zone-4", "expected": "inside", "actual": "outside"}]})},
        {".artifacts/geo/parity.json": json.dumps({"mismatches": []})},
    ),
    "check_constraint_parity": (
        {
            "db/constraints.json": json.dumps({"constraints": [{"name": "chk_orders_total_positive"}]}),
            "db/migrations/004_orders.sql": "CREATE TABLE `orders` (`id` BINARY(16) NOT NULL);\n",
        },
        {
            "db/constraints.json": json.dumps({"constraints": [{"name": "chk_orders_total_positive"}]}),
            "db/migrations/004_orders.sql": "CREATE TABLE `orders` (\n  `id` BINARY(16) NOT NULL,\n  CONSTRAINT `chk_orders_total_positive` CHECK (`total_paisa` > 0)\n);\n",
        },
    ),
}


def write_tree(directory: Path, files: dict[str, str]) -> None:
    """Replace a fixture tree with exactly these files."""
    if directory.exists():
        shutil.rmtree(directory)
    for relative_path, content in files.items():
        target = directory / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


def main() -> int:
    for name, (bad, good) in CASES.items():
        write_tree(FIXTURES / name / "bad", bad)
        write_tree(FIXTURES / name / "good", good)
    print(f"fixtures: {len(CASES)} rules, {len(CASES) * 2} trees")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
