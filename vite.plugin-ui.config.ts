import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Standalone Vite build for the plugin webview UI (src/plugin-ui).
 *
 * - dev:   `npx vite --config vite.plugin-ui.config.ts` serves on :5174, which
 *          the JUCE plugin's WebBrowserComponent points at for hot reload.
 * - build: emits a static bundle the C++ side can later serve via JUCE's
 *          resource provider (production path; not used by the dev-server POC).
 *
 * Reuses the existing visualizer source under src/renderer via relative imports.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/plugin-ui'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'plugin/webview-dist'),
    emptyOutDir: true,
    // Stable (unhashed) asset names so the C++ resource provider can map them
    // deterministically and CMake's embedded BinaryData symbols stay stable.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
