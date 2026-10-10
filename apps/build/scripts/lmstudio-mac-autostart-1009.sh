#!/bin/sh
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Mac 本地 LM Studio 开机自启安装器(1009「要保证本地可用」役)。
#
# 动机:qi21 [4013] AI扩写本地回落二级=Mac 127.0.0.1:1234 的 27B MLX;
# 此前 LM Studio 桌面 App 靠手动开,重启电脑后本地回落即死。Windows 侧早有
# 计划任务 LMStudio-LAN-Server 先例(见 lmstudio-win-remote-1006),本件补 Mac 侧。
#
# 行为:装 ~/Library/LaunchAgents/com.mystudio.lmstudio-local.plist(RunAtLoad):
#   ①lms server status 已在跑→跳过;不在→lms server start --port 1234(无头,免开GUI)
#   ②lms load 27B -c 32768 --gpu max --ttl 1年(常驻不自动卸;已装载=幂等跳过)
# 幂等可重跑;卸载=launchctl bootout gui/$UID ~/Library/LaunchAgents/com.mystudio.lmstudio-local.plist && rm 同名plist。
set -eu

LMS="$HOME/.lmstudio/bin/lms"
PLIST="$HOME/Library/LaunchAgents/com.mystudio.lmstudio-local.plist"
LABEL="com.mystudio.lmstudio-local"
LOG="$HOME/.lmstudio/lmstudio-local-agent.log"

[ -x "$LMS" ] || { echo "缺 lms CLI($LMS)——先装 LM Studio"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>LMS="\$HOME/.lmstudio/bin/lms"; "\$LMS" server status >/dev/null 2>&1 || "\$LMS" server start --port 1234; sleep 3; "\$LMS" load qwen3.8-27b-coder390 -c 32768 --gpu max --ttl 31536000 >/dev/null 2>&1 || true; echo "[agent] done \$(date '+%F %T')"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

# 已装先卸(幂等重装),再 bootstrap(RunAtLoad 即刻试跑一轮=安装自测)
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 6
echo "=== 装载态 ==="
launchctl list | grep "$LABEL" || true
echo "=== server ==="
"$LMS" server status
echo "=== agent 日志尾3行 ==="
tail -3 "$LOG" 2>/dev/null || echo "(日志未生成)"
