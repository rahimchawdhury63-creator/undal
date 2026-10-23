import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

test('W1 undal-api /healthz returns standard envelope and 404 on unknown route', async () => {
  const res = await worker.fetch(new Request('https://api.undal.example/healthz'), {
    SERVICE_NAME: 'undal-api',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.data.service, 'undal-api');
  assert.equal(body.data.status, 'ok');
  assert.ok(typeof body.request_id === 'string' && body.request_id.length > 0);

  const missing = await worker.fetch(new Request('https://api.undal.example/v1/unknown'), {});
  assert.equal(missing.status, 404);
});
