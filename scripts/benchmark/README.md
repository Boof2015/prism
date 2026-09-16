# Local capture-to-render submission benchmark

This branch observes Prism's native macOS system-audio capture and its existing
Spectrum, Oscilloscope, Vectorscope, and VU render paths. It does not change capture
buffers, polling delays, frame scheduling, DSP settings, or analysis algorithms.

## Run

```sh
npm run test:latency
npm run typecheck
npm run bench:latency -- --quick
npm run bench:latency
```

The full run takes approximately 29 minutes. Keep the benchmark window visible
and avoid changing display settings or audio devices during measurement. A quiet,
changing stereo tone plays through the current default output using `afplay`.
Other system audio is captured too; stop unrelated playback for a controlled run.
No physical measurement equipment or virtual audio driver is needed.

The runner builds production renderer/main/preload bundles and rebuilds the native
addon for the installed Electron version. It verifies native exports in that
Electron runtime and refuses to benchmark a missing native capture or DSP module.
The benchmark preload uses the checkout's native addon path; it does not set
`NODE_ENV=development`. macOS may request audio-capture permission for Electron.

Use `--output benchmark-results/my-run` to choose a new artifact directory. Existing
run directories are never overwritten. Each run uses its own Electron user-data
directory, leaving regular Prism preferences untouched. Nothing is pushed, merged,
or installed. `out/` and the native build output are regenerated as usual.

`--quick` exercises all configurations with 2-second warmups and 3-second samples.
Quick results are always marked diagnostic and cannot produce publication wording.

The full matrix uses Spectrum alone, Oscilloscope alone, and the default four-scope
rack. Each configuration runs at display-sync and the 60 FPS target. Each cell has
one 60-second frame-only baseline and three 60-second probe runs, each preceded by
10 seconds of warmup. The fixed window is 1200×360 logical pixels. Default scope
settings are applied without reducing FFT size, smoothing, persistence, or pitch
locking to obtain a faster result.

## What is measured

Each native chunk retains its existing monotonic capture timestamp and sequence.
The observer records renderer receipt, scope consumption, and the end of the
successful draw invocation that consumed it. All chunks in a batch are counted,
once per scope; multiple chunks can share one render frame. Repainting old state
without consuming new chunks adds no latency samples.

The endpoint is completion of canvas drawing commands on the renderer thread.
This is **not** GPU completion, compositor presentation, pixel illumination, or
the first visible response to a specific sound. The start is inside the native
capture callback, **not** the original sample's hardware time. Audio buffering
before that timestamp is excluded. A scope can render selected history or
smoothed values after consuming newer data; FFT windows, pitch locking, and meter
ballistics require a separate signal-response experiment.

64 native-clock reads, bracketed by `performance.now()`, are taken before and after
each run. The narrowest bracket at each endpoint is selected and the union bounds
the clock offset. Raw clock samples, drift, uncertainty, and each stage's timing
are retained. The method assumes no unobserved clock excursion between endpoints.
Renderer timer granularity is measured outside each run. Calibration intervals are
widened by that quantum (at least 0.1 ms), with another quantum allowed at the draw
endpoint. Impossible ordering is rejected; receipt durations below resolution are
reported as unresolved instead of clamped to zero.

Native queue overwrites, sequence gaps, trimmed chunks, router overwrites, missing
receipt metadata, observer-buffer exhaustion, skipped draws, and session changes
are reported. Chunks queued before observation began and chunks still queued at
stop are reported as boundaries, not successful latency samples. Invalid runs
cannot produce claim wording.

Observation uses preallocated typed arrays. Capture and draw hot paths do not
write files, log events, or allocate record objects. Export and percentile sorting
happen after stopping observation. The frame-only baseline retains the same small
frame recorder but disables chunk probes. Its difference from probe runs is an
observed workload difference, not an exact correction; nothing is subtracted.

## Artifacts and reporting

Each output directory contains:

- `REPORT.md` and `summary.json`: results, losses, clock bounds, overhead comparison,
  stage distributions, and supported wording.
- Per-run JSON: every chunk, chunk/scope/frame association, frame interval, clock
  calibration sample, router counters, scope settings, and canvas dimensions.
- `source-manifest.json` and `benchmark.patch`: exact base commit, source hashes,
  instrumentation patch, and version. New untracked source files are included.
- `native-build.json`: native addon hash and Electron version.
- `machine.json`, `stimulus.json`, and `stimulus.wav`: machine/display/runtime and
  deterministic external test signal.
- `chromium-trace.json` and `trace-measurement.json`: a separate presentation
  investigation, excluded from latency claims.

Regenerate a report with:

```sh
npm run bench:latency:report -- benchmark-results/my-run
```

Rows are compact arrays with explicit `chunkColumns`, `recordColumns`, and
`frameColumns` in the same JSON. Scope indices refer to `scopes`. Record outcomes
are 1 (successful draw), 0 (skipped draw), or -1 (missing receipt metadata). JSON
uses null for unavailable numeric timestamps; the analyzer rejects those records.

A claim names the hardware, capture path, configuration, version/base commit, and
measurement endpoint. Median/p95 wording uses the largest per-run statistic across
all three repeats rather than selecting the best run. An under-8-ms p95 statement
requires every valid repeat's uncertainty-adjusted p95 to be below 8 ms. Observed
maxima are not universal bounds. An instrumented-build result must not be presented
as an uninstrumented physical-display measurement.

The separate trace contains `prism.frame.<id>.<scope>.start/end` marks. Do not infer
presentation from the nearest unrelated compositor event or add a nominal refresh
interval. If chunk→frame→presentation cannot be established unambiguously,
presentation remains unavailable. The report attempts a strict association through
the enclosing RAF task and AnimationFrame interval, exact presentation ID and
begin-frame source/sequence, and a fully presented compositor frame. Links and
rejections are exported in `presentation-investigation.json`. Any resulting
estimate is kept separate from the main measurements and publication wording.
Chromium also documents estimated presentation
feedback on some platforms, including macOS:
https://chromium.googlesource.com/chromium/src.git/+/main/docs/life_of_a_frame.md

## Build isolation

`scripts/benchmark/electron.config.mjs` adds only the benchmark compile-time flag
to the effective defaults used by the existing build command. The repository's
`electron-vite.config.ts` is not auto-discovered by Electron Vite, which expects
`electron.vite.config.*`; the benchmark does not change normal config discovery.
Normal builds never install the benchmark renderer controller or allocate probe
buffers. The branch-only main-process runner requires the explicit benchmark
environment and output directory.
