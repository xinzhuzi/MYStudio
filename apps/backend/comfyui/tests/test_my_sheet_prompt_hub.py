# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫设定卡·提示词枢纽单测(1123 Phase 6:全卡版式跟随武器类别)。

被测=nodes/my_sheet_prompt_hub.py(节点件=单真源,按路径裸载)。锁七面:
① 默认类零回归——未声明「武器类别」的主体句(节点示例/散文式/无类别字段式)武器格与
  特效格提示词恒走 v6 原模板,类别输出恒「剑」;档案行取值规则与原实现逐字相同
  (只认半角逗号/破折号——独立复核 1123 指出提取公共函数时不得顺手改行为);
② 类别模板切换——武器格按类别走 weapon.templates(通用=器物原样展示/包裹=收存时裹紧一体),
  原模板里的带鞘剑名词不得出现;
③ 有「能力:」字段=effect.templates+风格底座;无「能力:」字段=细化类别
  (weapon.category_without_ability),只出纯底板文字、不拼风格底座
  (1123 实弹:拼了风格底座=模型自己造一个人物;留空由合成器按 labels.blank_cells 程序绘);
④ 显式写默认类==不写;
⑤ 未登记类别立即报错并点名合法值(禁静默回落);
⑥ {weapon_name}=武器字段首段(规则同档案行);
⑦ 真源各处类别集合自洽,缺键=作者级错误立即报错;节点 21 出。
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

import pytest

_TESTS = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS.parents[3]
_HUB_SRC = _TESTS.parent / "my_nodes/nodes/my_sheet_prompt_hub.py"
_TRUTH = (_REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
           / "json/qi21_bases.json")

_spec = importlib.util.spec_from_file_location("sheet_hub_test", _HUB_SRC)
hub = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hub)

TRUTH = json.loads(_TRUTH.read_text(encoding="utf-8"))
_Q = TRUTH["sheet_card_qwen"]
Q_WEAPON, Q_EFFECT = _Q["weapon"], _Q["effect"]
LABELS = _Q["formats"]["全卡"]["labels"]
STYLE = TRUTH["art_style_base"]["positive_text"]
T_ITEM = next(t["positive_text"] for t in TRUTH["types"]
              if t["zh"] == Q_WEAPON.get("type", "道具"))
GENERIC, WRAPPED = "通用", "包裹"
BASES = (GENERIC, WRAPPED)
NO_ABILITY = Q_WEAPON["category_without_ability"]          # {通用: 通用·能力未设定, 包裹: 包裹·能力未设定}

S_DEFAULT = hub.MySheetPromptHub.INPUT_TYPES()["required"]["主体句"][1]["default"]
S_PROSE = "成年男性剑修,背负油布剑包,自然站立。"
S_FIELDS = "姓名:甲|性别:男|武器:三层油布剑包,包内收裹缠布归元断剑,缠布完整包覆|配饰:布背囊"
SHEATHED_SWORD_TERMS = ("整剑", "柄首", "鞘尾", "剑穗", "素银")


def _s(base: str, ability: str = "") -> str:
    return S_FIELDS + f"|武器类别:{base}" + (f"|能力:{ability}" if ability else "")


@pytest.fixture(autouse=True)
def _repo_truth(monkeypatch):
    """枢纽真源恒取仓库真源家(候选链首位的 env 覆写若在测试环境残留则剥掉)。"""
    monkeypatch.delenv("MYSTUDIO_DAOJIE_DATA", raising=False)


def _first(prompt: str) -> str:
    return prompt.split("\n")[0]


def test_default_category_zero_regression():
    """① 未声明类别:类别=剑,武器格/特效格首段逐字==v6 原模板代入值;三层装配不变。"""
    for subject in (S_DEFAULT, S_PROSE, S_FIELDS):
        out = hub.assemble(subject, "甲", "纯白")
        assert out["武器类别"] == "剑", subject[:12]
        weapon = hub._field(subject, "武器", "长剑")
        ability = hub._field(subject, "能力", "剑气")
        assert _first(out["weapon"]) == Q_WEAPON["positive_template"].format(
            name="甲", weapon=weapon), subject[:12]
        assert _first(out["effect"]) == Q_EFFECT["positive_template"].format(
            ability=ability), subject[:12]
        assert out["weapon"] == "\n".join([_first(out["weapon"]), T_ITEM, STYLE])
        assert out["effect"] == "\n".join([_first(out["effect"]), STYLE])


