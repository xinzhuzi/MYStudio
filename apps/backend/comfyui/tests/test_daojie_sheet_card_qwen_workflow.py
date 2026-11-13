# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Qwen 版道劫-角色设定卡 工作流契约(1113;生成器=daojie_sheet_workflow_qwen_build_1113.py)。

v2 口径(1113 三弹定谳):编辑=multiref 路(参考图进 TE images.image_1 槽+<image1> 指代,
base 直驱 25步/cfg1/dn1);t2i=turbo r256 8步。锁六面:
① 件在库+类集恰十一种;② 9 段 TE(正/负)逐字==sheet_card_qwen v2 独立真源(与 H3 块分源
互斥);③ 采样口径+装载四件+LoRA;④ 连线双向+编辑参考图槽对号(head←side,余←master)+
合成器九槽;⑤ 组框罩全+Note 三锚;⑥ 前缀=道劫设定卡Q/。
"""
from __future__ import annotations

import importlib.util
import json
import pathlib

_TESTS = pathlib.Path(__file__).resolve().parent
_REPO = _TESTS.parents[3]
WF = (_REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/1_文生图/"
      "道劫-角色设定卡.json")
_GEN = _REPO / "apps/build/scripts/daojie_sheet_workflow_qwen_build_1113.py"

_spec = importlib.util.spec_from_file_location("sheet_wf_qgen", _GEN)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

DOC = json.loads(WF.read_text(encoding="utf-8"))
NODES = {n["id"]: n for n in DOC["nodes"]}
LINKS = {l[0]: l for l in DOC["links"]}

CLASS_WHITELIST = {
    "UNETLoader", "CLIPLoader", "VAELoaderKJ", "LoraLoaderModelOnly",
    "TextEncodeQwenImage21", "EmptyLatentImage", "KSampler", "VAEDecode",
    "MySheetCardComposer", "SaveImage", "MarkdownNote",
}

EDIT_IDS = {"side": 10, "back": 15, "face": 20, "wrist": 25, "waist": 30, "head": 35}
T2I_IDS = {"master": 5, "weapon": 40, "effect": 45}


def _te(nid):
    n = NODES[nid]
    assert n["type"] == "TextEncodeQwenImage21"
    return n["widgets_values"]


def test_file_and_class_whitelist():
    assert WF.is_file()
    got = {n["type"] for n in DOC["nodes"]}
    assert got == CLASS_WHITELIST, got ^ CLASS_WHITELIST


def test_prompts_are_qwen_truth_v2():
    p = gen._prompts()
    m = _te(T2I_IDS["master"])
    assert m[0] == p["master"][0] and m[1] == p["master"][1]
    assert _te(T2I_IDS["weapon"])[:2] == list(p["weapon"])
    assert _te(T2I_IDS["effect"])[:2] == list(p["effect"])
    for tag, nid in EDIT_IDS.items():
        t = _te(nid)
        assert t[0] == p["instr"][tag], tag
        assert t[1] == p["edit_neg"], tag
        assert t[2] == 0, tag
        assert "<image1>" in t[0], f"{tag} 缺 multiref 指代"
    h3 = json.loads((_REPO / "apps/frontend/assets/studio-manuals/art_skills/"
                     "daojie_ink_guofeng/json/qi21_bases.json").read_text(
                         encoding="utf-8"))["sheet_card"]
    for tag in EDIT_IDS:
        assert p["instr"][tag] != h3["edit_instructions"][tag], "Qwen 指令退化成 H3 同文"


def test_sampler_doctrine_and_models():
    q = gen._prompts()["q"]
    t, e = q["sampler"]["t2i"], q["sampler"]["edit"]
    assert e["denoise"] == 1.0 and not e.get("use_lora", True)
    for i in T2I_IDS.values():
        seed, ctrl, steps, cfg, nm, sch, dn = NODES[i + 2]["widgets_values"]
        assert (ctrl, steps, cfg, nm, sch, dn) == (
            "fixed", t["steps"], t["cfg"], t["sampler_name"], t["scheduler"], t["denoise"])
        assert LINKS[NODES[i + 2]["inputs"][0]["link"]][1] == 4   # t2i 模型←LoRA
        assert LINKS[NODES[i + 2]["inputs"][3]["link"]][1] == i + 1  # latent←EmptyLatent
    for i in EDIT_IDS.values():
        seed, ctrl, steps, cfg, nm, sch, dn = NODES[i + 2]["widgets_values"]
        assert (ctrl, steps, cfg, nm, sch, dn) == (
            "fixed", e["steps"], e["cfg"], e["sampler_name"], e["scheduler"], e["denoise"])
        assert LINKS[NODES[i + 2]["inputs"][0]["link"]][1] == 1   # 编辑模型=base 直驱
        assert LINKS[NODES[i + 2]["inputs"][3]["link"]][1] == i + 1  # latent←EmptyLatent
    assert NODES[1]["widgets_values"] == [q["models"]["unet"], "default"]
    assert NODES[2]["widgets_values"] == [q["models"]["clip"], "qwen_image", "default"]
    assert NODES[3]["widgets_values"] == [q["models"]["vae"], "cpu", "fp32"]
    assert NODES[4]["widgets_values"] == [q["models"]["lora"], q["models"]["lora_strength"]]


def test_links_and_multiref_wiring():
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
    for i in list(T2I_IDS.values()) + list(EDIT_IDS.values()):
        assert LINKS[NODES[i]["inputs"][0]["link"]][1] == 2   # TE clip←CLIP
    # 编辑参考图槽(slot1):head←side decode(13),余←master decode(8)
    for tag, i in EDIT_IDS.items():
        want = 13 if tag == "head" else 8
        assert LINKS[NODES[i]["inputs"][1]["link"]][1] == want, tag
        assert NODES[i]["inputs"][1]["name"] == "images.image_1", tag
        assert LINKS[NODES[i]["inputs"][2]["link"]][1] == 3   # TE vae
    comp = NODES[50]
    order = ("master", "side", "back", "face", "head",
             "wrist", "waist", "weapon", "effect")
    assert [i["name"] for i in comp["inputs"]] == list(order)
    want_src = {"master": 8, "side": 13, "back": 18, "face": 23,
                "head": 38, "wrist": 28, "waist": 33, "weapon": 43, "effect": 48}
    for slot, key in enumerate(order):
        assert LINKS[comp["inputs"][slot]["link"]][1] == want_src[key], key
    save = next(n for n in DOC["nodes"] if n["type"] == "SaveImage")
    assert save["widgets_values"] == ["道劫设定卡Q/"]


def test_groups_cover_and_note():
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
    for kw in ("孪生件", "独立真源", "换角色"):
        assert kw in text, f"Note 缺法则锚 {kw}"
