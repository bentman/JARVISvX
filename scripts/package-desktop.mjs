import path from 'node:path';
import { packager } from '@electron/packager';

const root = path.resolve('.');
// Node 26 can conclude that the event loop is idle while extract-zip has an
// outstanding archive operation. Keep the process alive until Packager settles.
const keepAlive = setInterval(() => {}, 1_000);

try {
  const appPaths = await packager({
    dir: root,
    name: 'JARVISvX',
    platform: 'win32',
    arch: 'x64',
    out: path.join(root, 'release'),
    overwrite: true,
    asar: { unpack: '**/{onnxruntime-node,npyz,node-stream-zip}/**' },
    icon: path.join(root, 'src', 'icon', 'icon.ico'),
    extraResource: [
      path.join(root, 'src', 'icon', 'icon.ico'),
      path.join(root, 'src', 'icon', 'icon.png')
    ],
    tmpdir: path.join(root, 'cache', 'temp'),
    ignore: [
      '/(?:cache|data|models|docs|test|release)(?:/|$)',
      '/(?:ProjectPlan|ProjectVision)\\.md$'
    ]
  });

  console.log(`Wrote desktop bundle: ${appPaths.join(', ')}`);
} finally {
  clearInterval(keepAlive);
}
