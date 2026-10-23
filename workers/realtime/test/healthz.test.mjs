import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { ZoneDispatchDO } from '../src/index.ts';

test('W2 undal-realtime /healthz & ZoneDispatchDO shell respond cleanly', async () => {
  const res = await worker.fetch(new Request('https://rt.undal.example/healthz'), {
    SERVICE_NAME: 'undal-realtime',
    RTDB_LEASE_HARD_CAP: '85',
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.rtdbLeaseCap, 85);

  const doInstance = new ZoneDispatchDO({}, {});
  const doRes = await doInstance.fetch(new Request('https://do.internal/status'));
  assert.equal(doRes.status, 200);
});
