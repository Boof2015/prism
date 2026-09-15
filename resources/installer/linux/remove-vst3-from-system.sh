#!/bin/sh
# Package removal hook for Linux .deb/.rpm builds. Remove only Prism's known
# VST3 bundles and CLAP files from their global scan paths.

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

VST3_DEST="${PRISM_VST3_DEST_DIR:-/usr/lib/vst3}"
CLAP_DEST="${PRISM_CLAP_DEST_DIR:-/usr/lib/clap}"
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

for name in Spectrum Oscilloscope "VU Meter" "Loudness Meter" Vectorscope Spectrogram Waveform Waterfall Bridge; do
  rm -rf "$VST3_DEST/Prism $name.vst3"
  rm -f "$CLAP_DEST/Prism $name.clap"
done
remove_tui_link

echo "Prism VST3 and CLAP plugins removed"