def test_archive_line_keeps_legacy_separator_behavior():
    """① 档案行取值规则=原实现:只认半角逗号与破折号;全角逗号不切(1123 独立复核指出的回归面)。"""
    assert hub.archive_line("姓名:甲|武器:油布剑包，包内缠布", "甲") == \
        "姓名:甲 · 武器:油布剑包，包内缠布"
    assert hub.archive_line("姓名:甲|武器:油布剑包,包内缠布", "甲") == "姓名:甲 · 武器:油布剑包"
    assert hub.archive_line("姓名:甲|能力:孤鸿剑气——剑锋凝出青白剑气", "甲") == \
        "姓名:甲 · 技能:孤鸿剑气"
    assert hub._lead("油布剑包，包内缠布") == "油布剑包，包内缠布"     # {weapon_name} 同规则


@pytest.mark.parametrize("base", BASES)
@pytest.mark.parametrize("ability", ("", "归元"))
def test_category_switches_weapon_template(base, ability):
    """② 武器格按类别走模板(有无能力字段都一样),带鞘剑名词不出现;非默认类不拼道具型句(两层)。"""
    subject = _s(base, ability)
    out = hub.assemble(subject, "甲", "纯白")
    weapon = hub._field(subject, "武器", "")
    assert _first(out["weapon"]) == Q_WEAPON["templates"][base].format(
        name="甲", weapon=weapon, weapon_name="三层油布剑包")
    for term in SHEATHED_SWORD_TERMS:
        assert term not in _first(out["weapon"]), term
    assert Q_WEAPON["templates_append_type"] is False          # 1123 实弹定谳:道具型句=托盒/框轨之源
    assert out["weapon"] == "\n".join([_first(out["weapon"]), STYLE]) and T_ITEM not in out["weapon"]


def test_weapon_type_sentence_follows_truth_flag(monkeypatch):
    """② 真源开关 templates_append_type=true 时非默认类恢复三层(默认类恒三层,与开关无关)。"""
    bases = json.loads(json.dumps(TRUTH))
    bases["sheet_card_qwen"]["weapon"]["templates_append_type"] = True
    orig = hub._truth
    try:
        monkeypatch.setattr(hub, "_truth", lambda: bases)
        out = hub.assemble(_s(WRAPPED), "甲", "纯白")
        assert out["weapon"] == "\n".join([_first(out["weapon"]), T_ITEM, STYLE])
    finally:
        assert orig is not None


def test_wrapped_template_states_whole_is_wrapping():
    """② 包裹类模板:整件通体是包裹物、包内之物全收在里面(1123 二稿实弹:通用类出剑匣露护手)。"""
    t = Q_WEAPON["templates"][WRAPPED]
    for kw in ("裹紧", "通体都是包裹物", "全部收在里面", "直接平放在背景上", "没有托盒", "完整入画", "素净米白"):
        assert kw in t, kw
    assert "{name}" in t and "{weapon}" in t and "剑" not in t      # 模板本身武器无关
    assert "收存" not in t      # 1123 三稿实弹:「收存」联想=装盒存放(出了托盒),四稿去掉


@pytest.mark.parametrize("base", BASES)
def test_without_ability_blank_plate_and_refined_category(base):
    """③ 无「能力:」字段:细化类别+纯底板文字(不拼风格底座);真源已登记该类别特效格留空。"""
    out = hub.assemble(_s(base), "甲", "纯白")
    refined = NO_ABILITY[base]
    assert out["武器类别"] == refined == f"{base}·能力未设定"
    assert out["effect"] == Q_EFFECT["templates_no_ability"][refined]
    assert STYLE not in out["effect"] and "{" not in out["effect"]
    assert "剑气" not in out["effect"]                      # 缺省能力不得带入
    assert LABELS["variants"][refined]["fx_1"] == "能力未设定"
    assert {"fx_1", "fx_2"} <= set(LABELS["blank_cells"][refined])


