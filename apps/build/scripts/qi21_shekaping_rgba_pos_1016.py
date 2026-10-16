#!/usr/bin/env python3
# qi21_shekaping_rgba_pos_1016.py —— 设定卡 rgba_positive 格式锁补建(1016 终审第二轮)
# 病根:rgba 翻真后透明路极简公式(_rgba_lean_pos)取 types[].rgba_positive 作该型
# 格式锁,四透明型(道具/多视图/高清人脸/表情差分)皆有,设定卡翻真时漏建——
# PE 失败回退路裸奔(无分区框架语言)+PE 改写路教材透明纪律误伤分区语言,双重
# 叠加致图退化成非设定卡(用户目检「不符合原本的设计」定谳)。
# 本刀:设定卡补 rgba_positive=分区框架纯版(零绘画词,对齐多视图格式锁先例;
# 尾句中文透明声明与四型同构,运行时被 strip_rgba_decl 句级剥除,透明语义归
# [4014] 英文头尾)。
# 范式:fail-closed——预态断言不满足 exit 2 零写入;已术后 exit 3 幂等。

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"

RGBA_POS = (
    "同一角色的角色设定卡，一图多区排版：主视觉区为全身立绘，视图区横排并列恰好三个全身视图，"
    "自左至右依次为正面平视、正九十度纯侧面平视与背面平视的全身像，三个机位互不重复，"
    "特写区为面部特写与数格细节特写，底部为服饰与配器局部横排，卡面另留窄条档案区与色样区，"
    "各分区边界清晰，排版疏朗有呼吸；同一角色身份贯穿全卡，脸型五官、发型发饰、服装配饰"
    "在各视图与各特写中逐格一致；同一配器的形状、长度与比例在各视图与局部特写中逐格一致，"
    "直刃与直杆类配器保持笔直。各分区外无背景景物与底色。"
    "图为带透明通道的RGBA透明底图，背景透明。"
)


def main() -> None:
    raw = BASES.read_text(encoding="utf-8")
    if not raw.endswith("\n"):
        sys.exit("[fail] bases 应 indent2+尾换行格式")
    data = json.loads(raw)
    e = next((t for t in data["types"] if t["zh"] == "设定卡"), None)
    if e is None:
        sys.exit("[fail] types 无「设定卡」")

    if (e.get("rgba_positive") or "").strip() == RGBA_POS:
        print("[idem] rgba_positive 已术后,跳过")
        return
    if str(e.get("rgba_positive") or "").strip():
        sys.exit("[fail] rgba_positive 已有异值(并行改?),人工核后再动")
    if e.get("rgba_default") is not True:
        sys.exit("[fail] rgba_default 应已翻真(前置:qi21_shekaping_rgba_fix_1016)")
    if "恰好三个全身视图" not in e["positive_text"]:
        sys.exit("[fail] positive_text 应已含逐点名刀(前置手术未落?)")

    # 字段位序对齐四透明型:rgba_positive 落在 positive_text 之后
    out_entry = {}
    for k, v in e.items():
        out_entry[k] = v
        if k == "positive_text":
            out_entry["rgba_positive"] = RGBA_POS
    e.clear(); e.update(out_entry)

    blob = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    assert json.loads(blob) == data, "JSON 往返失配"
    BASES.write_text(blob, encoding="utf-8")
    print("[ok] 设定卡 rgba_positive 格式锁落盘(分区框架+武器锁+同构透明尾句)")


if __name__ == "__main__":
    main()
