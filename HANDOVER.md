# Prism fork handover

## Repository

- Local checkout: `C:\Users\Almig\prism`
- Fork: `https://github.com/PB-Kronos/prism`
- Upstream: `https://github.com/Boof2015/prism.git`
- Working branch: `feature/asio-multichannel-modules`
- Open PR page: `https://github.com/PB-Kronos/prism/pull/new/feature/asio-multichannel-modules`

## Product goal

Turn Prism into a reliable Windows multichannel audio-analysis workspace. The essential workflow is one multichannel ASIO device (especially VB-Audio Matrix VASIO) with independently routed stereo channel pairs for each visualizer module.

## Implemented

- Native Windows audio module and ASIO capture.
- Per-scope stereo channel-pair routing.
- Multiple instances of supported module types with independent settings.
- Optional linked settings between the primary module and added instances.
- Profile persistence for added instances, workspace order, and spans.
- Three-column two-dimensional module grid with drag ordering and W1-W3/H1-H3 spans.
- Pitch as a normal first-class module plus duplicate Pitch instances.
- Bass VU Meter as a duplicate-able module. It reuses the normal VU display and calibration controls but filters its independently routed input through a Butterworth low-pass with a configurable 20-350 Hz cutoff (120 Hz default).
- Auto Pitch roles: main needle targets vocals; secondary/dim needle targets bass/sub-bass.
- Pitch tracking uses smoothing, target hold, and delayed switching to prevent transient/overtone jumping.
- Pitch detection runs in one shared Web Worker capped at two analyses per second globally. The canvas interpolates between detector results, and queued work is replaced by the newest buffer per Pitch tile, preventing duplicate Pitch modules from starving other visualizers.
- Disabled native Windows app-bar docking because it caused Explorer/taskbar flashing and crashes.
- Prevented settings-driven window resizing and out-of-bounds windows.

## Critical Pitch regression and fix

Pitch originally had an unconstrained canvas. On a display scaled to roughly 114.6%, assigning the backing-store width changed its CSS layout width, which then caused another larger resize on every frame. GPU memory reached multiple gigabytes and could freeze the whole machine.

The canvas is now explicitly `width: 100%; height: 100%`, its backing store only changes when the actual tile size changes, and the docked router correctly requests Pitch audio. Do not remove these constraints.

## Build and launch

```powershell
cd C:\Users\Almig\prism
npm run typecheck
npm run build
npm run preview
```

For development, `npm run dev` works but rebuild/reload behavior can reset transient settings. Prefer `npm run preview` for interactive validation.

If Prism causes system lag, stop the repository Electron tree immediately:

```powershell
Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
  Where-Object { $_.ExecutablePath -like 'C:\Users\Almig\prism\*' } |
  ForEach-Object { taskkill /F /PID $_.ProcessId /T }
```

## Next validation

1. Restart Prism so the latest worker-based Pitch implementation is loaded.
2. Route a vocal-heavy stereo pair into Pitch Auto mode and verify the pink/main needle stays on the vocal fundamental.
3. Add bass/sub-bass and verify the dim/secondary needle follows it independently.
4. Confirm note changes are smooth and a new note must remain dominant briefly before switching.
5. Add two or more Pitch instances and verify Spectrum/VU animations remain responsive.
6. Monitor all repository Electron processes for CPU and memory growth for at least one minute.
7. Save and reload a profile containing primary and added instances with a nontrivial grid arrangement.

## Known limitations

- Pitch detection is practical spectral tracking, not source separation. Dense mixes with overlapping vocal and bass harmonics can still confuse it.
- Primary Pitch popout is intentionally unavailable; the docked module works, but the popout renderer has not been implemented.
- Some underlying native analyzers remain singleton-based, so deep DSP state isolation between duplicate non-Pitch analyzers needs continued testing.
- The settings panel is not a spatial mirror of the workspace grid.
- Interactive audio behavior must be tested with the user's actual VB-Audio Matrix routing; successful typecheck/build alone is not proof of tracking accuracy.

## Verification expectations

Before pushing further changes, run `npm run typecheck`, `npm run build`, relevant profile/renderer tests, and a controlled runtime memory/CPU sample. Never leave an unmonitored Prism run active after observing rapid growth, taskbar flashing, or system-wide lag.
