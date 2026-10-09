#!/usr/bin/env python3
"""1009 表情差分逐格点位轮——部署侧三副本同步手术(仓库真源已由本役 Edit 落盘)。

九情绪枚举改逐格点位点名(左上=沉静…右下=决然)后,②层底座「顺序从左到右、从上到下」
条款与点位映射冲突(行序 vs 列点位=漂移源),三处条款同步退役。引擎热读 daojie-data,
故引擎家副本必须落盘才进本次 fire 跑。只动表情差分三句——types 之外的并行在途分歧
(meixuan 轮等)不碰、不整文件覆盖。

用法:python3 qi21_facegrid_posmap_1009.py [--apply](缺省=干跑校验)
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

HOME = Path.home()
TARGETS = [
    HOME / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
    Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
]

SWAPS = [
    ("眉眼、鼻颊与嘴部形态随主体句指定的九个情绪变化，顺序从左到右、从上到下。",
     "眉眼、鼻颊与嘴部形态随主体句逐格点位指定的情绪变化。"),
    ("各格情绪与顺序以主体句为准", "各格情绪以主体句逐格点位为准"),
    ("主体句依从左到右、从上到下的顺序指定九个情绪，并为各情绪补充可见的眉眼、眼睑、鼻颊、嘴角与唇形变化",
     "主体句按左上、左中、左下、中上、中中、中下、右上、右中、右下九个点位逐格指定情绪，并为各情绪补充可见的眉眼、眼睑、鼻颊、嘴角与唇形变化"),
]

apply = "--apply" in sys.argv
for tgt in TARGETS:
    raw = tgt.read_bytes()
    text = raw.decode("utf-8")
    data = json.loads(text)
    t7 = [t for t in data["types"] if t.get("zh") == "表情差分"][0]
    for old, new in SWAPS:
        n = text.count(old)
        assert n == 1, f"{tgt.name}@{tgt.parent.parent.name}: 锚点计数={n} ≠1: {old[:20]}…"
        text = text.replace(old, new, 1)
    after = json.loads(text)
    t7a = [t for t in after["types"] if t.get("zh") == "表情差分"][0]
    for _, new in SWAPS:
        assert any(new in t7a[k] for k in ("rgba_positive", "positive_text", "purpose")), f"新句未落在表情差分条目: {new[:20]}…"
    # 除三句外整档逐键一致(只动这三句)
    assert after["types"][:7] == data["types"][:7] and after["types"][8:] == data["types"][8:]
    for k in t7:
        if k not in ("rgba_positive", "positive_text", "purpose"):
            assert t7[k] == t7a[k], f"误伤字段 {k}"
    print(f"[{'APPLY' if apply else 'CHECK'}] {tgt} ✓ 三锚点命中,除三句外零改动")
    if apply:
        bak = tgt.with_suffix(tgt.suffix + ".bak-posmap-1009")
        assert not bak.exists(), f"备份已存在勿覆盖: {bak}"
        shutil.copy2(tgt, bak)
        fd, tmp = tempfile.mkstemp(prefix=".posmap-", dir=tgt.parent)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text); f.flush(); os.fsync(f.fileno())
        shutil.copymode(tgt, tmp)
        os.replace(tmp, tgt)
print("DONE" if apply else "CHECK-PASS(加 --apply 落盘)")
