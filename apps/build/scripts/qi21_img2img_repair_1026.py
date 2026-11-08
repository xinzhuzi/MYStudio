#!/usr/bin/env python3
"""Repair classic Qwen2.1 img2img without rebuilding its saved workflow.

Default is a read-only check; --apply updates only the audited original SHA.
The TE's third output is empty latent, so partial-denoise img2img must instead
sample an explicit VAEEncode of the same resized input image. No deployment,
engine operation, or generation is performed here.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO / "apps/backend/comfyui/workflows"
ORIGINAL_SHA256 = "da7a12d113cbb1c6ca06191c5bd3973580767b8683b371e9bfa6a9509d8aba49"
VAE = "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors"
ENCODER_ID = 4021
sys.path.insert(0, str(REPO / ".agents/skills/node-graph/tools"))
import layout_check  # noqa: E402


def validate(graph: dict) -> None:
    """Check both workflow edge registries and the effective sampling inputs."""
    nodes = {n["id"]: n for n in graph["nodes"]}
    links = {edge[0]: edge for edge in graph["links"]}
    assert len(nodes) == len(graph["nodes"]), "duplicate node ID"
    assert len(links) == len(graph["links"]), "duplicate link ID"
    for edge in links.values():
        lid, origin, oslot, target, tslot, typ = edge
        output = nodes[origin]["outputs"][oslot]
        inp = nodes[target]["inputs"][tslot]
        assert lid in output.get("links", []), f"unregistered output edge {lid}"
        assert inp["link"] == lid, f"unregistered input edge {lid}"
        assert typ == output["type"] and inp["type"] in (typ, "*"), f"edge type mismatch {lid}"
    for node in nodes.values():
        for slot, inp in enumerate(node.get("inputs", [])):
            if inp.get("link") is not None:
                edge = links[inp["link"]]
                assert edge[3:5] == [node["id"], slot], f"wrong input edge target {node['id']}:{slot}"
        for slot, out in enumerate(node.get("outputs", [])):
            for lid in out.get("links") or []:
                assert links[lid][1:3] == [node["id"], slot], f"wrong output edge origin {lid}"
    assert graph["last_node_id"] >= max(nodes)
    assert graph["last_link_id"] >= max(links)
    loader = nodes[3]
    assert loader["type"] == "VAELoaderKJ"
    assert loader["widgets_values"] == [VAE, "cpu", "fp32"]
    assert loader["widgets_values_named"] == dict(zip(("vae_name", "device", "weight_dtype"), loader["widgets_values"]))
    encoder = nodes[ENCODER_ID]
    assert encoder["type"] == "VAEEncode"
    for name, expected in (("pixels", [16, 0]), ("vae", [3, 0])):
        slot = next(i for i in encoder["inputs"] if i["name"] == name)
        assert links[slot["link"]][1:3] == expected
    sampler = nodes[7]
    latent = next(i for i in sampler["inputs"] if i["name"] == "latent_image")
    assert links[latent["link"]][1:3] == [ENCODER_ID, 0]
    assert not nodes[4015]["outputs"][2].get("links"), "empty TE latent remains connected"
    names = ("seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler", "denoise")
    assert sampler["widgets_values_named"] == dict(zip(names, sampler["widgets_values"]))
    assert sampler["widgets_values"][2:] == [9, 1, "euler", "simple", 0.6]


def transform(original: dict) -> dict:
    graph = copy.deepcopy(original)
    nodes = {n["id"]: n for n in graph["nodes"]}
    if ENCODER_ID in nodes:
        validate(graph)
        return graph
    assert nodes[3]["type"] == "VAELoader"
    assert nodes[3]["widgets_values"] == [VAE]
    assert nodes[4015]["outputs"][2]["links"] == [15]
    assert [edge for edge in graph["links"] if edge[0] == 15] == [[15, 4015, 2, 7, 3, "LATENT"]]
    loader = nodes[3]
    loader["type"] = "VAELoaderKJ"
    loader["properties"]["Node name for S&R"] = "VAELoaderKJ"
    loader["widgets_values"] = [VAE, "cpu", "fp32"]
    loader["widgets_values_named"] = dict(zip(("vae_name", "device", "weight_dtype"), loader["widgets_values"]))
    loader["inputs"] = [{"name": name, "type": "COMBO", "widget": {"name": name}, "link": None}
                        for name in ("vae_name", "device", "weight_dtype")]
    loader["size"][1] = max(120, loader["size"][1])
    loader["title"] = "[3] VAE·CPU FP32"
    loader["outputs"][0]["links"].append(20)
    nodes[16]["outputs"][0]["links"].append(19)
    nodes[4015]["outputs"][2]["links"] = []
    next(edge for edge in graph["links"] if edge[0] == 15)[1:3] = [ENCODER_ID, 0]
    graph["links"].extend([[19, 16, 0, ENCODER_ID, 0, "IMAGE"],
                           [20, 3, 0, ENCODER_ID, 1, "VAE"]])
    encoder = {"id": ENCODER_ID, "type": "VAEEncode", "pos": [4600, 3000], "size": [300, 90],
               "flags": {}, "order": 10, "mode": 0,
               "inputs": [{"name": "pixels", "type": "IMAGE", "link": 19},
                          {"name": "vae", "type": "VAE", "link": 20}],
               "outputs": [{"name": "LATENT", "type": "LATENT", "links": [15]}],
               "properties": {"Node name for S&R": "VAEEncode"}, "widgets_values": [],
               "title": "[4021] 底图潜码"}
    graph["nodes"].append(encoder)
    graph["last_node_id"] = max(graph["last_node_id"], ENCODER_ID, *nodes)
    graph["last_link_id"] = 20
    sampler = nodes[7]
    names = ("seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler", "denoise")
    sampler["widgets_values_named"] = dict(zip(names, sampler["widgets_values"]))
    note = nodes[402]["widgets_values"][0]
    old = "生成脚本 `apps/build/scripts/qi21_img2img_build_1009.py`(幂等,重跑字节稳定);"
    assert note.count(old) == 1
    note = note.replace(old, "历史生成脚本 `apps/build/scripts/qi21_img2img_build_1009.py` 已退役，禁止重跑（会覆盖后续修复）；")
    note += ("\n\n### 1026 底图潜码与数值精度修复\n"
             "- [16] 预缩底图同时送参考编码和 [4021] VAEEncode；采样从 [4021] 的真实底图潜码起步。"
             "官方 [4015] TE.latent 是匹配 image_1 尺寸的全零潜码，不是底图经过 VAE 的潜码，故本件不接它。\n"
             "- [3] 固定 texture_fix VAE、CPU＋FP32，共用于底图编码、参考编码和最终解码，避免本机已复现的 MPS VAE 偏色。"
             "这不是把主模型改到 CPU；保持现有采样 9 步/cfg1/denoise 0.6，按名与按位存值一致。\n"
             "- 本次手术入口：apps/build/scripts/qi21_img2img_repair_1026.py；默认只读检查，--apply 仅接受已审原始 SHA。"
             "结构检查通过不等于视觉已验收，仍须串行实图验证。")
    nodes[402]["widgets_values"][0] = note
    validate(graph)
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="repair only the audited original workflow")
    args = parser.parse_args()
    hits = list(WORKFLOWS.rglob("自研件-qi21-道劫-img2img.json"))
    assert len(hits) == 1, "workflow must be unique"
    path = hits[0]
    raw = path.read_bytes()
    source_sha = hashlib.sha256(raw).hexdigest()
    original = json.loads(raw)
    graph = transform(original)
    before = layout_check.check_workflow(original)[0]["counts"]
    after = layout_check.check_workflow(graph)[0]["counts"]
    # This is a topology repair, not a coordinate-only polish: an explicit image
    # encoder adds IMAGE/VAE fan-out edges. Keep existing nodes in place; accept
    # the audited new crossing cap while retaining every other layout gate.
    # node-graph/OPTIMIZATION.md permits a new baseline for topology changes.
    assert after["crossings"] <= 11, f"topology crossing cap exceeded: {after}"
    assert all(after[key] <= before[key] for key in before if key != "crossings"), \
        f"non-crossing layout regression: {before} -> {after}"
    changed = graph != original
    if args.apply and changed:
        assert source_sha == ORIGINAL_SHA256, "source changed since audit; refusing overwrite"
        assert path.read_bytes() == raw, "concurrent edit detected; refusing overwrite"
        path.write_text(json.dumps(graph, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"path": str(path), "source_sha256": source_sha, "changed": changed,
                      "applied": args.apply and changed, "layout_before": before, "layout_after": after}, ensure_ascii=False))


if __name__ == "__main__":
    main()
