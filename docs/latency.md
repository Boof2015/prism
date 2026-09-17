# Capture-to-render latency

The default Spectrum/Oscilloscope/Vectorscope/VU rack measured about **7 ms median
capture-to-render latency** on an M5 Pro at an observed 120 FPS. Each scope's p95
was below **12 ms** in all three measured repeats, including the software timing
uncertainty. This is a result for the tested macOS desktop setup, not a guarantee
for every machine, capture mode, scope configuration, or platform.

Here, **capture-to-render** means the time from receipt inside Prism's native
CoreAudio capture callback to completion of the scope's canvas drawing commands.
It does not include audio buffering before that callback, GPU/compositor work,
display scanout, or pixel response. It is not a capture-to-physical-display or
sound-to-visible-response measurement.

## Default rack at display-sync

These are the largest per-scope, per-run statistics across three 60-second runs,
not pooled percentiles or a selection of the fastest run.

| Statistic | Time |
| --- | ---: |
| Median | 6.73 ms |
| p95 | 11.42 ms |
| p99 | 12.94 ms |
| Largest individual observation | 15.94 ms |
| Highest p95 after allowing for timing uncertainty | 11.65 ms |

Observed frame cadence was approximately 120 FPS. The largest software timing
uncertainty in these rack runs was ±0.265 ms. The observed maximum is not a
guaranteed upper bound. These measurements do not support an under-8-ms p95 claim.

## Tested setup

