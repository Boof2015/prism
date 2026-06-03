#!/bin/sh
# Helper bundled in the Linux tarball under resources/plugins/. By default it
# installs Prism's native Linux VST3 bundles to the current user's VST3 folder.

set -eu

usage() {
  cat <<'EOF'
Usage: install-vst3.sh [--system] [--dest PATH] [--source PATH]

Installs the bundled Prism VST3 plugins.

Options:
  --system       Install to /usr/lib/vst3 instead of $HOME/.vst3.
  --dest PATH    Install to a custom VST3 directory.
  --source PATH  Read Prism *.vst3 bundles from a custom source directory.
  -h, --help     Show this help.
EOF
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="${PRISM_VST3_SOURCE_DIR:-}"
DEST_DIR="${PRISM_VST3_DEST_DIR:-$HOME/.vst3}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --system)
      DEST_DIR="/usr/lib/vst3"
      ;;
    --dest)
      shift
      if [ "$#" -eq 0 ]; then
        echo "install-vst3.sh: --dest requires a path" >&2
        exit 2
      fi
      DEST_DIR="$1"
      ;;
    --source)
      shift
      if [ "$#" -eq 0 ]; then
        echo "install-vst3.sh: --source requires a path" >&2
        exit 2
      fi
      SOURCE_DIR="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install-vst3.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$SOURCE_DIR" ]; then
  if [ -d "$SCRIPT_DIR/VST3" ]; then
    SOURCE_DIR="$SCRIPT_DIR/VST3"
  elif [ -d "$SCRIPT_DIR/plugins/VST3" ]; then
    SOURCE_DIR="$SCRIPT_DIR/plugins/VST3"
  else
    SOURCE_DIR="$SCRIPT_DIR"
  fi
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "install-vst3.sh: source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

install_plugin() {
  plugin_name="$1"
  source_plugin="$SOURCE_DIR/$plugin_name"
  dest_plugin="$DEST_DIR/$plugin_name"

  if [ ! -d "$source_plugin" ]; then
    echo "install-vst3.sh: missing bundled plugin: $source_plugin" >&2
    return 1
  fi

  rm -rf "$dest_plugin"
  cp -a "$source_plugin" "$DEST_DIR/"
}

mkdir -p "$DEST_DIR"

install_plugin "Prism Spectrum.vst3"
install_plugin "Prism Oscilloscope.vst3"
install_plugin "Prism VU Meter.vst3"
install_plugin "Prism Loudness Meter.vst3"
install_plugin "Prism Vectorscope.vst3"
install_plugin "Prism Spectrogram.vst3"
install_plugin "Prism Waveform.vst3"

chmod -R u+rwX,go+rX "$DEST_DIR"/Prism*.vst3 2>/dev/null || true

cat <<EOF
Prism VST3 plugins installed to:
  $DEST_DIR

Rescan VST3 plugins in your DAW if they do not appear immediately.
EOF
