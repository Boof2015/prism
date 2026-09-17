#!/bin/sh
# Package post-install hook for Linux .deb/.rpm builds. The app package installs
# Prism under /opt, then this exposes prism-tui on PATH and copies the bundled
# native Linux VST3 bundles and CLAP files into their global DAW scan paths.

set -eu

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

# Kept at the original hook path for compatibility with package configuration.
install_format() {
  format="$1"
  extension="$2"
  source_dir="$3"
  dest_dir="$4"
  if [ -z "$source_dir" ]; then
    for dir in "/opt/Prism/resources/plugins/$format" "/opt/prism/resources/plugins/$format"; do
      if [ -d "$dir" ]; then source_dir="$dir"; break; fi
    done
  fi
  if [ -z "$source_dir" ] || [ ! -d "$source_dir" ]; then
    echo "Prism $format install: bundled directory not found; skipping this format." >&2
    return 0
  fi

  # Preflight the entire format before replacing any installed products.
  for name in Spectrum Oscilloscope "VU Meter" "Loudness Meter" Vectorscope Spectrogram Waveform Waterfall Bridge; do
    source_plugin="$source_dir/Prism $name.$extension"
    if { [ "$format" = VST3 ] && [ ! -d "$source_plugin" ]; } ||
       { [ "$format" = CLAP ] && [ ! -f "$source_plugin" ]; }; then
      echo "Prism $format install: missing bundled plugin: $source_plugin" >&2
      return 1
    fi
  done

  mkdir -p "$dest_dir"
  for name in Spectrum Oscilloscope "VU Meter" "Loudness Meter" Vectorscope Spectrogram Waveform Waterfall Bridge; do
    plugin="Prism $name.$extension"
    if [ "$format" = VST3 ]; then
      rm -rf "$dest_dir/$plugin"
      cp -a "$source_dir/$plugin" "$dest_dir/"
    else
      cp -p "$source_dir/$plugin" "$dest_dir/$plugin"
    fi
    chmod -R a+rX "$dest_dir/$plugin"
  done
  echo "Prism $format plugins installed to $dest_dir"
}

install_tui
install_format VST3 vst3 "${PRISM_VST3_SOURCE_DIR:-}" "${PRISM_VST3_DEST_DIR:-/usr/lib/vst3}"
install_format CLAP clap "${PRISM_CLAP_SOURCE_DIR:-}" "${PRISM_CLAP_DEST_DIR:-/usr/lib/clap}"
