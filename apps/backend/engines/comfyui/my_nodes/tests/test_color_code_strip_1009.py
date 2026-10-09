# 1009 色卡编号/hex 出文防线回归锁(用户抓「blue.02 这些词出图模型认吗」):
# ①ApiPE 硬滤 _strip_color_codes 剥 ma_id/hex 三形态;②卡文渲染面零编号;
# ③用法禁令与 base 满幅清退在真源。
from __future__ import annotations

import importlib.util
import json
import re
from pathlib import Path

_HERE = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location("my_qi21_api_pe_uut", _HERE / "nodes" / "my_qi21_api_pe.py")
pe = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(pe)


def test_strip_color_codes_three_forms():
    """硬滤剥三形态:括注/裸编号/hex;中文正文零合法形态故无损。"""
    src = ("坛心一泓浅潭映出旧金(metal.01 旧金)残阳;九根断裂的赭石(red.04)石柱;"
           "底色宣纸白系 paper.01 宣纸白,天光 #F5F0E8 与青灰 bluegray.01 叠影。")
    out = pe._strip_color_codes(src)
    assert "metal.01" not in out and "red.04" not in out and "paper.01" not in out
    assert "bluegray.01" not in out and "#F5F0E8" not in out
    assert "旧金" in out and "赭石" in out and "青灰" in out, "色词中文名逐字保留"


def test_strip_color_codes_keeps_plain_text():
    """正常中文/英文短语零误伤。"""
    plain = "连续彩线描(iron-wire outlines)勾勒主体,色彩浓淡分明。"
    assert pe._strip_color_codes(plain) == plain


def test_context_materials_no_ids():
    """ApiPE 兜底色卡清单渲染面零 ma_id(1009 三重防线之二)。"""
    _, colors = pe._context_materials()
    assert "★在用" in colors
    assert not re.search(r"[a-z]{3,8}\.\d{2}", colors), "兜底清单不得印 ma_id"
    assert not re.search(r"#[0-9A-Fa-f]{6}\b", colors), "兜底清单不得印 hex"


def test_truth_rules_in_place():
    """真源两规则在位:用法编号禁令+base 满幅清退。"""
    bases = json.loads((_HERE / ".." / ".." / ".." / ".." / "frontend" / "assets" / "studio-manuals"
                        / "art_skills" / "daojie_ink_guofeng" / "json" / "qi21_bases.json").resolve().read_text())
    usage = bases["color_lexicon"]["usage"]
    assert "ma_id" in usage and "中文名" in usage and "噪音" in usage
    base_role = bases["color_lexicon"]["roles"]["base"]
    # 1009 用户裁定:职责表=通用肯定式单态,禁分型分支与否定式(满幅底色分家归型层满幅令+冲裁序)
    assert base_role.startswith("大面积浅淡稳定衬底色面")
    assert "不落" not in base_role and "不留" not in base_role and "；" not in base_role
    assert "满幅" not in base_role and "立绘" not in base_role, "职责表不得分型分支"
    assert "paper.01" not in base_role, "职责句自身不得夹带编号"
    # 教材第 7 条:肯定式视觉语言(禁否定判词/评语)
    assert "肯定式视觉语言" in bases["expand_instruction"]["system_prompt_zh"]
