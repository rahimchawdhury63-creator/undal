# Undal — build-prompt specification

**A Bangladesh-first, food-only, cash-on-delivery/pickup platform.**

This repository currently contains the supplied design references and a detailed, evidence-conscious prompt for building Undal. It does **not** yet contain an implemented delivery platform, deployed services, or signed Android applications.

## Start here

Open **[UNDAL_BUILD_PROMPT.md](UNDAL_BUILD_PROMPT.md)** and paste its build-prompt section into Arena Agent Mode in this repository. Its eight annexes are part of the instructions. The future build starts with two analysis turns, followed by thirty planned implementation turns, stopping for **Continue** after each turn.

| Document | Contents |
| --- | --- |
| [Master prompt](UNDAL_BUILD_PROMPT.md) | Mission, scope, stack, engineering contract, response protocol, and release standard |
| [01 — Reference analysis](docs/undal/01-reference-analysis.md) | Individual observations for all 130 supplied images; adopt/adapt/exclude decisions |
| [02 — Product requirements](docs/undal/02-product-requirements.md) | Customer, partner, rider, admin, onboarding, and support requirements |
| [03 — Architecture](docs/undal/03-system-architecture.md) | Three Workers, Supabase, Firebase, alarms, SEO, capacity, and data ownership |
| [04 — Finance and algorithms](docs/undal/04-finance-and-algorithms.md) | Integer-money contracts, COD ledger, settlements, fare examples, dispatch, and ranking |
| [05 — Security and Android](docs/undal/05-security-and-android.md) | Threat model, RBAC/RLS, evidence storage, data-only FCM, lifecycle limits, and device tests |
| [06 — Deployment and operations](docs/undal/06-deployment-and-operations.md) | Browser-only setup, Actions, persistent signing keys, releases, domains, and recovery |
| [07 — Delivery and acceptance](docs/undal/07-delivery-plan-and-acceptance.md) | Two analysis stages, thirty implementation stages, traceability, and launch gates |
| [08 — Feasibility and sources](docs/undal/08-feasibility-and-sources.md) | Resolved contradictions, external approval gates, and source-verification requirements |
| [Actions configuration example](docs/undal/github-actions.env.example) | Secret/variable names and safe example values; not a deployed configuration |
| [Reference inventory](docs/undal/reference-inventory.tsv) | IDs, paths, dimensions, and SHA-256 hashes for the supplied image files |

## Important corrections built into the prompt

- Food only; no grocery, paid advertising, customer online payment, or paid membership system.
- Free-first within measured limits, not unlimited scale at zero cost. R2 has included free usage but requires account/subscription setup and can bill beyond it; quota controls are mandatory, not a provider-guaranteed spending cap.
- Native data-only FCM handling, with truthful Android force-stop, permission, and OEM limitations.
- Private **Cloudflare R2 Standard** storage for sensitive images/documents and invoice PDFs; imgbb remains public-media-only. Existing Workers enforce access; Supabase stores metadata, not private file bytes. No SVG-based “security.”
- Free-plan SQLite Durable Object alarms inside existing Workers for no-cron scheduling, plus idempotent catch-up/recovery.
- Finance/legal approval for the proposed 5% deduction and any 3% rider bonus; no diversion of statutory tax.
- Cash collected by riders, cash retained by pickup vendors, and actual payouts reconciled separately.
- No “world's best,” “never fails,” or “all devices tested” claims without evidence.

The credential pasted in the original request must be rotated. It is intentionally not reproduced anywhere in this prompt bundle.

## Reference review

The image review covers **41 customer-app, 24 customer-web, 53 partner-folder, and 12 rider-folder files**. Six rider images are exact duplicates of files in the partner folder, so there are **124 unique image contents**. Five supplied text marker files contain no instructions. One customer screenshot has an entirely black content area and cannot establish the hidden workflow.

The reference analysis is a visual design/interaction review, not reverse engineering of competitors' internal algorithms, APIs, financial policies, or reliability guarantees. Source images are preserved unchanged. Personal details visible in them are not copied into implementation requirements.

## Specification checks

The included [validation script](scripts/validate_prompt_bundle.py) checks document links, line limits, required annexes, the 32-stage plan, and inventory coverage/hash integrity. It validates this specification bundle only; it does not test an Undal application.

No local terminal is required from the platform owner. The future implementation must provide Actions-based operation from a browser, including its validation and test workflows.
