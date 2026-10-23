#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""t2i 加速蓝图壳 [7010] cfg1 补同步(役号 1017bp-cfg1)。

背景:qi21_native_cfg1_1017.py 将 t2i/i2i 宿主加速子图 [7010] 原生出图
KSampler cfg 4→1,但 t2i 侧蓝图镜像(my_nodes/subgraphs/qi21-道劫-加速子图.json)
未随抽,致 test_three_accel_blueprints_match_host 红(i2i 蓝图当时已同步)。
本刀=钦定通道语义的最小补抽:只改蓝图 [7010] 两处 widget 存储cfg
(widgets_values[3] / widgets_values_named.cfg)4→1,与宿主全等。

fail-closed:术前 md5 锚不符即中止 exit 2;已同步态重跑 exit 3 幂等拦停;
备份 .bak-1017bpcfg1(循 0 先例不入库);原子写+回读终验。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

BP = Path(__file__).resolve().parents[3] / (
    "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图.json")
PRE_MD5 = "0b646752408378e72019d4bda82f9810"  # 术前锚(1017 typespeed 后实态)
CAMPAIGN = "1017bpcfg1"


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main() -> int:
    if not BP.exists():
        print(f"[{CAMPAIGN}] 蓝图件缺失:{BP}")
        return 2
    doc = json.loads(BP.read_text(encoding="utf-8"))
    sg = doc["definitions"]["subgraphs"][0]
    n = next((x for x in sg["nodes"] if x["id"] == 7010), None)
    if n is None:
        print(f"[{CAMPAIGN}] 蓝图内无 [7010]")
        return 2
    wv, wvn = n.get("widgets_values"), n.get("widgets_values_named", {})
    already = (len(wv) > 3 and wv[3] == 1 and wvn.get("cfg") == 1)
    if already:
        print(f"[{CAMPAIGN}] 已同步态(cfg1)——幂等拦停,零写入")
        return 3
    if not (len(wv) > 3 and wv[3] == 4 and wvn.get("cfg") == 4):
        print(f"[{CAMPAIGN}] 术前锚失:[7010] 非 cfg4 态(wv[3]={wv[3]!r},"
              f"named.cfg={wvn.get('cfg')!r})——非本刀预期形态,中止")
        return 2
    if md5(BP) != PRE_MD5:
        print(f"[{CAMPAIGN}] 术前 md5 锚失:{md5(BP)} != {PRE_MD5}"
              "(并行役已动本件?)——中止")
        return 2

    shutil.copy2(BP, BP.with_name(BP.name + f".bak-{CAMPAIGN}"))
    n["widgets_values"][3] = 1
    n["widgets_values_named"]["cfg"] = 1
    tmp = BP.with_name(BP.name + f".tmp-{CAMPAIGN}")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(BP)

    back = json.loads(BP.read_text(encoding="utf-8"))
    bn = next(x for x in back["definitions"]["subgraphs"][0]["nodes"] if x["id"] == 7010)
    assert bn["widgets_values"][3] == 1 and bn["widgets_values_named"]["cfg"] == 1
    print(f"[{CAMPAIGN}] 同步毕:t2i 加速蓝图 [7010] cfg 4→1(双存储),"
          f"新 md5={md5(BP)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
