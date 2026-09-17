# Multichannel routing validation

Routing supports the OS-exposed channels of one selected source. Windows uses
WASAPI shared-mode capture; Linux uses libpulse with PulseAudio or pipewire-pulse.
The source's full channel count and activity are separate from the mono/stereo
audio delivered to analyzers and rolling clips.

## Automated checks

Build the native addon before running native tests:

```sh
npm run build:native
npm run typecheck
npm run test:capture-support
npm run test:capture-channel-selection-native
npm run test:spectrum-native
npm run test:audio-store
npm run test:audio-router
npm run test:renderer-helpers
npm run test:tui
npm run build
```

For an Electron development build, use `npm run rebuild:native` afterward to
restore the addon build against Electron's headers.

On Linux, install the PulseAudio server and command-line tools, then run:

```sh
npm run test:linux-capture
```

The test launches a private server/socket, creates a six-channel null sink and
non-monitor input, and feeds independent tones into each channel. It verifies
enumeration, defaults, full channel metadata, startup/live/duplicate routing,
independent input/output state, activity on unselected channels, silence,
restart, removal, mono reconnect, and server failure. It does not connect to
the desktop's audio server. Temporary processes and files are removed afterward.
CI's Linux quality gate runs this test separately from `npm test`.

To run the same integration test against PipeWire, install `pipewire`,
`pipewire-pulse`, WirePlumber 0.5+, `dbus-daemon`, and the PulseAudio CLI tools:

```sh
PRISM_CAPTURE_TEST_SERVER=pipewire npm run test:linux-capture
```

This starts a private PipeWire server and a policy-only WirePlumber instance;
physical-device discovery is disabled and configuration/state paths are private.

## Hardware acceptance

For Windows and Linux, use a multichannel output endpoint plus an input interface
whose current OS configuration exposes more than two channels:

1. Confirm every exposed channel appears with a driver/channel-map label or a
   numbered fallback. Route a channel above 2 to each analyzer side, then route
   one channel to both sides. Confirm signal identity and activity on unselected
   channels; changing input trim must not change the activity fills.
2. Change routes during capture. Confirm no restart, dropout caused by reopening
   the device, or changes to the other capture mode's saved route.
3. Switch between mono, stereo, and multichannel devices, including different
   sample rates. Change the selected device's OS channel layout while retaining
   its ID; confirm capture reopens and invalid routes become the default pair.
4. Stop playback, unplug/reconnect the device, change the default device, and
   restart Prism. Check silence, existing retry/default notices, and saved routes.
5. Upgrade from a saved browser input ID. Confirm Default Input is selected with
   a notice and unrelated saved routes are retained.

## Validation recorded for this change

- macOS arm64: native addon, desktop, and TUI builds; native PCM/export tests,
  capability tests, renderer/store/router tests, and typecheck passed.
- Linux arm64 container: full native addon and TUI builds/tests; six-channel
  integration passed with PulseAudio and PipeWire compatibility.
- Windows x64: capture core and complete TUI cross-built with MinGW, including
  audio GUID linkage. The full Electron addon still needs a Windows/MSVC build.
- Physical multichannel hardware, Windows runtime audio, and live desktop
  hardware acceptance above were unavailable in this environment and remain
  unverified. Virtual audio testing does not establish driver-specific behavior.
