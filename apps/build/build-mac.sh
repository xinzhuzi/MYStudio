#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APPS_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
INSTALL_AFTER_BUILD=0
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

echo "Building mac app from $APPS_DIR"
echo "Command: node ./build/build-desktop.mjs --mac$BUILD_ARGS"

# shellcheck disable=SC2086
node ./build/build-desktop.mjs --mac $BUILD_ARGS

if [ "$INSTALL_AFTER_BUILD" -eq 1 ]; then
  node ./build/install-and-smoke.mjs
fi
