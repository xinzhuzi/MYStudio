# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""YuE2 BGM 工作流 UI 格式 → 桥模板 API 格式导出(09-20 BGM 接线)。

源:apps/backend/engines/comfyui/workflows/3_声音/Yue2/yue2-bgm-纯音乐-lora版.json
  (UI 画布格式 nodes/links,09-20 实弹定稿的 LoRA 纯音乐构图)
出:同目录 yue2-bgm-纯音乐-lora版.api.json
  (本仓库桥模板 {schemaVersion:1, graph} 包装的 API 格式;unwrapComfyApiGraph
   直接解包执行,且 _is_bridge_template 会把它挡在画布侧栏外——画布打不开
   无 nodes 的文件,不进列表=不变相误置件)

转换规则(照 ComfyUI 0.36.0 前端 API 导出语义,逐条对引擎核心源码核实):
- links 表 → 消费节点 inputs[name] = [源节点号, 源槽位];PrimitiveNode 是
  前端专属节点(引擎核心无此类,nodes.py/comfy_extras 全 grep 实证),其
  widgets_values_named.value 内联进所有消费者的对应输入(一处改两节点同源
  的 UI 语义,在 API 面由消费方注入两键同值承接)。
- 未连线的 widget 值取 widgets_values_named(键名即输入名,不用猜顺序)。
- control_after_generate 是前端隐藏控件,API 面不存在(照库内既有桥模板
  t2i.json 的 KSampler 形状)。
- SaveAudioAdvanced 的 format 是 DynamicCombo(Type=dict),提交值为
  {"format": <选中项>}(nodes_audio.py execute 取 format.get("format"))。
- Note 节点(注释)不进 API 图。

铁律校验(实弹胜出构图照抄守卫,任何一条漂移即拒出):
- LoraLoader(100) 必须挂在 CheckpointLoaderSimple(15) 之后:
  model/clip 入自 [15,0]/[15,1],MODEL→KSampler(8).model,
  CLIP→YuE2GenerateMusic(22).clip 与 YuE2GenerateABC(23).clip;
  lora_name=ar_lora_inst_v3abc_comfyui.safetensors,strength 1.0/1.0 勿降。
- seed 全链 42 fixed;KSampler dpm_2/sgm_uniform/32 步/cfg 1.0;
  VAEDecodeAudioTiled 1920/128;SaveAudioAdvanced flac。

用法:
    python3 apps/build/scripts/yue2_bgm_api_export.py   # 仓库根或任意 cwd 均可
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
UI_WORKFLOW = REPO_ROOT / "apps/backend/engines/comfyui/workflows/3_声音/Yue2/yue2-bgm-纯音乐-lora版.json"
API_WORKFLOW = UI_WORKFLOW.with_suffix("").with_name(UI_WORKFLOW.stem + ".api.json")

# 前端专属/注释类节点:不进 API 图(PrimitiveNode 由消费方内联承接)
FRONTEND_ONLY_TYPES = {"PrimitiveNode", "Note"}
# 前端隐藏控件键:API 提交面不存在
HIDDEN_WIDGET_KEYS = {"control_after_generate"}
# DynamicCombo 类输入 → 提交值形状 {选中键: 值}(引擎 0.36.0 IO.DynamicCombo.Type=dict)
DYNAMIC_COMBO_WRAP = {("SaveAudioAdvanced", "format"): "format"}

STYLE_DEFAULT = "guzheng and bamboo flute, serene traditional chinese instrumental, pentatonic, slow 65 bpm, cinematic ambience"
LYRICS_DEFAULT = "[intro]\n[verse]\n[chorus]\n[bridge]\n[outro]"


