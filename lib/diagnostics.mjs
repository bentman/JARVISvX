import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const withTimeout = (promise, ms, fallback) =>
  Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms))
  ]);

export async function diagnostics(providers = []) {
  const safeHealth = async (provider) => {
    try {
      return await withTimeout(
        provider.health(),
        1500,
        { id: provider.id, label: provider.label, available: false, models: [], reason: 'Health probe timeout (1.5s limit)' }
      );
    } catch (err) {
      return { id: provider.id, label: provider.label, available: false, models: [], reason: err.message || 'Probe error' };
    }
  };

  const [providerHealth, acceleration] = await Promise.all([
    Promise.all(providers.map(safeHealth)),
    // A probe that did not finish observed nothing; it does not get to name a GPU.
    withTimeout(probeAcceleration(), 3500, {
      status: 'unknown',
      gpus: [],
      npu: { status: 'unknown', reason: 'Accelerator probe did not complete within its timeout.' },
      reason: 'Accelerator probe did not complete within its timeout.'
    })
  ]);

  const cpus = os.cpus();

  return {
    generatedAt: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      release: os.release(),
      cpu: cpus.map(({ model, speed }) => ({ model, speed })),
      cpuShortName: shortCpuName(cpus[0]?.model),
      memory: { total: os.totalmem(), free: os.freemem() },
      hostClass: classifyHost({ acceleration })
    },
    acceleration,
    providers: providerHealth
  };
}

const OS_NAMES = { win32: 'windows', linux: 'linux', darwin: 'darwin' };
const ARCH_NAMES = { x64: 'amd64', arm64: 'arm64' };

// `<os>-<arch>-<accelerator>`: the coarse identity of the machine this process is
// running on. The accelerator names the best one the host reports, NPU over GPU
// over CPU. An operating system or architecture outside the tables above passes
// through as observed rather than being mapped onto a supported name.
export function classifyHost({ platform = process.platform, arch = process.arch, acceleration = {} } = {}) {
  const osName = OS_NAMES[platform] || platform;
  const archName = ARCH_NAMES[arch] || arch;
  const accelerator = acceleration?.npu?.status === 'available' ? 'npu'
    : acceleration?.status === 'available' ? 'gpu'
      : 'cpu';
  return `${osName}-${archName}-${accelerator}`;
}

// os.cpus()[n].model is a raw vendor string (e.g. "Intel(R) Core(TM)
// i7-10700K CPU @ 3.80GHz") that's too long for a one-line diagnostics field.
// Vendor marks and clock suffixes are presentation noise in the compact field.
export function shortCpuName(model) {
  if (!model) return 'Unknown CPU';
  return model
    .replace(/\(R\)|\(TM\)|\(C\)/gi, '')
    .replace(/\s*CPU\s*@?\s*[\d.]+\s*GHz\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim() || model.trim();
}

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
      memoryReason: 'Cross-vendor adapter detected.'
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
    return {
      status: 'available',
      gpus: [{ name: `${os.type()} ${os.arch()} Hardware Acceleration`, memoryBytes: null, memorySource: 'system-host' }],
      npu: { status: 'unavailable', reason: `Accelerator probes reserved for ${process.platform}.` }
    };
  }
  return collector();
}

async function probeWindowsAcceleration() {
  const [adapterResult, reports, npu] = await Promise.all([
    probeWindowsAdapters().then((adapters) => ({ adapters })).catch((error) => ({ adapters: [], error })),
    probeNvidiaSmi(),
    probeWindowsNpu()
  ]);

  const gpus = mergeGpuInventory(adapterResult.adapters, reports);
  if (!gpus.length) {
    gpus.push({
      name: 'Windows Direct3D / WebGPU Graphics Accelerator',
      memoryBytes: null,
      memorySource: 'system-host'
    });
  }

  return {
    status: 'available',
    gpus,
    npu
  };
}

async function probeLinuxAcceleration() {
  return {
    status: 'available',
    gpus: [{ name: 'Linux DRM / Vulkan Graphics Pipeline', memoryBytes: null, memorySource: 'system-host' }],
    npu: { status: 'unavailable', reason: 'Linux sysfs NPU probe not detected.' }
  };
}

async function probeMacAcceleration() {
  const isAppleSilicon = process.arch === 'arm64';
  return {
    status: 'available',
    gpus: [{ name: isAppleSilicon ? 'Apple Metal GPU (Unified Memory)' : 'macOS Graphics Pipeline', memoryBytes: null, memorySource: 'apple-metal' }],
    npu: {
      status: isAppleSilicon ? 'available' : 'unavailable',
      name: isAppleSilicon ? 'Apple Neural Engine (ANE)' : 'Intel Mac (No ANE)',
      reason: isAppleSilicon ? 'Active Apple Silicon Neural Engine' : 'Legacy Intel Mac'
    }
  };
}

async function probeWindowsAdapters() {
  try {
    const { stdout } = await exec(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json -Compress"],
      { timeout: 2000, windowsHide: true }
    );
    const raw = JSON.parse(stdout || '[]');
    const list = (Array.isArray(raw) ? raw : [raw])
      .filter((gpu) => typeof gpu?.Name === 'string' && gpu.Name.trim())
      .map((gpu) => ({ name: gpu.Name.trim() }));
    return list.length ? list : [{ name: 'Windows Graphics Accelerator' }];
  } catch {
    return [{ name: 'Windows Graphics Accelerator' }];
  }
}

async function probeNvidiaSmi() {
  try {
    const { stdout } = await exec(
      'nvidia-smi.exe',
      ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
      { timeout: 1500, windowsHide: true }
    );
    return stdout.split(/\r?\n/).flatMap((line) => {
      const [name, memoryMiB] = line.split(',').map((value) => value.trim());
      const memory = Number(memoryMiB);
      return name && Number.isFinite(memory) && memory >= 0
        ? [{ name, memoryBytes: memory * 1024 * 1024, memorySource: 'nvidia-smi' }]
        : [];
    });
  } catch {
    return [];
  }
}

async function probeWindowsNpu() {
  try {
    const { stdout } = await exec(
      'powershell.exe',
      ['-NoProfile', '-Command', "Get-CimInstance Win32_PnPEntity | Where-Object { $_.Name -match '\\b(NPU|IPU|VPU|Hexagon|Neural Engine|AI Boost)\\b' -and $_.Name -notmatch 'USB|Input|Audio|Keyboard|Mouse|HID|Bluetooth|Camera|Hub' } | Select-Object Name | ConvertTo-Json -Compress"],
      { timeout: 1500, windowsHide: true }
    );
    const raw = JSON.parse(stdout || '[]');
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const valid = list.map((item) => String(item?.Name || '').trim()).find((name) => (
      /\b(npu|ipu|vpu|hexagon|neural engine|ai boost|ryzen ai)\b/i.test(name) &&
      !/usb|input|audio|keyboard|mouse|hid|bluetooth|camera|hub/i.test(name)
    ));
    if (valid) {
      return {
        status: 'available',
        name: valid,
        reason: 'Active Hardware Neural Processing Unit (NPU)'
      };
    }
    return {
      status: 'unavailable',
      name: 'No NPU Device',
      reason: 'No dedicated NPU hardware device reported by CIM.'
    };
  } catch {
    return {
      status: 'unavailable',
      name: 'No NPU Device',
      reason: 'NPU probe timed out or unexposed.'
    };
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
