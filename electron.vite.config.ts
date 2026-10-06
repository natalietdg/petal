import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

// Main and preload are bundled; the renderer is still plain global scripts loaded from src/renderer (Phase 2 moves it here).
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
});
