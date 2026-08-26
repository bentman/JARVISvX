import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnostics, mergeGpuInventory, classifyHost, shortCpuName } from '../lib/diagnostics.mjs';

test('uses a vendor driver VRAM report instead of a legacy Windows adapter value', () => {
  const inventory = mergeGpuInventory(
    [{ name: 'NVIDIA GeForce RTX 3060' }, { name: 'Intel(R) UHD Graphics 770' }],
    [{ name: 'NVIDIA GeForce RTX 3060', memoryBytes: 12288 * 1024 * 1024, memorySource: 'nvidia-smi' }]
  );

  assert.equal(inventory[0].memoryBytes, 12288 * 1024 * 1024);
  assert.equal(inventory[0].memorySource, 'nvidia-smi');
  assert.equal(inventory[1].memoryBytes, null);
  assert.equal(inventory[1].memorySource, 'unavailable');
});

test('classifyHost names the operating system, architecture, and best available accelerator', () => {
  const gpu = { status: 'available', npu: { status: 'unavailable' } };
  const npu = { status: 'available', npu: { status: 'available' } };
  const none = { status: 'unavailable', npu: { status: 'unavailable' } };

  assert.equal(classifyHost({ platform: 'win32', arch: 'x64', acceleration: none }), 'windows-amd64-cpu');
  assert.equal(classifyHost({ platform: 'win32', arch: 'x64', acceleration: gpu }), 'windows-amd64-gpu');
  assert.equal(classifyHost({ platform: 'linux', arch: 'arm64', acceleration: none }), 'linux-arm64-cpu');
  assert.equal(classifyHost({ platform: 'linux', arch: 'arm64', acceleration: gpu }), 'linux-arm64-gpu');
  assert.equal(classifyHost({ platform: 'linux', arch: 'arm64', acceleration: npu }), 'linux-arm64-npu');
});

// An amd64 host reports an NPU when one is present: probeWindowsNpu() matches the
// AI Boost and Ryzen AI devices that Intel Core Ultra and Ryzen AI parts expose.
test('classifyHost reports an NPU on amd64 as well as arm64', () => {
  const npu = { status: 'available', npu: { status: 'available' } };

  assert.equal(classifyHost({ platform: 'win32', arch: 'x64', acceleration: npu }), 'windows-amd64-npu');
  assert.equal(classifyHost({ platform: 'linux', arch: 'x64', acceleration: npu }), 'linux-amd64-npu');
});

test('classifyHost reports an unmapped platform or architecture as observed', () => {
  assert.equal(classifyHost({ platform: 'freebsd', arch: 'ppc64', acceleration: {} }), 'freebsd-ppc64-cpu');
});

test('shortCpuName strips vendor trademark noise and clock-speed suffixes', () => {
  assert.equal(shortCpuName('Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz'), 'Intel Core i7-10700K');
  assert.equal(shortCpuName('AMD Ryzen 9 5900X 12-Core Processor'), 'AMD Ryzen 9 5900X 12-Core Processor');
  assert.equal(shortCpuName(''), 'Unknown CPU');
  assert.equal(shortCpuName(undefined), 'Unknown CPU');
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
