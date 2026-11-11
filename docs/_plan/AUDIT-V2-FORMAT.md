<!--
Licensed under PASVL-1.0. Source is public. Deployment requires a LOSDA.
SPDX-License-Identifier: LicenseRef-PASVL-1.0
-->

# Proposed audit v2 canonical format

**Status: experimental foundation, not integrated or production-ready.** The TypeScript encoder and bounded raw-JSON parser are `workers/core/src/audit/canonical-v2.ts` and `workers/core/src/audit/lossless-json.ts`; the independent Python reference is `scripts/db/audit_v2.py`. They do not persist records, verify database rows, serialize concurrent writers, reconcile legacy entries or establish external trust. No migration or route uses this format. The D169 legacy diagnostic remains incomplete and cash financial writes remain gated.

## Canonical byte grammar

The format encodes values into bytes, not JSON text. It uses UTF-8 with valid Unicode scalar values only; lone surrogates are rejected, with no Unicode normalization. The encoding is injective over its supported value types:

| Value               | Bytes                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| null / true / false | ASCII `n`, `t`, `f`                                                                                                               |
| safe integer        | ASCII `i`, canonical signed base-10 integer, ASCII `;`                                                                            |
| string              | ASCII `s`, decimal UTF-8 **byte** length, ASCII `:`, then UTF-8 bytes                                                             |
| array               | ASCII `a`, decimal element count, ASCII `:`, then each encoded value in order                                                     |
| object              | ASCII `o`, decimal key count, ASCII `:`, then each encoded string key and value; keys are sorted lexicographically by UTF-8 bytes |

Numbers are JavaScript-safe integers in `[-9007199254740991, 9007199254740991]`; floats, negative zero and unsafe integers are rejected. Arrays must be dense; unsupported values, cycles, accessors, non-enumerable/symbol properties and exotic objects are rejected. Each string is at most 8,192 UTF-8 bytes; encoded payloads at most 65,536 bytes, with at most 2,048 visited nodes and nesting depth 16. Repeated noncyclic values are encoded independently. The limits include keys and the top-level record array.

The canonical record is this **18-element array**, in order:

1. `undal.audit.v2`
2. entry ID as 32 lowercase hex characters (16 persisted bytes)
3. sequence as safe integer, minimum 1
4. UTC timestamp as `YYYY-MM-DD HH:MM:SS.ffffff`, calendar-validated
5. actor ID as 32 lowercase hex characters or null
6. actor type: `ADMIN`, `VENDOR`, `RIDER`, `CUSTOMER`, or `SYSTEM`
7. actor role or null (maximum 48 Unicode code points)
8. IP as lowercase hex of exactly 4 or 16 persisted bytes, or null
9. user agent or null (maximum 512 code points)
10. request ID as 32 lowercase hex characters
11. action (maximum 64 code points)
12. resource type (maximum 48 code points)
13. resource ID or null (maximum 64 code points)
14. subject ID as 32 lowercase hex characters or null
15. `before` value (explicit null if absent)
16. `after` value (explicit null if absent)
17. reason or null (maximum 512 code points)
18. severity: `INFO`, `NOTICE`, `WARNING`, or `CRITICAL`

All 18 fields are required and extra record fields are rejected. Strings must fit both their field limit and the 8,192-byte global string limit. The format intentionally binds the user agent as well as the other persisted values; it does not hash caller UUID spelling or textual IP spelling.

## Lossless JSON input boundary (D171)

`parseAuditV2Json` and Python's `parse_audit_v2_json` accept **raw JSON text**, not an already-decoded object. They inspect integer tokens before conversion, accepting only safe integer literals in the canonical range. Decimal and exponent spellings, negative zero, out-of-range integers, duplicate keys (including keys that become equal after JSON escape decoding), non-standard numeric constants and non-scalar Unicode are rejected. Source JSON is bounded at 400,000 UTF-8 bytes; the canonical encoder then enforces its smaller payload, string, node and depth limits. `db/fixtures/audit_v2_json_vectors.json` pins accepted bytes and malformed/ambiguous cases in both languages.

This prevents these parsers from silently turning `1.0000000000000001` into `1`, or rounding an out-of-range integer before the v2 encoder sees it. It does **not** recover tokens after a caller has already used `JSON.parse`, a database driver has eagerly decoded JSON, or a database has normalized/rounded a value. A future writer must validate the original request representation before any lossy parse/conversion; a future verifier must obtain and test a representation that preserves the stored number tokens. Passing these parser tests does not establish how TiDB or the pinned driver returns a JSON column. No live database query, writer integration or schema change was made in D171.

## Hashes

Let `payload` be the bytes above, `H` be SHA-256, and `||` mean byte concatenation:

```
payloadHash = H(UTF8("undal.audit.payload.v2\0") || payload)
linkHash    = H(UTF8("undal.audit.link.v2\0") || predecessor || payloadHash)
```

`predecessor` is one zero byte for sequence 1 and one byte `01` followed by the 32-byte predecessor hash for later sequences. Genesis must have no predecessor; all later rows require a 32-byte predecessor. A potential bridge to an older chain would use the exact predecessor hash, but this format alone does not validate the legacy prefix or approve a cutover. The tag distinguishes genesis from an all-zero predecessor hash.

`db/fixtures/audit_v2_vectors.json` pins canonical bytes and both hashes for genesis, a linked entry and a proposed legacy-hash bridge, including non-ASCII keys, supplementary Unicode, IPv4, IPv6, controls and integer limits. Both implementations run the vectors; an additional deterministic cross-language test covers generated nested values. These tests do not prove behavior of a real database or a deployed audit system.

## Mandatory work before integration

- Design a schema and version discriminator, atomic audit-head serialization and a coordinated cutover that prevents legacy and v2 writers racing. Balance, ledger, case, receipt and audit changes must share the same transaction where required; test deadlocks, lost acknowledgements and rollbacks on isolated TiDB.
- Decide exactly which bytes are authoritative and how they are stored and verified. An immutable canonical byte payload is a candidate, **not an implemented storage design**. Searchable columns must be checked against that payload; a valid payload hash alone does not authenticate unrelated or mismatched database columns.
- Do not rely on an eager/lossy JSON-to-number decoder to validate stored `before`/`after` values. D171 supplies a raw-text parser for a safe-integer-only JSON subset, but it does not establish that TiDB or the driver can return those exact tokens; verify exact persistence and validate inputs before any lossy conversion.
- Define a trusted independently stored checkpoint/anchor, deletion/truncation detection, access controls, recovery and retention. A hash chain without a protected anchor does not by itself prove authenticity or detect every rewritten or truncated history.
- Investigate historical audit data, preserve it unchanged, and explicitly document that old payloads may be unverifiable. Review bridge/anchor policy before enabling any v2 writes. Verify canonicalization against actual TiDB driver types and UTC behavior; vectors and simulated tests are not staging evidence.
