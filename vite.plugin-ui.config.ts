import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function inlinePluginUiAssets() {
  const outDir = resolve(__dirname, 'plugin/webview-dist')
  const indexPath = resolve(outDir, 'index.html')
  const scriptPath = resolve(outDir, 'assets/index.js')
  const stylePath = resolve(outDir, 'assets/index.css')

  return {
    name: 'prism-inline-plugin-ui-assets',
    apply: 'build' as const,
    enforce: 'post' as const,
    closeBundle() {
      const script = readFileSync(scriptPath, 'utf8').replace(/<\/script/gi, '<\\/script')
      const style = readFileSync(stylePath, 'utf8').replace(/<\/style/gi, '<\\/style')
      let html = readFileSync(indexPath, 'utf8')
      let inlinedScript = false
      let inlinedStyle = false

      html = html.replace(
        /<script type="module" crossorigin src="\.\/assets\/index\.js"><\/script>/,
        () => {
          inlinedScript = true
          return `<script type="module">\n${script}\n</script>`
        }
      )
      html = html.replace(
        /<link rel="stylesheet" crossorigin href="\.\/assets\/index\.css"\s*\/?>/,
        () => {
          inlinedStyle = true
          return `<style>\n${style}\n</style>`
        }
      )

      if (! inlinedScript || ! inlinedStyle) {
        throw new Error('Failed to inline plugin UI assets into index.html')
      }

      writeFileSync(indexPath, html)
      rmSync(resolve(outDir, 'assets'), { recursive: true, force: true })
    },
  }
}

/**
 * Standalone Vite build for the plugin webview UI (src/plugin-ui).
 *
 * - dev:   `npx vite --config vite.plugin-ui.config.ts` serves on :5174, which
 *          the JUCE plugin's WebBrowserComponent points at for hot reload.
 * - build: emits a self-contained static HTML bundle. The C++ side embeds it;
 *          Linux writes it to a local file before loading to avoid custom-scheme
 *          WebKitGTK issues in DAW hosts.
 *
 * Reuses the existing visualizer source under src/renderer via relative imports.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/plugin-ui'),
  base: './',
  plugins: [react(), inlinePluginUiAssets()],
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
