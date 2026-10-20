#!/bin/bash
# 晏燎图生图战役·批量驱动(1020):逐张 指针→点火→轮询产物→记账。
# 用法: bash asset_yanliao_i2i_drive_1020.sh <目标基名...>(首张已完成的不传)
set -u
REPO=/Users/zhengbingjin/Project/Github/MYStudio
DST="/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎"
LOG=/tmp/yanliao-i2i-progress.log
: > "$LOG"

ok=0; fail=0; failed_list=()
for target in "$@"; do
  echo "[$(date +%H:%M:%S)] ▶ $target" | tee -a "$LOG"
  # ① 主图指针
  if ! python3 "$REPO/apps/build/scripts/asset_yanliao_i2i_pointer_1020.py" --target "$target" >> "$LOG" 2>&1; then
    echo "[$(date +%H:%M:%S)] ✗ $target pointer败" | tee -a "$LOG"; fail=$((fail+1)); failed_list+=("$target"); continue
  fi
  # ② 点火(弹窗重开+校验+点钮)
  if ! node "$REPO/apps/build/scripts/asset_yanliao_i2i_fire_1020.mjs" "$target" >> "$LOG" 2>&1; then
    echo "[$(date +%H:%M:%S)] ✗ $target fire败" | tee -a "$LOG"; fail=$((fail+1)); failed_list+=("$target"); continue
  fi
  # ③ 轮询产物(最长 6 分钟;日期跨天兼容)
  out=""
  for i in $(seq 1 72); do
    sleep 5
    out=$(ls "$DST" 2>/dev/null | grep -F "${target}_202" | head -1)
    [ -n "$out" ] && break
  done
  if [ -n "$out" ]; then
    echo "[$(date +%H:%M:%S)] ✓ $out" | tee -a "$LOG"; ok=$((ok+1))
  else
    echo "[$(date +%H:%M:%S)] ✗ $target 6分钟无产物" | tee -a "$LOG"; fail=$((fail+1)); failed_list+=("$target")
  fi
  sleep 4  # i2iPhase 3s 清相位
done

echo "==== 汇总: 成 $ok / 败 $fail ====" | tee -a "$LOG"
[ $fail -gt 0 ] && printf '失败清单:\n%s\n' "${failed_list[@]}" | tee -a "$LOG"
exit 0
