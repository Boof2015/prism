#!/usr/bin/env bash
set -euo pipefail

# System packages and the user-local Node installation are deliberately separate.
mode=${1:-node}
if [[ "$mode" == system ]]; then
  if [[ $EUID != 0 ]]; then
    echo 'Run the system step with sudo (or wsl -u root).' >&2
    exit 1
  fi
  . /etc/os-release
  case "$ID" in
    ubuntu|debian)
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y \
        ca-certificates curl xz-utils git rsync build-essential cmake ninja-build \
        pkg-config python3 libpulse-dev libasound2-dev libjack-jackd2-dev \
        ladspa-sdk libcurl4-openssl-dev libfreetype-dev libfontconfig1-dev \
        libgtk-3-dev libx11-dev libxcomposite-dev libxcursor-dev libxext-dev \
        libxinerama-dev libxrandr-dev libxrender-dev libwebkit2gtk-4.1-dev \
        xvfb xauth libglu1-mesa-dev mesa-common-dev libnss3 libxss1 \
        libxtst6 libsecret-1-0 libnotify4 xdg-utils pulseaudio-utils rpm
      ;;
    fedora)
      dnf install -y \
        ca-certificates curl xz git rsync gcc gcc-c++ make cmake ninja-build \
        pkgconf-pkg-config python3 pulseaudio-libs-devel alsa-lib-devel \
        jack-audio-connection-kit-devel ladspa-devel libcurl-devel freetype-devel \
        fontconfig-devel gtk3-devel libX11-devel libXcomposite-devel \
        libXcursor-devel libXext-devel libXinerama-devel libXrandr-devel \
        libXrender-devel webkit2gtk4.1-devel xorg-x11-server-Xvfb xorg-x11-xauth \
        mesa-libGLU-devel mesa-libGL-devel nss libXScrnSaver libXtst \
        libsecret libnotify xdg-utils pulseaudio-utils rpm-build
      ;;
    *) echo "Unsupported distribution: $ID. Install the dependencies in docs/linux-testing.md." >&2; exit 1 ;;
  esac
elif [[ "$mode" == node ]]; then
  if [[ $EUID == 0 ]]; then
    echo 'Run the Node step as the Linux desktop/test user, not root.' >&2
    exit 1
  fi
  node_dir="$HOME/.local/share/prism-linux/node"
  if [[ -x "$node_dir/bin/node" ]] && "$node_dir/bin/node" -e 'const [major,minor]=process.versions.node.split(".").map(Number);process.exit(major===22 && minor>=12 ? 0 : 1)'; then
    "$node_dir/bin/node" --version
    exit 0
  fi
  case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64) node_arch=arm64 ;;
    *) echo 'Node setup supports x86_64 and aarch64.' >&2; exit 1 ;;
  esac
  setup_dir=$(mktemp -d)
  trap 'rm -rf -- "$setup_dir"' EXIT
  base_url=https://nodejs.org/dist/latest-v22.x
  curl --fail --location --retry 3 "$base_url/SHASUMS256.txt" -o "$setup_dir/SHASUMS256.txt"
  checksum=$(grep -E "  node-v22\.[0-9]+\.[0-9]+-linux-$node_arch\.tar\.xz$" "$setup_dir/SHASUMS256.txt")
  archive=${checksum##*  }
  [[ -n "$checksum" && "$archive" != */* ]]
  curl --fail --location --retry 3 "$base_url/$archive" -o "$setup_dir/$archive"
  (cd "$setup_dir" && printf '%s\n' "$checksum" | sha256sum --check -)
  mkdir -p "$node_dir"
  tar -xJf "$setup_dir/$archive" --strip-components=1 -C "$node_dir"
  "$node_dir/bin/node" --version
  echo "Installed Linux Node in $node_dir. The test runner adds it to PATH automatically."
else
  echo 'Usage: bash scripts/linux/setup.sh [system|node]' >&2
  exit 2
fi