def build_api_graph(ui: dict) -> dict[str, dict]:
    nodes_by_id = {str(node["id"]): node for node in ui["nodes"]}
    # links 表形状:[link_id, 源节点id, 源槽位, 目标节点id, 目标槽位, 类型]
    link_src = {str(link[0]): (str(link[1]), int(link[2])) for link in ui["links"]}
    api_graph: dict[str, dict] = {}
    for node_id, node in nodes_by_id.items():
        class_type = str(node["type"])
        if class_type in FRONTEND_ONLY_TYPES:
            continue
        inputs: dict[str, object] = {}
        # 1) 连线输入:PrimitiveNode 源内联字面量,其余 [节点号, 槽位]
        for slot in node.get("inputs", []):
            link_id = slot.get("link")
            if link_id is None:
                continue
            src_id, src_slot = link_src[str(link_id)]
            src_node = nodes_by_id[src_id]
            if str(src_node["type"]) == "PrimitiveNode":
                inputs[str(slot["name"])] = src_node["widgets_values_named"]["value"]
            else:
                inputs[str(slot["name"])] = [src_id, src_slot]
        # 2) 未连线的 widget 值(连线口已被上面覆盖,这里只补字面量)
        for widget_name, value in node.get("widgets_values_named", {}).items():
            if widget_name in HIDDEN_WIDGET_KEYS or widget_name in inputs:
                continue
            wrap_key = DYNAMIC_COMBO_WRAP.get((class_type, widget_name))
            inputs[widget_name] = {wrap_key: value} if wrap_key else value
        api_graph[node_id] = {"class_type": class_type, "inputs": inputs}
    return api_graph


def assert_ironrules(graph: dict[str, dict]) -> None:
    """实弹构图铁律守卫:任何漂移直接拒出(防上游 UI 文件被误改后带病生成)。"""
    def inp(node_id: str, key: str):
        return graph[node_id]["inputs"][key]

    assert inp("100", "model") == ["15", 0], "LoRA 必须吃 Checkpoint 的 MODEL"
    assert inp("100", "clip") == ["15", 1], "LoRA 必须吃 Checkpoint 的 CLIP"
    assert inp("100", "lora_name") == "ar_lora_inst_v3abc_comfyui.safetensors"
    assert inp("100", "strength_model") == 1.0 and inp("100", "strength_clip") == 1.0, "LoRA strength 勿降"
    assert inp("15", "ckpt_name") == "yue2_3b_bf16.safetensors"
    assert inp("8", "model") == ["100", 0], "KSampler.model 必须吃 LoRA 出的 MODEL"
    assert inp("22", "clip") == ["100", 1] and inp("23", "clip") == ["100", 1], "YuE2 两节点 CLIP 必须吃 LoRA 出"
    for seed_node in ("22", "23", "8"):
        assert inp(seed_node, "seed") == 42, f"节点 {seed_node} seed 必须固定 42"
    assert (inp("8", "steps"), inp("8", "cfg"), inp("8", "sampler_name"), inp("8", "scheduler")) == (32, 1.0, "dpm_2", "sgm_uniform")
    assert (inp("17", "tile_size"), inp("17", "overlap")) == (1920, 128)
    assert inp("10", "format") == {"format": "flac"}, "产物必须 flac"
    assert inp("10", "audio") == ["17", 0], "SaveAudioAdvanced 必须吃 VAEDecodeAudioTiled"
    # style/lyrics 注入口:PrimitiveNode 内联后,22/23 两节点同源字面量
    assert inp("22", "style") == inp("23", "style") == STYLE_DEFAULT
    assert inp("22", "lyrics") == inp("23", "lyrics") == LYRICS_DEFAULT


def main() -> int:
    ui = json.loads(UI_WORKFLOW.read_text(encoding="utf-8"))
    graph = build_api_graph(ui)
    assert_ironrules(graph)
    payload = {
        "schemaVersion": 1,
        "name": "YuE2 BGM 纯音乐 LoRA 版(API 执行面)",
        "note": (
            "由 yue2-bgm-纯音乐-lora版.json(UI 格式)经 apps/build/scripts/yue2_bgm_api_export.py 导出;"
            "构图=09-20 实弹定稿纯音乐铁律(LoRA 挂 Checkpoint 后,strength 1.0/1.0 勿降)。"
            "执行注入点:strings {'22.style','23.style','22.lyrics','23.lyrics'}"
            "(UI 面 PrimitiveNode 一处改两节点同源;API 面为内联字面量,注入两键同值承接);"
            "长任务建议 payload.timeoutS ≥ 1200。产物=audios[0](flac b64)。"
        ),
        "inputs": {
            "style": {"node": "22", "field": "style", "class_type": "YuE2GenerateMusic", "sync": ["23.style"]},
            "lyrics": {"node": "22", "field": "lyrics", "class_type": "YuE2GenerateMusic", "sync": ["23.lyrics"]},
        },
        "graph": graph,
    }
    API_WORKFLOW.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"ok: {API_WORKFLOW.relative_to(REPO_ROOT)} ({len(graph)} nodes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
