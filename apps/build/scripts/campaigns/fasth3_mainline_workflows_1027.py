#!/usr/bin/env python3
"""Windows FastH3 主线工作流生成器(10-27 windows-fasth3-mainline 阶段2,repo 工作流作者)。

母体 = apps/frontend/lib/assist/image-studio/h3-shot-template.json(31 节点单镜骨架;锚点
契约 14.value/20.value/9.image/4.filename_prefix/100 MyShot/16.width+height 直填 原样保留)。
换芯依据 = .trellis/tasks/10-27-windows-fasth3-mainline/plan.md §二 三对齐表(模型文件名唯一
契约)+ §四 W2 换芯表;官方真身 = Windows 引擎 venn 内
comfyui_workflow_templates_json/templates/video_fastvideo_fasth3_{t2v,i2v}.json(subgraph
展开)与 video_fasth3_ominiref_r2v.json(平铺),已 SSH 逐节点核实(加载器/采样/VSA widget
逐字取自官方件)。Windows 引擎 /object_info 实测补充:ModelPreviewOverrideKJ 不在册
(引擎零 custom_nodes)→ 与 W2 四删(3 SplitSigmas/41 LoRA/43 SolAttnPatch→换型/48 T8块缓存)
一并退役,模型链接官方同构重排(UNET→SigmaShift→AttentionBackend→BlockSparseAttention
→Scheduler+Guider 双喂)。

产出(幂等,重跑字节等价;引擎前端格式,画布直开):
  1. apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-i2v.json
     ——主形态:分镜 I2V/首帧锚定(9.image→16.first_frame)
  2. apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/fasth3-单镜视频-t2v.json
     ——基础版:无首帧纯文生(MiniMaxH3ImageToVideo 首帧不接,官方 t2v 同形)

可选:--object-info <Windows引擎 /object_info JSON 路径> 重建契约测试夹具
tests/fixtures/fasth3_object_info_snapshot.json(裁剪到本两件所用节点类;不传则不动夹具)。

不做实弹:本生成器纯静态产出;引擎侧装模型与实弹验收属下一阶段(计划 §五)。
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MOTHER = REPO / "apps/frontend/lib/assist/image-studio/h3-shot-template.json"
LIB_DIR = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频"
I2V_OUT = LIB_DIR / "fasth3-单镜视频-i2v.json"
T2V_OUT = LIB_DIR / "fasth3-单镜视频-t2v.json"
FIXTURE = REPO / "apps/backend/comfyui/tests/fixtures/fasth3_object_info_snapshot.json"

# ── §二 三对齐表(唯一契约:文件名逐字符对齐,引擎侧并行下载同名件)──────────────
R1_DIT = "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors"          # UNETLoader.unet_name
R2_VIDEO_VAE = "minimax_h3_video_vae_int8_convrot.safetensors"                # VAELoader(视频)
R3_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"                        # VAELoader(音频)
R4_TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"                        # CLIPLoader.clip_name(主选;R5 int8 为实弹兜底,未裁决前不入件)
FIRST_FRAME_PLACEHOLDER = "manying-shot-h3-placeholder.jpg"                   # 9.image 出厂占位(api 件同款工厂值)
FIVE_SEGMENT_PREFIX = "video/漫影/chapter-001/sb-chapter-001-001/ambient"     # 4.filename_prefix 出厂值(回收链五段前缀)

# ── 官方 FastH3 t2v/i2v 参数(逐字取自 venv 官方模板 subgraph)──────────────────
BSA_NAMED = {  # BlockSparseAttention(官方 t2v/i2v 档:start_percent=0.2;r2v 平铺件为 0,不取)
    "selection": "vsa",
    "selection.keep_percent": 10,
    "start_percent": 0.2,
    "end_percent": 1,
    "dense_blocks": "",
    "min_tokens": 12288,
    "extra_tokens": 256,
    "sink_conditioning": "exact_kv_and_rows",
    "verbose": False,
}
BSA_POSITIONAL = ["vsa", 10, 0.2, 1, "", 12288, 256, "exact_kv_and_rows", False]
CLIPLOADER_NAMED = {"clip_name": R4_TE, "type": "minimax", "device": "default"}
CLIPLOADER_POSITIONAL = [R4_TE, "minimax", "default"]
CREATEVIDEO_NAMED = {"fps": 24, "bit_depth": "auto", "color_space": "sRGB", "codec": "none"}
CREATEVIDEO_POSITIONAL = [24, "auto", "sRGB", "none"]

DELETED_NODES = (3, 17, 41, 48)  # SplitSigmas(turbo-LoRA 残构)/ModelPreviewOverrideKJ(Windows 不在册)/LoRA(蒸馏件免)/T8块缓存(官方 FastH3 未用)

# i2v 语义边(origin_id, origin_slot, target_id, target_slot, type);t2v 去掉首帧边
EDGES_I2V = [
    (21, 0, 16, 0, "CLIP"),            # CLIPLoader → 16.clip
    (7, 0, 16, 1, "VAE"),              # 视频 VAE → 16.vae
    (9, 0, 16, 2, "IMAGE"),            # LoadImage 首帧 → 16.first_frame(i2v 主形态)
    (14, 0, 16, 4, "STRING"),          # 提示词锚 14.value → 16.prompt
    (22, 0, 16, 5, "INT"),             # ResolutionSelector width → 16.width(出厂 0.2MP=608)
    (22, 1, 16, 6, "INT"),             # ResolutionSelector height → 16.height(=352)
    (23, 1, 16, 7, "INT"),             # 帧数吸附 → 16.length(5s→124)
    (20, 0, 23, 0, "FLOAT"),           # 20.value 秒 → ComfyMathExpression
    (37, 0, 26, 0, "NOISE"),
    (33, 0, 26, 1, "GUIDER"),
    (29, 0, 26, 2, "SAMPLER"),
    (8, 0, 26, 3, "SIGMAS"),           # 官方直连(SplitSigmas 已删)
    (16, 1, 26, 4, "LATENT"),
    (16, 0, 33, 1, "CONDITIONING"),
    (34, 0, 42, 0, "MODEL"),           # UNET → SigmaShift(官方 287)
    (42, 0, 40, 0, "MODEL"),           # SigmaShift → AttentionBackend(官方 288)
    (40, 0, 43, 0, "MODEL"),           # AttentionBackend → VSA(官方 249)
    (43, 0, 8, 0, "MODEL"),            # VSA → BasicScheduler.model(官方 285)
    (43, 0, 33, 0, "MODEL"),           # VSA → BasicGuider.model(官方 286)
    (26, 1, 6, 0, "LATENT"),
    (26, 1, 2, 0, "LATENT"),
    (7, 0, 6, 1, "VAE"),
    (13, 0, 2, 1, "VAE"),
    (6, 0, 36, 0, "IMAGE"),
    (2, 0, 36, 1, "AUDIO"),
    (36, 0, 4, 0, "VIDEO"),
]

NOTE_MODELS = (
    "Guide: [Subgraph](https://docs.comfy.org/interface/features/subgraph)\n"
    "\n## Model Links(Windows FastH3 主线;文件名=10-27 三对齐表逐字契约,引擎按文件名枚举加载)\n"
    "\n**diffusion_models**\n"
    "\n- [fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors]"
    "(https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy/resolve/main/diffusion_models/"
    "fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors)"
    "(FastVideo FastH3 8-Step V2 int8;22,128,378,696B)\n"
    "\n**text_encoders**\n"
    "\n- [qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors]"
    "(https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/"
    "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors)"
    "(主选,nvfp4 档;4060Ti=Ada 兼容性实弹裁决,兜底=int8_convrot 档 27.1GB 走 ModelScope,"
    "裁决前不入件——换件只改本节点 clip_name)\n"
    "\n**vae**\n"
    "\n- [minimax_h3_video_vae_int8_convrot.safetensors]"
    "(https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master/vae/"
    "minimax_h3_video_vae_int8_convrot.safetensors)"
    "(int8,解码约 2x 快;2,811,065,184B)\n"
    "- [minimax_h3_audio_vae_fp32.safetensors]"
    "(https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master/vae/"
    "minimax_h3_audio_vae_fp32.safetensors)"
    "(同步音频唯一档;605,254,808B)"
)

NOTE_SWAPS = (
    "## Windows FastH3 主线(10-27 换芯;母体=31 节点自研单镜骨架,锚点契约不动)\n"
    "\n相对原版 H3 线的换芯清单(依据=官方 video_fastvideo_fasth3_{t2v,i2v} 模板逐节点核实):\n"
    "- DiT:minimax_h3_fl2va_pruned_bf16 + turbo 4step LoRA → FastVideo FastH3 8-Step V2 int8"
    "(蒸馏自带 8 步,LoRA 节点删)\n"
    "- TE:CLIPLoaderGGUF(heretic GGUF)→ CLIPLoader(type=minimax,nvfp4 主选)\n"
    "- 视频 VAE:fp16 → int8_convrot;音频 VAE 不变(fp32)\n"
    "- 采样:euler → res_multistep;SigmaShift [12,3] → [10,3];步数 4 → 8(simple,denoise 1.0);"
    "SplitSigmas[4] 属 turbo-LoRA 残构,删(调度器直连采样器)\n"
    "- 注意力:pytorch → comfy kitchen attention(INT8 量化注意力,N/A 卡;"
    "comfy-kitchen 0.2.40 已在引擎 venv)\n"
    "- 加速:SolAttnPatch + T8块缓存 → BlockSparseAttention(VSA,keep_percent=10,"
    "12288/256/exact_kv_and_rows,start 0.2;VSA 权重要求=FastH3 专用);T8 块缓存删(保守零变量)\n"
    "- 预览:ModelPreviewOverrideKJ 删(Windows 引擎零 custom_nodes,object_info 实测不在册)\n"
    "- 模型链:UNET → SigmaShift → AttentionBackend → VSA →(Scheduler+Guider 双喂,"
    "官方 t2v/i2v 同构;原 34→8 直连旧线废除)\n"
    "\n出厂档=480p 档 608x352 / 124 帧(5s 吸附)/ 8 步;960P 档=1344x768"
    "(档位真源=H3_RESOLUTION_TIERS,16.width/16.height 由 22/23 链路覆写)。\n"
    "本件为入库参照真源,尚未实弹(引擎侧装模型中;实弹验收=下一阶段)。"
)

NOTE_USAGE_I2V = (
    "## 漫影自研单镜 H3(FastH3 主线 · 首帧锚定)\n"
    "\n- 首帧使用全尺寸关键帧,提示词节点由组装器注入。\n"
    "- ambient 默认保留环境声与画内声;full 写入中文台词;bare 仅保留最小声场。\n"
    "- 点击 Queue 即可出片。\n"
    "- 视频产物位于 output/video/漫影/{chapterId}/{shotId}/{policy}。"
)
NOTE_USAGE_T2V = (
    "## 漫影自研单镜 H3(FastH3 基础版 · 无首帧纯文生)\n"
    "\n- 与 i2v 主形态同骨架,仅不接首帧(MiniMaxH3ImageToVideo 首帧空置,官方 t2v 同形);"
    "提示词节点由组装器注入。\n"
    "- ambient 默认保留环境声与画内声;full 写入中文台词;bare 仅保留最小声场。\n"
    "- 点击 Queue 即可出片。\n"
    "- 视频产物位于 output/video/漫影/{chapterId}/{shotId}/{policy}。"
)

# t2v 版提示词样例清理(<Picture N> 指代依赖首帧输入,纯文生形态须去除;逐处精确替换)
T2V_PROMPT_SWAPS = (
    (
        "资产角色：\n<Picture 1>\n写实古风女子,面容、五官、发型体态与参考图中的女子完全一致,身份以参考图为准,全程不得改变:",
        "资产角色：\n写实古风女子,全程不得改变:",
    ),
    (
        "<Picture 2>\n与首帧参考图中完全相同的同一位女子、同一张面容、同一副松挽乌发,全身赤裸的末状态:",
        "同一位女子、同一张面容、同一副松挽乌发,全身赤裸的末状态:",
    ),
    (
        "A slow close-up frames\n<Picture 1>\n中这位与参考图完全一致的女子执扇半掩面立于溪石之上",
        "A slow close-up frames\n这位女子执扇半掩面立于溪石之上",
    ),
    ("薄雾、溪流与远山背景与首帧完全一致。", "薄雾、溪流与远山背景贯穿全片一致。"),
    ("holds on\n<Picture 2>\n的末状态:与首帧同一人,", "holds on\n的末状态:同一人,"),
)

SNAPSHOT_CLASSES = [
    "VAEDecodeAudio", "SaveVideo", "VAEDecode", "VAELoader", "BasicScheduler", "LoadImage",
    "MiniMaxH3ImageToVideo", "PrimitiveFloat", "CLIPLoader", "ResolutionSelector",
    "ComfyMathExpression", "SamplerCustomAdvanced", "KSamplerSelect", "BasicGuider",
    "UNETLoader", "CreateVideo", "RandomNoise", "ModelAttentionBackend",
    "MiniMaxH3SigmaShift", "BlockSparseAttention", "PrimitiveStringMultiline", "MyShot",
]


def node_by_id(wf: dict, nid: int) -> dict:
    got = [n for n in wf["nodes"] if n["id"] == nid]
    assert len(got) == 1, f"node {nid} not unique in mother"
    return got[0]


def set_widgets(node: dict, named: dict, positional: list) -> None:
    node["widgets_values_named"] = named
    node["widgets_values"] = positional


def clone_combo_input(entry: dict, name: str) -> dict:
    new = copy.deepcopy(entry)
    new["localized_name"] = name
    new["name"] = name
    new["widget"] = {"name": name}
    new["link"] = None
    return new


def set_models_prop(node: dict, name: str, url: str, directory: str) -> None:
    """properties.models(前端模型下载元数据)与三对齐表对齐,旧线 URL 一并清换。"""
    props = dict(node.get("properties") or {})
    props["models"] = [{"name": name, "url": url, "directory": directory}]
    node["properties"] = props


def apply_core_swap(wf: dict) -> None:
    """节点级换芯(删除/换型/widget 双形态改写);连线由 rebuild_links 统一重排。"""
    # 删除节点(幂等:先滤)
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in DELETED_NODES]
    # 'preview' 组覆盖的 17 已删,组随之退役
    wf["groups"] = [g for g in wf.get("groups", []) if g.get("title") != "preview"]

    n7 = node_by_id(wf, 7)   # 视频 VAE → R2
    set_widgets(n7, {"vae_name": R2_VIDEO_VAE}, [R2_VIDEO_VAE])
    set_models_prop(n7, R2_VIDEO_VAE,
                    "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/vae/"
                    + R2_VIDEO_VAE, "vae")
    n8 = node_by_id(wf, 8)   # simple 8 步 denoise 1.0
    set_widgets(n8, {"scheduler": "simple", "steps": 8, "denoise": 1}, ["simple", 8, 1])
    n16 = node_by_id(wf, 16)  # 出厂档 608x352/124(22/23 链路运行时覆写)
    set_widgets(n16, {"prompt": "", "width": 608, "height": 352, "length": 124}, ["", 608, 352, 124])
    n22 = node_by_id(wf, 22)  # 480p 档 = 0.2MP(608x352)
    set_widgets(n22, {"aspect_ratio": "16:9 (Widescreen)", "megapixels": 0.2, "multiple": 32},
                ["16:9 (Widescreen)", 0.2, 32])
    n29 = node_by_id(wf, 29)  # res_multistep
    set_widgets(n29, {"sampler_name": "res_multistep"}, ["res_multistep"])
    n34 = node_by_id(wf, 34)  # DiT → R1
    set_widgets(n34, {"unet_name": R1_DIT, "weight_dtype": "default"}, [R1_DIT, "default"])
    set_models_prop(n34, R1_DIT,
                    "https://huggingface.co/FastVideo/FastVideo-FastH3-Comfy/resolve/main/"
                    "diffusion_models/" + R1_DIT, "diffusion_models")
    n40 = node_by_id(wf, 40)  # kitchen INT8 注意力
    set_widgets(n40, {"attention": "comfy kitchen attention"}, ["comfy kitchen attention"])
    n42 = node_by_id(wf, 42)  # SigmaShift [10,3]
    set_widgets(n42, {"shift_video": 10, "shift_audio": 3}, [10, 3])

    # 21 CLIPLoaderGGUF → CLIPLoader(官方 socket 形:clip_name/type/device 三 widget 输入)
    n21 = node_by_id(wf, 21)
    n21["type"] = "CLIPLoader"
    n21["properties"] = {"Node name for S&R": "CLIPLoader"}
    set_models_prop(n21, R4_TE,
                    "https://huggingface.co/Comfy-Org/MiniMax-H3/resolve/main/text_encoders/"
                    + R4_TE, "text_encoders")
    clip_entries = [e for e in n21["inputs"] if e["name"] == "clip_name"]
    assert clip_entries, "mother 21 lost clip_name entry"
    n21["inputs"] = [copy.deepcopy(clip_entries[0]),
                     clone_combo_input(clip_entries[0], "type"),
                     clone_combo_input(clip_entries[0], "device")]
    set_widgets(n21, CLIPLOADER_NAMED, CLIPLOADER_POSITIONAL)

    # 43 SolAttnPatch → BlockSparseAttention(官方 socket 形:仅 model 输入/MODEL 输出)
    n43 = node_by_id(wf, 43)
    model_entries = [e for e in n43["inputs"] if e["name"] == "model"]
    assert model_entries, "mother 43 lost model entry"
    n43["type"] = "BlockSparseAttention"
    n43["title"] = "VSA 稀疏注意力 · FastH3"
    n43["properties"] = {"Node name for S&R": "BlockSparseAttention"}
    n43["inputs"] = [copy.deepcopy(model_entries[0])]
    n43["outputs"] = [{"localized_name": "模型", "name": "MODEL", "type": "MODEL",
                       "slot_index": 0, "links": []}]
    n43["size"] = [330, 300]
    set_widgets(n43, BSA_NAMED, BSA_POSITIONAL)

    # 36 CreateVideo → 官方 FastH3 档(fps24/bit_depth auto/sRGB/codec none)
    n36 = node_by_id(wf, 36)
    cs_entries = [e for e in n36["inputs"] if e["name"] == "color_space"]
    assert cs_entries, "mother 36 lost color_space entry"
    n36["inputs"] = n36["inputs"] + [clone_combo_input(cs_entries[0], "codec")]
    set_widgets(n36, CREATEVIDEO_NAMED, CREATEVIDEO_POSITIONAL)

    # 9 首帧占位(母体 named/positional 两形态不一致,统一为 api 工厂值)
    n9 = node_by_id(wf, 9)
    set_widgets(n9, {"image": FIRST_FRAME_PLACEHOLDER, "upload": "image"},
                [FIRST_FRAME_PLACEHOLDER, "image"])

    # 说明 Note 重写(31=模型链接/47=换芯说明;32 尺寸表通用保留;101 随形态微调)
    n31 = node_by_id(wf, 31)
    set_widgets(n31, {"text": NOTE_MODELS}, [NOTE_MODELS])
    n47 = node_by_id(wf, 47)
    set_widgets(n47, {"text": NOTE_SWAPS}, [NOTE_SWAPS])


def set_note101(wf: dict, text: str) -> None:
    n101 = node_by_id(wf, 101)
    set_widgets(n101, {"text": text}, [text])


def rebuild_links(wf: dict, edges: list) -> None:
    """按语义边全量重排 links,并同步每个节点 inputs[].link / outputs[].links。"""
    links = []
    by_target: dict[tuple[int, int], int] = {}
    by_origin: dict[tuple[int, int], list[int]] = {}
    for i, (o, os_, t, ts, typ) in enumerate(edges, start=1):
        links.append([i, o, os_, t, ts, typ])
        by_target[(t, ts)] = i
        by_origin.setdefault((o, os_), []).append(i)
    for node in wf["nodes"]:
        for entry in node.get("inputs", []):
            if "link" in entry:
                entry["link"] = by_target.get((node["id"], _slot_index(node, entry, "in")))
        for entry in node.get("outputs", []):
            if "links" in entry:
                entry["links"] = by_origin.get((node["id"], _slot_index(node, entry, "out")), [])
    wf["links"] = links
    wf["last_link_id"] = len(links)


def _slot_index(node: dict, entry: dict, direction: str) -> int:
    key = "inputs" if direction == "in" else "outputs"
    return [e["name"] for e in node.get(key, [])].index(entry["name"])


def build(first_frame: bool, note101: str, prompt_swaps: tuple = ()) -> dict:
    wf = json.loads(MOTHER.read_text(encoding="utf-8"))
    apply_core_swap(wf)
    edges = list(EDGES_I2V)
    if first_frame:
        n9 = node_by_id(wf, 9)
        assert n9["type"] == "LoadImage"
    else:
        wf["nodes"] = [n for n in wf["nodes"] if n["id"] != 9]
        edges = [e for e in edges if e[0] != 9]
        n14 = node_by_id(wf, 14)
        prompt = n14["widgets_values_named"]["value"]
        for old, new in prompt_swaps:
            assert prompt.count(old) == 1, f"t2v prompt swap miss: {old[:40]!r}"
            prompt = prompt.replace(old, new)
        assert "<Picture" not in prompt and "首帧" not in prompt, "t2v prompt still frame-anchored"
        set_widgets(n14, {"value": prompt}, [prompt])
    set_note101(wf, note101)
    rebuild_links(wf, edges)
    wf["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL,
                              f"mystudio:fasth3-shot:{'i2v' if first_frame else 't2v'}:1027"))
    wf["revision"] = 0
    _self_check(wf, first_frame)
    return wf


def _self_check(wf: dict, first_frame: bool) -> None:
    ids = {n["id"] for n in wf["nodes"]}
    expected = {2, 4, 6, 7, 8, 13, 14, 16, 20, 21, 22, 23, 26, 29, 31, 32, 33, 34, 36, 37,
                40, 42, 43, 47, 100, 101} | ({9} if first_frame else set())
    assert ids == expected, f"node set drift: {ids ^ expected}"
    assert not ids & set(DELETED_NODES)
    types = {n["type"] for n in wf["nodes"]}
    for banned in ("CLIPLoaderGGUF", "SolAttnPatch", "MiniMaxH3BlockCacheT8", "SplitSigmas",
                   "LoraLoaderModelOnly", "ModelPreviewOverrideKJ"):
        assert banned not in types, banned
    # 旧线残留名只查执行节点(widgets/properties/sockets);MarkdownNote 是说明文档,
    # 允许记述换芯前的旧值。
    executable = json.dumps([n for n in wf["nodes"] if n["type"] != "MarkdownNote"],
                            ensure_ascii=False)
    for stale in ("minimax_h3_fl2va", "Qwen3-VL-32B-Ultra-Heretic", "turbo_4step",
                  "video_vae_fp16", "omniref"):
        assert stale not in executable, stale
    blob = json.dumps(wf, ensure_ascii=False)
    for contract in (R1_DIT, R2_VIDEO_VAE, R3_AUDIO_VAE, R4_TE, FIVE_SEGMENT_PREFIX):
        assert contract in blob, contract
    assert len(wf["links"]) == (26 if first_frame else 25)


def write_fixture(object_info_path: Path) -> None:
    src = json.loads(object_info_path.read_text(encoding="utf-8"))
    missing = [c for c in SNAPSHOT_CLASSES if c not in src]
    assert not missing, f"engine object_info missing classes: {missing}"
    trimmed = {c: src[c] for c in SNAPSHOT_CLASSES}
    FIXTURE.write_text(json.dumps(trimmed, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"fixture rebuilt: {FIXTURE} ({FIXTURE.stat().st_size}B, {len(trimmed)} classes)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--object-info", type=Path, default=None,
                        help="Windows 引擎 /object_info JSON 路径(给出则重建测试夹具)")
    opts = parser.parse_args()
    if opts.object_info:
        write_fixture(opts.object_info)

    outputs = [
        (I2V_OUT, build(first_frame=True, note101=NOTE_USAGE_I2V)),
        (T2V_OUT, build(first_frame=False, note101=NOTE_USAGE_T2V, prompt_swaps=T2V_PROMPT_SWAPS)),
    ]
    for path, wf in outputs:
        path.write_text(json.dumps(wf, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"wrote {path.relative_to(REPO)} ({path.stat().st_size}B, "
              f"{len(wf['nodes'])} nodes/{len(wf['links'])} links)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
