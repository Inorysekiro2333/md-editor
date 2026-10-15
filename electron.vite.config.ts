import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // chokidar 5 是 ESM-only，必须打进 bundle，不能留给 CJS 主进程 require
    plugins: [externalizeDepsPlugin({ exclude: ['chokidar'] })],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: { index: resolve(__dirname, 'electron/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve(__dirname, 'electron/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'packages/app'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'packages/app/index.html') } },
    },
  },
})
