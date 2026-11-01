#!/usr/bin/env python3
"""Pika fl2va 主力产线工作流生成器(1101 用户裁定「主力用 Pika」第一波,repo 工作流作者)。

母体 = 官方 PikaFlex-FL2VA 首尾帧模板(definitions.subgraphs[0] 20 节点,1030 役入库)。
契约换装(全部参数逐字取自母体子图,2026-11-01 实读):
- UNET=minimax_h3_fl2va_pruned_int8_convrot(官方 Pika 契约底模)
- LoRA=pika_h3_flex_fl2va_comfy_bf16@1.0(Pika-Labs 适配器,官方仓收录)
- 采样=KSamplerSelect lcm + ManualSigmas "1.0,0.972973,0.923077,0.8,0.571429,0.333333,0.0"(6-NFE)
- TE=qwen3vl_32b_minimax_h3_nvfp4_awq(CLIPLoader type=minimax)
- VAE=int8_convrot(视频)+fp32(音频)
- 增量(横评 B 臂白拿):ModelAttentionBackend=comfy kitchen attention(412.0s/-9.2% vs pytorch,音频同簇)
- 增量(产线锚点契约,对齐 31 节点单镜骨架先例):
  14.value 提示词锚 / 20.value 秒锚 / 9.image 首帧锚 / 4.filename_prefix 五段前缀 / 100 MyShot 回写
  16.width+height 直填(档位覆写 ResolutionSelector)
  尾帧口(母体 second Picture)接 10 LoadImage——产线单镜默认旁路(mode=4),组装器按需激活
- 分辨率:母体走 GetImageSize+round(a/32)*32(首帧图原生分辨);产线改为 ResolutionSelector+16 直填(608x352 出厂,grill#3 教训:官方原生分辨率是 3668x2048 35 倍像素灾难,禁直用)
- seed:RandomNoise 出厂 fixed 42(横评 D 臂口径;grill#8 教训:官方 randomize 不可复现)

产出(幂等,重跑字节等价;引擎前端格式,画布直开):
  1. apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/pika-单镜视频-fl2v.json
  2. apps/frontend/lib/assist/image-studio/pika-shot-template.json(同字节)

不做实弹:纯静态产出;热跑首发+引擎层验收属第二波(候四件模型下载毕)。
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MOTHER = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/4_官方本地模板/官方本地-PikaFlex-FL2VA首尾帧.json"
LIB_DIR = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
OUT = LIB_DIR / "pika-单镜视频-fl2v.json"
FRONTEND_UI_OUT = REPO / "apps/frontend/lib/assist/image-studio/pika-shot-template.json"

# ── 官方契约逐字(母体子图实读)────────────────────────────────────────────
UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
LORA = "pika_h3_flex_fl2va_comfy_bf16.safetensors"
MANUAL_SIGMAS = "1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0"
SAMPLER = "lcm"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"
AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
ATTENTION = "comfy kitchen attention"
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"
FIRST_FRAME_PLACEHOLDER = "manying-shot-h3-placeholder.jpg"
LAST_FRAME_PLACEHOLDER = "manying-shot-h3-lastframe-placeholder.jpg"
SEED = 42

NOTE_MAIN = """## 漫影 Pika fl2va 主力线(1101 用户裁定「主力用 Pika」)

**契约**(全部逐字取自 PikaFlex 官方模板):6-NFE ManualSigmas + lcm 采样 + int8 pruned 底模 + Pika LoRA@1.0。
**速度**:横评 D 臂 172s(冷载,608x352/9.4s)vs bf16 28步 412s = **2.4× 提速**。
**kitchen attention** 默认开(B 臂白拿 -9.2%,音频同簇)。
**分辨率**:608x352 出厂(禁用官方原生 GetImageSize——3668x2048 是 35 倍像素灾难)。
**seed**:fixed 42(横评口径;官方 randomize 不可复现)。
**响度适配候办**:D 臂 I=-30.01 偏轻 2.4dB,进成片管线需 loudnorm 增益档(第二波)。
**bf16 28步**:降为质量对照+兜底备档(不删)。"""

NOTE_ANCHORS = """## 产线锚点契约(与 31 节点单镜骨架同构)

