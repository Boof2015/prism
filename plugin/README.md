# Prism — DAW plugins

JUCE 8 plugins (VST3 / AU / CLAP / Standalone) that render Prism's scopes inside a DAW —
one plugin per scope: **spectrum, oscilloscope, vectorscope, spectrogram, VU meter,
loudness meter, waveform, waterfall** — plus the native **Prism Bridge** pass-through plugin.
The analyzers **reuse Prism's existing C++ DSP** (`native/src/*.cpp`)
and the **existing React canvas UI** (`src/plugin-ui`, importing the unchanged
visualizers from `src/renderer/visualizers/`). VST3 and CLAP are built for macOS, Windows,
and Linux; AU is macOS-only.

## How it fits together

```
DAW track audio
  → processBlock (RT thread): copy stereo into a lock-free FIFO       [Source/PluginProcessor.cpp]
  → display callback (message thread): drain FIFO → native ScopeEngine [Source/PluginEditor.cpp]
  → emit scope frames (compact base64 Float32 arrays) to the webview
  → juceBridge.ts decodes → the scope's Bridge*Analyzer adapter
  → the existing desktop visualizer renders to canvas                [src/plugin-ui]
```

No DSP or allocation runs on the realtime audio thread; audio passes through unmodified.
Waterfall records history at 60 slices per second of audio, independently of the
display rate, and repaints when a native plot frame arrives.

Spectrum accepts one reference track through **Settings → Reference** or a file
drop onto its graph (mono/stereo WAV, AIFF, FLAC, or MP3). Overlay shows its average
curve; Difference shows live Mid minus reference minus trim on a ±24 dB scale.
Match level sets trim once from the latest three seconds of live Mid power.
Import workers belong to the processor and continue when the editor closes.
Analyzed curves are stored per instance in DAW state; the source file is not
needed for recall, and desktop profile references are never inherited.
Pinned decoder/resampler sources and licenses are in `native/vendor`.

Reference validation: build `PrismReferenceTests` and run
`ctest --test-dir plugin/build -R PrismReferenceTests --output-on-failure`.
`PrismReferenceTests --ui [audio-file]` opens a native editor with a quiet test
tone for file-drop, picker, loading, and narrow-window checks.

## Build with npm (all platforms)

After installing the platform prerequisites below and running `npm install`, use
these commands from the repository root:

```sh
npm run build:plugins       # Build the web UI, configure CMake, compile in Release
npm run test:plugins        # Also enable and run all native plugin tests
npm run configure:plugins   # Build the web UI and configure, without compiling
npm run install:plugins     # Install already-built plugin formats; no compilation
npm run prepare:plugins     # Build and stage all formats required by installers
```

The commands reuse `plugin/build`, including its existing generator and selected
formats. Fresh builds use CMake's default generator and include VST3, CLAP, and
Standalone on Windows/Linux, plus AU on macOS. Bridge has no Standalone target.
Pinned JUCE and CLAP sources are downloaded by CMake when needed. Build products
are under `plugin/build/Prism*_artefacts/Release/`.

Compilation always disables CMake's copy-after-build step, including when an
older cache enabled it. `--install` runs the separate installation helper only
after a successful build (and tests, when requested). If installation fails or
is cancelled, the compiled files remain available and can be installed later
with `npm run install:plugins` without rebuilding. The direct CMake commands
below retain CMake's default copy-after-build behavior.

```sh
npm run build:plugins -- --install
npm run build:plugins -- --jobs 2
npm run build:plugins -- "-DPRISM_PLUGIN_FORMATS=VST3;CLAP"
npm run build:plugins -- "-DCMAKE_BUILD_TYPE=Debug"
npm run build:plugins -- "-DJUCE_PATH=/path/to/JUCE"
npm run install:plugins -- --dry-run
npm run install:plugins -- --formats VST3
npm run install:plugins -- --config Debug
```

Installation checks the complete set of selected products before copying or
requesting elevation. By default, it reads the formats selected in the CMake
cache and skips Standalone apps. `--formats VST3,CLAP` selects an explicit subset.

- **Windows:** installs to `Common Files/VST3` and `Common Files/CLAP`, requesting
  UAC only for a PowerShell copy helper. Run npm from a normal terminal. For a
  user-only copy, use `npm run install:plugins -- --user`; this writes under
  `%LOCALAPPDATA%/Programs/Common/` (your DAW may need those scan paths added).
