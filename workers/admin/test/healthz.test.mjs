import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

test('W3 undal-admin /healthz responds 200 and denies unauthenticated admin paths', async () => {
  const ok = await worker.fetch(new Request('https://admin-api.undal.example/healthz'), {
    SERVICE_NAME: 'undal-admin',
  });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.data.capabilitiesTarget, 132);

  const denied = await worker.fetch(new Request('https://admin-api.undal.example/v1/admin/users'), {});
  assert.equal(denied.status, 403);
});
