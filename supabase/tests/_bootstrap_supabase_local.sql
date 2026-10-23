-- =============================================================================
-- Test Bootstrap Shim: supabase/tests/_bootstrap_supabase_local.sql
-- Purpose: Creates minimal Supabase GoTrue (`auth.*`) + Storage (`storage.*`)
--          roles, tables, and JWT helper functions when running migrations
--          inside standalone PostgreSQL 16 (`pg_prove` CI) or WASM `PGlite`
--          without requiring full Dockerized GoTrue containers.
--          NEVER applied via `supabase db push` (lives outside `migrations/`).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END;
$$;

CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  phone text UNIQUE,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

GRANT ALL ON TABLE auth.users TO service_role;

CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    jsonb_build_object(
      'sub', nullif(current_setting('request.jwt.claim.sub', true), ''),
      'role', coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user)
    )
  );
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      auth.jwt() ->> 'sub'
    ),
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    auth.jwt() ->> 'role',
    current_user
  );
$$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS storage;
GRANT USAGE ON SCHEMA storage TO PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name text NOT NULL,
  owner uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

GRANT SELECT ON storage.buckets TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated, service_role;

DROP POLICY IF EXISTS storage_service_all ON storage.objects;
CREATE POLICY storage_service_all ON storage.objects
  FOR ALL TO service_role USING (true) WITH CHECK (true);
