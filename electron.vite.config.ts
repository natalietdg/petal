import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
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
