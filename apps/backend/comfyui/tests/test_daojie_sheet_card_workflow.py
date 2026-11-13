# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫-角色设定卡 工作流契约(1113 道劫正册化;生成器=daojie_sheet_workflow_build_1113.py)。

锁五面:
① 件在库+类集恰十种(白名单;多类少类皆红);
② 提示词真源互锁:9 段 conditioning prompt 逐字==qi21_bases.json 三层装配/
   sheet_card 指令(经生成器 _prompts 同一条装配路,禁件内手搓漂移);
③ 采样口径:九段 KSampler 恒 6步/CFG1/euler/simple/1.0+seed==sheet_card.seeds;
④ 连线双向+合成器九槽来源对号(master→8,head→侧视图 decode,余→master decode);
⑤ 组框罩全+Note 法则在场(固定框/真源/换角色三锚词)。
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

_TESTS = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS.parents[3]
WF = (_REPO / "apps/backend/comfyui/workflows/1_图片/MiniMax/5_角色设定卡/"
      "道劫-角色设定卡.json")
_GEN = _REPO / "apps/build/scripts/daojie_sheet_workflow_build_1113.py"

_spec = importlib.util.spec_from_file_location("sheet_wf_gen", _GEN)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

DOC = json.loads(WF.read_text(encoding="utf-8"))
NODES = {n["id"]: n for n in DOC["nodes"]}
LINKS = {l[0]: l for l in DOC["links"]}

CLASS_WHITELIST = {
    "UNETLoader", "CLIPLoader", "VAELoader", "MiniMaxH3ImageConditioning",
    "ConditioningZeroOut", "KSampler", "VAEDecode", "MySheetCardComposer",
    "SaveImage", "MarkdownNote",
}


def _cond(tag):
    """按 prompt 定位 conditioning 节点(tag∈master/side/.../weapon/effect)。"""
    p = gen._prompts()
    want = p["master"] if tag == "master" else (
        p["instr"][tag] if tag in p["instr"] else p[tag])
    got = [n for n in DOC["nodes"]
           if n["type"] == "MiniMaxH3ImageConditioning"
           and n["widgets_values"][0] == want]
    assert len(got) == 1, f"{tag} 段 prompt 真源不符(命中 {len(got)})"
    return got[0]


def test_file_and_class_whitelist():
    assert WF.is_file()
    got = {n["type"] for n in DOC["nodes"]}
    assert got == CLASS_WHITELIST, got ^ CLASS_WHITELIST


def test_prompts_are_truth_assembled():
    """9 段 prompt 逐字真源(master 三层装配/六指令/武器特效模板)。"""
    p = gen._prompts()
    sc = p["sc"]
    _cond("master")
    for tag in sc["edit_instructions"]:
        _cond(tag)
    _cond("weapon")
    _cond("effect")
    # 分辨率/角名随真源
    m = _cond("master")
    assert m["widgets_values"][1:] == [sc["master"]["width"], sc["master"]["height"]]
    w = _cond("weapon")
    assert w["widgets_values"][1:] == [sc["weapon"]["width"], sc["weapon"]["height"]]


def test_sampler_doctrine_and_seeds():
    sc = gen._prompts()["sc"]
    samplers = [n for n in DOC["nodes"] if n["type"] == "KSampler"]
    assert len(samplers) == 9
    seed_by_prompt = {**{sc["seeds"]["master"]: "master"},
                      **{v: k for k, v in sc["seeds"].items()}}
    for s in samplers:
        seed, ctrl, steps, cfg, name, sched, dn = s["widgets_values"]
        assert (steps, cfg, name, sched, dn) == (6, 1.0, "euler", "simple", 1.0)
        assert ctrl == "fixed"
        assert seed in seed_by_prompt, seed


def test_links_bidirectional_and_composer_wiring():
    for l in DOC["links"]:
        _, s, ss, d, ds, _ty = l
        assert s in NODES and d in NODES, l
        assert NODES[d]["inputs"][ds]["link"] == l[0], l
        assert l[0] in NODES[s]["outputs"][ss]["links"], l
    for n in DOC["nodes"]:
        for i in n["inputs"]:
            if i["link"] is not None:
                assert i["link"] in LINKS
        for o in n["outputs"]:
            assert all(lk in LINKS for lk in o["links"])
    comp = NODES[50]
    assert comp["type"] == "MySheetCardComposer"
    order = ("master", "side", "back", "face", "head",
             "wrist", "waist", "weapon", "effect")
    assert [i["name"] for i in comp["inputs"]] == list(order)
    # 九槽来源=各视图自己的 decode:master←8,side←13,back←18,face←23,
    # head←38(侧头编辑链),wrist←28,waist←33,weapon←43,effect←48
    want_src = {"master": 8, "side": 13, "back": 18, "face": 23,
                "head": 38, "wrist": 28, "waist": 33,
                "weapon": 43, "effect": 48}
    for slot, key in enumerate(order):
        lk = comp["inputs"][slot]["link"]
        src = LINKS[lk][1]
        assert src == want_src[key], (key, src, want_src[key])
        assert NODES[src]["type"] == "VAEDecode", (key, src)
    save = next(n for n in DOC["nodes"] if n["type"] == "SaveImage")
    assert save["widgets_values"] == ["道劫设定卡/"]
    assert LINKS[save["inputs"][0]["link"]][1] == 50


def test_groups_cover_and_note_law():
    for n in DOC["nodes"]:
        if n["type"] == "MarkdownNote":
            note = n
            continue
        cx, cy = (n["pos"][0] + n["size"][0] / 2, n["pos"][1] + n["size"][1] / 2)
        hits = [g for g in DOC["groups"]
                if g["bounding"][0] <= cx <= g["bounding"][0] + g["bounding"][2]
                and g["bounding"][1] <= cy <= g["bounding"][1] + g["bounding"][3]]
        assert len(hits) == 1, f"节点 {n['id']} 组框命中 {len(hits)}"
    text = note["widgets_values"][0]
    for kw in ("固定框", "真源", "换角色"):
        assert kw in text, f"Note 缺法则锚 {kw}"
