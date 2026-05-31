#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APPS_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)

cd "$APPS_DIR"

node ./build/build-desktop.mjs --mac "$@"
