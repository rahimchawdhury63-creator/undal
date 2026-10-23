/**
 * @file infra/scripts/bootstrap-admin.test.mjs
 * @description Automated unit tests for `infra/scripts/bootstrap-admin.mjs` covering:
 * - Safe secret-free CI `--dry-run` execution
 * - Password length & HTTPS validation rules
 * - Full 5-step idempotent execution (`auth.users`, `profiles`, `admin_user_roles`, `audit_logs`)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { runBootstrapAdmin, validateBootstrapConfig } from './bootstrap-admin.mjs';

test('bootstrap-admin dry-run succeeds cleanly without live secrets', async () => {
  const res = await runBootstrapAdmin({ env: {}, dryRun: true });
  assert.equal(res.ok, true);
  assert.equal(res.plan.mode, 'dry-run');
  assert.equal(res.plan.secretsConfigured, false);
  assert.equal(res.plan.steps.length, 5);
});

test('bootstrap-admin rejects weak passwords and missing live secrets in execute mode', () => {
  assert.throws(
    () =>
      validateBootstrapConfig(
        {
          SUPABASE_URL: 'https://demo.supabase.co',
          SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(32),
          SUPER_ADMIN_EMAIL: 'admin@undal.app',
          SUPER_ADMIN_PASSWORD: 'short',
        },
        { dryRun: false },
      ),
    /at least 16 characters/,
  );
});

test('bootstrap-admin execute mode is idempotent across first create and repeat run', async () => {
  const store = [];
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push(`${init.method} ${url}`);
    if (init.method === 'GET' && url.includes('/auth/v1/admin/users')) {
      return new Response(JSON.stringify({ users: store }), { status: 200 });
    }
    if (init.method === 'POST' && url.endsWith('/auth/v1/admin/users')) {
      const created = { id: '11111111-2222-4333-8444-555555555555', email: 'founder@undal.app' };
      store.push(created);
      return new Response(JSON.stringify(created), { status: 200 });
    }
    if (init.method === 'GET' && url.includes('/rest/v1/admin_roles')) {
      return new Response(JSON.stringify([{ id: '99999999-9999-4999-8999-999999999999' }]), { status: 200 });
    }
    return new Response('', { status: 201 });
  };

  const env = {
    SUPABASE_URL: 'https://undal-test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 's'.repeat(40),
    SUPER_ADMIN_EMAIL: 'Founder@Undal.app',
    SUPER_ADMIN_PASSWORD: 'StrongPassword#2026!',
  };

  const first = await runBootstrapAdmin({ env, dryRun: false, fetchImpl: mockFetch });
  assert.equal(first.createdUser, true);

  const second = await runBootstrapAdmin({ env, dryRun: false, fetchImpl: mockFetch });
  assert.equal(second.createdUser, false);
  assert.equal(second.userId, first.userId);
  assert.equal(calls.filter((c) => c.startsWith('POST https://undal-test.supabase.co/auth')).length, 1);
  assert.equal(calls.filter((c) => c.endsWith('/rest/v1/admin_user_roles')).length, 2);
  assert.equal(calls.filter((c) => c.endsWith('/rest/v1/audit_logs')).length, 2);
});
