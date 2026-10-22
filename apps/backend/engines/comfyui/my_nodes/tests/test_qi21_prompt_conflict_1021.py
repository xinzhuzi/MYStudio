"""Real multiview assembly and retired W1 compatibility regressions."""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[6]
NODES = Path(__file__).resolve().parents[1] / "nodes"
DATA = ROOT / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json"
BASES = json.loads((DATA / "qi21_bases.json").read_bytes())
RGBA = BASES["rgba"]
MULTIVIEW = next(entry for entry in BASES["types"] if entry["zh"] == "人物多视图")


def load_node(name):
    spec = importlib.util.spec_from_file_location(name + "_round12", NODES / (name + ".py"))
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SELECT = load_node("my_qi21_prompt_select")
ASSEMBLY = load_node("my_qi21_prompt_assembly")
FINAL = load_node("my_qi21_final_output")
BASE = importlib.import_module("engines.comfyui.my_nodes.nodes.my_qi21_base")
API_PE = load_node("my_qi21_api_pe")


def original_subject():
    fixture = ROOT / "apps/backend/engines/comfyui/tests/fixtures/qi21_multiview_subject_1021.json"
    return json.loads(fixture.read_text(encoding="utf-8"))["subject"]


def saved_i2i_prompt_graph():
    paths = list((ROOT / "apps/backend/engines/comfyui/workflows").rglob("qi21-道劫-i2i.json"))
    assert len(paths) == 1
    workflow = json.loads(paths[0].read_bytes())
    return next(graph for graph in workflow["definitions"]["subgraphs"]
                if any(node["id"] == 153 and node["type"] == "MyQi21FinalOutput"
                       for node in graph["nodes"]))


def test_original_subject_does_not_read_task_artifacts(monkeypatch):
    read_text = Path.read_text

    def read_stable_file(path, *args, **kwargs):
        assert ".trellis" not in path.parts, "durable tests must survive task archival"
        return read_text(path, *args, **kwargs)

    monkeypatch.setattr(Path, "read_text", read_stable_file)
    assert hashlib.sha256(original_subject().encode("utf-8")).hexdigest() == (
        "3807722f2a29a9c9cf8255e54ff5601675c37a88c6c4e2af26f0d40197049880")


@pytest.mark.parametrize("pe_enabled", [False, True])
@pytest.mark.parametrize("transparent", [False, True])
@pytest.mark.parametrize("w1", [RGBA["w1_closing"], "强制只画一个完好全身人物", ""])
@pytest.mark.parametrize("direct_negative", ["  型负面  ", " \t", None])
def test_legacy_or_custom_w1_is_ignored_in_every_route(pe_enabled, transparent, w1, direct_negative):
    direct = " \t直写正文\n原样保留。 \n"
    pe_text = "Keep subject. Misty mountains and clouds behind her.\n类型句:不剥离远景。"
    body = SELECT.strip_word_family(pe_text.split("\n", 1)[0]) + "\n类型句:不剥离远景。" \
        if pe_enabled and transparent else pe_text if pe_enabled else direct
    expected = f"自定义头 {body} 自定义尾" if transparent else body
    negative = (direct_negative or "").strip() or ("PE负面" if pe_enabled else "")
    assert SELECT.MyQi21PromptSelect().compose(
        装配全文=direct, PE出文=pe_text, pe开关=pe_enabled, 透明模式=transparent,
        负面词直写=direct_negative, PE负面=" PE负面 ", RGBA官方头句="自定义头",
        RGBA官方尾句="自定义尾", W1收束句=w1) == (expected, negative)


@pytest.mark.parametrize("pe_enabled", [False, True])
@pytest.mark.parametrize("transparent", [False, True])
def test_default_w1_is_not_automatically_added(pe_enabled, transparent):
    body = "保留主体。"
    expected = f'{RGBA["head"]} {body} {RGBA["tail"]}' if transparent else body
    assert SELECT.MyQi21PromptSelect().compose(
        装配全文=body, PE出文=body, pe开关=pe_enabled, 透明模式=transparent) == (expected, "")


@pytest.mark.parametrize("pe_enabled", [False, True])
@pytest.mark.parametrize("transparent", [False, True])
def test_matching_user_text_is_not_deleted_from_body(pe_enabled, transparent):
    body = "用户原文。\n" + RGBA["w1_closing"]
    expected = f'{RGBA["head"]} {body} {RGBA["tail"]}' if transparent else body
    assert SELECT.MyQi21PromptSelect().compose(
        装配全文=body, PE出文=body, pe开关=pe_enabled, 透明模式=transparent,
        W1收束句=RGBA["w1_closing"])[0] == expected


