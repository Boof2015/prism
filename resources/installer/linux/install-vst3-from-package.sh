#!/bin/sh
# Package post-install hook for Linux .deb/.rpm builds. The app package installs
# Prism under /opt, then this exposes prism-tui on PATH and copies the bundled
# native Linux VST3 bundles into the global VST3 scan path used by Linux DAWs.

set -eu

DEST_DIR="${PRISM_VST3_DEST_DIR:-/usr/lib/vst3}"
TUI_LINK="${PRISM_TUI_LINK_PATH:-/usr/bin/prism-tui}"

find_tui() {
  if [ -n "${PRISM_TUI_SOURCE_PATH:-}" ] && [ -f "$PRISM_TUI_SOURCE_PATH" ]; then
    printf '%s\n' "$PRISM_TUI_SOURCE_PATH"
    return 0
  fi

  for executable in \
    /opt/Prism/resources/tui/prism-tui \
    /opt/prism/resources/tui/prism-tui
  do
    if [ -f "$executable" ]; then
      printf '%s\n' "$executable"
      return 0
    fi
  done

  return 1
}

install_tui() {
  tui_source="$(find_tui || true)"
  if [ -z "$tui_source" ]; then
    echo "Prism TUI install: bundled executable not found; skipping PATH link." >&2
    return 0
  fi

  chmod 755 "$tui_source"
  if [ -e "$TUI_LINK" ] || [ -L "$TUI_LINK" ]; then
    if [ -L "$TUI_LINK" ] && [ "$(readlink "$TUI_LINK")" = "$tui_source" ]; then
      return 0
    fi
    echo "Prism TUI install: $TUI_LINK already exists and was left unchanged." >&2
    return 0
  fi

  ln -s "$tui_source" "$TUI_LINK"
  echo "Prism TUI installed at $TUI_LINK"
}

find_source_dir() {
  if [ -n "${PRISM_VST3_SOURCE_DIR:-}" ] && [ -d "$PRISM_VST3_SOURCE_DIR" ]; then
    printf '%s\n' "$PRISM_VST3_SOURCE_DIR"
    return 0
  fi

  for dir in \
    /opt/Prism/resources/plugins/VST3 \
    /opt/prism/resources/plugins/VST3
  do
    if [ -d "$dir" ]; then
      printf '%s\n' "$dir"
      return 0
    fi
  done

  return 1
}

install_plugin() {
  plugin_name="$1"
  source_plugin="$SOURCE_DIR/$plugin_name"
  dest_plugin="$DEST_DIR/$plugin_name"

  if [ ! -d "$source_plugin" ]; then
    echo "Prism VST3 install: missing bundled plugin: $source_plugin" >&2
    return 1
  fi

  rm -rf "$dest_plugin"
  cp -a "$source_plugin" "$DEST_DIR/"
}

install_tui

SOURCE_DIR="$(find_source_dir || true)"
if [ -z "$SOURCE_DIR" ]; then
  echo "Prism VST3 install: bundled VST3 directory not found; skipping plugin install." >&2
  exit 0
fi

mkdir -p "$DEST_DIR"

install_plugin "Prism Spectrum.vst3"
install_plugin "Prism Oscilloscope.vst3"
install_plugin "Prism VU Meter.vst3"
install_plugin "Prism Loudness Meter.vst3"
install_plugin "Prism Vectorscope.vst3"
install_plugin "Prism Spectrogram.vst3"
install_plugin "Prism Waveform.vst3"
install_plugin "Prism Bridge.vst3"

chmod -R a+rX "$DEST_DIR"/Prism*.vst3 2>/dev/null || true
echo "Prism VST3 plugins installed to $DEST_DIR"
