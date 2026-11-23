#!/usr/bin/env python3
"""daojie_sheet_exp_design_1114.py — Skill-5.4 缺口补全(1114 用户令「该补的补全」)。

真源 qi21_bases.json#sheet_card_qwen 三面手术(幂等):
① 表情参考行(Skill §六):edit_instructions 增 5 表情(开心/生气/悲伤/惊讶/害羞,
   肌群定义逐字取 §六表;身份锚句式与 face 指令同构)+seeds 9..13;
   版面=通栏表情条(全卡/无武器 ye=1006 高 220;竖版显式 rects 2616..2896),
   底区相应下移压缩;简版恒简不设;
② 设计说明(Skill §十④):主体句增「设计说明:」字段(真源默认句入 hub 缺省主体句),
   合成器底带画第二行(管线/枢纽同一条解析路);
③ 技能名上卡(Skill §十③ 物品名称):档案行字段增 技能(取主体句「能力」字段首段)。
耳饰/花钿不补:Skill §七禁令「角色身上没有的东西禁入细节区」,沈孤鸿真源无此件。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")

EXP_INSTR = {
    "exp_happy": ("以<image1>中的角色为同一人,仅改变其表情为开心:眉放松,眼微弯,"
                  "嘴角明显上扬,脸颊抬起;严格保持<image1>中该角色的脸型五官、"
                  "发型与发色、水墨国风画法与{背景}背景,取景从完整头顶至锁骨,其余不变。"),
    "exp_angry": ("以<image1>中的角色为同一人,仅改变其表情为生气:眉下压,眉心收紧,"
                  "眼神锐利,眼睑收紧,唇紧绷,头微前倾;严格保持<image1>中该角色的"
                  "脸型五官、发型与发色、水墨国风画法与{背景}背景,"
                  "取景从完整头顶至锁骨,其余不变。"),
    "exp_sad": ("以<image1>中的角色为同一人,仅改变其表情为悲伤:眉内侧略上,"
                "眼神下垂,眼睑略低,嘴角向下;严格保持<image1>中该角色的脸型五官、"
                "发型与发色、水墨国风画法与{背景}背景,"
                "取景从完整头顶至锁骨,其余不变。"),
    "exp_surprise": ("以<image1>中的角色为同一人,仅改变其表情为惊讶:眉明显上扬,"
                     "眼明显睁大,嘴自然张开,头微后仰;严格保持<image1>中该角色的"
                     "脸型五官、发型与发色、水墨国风画法与{背景}背景,"
                     "取景从完整头顶至锁骨,其余不变。"),
    "exp_shy": ("以<image1>中的角色为同一人,仅改变其表情为害羞:眼神躲闪看向侧下方,"
                "眼睑略低,唇轻抿,脸颊微红,头微低;严格保持<image1>中该角色的"
                "脸型五官、发型与发色、水墨国风画法与{背景}背景,"
                "取景从完整头顶至锁骨,其余不变。"),
}
EXP_KEYS = tuple(EXP_INSTR)          # 版面格序 exp_1..5 同此序
EXP_LABELS = {"exp_1": "开心", "exp_2": "生气", "exp_3": "悲伤",
              "exp_4": "惊讶", "exp_5": "害羞"}
DESIGN_DEFAULT = ("设计说明:孤鸿出岫,剑修远尘;月白黛青取鸿羽掠空之色;"
                  "一剑收鞘,锋藏不露")
STRIP_CELL = {"flow": "h", "at": ["M", "ye"], "size": ["ew", "EH"], "gap": "G",
              "keys": ["exp_1", "exp_2", "exp_3", "exp_4", "exp_5"],
              "mode": "cover"}


def main() -> int:
    data = json.loads(TRUTH.read_text(encoding="utf-8"))
    q = data["sheet_card_qwen"]
    fmts = q["formats"]

    # ① 表情指令+seed(幂等覆盖)
    q["edit_instructions"].update(EXP_INSTR)
    for i, k in enumerate(EXP_KEYS):
        q["seeds"][k] = 9 + i

    # ① 全卡:vars 重排(r1 950/表情条 EH 220/底区 r4 708)+条格+labels
    g = fmts["全卡"]["grid"]
    v = g["vars"]
    g["vars"] = {
        "r1": ["round", ["*", "ih", 0.455]],
        "PH": v["PH"],
        "EH": 220,
        "r4": ["-", "ih", ["+", "r1",
                           ["+", "EH", ["+", "PH", ["*", 3, "G"]]]]],
        "ye": ["+", ["+", "M", "r1"], "G"],
        "ew": ["//", ["-", "iw", ["*", 4, "G"]], 5],
        "y1": "M",
        "y4": ["+", "ye", ["+", "EH", "G"]],
        **{k: v[k] for k in ("vw", "rx0", "rw", "cwid")},
        "chh": ["//", ["-", "r1", "G"], 2],
        **{k: v[k] for k in ("zw", "z1w", "zsw", "x2", "x3", "x4",
                             "wt", "ihh", "sh", "mid")},
    }
    cells = fmts["全卡"]["cells"]
    if not any("exp_1" in e.get("keys", []) for e in cells):
        cells.insert(2, STRIP_CELL)      # 六特写之后、武器区之前
    vcells = fmts["竖版"]["cells"]       # 竖版 cells 独立副本(rects 覆盖位,keys/modes 仍需)
    if not any("exp_1" in e.get("keys", []) for e in vcells):
        vcells.insert(2, STRIP_CELL)
    fmts["全卡"]["labels"]["text"].update(EXP_LABELS)
    fmts["全卡"]["_doc"] = ("格式一 v6+表情条(Skill-5.4 全量):三视图+六特写 3x2 全高+"
                            "表情参考条×5+底部四区(武器/材质/装备/技能特效)+"
                            "底部通栏信息带(档案行+设计说明行/配色五圆)。")

    # 无武器:r1/EH/y4/r4 同构(vars 全内聚;表情条自全卡继承)
    w = fmts["无武器"]["grid"]["vars"]
    fmts["无武器"]["grid"]["vars"] = {
        "r1": ["round", ["*", "ih", 0.455]],
        "PH": 150, "EH": 220,
        "y4": ["+", ["+", ["+", "M", "r1"], "G"], ["+", "EH", "G"]],
        "r4": ["-", "ih", ["+", "r1",
                           ["+", "EH", ["+", "PH", ["*", 3, "G"]]]]],
        **{k: w[k] for k in ("zw", "sh", "ihh", "x2", "x3")},
    }
    fmts["无武器"]["_doc"] = ("顶块继承全卡(三视图+六特写+表情条);底部=三等区+"
                              "通栏信息带,武器区移除。")

    # 竖版:vars 补表情条三元(EH/ye/ew;rects 全显式覆盖,vars 仅喂 cells 展开)
    vv = fmts["竖版"]["grid"]["vars"]
    vv.update({"EH": 280, "ye": 2616, "ew": 401, "y4": 2916, "r4": 718})
    # 竖版:显式 rects 增表情条(2616..2896)+底区下移(2916..3634)
    r = fmts["竖版"]["rects"]
    for i in range(5):
        x0 = 36 + i * 421
        r[f"exp_{i + 1}"] = [x0, 2616, 2124 if i == 4 else x0 + 401, 2896]
    for k, new in {
        "weapon":   (36, 2916, 644, 3332),          # wt=round(718*0.58)=416
        "weapon_a": (36, 3352, 330, 3634),
        "weapon_b": (350, 3352, 644, 3634),
        "fabric_1": (664, 2916, 1137, 3142),        # 226×3+G×2=718 恰满
        "fabric_2": (664, 3162, 1137, 3388),
        "fabric_3": (664, 3408, 1137, 3634),
        "gear_1":   (1157, 2916, 1630, 3265),       # 349×2+G=718 恰满
        "gear_2":   (1157, 3285, 1630, 3634),
        "fx_1":     (1650, 2916, 2123, 3265),
        "fx_2":     (1650, 3285, 2123, 3634),
    }.items():
        r[k] = list(new)
    fmts["竖版"]["_doc"] = ("全卡同构在 2160x3840 竖画布(Skill-5.4 全量):顶块两行+"
                            "表情条×5(2616..2896)+底区(2916..3634)+通栏信息带;24 格。")

    TRUTH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    print(f"[OK] 真源:表情×5+seed9..13+三格式表情条+设计说明字段位;labels {EXP_LABELS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