- **macOS:** installs to `~/Library/Audio/Plug-Ins/{VST3,CLAP,Components}`.
- **Linux:** installs to `~/.vst3` and `~/.clap`.

On macOS/Linux, `--system` uses `/Library/Audio/Plug-Ins/` or `/usr/lib/{vst3,clap}`
and requests `sudo` for the copy helper only. Close DAWs using Prism before
updating installed plugins.

`npm run dist` now prepares plugins before packaging: it builds the embedded UI,
adds missing VST3/CLAP formats (plus AU on macOS) to the existing CMake selection,
builds the Release installer targets, then validates and stages every product
in `plugin/dist-installer`. Missing plugins stop packaging. Other cached formats,
such as Standalone, are preserved. Use the matching host OS for native packaging.
The Linux AppImage stays app-only; `.deb`, `.rpm`, and `.tar.gz` include plugins.

Release CI sets `PRISM_PLUGINS_PREBUILT=1` after its separate native build and
validation steps. In this mode preparation still checks and stages every release
artifact, but does not rebuild outside the CI compiler environment. Local builds
should leave this variable unset.

Parallelism defaults to `CMAKE_BUILD_PARALLEL_LEVEL`, or 4 when unset. CMake
definitions (`-DNAME=VALUE`) are forwarded as individual arguments, including
paths with spaces and semicolon-separated formats. Generator/toolchain options
`-G`, `-A`, and `-T` are also accepted; an existing build directory must retain
its original generator. Run `npm run build:plugins -- --help` for all options.

On Windows, the helper detects an SDK extracted to
`plugin/sdk/Microsoft.Web.WebView2/`. An explicit
`-DJUCE_WEBVIEW2_PACKAGE_LOCATION=...` takes precedence over the environment
variable of the same name, an existing CMake cache entry, and that local SDK.
Otherwise, JUCE searches its standard user NuGet package location. The value
must name the **parent directory** containing `Microsoft.Web.WebView2`.
With the NuGet CLI installed, you can prepare the local SDK using the same
version as CI:

```sh
nuget install Microsoft.Web.WebView2 -Version 1.0.1901.177 -OutputDirectory plugin/sdk -ExcludeVersion
```

The SDK download is separate from the WebView2 Runtime. SDK files and build
outputs are ignored by Git. The npm helper does not install system prerequisites.

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

`PRISM_COPY_PLUGIN_AFTER_BUILD` installs all eight analyzers plus Prism Bridge into your user plugin folders:
- AU:   `~/Library/Audio/Plug-Ins/Components/Prism *.component`
- VST3: `~/Library/Audio/Plug-Ins/VST3/Prism *.vst3`
- CLAP: `~/Library/Audio/Plug-Ins/CLAP/Prism *.clap`

Load a `Prism *` plugin in a DAW that supports its format (or run the
matching **Standalone** from `plugin/build/Prism*_artefacts/Release/Standalone/`),
play audio, and the scope animates.
(Prism Bridge has AU/VST3/CLAP targets and no Standalone target.)
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

