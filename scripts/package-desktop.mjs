import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve('.');

// Declared desktop targets. A platform/arch pair outside this table is refused
// before packaging starts rather than producing a bundle with the wrong icon or
// native runtime.
export const TARGETS = {
  'win32-x64': { platform: 'win32', arch: 'x64', icon: 'icon.ico' },
  'linux-x64': { platform: 'linux', arch: 'x64', icon: 'icon.png' },
};

export const PACKAGE_IGNORE = [
  '/(?:cache|data|models|docs|test|release)(?:/|$)',
  '/\\.jarvis(?:/|$)',
  '/\\.env',
  '/(?:ProjectPlan|ProjectVision)\\.md$'
];

const flag = (argv, name) => { const index = argv.indexOf(`--${name}`); return index === -1 ? null : argv[index + 1] || null; };

export function selectTarget(argv = [], host = process) {
  const platform = flag(argv, 'platform') || host.platform;
  const arch = flag(argv, 'arch') || host.arch;
  const key = `${platform}-${arch}`;
  const target = TARGETS[key];
  if (!target) throw new Error(`No desktop target for "${key}". Declared targets: ${Object.keys(TARGETS).join(', ')}.`);
  return { key, ...target };
}

export function packagerOptions(target) {
  return {
    dir: root,
    name: 'JARVISvX',
    platform: target.platform,
    arch: target.arch,
    out: path.join(root, 'release'),
    overwrite: true,
    // Native binaries load from disk, not from inside the archive.
    asar: { unpack: '**/{onnxruntime-node,npyz,node-stream-zip}/**' },
    icon: path.join(root, 'src', 'icon', target.icon),
    extraResource: [
      path.join(root, 'src', 'icon', 'icon.ico'),
      path.join(root, 'src', 'icon', 'icon.png')
    ],
    tmpdir: path.join(root, 'cache', 'temp'),
    ignore: PACKAGE_IGNORE
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = selectTarget(process.argv.slice(2));
  // Node 26 can conclude that the event loop is idle while extract-zip has an
  // outstanding archive operation. Keep the process alive until Packager settles.
  const keepAlive = setInterval(() => {}, 1_000);
  try {
    const { packager } = await import('@electron/packager');
    const appPaths = await packager(packagerOptions(target));
    console.log(`Wrote ${target.key} desktop bundle: ${appPaths.join(', ')}`);
  } finally {
    clearInterval(keepAlive);
  }
}