@pytest.mark.parametrize("field", ["positive_text", "rgba_positive"])
def test_real_multiview_layout_and_damage_scope(field):
    text = MULTIVIEW[field]
    for phrase in ("共四幅", "仅左侧特写区域取正面构图", "正面、纯90度侧面、背面",
                   "头顶与脚底分别对齐", "当前可见视面", "同一物理位置", "不可见处不另造副本"):
        assert phrase in text, (field, phrase)
    assert "整幅仅取正面构图" not in text
    assert "来源明确要求的伤痕、破损与身体缺失逐格保留" not in text


@pytest.mark.parametrize("pe_enabled", [False, True])
def test_real_multiview_assembly_survives_saved_w1_snapshot(pe_enabled):
    subject = original_subject()
    graph = saved_i2i_prompt_graph()
    first = next(node for node in graph["nodes"] if node["id"] == 4014)
    assert first["type"] == "MyQi21InstructionSelect"
    assert first["widgets_values"] == [False]
    selected, = SELECT.MyQi21InstructionSelect().select_instruction(
        原始指令=subject, PE出文=subject, pe开关=pe_enabled)
    assert selected == subject
    base, width, height, base_negative, transparent, type_name = BASE.MyQi21DaojieBase().run("人物多视图")
    assert base == MULTIVIEW["positive_text"] and base_negative == MULTIVIEW["negative_text"]
    assert (width, height, transparent, type_name) == (1824, 1024, True, "人物多视图")
    assembled, negative = ASSEMBLY.MyQi21PromptAssembly().assemble(
        BASE=base, BASE负面=base_negative,
        主体句=selected, 组装用途="道劫美术类型")
    saved = next(node for node in graph["nodes"] if node["id"] == 153)
    assert saved["widgets_values"] == []
    assert [slot["name"] for slot in saved["inputs"]] == ["正向提示词", "负向提示词", "透明模式"]
    actual, actual_negative = FINAL.MyQi21FinalOutput().compose(
        正向提示词=assembled, 负向提示词=negative, 透明模式=True)
    assert RGBA["w1_closing"] not in actual
    assert "single standalone asset" not in actual
    assert subject in actual
    for phrase in ("共四幅", "仅左侧特写区域取正面构图", "正面、纯90度侧面、背面",
                   "头顶与脚底分别对齐", "当前可见视面", "同一物理位置"):
        assert phrase in actual
    assert actual.count(RGBA["head"]) == actual.count(RGBA["tail"]) == 1
    assert actual_negative == negative
    if not pe_enabled:
        assert (actual, actual_negative) == FINAL.MyQi21FinalOutput().compose(
            正向提示词=assembled, 负向提示词=negative, 透明模式=True)


def test_retired_w1_tooltip_and_schema_keep_old_slot():
    inputs = SELECT.MyQi21PromptSelect.INPUT_TYPES()
    tip = inputs["optional"]["W1收束句"][1]["tooltip"]
    assert "历史兼容" in tip and "停用" in tip and "忽略" in tip
    fixture = json.loads((ROOT / "apps/backend/engines/comfyui/tests/fixtures/qi21_object_info_snapshot.json").read_bytes())
    assert fixture["MyQi21PromptSelect"]["input"] == json.loads(json.dumps(inputs))
    assert fixture["MyQi21PromptSelect"]["description"] == SELECT.MyQi21PromptSelect.DESCRIPTION


@pytest.mark.parametrize("pe_enabled", [False, True])
def test_real_rgba_positive_survives_lean_fallback_and_wrapper(pe_enabled):
    subject = original_subject()
    lean = API_PE._rgba_lean_pos(subject, MULTIVIEW["positive_text"])
    for phrase in ("共四幅", "仅左侧特写区域取正面构图", "正面、纯90度侧面、背面",
                   "头顶与脚底分别对齐", "当前可见视面", "同一物理位置"):
        assert phrase in lean
    actual, _ = SELECT.MyQi21PromptSelect().compose(
        装配全文=lean, PE出文=lean, pe开关=pe_enabled, 透明模式=True,
        W1收束句=RGBA["w1_closing"])
    assert subject in actual and RGBA["w1_closing"] not in actual
    assert actual.count(RGBA["head"]) == actual.count(RGBA["tail"]) == 1
