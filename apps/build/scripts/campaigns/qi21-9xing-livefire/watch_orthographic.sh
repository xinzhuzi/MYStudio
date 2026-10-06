#!/bin/bash
# 撞车哨兵:每20秒查八处标记,被抹即自愈并响亮退出(唤醒主会话)。上限2小时。
cd /Users/zhengbingjin/Project/Github/MYStudio
for i in $(seq 1 360); do
  if ! python3 apps/build/scripts/campaigns/qi21-9xing-livefire/guard_orthographic_edits.py --check >/dev/null 2>&1; then
    echo "撞车检出(第 $i 轮)!开始自愈:"
    python3 apps/build/scripts/campaigns/qi21-9xing-livefire/guard_orthographic_edits.py --apply
    python3 apps/build/scripts/campaigns/qi21-9xing-livefire/guard_orthographic_edits.py --check
    exit 1
  fi
  sleep 20
done
echo "哨兵2小时到点,八处始终在位,无撞车。"
