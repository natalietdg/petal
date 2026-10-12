import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// PASTEL_RELEASE_BUILD=1 (set by scripts/release.sh) compiles the src/dev snapshot harness out of the bundle.
const includeDevHarness = process.env.PASTEL_RELEASE_BUILD !== '1';

export default defineConfig({
  main: {
    define: { __PASTEL_DEV_HARNESS__: JSON.stringify(includeDevHarness) },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/main.ts') } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      // Fonts stay files: the CSP's font-src 'self' does not allow data: URIs.
      assetsInlineLimit: 0,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
