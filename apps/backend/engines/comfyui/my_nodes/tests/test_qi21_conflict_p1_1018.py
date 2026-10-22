# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available via COMMERCIAL_LICENSE.md.
"""P1 真源自洽回归锁(任务 10-18-daojie-conflict-p1-canon;审计 C10–C16+C38)。

1018 动漫底座后的真源 qi21_bases.json 自洽口径(裁定 D1/D5/D6/D8/D17/D19):
R1 purpose 与 aspect/override/positive 一致;R2 色卡 note 彩线口径;R3 云雾
统一「淡色罩染分层、层间边界清晰」;R4 铺满型 base=随场景时段/RGBA 型 base=
透明/人物与美宣维持宣纸白/第七步留白随型;R5 类型负向越层三项全删;R6 多视图
头身比改服从来源+补动漫式五官句。锚=本测试;旧口径残留即红。
"""

from __future__ import annotations

import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[6]
CANON_BASES = (REPO / "apps/frontend/assets/studio-manuals"
               / "art_skills/daojie_ink_guofeng/json" / "qi21_bases.json")


def _bases() -> dict:
    return json.loads(CANON_BASES.read_text(encoding="utf-8"))


def _type(bases: dict, zh: str) -> dict:
    return next(e for e in bases["types"] if e["zh"] == zh)


# ── R1(D1/D17/C10/C38):purpose 与画幅/分辨率/正向一致 ──────────────────────

def test_r1_renwu_purpose_d17_final():
    """D17 终稿:人物 purpose=「3:4 竖幅、全身完整立绘」开头,删「4:5 或」「半身至」。"""
    p = _type(_bases(), "人物")["purpose"]
    assert p.startswith("3:4 竖幅、全身完整立绘"), \
        f"人物 purpose 应以 D17 终稿开头(与 aspect 3:4/positive「全身完整入画」一致),得 {p[:24]!r}"
    assert "4:5" not in p and "半身至" not in p, "人物 purpose 残留 D17 已删措辞"


def test_r1_multiview_purpose_16_9_layout():
    """D1:人物多视图 purpose=16:9 1824×1024 左头肩特写+右正侧背三视图;旧 1:1 四区/1632 退役。"""
    e = _type(_bases(), "人物多视图")
    p = e["purpose"]
    assert p.startswith("16:9 横幅 1824×1024"), \
        f"人物多视图 purpose 应=16:9 1824×1024 口径开头(对齐 aspect/override/positive),得 {p[:24]!r}"
    for kw in ("头肩", "正面", "侧面", "背面"):
        assert kw in p, f"人物多视图 purpose 缺布局要素 {kw}"
    for stale in ("1:1", "1632", "两行两列", "四视图", "四格"):
        assert stale not in p, f"人物多视图 purpose 残留旧口径 {stale!r}(C10)"
    assert e["aspect_ratio"] == "16:9 (Widescreen)" and e["resolution_override"] == [1824, 1024]


def test_r1_concept_purpose_16_9_only():
    """概念气氛图 purpose 删「21:9」(aspect 仅 16:9)。"""
    e = _type(_bases(), "概念气氛图")
    assert "21:9" not in e["purpose"], "概念气氛图 purpose 残留 21:9(与 aspect_ratio=16:9 矛盾)"
    assert e["aspect_ratio"] == "16:9 (Widescreen)"


def test_r1_doc_types_eleven_slots_ten_types():
    """C38:_doc_types 自相矛盾(十档——九型+自由)定稿=十三档——十二型+自由(1022 人脸基准入列;1021 3D剖面场景图入列)。"""
    doc = _bases()["_doc_types"]
    assert doc.startswith("类型句(十三档)——十二型+自由"), \
        f"_doc_types 应=「类型句(十三档)——十二型+自由」开头(json/README 与 13 条实数口径),得 {doc[:20]!r}"
    assert "九型" not in doc, "_doc_types 残留「九型」现行指称(C38)"
    assert "十二档" not in doc, "_doc_types 残留「十二档」旧指称(1022 十三档口径)"


# ── R2(D5/C11):色卡 note 线色=彩线口径 ────────────────────────────────────

def test_r2_lexicon_note_colored_line():
    """C11:roles.note「保持细稳墨线」→ 彩线口径(与 roles.ink 彩线描轮廓一致)。"""
    note = _bases()["color_lexicon"]["roles"]["note"]
    assert "墨线" not in note, "roles.note 残留墨线旧口径(C11)"
    assert "彩线" in note, "roles.note 应为彩线口径(D5)"


# ── R3(C12):云雾口径统一 ─────────────────────────────────────────────────

def test_r3_cloud_mist_unified():
    """C12:人物/美宣云雾=「淡色罩染分层，层间边界清晰」;删晕染倾向措辞。"""
    renwu = _type(_bases(), "人物")["positive_text"]
    meixuan = _type(_bases(), "美宣")["positive_text"]
    assert "云雾烟霭以淡色罩染分层，层间边界清晰" in renwu, \
        "人物 positive 应含统一云雾口径「云雾烟霭以淡色罩染分层，层间边界清晰」(C12)"
    for stale in ("渐次转淡", "雾气流动"):
        assert stale not in renwu, f"人物 positive 残留晕染倾向措辞 {stale!r}(C12)"
    assert "云雾以淡色罩染分层，层间边界清晰" in meixuan, \
        "美宣 positive 应含统一云雾口径(C12)"
    assert "云雾亦画为成片平整色面" not in meixuan, "美宣云雾句未与人物型统一(C12)"


