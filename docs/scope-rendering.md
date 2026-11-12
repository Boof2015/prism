# Scope rendering optimization

Prism ports the rendering changes from Astra's `4b629a9`, `6a0ba26`,
`6ce5c8d`, `561ff19`, `e666c13`, and `f1711e7`, plus the spectrum geometry
and optional heatmap work from `625bf65`. The changes are in the shared
renderer classes used by the desktop strip, popouts, and plugin WebViews.
Native DSP, sample counts, FFT sizes, frame targets, public settings, and
bridge formats are unchanged.

## Rendering and lifetime

Spectrogram and waveform keep their history in circular canvases. New columns
overwrite only the oldest pixels; presentation uses at most two image draws.
Spectrogram converts batches into reusable packed RGBA strips and uploads at
most two dirty rectangles per batch. Its scratch allocation is capped at one
screen and released on resize/disposal. Resize first unwraps history, then
retains the existing newest-edge anchoring. DAW timeline columns remain in
chronological coordinates and advance by the original, unclipped batch count.

Spectrum caches frequency geometry independently of the current magnitudes.
The cache includes pixel width, input length, frequency bounds, Nyquist, scale,
and tilt reference. Reference overlays and difference curves continue to use
their own input data, peak results, and output arrays. Disabled heatmaps skip
raw reads, smoothing, and projection; re-enabling primes the current available
snapshot without resetting the primary analyzer. Formatted heat colors retain
both palette index and rounded alpha in their key. Gradient caching includes
the separate difference-mode gradient.

Only multiband vectorscope uses WebGL2. Dots remain independent ordered
instances, preserving overlap brightness and persistence. The renderer probes
Canvas antialiasing on a separate tiny surface, never reading the live trail.
It reuses CPU attributes and orphans GPU buffer storage before uploading the
next batch. Ordinary mode remains Canvas. Initialization failure, unsupported
colors or geometry, unfamiliar calibration, and context loss fall back to
Canvas without retrying every frame. Recoverable trails transfer to Canvas;
context loss discards GPU pixels. Mode changes and disposal release the private
context, buffers, programs, vertex array, and event listener.

Oscilloscope caches its underfill gradient by height and colors. LUFS caches
reuse parsed colors, contrast calculations, and fixed-label widths. Text widths
are bounded to 256 entries and invalidated by resize/options and the owning
document's font loading events. Disposal removes the font listeners. Dynamic
LUFS readouts reuse a measurement only within the same frame.
The VU cache candidate was withheld after CPU regression checks; its renderer
remains unchanged.

## Verification

Automated coverage includes circular history ordering, transparent erasure,
wraparound and oversized batches, newest-edge resize, mono/stereo and native/JS
waveforms, exact heat colors, bounded/font-aware meter caches, GPU calibration,
ordered overlapping dots, buffer reuse, context loss, and resource disposal.
Renderer helper tests additionally cover disabled/re-enabled heatmaps, geometry
invalidation, ordinary/difference gradients, underfill lifetime, references,
peak readouts, and DAW timelines.

Local real-browser comparisons on macOS used deterministic PCM or plugin bridge
frames at DPR 1 and 2. The visual fixtures freeze the JavaScript clock and replay
fixed meter snapshots so wall-clock peak decay cannot cause false differences.
They cover multiple sizes, backgrounds, themes, orientation, reference modes,
all five vectorscope projections, full persistence, resize/reset/pause, native
and JS paths, unavailable WebGL, context loss, and disposal. Every fixture opens
fresh scopes and checks that disposing them releases frame subscriptions.

- Electron 40.8.3 / Chromium 144: 240 paired scope comparisons passed.
- WKWebView with the real plugin bridge adapters: 136 paired comparisons passed.
- A final rerun of the combined layout and populated bridge reference curves
  passed another 11 comparisons in each engine after withholding the VU cache.
- Canvas captures matched in premultiplied RGBA. GPU differences were at most
  3/255 ordinarily and 7/255 under full persistence in Electron; WebKit maxima
  were 2.60/255 and 4.33/255 respectively.

The browser tests exercise the actual shared renderers and plugin bridge
adapters. They do not automate the desktop shell/popout window controls, launch
a DAW, test plugin installation, or exercise a
Windows WebView2 or Linux WebKitGTK runtime. Those platform results are not
inferred from the Mac checks.

