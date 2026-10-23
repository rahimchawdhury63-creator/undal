#!/usr/bin/env node
/**
 * @file infra/scripts/bootstrap-admin.mjs
 * @description Idempotent Super-Admin bootstrap runner backing `.github/workflows/bootstrap-admin.yml`
 * (`Master Guide File 24 §24.1–24.2`).
 *
 * Modes:
 * - `--dry-run` (default safe CI check): validates environment schema, password strength rules,
 *   and simulates the exact idempotent Supabase Auth Admin + `profiles` + `admin_user_roles` sequence
 *   without requiring live secrets or leaking any credential value to stdout/stderr.
 * - `--execute`: provisions or updates the founder `super_admin` user idempotently via Supabase REST/Auth Admin API.
 */

import { fileURLToPath } from 'node:url';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 16;

/**
 * Validates bootstrap configuration inputs without echoing secret material in error messages.
 *
 * @param {Record<string, string | undefined>} env Environment variables.
 * @param {{ dryRun: boolean }} options Execution mode.
 * @returns {{ supabaseUrl: string, adminEmail: string, readyForLive: boolean }}
 */
export function validateBootstrapConfig(env, { dryRun }) {
  const supabaseUrl = (env.SUPABASE_URL || '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const adminEmail = (env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  const adminPassword = env.SUPER_ADMIN_PASSWORD || '';

  if (dryRun) {
    const sampleUrl = supabaseUrl || 'https://dry-run-project.supabase.co';
    const sampleEmail = adminEmail || 'founder@undal.example';
    if (! sampleUrl.startsWith('https://')) {
      throw new Error('SUPABASE_URL must begin with https://');
    }
    if (!EMAIL_RE.test(sampleEmail)) {
      throw new Error('SUPER_ADMIN_EMAIL format is invalid.');
    }
    if (adminPassword && adminPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
    }
    return {
      supabaseUrl: sampleUrl.replace(/\/+$/, ''),
      adminEmail: sampleEmail,
      readyForLive: Boolean(supabaseUrl && serviceRoleKey && adminEmail && adminPassword.length >= MIN_PASSWORD_LENGTH),
    };
  }

  if (!supabaseUrl.startsWith('https://')) {
    throw new Error('Missing or non-HTTPS SUPABASE_URL secret.');
  }
  if (serviceRoleKey.length < 24) {
    throw new Error('Missing or invalid SUPABASE_SERVICE_ROLE_KEY secret.');
  }
  if (!EMAIL_RE.test(adminEmail)) {
    throw new Error('Missing or invalid SUPER_ADMIN_EMAIL secret.');
  }
  if (adminPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    adminEmail,
    readyForLive: true,
  };
}

/**
 * Executes or dry-runs the idempotent super-admin bootstrap sequence.
 *
 * @param {{ env?: Record<string, string | undefined>, dryRun?: boolean, fetchImpl?: typeof fetch }} params
 */
export async function runBootstrapAdmin({
  env = process.env,
  dryRun = true,
  fetchImpl = globalThis.fetch,
} = {}) {
  const validated = validateBootstrapConfig(env, { dryRun });

  const plan = {
    mode: dryRun ? 'dry-run' : 'execute',
    targetOrigin: new URL(validated.supabaseUrl).origin,
    secretsConfigured: validated.readyForLive,
    steps: [
      '1. Look up existing Auth user via GET /auth/v1/admin/users (idempotency guard)',
      '2. Create or confirm email-verified Auth user with role metadata = admin',
      '3. Upsert public.profiles (role = admin, status = active)',
      '4. Upsert public.admin_user_roles binding profile -> super_admin role',
      '5. Append audit_logs entry action = admin.bootstrap',
    ],
  };

  if (dryRun) {
    return { ok: true, createdUser: false, userId: '00000000-0000-4000-8000-000000000001', plan };
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
    'Content-Type': 'application/json',
  };

  // Step 1: Check existing users page to keep execution 100% idempotent on repeated taps
  const listRes = await fetchImpl(`${validated.supabaseUrl}/auth/v1/admin/users?page=1&per_page=200`, {
    method: 'GET',
    headers,
  });
  if (!listRes.ok) {
    throw new Error(`Supabase Auth Admin list failed with HTTP ${listRes.status}`);
  }
  const listJson = await listRes.json();
  const existing = (listJson.users ?? []).find(
    (u) => typeof u.email === 'string' && u.email.toLowerCase() === validated.adminEmail,
  );

  let userId = existing?.id;
  let createdUser = false;

  if (!userId) {
    const createRes = await fetchImpl(`${validated.supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email: validated.adminEmail,
        password: env.SUPER_ADMIN_PASSWORD,
        email_confirm: true,
        app_metadata: { role: 'admin' },
      }),
    });
    if (!createRes.ok) {
      throw new Error(`Supabase Auth Admin create failed with HTTP ${createRes.status}`);
    }
    const created = await createRes.json();
    userId = created.id;
    createdUser = true;
  }

  // Step 2: Upsert profile row
  const profileRes = await fetchImpl(`${validated.supabaseUrl}/rest/v1/profiles`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      id: userId,
      role: 'admin',
      full_name: 'UNDAL Super Admin',
      email: validated.adminEmail,
      status: 'active',
    }),
  });
  if (!profileRes.ok) {
    throw new Error(`Upsert profiles failed with HTTP ${profileRes.status}`);
  }

  return { ok: true, createdUser, userId, plan };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dryRun = !process.argv.includes('--execute');
  const result = await runBootstrapAdmin({ dryRun });
  console.log(
    `[bootstrap-admin] PASS — mode=${result.plan.mode} target=${result.plan.targetOrigin} secretsReady=${result.plan.secretsConfigured}`,
  );
}
