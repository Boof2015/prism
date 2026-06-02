#!/bin/sh
# Package removal hook for Linux .deb/.rpm builds. Remove only Prism's known
# VST3 bundles from the global VST3 scan path.

set -eu

DEST_DIR="${PRISM_VST3_DEST_DIR:-/usr/lib/vst3}"

remove_plugin() {
  rm -rf "$DEST_DIR/$1"
}

remove_plugin "Prism Spectrum.vst3"
remove_plugin "Prism Oscilloscope.vst3"
remove_plugin "Prism VU Meter.vst3"
remove_plugin "Prism Loudness Meter.vst3"
remove_plugin "Prism Vectorscope.vst3"
remove_plugin "Prism Spectrogram.vst3"
remove_plugin "Prism Waveform.vst3"

echo "Prism VST3 plugins removed from $DEST_DIR"
