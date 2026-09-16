#!/usr/bin/env bash
set -euo pipefail
suite=${1:-routine}
[[ "$suite" == routine || "$suite" == full ]] || { echo 'Expected routine or full' >&2; exit 2; }
source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
run_dir=$(dirname "$source_dir")
mkdir -p "$run_dir/logs"
exec > >(tee "$run_dir/logs/linux.log") 2>&1
trap 'code=$?; printf "exit_code=%s\nfinished_at=%s\n" "$code" "$(date -u +%FT%TZ)" > "$run_dir/logs/status.txt"' EXIT
export PATH="$HOME/.local/share/prism-linux/node/bin:/usr/local/bin:/usr/bin:/bin"
unset ELECTRON_RUN_AS_NODE NODE_OPTIONS
export CMAKE_BUILD_PARALLEL_LEVEL=4
export npm_config_loglevel=warn
cd "$source_dir"

step() {
  local label=$1
  shift
  printf '\n[linux-test] %s: %s\n' "$label" "$(date -u +%FT%TZ)"
  local code=0
  "$@" || code=$?
  printf '%s\t%s\n' "$label" "$code" >> "$run_dir/logs/steps.tsv"
  if [[ $code != 0 ]]; then return "$code"; fi
}

{
  cat /etc/os-release
  uname -a
  id
  printf 'suite=%s\nsource=%s\ncommit=%s\ndirty=%s\n' "$suite" "$source_dir" "${PRISM_GIT_COMMIT:-unknown}" "${PRISM_GIT_DIRTY:-unknown}"
  for tool in node npm git cmake g++ python3 pkg-config; do
    command -v "$tool" || { echo "Missing $tool; run scripts/linux/setup.sh system" >&2; exit 1; }
  done
  node --version
  npm --version
  cmake --version
  g++ --version
  python3 --version
  pkg-config --modversion libpulse
  df -h .
  printf 'desktop=%s\nsession=%s\ndisplay=%s\nwayland_display=%s\n' "${XDG_CURRENT_DESKTOP:-unset}" "${XDG_SESSION_TYPE:-unset}" "${DISPLAY:-unset}" "${WAYLAND_DISPLAY:-unset}"
} | tee "$run_dir/logs/environment.txt"

step 'Verify Linux Node 22' node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(process.platform!=="linux" || major!==22 || minor<12)throw Error("Run scripts/linux/setup.sh node: Linux Node 22.12+ is required")'
step 'Install dependencies' env PRISM_SKIP_NATIVE_POSTINSTALL=1 npm ci --prefer-offline --no-audit --no-fund
step 'Build native addon' npm run rebuild:native
step 'Verify native addon' node -e 'const n=require("./native/build/Release/visualizer_dsp.node");if(!n.spectrum || !n.linuxCapture)throw Error("Missing Linux native exports")'
step 'Typecheck' npm run typecheck
step 'Automated tests' npm test
# An optional clean checkout of the pinned dependency permits offline VM runs.
ftxui_revision=$(sed -nE 's/^[[:space:]]*GIT_TAG ([[:xdigit:]]{40}).*/\1/p' tui/CMakeLists.txt)
ftxui_cache="$HOME/.cache/prism-linux-tests/dependencies/ftxui-$ftxui_revision"
if [[ -n "$ftxui_revision" && -d "$ftxui_cache/.git" ]]; then
  [[ "$(git -C "$ftxui_cache" rev-parse HEAD)" == "$ftxui_revision" && -z "$(git -C "$ftxui_cache" status --porcelain)" ]] || {
    echo "FTXUI cache does not match the clean pinned revision: $ftxui_cache" >&2; exit 1;
  }
  step 'Configure cached FTXUI' cmake -S tui -B tui/build "-DFETCHCONTENT_SOURCE_DIR_FTXUI=$ftxui_cache"
fi
step 'TUI build and tests' npm run test:tui
step 'Desktop build' npm run build
step 'Plugin UI build' npm run plugin-ui:build
if [[ "$suite" == full ]]; then
  step 'Plugin build and tests' xvfb-run -a npm run test:plugins -- '-DPRISM_PLUGIN_FORMATS=VST3;CLAP'
  step 'Linux packages' env PRISM_PLUGINS_PREBUILT=1 npm run dist:linux
fi
echo 'Automated checks passed. Fedora desktop/menu/audio checks are recorded separately.'
