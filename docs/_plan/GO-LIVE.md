# Bringing Undal up for the first time

Every command here exists in this repository; none of them has been run against a live database in
the sandbox this code was written in. That is the whole point of this page: the checks below are the
ones that need a machine with Docker and a Cloudflare account, and they are written down so the first
person to have one does not have to rediscover the order.

## 1. A database, and the schema

```bash
docker run -d --name undal-tidb -p 4000:4000 pingcap/tidb:latest
export UNDAL_TEST_DATABASE_URL='mysql://root@127.0.0.1:4000/undal'
mysql -h 127.0.0.1 -P 4000 -e 'CREATE DATABASE undal'
```

TiDB is the target; MySQL 8 works for everything except the features the migrations avoid on purpose
(no stored procedures, no triggers, no non-additive `ALTER`).

## 2. The migrations, then the harness

```bash
export TIDB_MIGRATION_URL="$UNDAL_TEST_DATABASE_URL"
python3 scripts/db/migrate.py      # 000 … 030, additive, idempotent, ledger in db/migrations/.ledger
python3 scripts/db/integration.py --run
```

`--run` applies the migrations, inserts the nine fixtures from `scripts/db/seed_local.py`, and runs
all twenty operator queries. It exits 1 with a message if it cannot reach the database. **This is the
first moment any SQL in this repository has ever returned a row** — if a column name is wrong, it
fails here rather than in front of a customer.

Then check the schema matches what the code expects:

```bash
python3 scripts/db/check_schema_parity.py
python3 scripts/db/verify_schema.py
```

## 3. The Worker

```bash
cd workers/core && pnpm dev        # wrangler dev, local
curl -s localhost:8787/v1/public/config | head
```

Journals to watch: `wrangler tail` in a second terminal. The first request that touches the database
is `/v1/public/areas`.

## 4. The journey that proves the vertical slice

Quote, place, accept, deliver — through HTTP, not through a handler:

```bash
# quote (anonymous, no writes)
curl -s -X POST localhost:8787/v1/orders/quote -H 'content-type: application/json' \
  -d '{"vendorId":"…","zoneId":"…","items":[{"itemId":"…","qty":1}]}'
# place (needs a customer token and an Idempotency-Key)
curl -s -X POST localhost:8787/v1/orders -H "authorization: Bearer $CUSTOMER" \
  -H "idempotency-key: $(uuidgen)" -H 'content-type: application/json' -d '…'
```

Send the same `Idempotency-Key` twice: the second call must return the first response, not a second
order. That is the property no test in this repository can prove without a database.

## 5. Deploy order

1. `migrations` — additive only, so an old Worker keeps running against a new schema.
2. `workers/core` — `pnpm deploy`, then `wrangler tail` for the first ten minutes.
3. `web/storefront` — `pnpm --filter storefront build`, deploy the output; check `/` and `/areas`.
4. `web/admin` — same, at `/admin/`; the CSP is scoped to that path and verified by
   `node scripts/verify-csp.mjs`.

Rollback is the step before: the previous Worker version (`wrangler rollback`) and, only if a
migration is at fault, a forward fix — never a `DROP`, which the migration policy forbids for
exactly this reason.

## What is not covered

- **Realtime.** The SSE/long-poll paths have no test and no runbook yet.
- **The pricing engine under load.** `scripts/db/queries/08_*` measures it, but nothing has.
- **The Android build.** Only `android/shared/money` exists.
- **Payment providers.** The adapters are written; no sandbox credentials have ever been used.
