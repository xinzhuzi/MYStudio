#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一镜到底-分段.json 全链三采扩展手术(11-14-multiseg-full-3stage)。

真源:.trellis/tasks/11-14-multiseg-full-3stage/prd.md(节点表 23 新节点逐值/结构规则)。
嫁接参数快照:同目录 三采-单镜.json(参考只读;契约测试钉本件自己的值)。

手术内容:
  现件 12 节点(34/41/21/7/13/100/101/6/2/102/36/4,p1 链原样)基础上新增 23 节点:
  二采精修链 1021/1033/3011/3021/3022/3030/3031/3040/3041/3042/3043/3044/3001/3002/3003/
  3051/3052/3053/3071(1440×832)与三采超分链 4000/4001/4002/4003(×2→2880×1664,
  出厂旁路 mode=4,文件交接两发正典)。段B LoadVideo 出厂空串占位。

用法:
  python3 apps/build/scripts/multiseg_full3stage_extend.py            # 执行手术(幂等,重跑零 diff)
  python3 apps/build/scripts/multiseg_full3stage_extend.py --verify   # 只读校验(结构三面/组框/布局/出厂自洽/段B 旁路)
  python3 apps/build/scripts/multiseg_full3stage_extend.py --emit-api # 导出段A/段B API 存档(确定性摊平,禁 wf2api)

硬契约:主验命令恒为 --verify;无参=执行手术。
图构造函数(build_full3stage_graph / build_stageA_api / build_stageB_api)与文件 IO 分离
——判决门脚本 multiseg_full3stage_livefire.py import 复用,禁复制两份真源。
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
WF_PATH = REPO_ROOT / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json"
API_DIR = REPO_ROOT / ".trellis/tasks/11-14-multiseg-full-3stage/research/api"

# ---------------------------------------------------------------------------
# 出厂常量(PRD 节点表逐值;雷#14:3030 与 100 同文)
# ---------------------------------------------------------------------------
FACTORY_PROMPT = (
    "段1:1秒\n[Shot 1] 中景，固定机位。一位穿深蓝色长袍的年轻剑修站在竹林小径上，微微抬头看向竹梢，"
    "晨光从竹叶缝隙洒落，竹叶轻晃。\n\n段2:1秒\n[Shot 1] 他收回视线，抬手把拂过肩头的竹叶轻轻拨开，"
    "衣袖摆动，沿小径继续向前走去。\n\noverall_soundscape: 清晨竹林鸟鸣，风吹竹叶沙沙声，脚步踩在落叶上的轻响"
)
FACTORY_TOTAL_FRAMES = 56      # 帧数公式 2×1秒@24fps → [22,34] → 56(复核定谳⑨)
STAGE2_LENGTH = 56            # 出厂=56;判决门 2×5秒=243 由 livefire 覆写
P2_PREFIX = "video/H3/分段视频/p2-final"
P3_PREFIX = "video/H3/分段视频/p3-recavsr"

STAGE_B_IDS = (4000, 4001, 4002, 4003)   # 段B 子图(出厂旁路;两发正典见 PRD 段B 执行语义)
ORIGINAL_IDS = (34, 41, 21, 7, 13, 100, 101, 6, 2, 102, 36, 4)

# 组框(五组横排,PRD 结构规则;MarkdownNote 9999 恒居组外)
GROUPS = [
    ("① 加载模型",   [34, 41, 1021, 1033, 21, 7, 13], "#884466"),
    ("② 一采分段(H3底模+pika Turbo 8步·960×544)", [100, 101],          "#3f789e"),
    ("③ 一采直出",   [6, 2, 102, 36, 4],              "#448844"),
    ("④ 二采精修(TaoMate LoRA 3步·1440×832)",
     [3001, 3002, 3003, 3011, 3021, 3022, 3030, 3031,
      3040, 3041, 3042, 3043, 3044, 3051, 3052, 3053, 3071], "#aa6600"),
    ("⑤ 三采超分(ReCaVSR scale2·2880×1664)", list(STAGE_B_IDS),        "#335588"),
]

