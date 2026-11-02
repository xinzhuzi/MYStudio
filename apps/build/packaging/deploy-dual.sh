#!/usr/bin/env bash
# 双机打包覆盖安装流水线(Mac 驱动 Mac+Windows)
# 用法: bash apps/build/packaging/deploy-dual.sh [--skip-mac] [--skip-win] [--skip-push] [--dry-run]
#
# Phase A: Mac 本地构建+覆盖安装+smoke → git push
# Phase B: SSH 到 Windows → git pull(降级scp) → build:win → 停引擎 → 安装 → 同步my-nodes → 重启引擎 → smoke
# Phase C: 双机状态汇报
#
# Trellis: .trellis/tasks/11-02-dual-machine-deploy-pipeline
set -euo pipefail

# ── 配置区 ────────────────────────────────────────────────────────
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MAC_BUILD_SCRIPT="$REPO_ROOT/apps/build/packaging/build-mac.sh"
WIN_HOST="zbj@192.168.0.101"
WIN_REPO="E:\\IP\\MYStudio"
WIN_INSTALL="E:\\IP\\manying-studio"
WIN_ENGINE_HOME="E:\\IP\\漫影工作室\\comfyui"
WIN_BUILD_OUT="apps\\release\\build\\win-x64\\win-unpacked"
WIN_ENGINE_PORT=17000
WIN_SSH_OPTS="-o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new"
BAT_LOG="E:\\IP\\tmp\\deploy-dual-build.log"
BAT_DONE="E:\\IP\\tmp\\deploy-dual-build.done"

# ── 参数解析 ─────────────────────────────────────────────────────
SKIP_MAC=false; SKIP_WIN=false; SKIP_PUSH=false; DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --skip-mac)  SKIP_MAC=true ;;
    --skip-win)  SKIP_WIN=true ;;
    --skip-push) SKIP_PUSH=true ;;
    --dry-run)   DRY_RUN=true ;;
    *) echo "[deploy-dual] 未知参数: $arg"; exit 1 ;;
  esac
done

# ── 工具函数 ─────────────────────────────────────────────────────
log() { echo "[deploy-dual $(date +%H:%M:%S)] $*"; }
die() { echo "[deploy-dual ERROR] $*" >&2; exit 1; }
dry() { if $DRY_RUN; then log "[dry-run] $*"; return 0; else return 1; fi; }

ssh_win() {
  ssh $WIN_SSH_OPTS "$WIN_HOST" "$@" 2>/dev/null
}

# ── Phase A: Mac 本地 ──────────────────────────────────────────
phase_a() {
  log "════ Phase A: Mac 本地构建+安装+smoke ════"

  # A1: 检测未提交变更
  if ! dry "检测未提交变更"; then
    local dirty
    dirty=$(cd "$REPO_ROOT" && git status --short | head -5)
    if [ -n "$dirty" ]; then
      log "⚠️  有未提交变更(前5条):"
      echo "$dirty"
      log "请先手动 commit 后再跑本脚本(--skip-push 可跳过推送)"
      die "存在未提交变更, refuse to continue"
    fi
    log "✅ 工作树干净"
  fi

  # A2: 构建+安装+smoke
  if ! dry "MANYYING_ALLOW_APP_LAUNCH=1 bash $MAC_BUILD_SCRIPT"; then
    log "Building & installing Mac app..."
    if ! MANYYING_ALLOW_APP_LAUNCH=1 bash "$MAC_BUILD_SCRIPT"; then
      die "Mac build/install/smoke 失败——请修复后重跑"
    fi
  fi
  log "✅ Mac 构建安装 smoke 全绿"

  # A4: git push
  if ! $SKIP_PUSH; then
    if ! dry "git push origin main"; then
      log "Pushing to GitHub..."
      if git -C "$REPO_ROOT" push origin main 2>&1 | tail -2; then
        log "✅ git push 成功"
      else
        log "⚠️  git push 失败(网络/权限?)——Windows 侧将使用已有版本"
      fi
    fi
  else
    log "⏭️  跳过 push (--skip-push)"
  fi
}

