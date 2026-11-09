#!/usr/bin/env bash
# 双机打包覆盖安装流水线(Mac 驱动 Mac+Windows)
# 用法: bash apps/build/packaging/deploy-dual.sh [--skip-mac] [--skip-win] [--skip-push] [--dry-run]
#
# Phase A: Mac 本地构建+覆盖安装+smoke → git push
# Phase B: SSH 到 Windows → git pull(降级scp) → build:win → 停引擎 → 安装 → 同步my-nodes → 重启引擎 → smoke → 令牌同步(B7)
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
# 11-03 S4 远端代理鉴权修(B7 令牌同步):Windows 侧装机令牌唯一持久化真源=
# image-gen config.json 的 controlToken 字段(electron getControlToken 读写,
# image-gen-runtime-controller.ts:148 路径=pythonRuntimeDir/profiles/image-gen/;
# pythonRuntimeDir=<storageBase>/python,storage-manager.ts:157)。本机存储根=
# E:\IP\漫影工作室(WIN_ENGINE_HOME 的父目录);Electron 默认 %APPDATA% 同构
# 路径作第二候选(在 Windows 侧 Join-Path 拼)。
WIN_TOKEN_CONFIG="E:\\IP\\漫影工作室\\python\\profiles\\image-gen\\config.json"
# Mac 侧落点:image_gen/server.py 凭据链最先读的 comfyui 家文件(comfy_home()
# 跨平台解析,macOS=~/Library/Application Support/漫影工作室/comfyui/)。
MAC_REMOTE_TOKEN_FILE="$HOME/Library/Application Support/漫影工作室/comfyui/remote-image-token.txt"

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
      # 降级差集基准=Windows 实际 HEAD(1102 实弹翻案:origin/main..HEAD 在 Mac 已推空时
      # 差集恒空→一个文件都送不过去→Windows 构建旧代码假绿;以 win_head..HEAD 为准,
      # Mac 没有该 commit(极端分叉)时退 origin/main..HEAD→HEAD~5 双兜底)
      local win_head
      win_head=$(ssh_win "cd /d $WIN_REPO && git rev-parse HEAD 2>nul" 2>/dev/null | tr -d '\r\n ')
      local changed
      if [ -n "$win_head" ] && git -C "$REPO_ROOT" cat-file -e "${win_head}^{commit}" 2>/dev/null; then
        log " Windows HEAD=$win_head(差集基准)"
        changed=$(git -C "$REPO_ROOT" diff --name-only "${win_head}..HEAD" 2>/dev/null | head -200)
      else
        changed=$(git -C "$REPO_ROOT" diff --name-only origin/main..HEAD 2>/dev/null | head -50)
      fi
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
    # 写 batch 脚本(printf %s 逐行——勿用 echo -e:它把路径里的 \t \a 吞成 TAB/BEL 控制字符,
    # 11-02 实测 E:\IP\tmp→E:\IP<TAB>p、\apps→<BEL>pps,bat 秒死且零日志)
    # 清旧标记
    ssh_win "del /f $BAT_DONE 2>nul & del /f $BAT_LOG 2>nul" || true
    {
      printf '%s\r\n' '@echo off'
      printf '%s\r\n' "cd /d $WIN_REPO\\apps"
      # 1102 事故:Windows 机出不了网到 github(B1 git pull reset + 打包期 ETIMEDOUT
      # 20.205.243.166:443),而 electron-builder 打包要从 GitHub releases 拉 electron
      # win32 dist zip 与 nsis/winCodeSign 工具链(win target=nsis 见 electron-builder.yml)。
      # 双镜像走 npmmirror(实测 200):@electron/get 认 ELECTRON_MIRROR,工具链认
      # ELECTRON_BUILDER_BINARIES_MIRROR;build-desktop.mjs 的 env 是 ...process.env
      # 展开,此处 set 会透传到 electron-builder。放在 pnpm install 前——electron 包
      # postinstall 的二进制下载也同享镜像(GitHub 通的网络用 npmmirror 亦通,恒设无害)。
      printf '%s\r\n' 'set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/'
      printf '%s\r\n' 'set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/'
      printf '%s\r\n' "echo [%date% %time%] build start > $BAT_LOG"
      # 1102 教训×2:①勿用「if not exist node_modules\electron」做条件——electron 在≠依赖齐,
      # package.json 后加的 @remotion/* 系恒缺,构建 verify-versions 必挂;②本仓库是 pnpm catalog 店,
      # 裸 npm install 必报 EUNSUPPORTEDPROTOCOL "catalog:"——恒跑增量 pnpm install(满足时 ~1min)
      printf '%s\r\n' "echo pnpm install (incremental)... >> $BAT_LOG"
      printf '%s\r\n' "call pnpm install >> $BAT_LOG 2>&1"
      printf '%s\r\n' "echo building... >> $BAT_LOG"
      printf '%s\r\n' "call node ./build/packaging/build-desktop.mjs --win >> $BAT_LOG 2>&1"
      printf '%s\r\n' 'if %errorlevel% equ 0 ('
      printf '%s\r\n' "  echo BUILD_OK > $BAT_DONE"
      printf '%s\r\n' ') else ('
      printf '%s\r\n' "  echo BUILD_FAIL > $BAT_DONE"
      printf '%s\r\n' ')'
      printf '%s\r\n' "echo [%date% %time%] build end >> $BAT_LOG"
    } > /tmp/deploy-dual-build.bat
    scp -o ConnectTimeout=5 /tmp/deploy-dual-build.bat "$WIN_HOST:E:/IP/tmp/" >/dev/null
    # ⚠️ 勿用 `start /b` / PowerShell Start-Process 起后台任务:本机 Windows OpenSSH 会话带
    # Job 对象,会话一断即清杀 detached 子进程(11-02 实测 start /b 连 bat 第一行都没跑;
    # 仓内 apps/build/scripts/win-engine/engine_task.py 文档串同款结论)。
    # 逃生路=WMI 域:Invoke-CimMethod Win32_Process::Create 由 WmiPrvSE(系统服务)拉起,
    # 不在 ssh Job 内——实测子进程跨会话完整存活,且该域内 node/npm 在 PATH 可用。
    local launch_rv
    launch_rv=$(ssh_win "powershell -NoProfile -Command \"(Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='cmd /c E:\\IP\\tmp\\deploy-dual-build.bat'}).ReturnValue\"" | tr -d '\r\n ')
    if [ "$launch_rv" != "0" ]; then
      die "构建进程拉起失败(WMI ReturnValue=$launch_rv)"
    fi
    log " 构建已后台启动(WMI 域),轮询完成(最长 20 分钟;首次 Windows 构建含下载)..."
    local elapsed=0
    while [ $elapsed -lt 1200 ]; do
      local done_content
      done_content=$(ssh_win "type $BAT_DONE 2>nul" || echo "")
      if echo "$done_content" | grep -q "BUILD_OK"; then
        log "✅ Windows 构建成功(${elapsed}s)"
        break
      elif echo "$done_content" | grep -q "BUILD_FAIL"; then
        log "❌ 构建失败,日志尾(全文在 $BAT_LOG):"
        ssh_win "type $BAT_LOG 2>nul" 2>/dev/null | tail -20 || true
        die "Windows 构建失败"
      fi
      sleep 10
      elapsed=$((elapsed + 10))
      [ $((elapsed % 60)) -eq 0 ] && log " ...等待中 ${elapsed}s"
    done
    if [ $elapsed -ge 1200 ]; then
      log "⏱️  超时,日志尾(全文在 $BAT_LOG):"
      ssh_win "type $BAT_LOG 2>nul" 2>/dev/null | tail -20 || true
      die "Windows 构建超时(20min)"
    fi
  fi

  # B3: 停旧引擎+停旧 App(App 在跑会锁 exe/dll → robocopy /MIR exit=11 装机失败,
  # 1104 晚实弹:链条死在 B4 且引擎已停=半瘫痪;先杀 App 再装,B8 装完再拉起)
  # 1105 补孤儿 sidecar 清杀:taskkill /F 只杀 App 父进程,image_gen sidecar 子进程
  # 变孤儿续命数秒-分钟,其加载的 resources\backend\** 模块文件恰好锁死 B4 robocopy
  # (16:03 实弹复发;App 已死时任何 image_gen python 都是孤儿,一并杀)
  if ! dry "停旧引擎进程"; then
    log "Stopping engine..."
    ssh_win "taskkill /F /IM manying-studio.exe" >/dev/null 2>&1 || true
    sleep 2
    ssh_win "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='python.exe' or Name='pythonw.exe'\\\" | Where-Object { \$_.CommandLine -match 'image_gen' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }\"" >/dev/null 2>&1 || true
    # wmic 已从新版 Windows 移除(本机实测 'wmic' 不是内部或外部命令)→ PowerShell CIM 等价查询
    # (实测命中全部 main.py+17000 引擎进程,含端口持有者与 venv 僵尸副本两个 PID)
    local pids
    pids=$(ssh_win "powershell -NoProfile -Command \"(Get-CimInstance Win32_Process -Filter \\\"Name='python.exe' or Name='pythonw.exe'\\\").Where({\$_.CommandLine -match 'main.py'}).Where({\$_.CommandLine -match '$WIN_ENGINE_PORT'}) | Select-Object -ExpandProperty ProcessId\"" | tr -d '\r' | grep -E '^[0-9]+$' | head -5 || true)
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
    # 旧写法 `... 2>&1; echo EXIT:%errorlevel%` 双坑:cmd 的 `;` 不是命令分隔符(实测整段静默失效),
    # 且同一行 %errorlevel% 在 robocopy 执行前就展开(恒为旧值)→ 改用 ssh 退出码透传(实测 robocopy 16 可透传)
    local rc_code=0
    ssh_win "robocopy \"$WIN_REPO\\$WIN_BUILD_OUT\" \"$WIN_INSTALL\" /MIR /R:2 /W:2 /NFL /NDL /NJH /NJS" >/dev/null || rc_code=$?
    # robocopy exit code 0-7 = success(0=无变化 1=已拷贝 2=额外 4=不匹配;8+=真失败)
    if [ "$rc_code" -le 7 ] 2>/dev/null; then
      log "✅ robocopy 安装成功(exit=$rc_code)"
    else
      die "robocopy 失败(exit=$rc_code)"
    fi
  fi

  # B4.5: 同步 my-nodes 到引擎(Grill Q1=A:脚本直接复制;/E 仅增不删——引擎侧特有文件不能删)
  if ! dry "同步 my-nodes → 引擎"; then
    log "Syncing my-nodes to engine..."
    local mn_code=0
    ssh_win "robocopy \"$WIN_INSTALL\\resources\\backend\\comfyui\\my_nodes\" \"$WIN_ENGINE_HOME\\ComfyUI\\custom_nodes\\my-nodes\" /E /R:2 /W:2 /XF __pycache__ *.pyc /NFL /NDL /NJH /NJS" >/dev/null || mn_code=$?
    # robocopy 0-7 = success; /E 不删引擎侧文件;退出码经 ssh 透传(同 B4)
    if [ "$mn_code" -le 7 ] 2>/dev/null; then
      log "✅ my-nodes 已同步到引擎 custom_nodes(exit=$mn_code)"
    else
      die "my-nodes 同步失败(exit=$mn_code)"
    fi
  fi

  # B5: 重启引擎(schtasks 调度域拉起 + 重试探测 /system_stats,最长 120s 每 5s——冷启动加载模型慢)
  if ! dry "重启引擎"; then
    log "Starting engine..."
    # 勿用 start /b 起引擎:同 B2 的 ssh Job 清杀;且会丢 engine_task.py 的调度域环境补丁
    # (TEMP/TMP/USERPROFILE/LOCALAPPDATA——调度域缺这些 torch 报 [Errno 22])与 bridge 令牌注入。
    # 规范入口=计划任务 EngineDurable(engine_task.py 调度域实体;一次性已跑完 State=Ready,
    # 非常驻看门狗——B3 杀掉引擎不会触发自动复活,无竞态)。
    if ! ssh_win "schtasks /Run /TN EngineDurable"; then
      die "schtasks /Run EngineDurable 失败(任务缺失?见 apps/build/scripts/win-engine/engine_task.py 文档串)"
    fi
    log " 等待引擎启动(重试探测,最长 120s)..."
    local engine_up=false engine_wait=0
    while [ $engine_wait -lt 120 ]; do
      sleep 5
      engine_wait=$((engine_wait + 5))
      if ssh_win "curl.exe -s --max-time 5 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null | grep -q "comfyui_version\|system"; then
        engine_up=true
        log "✅ 引擎已就绪(${engine_wait}s)"
        break
      fi
    done
    $engine_up || die "引擎 120s 内未就绪(查引擎日志: $WIN_ENGINE_HOME\\logs\\engine.log——engine_task.py 的落点)"
  fi

  # B6: Smoke
  if ! dry "smoke: /system_stats + /object_info"; then
    log "Running engine smoke..."
    local stats
    stats=$(ssh_win "curl.exe -s --max-time 10 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null)
    if echo "$stats" | grep -q "comfyui_version\|system"; then
      local ver
      ver=$(echo "$stats" | grep -o '"comfyui_version" *: *"[^"]*"' | head -1)
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

  # B7: 令牌同步(SSH 模块自愈的降级兜底;11-03 Q4/R5 口径)——主路径是
  # sidecar 内建 SSH 模块 SFTP 自动发现并刷新同一文件(remote_ssh/service.py
  # refresh_remote_token);本步兜底覆盖 SSH 未配置/paramiko 未装/免密信任
  # 不可用的环境。双机装机令牌各异,Mac 代理远端 sidecar 持本机令牌必 403:
  # 从 Windows App 持久化的 controlToken(config.json)读出,写回 Mac comfyui
  # 家 remote-image-token.txt(server.py 凭据链最先读它;与模块原子写同内容
  # last-writer-wins 无冲突 C4)。找不到(App 未首用过 image-gen/路径变体)
  # =跳过不阻断,log 给手动配法。
  if ! dry "令牌同步: Windows controlToken → Mac remote-image-token.txt"; then
    log "Syncing remote sidecar token (B7)..."
    local win_token
    win_token=$(ssh_win "powershell -NoProfile -Command \"\$c = @('$WIN_TOKEN_CONFIG', (Join-Path \$env:APPDATA '漫影工作室\\python\\profiles\\image-gen\\config.json')); foreach (\$p in \$c) { if (Test-Path \$p) { \$j = Get-Content -LiteralPath \$p -Raw | ConvertFrom-Json; if (\$j.controlToken) { Write-Output \$j.controlToken; break } } }\"" 2>/dev/null | tr -d '\r' | grep -m1 -E '^[A-Za-z0-9][A-Za-z0-9_-]*$' || true)
    if [ -n "$win_token" ]; then
      if mkdir -p "$(dirname "$MAC_REMOTE_TOKEN_FILE")" && printf '%s\n' "$win_token" > "$MAC_REMOTE_TOKEN_FILE"; then
        log "✅ Windows 侧令牌已同步到 comfyui 家 remote-image-token.txt(远端代理凭据链最先读它)"
      else
        log "⚠️  令牌写入失败($MAC_REMOTE_TOKEN_FILE)——不阻断,可手动写入"
      fi
    else
      log "⚠️  未在 Windows 侧找到 image-gen controlToken(找过 $WIN_TOKEN_CONFIG 与 %APPDATA% 同构路径;Win 侧 App 启动一次即自动生成令牌,或检查 storageBase 重定向路径)——跳过令牌同步不阻断"
      log "    如远端代理 403,请手动:从 Windows 该 config.json 取 controlToken,写入 Mac 的 \"$MAC_REMOTE_TOKEN_FILE\""
    fi
  fi

  # B8: MYStudio 桌面可见拉起(1104 交接清单#4)。schtasks /IT=交互令牌,任务在
  # 桌面会话(Session 1)运行用户可见——SSH 直启 GUI 会落 Session 0 隐形(用户
  # 再双击=双实例,违单一实例铁律),计划任务 /IT 是唯一桌面可见的远程拉起通道。
  # 先 taskkill 旧实例(robocopy /MIR 覆盖后旧进程仍持旧代码;杀后再拉=单实例),
  # 再 /Create(幂等 /F)+/Run。路径无空格,免内层引号穿 cmd/ssh 双层。
  if ! dry "MYStudio 桌面拉起(schtasks /IT)"; then
    log "Launching MYStudio (B8)..."
    ssh_win "taskkill /F /IM manying-studio.exe" >/dev/null 2>&1 || true
    if ! ssh_win "if exist $WIN_INSTALL\\manying-studio.exe exit 0 else exit 1"; then
      die "未找到 $WIN_INSTALL\\manying-studio.exe(安装布局变体?人工核查)"
    fi
    if ! ssh_win "schtasks /Create /TN StartMYStudio /TR $WIN_INSTALL\\manying-studio.exe /SC ONCE /ST 00:00 /IT /F"; then
      die "schtasks /Create StartMYStudio 失败"
    fi
    if ! ssh_win "schtasks /Run /TN StartMYStudio"; then
      die "schtasks /Run StartMYStudio 失败(刚建即失?人工 schtasks /Query /TN StartMYStudio 核查)"
    fi
    log "✅ MYStudio 已桌面会话拉起(/IT 用户可见;先杀后拉=单实例)"
  fi
}

# ── Phase C: 汇报 ───────────────────────────────────────────────
phase_c() {
  log "════ Phase C: 双机状态汇报 ════"

  local mac_ver win_ver win_engine
  mac_ver=$(git -C "$REPO_ROOT" log --oneline -1)
  win_ver=$(ssh_win "cd /d $WIN_REPO && git log --oneline -1" 2>/dev/null || echo "N/A")
  win_engine=$(ssh_win "curl.exe -s --max-time 5 http://127.0.0.1:$WIN_ENGINE_PORT/system_stats" 2>/dev/null | grep -o '"comfyui_version" *: *"[^"]*"' || echo "引擎未跑")

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