# 布局表(pos 由手绘平面性分析定稿;layout_check est 宪法全绿为验收门)
LAYOUT: dict[int, tuple[float, float]] = {
    2: (3635, 2815),
4: (4755, 2280),
6: (3320, 1375),
7: (80, 1020),
13: (80, 1360),
21: (140, 725),
34: (80, 80),
36: (4695, 1960),
41: (1805, 665),
100: (235, 2500),
101: (2250, 2620),
102: (3985, 1450),
1021: (245, 360),
1033: (1345, 140),
3001: (5195, 5735),
3002: (5490, 5225),
3003: (6730, 7685),
3011: (5420, 230),
3021: (5610, 935),
3022: (7385, 875),
3030: (5780, 4635),
3031: (5835, 3195),
3040: (7285, 110),
3041: (7425, 2000),
3042: (6640, 330),
3043: (8345, 630),
3044: (6345, 80),
3051: (8620, 2590),
3052: (8535, 5985),
3053: (9280, 3100),
3071: (9525, 3520),
4000: (10100, 920),
4001: (10145, 280),
4002: (11095, 2300),
4003: (11280, 80),
9999: (100, 6200),
}
# 新节点 size(w,h);旧 12 节点沿用现件声明 size
SIZES: dict[int, tuple[float, float]] = {
    1021: (320, 200), 1033: (270, 358), 3011: (300, 148), 3021: (266, 148),
    3022: (315, 118), 3030: (420, 300), 3031: (400, 622), 3040: (315, 118),
    3041: (308, 178), 3042: (360, 112), 3043: (250, 184), 3044: (300, 118),
    3001: (287, 112), 3002: (287, 406), 3003: (287, 112),
    3051: (250, 112), 3052: (250, 112), 3053: (270, 202), 3071: (360, 468),
    4000: (340, 150), 4001: (270, 118), 4002: (270, 430), 4003: (270, 468),
    9999: (1650, 950),
}

README_NOTE = (
    "# 一镜到底-分段 · 全链三采(1114 用户裁定「都过三采」)\n\n"
    "## 件用途\n分段生成(一采,绕 15s 封顶)→ 二采 TaoMate 精修(1440×832)→ 三采 ReCaVSR 超分"
    "(2880×1664 终档)。与 三采-单镜.json 分工:单镜 ≤15s 高质线 / 本件任意时长全梯线。\n\n"
    "## 两发操作手册(段B 执行语义;雷#15/#16)\n"
    "段A(一二采):段B 四节点(4000-4003)保持旁路,整图一发即出 p1(960×544)+p2(1440×832)。\n"
    "段B(三采):**禁止与段A 同发**(LoadVideo 可能在 p2 落盘前执行=时序赌局)。UI 手工=首跑段B 旁路出 p1/p2 →"
    "激活段B 四节点+4000 填 p2 注解名(`video/H3/分段视频/p2-final_00001_.mp4 [output]` 形;落盘名=前缀_五位计数_尾下划线,nodes_video.py:199)→"
    "**选中段B 节点局部执行**(不得整图重跑:一采缓存可命中但二采重烧不可接受);API 正典=两发+间中 "
    "`POST /free {\"unload_models\": true}`(先例 sancai stageBGraph)。\n\n"
    "## 同步点三则(手改必读)\n1. 改分段时长必须按帧数公式同步 [3031].length(targets→snap17 网格→Σnew,"
    "出厂 2×1秒=56),实跑以 p1 ffprobe 实测帧数双核对(雷#13/#17);\n2. [3030] 与 [100] 提示词是两份拷贝,"
    "手改同频(雷#14,契约测试出厂态断言同文);\n3. 组框五组横排与布局 est 宪法由 "
    "`apps/build/scripts/multiseg_full3stage_extend.py --verify` 把门,改版后整体重跑(雷#7)。\n\n"
    "## 模型/配方速查\n二采=Cobijada 扇出 taomate@0.7+sol-attn τ1.3+σshift[12,3]+kitchen+lcm+simple/3步/dn0.2"
    "(UP 定谳);三采=ReCaVSR scale2 int8 ConvRot。seed=42 复现。"
)


# ---------------------------------------------------------------------------
# 节点构造(PRD 节点表逐值)
# ---------------------------------------------------------------------------
def _node(nid: int, ntype: str, widgets, inputs=None, outputs=None, mode: int = 0,
          title: str | None = None) -> dict:
    n = {
        "id": nid, "type": ntype, "pos": list(LAYOUT[nid]), "size": list(SIZES[nid]),
        "flags": {}, "order": 0, "mode": mode,
        "inputs": copy.deepcopy(inputs or []), "outputs": copy.deepcopy(outputs or []),
        "properties": {"Node name for S&R": ntype},
        "widgets_values": copy.deepcopy(widgets),
    }
    if title:
        n["title"] = title
    return n


def _in(name: str, itype: str, link=None, widget: str | None = None, label: str | None = None,
        shape: int | None = None):
    e = {"name": name, "type": itype, "link": link}
    if widget:
        e["widget"] = {"name": widget}
    if label:
        e["label"] = label
    if shape is not None:
        e["shape"] = shape
    return e


def _out(name: str, otype: str, links=None):
    return {"name": name, "type": otype, "links": list(links) if links else []}


