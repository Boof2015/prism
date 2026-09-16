// The existing `npm run build` uses electron-vite's defaults: its auto-discovery
// expects electron.vite.config.*, whereas this repo has electron-vite.config.ts.
// Preserve those effective defaults; add only the benchmark compile-time flag.
export default {
  main: {},
  preload: {},
  renderer: { define: { __PRISM_LATENCY_BENCHMARK__: 'true' } },
}
