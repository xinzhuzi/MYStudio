#!/usr/bin/env python3
"""daojie_sheet_skill54_rework_1114.py — Skill-5.4 文字系统正名+底带档案栏(1114 用户令)。

真源 qi21_bases.json#sheet_card_qwen.formats 两面手术(幂等重跑同结果):
① 角标正名(对齐 Skill-5.4 §十 专业设定集词汇):正/侧/背视图→正面/侧面/背面、
   头部细节→头部侧面、握持部位/收存结构→局部·柄首/局部·鞘尾(与武器提示词
   「自柄首至鞘尾」同词)、服饰纹理→材质、装备细节→装备、能力→技能特效;
② 底部通栏信息带(全卡/竖版/无武器):配色条从右列中段移到底部通栏(PH=150),
   带内=档案字段(左,程序绘,合成器画)+配色五圆(右);简版本就有底部通栏零改。
   全卡:r4=ih-r1-PH-2G(底行缩 170),六特写 chh=(r1-G)//2(收回 PH 全高);
   无武器:y4/r4 改同构公式(r1/PH 入 env;palette 继承全卡底带);
   竖版:底区 2796..3634(wt486+332/fabric266×3/gear·fx409×2)+带 3654..3804。
format_version v5→v6(写侧 bump;读侧 hub 数值比较无感)。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")

LABEL_RENAMES = {          # Skill-5.4 §十:模块标题 canon 词(正名不动语义)
    "front": "正面", "side": "侧面", "back": "背面",
    "head": "头部侧面",
    "weapon_a": "局部·柄首", "weapon_b": "局部·鞘尾",
    "fabric_1": "材质", "gear_1": "装备", "fx_1": "技能特效",
}
BOTTOM_PALETTE = ["M", ["-", "H", ["+", "M", "PH"]], ["-", "W", "M"], ["-", "H", "M"]]


def main() -> int:
    data = json.loads(TRUTH.read_text(encoding="utf-8"))
    q = data["sheet_card_qwen"]
    fmts = q["formats"]

    # ① 角标正名(全卡=labels 真源;简/竖/无武器 inherit)
    lab = fmts["全卡"]["labels"]["text"]
    for k, v in LABEL_RENAMES.items():
        assert k in lab, f"全卡 labels 缺 {k}"
        lab[k] = v

    # ② 全卡:底带通栏+六特写收回 PH 全高(PH 前移=r4 引用它,vars 按书写序求值)
    g = fmts["全卡"]["grid"]
    v_old = g["vars"]
    g["vars"] = {"r1": v_old["r1"], "PH": v_old["PH"],
                 "r4": ["-", "ih", ["+", "r1", ["+", "PH", ["*", 2, "G"]]]],
                 **{k: (["//", ["-", "r1", "G"], 2] if k == "chh" else v)
                    for k, v in v_old.items()
                    if k not in ("r1", "PH", "r4")}}
    g["palette"] = BOTTOM_PALETTE
    fmts["全卡"]["_doc"] = ("格式一 v6(Skill-5.4 正名):三视图+六特写 3x2 全高+"
                            "底部四区(武器/材质/装备/技能特效)+底部通栏信息带"
                            "(档案字段+配色五圆)。")

    # 无武器:y4/r4 同构公式(r1/PH 入 env;palette 继承全卡底带)
    w = fmts["无武器"]["grid"]["vars"]
    w.pop("y4", None)
    new_w = {
        "r1": ["round", ["*", "ih", 0.55]],
        "PH": 150,
        "y4": ["+", ["+", "M", "r1"], "G"],
        "r4": ["-", "ih", ["+", "r1", ["+", "PH", ["*", 2, "G"]]]],
    }
    fmts["无武器"]["grid"]["vars"] = {**new_w, **{k: w[k] for k in
                                                  ("zw", "sh", "ihh", "x2", "x3")}}
    fmts["无武器"]["_doc"] = ("顶块继承全卡(三视图+六特写全高);底部=三等区"
                              "(材质纵三/装备上下/技能特效上下)+通栏信息带,武器区移除。")

    # 竖版:底区压缩至 3634+通栏带 3654..3804(x 位全沿用;顶块两行不动)
    v = fmts["竖版"]
    v["grid"]["palette"] = BOTTOM_PALETTE
    r = v["rects"]
    for k, new in {
        "weapon":   (36, 2616, 644, 3206),          # 底区上移填空(2616 起,1018 高;
        "weapon_a": (36, 3226, 330, 3634),          # wt=round(1018*0.58)=590,余 408)
        "weapon_b": (350, 3226, 644, 3634),
        "fabric_1": (664, 2616, 1137, 2942),        # 326×3+G×2=1018 恰满
        "fabric_2": (664, 2962, 1137, 3288),
        "fabric_3": (664, 3308, 1137, 3634),
        "gear_1":   (1157, 2616, 1630, 3115),       # 499×2+G=1018 恰满
        "gear_2":   (1157, 3135, 1630, 3634),
        "fx_1":     (1650, 2616, 2123, 3115),
        "fx_2":     (1650, 3135, 2123, 3634),
    }.items():
        assert k in r, f"竖版 rects 缺 {k}"
        r[k] = list(new)
    if "_palette" in r:                 # 竖版显式 rects 连 _palette 一并覆写
        r["_palette"] = [36, 3654, 2124, 3804]
    v["_doc"] = ("全卡同构在 2160x3840 竖画布(Skill-5.4 正名):顶块两行+底区压缩"
                 "(2796..3634)+底部通栏信息带(3654..3804);键集同全卡 19 格。")

    q["format_version"] = "v6"

    # ③ 背景默认值补正(ee02f535 背景表收敛纯白单档的漏网:格式默认/hub 默认
    #    仍指已删的「素白宣纸」→hub assemble 断言红/画布旧法值 validate 悬)
    for spec_ in fmts.values():
        if spec_.get("background", {}).get("default") == "素白宣纸":
            spec_["background"]["default"] = "纯白"

    TRUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    print(f"[OK] 真源已写:{TRUTH.name} v6;labels 正名 {len(LABEL_RENAMES)} 项;"
          "底带通栏×3 格式(简版零改);背景默认值→纯白")
    return 0


if __name__ == "__main__":
    sys.exit(main())