# 新连线表:link id 自 15 起(PRD 结构规则;15..45 共 31 条)
# (lid, src, sslot, dst, dslot, type)
NEW_LINKS: list[tuple[int, int, int, int, int, str]] = [
    # 模型链:34 扇出 → 1021 → 1033 → 3011 → 3021 → {3041, 3044} → 3042
    (15, 34, 0, 1021, 0, "MODEL"),
    (16, 1021, 0, 1033, 0, "MODEL"),
    (17, 1033, 0, 3011, 0, "MODEL"),
    (18, 3011, 0, 3021, 0, "MODEL"),
    (19, 3021, 0, 3041, 0, "MODEL"),
    (20, 3021, 0, 3044, 0, "MODEL"),
    (21, 3044, 0, 3042, 0, "MODEL"),
    (22, 3031, 0, 3042, 1, "CONDITIONING"),
    # 3031 条件:clip/vae/audio_vae 复用 21/7/13;prompt←3030(独立原语,复核定谳⑤)
    (23, 21, 0, 3031, 0, "CLIP"),
    (24, 7, 0, 3031, 1, "VAE"),
    (25, 13, 0, 3031, 2, "VAE"),
    (26, 3030, 0, 3031, 3, "STRING"),
    # 3043 五口
    (27, 3040, 0, 3043, 0, "NOISE"),
    (28, 3022, 0, 3043, 2, "SAMPLER"),
    (29, 3041, 0, 3043, 3, "SIGMAS"),
    (30, 3042, 0, 3043, 1, "GUIDER"),
    (35, 3003, 0, 3043, 4, "LATENT"),
    # 二采 latent 链:101.slot1(denoised)→3001 分离→3002 放大→3003 回拼(音轨直通)
    (31, 101, 1, 3001, 0, "LATENT"),
    (32, 3001, 0, 3002, 0, "LATENT"),
    (33, 3001, 1, 3003, 1, "LATENT"),
    (34, 3002, 0, 3003, 0, "LATENT"),
    # 二采解码:3043→{3051,3052}→3053→3071;VAE 复用 7/13
    (36, 3043, 0, 3051, 0, "LATENT"),
    (37, 3043, 0, 3052, 0, "LATENT"),
    (38, 7, 0, 3051, 1, "VAE"),
    (39, 13, 0, 3052, 1, "VAE"),
    (40, 3051, 0, 3053, 0, "IMAGE"),
    (41, 3052, 0, 3053, 1, "AUDIO"),
    (42, 3053, 0, 3071, 0, "VIDEO"),
    # 段B 三采(出厂旁路;文件交接,不与段A 同发)
    (43, 4001, 0, 4002, 0, "RECAVSR"),
    (44, 4000, 0, 4002, 1, "VIDEO"),
    (45, 4002, 0, 4003, 0, "VIDEO"),
]


