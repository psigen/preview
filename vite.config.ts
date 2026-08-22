/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// occt-import-js is an emscripten UMD bundle whose Node branch references `path` and `crypto`.
// That branch is never taken in the browser because we hand it `wasmBinary` directly
// (see docs/SPIKES.md S2), but Vite still warns about externalising them. Alias the bare
// specifiers to an empty stub so a real warning is never lost in the noise. Our own code always
// uses the `node:` prefix, so this cannot shadow a genuine import.
const emptyModule = fileURLToPath(new URL('./scripts/empty-module.js', import.meta.url));

export default defineConfig({
  // Relative base so the build works under user.github.io/<repo>/ or a custom domain.
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^path$/, replacement: emptyModule },
      { find: /^crypto$/, replacement: emptyModule },
    ],
  },
  test: {
    projects: [
      {
        // The mandatory tier: pure logic, loaders, and every format's parse path.
        extends: true,
        test: {
          name: 'lib',
          environment: 'node',
          include: ['src/lib/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.jsdom.test.ts', '**/*.browser.test.ts'],
          testTimeout: 30_000, // a cold OCCT wasm compile
        },
      },
      {
        // Only for code that genuinely needs a DOM: 3MF (DOMParser), FBX (window), hooks.
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['src/**/*.jsdom.test.ts', 'src/{hooks,components}/**/*.test.tsx'],
        },
      },
      {
        // Optional tier, non-blocking in CI: DRACO, KTX2, real workers, WebGL.
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
        },
      },
    ],
    coverage: { provider: 'v8', include: ['src/lib/**'] },
  },
});
