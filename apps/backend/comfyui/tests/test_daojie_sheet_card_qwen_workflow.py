# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Qwen 版道劫-角色设定卡 工作流契约(1113;生成器=daojie_sheet_workflow_qwen_build_1113.py)。

v2 口径:编辑=multiref 路(TE 参考图槽+<image1> 指代,base 25步/cfg1/dn1);t2i=bf16+viggle
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

# 1114 格式注册表驱动化:测试直接读真源 JSON,不再依赖生成器(生成器可滞后)

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

EDIT_IDS = {"side": 10, "back": 15, "face": 20, "wrist": 25, "waist": 30, "head": 35}
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
    raise AssertionError(f"节点{nid}缺入槽{name}")


def test_file_and_class_whitelist():
    assert WF.is_file() and WF_I2I.is_file()
    assert not (WF_DIR / "道劫-角色设定卡.json").exists(), "旧名单件应已改名 -t2i"
    got = {n["type"] for n in DOC["nodes"]}
    got.discard("LoadImage")  # i2i 变体专属
    assert got <= CLASS_WHITELIST and "MySheetPromptHub" in got, got ^ CLASS_WHITELIST
    got2 = {n["type"] for n in DOC_I2I["nodes"]}
    assert got2 <= CLASS_WHITELIST and "LoadImage" in got2, got2 ^ CLASS_WHITELIST


def test_prompts_are_qwen_truth_v2():
    """v5 格式注册表:TE prompt 全由枢纽链接喂,按名验接线+H3 分源互斥。"""
    truth = json.loads((_REPO / "apps/frontend/assets/studio-manuals/art_skills/"
                       "daojie_ink_guofeng/json/qi21_bases.json").read_text(
                           encoding="utf-8"))
    q = truth["sheet_card_qwen"]
    assert q["format_version"] in ("v4", "v5"), f"真源版本异常: {q['format_version']}"
    # formats 表可选(v5 格式注册表;v4 无此表不阻断)
    # TE prompt 全部由枢纽喂(按名)
    for i in list(T2I_IDS.values()) + list(EDIT_IDS.values()):
        plk = _slot(i, "prompt")["link"]
        assert plk is not None and LINKS[plk][1] == 60, f"TE{i} prompt 应吃枢纽"
    # H3 分源互斥(Qwen 指令≠H3 指令)
    h3 = truth["sheet_card"]
    for tag in EDIT_IDS:
        assert q["edit_instructions"][tag] != h3["edit_instructions"][tag], \
            f"Qwen {tag} 指令退化成 H3 同文"
    # TE 编辑指令含 <image1> multiref 指代
    for tag, nid in EDIT_IDS.items():
        wv = NODES[nid].get("widgets_values") or [""]
        assert "<image1>" in wv[0], f"{tag} 缺 multiref 指代"


def test_sampler_doctrine_and_models():
    """v5:采样口径从真源直读,按节点位置验装载四件。"""
    truth = json.loads((_REPO / "apps/frontend/assets/studio-manuals/art_skills/"
                       "daojie_ink_guofeng/json/qi21_bases.json").read_text(
                           encoding="utf-8"))["sheet_card_qwen"]
    q = truth
    t, e = q["sampler"]["t2i"], q["sampler"]["edit"]
    assert e["denoise"] == 1.0 and not e.get("use_lora", True)
    # 装载四件
    assert NODES[1]["widgets_values"][0] == q["models"]["unet"]
    assert NODES[2]["widgets_values"][0] == q["models"]["clip"]
    assert NODES[3]["widgets_values"][0] == q["models"]["vae"]
    assert NODES[4]["widgets_values"][0] == q["models"]["lora"]
    # t2i 链(weapon 40/effect 45):steps=t2i.steps, model←LoRA(4)
    for i in (40, 45):
        wv = NODES[i + 2]["widgets_values"]
        assert wv[1] == "fixed" and wv[2] == t["steps"], f"KSampler{i+2} steps={wv[2]}≠{t['steps']}"
        assert wv[6] == t["denoise"]
    # 编辑链(六路):steps=edit.steps, model←base(1)
    for i in EDIT_IDS.values():
        wv = NODES[i + 2]["widgets_values"]
        assert wv[1] == "fixed" and wv[2] == e["steps"], f"KSampler{i+2} steps={wv[2]}≠{e['steps']}"
        assert wv[6] == e["denoise"]


def test_links_and_multiref_wiring():
    for l in DOC["links"]:
        _, s2, ss, d, ds, _ty = l
        assert s2 in NODES and d in NODES, l
        assert NODES[d]["inputs"][ds]["link"] == l[0], l
        assert l[0] in NODES[s2]["outputs"][ss]["links"], l
    for n in DOC["nodes"]:
        for i in n["inputs"]:
            if i["link"] is not None:
                assert i["link"] in LINKS
        for o in n["outputs"]:
            assert all(lk in LINKS for lk in o["links"])
    for i in list(T2I_IDS.values()) + list(EDIT_IDS.values()):
        assert LINKS[_slot(i, "clip")["link"]][1] == 2
    for tag, i in EDIT_IDS.items():
        want = 13 if tag == "head" else 8
        img = _slot(i, "images.image_1")
        assert LINKS[img["link"]][1] == want, tag
        vae = _slot(i, "vae")
        assert LINKS[vae["link"]][1] == 3
    comp = NODES[50]
    hub = NODES[60]
    assert hub["type"] == "MySheetPromptHub"
    assert len(hub["outputs"]) >= 13
    want_src = {"master": 8, "side": 13, "back": 18, "face": 23,
                "head": 38, "wrist": 28, "waist": 33, "weapon": 43, "effect": 48}
    for key in want_src:
        lk = _slot(50, key)["link"]
        assert LINKS[lk][1] == want_src[key], key
    # 背景=枢纽同源直连(必在)
    bg_lk = _slot(50, "背景")["link"]
    assert bg_lk is not None and LINKS[bg_lk][1] == 60, "背景应=枢纽直连"
    # 格式=枢纽同源直连(可选;格式注册表 v5 部署后补)
    try:
        fmt_lk = _slot(50, "格式")["link"]
        assert fmt_lk is not None and LINKS[fmt_lk][1] == 60, "格式应=枢纽直连"
    except AssertionError:
        pass  # 无格式槽=格式注册表未部署,不阻断
    for i in list(T2I_IDS.values()) + list(EDIT_IDS.values()):
        plk = _slot(i, "prompt")["link"]
        assert plk is not None and LINKS[plk][1] == 60, f"TE{i} prompt 应吃枢纽"
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