def _new_nodes() -> list[dict]:
    nodes = [
        _node(1021, "LoraLoaderModelOnly", ["taomate_h3_3step.safetensors", 0.7],
              inputs=[_in("model", "MODEL", 15)],
              outputs=[_out("MODEL", "MODEL", [16])],
              title="TaoMate 3步 LoRA(吃统一底模扇出)"),
        _node(1033, "BlockSparseAttention",
              ["sol-attn", 1.3, 0, 1, "", 12288, 256, "exact_kv_and_rows", False],
              inputs=[_in("model", "MODEL", 16)],
              outputs=[_out("model", "MODEL", [17])],
              title="sol-attn τ1.3(二采)"),
        _node(3011, "MiniMaxChunkFeedForward", [1, 4096],
              inputs=[_in("model", "MODEL", 17)],
              outputs=[_out("model", "MODEL", [18])],
              title="H3 Chunk FFN(削峰·出厂 chunks=1 恒等)"),
        _node(3021, "MiniMaxH3SigmaShift", [12, 3],
              inputs=[_in("model", "MODEL", 18)],
              outputs=[_out("MODEL", "MODEL", [19, 20])],
              title="Sigma Shift"),
        _node(3022, "KSamplerSelect", ["lcm"],
              outputs=[_out("SAMPLER", "SAMPLER", [28])]),
        _node(3030, "PrimitiveStringMultiline", [FACTORY_PROMPT],
              inputs=[_in("value", "STRING", None, widget="value")],
              outputs=[_out("STRING", "STRING", [26])],
              title="二采提示词(与 [100] 同频,雷#14)"),
        _node(3031, "MiniMaxH3ReferenceToVideo",
              ["", 1440, 832, STAGE2_LENGTH, "match"],
              inputs=[_in("clip", "CLIP", 23), _in("vae", "VAE", 24, shape=7),
                      _in("audio_vae", "VAE", 25, shape=7),
                      _in("prompt", "STRING", 26, widget="prompt"),
                      _in("width", "INT", None, widget="width"),
                      _in("height", "INT", None, widget="height"),
                      _in("length", "INT", None, widget="length")],
              outputs=[_out("positive", "CONDITIONING", [22]), _out("LATENT", "LATENT", [])],
              title="二采条件(零参考纯文生;ref_image_size 出厂 match)"),
        _node(3040, "RandomNoise", [42, "fixed"],
              outputs=[_out("NOISE", "NOISE", [27])]),
        _node(3041, "BasicScheduler", ["simple", 3, 0.2],
              inputs=[_in("model", "MODEL", 19)],
              outputs=[_out("SIGMAS", "SIGMAS", [29])],
              title="调度 simple/3步/dn0.2"),
        _node(3042, "BasicGuider", [],
              inputs=[_in("model", "MODEL", 21), _in("conditioning", "CONDITIONING", 22)],
              outputs=[_out("GUIDER", "GUIDER", [30])]),
        _node(3044, "ModelAttentionBackend", ["comfy kitchen attention"],
              inputs=[_in("model", "MODEL", 20)],
              outputs=[_out("MODEL", "MODEL", [21])]),
        _node(3001, "LTXVSeparateAVLatent", [],
              inputs=[_in("av_latent", "LATENT", 31, label="av_latent")],
              outputs=[_out("video_latent", "LATENT", [32], ), _out("audio_latent", "LATENT", [33])],
              title="分离音视频 Latent"),
        _node(3002, "MinimaxH3LatentUpscaler3D",
              ["minimax_h3_latent_upscaler_3d_bf16.safetensors", "target dimensions",
               1440, 832, 32, True, True, "cuda", "fp16"],
              inputs=[_in("latent", "*", 32),
                      _in("mode.width", "INT", None, widget="mode.width"),
                      _in("mode.height", "INT", None, widget="mode.height")],
              outputs=[_out("latent", "*", [34])],
              title="Latent 放大→1440×832"),
        _node(3003, "LTXVConcatAVLatent", [],
              inputs=[_in("video_latent", "LATENT", 34, label="video_latent"),
                      _in("audio_latent", "LATENT", 33, label="audio_latent")],
              outputs=[_out("latent", "LATENT", [35])],
              title="合并音视频 Latent"),
        _node(3043, "SamplerCustomAdvanced", [],
              inputs=[_in("noise", "NOISE", 27), _in("guider", "GUIDER", 30),
                      _in("sampler", "SAMPLER", 28), _in("sigmas", "SIGMAS", 29),
                      _in("latent_image", "LATENT", 35)],
              outputs=[_out("output", "LATENT", [36, 37]),
                       _out("denoised_output", "LATENT", [])],
              title="二采采样"),
        _node(3051, "VAEDecode", [],
              inputs=[_in("samples", "LATENT", 36), _in("vae", "VAE", 38)],
              outputs=[_out("IMAGE", "IMAGE", [40])]),
        _node(3052, "VAEDecodeAudio", [],
              inputs=[_in("samples", "LATENT", 37), _in("vae", "VAE", 39)],
              outputs=[_out("AUDIO", "AUDIO", [41])]),
        _node(3053, "CreateVideo", [24, 8, "sRGB"],
              inputs=[_in("images", "IMAGE", 40), _in("audio", "AUDIO", 41, shape=7)],
              outputs=[_out("VIDEO", "VIDEO", [42])]),
        _node(3071, "SaveVideo", [P2_PREFIX, "auto", "auto", "auto"],
              inputs=[_in("video", "VIDEO", 42)],
              outputs=[],
              title="p2 长片(1440×832;段B 走文件交接)"),
        # —— 段B 三采(出厂 mode=4 旁路)——
        _node(4000, "LoadVideo", ["", "image"],
              outputs=[_out("VIDEO", "VIDEO", [44])], mode=4,
              title="段B 源=段A p2 注解名(激活后填;两发正典)"),
        _node(4001, "ReCaVSRLoader", ["transformer_int8_convrot.safetensors"],
              outputs=[_out("model", "RECAVSR", [43])], mode=4),
        _node(4002, "ReCaVSRUpscale",
              [2, "none", 42, "fixed", "flashdecoder", "fast", False, "auto", 30],
              inputs=[_in("model", "RECAVSR", 43), _in("video", "VIDEO", 44),
                      _in("images", "IMAGE", None), _in("vae", "VAE", None)],
              outputs=[_out("VIDEO", "VIDEO", [45])], mode=4),
        _node(4003, "SaveVideo", [P3_PREFIX, "auto", "auto", "auto"],
              inputs=[_in("video", "VIDEO", 45)],
              outputs=[], mode=4,
              title="p3 终档(2880×1664)"),
        _node(9999, "MarkdownNote", [README_NOTE], title="README(恒居组外)"),
    ]
    return nodes