# ── Phase B: Windows 远程 ───────────────────────────────────────
phase_b() {
  log "════ Phase B: Windows 远程构建+安装+smoke ════"

  # B1: git pull(首选;先 checkout main 防 detached HEAD) / scp 变更文件(降级)
  if ! dry "Windows git pull"; then
    log "Pulling latest on Windows..."
    local pull_ok=false
    if ssh_win "cd /d $WIN_REPO && git checkout -q main 2>nul & git pull origin main 2>&1" | tail -2; then
      pull_ok=true
      log "✅ git pull 成功"
    else
      log "⚠️  git pull 失败(网络),降级 scp 推变更文件..."
      # 降级: scp 推 origin/main..HEAD 差集(已推远端与本地 HEAD 的差;兜底 HEAD~5)
      local changed
      changed=$(git -C "$REPO_ROOT" diff --name-only origin/main..HEAD 2>/dev/null | head -50)
      if [ -z "$changed" ]; then
        changed=$(git -C "$REPO_ROOT" diff --name-only HEAD~5..HEAD 2>/dev/null | head -50)
      fi
      if [ -n "$changed" ]; then
        log " scp 推送 $(echo "$changed" | wc -l | tr -d ' ') 个变更文件..."
        for f in $changed; do
          # 先在正斜杠域算父目录(macOS dirname 不认反斜杠),再转反斜杠投给 Windows
          local wf_dir_fwd="${f%/*}"
          local wf_dir="$(printf '%s' "$wf_dir_fwd" | tr '/' '\\')"
          ssh_win "if not exist \"$WIN_REPO\\$wf_dir\" mkdir \"$WIN_REPO\\$wf_dir\"" 2>/dev/null || true
          scp -o ConnectTimeout=5 "$REPO_ROOT/$f" "$WIN_HOST:$WIN_REPO\\${f//\//\\}" 2>/dev/null || log "  ⚠️  $f scp 失败"
        done
        log "✅ scp 降级完成(部分文件可能失败,建议后续手动 git pull)"
      else
        log "⚠️  无可检测的变更文件,Windows 使用当前已有版本"
      fi
    fi
  fi

  # B2: 构建(写 .bat → 后台执行 → 轮询)
  if ! dry "Windows build-desktop.mjs --win"; then
    log "Building Windows app..."
    # 写 batch 脚本
    local bat_content="@echo off\r\ncd /d $WIN_REPO\\apps\r\necho [%date% %time%] build start > $BAT_LOG\r\nif not exist node_modules\\electron (\r\n  echo npm install... >> $BAT_LOG\r\n  call npm install >> $BAT_LOG 2>&1\r\n)\r\necho building... >> $BAT_LOG\r\ncall node ./build/packaging/build-desktop.mjs --win >> $BAT_LOG 2>&1\r\nif %errorlevel% equ 0 (\r\n  echo BUILD_OK > $BAT_DONE\r\n) else (\r\n  echo BUILD_FAIL > $BAT_DONE\r\n)\r\necho [%date% %time%] build end >> $BAT_LOG"
    # 清旧标记
    ssh_win "del /f $BAT_DONE 2>nul & del /f $BAT_LOG 2>nul" || true
    # 写 bat 并启动
    echo -e "$bat_content" > /tmp/deploy-dual-build.bat
    scp -o ConnectTimeout=5 /tmp/deploy-dual-build.bat "$WIN_HOST:E:/IP/tmp/" >/dev/null
    ssh_win "start /b cmd /c E:\\IP\\tmp\\deploy-dual-build.bat" || true
    log " 构建已后台启动,轮询完成(最长 10 分钟)..."
    local elapsed=0
    while [ $elapsed -lt 600 ]; do
      local done_content
      done_content=$(ssh_win "type $BAT_DONE 2>nul" || echo "")
      if echo "$done_content" | grep -q "BUILD_OK"; then
        log "✅ Windows 构建成功(${elapsed}s)"
        break
      elif echo "$done_content" | grep -q "BUILD_FAIL"; then
        local log_tail
        log_tail=$(ssh_win "type $BAT_LOG 2>nul" | tail -20)
        die "Windows 构建失败——日志尾:\n$log_tail"
      fi
      sleep 10
      elapsed=$((elapsed + 10))
      [ $((elapsed % 60)) -eq 0 ] && log " ...等待中 ${elapsed}s"
    done
    [ $elapsed -ge 600 ] && die "Windows 构建超时(10min)"
  fi

  # B3: 停旧引擎
  if ! dry "停旧引擎进程"; then
    log "Stopping engine..."
    local pids
    pids=$(ssh_win "wmic process where \"commandline like '%%main.py%% and %%port $WIN_ENGINE_PORT%%'\" get processid /format:csv 2>nul" | grep -o '[0-9]*$' | head -5)
    if [ -n "$pids" ]; then
      for pid in $pids; do
        ssh_win "taskkill /F /PID $pid" >/dev/null 2>&1 || true
        log "  killed PID $pid"
      done
      sleep 2
    else
      log "  引擎未在跑(无需停)"
    fi
  fi

  # B4: 安装(robocopy /MIR;前置验证构建产物在)
  if ! dry "robocopy $WIN_BUILD_OUT → $WIN_INSTALL"; then
    log "Installing (robocopy /MIR)..."
    # 前置验证:构建产物 resources 目录在才拷
    if ! ssh_win "if exist \"$WIN_REPO\\$WIN_BUILD_OUT\\resources\" (echo OUT_OK) else (echo OUT_MISSING)" 2>/dev/null | grep -q "OUT_OK"; then
      die "构建产物不存在: $WIN_REPO\\$WIN_BUILD_OUT\\resources(B2 构建是否真成功?)"
    fi
    local rc_result
    rc_result=$(ssh_win "robocopy \"$WIN_REPO\\$WIN_BUILD_OUT\" \"$WIN_INSTALL\" /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS 2>&1; echo EXIT:%errorlevel%")
    local rc_code
    rc_code=$(echo "$rc_result" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
    # robocopy exit code 0-7 = success(0=无变化 1=已拷贝 2=额外 4=不匹配;8+=真失败), 8+ = failure
    if [ "$rc_code" -le 7 ] 2>/dev/null; then
      log "✅ robocopy 安装成功(exit=$rc_code)"
    else
      die "robocopy 失败(exit=$rc_code)"
    fi
  fi

  # B4.5: 同步 my-nodes 到引擎(Grill Q1=A:脚本直接复制;/E 仅增不删——引擎侧特有文件不能删)
  if ! dry "同步 my-nodes → 引擎"; then
    log "Syncing my-nodes to engine..."
    local mn_result
    mn_result=$(ssh_win "robocopy \"$WIN_INSTALL\\resources\\backend\\comfyui\\my_nodes\" \"$WIN_ENGINE_HOME\\ComfyUI\\custom_nodes\\my-nodes\" /E /R:2 /W:2 /XF __pycache__ *.pyc /NFL /NDL /NJH /NJS 2>&1; echo EXIT:%errorlevel%")
    local mn_code
    mn_code=$(echo "$mn_result" | grep -o 'EXIT:[0-9]*' | cut -d: -f2)
    # robocopy 0-7 = success; /E 不删引擎侧文件
    if [ "$mn_code" -le 7 ] 2>/dev/null; then
      log "✅ my-nodes 已同步到引擎 custom_nodes(exit=$mn_code)"
    else
      die "my-nodes 同步失败(exit=$mn_code)"
    fi
  fi

  # B5: 重启引擎(重试探测 /system_stats,最长 60s 每 5s——冷启动加载模型可能超 15s)
  if ! dry "重启引擎"; then
    log "Starting engine..."
    ssh_win "start /b \"$WIN_ENGINE_HOME\\venv\\Scripts\\pythonw.exe\" \"$WIN_ENGINE_HOME\\ComfyUI\\main.py\" --listen 0.0.0.0 --port $WIN_ENGINE_PORT --lowvram --enable-manager --use-pytorch-cross-attention --output-directory \"$WIN_ENGINE_HOME\\output\"" || true
    log " 等待引擎启动(重试探测,最长 60s)..."
    local engine_up=false engine_wait=0
    while [ $engine_wait -lt 60 ]; do
      sleep 5
      engine_wait=$((engine_wait + 5))
      if ssh_win "curl.exe -s --max-time 5 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null | grep -q "comfyui_version\|system"; then
        engine_up=true
        log "✅ 引擎已就绪(${engine_wait}s)"
        break
      fi
    done
    $engine_up || die "引擎 60s 内未就绪(查引擎日志: $WIN_ENGINE_HOME\\ComfyUI\\user\\comfyui.log 或手动跑 python main.py 看报错)"
  fi

  # B6: Smoke
  if ! dry "smoke: /system_stats + /object_info"; then
    log "Running engine smoke..."
    local stats
    stats=$(ssh_win "curl.exe -s --max-time 10 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null)
    if echo "$stats" | grep -q "comfyui_version\|system"; then
      local ver
      ver=$(echo "$stats" | grep -o '"comfyui_version":"[^"]*"' | head -1)
      log "✅ 引擎在跑 $ver"
    else
      die "引擎 /system_stats 无响应"
    fi

    local node_check
    node_check=$(ssh_win "curl.exe -s --max-time 10 http://127.0.0.1:$WIN_ENGINE_PORT/object_info/MyQi21SpeedSelect" 2>/dev/null)
    if echo "$node_check" | grep -q "MyQi21SpeedSelect"; then
      log "✅ MyQi21SpeedSelect 节点在册"
    else
      die "MyQi21SpeedSelect 节点不在册(my-nodes 同步失败?)"
    fi

    # KSampler 在册=cfg4 混动臂依赖的标准节点可用
    local ks_check
    ks_check=$(ssh_win "curl.exe -s --max-time 10 http://127.0.0.1:$WIN_ENGINE_PORT/object_info/KSampler" 2>/dev/null)
    if echo "$ks_check" | grep -q "KSampler"; then
      log "✅ KSampler 节点在册(cfg4 混动臂依赖)"
    else
      die "KSampler 节点不在册(引擎异常)"
    fi
  fi
}

# ── Phase C: 汇报 ───────────────────────────────────────────────
phase_c() {
  log "════ Phase C: 双机状态汇报 ════"

  local mac_ver win_ver win_engine
  mac_ver=$(git -C "$REPO_ROOT" log --oneline -1)
  win_ver=$(ssh_win "cd /d $WIN_REPO && git log --oneline -1" 2>/dev/null || echo "N/A")
  win_engine=$(ssh_win "curl.exe -s --max-time 5 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null | grep -o '"comfyui_version":"[^"]*"' || echo "引擎未跑")

  echo ""
  echo "┌──────────────────────────────────────────────┐"
  echo "│           双机部署状态                        │"
  echo "├───────────┬──────────────────────────────────┤"
  echo "│ Mac       │ $mac_ver"
  echo "│ Windows   │ $win_ver"
  echo "│ Win 引擎  │ $win_engine"
  echo "│ Mac App   │ 已安装+smoke 绿"
  echo "│ Win App   │ 已安装(robocopy /MIR)"
  echo "│ Win Nodes │ my-nodes 已同步"
  echo "└───────────┴──────────────────────────────────┘"
  echo ""
  log "🎉 双机部署完成"
}

# ── 主流程 ───────────────────────────────────────────────────────
log "双机打包覆盖安装流水线启动"
$DRY_RUN && log "🔇 DRY-RUN 模式(只打日志不执行)"

if ! $SKIP_MAC; then phase_a; else log "⏭️  跳过 Mac (--skip-mac)"; fi
if ! $SKIP_WIN; then phase_b; else log "⏭️  跳过 Windows (--skip-win)"; fi
phase_c