- 14.value:提示词(FL2VA 对齐行+三段式)
- 20.value:秒数(17k+5 网格吸附)
- 9.image:首帧(分镜帧)
- 10.image:尾帧(可选,默认旁路)
- 16.width/16.height:档位直填(608x352 出厂)
- 4.filename_prefix:五段前缀(回收链)
- 100:MyShot 回写"""


def build_canvas() -> dict:
    mother = json.loads(MOTHER.read_text(encoding="utf-8"))
    sg = mother["definitions"]["subgraphs"][0]
    sg_nodes = {n["id"]: copy.deepcopy(n) for n in sg["nodes"]}
    # 子图 links 是 dict 格式——统一转 tuple(origin_id, origin_slot, target_id, target_slot, type) 供语义判断
    _raw_links = sg.get("links") or []
    sg_links = [
        (l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"])
        if isinstance(l, dict) else (l[1], l[2], l[3], l[4], l[5])
        for l in _raw_links
    ]

    # ── 官方契约节点(保留母体参数,仅改必要字段)──────────────────────
    sg_nodes[127]["widgets_values"] = [UNET, "default"]  # UNETLoader(契约底模)
    sg_nodes[134]["widgets_values"] = [LORA, 1]  # LoRA@1.0
    sg_nodes[123]["widgets_values"] = [SAMPLER]  # KSamplerSelect lcm
    sg_nodes[143]["widgets_values"] = [MANUAL_SIGMAS]  # 6-NFE
    sg_nodes[129]["widgets_values"] = [SEED, "fixed"]  # seed42 可复现
    sg_nodes[133]["widgets_values"] = [5]  # 20.value 秒出厂
    sg_nodes[131]["widgets_values"][0] = ""  # 16 号提示词清空(由 14 锚供)

    # 16 号:MiniMaxH3ImageToVideo 改直填宽高(608x352 出厂)
    gen = sg_nodes[131]
    gen["widgets_values"] = ["", 608, 352, 124]
    # 母体 131 的 width/height 来自 GetImageSize→round/32 链——直填后断链
    sg_links = [l for l in sg_links if not (l[2] == 131 and l[4] in ("INT",))]
    # 152/153 号 ComfyMathExpression(round/32)随 GetImageSize 链退役
    for dead in (150, 151, 152, 153):
        sg_nodes.pop(dead, None)
        sg_links = [l for l in sg_links if l[0] != dead and l[2] != dead]

    # 增 ModelAttentionBackend(kitchen,B 臂白拿)
    attn = {
        "id": 140, "type": "ModelAttentionBackend", "pos": [600, -300],
        "widgets_values": [ATTENTION], "properties": {"Node name for S&R": "ModelAttentionBackend"},
        "inputs": [{"name": "model", "type": "MODEL", "link": None}],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": [], "slot_index": 0}],
    }
    sg_nodes[140] = attn

    # ── 产线锚点件(从 31 节点骨架借形)───────────────────────────────
    anchor_mother = json.loads((REPO / "apps/frontend/lib/assist/image-studio/h3-shot-template.json").read_text(encoding="utf-8"))
    am = {n["id"]: n for n in anchor_mother["nodes"]}

    def borrow(nid: int, new_id: int) -> dict:
        n = copy.deepcopy(am[nid])
        n["id"] = new_id
        n["order"] = new_id
        if n.get("outputs"):
            for o in n["outputs"]:
                o["links"] = []
        if n.get("inputs"):
            for i in n["inputs"]:
                i["link"] = None
        return n

    # 14=提示词锚 / 20=秒锚 / 9=首帧 / 10=尾帧(旁路) / 22=档位选择 / 100=MyShot / 4=SaveVideo
    sg_nodes[14] = borrow(14, 14)
    sg_nodes[14]["widgets_values"] = [""]
    sg_nodes[20] = borrow(20, 20)
    sg_nodes[20]["widgets_values"] = [5]
    sg_nodes[9] = borrow(9, 9)
    sg_nodes[9]["widgets_values"] = [FIRST_FRAME_PLACEHOLDER, "image"]
    sg_nodes[9]["mode"] = 4
    sg_nodes[10] = borrow(9, 10)
    sg_nodes[10]["widgets_values"] = [LAST_FRAME_PLACEHOLDER, "image"]
    sg_nodes[10]["mode"] = 4
    sg_nodes[22] = borrow(22, 22)
    sg_nodes[22]["widgets_values"] = ["16:9 (Widescreen)", 0.2, 32]
    sg_nodes[100] = borrow(100, 100)
    sg_nodes[100]["widgets_values"] = ["S00", "", "", "待生成"]
    sg_nodes[100]["mode"] = 0
    sg_nodes[4] = borrow(4, 4)
    sg_nodes[4]["widgets_values"] = [FIVE_SEGMENT_PREFIX, "auto", "auto", "auto"]

    # ── 组装画布(顶层节点,子图展平)─────────────────────────────────
    canvas = {
        "id": "pika-fl2v-mainline-1101",
        "revision": 0,
        "last_node_id": 200,
        "last_link_id": 500,
        "nodes": sorted(sg_nodes.values(), key=lambda n: n["id"]),
        "links": [],
        "groups": [],
        "config": {},
        "extra": {},
        "version": 0.4,
    }

    # 语义边(与 31 节点骨架同构+Pika 契约差异)
    EDGES = [
        # 生成链
        (14, 0, 131, "prompt", "STRING"),
        (20, 0, 132, "a", "FLOAT"),
        (132, 1, 131, "length", "INT"),
        (22, 0, 131, "width", "INT"),
        (22, 1, 131, "height", "INT"),
        (9, 0, 131, "first_frame", "IMAGE"),
        # 模型链:127 UNET → 134 LoRA → 140 Attn → 126 Guider + 123 Sampler 双喂
        (127, 0, 134, "model", "MODEL"),
        (134, 0, 140, "model", "MODEL"),
        (140, 0, 126, "model", "MODEL"),
        (140, 0, 143, "model", "MODEL"),  # ManualSigmas 需 model?不——核查母体!
        # TE/VAE
        (128, 0, 131, "clip", "CLIP"),
        (119, 0, 131, "vae", "VAE"),
        (120, 0, 131, "audio_vae", "VAE"),
        # 采样链
        (129, 0, 125, "noise", "NOISE"),
        (126, 0, 125, "guider", "GUIDER"),
        (123, 0, 125, "sampler", "SAMPLER"),
        (143, 0, 125, "sigmas", "SIGMAS"),
        (131, 0, 126, "conditioning", "CONDITIONING"),
        (131, 1, 125, "latent_image", "LATENT"),
        # 解码链
        (125, 1, 122, "samples", "LATENT"),
        (125, 1, 121, "samples", "LATENT"),
        (119, 0, 122, "vae", "VAE"),
        (120, 0, 121, "vae", "VAE"),
        (122, 0, 130, "images", "IMAGE"),
        (121, 0, 130, "audio", "AUDIO"),
        (130, 0, 4, "video", "VIDEO"),
        (4, 0, 100, "video", "VIDEO"),  # SaveVideo→MyShot 回写
    ]
    # ManualSigmas 不接 model(核母体:143 只出 SIGMAS 给 125)——撤上面临时边
    EDGES = [e for e in EDGES if e != (140, 0, 143, "model", "MODEL")]
    # 采样链修正:母体里 125 的 model 来自 BasicGuider(126),sigmas 来自 143
    # 140 Attn 出的 MODEL 喂 126 Guider.model(母体 127→134→126 链)

    link_id = 500
    nodes_by_id = {n["id"]: n for n in canvas["nodes"]}
    # 清空所有节点的 link 引用(重新连接)
    for n in canvas["nodes"]:
        for i in n.get("inputs") or []:
            i["link"] = None
        for o in n.get("outputs") or []:
            o["links"] = []
    canvas["links"] = []
    # 直接写边:每条 EDGES(origin,oslot,target,tname,type)→追加 inputs 槽(如缺)+写 links
    for origin, oslot, target, tname, ltype in EDGES:
        tgt = nodes_by_id.get(target)
        src = nodes_by_id.get(origin)
        if not tgt or not src:
            continue
        # 找/造 target 槽(按名匹配;子图节点 inputs 用 UUID 槽名时按序追加)
        slot = next((i for i in tgt.get("inputs") or [] if i.get("name") == tname), None)
        if slot is None:
            slot = {"name": tname, "type": ltype, "link": None}
            tgt.setdefault("inputs", []).append(slot)
        if slot.get("link") is not None:
            continue
        link_id += 1
        canvas["links"].append([link_id, origin, oslot, target, len(tgt["inputs"]) - 1, ltype])
        slot["link"] = link_id
        if not src.get("outputs"):
            src["outputs"] = [{"name": tname.upper(), "type": ltype, "links": []}]
        while len(src["outputs"]) <= oslot:
            src["outputs"].append({"name": "OUT", "type": ltype, "links": []})
        src["outputs"][oslot]["links"] = [*(src["outputs"][oslot].get("links") or []), link_id]
    canvas["last_link_id"] = link_id

    # note 节点
    canvas["nodes"].append({
        "id": 101, "type": "MarkdownNote", "pos": [-500, -600], "size": [400, 300],
        "flags": {}, "order": 101, "mode": 0,
        "widgets_values": ["", NOTE_MAIN],
    })
    canvas["nodes"].append({
        "id": 102, "type": "MarkdownNote", "pos": [-500, -250], "size": [400, 200],
        "flags": {}, "order": 102, "mode": 0,
        "widgets_values": ["", NOTE_ANCHORS],
    })

    # 结构自检
    got = {n["id"] for n in canvas["nodes"]}
    for must in (4, 9, 14, 20, 100, 127, 131, 134, 143):
        if must not in got:
            raise SystemExit(f"缺关键节点 {must}")
    if len(canvas["nodes"]) > 30:
        raise SystemExit(f"节点数 {len(canvas['nodes'])} 超 30,布局需精简")
    return canvas


def main() -> int:
    canvas = build_canvas()
    payload = json.dumps(canvas, ensure_ascii=False, indent=2) + "\n"
    OUT.write_text(payload, encoding="utf-8")
    FRONTEND_UI_OUT.write_text(payload, encoding="utf-8")
    print(f"[ok] repo 库 → {OUT.relative_to(REPO)}")
    print(f"[ok] 前端 bundle → {FRONTEND_UI_OUT.relative_to(REPO)}(同字节)")
    print(f"[ok] {len(canvas['nodes'])} 节点 / {len(canvas['links'])} 链;契约={SAMPLER}+6NFE+{LORA}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