# ---------------------------------------------------------------------------
# 图装配(纯函数;文件 IO 与构造分离——livefire import 复用)
# ---------------------------------------------------------------------------
ORIGINAL_LINKS_MAX = 14   # 现件 links 1-14 原样保留


def _fanout_patch(nodes_by_id: dict[int, dict]) -> None:
    """旧节点扇出登记(三面一致:links 表/inputs[].link/outputs[].links)。"""
    nodes_by_id[34]["outputs"][0]["links"] = [1, 15]                 # MODEL → 41, 1021
    nodes_by_id[21]["outputs"][0]["links"] = [3, 23]                 # CLIP → 101, 3031
    nodes_by_id[7]["outputs"][0]["links"] = [4, 8, 24, 38]           # VAE → 101, 6, 3031, 3051
    nodes_by_id[13]["outputs"][0]["links"] = [5, 10, 25, 39]         # VAE → 101, 2, 3031, 3052
    nodes_by_id[101]["outputs"][1]["links"] = [31]                   # denoised_latent → 3001


def build_full3stage_graph(base: dict) -> dict:
    """现件(base 含 12 旧节点)→ 术后全链三采图。幂等:重跑(喂术后件)产出逐字节一致。"""
    base_nodes = {n["id"]: n for n in base["nodes"]}
    missing = [i for i in ORIGINAL_IDS if i not in base_nodes]
    if missing:
        raise SystemExit(f"基件缺旧锚节点: {missing}")
    originals = [copy.deepcopy(base_nodes[i]) for i in ORIGINAL_IDS]
    for n in originals:
        n["pos"] = list(LAYOUT[n["id"]])          # 全图重排(PRD 结构规则:旧 12 节点 pos 一并重排)
        n.setdefault("size", list(SIZES.get(n["id"], [320, 200])))
    new_nodes = _new_nodes()
    by_id = {n["id"]: n for n in originals + new_nodes}
    _fanout_patch(by_id)

    old_links = [list(l) for l in base["links"] if l[0] <= ORIGINAL_LINKS_MAX]
    links = sorted(old_links + [list(l) for l in NEW_LINKS], key=lambda l: l[0])

    ordered = originals + [n for n in new_nodes]
    ordered.sort(key=lambda n: n["id"])
    for i, n in enumerate(ordered):
        n["order"] = i

    groups = []
    for gi, (title, member_ids, color) in enumerate(GROUPS):
        mem = [by_id[i] for i in member_ids]
        x0 = min(m["pos"][0] for m in mem); y0 = min(m["pos"][1] for m in mem)
        x1 = max(m["pos"][0] + m["size"][0] for m in mem)
        y1 = max(m["pos"][1] + m["size"][1] for m in mem)
        groups.append({"id": 10 + gi, "title": title,
                       "bounding": [round(x0 - 30), round(y0 - 60), round(x1 - x0 + 60), round(y1 - y0 + 60)],
                       "color": color, "flags": {}, "order": gi})

    return {
        "id": base.get("id", "h3-autocontext-multiseg"),
        "revision": base.get("revision", 1),
        "last_node_id": 4003,
        "last_link_id": links[-1][0],
        "nodes": ordered,
        "links": links,
        "groups": groups,
        "config": base.get("config", {}),
        "extra": base.get("extra", {}),
        "version": base.get("version", 0.4),
    }


