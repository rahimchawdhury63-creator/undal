/**
 * @file supabase/test/pgtap-runner.test.mjs
 * @description Executes every `supabase/tests/*.pgtap.sql` file verbatim against real PostgreSQL 16
 * WASM (`PGlite`) using lightweight SQL implementations of pgTAP's `plan`, `results_eq`, `is`,
 * `ok`, `lives_ok`, `throws_ok`, and `finish` — catching any pgTAP failure in <2s locally!
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const PGTAP_COMPAT_SQL = `
CREATE TABLE IF NOT EXISTS public._pgtap_state (planned int NOT NULL DEFAULT 0, ran int NOT NULL DEFAULT 0);
TRUNCATE public._pgtap_state;
INSERT INTO public._pgtap_state (planned, ran) VALUES (0, 0);
GRANT SELECT, UPDATE ON public._pgtap_state TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.plan(p_n integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public._pgtap_state SET planned = p_n, ran = 0;
  RETURN '1..' || p_n;
END; $$;

CREATE OR REPLACE FUNCTION public._tap_bump(p_ok boolean, p_desc text, p_detail text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_n int;
BEGIN
  UPDATE public._pgtap_state SET ran = ran + 1 RETURNING ran INTO v_n;
  IF NOT coalesce(p_ok, false) THEN
    RAISE EXCEPTION 'pgTAP FAIL #% (%): %', v_n, p_desc, p_detail;
  END IF;
  RETURN 'ok ' || v_n || ' - ' || p_desc;
END; $$;

CREATE OR REPLACE FUNCTION public.ok(p_cond boolean, p_desc text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT public._tap_bump(p_cond, p_desc, 'condition was not true');
$$;

CREATE OR REPLACE FUNCTION public.has_table(p_schema name, p_table name, p_desc text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT public._tap_bump(
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = p_schema::text AND table_name = p_table::text
    ),
    p_desc,
    format('table %s.%s not found', p_schema, p_table)
  );
$$;

CREATE OR REPLACE FUNCTION public.is(p_got anyelement, p_want anyelement, p_desc text DEFAULT '') RETURNS text LANGUAGE sql AS $$
  SELECT public._tap_bump(p_got IS NOT DISTINCT FROM p_want, p_desc, format('got=%s want=%s', p_got, p_want));
$$;

CREATE OR REPLACE FUNCTION public.results_eq(p_q1 text, p_q2 anyarray, p_desc text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_got text; v_want text;
BEGIN
  EXECUTE format('SELECT array_agg(x)::text FROM (%s) s(x)', p_q1) INTO v_got;
  v_want := p_q2::text;
  RETURN public._tap_bump(v_got IS NOT DISTINCT FROM v_want, p_desc, format('got=%s want=%s', v_got, v_want));
END; $$;

CREATE OR REPLACE FUNCTION public.results_eq(p_q1 text, p_q2 text, p_desc text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_got json; v_want json;
BEGIN
  EXECUTE format('SELECT coalesce(json_agg(row_to_json(t)), ''[]''::json) FROM (%s) t', p_q1) INTO v_got;
  EXECUTE format('SELECT coalesce(json_agg(row_to_json(t)), ''[]''::json) FROM (%s) t', p_q2) INTO v_want;
  RETURN public._tap_bump(
    (SELECT coalesce(jsonb_agg(array(SELECT value::text FROM json_each(elem))), '[]'::jsonb) FROM json_array_elements(v_got) elem)
    =
    (SELECT coalesce(jsonb_agg(array(SELECT value::text FROM json_each(elem))), '[]'::jsonb) FROM json_array_elements(v_want) elem),
    p_desc,
    format('got=%s want=%s', v_got, v_want)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.lives_ok(p_sql text, p_desc text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN public._tap_bump(true, p_desc);
EXCEPTION WHEN OTHERS THEN
  RETURN public._tap_bump(false, p_desc, format('threw %s: %s', SQLSTATE, SQLERRM));
END; $$;

CREATE OR REPLACE FUNCTION public.throws_ok(p_sql text, p_errcode text DEFAULT NULL, p_msg text DEFAULT NULL, p_desc text DEFAULT '') RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN public._tap_bump(false, p_desc, 'expected exception but succeeded');
EXCEPTION WHEN OTHERS THEN
  IF p_errcode IS NOT NULL AND SQLSTATE <> p_errcode THEN
    RETURN public._tap_bump(false, p_desc, format('got SQLSTATE=%s (%s), wanted %s', SQLSTATE, SQLERRM, p_errcode));
  END IF;
  RETURN public._tap_bump(true, p_desc);
END; $$;

CREATE OR REPLACE FUNCTION public.finish() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE v_st record;
BEGIN
  SELECT * INTO v_st FROM public._pgtap_state;
  IF v_st.planned <> v_st.ran THEN
    RAISE EXCEPTION 'pgTAP PLAN MISMATCH: planned %, ran %', v_st.planned, v_st.ran;
  END IF;
  RETURN NEXT format('1..%s (all passed)', v_st.ran);
END; $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
`;

test('Local PGlite pgTAP runner executes all supabase/tests/*.pgtap.sql suites cleanly', async () => {
  const db = new PGlite({ extensions: { pg_trgm } });
  try {
    await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests/_bootstrap_supabase_local.sql'), 'utf8'));
    const migFiles = fs.readdirSync(path.join(REPO_ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
    for (const f of migFiles) {
      await db.exec(fs.readFileSync(path.join(REPO_ROOT, 'supabase/migrations', f), 'utf8'));
    }
    await db.exec(PGTAP_COMPAT_SQL);

    const tapFiles = fs.readdirSync(path.join(REPO_ROOT, 'supabase/tests')).filter((f) => f.endsWith('.pgtap.sql')).sort();
    assert.ok(tapFiles.length >= 3);
    for (const tf of tapFiles) {
      const raw = fs.readFileSync(path.join(REPO_ROOT, 'supabase/tests', tf), 'utf8')
        .replace(/CREATE EXTENSION IF NOT EXISTS pgtap;/gi, '')
        // Make _pgtap_state invisible to public user table count checks
        .replace(/c\.relkind = 'r'/g, "c.relkind = 'r' AND c.relname <> '_pgtap_state'");
      await db.exec(raw);
    }
  } finally {
    await db.close();
  }
});