# ── R4(D6/C13):留白/底色类型层原则 ────────────────────────────────────────

def test_r4_color_recipe_base_by_group():
    """D6:铺满型 base=随场景时段;RGBA 型 base=透明;人物/美宣维持宣纸白。"""
    b = _bases()
    for zh in ("场景", "分镜剧情图", "概念气氛图"):
        assert _type(b, zh)["color_recipe"]["base"] == "随场景时段", \
            f"铺满型「{zh}」color_recipe.base 应=随场景时段(D6)"
    for zh in ("道具", "人物多视图", "高清人脸", "表情差分"):
        assert _type(b, zh)["color_recipe"]["base"] == "透明", \
            f"RGBA 型「{zh}」color_recipe.base 应=透明(D6;关闭透明时由主体句给简洁底色)"
    for zh in ("人物", "美宣"):
        assert _type(b, zh)["color_recipe"]["base"] == "宣纸白", \
            f"「{zh}」color_recipe.base 维持宣纸白(D6 明示不改;palette 测试钉 lexicon 词条不受影响)"


def test_r4_expand_step7_blank_by_type():
    """D6:expand_instruction 第七步「留白」→「留白或色面铺满(按类型句)」。"""
    syszh = _bases()["expand_instruction"]["system_prompt_zh"]
    assert "留白或色面铺满（按类型句）" in syszh, \
        "第七步应收束为「留白或色面铺满（按类型句）」(D6 随型措辞)"
    assert "视觉重心、引导线、留白、节奏" not in syszh, "第七步残留全局留白旧措辞(C13)"


# ── R5(D8/C14):类型负向越层三项全删 ────────────────────────────────────────

def test_r5_gender_shoe_negative_removed():
    """D8:人物系(人物/美宣/人物多视图/分镜剧情图)性别鞋履负向串全删。"""
    b = _bases()
    for zh in ("人物", "美宣", "人物多视图", "分镜剧情图"):
        neg = _type(b, zh)["negative_text"]
        for stale in ("女性高跟鞋", "细高跟", "尖头女鞋", "精巧女舞鞋",
                      "细带玛丽珍鞋", "男性超大号通用工靴", "异装鞋靴"):
            assert stale not in neg, f"「{zh}」negative 残留性别鞋履越层词 {stale!r}(C14/D8)"
        assert "模糊" in neg and "水印" in neg, f"「{zh}」negative 基线词(模糊/水印)不应随删(D8 只删越层三项)"


def test_r5_charsheet_blade_and_concept_figure_removed():
    """D8:设定卡「刀身弯曲」、概念「人影，人脸」删;场景型「人影，人脸」保留(空镜正当禁人)。"""
    b = _bases()
    assert "刀身弯曲" not in _type(b, "设定卡")["negative_text"], "设定卡 negative 残留「刀身弯曲」(C14 误伤弯刀主体)"
    assert "人影" not in _type(b, "概念气氛图")["negative_text"], "概念气氛图 negative 残留「人影」(C14 与「主体落在画面偏侧」矛盾)"
    assert "人脸" not in _type(b, "概念气氛图")["negative_text"], "概念气氛图 negative 残留「人脸」(C14)"
    assert "人影，人脸" in _type(b, "场景")["negative_text"], "场景型「人影，人脸」应保留(空镜场景正当禁人,防过删)"


# ── R6(D 裁定/C15):多视图头身比服从来源+动漫式五官句 ───────────────────────

def test_r6_multiview_proportions_and_face():
    """C15:多视图删「头身比约六至七头身」硬锁→服从来源;补与人物型同文的动漫式五官句。"""
    e = _type(_bases(), "人物多视图")
    pos = e["positive_text"]
    assert "六至七头身" not in pos, "人物多视图 positive 残留头身比硬锁(C15)"
    assert "比例服从年龄、体型与来源设定" in pos, "人物多视图 positive 应=比例服从来源(C15)"
    assert "面部采用动漫式概括五官，轮廓与眉眼线条清楚，以简洁分层的肤色色块交代转折，脸型与年龄感服从角色设定。" in pos, \
        "人物多视图 positive 应补与人物型同文的动漫式概括五官句(C15)"
    assert pos.startswith("同一角色的多视图设定参考图"), "开头锁(契约测试 _OPEN)不应随本刀漂移"


# ── 守恒:本轮不碰的字段 ────────────────────────────────────────────────────

def test_invariants_untouched_by_p1():
    """P1 不碰:底座正/负向、lexicon 宣纸白词条、rgba、画幅档、rgba_default 四型集合。"""
    b = _bases()
    assert b["art_style_base"]["positive_text"].startswith("美术风格底座：国风二维动漫手绘插画。")
    assert b["color_lexicon"]["entries"]["宣纸白"]["ma_id"] == "paper.01"
    assert {e["zh"] for e in b["types"] if e.get("rgba_default") is True} \
        == {"道具", "人物多视图", "高清人脸", "表情差分", "人脸基准"}  # 1022 人脸基准入列(透明族第五型)
    assert [e["zh"] for e in b["types"]][0] == "人物" and len(b["types"]) == 13  # 1022 人脸基准入列(十二型+自由)