# ---------------------------------------------------------------------------
# API 导出(确定性摊平:widgets→inputs 按本件已知结构;禁 wf2api,雷#4)
# ---------------------------------------------------------------------------
_WIDGET_KEYS: dict[str, list[str]] = {
    "UNETLoader": ["unet_name", "weight_dtype"],
    "LoraLoaderModelOnly": ["lora_name", "strength_model"],
    "CLIPLoader": ["clip_name", "type"],
    "VAELoader": ["vae_name"],
    "H3Parameter": ["long_prompt", "clip_mode", "clip_tag", "prompt_format", "crop_mode",
                    "ref_sync_mode", "width", "height", "total_frames", "fps", "chunk_frames",
                    "context_frames", "lock_audio", "audio_drive", "video_guide",
                    "semantic_bridge", "semantic_bridge_adapter", "semantic_bridge_alpha",
                    "semantic_bridge_magnitude"],
    "H3AutoContextSampler": ["video_context_denoise", "seed", "steps", "cfg", "sampler_name",
                             "scheduler", "denoise", "enable_cache", "clear_cache",
                             "ignore_latent_hash"],
    "H3SeamCorrection": ["fix_color_preset", "fix_motion_preset", "fix_flash", "flash_threshold",
                         "cut_threshold", "blend_frames", "use_gpu"],
    "CreateVideo": ["fps", "bit_depth", "color_space"],
    "SaveVideo": ["filename_prefix", "format", "format.codec", "codec"],
    "BlockSparseAttention": ["selection", "selection.tau", "start_percent", "end_percent",
                             "dense_blocks", "min_tokens", "extra_tokens", "sink_conditioning",
                             "verbose"],
    "MiniMaxChunkFeedForward": ["chunks", "seq_threshold"],
    "MiniMaxH3SigmaShift": ["shift_video", "shift_audio"],
    "KSamplerSelect": ["sampler_name"],
    "PrimitiveStringMultiline": ["value"],
    "MiniMaxH3ReferenceToVideo": [None, "width", "height", "length", "ref_image_size"],  # w[0]=prompt 占位(链接喂)
    "RandomNoise": ["noise_seed", "control_after_generate"],
    "BasicScheduler": ["scheduler", "steps", "denoise"],
    "ModelAttentionBackend": ["attention"],
    "MinimaxH3LatentUpscaler3D": ["model_name", "mode", "mode.width", "mode.height", "align",
                                  "enable_temporal_chunking", "force_unload", "device",
                                  "precision"],
    "LoadVideo": ["file"],
    "ReCaVSRLoader": ["transformer"],
    "ReCaVSRUpscale": ["scale", "color_fix", "seed", "control_after_generate", "decoder",
                       "kernels", "kv_offload", "encoder", "fps"],
}
# 零 widget 的类型(VAEDecode/VAEDecodeAudio/BasicGuider/LTXV*/SamplerCustomAdvanced)

_LINK_SLOT_KEYS: dict[int, dict[int, str]] = {   # node_id -> {input_slot: api_key} 全部按名直映
    101: {0: "model", 1: "clip", 2: "vae", 3: "audio_vae", 4: "parameter"},
}


def _api_node(node: dict, links_by_target: dict[int, tuple[int, int]]) -> dict:
    ntype = node["type"]
    inputs: dict = {}
    for slot, entry in enumerate(node.get("inputs", [])):
        lid = entry.get("link")
        if lid is not None:
            src, sslot = links_by_target[lid]
            key = _LINK_SLOT_KEYS.get(node["id"], {}).get(slot, entry["name"])
            inputs[key] = [str(src), sslot]
    wkeys = _WIDGET_KEYS.get(ntype, [])
    wvals = node.get("widgets_values") or []
    for i, key in enumerate(wkeys):
        if key is None:
            continue                       # 占位(链接喂值的 widget)
        if i < len(wvals):
            inputs[key] = copy.deepcopy(wvals[i])
    return {"class_type": ntype, "inputs": inputs}


def build_stageA_api(graph: dict) -> dict:
    """段A prompt=全链图剔除段B 四节点(API 形;两发正典)。"""
    links_by_target = {l[0]: (l[1], l[2]) for l in graph["links"]}
    out = {}
    for n in graph["nodes"]:
        if n["id"] in STAGE_B_IDS or n["type"] == "MarkdownNote":
            continue
        out[str(n["id"])] = _api_node(n, links_by_target)
    return out


def build_stageB_api(graph: dict, source_file: str = "") -> dict:
    """段B prompt=仅 4000/4001/4002/4003 子图;4000.file 出厂空串,livefire 回填 p2 注解名。"""
    links_by_target = {l[0]: (l[1], l[2]) for l in graph["links"]}
    out = {}
    for n in graph["nodes"]:
        if n["id"] not in STAGE_B_IDS:
            continue
        entry = _api_node(n, links_by_target)
        if n["id"] == 4000:
            entry["inputs"]["file"] = source_file
        out[str(n["id"])] = entry
    return out


