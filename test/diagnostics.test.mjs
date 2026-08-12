import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGpuInventory } from '../lib/diagnostics.mjs';

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

