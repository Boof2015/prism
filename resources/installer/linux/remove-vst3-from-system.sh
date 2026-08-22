#!/bin/sh
# Package removal hook for Linux .deb/.rpm builds. Remove only Prism's known
# VST3 bundles from the global VST3 scan path.

set -eu

# Debian postrm reports upgrades by name; RPM postun reports the number of
# installed package versions remaining. Keep shared resources during either
# upgrade path and remove them only on a real uninstall.
remove_action="${1:-}"
case "$remove_action" in
  upgrade|failed-upgrade|abort-*)
    exit 0
    ;;
  ''|*[!0-9]*)
    ;;
  *)
    if [ "$remove_action" -gt 0 ]; then
      exit 0
    fi
    ;;
esac

DEST_DIR="${PRISM_VST3_DEST_DIR:-/usr/lib/vst3}"
TUI_LINK="${PRISM_TUI_LINK_PATH:-/usr/bin/prism-tui}"

remove_tui_link() {
  [ -L "$TUI_LINK" ] || return 0
  tui_target="$(readlink "$TUI_LINK")"
  case "$tui_target" in
    /opt/Prism/resources/tui/prism-tui|/opt/prism/resources/tui/prism-tui)
      rm "$TUI_LINK"
      ;;
    *)
      if [ -n "${PRISM_TUI_SOURCE_PATH:-}" ] && [ "$tui_target" = "$PRISM_TUI_SOURCE_PATH" ]; then
        rm "$TUI_LINK"
      else
        echo "Prism TUI removal: $TUI_LINK points elsewhere and was left unchanged." >&2
      fi
      ;;
  esac
}

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
remove_plugin "Prism Bridge.vst3"
remove_tui_link

echo "Prism VST3 plugins removed from $DEST_DIR"