# ---------------------------------------------------------------------------
# --verify(只读校验;门=结构三面/组框/布局 est 宪法/出厂自洽/段B 出厂旁路/锚点)
# ---------------------------------------------------------------------------
_IMAGE_PREVIEW_TYPES = {"SaveImage", "LoadImage", "SaveVideo", "PreviewVideo"}
NEW_NODE_TYPES = {
    1021: "LoraLoaderModelOnly", 1033: "BlockSparseAttention", 3011: "MiniMaxChunkFeedForward",
    3021: "MiniMaxH3SigmaShift", 3022: "KSamplerSelect", 3030: "PrimitiveStringMultiline",
    3031: "MiniMaxH3ReferenceToVideo", 3040: "RandomNoise", 3041: "BasicScheduler",
    3042: "BasicGuider", 3043: "SamplerCustomAdvanced", 3044: "ModelAttentionBackend",
    3001: "LTXVSeparateAVLatent", 3002: "MinimaxH3LatentUpscaler3D", 3003: "LTXVConcatAVLatent",
    3051: "VAEDecode", 3052: "VAEDecodeAudio", 3053: "CreateVideo", 3071: "SaveVideo",
    4000: "LoadVideo", 4001: "ReCaVSRLoader", 4002: "ReCaVSRUpscale", 4003: "SaveVideo",
}


def _est_size(n: dict) -> tuple[float, float]:
    rows = max(len(n.get("inputs", [])), len(n.get("outputs", [])))
    h = 36 + rows * 24 + len(n.get("widgets_values") or []) * 30 + 28
    if n["type"] in _IMAGE_PREVIEW_TYPES:
        h += 260
    w, sh = 250.0, 0.0
    sz = n.get("size") or []
    try:
        w = max(w, float(sz[0]))
        sh = float(sz[1])
    except (IndexError, TypeError, ValueError):
        pass
    return w, max(h, sh)


