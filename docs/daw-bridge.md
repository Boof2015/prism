# Prism Bridge protocol and host notes

Prism Bridge is a mono/stereo pass-through effect that sends one selected DAW
track or bus to the standalone Prism application. Prism owns the server and
binds only `127.0.0.1:51789`; Bridge instances reconnect with exponential
backoff from 250 ms to 5 seconds.

## Using Bridge

1. Open the standalone Prism application.
2. Insert **Prism Bridge** on each track or bus you may want to inspect.
3. Optionally give each instance a custom source name in its native editor.
4. In Prism's audio selector, choose an instance under **DAW Bridges**.

Only the selected instance transmits audio. If it disconnects, Prism stays in
DAW mode and displays **Waiting** without falling back to another input. A
same-format reconnect preserves scope history; a sample-rate or channel-layout
change begins a new analysis session.

Waveform and Spectrogram have a **Timeline** setting with Off, Bars + Beats, and
Seconds choices. The ruler is drawn only for DAW Bridge input. Bars + Beats uses
the host PPQ, tempo, meter, and bar anchor; when beat metadata is missing it
shows a labeled seconds fallback. Loop, seek, and packet discontinuities are
kept in history as dashed Loop, Jump, and Gap seams.

## Wire format (version 1)

Every frame starts with a 12-byte little-endian header:

| Offset | Type | Meaning |
| ---: | --- | --- |
| 0 | `uint32` | Magic `0x4d535250` |
| 4 | `uint16` | Protocol version (`1`) |
| 6 | `uint16` | Message type |
| 8 | `uint32` | Payload byte length |

Hello (`1`) and source update (`3`) payloads are UTF-8 JSON. Heartbeat (`2`)
has no payload. Prism sends a JSON subscription (`10`) containing `selected`.
Audio (`20`) uses a 76-byte binary metadata header followed by little-endian
planar Float32 samples (all left samples, then all right samples). Metadata
includes sequence, frame count, channels, sample rate, sample/seconds/PPQ
position, tempo, last-bar PPQ, loop points, time signature, and play, record,
and loop flags.

Payloads larger than 256 KiB and unknown or mismatched protocol versions are
rejected. Prism caps live connections, batches renderer IPC, and expires clients
after three seconds without traffic. Bridge packetizes into preallocated
512-frame records on the audio thread and keeps only the newest approximately
50 ms before transmission. Socket work, JSON, allocation, and locking stay on
the background or UI threads.

The stable source UUID and custom name are stored in plug-in state. If a DAW
duplicates that state, Prism assigns distinct live keys to all duplicates and
requires an explicit choice instead of guessing which instance was intended.

## Formats and validation

Bridge ships as VST3 on macOS, Windows, and Linux, and as AU on macOS. It has no
Standalone target. `AU_SANDBOX_SAFE FALSE` is intentional because the AU needs
loopback networking. Logic may load Audio Units in `AUHostingServiceXPC`, so a
successful build or `auval` scan is not enough: live Logic-to-Prism loopback is
a release blocker.

See Apple's [out-of-process Audio Unit debugging documentation](https://developer.apple.com/documentation/audiotoolbox/debugging-out-of-process-audio-units-on-apple-silicon?language=objc)
and [Audio Unit sandboxing guide](https://developer.apple.com/library/archive/technotes/tn2312/_index.html).
