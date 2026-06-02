# Prism — DAW plugins

JUCE 8 plugins (VST3 / AU / Standalone) that render Prism's scopes inside a DAW —
one plugin per scope: **spectrum, oscilloscope, vectorscope, spectrogram, VU meter,
loudness meter, waveform**. They **reuse Prism's existing C++ DSP** (`native/src/*.cpp`)
and the **existing React canvas UI** (`src/plugin-ui`, importing the unchanged
visualizers from `src/renderer/visualizers/`). VST3 is built for macOS, Windows,
and Linux; AU is macOS-only.

## How it fits together

```
DAW track audio
  → processBlock (RT thread): mix to mono, write to lock-free FIFO     [Source/PluginProcessor.cpp]
  → 60 Hz timer (message thread): drain FIFO → Visualizer::Spectrum    [Source/PluginEditor.cpp + native/src/spectrum.cpp]
  → emit "spectrumFrame" (base64 Float32 magnitudes) to the webview
  → juceBridge.ts decodes → BridgeSpectrumAnalyzer (a SpectrumNativeAnalyzer shim)
  → SpectrumAnalyzer.ts renders to canvas (unchanged Electron code)    [src/plugin-ui]
```

No DSP or allocation runs on the realtime audio thread; audio passes through unmodified.

## Build & run (macOS)

Prereqs: CMake ≥ 3.22, Xcode command-line tools, Node.

### Default: self-contained build (embedded UI)

The UI is bundled into the plugin binary and served via JUCE's resource provider —
**no dev server needed at runtime.**

```sh
npm run plugin-ui:build                                   # build the webview bundle → plugin/webview-dist
cmake -B plugin/build -S plugin -DCMAKE_BUILD_TYPE=Release # embeds the bundle (reconfigure to pick up UI changes)
cmake --build plugin/build --config Release
```

`COPY_PLUGIN_AFTER_BUILD` installs all seven plugins into your user plugin folders:
- AU:   `~/Library/Audio/Plug-Ins/Components/Prism *.component`
- VST3: `~/Library/Audio/Plug-Ins/VST3/Prism *.vst3`

Load any `Prism *` AU / VST3 on a track in Ableton / FL / Logic / Reaper (or run the
matching **Standalone** from `plugin/build/Prism*_artefacts/Release/Standalone/`),
play audio, and the scope animates.
(To use a local JUCE checkout instead of fetching: add `-DJUCE_PATH=/path/to/JUCE`.)

### UI development: dev-server mode (hot reload)

```sh
npm run plugin-ui:dev                                      # serve UI on :5174 with HMR
cmake -B plugin/build -S plugin -DPRISM_DEV_SERVER=ON      # editor loads http://localhost:5174
cmake --build plugin/build --config Release
```

Edit React → the plugin window hot-reloads. The UI also runs in a plain browser at
`http://localhost:5174` (no JUCE host → it shows a synthetic spectrum so the UI is
developable outside a DAW). Reconfigure without `-DPRISM_DEV_SERVER=ON` to go back to embedded.

## Build & run (Windows)

Prereqs: Visual Studio 2022 with the "Desktop development with C++" workload,
CMake ≥ 3.22, Node.js. Modern Win10 / Win11 ships with the Microsoft Edge WebView2
Runtime preinstalled; if it's missing, install the "Evergreen Standalone Installer"
from Microsoft.

```sh
npm install
npm run plugin-ui:build
cmake -B plugin\build -S plugin -G "Visual Studio 17 2022" -A x64
cmake --build plugin\build --config Release
```

`COPY_PLUGIN_AFTER_BUILD` targets the system VST3 folder
(`C:\Program Files\Common Files\VST3\Prism *.vst3`), which **needs admin
privileges**. Either run the `cmake --build` step from an elevated shell, or copy
the built bundles from `plugin\build\Prism*_artefacts\Release\VST3\` into your
user-local VST3 folder (`%LOCALAPPDATA%\Programs\Common\VST3\`) by hand — most
DAWs scan both.

Dev-server mode works the same as macOS: `-DPRISM_DEV_SERVER=ON` + `npm run plugin-ui:dev`.

## Build & run (Linux)

Prereqs: CMake >= 3.22, Ninja, GCC/Clang, Node.js, and JUCE's Linux GUI/WebView
dependencies. On Ubuntu 24.04+:

```sh
sudo apt-get install build-essential cmake ninja-build pkg-config \
  libasound2-dev libjack-jackd2-dev ladspa-sdk libcurl4-openssl-dev \
  libfreetype-dev libfontconfig1-dev libx11-dev libxcomposite-dev \
  libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev \
  libwebkit2gtk-4.1-dev libglu1-mesa-dev mesa-common-dev
```

```sh
npm install
npm run plugin-ui:build
cmake -B plugin/build -S plugin -G Ninja -DCMAKE_BUILD_TYPE=Release -DPRISM_PLUGIN_FORMATS=VST3
cmake --build plugin/build --target PrismInstallerPlugins --parallel
```

Built bundles land under `plugin/build/Prism*_artefacts/Release/VST3/`. Copy the
seven `Prism *.vst3` directories to one of the standard Linux VST3 scan paths:

- User-local: `$HOME/.vst3`
- System-wide: `/usr/lib/vst3`
- System-wide local: `/usr/local/lib/vst3`

The Linux `.deb` and `.rpm` release packages install Prism's VST3 bundles to
`/usr/lib/vst3` and remove only those seven bundles on package removal. The Linux
`tar.gz` release includes `resources/plugins/install-vst3.sh`, which installs to
`$HOME/.vst3` by default or `/usr/lib/vst3` with `--system`. The AppImage is
portable app-only and does not install DAW plugins.

## Notes

- **Refresh rate (macOS):** frames are emitted on `juce::VBlankAttachment` (synced to the
  display, adapts to 60/120/144 Hz) and the webview renders via the `display-sync`
  FrameScheduler. WKWebView otherwise throttles `requestAnimationFrame` to 60 fps regardless
  of display — `Source/WebViewFrameRate.mm` lifts that by disabling WebKit's private
  `PreferPageRenderingUpdatesNear60FPSEnabled` feature on the live web view (no public API
  exists; fine for a non-App-Store FOSS plugin). To diagnose, set `showFpsMeter` on
  `<SpectrumScope/>` to overlay `render / data` fps.
- **Windows:** `NEEDS_WEBVIEW2 TRUE` in CMake links Microsoft's Edge WebView2 runtime.
  The macOS 120 Hz uncap (`Source/WebViewFrameRate.mm`, gated `if(APPLE)`) doesn't
  apply — WebView2 has its own rate behavior; please report actual fps if it ever
  feels low.