@pytest.mark.parametrize("base", BASES)
def test_with_ability_uses_ability_template(base):
    """③ 有「能力:」字段:类别=本体,特效格=类别模板+风格底座;角标保持「技能特效」。"""
    out = hub.assemble(_s(base, "归元剑气"), "甲", "纯白")
    assert out["武器类别"] == base
    assert out["effect"] == "\n".join([
        Q_EFFECT["templates"][base].format(ability="归元剑气", weapon_name="三层油布剑包"), STYLE])
    assert "归元剑气" in _first(out["effect"])
    assert "fx_1" not in LABELS["variants"][base]
    assert base not in LABELS["blank_cells"]


def test_explicit_default_category_equals_undeclared():
    """④ 显式写「武器类别:剑」与不写:提示词输出逐字相同(『master』含主体句原文,天然不同,除外)。"""
    a = hub.assemble(S_FIELDS, "甲", "纯白")
    b = hub.assemble(S_FIELDS + "|武器类别:剑", "甲", "纯白")
    assert {k: v for k, v in a.items() if k != "master"} == {k: v for k, v in b.items() if k != "master"}


def test_unknown_category_raises_with_legal_values():
    """⑤ 未登记类别=作者级错误:立即上抛,禁静默回落到默认类。"""
    with pytest.raises(ValueError) as excinfo:
        hub.assemble(S_FIELDS + "|武器类别:通勇", "甲", "纯白")
    msg = str(excinfo.value)
    assert "不在册" in msg and "武器类别" in msg
    for legal in ("剑", *BASES):
        assert legal in msg, legal


@pytest.mark.parametrize("base", BASES)
def test_view_mount_phrase_follows_category(base):
    """② 非默认类:side/back 指令的「佩剑挂载」按真源 view_mount 换成类别措辞;其余编辑指令不变。
    (1123 三视图同病:原四字令模型把参考图上的油布剑包改成「缠布柄+裸鞘的佩剑」)"""
    vm = _Q["view_mount"]
    out = hub.assemble(_s(base), "甲", "纯白")
    for k in ("side", "back"):
        assert vm["default"] not in out[k], k
        assert vm["by_category"][base] in out[k], k
        assert vm["by_category"][base] + "与水墨国风画法" in out[k], k        # 原位替换,前后文不变
    for k in ("face", "head", "wrist", "waist"):
        assert out[k] == _Q["edit_instructions"][k].replace("{背景}", _Q["backgrounds"]["纯白"]["phrase"]), k


def test_default_category_keeps_legacy_mount_phrase():
    """① 默认类「剑」:side/back 指令逐字不变(含「佩剑挂载」)。"""
    for subject in (S_DEFAULT, S_PROSE, S_FIELDS):
        out = hub.assemble(subject, "甲", "纯白")
        for k in ("side", "back"):
            assert out[k] == _Q["edit_instructions"][k].replace("{背景}", _Q["backgrounds"]["纯白"]["phrase"]), (k, subject[:12])
            assert _Q["view_mount"]["default"] in out[k]


def test_view_mount_truth_consistent():
    """⑦ 真源 view_mount:每个非默认类别都有措辞;default 四字确在 side/back 原指令里(否则替换不生效)。"""
    vm = _Q["view_mount"]
    assert set(vm["by_category"]) == set(BASES) == set(Q_WEAPON["templates"])
    for k in ("side", "back"):
        assert vm["default"] in _Q["edit_instructions"][k], k
        assert vm["default"] not in _Q["edit_instructions"].get("master_i2i", ""), "master 指令本就无此词"
    for v in vm["by_category"].values():
        assert v and "剑" not in v, v


def test_weapon_name_is_lead_segment():
    """⑥ {weapon_name}=武器字段首段(到首个半角逗号/破折号,截 12 字),规则同档案行。"""
    out = hub.assemble(_s(WRAPPED, "归元"), "独孤剑尘", "纯白")
    assert "{weapon_name}" not in out["weapon"] + out["effect"]
    assert Q_EFFECT["templates"][WRAPPED].format(
        ability="归元", weapon_name="三层油布剑包") == _first(out["effect"])
    assert "武器:三层油布剑包" in out["档案"]           # 档案行同一条首段规则
    assert hub._lead("一二三四五六七八九十甲乙丙丁,后段") == "一二三四五六七八九十甲乙丙丁"[:hub.ARCHIVE_VALUE_MAX]
    assert hub.ARCHIVE_VALUE_MAX == 12


