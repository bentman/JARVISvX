import globals from 'globals';

// A correctness check, not a style gate: `no-undef` is the only rule, so this
// run has nothing to say about formatting and cannot become a source of churn.
export default [
  {
    files: ['lib/**/*.mjs', 'bin/**/*.mjs', 'electron/**/*.mjs', 'scripts/**/*.mjs', 'test/**/*.mjs', '*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // The Electron preload is CommonJS and runs against a browser-side window.
    files: ['electron/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: { 'no-undef': 'error' },
  },
  {
    // The renderer worker source is loaded as text and evaluated in the worker.
    files: ['electron/kokoro-onnx-worker.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.worker } },
  },
];
