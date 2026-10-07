#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 t2i [402] 卡收尾镜像 1008(工作流 dwfrun-61eb12a6 深度审核 F1 余账)。

背景:并行 [4018] 删槽役部署时对 [402] 卡只写了列表槽(8825 字新文),命名槽
滞留 1008 第一役旧文(8778 字)=双槽分裂,旧文将从命名槽复活(家规双槽陷阱)。
该役部署后文件静默已过 30 分钟门(动手前脚本内重验),本件只做两笔:
  1) 命名槽 := 列表槽(镜像,基准=并行役新文,不改其内容);
  2) 「4.2MP 六型」→「4.2MP 七型」(审核 F4:canon 现分布 {4.2:7, 1.0:3})。
同步:仓库→装机/构建/引擎家 四树 md5 家族验收。不动其他任何内容。
"""
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
REL = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
TARGETS = [
    REPO / REL,
    Path("/Applications/漫影工作室.app/Contents/Resources") / REL.replace("apps/backend/", "backend/", 1),
    REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / REL.replace("apps/backend/", "backend/", 1),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows" / REL.split("workflows/", 1)[1],
]
DRY = "--dry" in sys.argv

src = TARGETS[0]
age_min = (time.time() - src.stat().st_mtime) / 60
if age_min < 30:
    print(f"ABORT: t2i mtime 距今 {age_min:.0f} 分钟 <30(并行役仍在写,静默门未过)")
    sys.exit(1)
print(f"[gate] t2i 静默 {age_min:.0f} 分钟 ✓")

# 部署副本若与仓库不一致,先报后停(防覆写异版)
sig = {hashlib.md5(p.read_bytes()).hexdigest() for p in TARGETS if p.exists()}
if len(sig) != 1:
    for p in TARGETS:
        print("  ", hashlib.md5(p.read_bytes()).hexdigest(), p)
    print("ABORT: 四树不一致,先查明")
    sys.exit(1)

d = json.loads(src.read_text(encoding="utf-8"))
node = [n for n in d["nodes"] if n.get("id") == 402][0]
a = node["widgets_values"][0]
b = node["widgets_values_named"]["text"]
if a == b:
    print("双槽已一致,无需镜像;exit 0")
    sys.exit(0)
if not (len(a) == 8825 and len(b) == 8778):
    print(f"ABORT: 槽长 {len(a)}/{len(b)} 与审核锚(8825/8778)不符——内容又变了,重验再动")
    sys.exit(1)
cnt = a.count("4.2MP 六型")
if cnt != 1:
    print(f"ABORT: 「4.2MP 六型」命中 {cnt} 次(须1)")
    sys.exit(1)
a2 = a.replace("4.2MP 六型", "4.2MP 七型")
node["widgets_values"][0] = a2
node["widgets_values_named"]["text"] = a2
print(f"[surgery] 镜像+七型修正: 双槽={len(a2)} 字 ✓")

if DRY:
    print("[dry] 未写盘")
    sys.exit(0)

src.write_text(json.dumps(d, ensure_ascii=False, indent=2, separators=(",", ": ")), encoding="utf-8")
for dst in TARGETS[1:]:
    shutil.copy2(src, dst)
for p in TARGETS:
    json.loads(p.read_text(encoding="utf-8"))
    assert hashlib.md5(p.read_bytes()).hexdigest() == hashlib.md5(src.read_bytes()).hexdigest(), p
print("[sync] 四树同 md5 + JSON 合法 ✓")