def verify_graph(d: dict) -> list[str]:
    problems: list[str] = []
    nodes = {n["id"]: n for n in d["nodes"]}
    links = {l[0]: l for l in d["links"]}

    # ① 锚点与新节点类型
    for nid, ntype in NEW_NODE_TYPES.items():
        if nid not in nodes:
            problems.append(f"缺新节点 [{nid}]")
        elif nodes[nid]["type"] != ntype:
            problems.append(f"[{nid}] 应为 {ntype},现 {nodes[nid]['type']}")
    if 9999 not in nodes or nodes[9999]["type"] != "MarkdownNote":
        problems.append("缺 [9999] MarkdownNote README")

    # ② 结构三面零悬空(links 表 ↔ inputs[].link ↔ outputs[].links)
    for l in d["links"]:
        lid, s, ss, t, ts, _t = l
        if s not in nodes or t not in nodes:
            problems.append(f"link {lid} 端点悬空")
            continue
        if nodes[t]["inputs"][ts]["link"] != lid:
            problems.append(f"link {lid} 目标端未登记")
        if lid not in (nodes[s]["outputs"][ss].get("links") or []):
            problems.append(f"link {lid} 源端未登记")
    link_ids = set(links)
    for nid, n in nodes.items():
        for o in n.get("outputs", []):
            for lid in (o.get("links") or []):
                if lid not in link_ids:
                    problems.append(f"[{nid}] 输出槽 {o.get('name')} 悬空登记 {lid}")
        for i in n.get("inputs", []):
            if i.get("link") is not None and i["link"] not in link_ids:
                problems.append(f"[{nid}] 输入槽 {i['name']} 悬空登记 {i.get('link')}")

    # ③ p1 链原样(slot0 双扇出 [6]/[2];36→4 直连)
    p1_expected = {7: (101, 0, 6, 0), 9: (101, 0, 2, 0), 8: (7, 0, 6, 1), 10: (13, 0, 2, 1),
                   11: (6, 0, 102, 0), 12: (102, 0, 36, 0), 13: (2, 0, 36, 1), 14: (36, 0, 4, 0)}
    for lid, (s, ss, t, ts) in p1_expected.items():
        l = links.get(lid)
        if not l or (l[1], l[2], l[3], l[4]) != (s, ss, t, ts):
            problems.append(f"p1 链 link {lid} 漂移: 期望 {s}.{ss}→{t}.{ts}")

    # ④ 出厂自洽四元组(100 提示词/total=56/3031.length/3030 同文)
    w100 = nodes[100]["widgets_values"]
    w3030 = nodes[3030]["widgets_values"]
    w3031 = nodes[3031]["widgets_values"]
    if w100[0] != w3030[0]:
        problems.append("出厂同文破约: [3030] ≠ [100] 提示词(雷#14)")
    if w100[8] != FACTORY_TOTAL_FRAMES or w3031[3] != FACTORY_TOTAL_FRAMES:
        problems.append(f"出厂帧数四元组破约: 100.total={w100[8]} / 3031.length={w3031[3]} 应均 56")
    if "段1:1秒" not in w100[0] or w100[0].count("段1:1秒") != 1 or "段2:1秒" not in w100[0]:
        problems.append("出厂提示词缺 2×1秒 时长标签")

    # ⑤ 段B 出厂旁路
    for nid in STAGE_B_IDS:
        if nodes[nid].get("mode") != 4:
            problems.append(f"[{nid}] 出厂应旁路 mode=4(雷#15)")
    if nodes[4000]["widgets_values"][0] != "":
        problems.append("[4000] 出厂 file 应空串占位")
    if nodes[4002]["outputs"][0]["links"] != [45]:
        problems.append("[4002]→[4003] 接线漂移")

    # ⑥ 布局 est 宪法(零负区/零左向/est 零重叠/同排≥200/同列≥80;判据=layout_check)
    for nid, n in nodes.items():
        if n["pos"][0] < 80 or n["pos"][1] < 80:
            problems.append(f"[{nid}] 负区 pos={n['pos']}")
    for l in d["links"]:
        if nodes[l[3]]["pos"][0] <= nodes[l[1]]["pos"][0]:
            problems.append(f"link {l[0]} 左向 [{l[1]}]→[{l[3]}]")
    boxes = {nid: (n["pos"][0], n["pos"][1], *_est_size(n)) for nid, n in nodes.items()}
    ids = list(boxes)
    for i in range(len(ids)):
        ax0, ay0, aw, ah = boxes[ids[i]]
        for j in range(i + 1, len(ids)):
            bx0, by0, bw, bh = boxes[ids[j]]
            xov = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
            yov = min(ay0 + ah, by0 + bh) - max(ay0, by0)
            if xov > 0 and yov > 0:
                problems.append(f"est 重叠 [{ids[i]}]×[{ids[j]}]")
            elif yov > 0 and xov <= 0 and -xov < 200:
                problems.append(f"同排间距 {(-xov):.0f}<200 [{ids[i]}]×[{ids[j]}]")
            elif xov > 0 and yov <= 0 and -yov < 80:
                problems.append(f"同列间距 {(-yov):.0f}<80 [{ids[i]}]×[{ids[j]}]")

    # ⑦ 组框:五组横排/两两不交/罩全(Note 豁免)
    gs = d["groups"]
    if len(gs) != 5:
        problems.append(f"应五组横排,现 {len(gs)} 组")
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            if a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]:
                problems.append(f"组框相交: {gs[i]['title']} × {gs[j]['title']}")
    for g in gs:
        if g["bounding"][2] <= 0 or g["bounding"][3] <= 0:
            problems.append(f"组 [{g['title']}] 尺寸非正")
    for nid, n in nodes.items():
        if n["type"] == "MarkdownNote":
            continue
        nx, ny = n["pos"]
        if not any(g["bounding"][0] <= nx and g["bounding"][1] <= ny
                   and nx < g["bounding"][0] + g["bounding"][2]
                   and ny < g["bounding"][1] + g["bounding"][3] for g in gs):
            problems.append(f"[{nid}] 不在任何组框内(罩全红线)")

    # ⑧ 计数器
    if d["last_node_id"] != 4003:
        problems.append(f"last_node_id={d['last_node_id']} 应 4003")
    if d["last_link_id"] != 45:
        problems.append(f"last_link_id={d['last_link_id']} 应 45(14+31)")
    return problems


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="一镜到底-分段 全链三采手术(幂等)")
    ap.add_argument("--verify", action="store_true", help="只读校验(不写盘)")
    ap.add_argument("--emit-api", action="store_true",
                    help="导出段A/段B API 存档到 research/api/{stageA,stageB}.json")
    args = ap.parse_args(argv)

    base = json.loads(WF_PATH.read_text(encoding="utf-8"))
    graph = build_full3stage_graph(base)

    if args.emit_api:
        API_DIR.mkdir(parents=True, exist_ok=True)
        (API_DIR / "stageA.json").write_text(
            json.dumps(build_stageA_api(graph), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        (API_DIR / "stageB.json").write_text(
            json.dumps(build_stageB_api(graph), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8")
        print(f"API 存档已导出: {API_DIR}/stageA.json, stageB.json")

    if not args.verify:
        before = WF_PATH.read_text(encoding="utf-8") if WF_PATH.exists() else ""
        text = json.dumps(graph, ensure_ascii=False, indent=2) + "\n"
        if text != before:
            WF_PATH.write_text(text, encoding="utf-8")
            print(f"手术完成: {WF_PATH} ({len(graph['nodes'])} 节点 / {len(graph['links'])} 连线 / 5 组)")
        else:
            print("幂等无 diff(件已是术后态)")

    problems = verify_graph(graph)
    if problems:
        print(f"❌ {len(problems)} 项问题:")
        for p in problems[:40]:
            print("  -", p)
        return 1
    print(f"✅ verify 全绿({len(graph['nodes'])} 节点 {len(graph['links'])} 连线;三面/组框/est 宪法/出厂自洽/段B 旁路)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
