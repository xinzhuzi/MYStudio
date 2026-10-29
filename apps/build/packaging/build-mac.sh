#!/usr/bin/env sh
set -eu

# 1003 死守卫(漫影App 启动解锁透传):本脚本自身不拦 App 启动——拦的职责在
# install-and-smoke.mjs / smoke-desktop.mjs 等 App 启动件(未解锁时它们会在任何
# close/launch/spawn App 动作之前拒跑退出)。解锁用法:用户亲口要打包时前台执行
#   MANYYING_ALLOW_APP_LAUNCH=1 bash apps/build/packaging/build-mac.sh
# 此处显式 export 确保变量必然透传给 build/install/smoke 全部子脚本与重试递归。
if [ -n "${MANYYING_ALLOW_APP_LAUNCH:-}" ]; then
  export MANYYING_ALLOW_APP_LAUNCH
fi

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

# 链首在驾实例 fail-fast 预检:pgrep 模式与 build/smoke/smoke-process-lifecycle.mjs
# probeRunningInstances 默认 pattern("漫影工作室.app")同源。链尾 install-and-smoke.mjs
# 默认 guard 态本就会因实例在跑而中止——本预检把同一判定前移到 10 分钟构建之前,
# 免得整链白跑一轮(不动 1003 守卫体:保守 fail-closed,不自动退 App)。豁免两口与
# resolvePrekillMode(skip > force > guard)同构:MYSTUDIO_SMOKE_SKIP_PREKILL=1 或
# MYSTUDIO_SMOKE_PREKILL_FORCE=1 任一即跳过——FORCE 口必须豁免,否则
# install-and-smoke.mjs 的显式僵尸清理口会被链首堵死整链不可达。注意下方 install
# 段命令级前缀强制 MYSTUDIO_SMOKE_SKIP_PREKILL=0:用户设 SKIP=1 链首虽跳过、链尾
# 冒烟仍 guard 态中止并递归整链重试(白跑一轮死路),故失败文案只推「关 App 重跑」
# 与「FORCE 显式清理」两条,不指引 SKIP 口。重试递归(下方 sh 重新进入本脚本)会
# 自然复跑本预检——重试途中用户开 App=快速失败,期望行为。
if [ "${MYSTUDIO_SMOKE_SKIP_PREKILL:-0}" = "1" ] || [ "${MYSTUDIO_SMOKE_PREKILL_FORCE:-0}" = "1" ]; then
  echo "Skipping chain-head running-instance precheck (prekill SKIP/FORCE env set)."
elif pgrep -f "漫影工作室.app" >/dev/null 2>&1; then
  echo "[build-mac] 检测到 漫影工作室 实例正在运行,链首快速失败(构建前拦截,免整链白跑)。" >&2
  echo "[build-mac] 出路一:关闭漫影工作室 App 后重跑。" >&2
  echo "[build-mac] 出路二:确系残留冒烟僵尸,设 MYSTUDIO_SMOKE_PREKILL_FORCE=1 解锁变量,走显式清理后重跑。" >&2
  exit 1
fi

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
