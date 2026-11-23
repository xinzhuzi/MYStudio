#!/usr/bin/env python3
"""daojie_sheet_band_shrink_1114.py — 底带收高 150→108(1114 用户令「最下面的框高度有些高」)。

内容实需=两行文字块~83px+五圆径56px→108px 恰容(上下留 ~12px);省出的 42px
还给底行图区(全卡/无装备 r4 +42;竖版底区 2916..3676 +42;简版 r2 相应收)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")
PH_NEW = 108


def main() -> int:
    data = json.loads(TRUTH.read_text(encoding="utf-8"))
    fmts = data["sheet_card_qwen"]["formats"]

    # 全卡:PH 150→108(r4 公式自动 +42)
    g = fmts["全卡"]["grid"]
    assert g["vars"]["PH"] == 150
    g["vars"]["PH"] = PH_NEW

    # 无装备:同构(自有 PH)
    w = fmts["无装备"]["grid"]["vars"]
    assert w["PH"] == 150
    w["PH"] = PH_NEW

    # 简版:r2 改差额式(y3 恒贴 H-M-PH;带高=108)
    s = fmts["简版"]["grid"]
    v = s["vars"]                   # PH 前移(r2 引用它;vars 按书写序求值)
    s["vars"] = {"PH": PH_NEW,
                 **{k: (["-", ["-", ["-", "H", "M"], "M"],
                         ["+", "PH", ["+", "r1", ["*", 2, "G"]]]]
                        if k == "r2" else val)
                    for k, val in v.items()}}

    # 竖版:显式 rects——带 3696..3804;底区 2916..3676(760 高)
    v = fmts["竖版"]
    r = v["rects"]
    r["_palette"] = [36, 3804 - PH_NEW, 2124, 3804]
    for k, new in {
        "weapon":   (36, 2916, 644, 3357),          # wt=round(760*0.58)=441
        "weapon_a": (36, 3377, 330, 3676),
        "weapon_b": (350, 3377, 644, 3676),
        "fabric_1": (664, 2916, 1137, 3156),        # 240×3+G×2=760 恰满
        "fabric_2": (664, 3176, 1137, 3416),
        "fabric_3": (664, 3436, 1137, 3676),
        "gear_1":   (1157, 2916, 1630, 3286),       # 370×2+G=760 恰满
        "gear_2":   (1157, 3306, 1630, 3676),
        "fx_1":     (1650, 2916, 2123, 3286),
        "fx_2":     (1650, 3306, 2123, 3676),
    }.items():
        r[k] = list(new)
    v["grid"]["vars"]["r4"] = 760
    v["_doc"] = v["_doc"].replace("+通栏信息带", "+通栏信息带(108 收高)")

    TRUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    print("[OK] 底带 150→108×4 格式(全卡/无装备公式;简版差额式;竖版显式)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
