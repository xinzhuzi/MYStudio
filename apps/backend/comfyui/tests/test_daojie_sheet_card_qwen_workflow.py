# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Qwen 版道劫-角色设定卡 工作流契约(1113;生成器=daojie_sheet_workflow_qwen_build_1113.py)。

v5 口径:编辑=multiref 路(TE 参考图槽+<image1> 指代,base 25步/cfg1/dn1);t2i=bf16+viggle
r256 8步。三加速否决史(1113 实测定谳,禁复犯):viggle-LoRA 挂编辑=不生效;VAE 回 GPU=崩引擎;
官方 turbo 蒸馏底模=单发可用但连跑崩引擎(换模抖动挤爆 24G)。锁六面:
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
WF_DIR = (_REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/5_角色设定卡/")
WF = WF_DIR / "道劫-角色设定卡-t2i.json"
WF_I2I = WF_DIR / "道劫-角色设定卡-i2i.json"
_GEN = _REPO / "apps/build/scripts/daojie_sheet_workflow_qwen_build_1113.py"

_spec = importlib.util.spec_from_file_location("sheet_wf_qgen", _GEN)
gen = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gen)

DOC = json.loads(WF.read_text(encoding="utf-8"))
DOC_I2I = json.loads(WF_I2I.read_text(encoding="utf-8"))
NODES = {n["id"]: n for n in DOC["nodes"]}
LINKS = {l[0]: l for l in DOC["links"]}

CLASS_WHITELIST = {
    "UNETLoader", "CLIPLoader", "VAELoaderKJ", "LoraLoaderModelOnly",
    "TextEncodeQwenImage21", "EmptyLatentImage", "KSampler", "VAEDecode",
    "MySheetCardComposer", "MySheetPromptHub", "LoadImage",
    "SaveImage", "MarkdownNote",
}

EDIT_IDS = {"side": 10, "back": 15, "face": 20, "wrist": 25, "waist": 30, "head": 35,
            "exp_happy": 70, "exp_angry": 80, "exp_sad": 90,
            "exp_surprise": 100, "exp_shy": 110}
EXP_IDS = {k: v for k, v in EDIT_IDS.items() if k.startswith("exp_")}
T2I_IDS = {"master": 5, "weapon": 40, "effect": 45}


def _te(nid):
    n = NODES[nid]
    assert n["type"] == "TextEncodeQwenImage21"
    return n["widgets_values"]


def _slot(nid, name):
    """按名查节点入槽(不依赖槽序,用户手动排版/ComfyUI 自然序兼容)。"""
    for inp in NODES[nid].get("inputs", []):
        if inp["name"] == name:
            return inp


def test_file_and_class_whitelist():
    assert WF.is_file() and WF_I2I.is_file()
    assert not (WF_DIR / "道劫-角色设定卡.json").exists(), "旧名单件应已改名 -t2i"
    got = {n["type"] for n in DOC["nodes"]}
    got.discard("LoadImage")  # i2i 变体专属
    assert got <= CLASS_WHITELIST and "MySheetPromptHub" in got, got ^ CLASS_WHITELIST
    got2 = {n["type"] for n in DOC_I2I["nodes"]}
    assert got2 <= CLASS_WHITELIST and "LoadImage" in got2, got2 ^ CLASS_WHITELIST


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
        assert p["instr"][tag] != h3["edit_instructions"].get(tag, ""), \
            "Qwen 指令退化成 H3 同文"


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
    assert NODES[3]["widgets_values"] == [q["models"]["vae"], q["models"].get("vae_device", "cpu"), "fp32"]
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
    # 编辑参考图槽(images.image_1):head←side decode(13),表情五路←face decode(23),
    # 余←master decode(8)
    for tag, i in EDIT_IDS.items():
        want = 13 if tag == "head" else 23 if tag in EXP_IDS else 8
        img = _slot(i, "images.image_1")
        assert img["link"] is not None and LINKS[img["link"]][1] == want, tag
        assert LINKS[_slot(i, "vae")["link"]][1] == 3, tag  # TE vae
    comp = NODES[50]
    order = ("master", "side", "back", "face", "head",
             "wrist", "waist", "weapon", "effect",
             "exp_1", "exp_2", "exp_3", "exp_4", "exp_5",
             "背景", "格式", "档案")
    assert [i["name"] for i in comp["inputs"]] == list(order)
    # 背景类型:枢纽(slot17)→合成器(slot14) 永不脱钩
    bg_lk = comp["inputs"][14]["link"]
    assert LINKS[bg_lk][1] == 60 and LINKS[bg_lk][2] == 17, "背景应=枢纽出17直连"
    # 格式:枢纽(slot18)→合成器(slot15) 尾部追加(1114 注册表驱动透传)
    fmt_lk = comp["inputs"][15]["link"]
    assert LINKS[fmt_lk][1] == 60 and LINKS[fmt_lk][2] == 18, "格式应=枢纽出18直连"
    # 档案:枢纽(slot19)→合成器(slot16) v6 底部信息带两行(档案+设计说明)
    arch_lk = comp["inputs"][16]["link"]
    assert LINKS[arch_lk][1] == 60 and LINKS[arch_lk][2] == 19, "档案应=枢纽出19直连"
    # TE prompt 全部由枢纽链接喂(散装退役)
    for i in list(T2I_IDS.values()) + list(EDIT_IDS.values()):
        plk = _slot(i, "prompt")["link"]
        assert plk is not None and LINKS[plk][1] == 60, f"TE{i} prompt 应吃枢纽"
    hub = NODES[60]
    assert hub["type"] == "MySheetPromptHub"
    assert len(hub["outputs"]) == 20
    want_src = {"master": 8, "side": 13, "back": 18, "face": 23,
                "head": 38, "wrist": 28, "waist": 33, "weapon": 43, "effect": 48,
                "exp_1": 73, "exp_2": 83, "exp_3": 93, "exp_4": 103, "exp_5": 113,
                "背景": 60, "格式": 60, "档案": 60}
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
    for kw in ("双件", "背景类型联动", "批量"):
        assert kw in text, f"Note 缺法则锚 {kw}"
    # 组框两两不相交(1113 用户令禁遮盖)
    bs = [g["bounding"] for g in DOC["groups"]]
    for i in range(len(bs)):
        for j in range(i + 1, len(bs)):
            a, b = bs[i], bs[j]
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            assert ox <= 0 or oy <= 0, f"组框重叠{i}×{j}"
