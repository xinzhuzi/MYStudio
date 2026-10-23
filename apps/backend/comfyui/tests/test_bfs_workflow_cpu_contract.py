"""Static contracts for the promoted BFS CPU/FP32 workflow."""

import json
from pathlib import Path

import pytest

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"
DIRECTORY = WORKFLOWS / "1_图片/Q2-1图像/2_图生图"
WORKFLOW = DIRECTORY / "qi21-bfs-换头.json"
HEAD_SWAP = (
    "head_swap: start with <image1> as the base image, keeping its lighting, "
    "environment, and background. remove the head from <image1> completely and "
    "replace it with the head from <image2>, strictly preserving the hair, eye "
    "color, nose structure from <image2>. copy the direction of the eye, head "
    "rotation, micro expressions from <image1>, high quality, sharp details, 4k"
)
EDGES = [
    [731, 470, 0, 477, 0, "IMAGE"],
    [735, 13, 0, 477, 2, "INT"],
    [736, 13, 1, 477, 3, "INT"],
    [737, 13, 0, 478, 2, "INT"],
    [738, 13, 1, 478, 3, "INT"],
    [739, 475, 0, 478, 0, "IMAGE"],
    [754, 485, 0, 487, 1, "VAE"],
    [756, 490, 0, 487, 0, "LATENT"],
    [759, 495, 0, 490, 0, "MODEL"],
    [772, 484, 0, 496, 0, "CLIP"],
    [774, 485, 0, 496, 4, "VAE"],
    [775, 496, 0, 490, 1, "CONDITIONING"],
    [776, 496, 1, 490, 2, "CONDITIONING"],
    [788, 486, 0, 490, 3, "LATENT"],
    [799, 493, 0, 495, 0, "MODEL"],
    [800, 491, 0, 493, 0, "MODEL"],
    [807, 477, 0, 496, 1, "IMAGE"],
    [814, 478, 0, 496, 2, "IMAGE"],
    [820, 477, 1, 486, 0, "INT"],
    [821, 477, 2, 486, 1, "INT"],
    [822, 487, 0, 506, 0, "IMAGE"],
    [823, 506, 0, 507, 0, "IMAGE"],
    [824, 506, 1, 510, 0, "MASK"],
    [825, 510, 0, 507, 1, "MASK"],
    [826, 506, 0, 507, 2, "IMAGE"],
    [827, 506, 1, 509, 1, "MASK"],
    [828, 508, 0, 507, 3, "MASK"],
    [829, 507, 0, 509, 0, "IMAGE"],
    [830, 509, 0, 461, 0, "IMAGE"],
]


@pytest.fixture
def workflow():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


def test_production_rename():
    assert WORKFLOW.is_file()
    assert not (DIRECTORY / "BFS-换头术-Qwen2.1.json").exists()


def test_cpu_fp32_shared_by_encoder_and_decoder(workflow):
    nodes = {node["id"]: node for node in workflow["nodes"]}
    loader = nodes[485]
    assert loader["type"] == "VAELoaderKJ"
    assert loader["properties"]["Node name for S&R"] == "VAELoaderKJ"
    assert loader["widgets_values"] == [
        "texture_fix_vae_for_qwen_image_2.1_bf16.safetensors", "cpu", "fp32"
    ]
    assert loader["size"][1] >= 120
    assert loader["outputs"][0]["links"] == [754, 774]
    assert nodes[487]["inputs"][1]["link"] == 754
    assert nodes[496]["inputs"][4]["link"] == 774


def test_all_named_widgets_match_positional_values(workflow):
    for node in workflow["nodes"]:
        if "widgets_values_named" in node:
            assert list(node["widgets_values_named"].values()) == node["widgets_values"], node["id"]


def test_sampling_models_and_tested_prompt(workflow):
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert nodes[490]["widgets_values"] == [42, "fixed", 20, 1, "euler", "simple", 1]
    assert nodes[491]["widgets_values"] == ["qwen_image_2.1_bf16.safetensors", "default"]
    assert nodes[484]["widgets_values"] == [
        "qwen3vl_8b_bf16_heretic.safetensors", "qwen_image", "default"
    ]
    assert nodes[493]["widgets_values"] == ["bfs_head_v1.1_qwen_2.1.safetensors", 1]
    assert nodes[496]["widgets_values"] == [HEAD_SWAP, "", 0]


def test_production_inputs_resize_and_output_defaults(workflow):
    nodes = {node["id"]: node for node in workflow["nodes"]}
    for node_id in [470, 475]:
        assert nodes[node_id]["widgets_values"] == ["", "image"]
        assert nodes[node_id]["widgets_values_named"] == {"image": "", "upload": "image"}
    assert nodes[13]["widgets_values"] == ["1:1 (Square)", 2, 32]
    for node_id in [477, 478]:
        assert nodes[node_id]["widgets_values"] == [
            512, 512, "lanczos", "resize", "0, 0, 0", "center", 32, "cpu"
        ]
    assert nodes[461]["widgets_values"] == ["Qwen_image_2.1", "png", "8-bit", "sRGB"]
    note = nodes[463]["widgets_values"][0]
    assert all(text in note for text in ["CPU", "FP32", "head_swap", "整头", "发型", "画风"])


def test_original_edges_and_reciprocal_registrations(workflow):
    nodes = {node["id"]: node for node in workflow["nodes"]}
    assert len(nodes) == len(workflow["nodes"]) == 24
    assert workflow["id"] == "54bb395d-3e60-4c94-b525-85523901575b"
    assert workflow["links"] == EDGES
    assert workflow["last_link_id"] >= max(edge[0] for edge in EDGES)
    assert workflow["last_node_id"] >= max(nodes)
    for node_id, node in nodes.items():
        for slot_index, slot in enumerate(node.get("inputs", [])):
            incoming = [edge[0] for edge in EDGES if edge[3:5] == [node_id, slot_index]]
            assert len(incoming) <= 1
            assert slot.get("link") == (incoming[0] if incoming else None)
        for slot_index, slot in enumerate(node.get("outputs", [])):
            outgoing = [edge[0] for edge in EDGES if edge[1:3] == [node_id, slot_index]]
            assert (slot.get("links") or []) == outgoing
    for _, source, output, target, input_slot, kind in EDGES:
        assert nodes[source]["outputs"][output]["type"] == kind
        assert nodes[target]["inputs"][input_slot]["type"] == kind
