#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APPS_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
# The standard macOS package command is build -> overwrite install -> installed smoke.
# Keep the complete chain enabled even when callers omit legacy --install flags.
INSTALL_AFTER_BUILD=1
BUILD_ARGS=
HAS_ARCH=0

for arg in "$@"; do
  case "$arg" in
    --install|--smoke-installed)
      INSTALL_AFTER_BUILD=1
      ;;
    --arm64|--x64|--universal)
      HAS_ARCH=1
      BUILD_ARGS="${BUILD_ARGS} ${arg}"
      ;;
    *)
      BUILD_ARGS="${BUILD_ARGS} ${arg}"
      ;;
  esac
done

cd "$APPS_DIR"

if [ "$HAS_ARCH" -eq 0 ]; then
  BUILD_ARGS="${BUILD_ARGS} --arm64"
fi

# Two packaging chains from this checkout running at once corrupt each other's
# shared outputs. Wait for any concurrent chain to finish before starting.
wait_for_chain_free() {
  waited=0
  while [ "$waited" -lt 32 ]; do
    if pgrep -f "build-desktop.mjs --mac" >/dev/null 2>&1 \
      || pgrep -f "packaging/install-and-smoke.mjs" >/dev/null 2>&1 \
      || pgrep -f "$APPS_DIR.*electron-builder" >/dev/null 2>&1; then
      if [ "$waited" -eq 0 ]; then
        echo "Another packaging chain is running; waiting up to 8 minutes for it to finish..."
      fi
      sleep 15
      waited=$((waited + 1))
    else
      return 0
    fi
  done
  echo "Timed out waiting for the concurrent packaging chain; abort instead of stomping it." >&2
  return 1
}

wait_for_chain_free

echo "Building mac app from $APPS_DIR"
echo "Command: node ./build/packaging/build-desktop.mjs --mac$BUILD_ARGS"

# shellcheck disable=SC2086
node ./build/packaging/build-desktop.mjs --mac $BUILD_ARGS

if [ "$INSTALL_AFTER_BUILD" -eq 1 ]; then
  # The install-and-smoke chain now verifies the installed app really opens,
  # self-heals a stomped install once, and fails closed otherwise. One
  # automatic full retry solves a broken build; the guard prevents loops.
  if MYSTUDIO_SMOKE_KEEP_OPEN=0 MYSTUDIO_SMOKE_SKIP_PREKILL=0 \
    node ./build/packaging/install-and-smoke.mjs; then
    :
  else
    if [ "${MYSTUDIO_BUILD_RETRY_GUARD:-0}" = "1" ]; then
      echo "Install-and-smoke failed again after the full retry; giving up." >&2
      exit 1
    fi
    echo "Install-and-smoke failed; solving it by re-running the full build + install chain once."
    MYSTUDIO_BUILD_RETRY_GUARD=1 sh "$SCRIPT_DIR/build-mac.sh" $BUILD_ARGS
    exit $?
  fi
fi