The suite ran on September 16, 2026 (America/New_York). Its instrumented source was
based on [`2a2d01d`](https://github.com/Boof2015/prism/commit/2a2d01d32da824d03e60440acd505f3d890a4e6f)
from the `0.3.1` branch. The package version at that commit was `0.3.0-beta`.

| Setting | Value |
| --- | --- |
| Computer | Apple M5 Pro, Mac17,9, 48 GiB memory |
| OS and power | macOS 26.5.1, AC power |
| Runtime | Electron 40.8.3, Chromium 144.0.7559.236 |
| Display | Built-in Retina Display, reported 120.0006 Hz, scale factor 2 |
| Window | 1200 × 360 logical pixels, visible during measurement |
| Capture | Native CoreAudio system-output capture, MacBook Pro Speakers |
| Audio format | 44.1 kHz stereo, 512 sample frames per captured chunk |
| Spectrum | 2048-point FFT, smoothing 0.9, logarithmic scale, default extended range |
| Oscilloscope | Pitch lock enabled |
| Vectorscope | XY/Lissajous, 0 dB zoom, persistence 0.1, multiband off |
| VU | Horizontal bar display, −14 dBFS reference |
| Rolling capture / input gain | Off / 0 dB |

The [result data](benchmarks/2026-09-16/results.json) records the scope settings,
canvas dimensions, runtime versions, stage timings, and per-run statistics. Solo
scopes occupy a larger canvas than each individual scope in the four-scope rack;
these configurations are not identical drawing workloads.

## Procedure and timing

The runner built production bundles and the native addon, verified that native
capture and the selected DSP modules were available, and used an isolated
settings directory. It waited at least two minutes after compilation, including
one continuous minute of nominal macOS thermal state, before launching Prism.

A deterministic, changing stereo signal played through the normal system output
using `afplay`, outside the renderer. The source WAV was 48 kHz PCM16 with a peak
amplitude of 0.025; the capture device delivered 44.1 kHz audio. Frequency steps
and amplitude modulation kept the signal changing throughout each run.

Spectrum alone, Oscilloscope alone, and the default four-scope rack were each
tested at display-sync and the 60 FPS target. Every configuration/target pair had
one frame-only baseline and three instrumented repeats. Each run used 10 seconds
of warmup followed by 60 seconds of measurement: 24 runs in total. A separate
10-second Chromium trace followed the suite.

The instrumentation retained the existing capture, buffering, polling,
scheduling, and analysis behavior. Preallocated buffers recorded capture receipt,
scope consumption, and draw completion, associated by capture session, chunk
sequence, scope, and render frame. Every consumed chunk was counted for each
scope, including multiple chunks consumed in one frame. Frames repainting old
audio added no new latency samples. Recording did not log or write files per
frame; export happened after each measurement.

Before and after each run, 64 native clock reads were bracketed by renderer clock
reads. The narrowest bracket from each endpoint and the measured renderer timer
granularity supplied an offset interval and timing uncertainty. This assumes no
unobserved clock excursion between the endpoints. Impossible timestamp ordering
was rejected, not clamped to zero. Capture-to-receipt durations below resolution
were marked unresolved; those chunks could still have valid capture-to-draw
measurements. Percentiles use the nearest-rank method.

The initial FFT window, pitch-lock acquisition, vectorscope persistence, and meter
smoothing have their own response characteristics. A scope can consume a new
chunk while drawing selected history or smoothed values, so this benchmark does
not establish when a particular sound change becomes visible.

## Results for every repeat

The 60 FPS setting is a requested target. Its observed cadence in this suite was
approximately 53.5–54.5 FPS; display-sync achieved approximately 120 FPS.
In the tables, milliseconds refer to capture-to-draw-command completion. Timing
uncertainty is shown separately; N counts successful chunk/scope associations.

| Configuration | Target | Repeat | Scope | Median ms | p95 ms | p99 ms | Max ms | N | Timing ±ms | Observed FPS |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| spectrum | display-sync | 1 | spectrum | 7.478 | 12.235 | 13.566 | 15.188 | 5169 | 0.213 | 119.988 |
| spectrum | display-sync | 2 | spectrum | 7.749 | 12.832 | 14.216 | 16.641 | 5169 | 0.251 | 120.006 |
| spectrum | display-sync | 3 | spectrum | 8.039 | 13.062 | 14.384 | 16.698 | 5169 | 0.218 | 120.008 |
| oscilloscope | display-sync | 1 | oscilloscope | 7.345 | 12.382 | 13.621 | 15.643 | 5169 | 0.239 | 120.007 |
| oscilloscope | display-sync | 2 | oscilloscope | 7.350 | 12.304 | 13.472 | 15.835 | 5168 | 0.214 | 120.004 |
| oscilloscope | display-sync | 3 | oscilloscope | 7.386 | 12.354 | 13.428 | 16.133 | 5170 | 0.244 | 120.004 |
| default-rack | display-sync | 1 | spectrum | 6.314 | 11.039 | 12.350 | 15.220 | 5168 | 0.265 | 120.001 |
| default-rack | display-sync | 1 | oscilloscope | 6.151 | 10.863 | 12.187 | 15.020 | 5168 | 0.265 | 120.001 |
| default-rack | display-sync | 1 | vectorscope | 6.573 | 11.316 | 12.630 | 15.520 | 5168 | 0.265 | 120.001 |
| default-rack | display-sync | 1 | vumeter | 6.638 | 11.355 | 12.686 | 15.620 | 5168 | 0.265 | 120.001 |
| default-rack | display-sync | 2 | spectrum | 6.391 | 11.097 | 12.603 | 15.534 | 5169 | 0.234 | 120.002 |
| default-rack | display-sync | 2 | oscilloscope | 6.234 | 10.920 | 12.411 | 15.334 | 5169 | 0.234 | 120.002 |
| default-rack | display-sync | 2 | vectorscope | 6.678 | 11.376 | 12.891 | 15.834 | 5169 | 0.234 | 120.002 |
| default-rack | display-sync | 2 | vumeter | 6.728 | 11.419 | 12.944 | 15.834 | 5169 | 0.234 | 120.002 |
| default-rack | display-sync | 3 | spectrum | 6.381 | 10.988 | 12.419 | 15.536 | 5170 | 0.210 | 120.001 |
| default-rack | display-sync | 3 | oscilloscope | 6.199 | 10.857 | 12.257 | 15.336 | 5170 | 0.210 | 120.001 |
| default-rack | display-sync | 3 | vectorscope | 6.669 | 11.279 | 12.721 | 15.836 | 5170 | 0.210 | 120.001 |
| default-rack | display-sync | 3 | vumeter | 6.700 | 11.337 | 12.721 | 15.936 | 5170 | 0.210 | 120.001 |
| spectrum | 60 | 1 | spectrum | 11.899 | 24.290 | 27.972 | 29.993 | 5168 | 0.217 | 53.515 |
| spectrum | 60 | 2 | spectrum | 11.815 | 23.561 | 28.003 | 29.595 | 5168 | 0.228 | 54.002 |
| spectrum | 60 | 3 | spectrum | 12.021 | 24.281 | 28.084 | 29.948 | 5168 | 0.227 | 53.632 |
| oscilloscope | 60 | 1 | oscilloscope | 11.792 | 23.466 | 27.894 | 29.732 | 5169 | 0.214 | 54.092 |
| oscilloscope | 60 | 2 | oscilloscope | 11.665 | 23.237 | 27.628 | 29.966 | 5169 | 0.216 | 54.234 |
| oscilloscope | 60 | 3 | oscilloscope | 11.734 | 23.751 | 28.150 | 30.129 | 5168 | 0.226 | 53.599 |
| default-rack | 60 | 1 | spectrum | 11.839 | 23.937 | 28.069 | 30.498 | 5167 | 0.273 | 54.149 |
| default-rack | 60 | 1 | oscilloscope | 11.678 | 23.749 | 27.934 | 30.298 | 5167 | 0.273 | 54.149 |
| default-rack | 60 | 1 | vectorscope | 12.132 | 24.237 | 28.379 | 30.798 | 5167 | 0.273 | 54.149 |
| default-rack | 60 | 1 | vumeter | 12.159 | 24.268 | 28.444 | 30.898 | 5167 | 0.273 | 54.149 |
| default-rack | 60 | 2 | spectrum | 11.701 | 23.294 | 27.862 | 30.003 | 5167 | 0.252 | 54.492 |
| default-rack | 60 | 2 | oscilloscope | 11.538 | 23.107 | 27.626 | 29.903 | 5167 | 0.252 | 54.492 |
| default-rack | 60 | 2 | vectorscope | 11.984 | 23.607 | 28.126 | 30.303 | 5167 | 0.252 | 54.492 |
| default-rack | 60 | 2 | vumeter | 12.047 | 23.642 | 28.162 | 30.403 | 5167 | 0.252 | 54.492 |
| default-rack | 60 | 3 | spectrum | 11.647 | 23.729 | 27.869 | 30.419 | 5169 | 0.212 | 54.458 |
| default-rack | 60 | 3 | oscilloscope | 11.488 | 23.575 | 27.672 | 30.119 | 5169 | 0.212 | 54.458 |
| default-rack | 60 | 3 | vectorscope | 11.948 | 23.993 | 28.126 | 30.619 | 5169 | 0.212 | 54.458 |
| default-rack | 60 | 3 | vumeter | 11.990 | 24.042 | 28.169 | 30.719 | 5169 | 0.212 | 54.458 |

All 24 runs passed the benchmark's validity checks. The 18 instrumented runs
recorded 93,043 captured chunks and 186,064 successful chunk/scope associations.
There were no recorded native queue overflows, router overwrites, sequence gaps,
missing receipts, invalid timing records, or skipped consumed-chunk draws.

Chunks already queued when observation began and chunks still pending at its end
were reported separately. They were not silently discarded into the successful
sample population. Their counts are included in the result data.

## Probe overhead and thermals

The frame-only baselines disabled chunk probes but retained the frame-duration
recorder and thermal observer. Frame work below is the scope callback duration,
not total process CPU utilization. Differences between sequential runs include
system-load and run-order effects; they are not an exact causal probe cost, and
no correction was subtracted from latency.

| Configuration / target | Scope | Baseline work p95 ms | Probe work p95 range ms | Baseline FPS | Probe FPS range |
| --- | --- | ---: | ---: | ---: | ---: |
| spectrum / display-sync | spectrum | 1.700 | 1.800–1.800 | 120.001 | 119.988–120.008 |
| oscilloscope / display-sync | oscilloscope | 0.900 | 0.900–0.900 | 119.998 | 120.004–120.007 |
| default-rack / display-sync | spectrum | 0.400 | 0.200–0.200 | 120.001 | 120.001–120.002 |
| default-rack / display-sync | oscilloscope | 0.400 | 0.300–0.300 | 120.001 | 120.001–120.002 |
| default-rack / display-sync | vectorscope | 0.600 | 0.400–0.400 | 120.001 | 120.001–120.002 |
| default-rack / display-sync | vumeter | 0.100 | 0.100–0.100 | 120.001 | 120.001–120.002 |
| spectrum / 60 | spectrum | 0.500 | 0.500–0.500 | 53.791 | 53.515–54.002 |
| oscilloscope / 60 | oscilloscope | 0.400 | 0.400–0.400 | 54.280 | 53.599–54.234 |
| default-rack / 60 | spectrum | 0.300 | 0.200–0.300 | 54.258 | 54.149–54.492 |
| default-rack / 60 | oscilloscope | 0.400 | 0.400–0.400 | 54.258 | 54.149–54.492 |
| default-rack / 60 | vectorscope | 0.400 | 0.400–0.400 | 54.258 | 54.149–54.492 |
| default-rack / 60 | vumeter | 0.100 | 0.100–0.100 | 54.258 | 54.149–54.492 |

macOS thermal state remained nominal across all 1,744 recorded observations, and
the machine stayed on AC power. The observer sampled at 1 Hz and recorded OS
notifications into preallocated main-process memory. No CPU speed-limit
notification arrived, so the speed limit was unknown rather than assumed to be
100%. Nominal thermal state does not establish an absence of every frequency
change. Total CPU utilization was not measured.

## Separate presentation estimate

The separate Chromium trace estimated approximately **25 ms median / 30 ms p95**
from native capture receipt to reported presentation for the default rack at
display-sync. Across scopes, medians were 25.20–25.23 ms and p95 values were
30.10–30.16 ms.

All 3,448 successful chunk/scope records were associated with presentation events,
covering 4,804 marked scope frames with no rejected frame associations. Matching
required unique scope markers inside one animation callback and AnimationFrame
interval, exact presentation IDs, matching begin-frame source/sequence IDs, and
a fully presented compositor frame. Temporal proximity alone was not accepted.

These diagnostic estimates include approximately ±0.245 ms of software timing
uncertainty **plus unquantified macOS presentation-estimation error** and the
separate tracing workload. They are not physical display measurements and were
not pooled into the main latency results. Chromium documents the platform limits
of presentation timestamps in [Life of a frame](https://chromium.googlesource.com/chromium/src.git/+/main/docs/life_of_a_frame.md).

## Data and reproduction

- [Per-run statistics and recorded settings](benchmarks/2026-09-16/results.json)
- [Exact benchmark instrumentation patch](benchmarks/2026-09-16/instrumentation.patch)

The statistics file is a summary, not the raw per-chunk timestamps. Raw records,
isolated settings, audio stimulus, and the large Chromium trace are retained
locally and are not included in this repository. The patch contains the runner,
probes, analysis, tests, and methodology needed to make a new measurement.

To reproduce from a checkout containing these documents, create a separate
worktree at the tested source revision and apply the archived patch:

```sh
git worktree add --detach ../prism-latency-repro 2a2d01d32da824d03e60440acd505f3d890a4e6f
git -C ../prism-latency-repro apply "$PWD/docs/benchmarks/2026-09-16/instrumentation.patch"
cd ../prism-latency-repro
npm ci
npm run test:latency
npm run bench:latency
```

Use a Mac with native system-capture support, allow audio-capture permission if
requested, keep Prism visible and connected to AC power, and stop unrelated
playback. The full run takes about 32 minutes including build and cooldown. It
creates a fresh `benchmark-results/` directory with the report and raw records.
`npm run bench:latency -- --quick` is a short diagnostic check, not a replacement
for the full suite. Comparisons need the same machine, display, audio device,
window dimensions, and scope settings.