`PRISM_COPY_PLUGIN_AFTER_BUILD` installs VST3 bundles into
`C:\Program Files\Common Files\VST3` and CLAP files into
`C:\Program Files\Common Files\CLAP`. These locations need admin privileges.
To build without installing, configure with `-DPRISM_COPY_PLUGIN_AFTER_BUILD=OFF`.
Then copy the products from `plugin\build\Prism*_artefacts\Release\VST3\`
and `...\CLAP\` to the system directories, or the user directories
`%LOCALAPPDATA%\Programs\Common\VST3\` and `...\CLAP\`.

The Windows installer offers independent VST3 and CLAP checkboxes, both checked
by default. Silent installations install both. For scripted installation, use
`/VST3=0|1` and `/CLAP=0|1` before any final `/D=...` install-directory argument.
Uninstall removes only the nine named Prism products from each system directory.

Dev-server mode works the same as macOS: `-DPRISM_DEV_SERVER=ON` + `npm run plugin-ui:dev`.

## Build & run (Linux)

Release and build-smoke CI use Ubuntu 24.04 as the Linux binary baseline. For
plugins to share across distributions or load in a Flatpak DAW, build on that
baseline rather than a newer distribution. A Fedora 44 build can require
`GLIBC_2.43` even when the DAW's Flatpak runtime only provides glibc 2.42;
that fails during scanning, before Prism's processor or editor starts.
`readelf --version-info "Prism Oscilloscope.clap"` shows required symbol versions.
The [Windows Linux test launcher](../docs/linux-testing.md) can build in Ubuntu
WSL and preserve the build logs.

Scope editors need WebKitGTK 4.1 (or JUCE's 4.0 fallback) in the environment
running the DAW. A Flatpak runtime must provide it inside the sandbox; installing
WebKitGTK only on the host does not satisfy that requirement. Successful plugin
scanning alone does not verify editor support. Prism Bridge uses a native editor
and does not require WebKitGTK.

The Linux browser runs in a helper process with `LD_LIBRARY_PATH` and
`LD_PRELOAD` cleared before a clean exec, so a DAW's bundled GLib cannot prevent
the system WebKitGTK from loading. The DAW's own environment stays unchanged.
`cmake/PrismLinuxWebView.cmake` patches a build-local copy of JUCE 8.0.4 to defer
its WebKit probe to that helper. The configure step fails if JUCE's patch anchors
change; review the patch when updating JUCE. The isolation regression runs as
`PrismLinuxWebViewHelperTests` in CTest and Linux CI.

Prereqs: CMake >= 3.22, Ninja, GCC/Clang, Node.js, and JUCE's Linux GUI/WebView
dependencies. On Ubuntu 24.04+:

```sh
sudo apt-get install build-essential cmake ninja-build pkg-config \
  libasound2-dev libjack-jackd2-dev ladspa-sdk libcurl4-openssl-dev \
  libfreetype-dev libfontconfig1-dev libgtk-3-dev libx11-dev libxcomposite-dev \
  libxcursor-dev libxext-dev libxinerama-dev libxrandr-dev libxrender-dev \
  libwebkit2gtk-4.1-dev libglu1-mesa-dev mesa-common-dev
