#!/usr/bin/env bash
# MYStudio 本地开发环境一键配置
# 用法: bash apps/build/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/apps/backend"
PYTHON_DIR="$BACKEND_DIR/python"
PYTHON_BIN="$PYTHON_DIR/bin/python3"

# ─── 颜色 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[setup]${NC} $1"; }
warn() { echo -e "${YELLOW}[setup]${NC} $1"; }

# ─── 1. 下载 Python (python-build-standalone) ───
setup_python() {
  if [ -f "$PYTHON_BIN" ]; then
    info "Python 已存在: $("$PYTHON_BIN" --version)"
    return
  fi

  info "下载 Python 3.12 (python-build-standalone)..."
  ARCH="$(uname -m)"
  OS="$(uname -s)"

  if [ "$OS" = "Darwin" ] && [ "$ARCH" = "arm64" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-aarch64-apple-darwin-install_only.tar.gz"
  elif [ "$OS" = "Darwin" ] && [ "$ARCH" = "x86_64" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-apple-darwin-install_only.tar.gz"
  elif [ "$OS" = "Linux" ] && [ "$ARCH" = "x86_64" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-x86_64-unknown-linux-gnu-install_only.tar.gz"
  elif [ "$OS" = "Linux" ] && [ "$ARCH" = "aarch64" ]; then
    URL="https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.12.7+20241016-aarch64-unknown-linux-gnu-install_only.tar.gz"
  else
    echo "不支持的平台: $OS $ARCH"
    exit 1
  fi

  TMPFILE="$(mktemp)"
  curl -L --progress-bar -o "$TMPFILE" "$URL"
  rm -rf "$PYTHON_DIR"
  tar -xzf "$TMPFILE" -C "$BACKEND_DIR"
  rm -f "$TMPFILE"
  info "Python 安装完成: $("$PYTHON_BIN" --version)"
}

# ─── 2. 安装 Python 依赖 ───
setup_python_deps() {
  REQ_FILE="$BACKEND_DIR/requirements.txt"
  MARKER="$BACKEND_DIR/python/.deps-hash"
  CURRENT_HASH="$(md5 -q "$REQ_FILE" 2>/dev/null || md5sum "$REQ_FILE" | cut -d' ' -f1)"
  if [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = "$CURRENT_HASH" ]; then
    # 验证关键模块是否可导入
    if "$PYTHON_BIN" -c "import mlx_audio, huggingface_hub, numpy" 2>/dev/null; then
      info "Python 依赖已是最新，跳过"
      return
    fi
    warn "依赖标记存在但模块缺失，重新安装..."
  fi
  info "安装 Python 后端依赖..."
  "$PYTHON_BIN" -m pip install --quiet -r "$REQ_FILE"
  # 验证安装结果
  if ! "$PYTHON_BIN" -c "import mlx_audio, huggingface_hub, numpy" 2>/dev/null; then
    echo "❌ 依赖安装失败，请检查网络连接"
    exit 1
  fi
  echo "$CURRENT_HASH" > "$MARKER"
  info "Python 依赖安装完成"
}

# ─── 3. 安装 Node.js 依赖 ───
setup_node() {
  APPS_DIR="$PROJECT_ROOT/apps"
  if [ -d "$APPS_DIR/node_modules/electron" ] && [ -d "$APPS_DIR/node_modules/electron-vite" ]; then
    info "Node.js 依赖已存在，跳过"
    return
  fi
  info "安装 Node.js 依赖..."
  cd "$APPS_DIR"
  npm install
  if [ ! -d "$APPS_DIR/node_modules/electron" ]; then
    echo "❌ Node.js 依赖安装失败"
    exit 1
  fi
  info "Node.js 依赖安装完成"
}

# ─── 执行 ───
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   MYStudio 本地开发环境配置          ║"
echo "╚══════════════════════════════════════╝"
echo ""

setup_python
setup_python_deps
setup_node

echo ""
info "✅ 配置完成！"
info "启动开发模式: cd apps && npm run dev"
info "打包: cd apps && npm run build"
echo ""
