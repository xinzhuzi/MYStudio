#!/usr/bin/env python3
"""daojie_sheet_nogear_rename_1114.py — 材质/装备逐格命名+无武器→无装备(1114 用户令)。

① 装备/材质五格逐格命名(Skill §十②模块标题+③物品名称合式):
   材质·腰封 / 材质·袍料 / 材质·护臂 / 装备·剑穗 / 装备·发带
   (旧版仅条首格挂区块词,余格无名→发带格被读成「头型」的困惑根因);
② 无武器→无装备(1114 用户令「所有武器装备就不应该展示」):
   键名改无装备;cells_drop 增 gear_1/gear_2(武器三格+装备两格全撤),
   底区改两等分=材质纵三(左)+技能特效上下(右),无装备区。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")

CELL_LABELS = {
    "fabric_1": "材质·腰封", "fabric_2": "材质·袍料", "fabric_3": "材质·护臂",
    "gear_1": "装备·剑穗", "gear_2": "装备·发带",
}


def main() -> int:
    data = json.loads(TRUTH.read_text(encoding="utf-8"))
    q = data["sheet_card_qwen"]
    fmts = q["formats"]

    # ① 逐格命名(全卡=labels 真源;余格式 inherit)
    fmts["全卡"]["labels"]["text"].update(CELL_LABELS)

    # ② 无武器→无装备(保序重建键;幂等)
    if "无武器" in fmts:
        fmts = {("无装备" if k == "无武器" else k): v for k, v in fmts.items()}
        q["formats"] = fmts
    nw = fmts["无装备"]
    nw["grid"]["vars"] = {
        "r1": ["round", ["*", "ih", 0.455]],
        "PH": 150, "EH": 220,
        "y4": ["+", ["+", ["+", "M", "r1"], "G"], ["+", "EH", "G"]],
        "r4": ["-", "ih", ["+", "r1",
                           ["+", "EH", ["+", "PH", ["*", 3, "G"]]]]],
        "zw": ["//", ["-", "iw", "G"], 2],        # 底区两等分(材质|技能特效)
        "sh": ["//", ["-", "r4", ["*", 2, "G"]], 3],
        "ihh": ["//", ["-", "r4", "G"], 2],
        "x2": ["+", ["+", "M", "zw"], "G"],
    }
    nw["cells"] = [
        {"flow": "v", "at": ["M", "y4"], "size": ["zw", "sh"], "gap": "G",
         "keys": ["fabric_1", "fabric_2", "fabric_3"]},
        {"key": "fx_1", "rect": ["x2", "y4", ["+", "x2", "zw"],
                                 ["+", "y4", "ihh"]]},
        {"key": "fx_2", "rect": ["x2", ["+", "y4", ["+", "ihh", "G"]],
                                 ["+", "x2", "zw"], ["+", "y4", "r4"]]},
    ]
    nw["cells_drop"] = ["weapon", "weapon_a", "weapon_b",
                        "fabric_1", "fabric_2", "fabric_3",
                        "gear_1", "gear_2", "fx_1", "fx_2"]
    nw["_doc"] = ("顶块继承全卡(三视图+六特写+表情条);底区=两等分"
                  "(材质纵三|技能特效上下)+通栏信息带;武器区+装备区全撤"
                  "(1114 用户令「无装备」)。")

    TRUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    print(f"[OK] 逐格命名 5 项+无武器→无装备(底区两等分)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