```

```sh
npm install
npm run plugin-ui:build
cmake -B plugin/build -S plugin -G Ninja -DCMAKE_BUILD_TYPE=Release -DPRISM_PLUGIN_FORMATS="VST3;CLAP"
cmake --build plugin/build --target PrismInstallerPlugins --parallel
```

Built bundles land under `plugin/build/Prism*_artefacts/Release/VST3/`. Copy the
nine `Prism *.vst3` directories to one of the standard Linux VST3 scan paths:

- User-local: `$HOME/.vst3`
- System-wide: `/usr/lib/vst3`
- System-wide local: `/usr/local/lib/vst3`

CLAP products are single `.clap` files under
`plugin/build/Prism*_artefacts/Release/CLAP/`. Copy the nine `Prism *.clap`
files to `$HOME/.clap` or `/usr/lib/clap`.

The Linux `.deb` and `.rpm` release packages install VST3 bundles to `/usr/lib/vst3`
and CLAP files to `/usr/lib/clap`. Package upgrades retain the plugins; uninstall
removes only the nine named Prism products per format. The `tar.gz` release includes
`resources/plugins/install-vst3.sh` and `resources/plugins/install-clap.sh`:

```sh
sh resources/plugins/install-vst3.sh
sh resources/plugins/install-clap.sh
# Use --system for global installation, or --dest PATH for a custom location.
```

The CLAP helper defaults to `$HOME/.clap`; `--system` selects `/usr/lib/clap`.
`--source PATH` overrides the bundled source directory. Environment overrides are
`PRISM_CLAP_SOURCE_DIR` and `PRISM_CLAP_DEST_DIR`; explicit command-line options win.
The AppImage is portable app-only and does not install DAW plugins.

## CLAP build configuration and validation

Fresh builds include CLAP. Existing CMake caches keep their selected formats;
reconfigure with `-DPRISM_PLUGIN_FORMATS="AU;VST3;CLAP"` on macOS or
`-DPRISM_PLUGIN_FORMATS="VST3;CLAP"` on Windows/Linux. Use
`-DPRISM_PLUGIN_FORMATS=CLAP` for CLAP only, or omit CLAP from the format list to
avoid fetching or linking its dependencies. Build `PrismInstallerPlugins` for all
selected installable formats, or an individual target such as `PrismSpectrum_CLAP`.

CLAP uses [clap-juce-extensions](https://github.com/free-audio/clap-juce-extensions)
at `9fbefae3d9c3d130aafb558c1ec15427a4bd24be`, including its pinned CLAP and
clap-helpers submodules. CMake fetches it automatically. An existing recursive
checkout can be supplied with `-DCLAP_JUCE_EXTENSIONS_PATH=/path/to/checkout`.
JUCE remains at 8.0.4. See the root third-party notices for dependency licenses.

CLAP IDs are stable `com.astra.prism.<target>` identifiers, for example
`com.astra.prism.PrismSpectrum` and `com.astra.prism.PrismBridge`. Settings use the
same JSON as VST3/AU, including references; a fresh analyzer saves `{}` before
its editor opens. DAWs treat each format as a separate plugin instance, so existing
VST3/AU instances are not automatically converted.

After building, `npm run stage:plugins` checks and stages all nine products in the
release formats (VST3/CLAP plus AU on macOS). For macOS ZIP installations, copy the
bundles from `Prism.app/Contents/Resources/plugins/{CLAP,VST3,AU}` into the matching
user plugin folders listed above. The macOS PKG installs them into the corresponding
system folders under `/Library/Audio/Plug-Ins`; CLAP bundles are ad-hoc signed during
building. For a manually extracted Windows portable build, copy the `.clap` files from
`resources/plugins/CLAP` into a standard CLAP folder.

CI builds [clap-validator](https://github.com/free-audio/clap-validator) at
`b2f1d9b79b1d264a5747f46707d72b1aa40a02ef`. With that binary on PATH, run
`npm run test:clap`; alternatively set `CLAP_VALIDATOR_PATH` to its executable.
Per-plugin results are saved under `plugin/build/clap-validation/` and uploaded by CI.
The validator's `param-conversions` test divides by zero when there are no parameters;
only that test is excluded for Prism's nine parameterless products. The wrapper also
reports successful loading of random state bytes because JUCE's state-load callback
cannot return failure; the validator reports this as a warning. All processing,
state round-trip, and lifecycle checks remain enabled.

`node scripts/check-plugin-formats.mjs` checks CLAP-only and VST3-only configurations
after the full build is configured. `npm run test:plugin-packaging` tests staging,
Unix installation, repeated installation, upgrades, and removal using temporary
paths. CI also tests Windows silent defaults and every format-selection combination.

Before releasing, exercise CLAP in a compatible DAW: rescan all nine products;
verify mono/stereo pass-through, editor animation and resizing, repeated reopen,
project save/reload, Spectrum references, Waterfall history, and Bridge connection,
naming, transport, and reconnection. Host-provided track names depend on the host's
CLAP track-info support; Bridge retains its custom-name and instance-tag fallback.

## Notes

Waterfall's native engine/processor tests run with `ctest --test-dir plugin/build
-C Release -R PrismWaterfallTests --output-on-failure` after building the
`PrismWaterfallTests` target. Run that executable with `--ui` for a silent native
editor smoke test of live rendering, color controls, and resizing; it saves canvas
snapshots in the test application's temporary directory.

- **Waterfall:** reuses the desktop Canvas renderer and the native 60-slice/second
  stereo analyzer. The webview requests only the visible ridge count and frequency
  resolution. History duration, density, Theme/Heat colors, guides, FFT, frequency
  scale/range, smoothing, and tilt are saved per instance in DAW state. Audio gaps,
  editor reopen, sample-rate changes, and FFT-size changes start fresh history;
  duration and appearance changes preserve available history. Freeze/inspect and
  angled 3D remain future work.

- **Prism Bridge:** start the standalone Prism application, insert Bridge on a
  mono or stereo track/bus, then select that instance in Prism's **DAW Bridges**
  input group. Bridge is bit-transparent, ignores offline rendering, and sends
  audio and transport metadata only over `127.0.0.1:51789`. Its audio callback
  only packetizes into a bounded lock-free queue; a background thread owns the
  socket. The source UUID and custom name are saved in DAW state.
  Its compact native nameplate follows the DAW track name automatically. Click
  the name to override it; Enter or clicking away saves, Escape cancels, and
  clearing restores the track name. The small instance tag matches duplicate
  names in Prism. The editor can stay closed while Bridge is in use.
- **Logic/AU validation:** `AU_SANDBOX_SAFE FALSE` is explicit because Bridge needs
  loopback networking. Apple may host Audio Units out of process; AU loopback in
  Logic is therefore a release-blocking host validation, not something the build
  alone can prove.

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