## CPU measurements

Local measurements used an Apple M5 Pro (15 CPU cores), macOS/Darwin 25.5.0,
and Electron 40.8.3 / Chromium 144.0.7559.236. Each pair replayed the same
48 kHz stereo PCM, settings, 420 × 210 CSS-pixel scopes, and DPR 2. Three
paired rounds alternated baseline-first and optimized-first order, with two
seconds of warmup and six seconds measured per trial. The baseline is Prism
`4972180`. Isolated/stage rows change only the corresponding renderer files.
The initial sweep below included the subsequently withheld VU candidate.
Values are means, not whole-app CPU
forecasts. CPU milliseconds per elapsed second sum all Electron processes;
1,000 ms/s represents one fully occupied CPU core.

| Case | Baseline CPU ms/s | Optimized CPU ms/s | Reduction | Working set MB, before → after |
| --- | ---: | ---: | ---: | ---: |
| Spectrum, heatmap | 276.7 | 266.4 | 3.7% | 433.9 → 423.1 |
| Spectrum, heatmap disabled | 241.7 | 234.5 | 3.0% | 423.1 → 432.5 |
| Oscilloscope | 217.5 | 221.5 | −1.9% | 425.3 → 429.9 |
| Spectrogram | 384.2 | 342.3 | 10.9% | 410.1 → 412.6 |
| Waveform, stereo/multiband | 233.1 | 221.4 | 5.1% | 403.8 → 407.9 |
| Vectorscope, multiband | 504.5 | 282.2 | 44.1% | 485.9 → 453.6 |
| Needle VU candidate (withheld) | 207.6 | 237.0 | −14.2% | 457.2 → 455.7 |
| LUFS | 212.1 | 210.1 | 0.9% | 433.7 → 415.8 |
| GPU stage in mixed layout | 602.7 | 405.9 | 32.7% | 448.6 → 459.0 |
| History stage in mixed layout | 466.9 | 413.2 | 11.5% | 442.1 → 444.6 |
| Small caches in mixed layout | 376.1 | 356.7 | 5.1% | 443.9 → 445.0 |
| All seven scopes, 60 Hz | 578.7 | 400.5 | 30.8% | 465.9 → 464.9 |
| All seven scopes, 120 Hz | 846.4 | 550.7 | 34.9% | 463.9 → 460.8 |
| Hidden scopes, 60 Hz | 6.7 | 7.5 | — | 449.8 → 432.9 |
| Hidden scopes, 120 Hz | 10.5 | 10.5 | — | 450.7 → 445.5 |

All measured cases delivered their requested average 60/120 callbacks per
second. Combined-layout mean p95 frame intervals were 18.17 → 18.20 ms at
60 Hz and 9.57 → 9.43 ms at 120 Hz. These are harness callbacks, not a
measurement of physical display refresh. Hidden controls contain no active
scopes; their small nonzero CPU is the browser and scheduling floor.

Vectorscope, spectrogram, and their mixed layouts improved in every pair.
Combined reductions ranged from 29.3–33.4% at 60 Hz and 30.4–38.4% at 120 Hz.
Spectrum, waveform, oscilloscope, LUFS, and the small-cache mixed layout varied
in sign across pairs; their small mean changes do not establish a repeatable
gain.

A focused follow-up used five reversed-order pairs, three seconds of warmup,
and ten seconds measured. VU averaged 168.2 → 180.4 CPU ms/s (+7.2% CPU).
Individual results varied, but the aggregate was worse in both experiments;
the VU candidate is withheld under the regression acceptance rule. LUFS
averaged 179.9 → 176.1 CPU ms/s (2.1% lower), improving in four of five pairs.
The variation is too large to claim a reliable LUFS speedup.

The accepted patch (VU unchanged) was then remeasured in three additional
paired rounds with the same two-second warmup and six-second interval:

| Accepted patch | Baseline CPU ms/s | Optimized CPU ms/s | Reduction | Working set MB, before → after |
| --- | ---: | ---: | ---: | ---: |
| All seven scopes, 60 Hz | 576.2 | 412.8 | **28.4%** | 477.7 → 484.9 |
| All seven scopes, 120 Hz | 796.9 | 545.5 | **31.5%** | 497.2 → 496.3 |
| Hidden scopes, 120 Hz | 11.6 | 8.4 | — | 462.6 → 465.6 |

