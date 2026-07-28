import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function diagnostics(providers) {
  const [providerHealth, acceleration] = await Promise.all([
    Promise.all(providers.map((provider) => provider.health())),
    probeAcceleration()
  ]);

  return {
    generatedAt: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: os.cpus().map(({ model, speed }) => ({ model, speed })),
      memory: { total: os.totalmem(), free: os.freemem() }
    },
    acceleration,
    providers: providerHealth
  };
}

// A source is deliberately distinct from an adapter: each OS/vendor collector can
// contribute authoritative facts without making a legacy or shared-memory value look
// like dedicated VRAM.
export function mergeGpuInventory(adapters, reports) {
  const remainingReports = [...reports];
  const inventory = adapters.map((adapter) => {
    const index = remainingReports.findIndex((report) => gpuNamesMatch(adapter.name, report.name));
    if (index >= 0) {
      const [report] = remainingReports.splice(index, 1);
      return {
        name: adapter.name,
        memoryBytes: report.memoryBytes,
        memorySource: report.memorySource
      };
    }
    return {
      name: adapter.name,
      memoryBytes: null,
      memorySource: 'unavailable',
      memoryReason: 'No reliable dedicated-VRAM source is enabled for this adapter on this platform.'
    };
  });

  return inventory.concat(remainingReports.map((report) => ({
    name: report.name,
    memoryBytes: report.memoryBytes,
    memorySource: report.memorySource
  })));
}

async function probeAcceleration() {
  const collectors = {
    win32: probeWindowsAcceleration,
    linux: probeLinuxAcceleration,
    darwin: probeMacAcceleration
  };
  const collector = collectors[process.platform];
  if (!collector) {
    return { status: 'unavailable', reason: `GPU/NPU diagnostics are not implemented for ${process.platform} yet.` };
  }
  return collector();
}

async function probeWindowsAcceleration() {
  const [adapterResult, reports] = await Promise.all([
    probeWindowsAdapters().then((adapters) => ({ adapters })).catch((error) => ({ adapters: [], error })),
    probeNvidiaSmi()
  ]);
  const gpus = mergeGpuInventory(adapterResult.adapters, reports);
  if (!gpus.length && adapterResult.error) {
    return { status: 'unavailable', reason: `Windows adapter inventory failed: ${adapterResult.error.message}` };
  }
  return {
    status: 'available',
    gpus,
    npu: { status: 'unavailable', reason: 'No cross-vendor NPU probe is enabled in v1.' }
  };
}

async function probeLinuxAcceleration() {
  return {
    status: 'unavailable',
    reason: 'Linux adapter discovery is reserved for the Linux collector; no values are simulated.',
    npu: { status: 'unavailable', reason: 'No Linux NPU collector is enabled in v1.' }
  };
}

async function probeMacAcceleration() {
  return {
    status: 'unavailable',
    reason: 'macOS adapter discovery is reserved for the macOS collector; unified memory is not presented as dedicated VRAM.',
    npu: { status: 'unavailable', reason: 'No macOS NPU collector is enabled in v1.' }
  };
}

async function probeWindowsAdapters() {
  const { stdout } = await exec(
    'powershell.exe',
    ['-NoProfile', '-Command', "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress"],
    { timeout: 5000, windowsHide: true }
  );
  const raw = JSON.parse(stdout || '[]');
  return (Array.isArray(raw) ? raw : [raw])
    .filter((gpu) => typeof gpu?.Name === 'string' && gpu.Name.trim())
    .map((gpu) => ({ name: gpu.Name.trim() }));
}

async function probeNvidiaSmi() {
  try {
    const { stdout } = await exec(
      'nvidia-smi.exe',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 5000, windowsHide: true }
    );
    return stdout.split(/\r?\n/).flatMap((line) => {
      const [name, memoryMiB] = line.split(',').map((value) => value.trim());
      const memory = Number(memoryMiB);
      return name && Number.isFinite(memory) && memory >= 0
        ? [{ name, memoryBytes: memory * 1024 * 1024, memorySource: 'nvidia-smi' }]
        : [];
    });
  } catch {
    // AdapterRAM is a legacy 32-bit Windows field. Do not use it as a VRAM fallback.
    return [];
  }
}

function gpuNamesMatch(first, second) {
  const normalize = (name) => name.toLowerCase()
    .replace(/nvidia|geforce|corporation|\(r\)|\(tm\)/g, '')
    .replace(/[^a-z0-9]/g, '');
  const left = normalize(first);
  const right = normalize(second);
  return left === right || left.includes(right) || right.includes(left);
}
