"""Promote the verified BFS VAE path; default is read-only, --apply renames it."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / ".trellis/tasks/10-22-bfs-qwen21-color-diagnosis"
EVIDENCE = TASK / "research/production-sync-1023"
SOURCE_SHA256 = "6d1878941779d46daec9a679cee83d445b97438852071f80d8cd3694d856319b"
REFERENCE_SHA256 = "c93597dfa68b6770dc9f7f590a7c7b2ffbdb529eb47f7262d67d85fb6ba2e675"
SOURCE_RELATIVE = "1_图片/Q2-1图像/2_图生图/BFS-换头术-Qwen2.1.json"
NEW_NAME = "qi21-bfs-换头.json"
USAGE_NOTE = """## BFS 换头（Qwen-Image 2.1）

参考1=身体图（构图/衣物/姿态），参考2=头部引用（五官/发型）。请先选择两张输入图。

- 本地模型：bf16 底模 + heretic TE + 同一 texture_fix VAE。
- VAE：VAELoaderKJ，CPU + FP32；参考编码和最终解码共用，不切回 MPS。
- 采样：20步、CFG1、euler/simple；BFS LoRA ×1.0，seed42。
- 默认指令是两组 seed A/B 实跑通过的作者 head_swap 原句。
- head_swap 替换整头，参考发型与画风也可能迁移；不是保原发型的面部精修。
- CPU VAE 修复本机严重棕灰失真，不保证身份、画风或全图细节完美保留。
- 要保留原图非面部像素，须另做局部软蒙版回贴并验证蒙版外差值为0。
- 需要透明底时单独抠图，不靠换头指令保证透明背景。