All accepted combined-layout pairs improved: 26.8–29.2% at 60 Hz and
31.2–32.0% at 120 Hz. Average callback delivery remained 60/120 Hz. Mean
p95 frame intervals were 17.57 → 18.03 ms and 9.23 → 9.27 ms respectively.
Working set varied across trials, with no consistent memory reduction. The
hidden-control difference changed sign between pairs and is not an optimization
gain.

WKWebView used the same sizes, targets, and three paired rounds with plugin
bridge snapshots. Its CPU total includes the harness, WebContent, graphics,
and networking processes created for the run; it excludes native DSP and DAW
host processing. This workload also includes deterministic snapshot generation.

| Accepted patch in WKWebView, 120 Hz | Baseline CPU ms/s | Optimized CPU ms/s | Reduction | Working set MB, before → after |
| --- | ---: | ---: | ---: | ---: |
| Multiband vectorscope | 811.8 | 352.3 | 56.6% | 493.8 → 505.2 |
| All seven scopes | 983.4 | 642.9 | 34.6% | 562.9 → 588.1 |

All active-scope pairs improved and delivered 119.9–120.0 callbacks/s on
average, with 12 ms mean p95 frame intervals in both variants. The combined
working set was about 25 MiB higher after optimization. These are process
snapshots across repeated page loads, not isolated GPU allocation measurements.
The first two empty-page control pairs delivered their target and averaged
11.7 → 12.5 CPU ms/s. The third optimized empty-page control was throttled to
31 callbacks in 6.24 seconds, with 1,000 ms p95 intervals; that pair is invalid
for CPU comparison and is retained in the raw record. No active-scope trial
had that throttling.

[Per-trial CPU, frame, memory, process, and pixel-check evidence](benchmarks/2026-11-12-scope-rendering/results.json)
is checked in. The [withheld VU candidate](benchmarks/2026-11-12-scope-rendering/vu-candidate.patch)
is retained only as a patch for reproducing its measurements; it is not applied
to the renderer.

## Reproducing the checks

Run `npm run test:scope-rendering`, `npm run test:renderer-helpers`, and
`npm run typecheck`. The browser harness is separate from the headless unit
suite because it opens a real window and requires GPU/browser access:

```sh
node scripts/scope-rendering/run.mjs --output /tmp/prism-scope-visual
node scripts/scope-rendering/run.mjs --webkit --output /tmp/prism-scope-webkit
node scripts/scope-rendering/run.mjs --benchmark --stages --output /tmp/prism-scope-bench
node scripts/scope-rendering/summarize.mjs /tmp/prism-scope-bench/benchmark-results.json
node scripts/scope-rendering/run.mjs --webkit --benchmark --filter '^(vectorscope|all-120|hidden-120)$' --output /tmp/prism-scope-webkit-bench
```

`--webkit` requires macOS and the Swift SDK. `--baseline` defaults to `4972180`.
`--filter` takes a regular expression over case names; `--rounds`, `--warmup`,
and `--seconds` customize paired timing runs. `--prepare` writes bundles and a
manifest without opening a window. Baseline sources are exported into the output
directory without switching or modifying the working tree. Stage builds replace
only the relevant renderer files. No audio is captured, played, or sent to a DAW.

Visual runs write paired PNG/RGBA images and `visual-comparisons.json`.
Benchmarks write `benchmark-results.json` with per-process CPU, memory, frame
counts, and draw/frame timing. CPU time includes the Electron browser, renderer,
graphics and utility processes. The benchmark exercises native analysis and the
shared renderers; it excludes live capture/IPC, React layout, and DAW processing.
It is not a battery, temperature, or whole-application energy measurement.

## Local validation limitations

All 223 renderer-helper tests and 31 focused history/GPU/cache tests passed.
The desktop and plugin UI production builds, typecheck, reference-track tests, native
spectrum/spectrogram/vectorscope/LUFS regressions, and DAW bridge tests passed.
The three existing native plugin CTest binaries also passed. A fresh
`npm run test:plugins` configuration is blocked by this checkout's existing
`CLAP_JUCE_EXTENSIONS_PATH=/private/tmp/prism-clap-juce-extensions`, whose source
directory no longer exists. This change does not alter that build setting.
