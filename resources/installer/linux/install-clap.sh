#!/bin/sh
# Helper bundled in the Linux tarball under resources/plugins/. By default it
# installs Prism's native Linux CLAP bundles to the current user's CLAP folder.

set -eu

usage() {
  cat <<'EOF'
Usage: install-clap.sh [--system] [--dest PATH] [--source PATH]

Installs the bundled Prism CLAP plugins.

Options:
  --system       Install to /usr/lib/clap instead of $HOME/.clap.
  --dest PATH    Install to a custom CLAP directory.
  --source PATH  Read Prism *.clap bundles from a custom source directory.
  -h, --help     Show this help.
EOF
}

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
SOURCE_DIR="${PRISM_CLAP_SOURCE_DIR:-}"
DEST_DIR="${PRISM_CLAP_DEST_DIR:-$HOME/.clap}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --system)
      DEST_DIR="/usr/lib/clap"
      ;;
    --dest)
      shift
      if [ "$#" -eq 0 ]; then
        echo "install-clap.sh: --dest requires a path" >&2
        exit 2
      fi
      DEST_DIR="$1"
      ;;
    --source)
      shift
      if [ "$#" -eq 0 ]; then
        echo "install-clap.sh: --source requires a path" >&2
        exit 2
      fi
      SOURCE_DIR="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "install-clap.sh: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if [ -z "$SOURCE_DIR" ]; then
  if [ -d "$SCRIPT_DIR/CLAP" ]; then
    SOURCE_DIR="$SCRIPT_DIR/CLAP"
  elif [ -d "$SCRIPT_DIR/plugins/CLAP" ]; then
    SOURCE_DIR="$SCRIPT_DIR/plugins/CLAP"
  else
    SOURCE_DIR="$SCRIPT_DIR"
  fi
fi

if [ ! -d "$SOURCE_DIR" ]; then
  echo "install-clap.sh: source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

install_plugin() {
  plugin_name="$1"
  source_plugin="$SOURCE_DIR/$plugin_name"
  dest_plugin="$DEST_DIR/$plugin_name"

  if [ ! -f "$source_plugin" ]; then
    echo "install-clap.sh: missing bundled plugin: $source_plugin" >&2
    return 1
  fi

  cp -p "$source_plugin" "$dest_plugin"
}

# Check the complete set before replacing any installed files.
for name in Spectrum Oscilloscope "VU Meter" "Loudness Meter" Vectorscope Spectrogram Waveform Waterfall Bridge; do
  if [ ! -f "$SOURCE_DIR/Prism $name.clap" ]; then
    echo "install-clap.sh: missing bundled plugin: $SOURCE_DIR/Prism $name.clap" >&2
    exit 1
  fi
done

mkdir -p "$DEST_DIR"

install_plugin "Prism Spectrum.clap"
install_plugin "Prism Oscilloscope.clap"
install_plugin "Prism VU Meter.clap"
install_plugin "Prism Loudness Meter.clap"
install_plugin "Prism Vectorscope.clap"
install_plugin "Prism Spectrogram.clap"
install_plugin "Prism Waveform.clap"
install_plugin "Prism Waterfall.clap"
install_plugin "Prism Bridge.clap"

for name in Spectrum Oscilloscope "VU Meter" "Loudness Meter" Vectorscope Spectrogram Waveform Waterfall Bridge; do
  chmod u+rw,go+r "$DEST_DIR/Prism $name.clap"
done

cat <<EOF
Prism CLAP plugins installed to:
  $DEST_DIR

Rescan CLAP plugins in your DAW if they do not appear immediately.
EOF
