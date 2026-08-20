import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGpuInventory, classifyHost, shortCpuName } from '../lib/diagnostics.mjs';

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

test('classifyHost reflects the same memory tiers getHardwareProfile uses for model recommendations', () => {
  assert.equal(classifyHost({ memoryGB: 64, accelerationAvailable: true }), 'high-memory+gpu-accel');
  assert.equal(classifyHost({ memoryGB: 32, accelerationAvailable: true }), 'high-memory+gpu-accel');
  assert.equal(classifyHost({ memoryGB: 16, accelerationAvailable: false }), 'standard-memory+cpu-only');
  assert.equal(classifyHost({ memoryGB: 8, accelerationAvailable: false }), 'constrained-memory+cpu-only');
});

test('shortCpuName strips vendor trademark noise and clock-speed suffixes', () => {
  assert.equal(shortCpuName('Intel(R) Core(TM) i7-10700K CPU @ 3.80GHz'), 'Intel Core i7-10700K');
  assert.equal(shortCpuName('AMD Ryzen 9 5900X 12-Core Processor'), 'AMD Ryzen 9 5900X 12-Core Processor');
  assert.equal(shortCpuName(''), 'Unknown CPU');
  assert.equal(shortCpuName(undefined), 'Unknown CPU');
});

