#!/bin/sh
# qwen-image-2.1-consistency 外置迁移(1009 用户令「这个无用也迁移走」)
# 件=LoRA台账 #24:零引用纯文件件(无需摘节点),152MB;
# 外置位遵循既有模式(/Volumes/郑冰津/AI/<家族>/,参照 #22 H3 同款)。
# 动作:①核源文件在位+记 sha256 ②mkdir 外置家族位 ③mv(移动非拷贝,本地清位)
#      ④写迁移凭据(manifest-migrated)⑤台账 #24 行补外置注记(人工或补丁,本脚本只打印提醒)
# fail-closed:源缺/卷缺即停,零半态。
set -eu

SRC="/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/models/loras/qwen-image-2.1-consistency.safetensors"
DST_DIR="/Volumes/郑冰津/AI/Qwen"
RECEIPT_DIR="/Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/backups"

[ -f "$SRC" ] || { echo "FAIL: 源文件不在 $SRC"; exit 1; }
[ -d "/Volumes/郑冰津/AI" ] || { echo "FAIL: 外置卷不在位(/Volumes/郑冰津/AI)——挂盘后重跑"; exit 1; }

SHA=$(shasum -a 256 "$SRC" | cut -d' ' -f1)
SIZE=$(stat -f %z "$SRC")
echo "源件 sha256=$SHA size=$SIZE"

mkdir -p "$DST_DIR"
DST="$DST_DIR/qwen-image-2.1-consistency.safetensors"
if [ -f "$DST" ]; then
  echo "外置位已有同名件,核对 sha:"
  shasum -a 256 "$DST"
  [ "$(shasum -a 256 "$DST" | cut -d' ' -f1)" = "$SHA" ] && { echo "同件已在,只清本地"; rm "$SRC"; } \
    || { echo "FAIL: 外置位同名但 sha 不同,人工裁定"; exit 1; }
else
  mv "$SRC" "$DST"
  [ "$(shasum -a 256 "$DST" | cut -d' ' -f1)" = "$SHA" ] || { echo "FAIL: 迁后 sha 不符,回滚"; mv "$DST" "$SRC"; exit 1; }
fi

printf '%s\n' "{\"migrated_at\":\"$(date +%Y-%m-%dT%H:%M%z)\",\"file\":\"qwen-image-2.1-consistency.safetensors\",\"size\":$SIZE,\"sha256\":\"$SHA\",\"from\":\"~/Project/IP/漫影工作室/comfyui/models/loras/\",\"to\":\"/Volumes/郑冰津/AI/Qwen/\",\"reason\":\"1009 用户令『这个无用也迁移走』——零引用备用件外置归档,本地清位 152MB\",\"ledger_row\":\"#24\"}" \
  > "$RECEIPT_DIR/manifest-migrated-consistency-1009.jsonl"
echo "DONE: 迁移毕,凭据=$RECEIPT_DIR/manifest-migrated-consistency-1009.jsonl"
echo "TODO(人工/下轮): LoRA台账 #24 行补外置位注记(对齐 #22 格式)+核账头记一笔"