模型名在 UNETLoader / CLIPLoader / VAELoaderKJ 修改；提示词在 TextEncodeQwenImage21 修改。
本流不含 Pruna 加速 LoRA；加速配置未经本轮验证。尺寸、保存与像素后处理保持原生产设置。
"""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def build_promoted(source_bytes: bytes, reference_bytes: bytes) -> dict:
    require(sha256(source_bytes) == SOURCE_SHA256, "Source SHA256 drift; refusing promotion")
    require(sha256(reference_bytes) == REFERENCE_SHA256, "CPU reference SHA256 drift")
    original = json.loads(source_bytes)
    reference = {node["id"]: node for node in json.loads(reference_bytes)["nodes"]}
    graph = copy.deepcopy(original)
    nodes = {node["id"]: node for node in graph["nodes"]}
    require(len(nodes) == len(graph["nodes"]) == 24, "Expected 24 unique nodes")
    require(len(graph["links"]) == 29, "Expected 29 actual edges")
    require(nodes[485]["type"] == "VAELoader", "Unexpected source VAE loader")
    require(reference[485]["type"] == "VAELoaderKJ", "Unexpected CPU reference loader")
    require(reference[485]["widgets_values"][1:] == ["cpu", "fp32"], "CPU/FP32 required")
    require(
        reference[485]["widgets_values"][0] == nodes[485]["widgets_values"][0],
        "VAE model must remain unchanged",
    )
    require(reference[496]["widgets_values"][0].startswith("head_swap:"), "Expected head_swap")
    require(
        reference[496]["widgets_values"][0] == reference[496]["widgets_values_named"]["prompt"],
        "CPU reference prompt tables disagree",
    )
    nodes[485]["type"] = "VAELoaderKJ"
    nodes[485]["properties"]["Node name for S&R"] = "VAELoaderKJ"
    nodes[485]["widgets_values"] = copy.deepcopy(reference[485]["widgets_values"])
    nodes[485]["widgets_values_named"] = copy.deepcopy(reference[485]["widgets_values_named"])
    nodes[485]["size"][1] = 130
    nodes[496]["widgets_values"][0] = reference[496]["widgets_values"][0]
    nodes[463]["widgets_values"] = [USAGE_NOTE]

    for node in graph["nodes"]:
        if "widgets_values_named" in node:
            names = list(node["widgets_values_named"])
            values = node["widgets_values"]
            require(len(names) == len(values), f"Widget cardinality changed: {node['id']}")
            node["widgets_values_named"] = dict(zip(names, values, strict=True))
        for slot in node.get("inputs", []):
            slot["link"] = None
        for slot in node.get("outputs", []):
            slot["links"] = []

    seen_links = set()
    for link_id, source_id, source_slot, target_id, target_slot, kind in graph["links"]:
        require(link_id not in seen_links, f"Duplicate link: {link_id}")
        seen_links.add(link_id)
        output = nodes[source_id]["outputs"][source_slot]
        input_slot = nodes[target_id]["inputs"][target_slot]
        require(output["type"] == input_slot["type"] == kind, f"Link type mismatch: {link_id}")
        require(input_slot["link"] is None, f"Duplicate incoming link: {link_id}")
        output["links"].append(link_id)
        input_slot["link"] = link_id
    graph["last_link_id"] = max(graph["last_link_id"], max(seen_links))

    require(nodes[485]["outputs"][0]["links"] == [754, 774], "VAE fanout changed")
    require(nodes[487]["inputs"][1]["link"] == 754, "Decoder lost shared VAE")
    require(nodes[496]["inputs"][4]["link"] == 774, "Encoder lost shared VAE")
    require(nodes[490]["widgets_values"] == [42, "fixed", 20, 1, "euler", "simple", 1], "Sampler drift")
    require(nodes[493]["widgets_values"] == ["bfs_head_v1.1_qwen_2.1.safetensors", 1], "LoRA drift")
    for node_id in [470, 475]:
        require(nodes[node_id]["widgets_values"] == ["", "image"], "Production input must be blank")

    for before, after in zip(original["nodes"], graph["nodes"], strict=True):
        restored = copy.deepcopy(after)
        for key in ["widgets_values_named", "inputs", "outputs"]:
            if key in before:
                restored[key] = before[key]
        if before["id"] in [485, 496, 463]:
            restored["widgets_values"] = before["widgets_values"]
        if before["id"] == 485:
            for key in ["type", "size", "properties"]:
                restored[key] = before[key]
        require(restored == before, f"Unapproved node change: {before['id']}")
        for direction, registration in [("inputs", "link"), ("outputs", "links")]:
            for old_slot, new_slot in zip(before.get(direction, []), after.get(direction, []), strict=True):
                restored_slot = {**new_slot, registration: old_slot.get(registration)}
                require(restored_slot == old_slot, f"Slot metadata changed: {before['id']}")
    restored_graph = {**graph, "nodes": original["nodes"], "last_link_id": original["last_link_id"]}
    require(restored_graph == original, "Graph identity, positions or actual edges changed")
    return graph


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Rename and update only the repository BFS workflow")
    args = parser.parse_args()
    inventory = json.loads((EVIDENCE / "inventory.json").read_text(encoding="utf-8"))
    source = ROOT / "apps/backend/comfyui/workflows" / SOURCE_RELATIVE
    destination = source.with_name(NEW_NAME)
    backup = EVIDENCE / "before-production.gui.json"
    require(inventory["source"] == str(source), "Inventory source path drift")
    require(inventory["relative"] == SOURCE_RELATIVE, "Inventory relative path drift")
    require(inventory["new_name"] == NEW_NAME, "Inventory target name drift")
    require(inventory["backup"] == str(backup), "Inventory backup path drift")
    require(inventory["source_sha256"] == SOURCE_SHA256, "Inventory SHA256 drift")
    require(not source.is_symlink() and not destination.is_symlink(), "Workflow must not be a symlink")
    backup_bytes = backup.read_bytes()
    require(sha256(backup_bytes) == SOURCE_SHA256, "Backup SHA256 drift")
    reference_bytes = (TASK / "research/face-ab-1023/B-vae-cpu-seed42.gui.json").read_bytes()
    promoted = build_promoted(backup_bytes, reference_bytes)
    output_bytes = (json.dumps(promoted, ensure_ascii=False, indent=2) + "\n").encode("utf-8")

    if not source.exists():
        require(destination.is_file(), "Neither original nor promoted workflow exists")
        require(destination.read_bytes() == output_bytes, "Promoted workflow drift; refusing overwrite")
        print(json.dumps({"status": "no-op", "sha256": sha256(output_bytes)}, ensure_ascii=False))
        return

    require(source.read_bytes() == backup_bytes, "Source SHA256 drift; refusing promotion")
    require(not destination.exists(), "Target already exists; refusing overwrite")
    if args.apply:
        require(source.read_bytes() == backup_bytes, "Source changed during validation")
        require(not destination.exists(), "Target appeared during validation")
        source.rename(destination)
        destination.write_bytes(output_bytes)
        require(not source.exists() and destination.read_bytes() == output_bytes, "Post-write verification failed")
    print(json.dumps({
        "status": "applied" if args.apply else "dry-run",
        "destination": str(destination.relative_to(ROOT)),
        "sha256": sha256(output_bytes),
        "nodes": len(promoted["nodes"]),
        "links": len(promoted["links"]),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