def test_truth_category_sets_consistent():
    """⑦ 真源自洽:三处类别集合互指;默认类不占模板键;每个变体键均为既有格键且确与默认角标不同。"""
    default = Q_WEAPON["default_category"]
    assert Q_WEAPON["category_field"] == "武器类别" and default == "剑"
    keys = set(Q_WEAPON["templates"])
    assert keys == set(Q_EFFECT["templates"]) == set(BASES)
    refined = set(Q_WEAPON["category_without_ability"].values())
    assert refined == set(Q_EFFECT["templates_no_ability"]) == set(LABELS["blank_cells"]) \
        and not (refined & keys)
    assert set(Q_WEAPON["category_without_ability"]) == keys
    assert set(LABELS["variants"]) == keys | refined and default not in keys | refined
    text = LABELS["text"]
    for var, mapping in LABELS["variants"].items():
        assert mapping, var
        for k, v in mapping.items():
            assert k in text and v != text[k], (var, k)       # 既有格键,且确与默认角标不同
    for base in BASES:
        body = set(LABELS["variants"][base])
        assert body == {"weapon_a", "weapon_b", "gear_1"}
        assert set(LABELS["variants"][NO_ABILITY[base]]) == body | {"fx_1"}
        assert all(LABELS["variants"][NO_ABILITY[base]][k] == v for k, v in LABELS["variants"][base].items())
    # 1124 用户令「改」:fabric_2/fabric_3 的默认角标已是来源写名(腰部图·中段/腕部图·局部),类别变体不再带这两键
    for var in LABELS["variants"]:
        assert not ({"fabric_2", "fabric_3"} & set(LABELS["variants"][var])), var
    for cells in LABELS["blank_cells"].values():
        assert {"fx_1", "fx_2"} <= set(cells)
    for refined_key in refined:
        assert refined_key.endswith("·能力未设定") and LABELS["variants"][refined_key]["fx_1"] == "能力未设定"


@pytest.mark.parametrize("mutate,needle", [
    (lambda q: q["effect"].__setitem__("templates_no_ability", {}), "templates_no_ability"),
    (lambda q: q["formats"]["全卡"]["labels"].__setitem__("variants", {}), "labels.variants"),
    (lambda q: q["formats"]["全卡"]["labels"].__setitem__("blank_cells", {}), "labels.blank_cells"),
    (lambda q: q.__setitem__("view_mount", {}), "view_mount"),
])
def test_broken_truth_fails_fast(mutate, needle):
    """⑦ 真源缺键=作者级错误:细化类别所指不在册 → 点名报错(不静默出错卡)。"""
    broken = json.loads(json.dumps(_Q))
    mutate(broken)
    bases = json.loads(json.dumps(TRUTH))
    bases["sheet_card_qwen"] = broken
    orig = hub._truth
    try:
        hub._truth = lambda: bases
        with pytest.raises(ValueError) as excinfo:
            hub.assemble(_s(WRAPPED), "甲", "纯白")
        assert needle in str(excinfo.value)
    finally:
        hub._truth = orig
    assert orig is not None


def test_hub_node_outputs():
    """节点 21 出:全 STRING,末出=武器类别(生效类别);OUT_ORDER 与 RETURN_NAMES 等长对位。"""
    cls = hub.MySheetPromptHub
    assert len(cls.RETURN_TYPES) == len(cls.RETURN_NAMES) == len(hub.OUT_ORDER) == 21
    assert set(cls.RETURN_TYPES) == {"STRING"} and len(set(hub.OUT_ORDER)) == 21
    got = cls().hub(_s(WRAPPED), "甲", "纯白", "全卡")
    assert isinstance(got, tuple) and len(got) == 21 and got[-1] == NO_ABILITY[WRAPPED]
    assert got[hub.OUT_ORDER.index("格式")] == "全卡"
    assert cls().hub(_s(GENERIC, "归元"), "甲", "纯白")[-1] == GENERIC
    assert cls().hub(S_FIELDS, "甲", "纯白")[-1] == "剑"
