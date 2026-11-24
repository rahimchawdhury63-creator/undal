# `scripts/geo` — the parity probe

`parity.py` runs one deterministic corpus of points through three implementations of
the integer geospatial layer: the TypeScript functions the Worker actually calls, an
independent Python mirror, and SQLite evaluating the generated `cell_id` expression as
SQL. It writes `.artifacts/geo/parity.json`, and the `geo-parity` guardrail rule fails
the build on any mismatch.

Run by the `geo-parity` workflow. Nothing here is a local tool: no step asks anyone to
type a command.
