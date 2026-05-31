#!/usr/bin/env bash
# MYStudio 本地开发环境一键配置
# 用法: bash apps/build/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── 颜色 ───
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[setup]${NC} $1"; }
# ─── 1. 安装 Node.js 依赖 ───
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

show_python_runtime_note() {
  info "Python 运行环境不在 setup 阶段安装，也不会写入后端源码目录"
  info "首次使用本地 TTS 前，请在应用设置 > Python 配置中点击“开始配置”"
  info "Python runtime 会安装到项目存储路径下的 python"
}

# ─── 执行 ───
echo ""
echo "╔══════════════════════════════════════╗"
echo "║   MYStudio 本地开发环境配置          ║"
echo "╚══════════════════════════════════════╝"
echo ""

setup_node
show_python_runtime_note

echo ""
info "✅ 配置完成！"
info "启动开发模式: cd apps && npm run dev"
info "打包: cd apps && npm run build"
echo ""
