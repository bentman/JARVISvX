import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnostics } from '../lib/diagnostics.mjs';

test('diagnostics() system field carries a classified host string, a trimmed CPU name, and an acceleration snapshot', async () => {
  const report = await diagnostics([]);
  assert.match(report.system.hostClass, /^[a-z0-9]+-[a-z0-9]+-(?:cpu|gpu|npu)$/, 'hostClass must be os-arch-accelerator');
  assert.ok(report.system.cpuShortName.length > 0, 'cpuShortName must be non-empty');
  assert.ok(!report.system.cpuShortName.includes('(R)') && !report.system.cpuShortName.includes('(TM)'), 'cpuShortName must strip trademark noise');
  assert.ok(Array.isArray(report.system.cpu), 'cpu must be an array of model entries');
  assert.ok(typeof report.acceleration === 'object', 'acceleration must be present');
});

test('a health probe that outruns its budget is aborted, not merely abandoned', async () => {
  let aborted = false;
  const slowProvider = {
    id: 'slow-1',
    label: 'Slow provider',
    health(signal) {
      // A real provider threads this signal into fetch; the stand-in only records
      // that the budget reached it, so the reported result is the budget's.
      return new Promise(() => { signal.addEventListener('abort', () => { aborted = true; }, { once: true }); });
    },
  };

  const report = await diagnostics([slowProvider]);
  const probed = report.providers.find((entry) => entry.id === 'slow-1');
  assert.ok(aborted, 'the expired budget aborts the underlying request');
  assert.equal(probed.available, false);
  assert.match(probed.reason, /timeout/i);
});
