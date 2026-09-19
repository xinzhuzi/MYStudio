# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫 LoRA 栈节点测试(09-19 LoRA快速启停 R2:MyDaojieLoraStack)。

repo 侧(无引擎)只测数据面、槽位序锚、preset/enable 纯函数与 run 的
装/缺件/真关路径(引擎库用假模块顶替,懒加载纪律使然);链序断言=等价性
前提的钉子:槽序必须逐位对齐现链运行时序(67→76→73 对齐 [85] 人物条目序)。"""
from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engines.comfyui.my_nodes.nodes import my_daojie_lora_stack as stack  # noqa: E402
from engines.comfyui.my_nodes.nodes import my_daojie_base  # noqa: E402

# 现链 14 件(09-19 审计 §2/§8;链序=运行时序:[85] 按型装组 67→76→73)
CHAIN_KEYS = ["turbo", "projector", "detail", "asianmix", "liujin",
              "afterlight", "cinematic", "identity", "darkbrush", "masterpiece",
              "tancai", "sumiwash", "shihua", "goldenmist"]
# 设定板档(09-19 角色设定表收编):十号预设,=人物组复制,[164] 独立恒挂不在栈
SHEET_PRESET = "设定板"
CHAIN_NODE_IDS = [47, 81, 67, 76, 73, 46, 78, 19, 69, 77, 82, 83, 84, 87]
CHAIN_FILES = [
    "Krea2-功能/Krea2-Turbo-4步蒸馏.safetensors",
    "Krea2-功能/Krea2-服从度ProjectorScale.safetensors",
    "Krea2-美学/Krea2-细节滑杆DetailSlider_v1.safetensors",
    "Krea2-画风/Krea2-AsianMix_v4_TQD.safetensors",
    "Krea2-画风/Krea2-水墨武侠漆艺鎏金_v1.safetensors",
    "Krea2-光影/Afterlight_v1.safetensors",
    "Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors",
    "Krea2-功能/Krea2-编辑identity_edit_v1_2.safetensors",
    "Krea2-画风/Krea2-暗笔刷darkbrush.safetensors",
    "Krea2-画风/Krea2-美学Masterpiece_v51.safetensors",
    "Krea2-画风/Krea2-淡彩线描插画_v1.safetensors",
    "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors",
    "Krea2-画风/Krea2-水彩湿画wash_v1.safetensors",
    "Krea2-画风/金雾仙侠GoldenMisty.safetensors",
]


def _slots():
    return json.loads(stack._STACK_JSON.read_text(encoding="utf-8"))


def _bases_keys():
    bases = json.loads(my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
    return [e["zh"] for e in bases]


def _widgets(all_on=True, weights=None):
    w = {}
    for slot, en, wt in stack.slot_widgets():
        w[en] = all_on
        w[wt] = (weights or {}).get(str(slot["key"]), slot.get("default_weight", 1.0))
    return w


@pytest.fixture
def fake_engine(monkeypatch):
    """顶替 folder_paths/comfy.*:记录 load/apply 调用;missing=点名缺件集。"""
    calls = {"load": [], "apply": []}
    state = {"missing": set()}

    def get_full_path(category, name):
        return None if name in state["missing"] else f"/loras/{name}"

    def load_torch_file(path, safe_load=True):
        calls["load"].append(path)
        return {"__fake__": path}

    def load_lora_for_models(model, clip, lora, strength_model, strength_clip):
        calls["apply"].append((lora["__fake__"], strength_model))
        return (f"model#{len(calls['apply'])}",)

    fp = types.ModuleType("folder_paths")
    fp.get_full_path = get_full_path
    comfy_mod = types.ModuleType("comfy")
    utils_mod = types.ModuleType("comfy.utils")
    utils_mod.load_torch_file = load_torch_file
    sd_mod = types.ModuleType("comfy.sd")
    sd_mod.load_lora_for_models = load_lora_for_models
    comfy_mod.utils = utils_mod
    comfy_mod.sd = sd_mod
    for name, mod in (("folder_paths", fp), ("comfy", comfy_mod),
                      ("comfy.utils", utils_mod), ("comfy.sd", sd_mod)):
        monkeypatch.setitem(sys.modules, name, mod)
    calls["state"] = state
    return calls


# ── 数据面解析 ───────────────────────────────────────────
def test_json_parses_14_slots_fields_complete():
    slots = _slots()
    assert len(slots) == 14
    for s in slots:
        for field in ("key", "file", "label", "group", "default_weight", "presets"):
            assert field in s, (s.get("key"), field)
        assert s["file"].endswith(".safetensors"), s
        assert "/" in s["file"], f"应带子目录路径: {s['file']}"
        assert 0 < s["default_weight"] <= 1.5, s
        assert isinstance(s["presets"], dict) and s["presets"]


def test_every_slot_presets_cover_nine_types_matching_bases():
    nine = _bases_keys()
    for s in _slots():
        assert list(s["presets"]) == nine + [SHEET_PRESET], \
            (s["key"], "预设键须=九型(与底座一比一且同序)+末位设定板档")
        for t, p in s["presets"].items():
            assert set(p) == {"on", "weight"}, (s["key"], t)
            assert isinstance(p["on"], bool)
            assert isinstance(p["weight"], (int, float)) and not isinstance(p["weight"], bool)
            assert 0 < p["weight"] <= 1.5, (s["key"], t)


def test_charsheet_preset_equals_renwu_group():
    """设定板档(09-19 角色设定表收编)= 人物组逐槽逐权重复制;
    [164] charsheet LoRA 独立恒挂不在栈内,故栈侧无该件。"""
    for s in _slots():
        assert s["presets"][SHEET_PRESET] == s["presets"]["人物"], s["key"]


# ── 槽位序(等价性前提的钉子)────────────────────────────
def test_slot_order_is_current_runtime_chain_order():
    slots = _slots()
    assert [s["key"] for s in slots] == CHAIN_KEYS
    assert [s["file"] for s in slots] == CHAIN_FILES
    assert [s["node_id"] for s in slots] == CHAIN_NODE_IDS
    # 全局功能件恒挂居首([47][81]);人物三件运行时序 detail→asianmix→liujin
    # (= [85] daojie_loras.json 人物条目序,逐字节等价前提,勿按图上连线序改)


def test_globals_always_on_identity_always_off():
    slots = {s["key"]: s for s in _slots()}
    for t in _bases_keys():
        assert slots["turbo"]["presets"][t]["on"], ("Turbo 恒挂", t)
        assert slots["projector"]["presets"][t]["on"], ("ProjectorScale 恒挂", t)
        assert not slots["identity"]["presets"][t]["on"], ("identity 编辑件九型恒关", t)


# ── preset / 纯函数语义 ──────────────────────────────────
def test_preset_choices_sandwich_nine_types():
    assert stack.preset_choices() == [stack.FOLLOW_PRESET] + _bases_keys() \
        + [SHEET_PRESET] + [stack.EXPERT_PRESET]
    assert stack.preset_choices()[0] == "跟随底座型"


def test_charsheet_preset_resolves_like_renwu():
    """设定板档可解析且与人物组同计划([164] 由设定板流独立挂,不在计划内)。"""
    plan_sheet, display, _ = stack.resolve_plan(_slots(), SHEET_PRESET)
    plan_renwu, _, _ = stack.resolve_plan(_slots(), "人物")
    assert plan_sheet == plan_renwu and display == SHEET_PRESET


def test_default_group_equals_current_always_on_chain():
    """默认组(跟随底座型·人物)必须逐槽逐权重复现现常开链:
    [47]×1.0 → [81]×0.01 → [85]按型(67×1 → 76×0.4 → 73×0.3 → 金雾×0.8;
    金雾=09-20 用户终审 87_char_w08,叠加于三件之上)。"""
    plan, display, masked = stack.resolve_plan(
        _slots(), stack.FOLLOW_PRESET, "人物", enables={}, weights={})
    assert [(s["key"], w) for s, w in plan] == [
        ("turbo", 1.0), ("projector", 0.01),
        ("detail", 1.0), ("asianmix", 0.4), ("liujin", 0.3),
        ("goldenmist", 0.8)]
    assert display == "跟随底座型·人物" and masked == []


def test_follow_without_base_falls_back_to_default_type():
    plan_fb, _, _ = stack.resolve_plan(_slots(), stack.FOLLOW_PRESET, None)
    plan_renwu, _, _ = stack.resolve_plan(_slots(), stack.FOLLOW_PRESET, "人物")
    assert plan_fb == plan_renwu


def test_scene_preset_rulings():
    """场景系:免鎏金、空镜无面孔、金雾×0.6(09-20 用户终审 87_scene_w06,
    墨洗出局降备选);概念气氛=场景系变体,墨洗 0.7 候选保留待终审。"""
    plan, _, _ = stack.resolve_plan(_slots(), "场景")
    got = dict((s["key"], w) for s, w in plan)
    assert got == {"turbo": 1.0, "projector": 0.01, "detail": 1.0,
                   "goldenmist": 0.6}, got
    # 概念气氛=场景系变体:墨洗取候选首选中值 0.7
    plan2, _, _ = stack.resolve_plan(_slots(), "概念气氛图")
    got2 = dict((s["key"], w) for s, w in plan2)
    assert got2 == {"turbo": 1.0, "projector": 0.01, "detail": 1.0,
                    "sumiwash": 0.7, "goldenmist": 0.6}, got2


def test_storyboard_preset_ruling():
    """分镜剧情图(09-19 对拍定谳):人物三件+淡彩线描 0.5(连环画候选)。"""
    plan, _, _ = stack.resolve_plan(_slots(), "分镜剧情图")
    got = dict((s["key"], w) for s, w in plan)
    assert got == {"turbo": 1.0, "projector": 0.01, "detail": 1.0,
                   "asianmix": 0.4, "liujin": 0.3, "tancai": 0.5}, got


def test_ink_mutex_across_presets():
    """三画风(淡彩线描/墨洗/湿画)逐型至多点亮一件(09-17 互斥纪律)。"""
    ink = ("tancai", "sumiwash", "shihua")
    slots = {s["key"]: s for s in _slots()}
    for t in _bases_keys():
        lit = [k for k in ink if slots[k]["presets"][t]["on"]]
        assert len(lit) <= 1, (t, "三画风同开=崩源", lit)


def test_presets_equal_bases_lora_recipe():
    """C2/C3 数据一致:栈预设点亮 = daojie_bases.lora_recipe 一比一
    (bases 侧同款钉子的对侧;全局件 turbo/projector 恒挂不入配方)。"""
    bases = json.loads(my_daojie_base._BASES_JSON.read_text(encoding="utf-8"))
    slots = _slots()
    for e in bases:
        zh, want = e["zh"], {i["file"]: i["weight"] for i in e["lora_recipe"]}
        for s in slots:
            if s["key"] in ("turbo", "projector"):
                assert s["presets"][zh]["on"]
                continue
            on, w = s["presets"][zh]["on"], s["presets"][zh]["weight"]
            if s["file"] in want:
                assert on and abs(w - want[s["file"]]) < 1e-9, (zh, s["key"])
            else:
                assert not on, (zh, s["key"])


def test_expert_mode_widgets_govern():
    slots = _slots()
    enables = {k: k == "goldenmist" for k in CHAIN_KEYS}  # 其余显式关
    plan, display, _ = stack.resolve_plan(
        slots, stack.EXPERT_PRESET, base="场景",  # 专家模式无视 base
        enables=enables, weights={"goldenmist": 0.55})
    assert [(s["key"], w) for s, w in plan] == [("goldenmist", 0.55)]
    assert display == stack.EXPERT_PRESET
    empty, _, _ = stack.resolve_plan(slots, stack.EXPERT_PRESET, None,
                                     enables={k: False for k in CHAIN_KEYS})
    assert empty == []


def test_enable_false_masks_preset_and_reports():
    slots = _slots()
    enables = dict.fromkeys(CHAIN_KEYS, True)
    enables["asianmix"] = False  # 急停:矩阵点亮被开关压下(真关)
    plan, _, masked = stack.resolve_plan(slots, "人物", None, enables=enables)
    assert [s["key"] for s, _ in plan] == ["turbo", "projector", "detail", "liujin",
                                           "goldenmist"]
    assert masked == ["亚洲面孔·AsianMix"]


def test_missing_widgets_tolerated_for_hot_added_slots():
    """存量 node 未带新槽 widget(热加槽位):enable/weight 缺键不压停、权重回退。"""
    slots = _slots()
    plan, _, _ = stack.resolve_plan(slots, "人物", None, enables={}, weights={})
    assert [s["key"] for s, _ in plan] == ["turbo", "projector", "detail",
                                           "asianmix", "liujin", "goldenmist"]
    assert [w for _s, w in plan] == [1.0, 0.01, 1.0, 0.4, 0.3, 0.8]


def test_unknown_type_and_preset_raise_plain_language():
    with pytest.raises(RuntimeError, match="未知道劫型"):
        stack.resolve_plan(_slots(), "跟随底座型", "不存在的型")
    with pytest.raises(RuntimeError, match="未知道劫型"):
        stack.resolve_plan(_slots(), "美宣图", None)  # 非九型名亦非专家档
    node = stack.MyDaojieLoraStack()
    with pytest.raises(RuntimeError, match="未知 preset"):
        node.run("M", preset="胡乱档", **_widgets())


# ── run 路径(假引擎)───────────────────────────────────
def test_run_loads_plan_in_slot_order_and_reports_applied(fake_engine):
    node = stack.MyDaojieLoraStack()
    model, applied = node.run("M0", preset=stack.FOLLOW_PRESET, base="人物",
                              **_widgets())
    assert [p for p, _w in fake_engine["apply"]] == \
        [f"/loras/{CHAIN_FILES[i]}" for i in (0, 1, 2, 3, 4, 13)]  # 计划序=人物组六件
    assert fake_engine["apply"][0] == ("/loras/" + CHAIN_FILES[0], 1.0)
    assert fake_engine["apply"][1][1] == 0.01 and fake_engine["apply"][3][1] == 0.4
    assert applied.startswith("跟随底座型·人物(6/14):")
    assert "Krea2-Turbo-4步蒸馏×1" in applied and "ProjectorScale×0.01" in applied
    assert applied.endswith("金雾仙侠GoldenMisty×0.8")  # 末位=金雾(序锚,09-20 终审)
    assert model == "model#6"


def test_run_all_off_is_true_passthrough_no_loads(fake_engine):
    node = stack.MyDaojieLoraStack()
    model, applied = node.run("M0", preset=stack.EXPERT_PRESET,
                              **_widgets(all_on=False))
    assert fake_engine["load"] == [] and fake_engine["apply"] == []
    assert model == "M0"  # 原对象直通
    assert "0/14" in applied and "直通" in applied


def test_run_weight_zero_still_loads(fake_engine):
    """weight=0 仍加载(官方 LoraLoader 同径)——enable=false 真关的计时对照基线。"""
    node = stack.MyDaojieLoraStack()
    widgets = {en: False for _s, en, _w in stack.slot_widgets()}
    widgets.update(weight_turbo=0.0, enable_turbo=True)
    _m, applied = node.run("M0", preset=stack.EXPERT_PRESET, **widgets)
    assert len(fake_engine["load"]) == 1, "weight=0 应照常加载(与 enable=false 对拍)"
    assert "Krea2-Turbo-4步蒸馏×0" in applied


def test_run_missing_file_raises_naming_the_slot(fake_engine):
    fake_engine["state"]["missing"].add(CHAIN_FILES[1])  # 服从度缺件
    node = stack.MyDaojieLoraStack()
    with pytest.raises(RuntimeError, match="服从度·ProjectorScale.*服从度ProjectorScale"):
        node.run("M0", preset=stack.FOLLOW_PRESET, base="人物", **_widgets())
    assert len(fake_engine["apply"]) == 1  # turbo 已装一件,缺件槽点名即停(不静默)


def test_run_empty_file_field_raises(fake_engine, monkeypatch):
    slots = _slots()
    slots[0]["file"] = ""
    monkeypatch.setattr(stack, "_load_slots", lambda: slots)
    node = stack.MyDaojieLoraStack()
    with pytest.raises(RuntimeError, match="file 字段为空"):
        node.run("M0", preset=stack.FOLLOW_PRESET, base="人物", **_widgets())


def test_run_without_engine_raises_plain_language():
    node = stack.MyDaojieLoraStack()
    with pytest.raises(RuntimeError, match="须运行在漫影 ComfyUI 引擎内"):
        node.run("M0", preset=stack.FOLLOW_PRESET, base="人物", **_widgets())


# ── 缺省回退(库缺失/坏 JSON)────────────────────────────
def _retarget_json(monkeypatch, tmp_path, content: str | None):
    target = tmp_path / "daojie_lora_stack.json"
    if content is not None:
        target.write_text(content, encoding="utf-8")
    monkeypatch.setattr(stack, "_STACK_JSON", target)
    monkeypatch.setattr(stack, "_slots_cache", {"mtime": None, "entries": None})


def test_missing_json_degrades_to_placeholder_and_runtime_error(
        monkeypatch, tmp_path):
    _retarget_json(monkeypatch, tmp_path, None)  # 文件不存在
    assert stack._load_slots() == []
    assert stack.preset_choices() == stack._JSON_MISSING_COMBO
    node = stack.MyDaojieLoraStack()
    with pytest.raises(RuntimeError, match="库缺失"):
        node.run("M0", preset="跟随底座型", **_widgets())


def test_malformed_json_degrades_same_as_missing(monkeypatch, tmp_path):
    _retarget_json(monkeypatch, tmp_path, "[{\"key\": 坏 JSON")
    assert stack._load_slots() == []
    assert stack.preset_choices() == stack._JSON_MISSING_COMBO


# ── 节点表面与注册 ────────────────────────────────────────
def test_node_class_surface_and_registration():
    from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS
    cls = stack.MyDaojieLoraStack
    assert NODE_CLASS_MAPPINGS.get("MyDaojieLoraStack") is cls
    assert cls.CATEGORY == "my"
    assert cls.RETURN_TYPES == ("MODEL", "STRING")
    assert cls.RETURN_NAMES == ("model", "applied")
    spec = cls.INPUT_TYPES()
    assert list(spec["required"]) == ["model", "preset"] + [
        x for k in CHAIN_KEYS for x in (f"enable_{k}", f"weight_{k}")]
    assert spec["optional"]["base"][1].get("forceInput") is True
    assert spec["required"]["preset"][1]["default"] == stack.FOLLOW_PRESET
    for _slot, en, wt in stack.slot_widgets():
        assert spec["required"][en][1]["default"] is True  # enable 默认恒开
    assert spec["required"]["weight_projector"][1]["default"] == 0.01
    assert spec["required"]["weight_liujin"][1]["default"] == 0.3


def test_is_changed_reflects_json_and_inputs():
    v1 = stack.MyDaojieLoraStack.IS_CHANGED(preset="人物", base="人物")
    v2 = stack.MyDaojieLoraStack.IS_CHANGED(preset="场景", base="人物")
    assert v1 != v2 and "人物" in v1 and "|" in v1


def test_files_exist_in_engine_home_when_present():
    """引擎家在场时逐槽位存在性;无引擎家=跳过(repo 侧测试零引擎依赖)。"""
    home = (Path.home() / "Library/Application Support/漫影工作室/comfyui"
            / "models/loras")
    if not home.is_dir():
        return
    for s in _slots():
        assert (home / s["file"]).is_file(), f"槽位「{s['label']}」不在引擎家: {s['file']}"
