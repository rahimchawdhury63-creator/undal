/**
 * @file workers/api/test/db-postgrest-vouchers.test.mjs
 * @description Exercises the W1 PostgREST voucher-wallet filters, privacy projection, and eligibility rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createPostgrestDbAdapter } from '../src/db-postgrest.ts';

const IDS = Object.freeze({
  first: 'd7001111-1111-4111-8111-111111111111',
  limited: 'd7002222-2222-4222-8222-222222222222',
  exhausted: 'd7003333-3333-4333-8333-333333333333',
  general: 'd7004444-4444-4444-8444-444444444444',
});

function voucher(id, code, overrides = {}) {
  return {
    id,
    code,
    title_en: `${code} offer`,
    title_bn: null,
    kind: 'flat',
    value_num: '5000',
    cap_poisha: null,
    min_order_poisha: '20000',
    max_uses_per_user: 1,
    first_order_only: false,
    budget_cap_poisha: '100000',
    budget_spent_poisha: '0',
    ends_at: '2026-10-26T00:00:00+00:00',
    ...overrides,
  };
}

test('PostgREST voucher wallet excludes exhausted, overused, and previously ineligible first-order offers', async () => {
  let priorOrders = [];
  const requests = [];
  const db = createPostgrestDbAdapter({
    SUPABASE_URL: 'https://supabase.undal.test',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    __fetchImpl: async (input) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.pathname.endsWith('/vouchers')) {
        return Response.json([
          voucher(IDS.first, 'FIRSTONLY', { first_order_only: true }),
          voucher(IDS.limited, 'LIMITED'),
          voucher(IDS.exhausted, 'SPENT', { budget_spent_poisha: '100000' }),
          voucher(IDS.general, 'GENERAL'),
        ]);
      }
      if (url.pathname.endsWith('/voucher_redemptions')) {
        return Response.json([{ voucher_id: IDS.limited }]);
      }
      if (url.pathname.endsWith('/orders')) return Response.json(priorOrders);
      return Response.json([]);
    },
  });

  const firstOrderWallet = await db.listAvailableVouchers('d7005555-5555-4555-8555-555555555555');
  assert.deepEqual(firstOrderWallet.map((row) => row.code), ['FIRSTONLY', 'GENERAL']);
  assert.equal('budget_cap_poisha' in firstOrderWallet[0], false);
  assert.equal('first_order_only' in firstOrderWallet[0], false);
  const redemptionQuery = requests.find((url) => url.pathname.endsWith('/voucher_redemptions'));
  assert.ok(redemptionQuery?.searchParams.get('voucher_id')?.includes(IDS.general));

  priorOrders = [{ id: 'd7006666-6666-4666-8666-666666666666' }];
  const returningCustomerWallet = await db.listAvailableVouchers('d7005555-5555-4555-8555-555555555555');
  assert.deepEqual(returningCustomerWallet.map((row) => row.code), ['GENERAL']);
});
