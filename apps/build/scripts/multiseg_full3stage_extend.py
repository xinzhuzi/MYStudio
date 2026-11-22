#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一镜到底-分段.json 全链三采扩展手术(11-14-multiseg-full-3stage)。

真源:.trellis/tasks/11-14-multiseg-full-3stage/prd.md(节点表 23 新节点逐值/结构规则)。
嫁接参数快照:同目录 单镜.json(参考只读;契约测试钉本件自己的值)。

手术内容:
  现件 12 节点(34/41/21/7/13/100/101/6/2/102/36/4,p1 链原样)基础上新增 23 节点:
  二采精修链 1021/1033/3011/3021/3022/3030/3031/3041/3042/3043/3044/3001/3002/3003/
  3051/3052/3053/3071(1440×832)与三采超分链 4001/4002/4003(scale2.667→3840×2220 4K,
  出厂激活 mode=0——1122 用户裁定解旁路,整图一发直出 p1/p2/p3;内联接线,无 4000)。

用法:
  python3 apps/build/scripts/multiseg_full3stage_extend.py            # 执行手术(幂等,重跑零 diff)
  python3 apps/build/scripts/multiseg_full3stage_extend.py --verify   # 只读校验(结构三面/组框/布局/出厂自洽/段B 出厂激活)
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

STAGE_B_IDS = (4001, 4002, 4003)   # 段B 三采(1122 解旁路:出厂激活 mode=0,4002.video←3053 直连,整图一发直出 p1/p2/p3)
ORIGINAL_IDS = (34, 41, 21, 7, 13, 100, 101, 6, 2, 102, 36, 4)

# 组框(五组横排,PRD 结构规则;MarkdownNote 9999 恒居组外)
GROUPS = [
    ("① 加载模型",   [34, 41, 1046, 1021, 1033, 21, 7, 13], "#884466"),
    ("⑥ 一采正典臂(turbo+lcm+sol-attn+ChunkFFN+kitchen+σshift[6,3])",
     [1041, 1042, 1043, 1044, 1045], "#5f8788"),
    ("② 一采分段(H3底模+pika Turbo 8步·960×544)", [100, 101],          "#3f789e"),
    ("③ 一采直出",   [6, 2, 102, 36, 4],              "#448844"),
    ("④ 二采精修(TaoMate LoRA 3步·1440×832)",
     [3001, 3002, 3003, 3011, 3021, 3022, 3030, 3031,
      3040, 3041, 3042, 3043, 3044, 3051, 3052, 3053, 3071], "#aa6600"),
    ("⑤ 三采超分(ReCaVSR scale2.667·3840×2220)", list(STAGE_B_IDS),      "#335588"),
]

# 布局种子(pos=平面性分析序;经 _compact_layout 压缩到紧凑档节奏后落盘——
# 1115 用户观感令「节点间隔太大/线条要横向」:紧凑档启用,est 宪法下限恒硬门)
LAYOUT: dict[int, tuple[float, float]] = {
    # ── 1115 分层行重排(五组横排带式;polish 真判据首轮收敛态烘焙=全程最优:
    #    crossings 36/占地 3150(-58%)/线遮 3 处按家族正典现值入档)
    # 走廊:顶廊(21/7/13→3031);中廊(7→3051/13→3052);101→3001 横线;模型低廊 y~2400
    21: (80, 80), 7: (80, 380), 13: (80, 720),      # 7 微调(贪心:避 7→3051×6)
    34: (80, 1040), 41: (630, 1040),
    1021: (630, 2400), 1033: (1180, 2400),               # 模型低廊下沉(1033→3011 走 100 新位下方)
    1041: (1180, 2900), 1042: (1680, 2900),                       # 一采正典臂低廊(两排;随低廊下沉)
    1043: (1690, 3200), 1044: (2220, 3200), 1045: (2230, 3600),    # 二排+尾阶梯(pos 恒<101.x=2330)
    1046: (1130, 880),                                             # 一采 lcm(贪心终位:三线净空)
    101: (2330, 900), 100: (1680, 1490),                 # 100 沉位(13→2 线走上净空,1033→3011 低廊走下)
    6: (2960, 600), 2: (2960, 1800), 102: (3510, 1030),          # 6 上提:7→6 馈线走 101 上净空
    36: (4100, 1200), 4: (4650, 1400),
    3031: (5900, 80), 3030: (5250, 380),
    3001: (5400, 1060), 3002: (5900, 1060), 3003: (5980, 1800),   # 3002 右移上提(音轨直通 3001→3003 走其下方)
    3022: (7120, 80), 3040: (7120, 320),
    3051: (8190, 900), 3052: (8190, 1100),
    3053: (8670, 680), 3071: (9170, 1000),
    3011: (5250, 2400), 3021: (5900, 2400), 3044: (6530, 2400),
    3042: (7120, 2400), 3041: (7120, 2700), 3043: (7710, 2200),
    4001: (9760, 800), 4002: (10260, 1000), 4003: (10760, 1000),
    9999: (5250, 3000),                                          # README(④带下方,让位臂低廊)
}
# 新节点 size(w,h);旧 12 节点沿用现件声明 size
SIZES: dict[int, tuple[float, float]] = {
    1041: (270, 358), 1042: (300, 148), 1043: (300, 118), 1044: (266, 148),
    1045: (308, 178), 1046: (315, 118),
    1021: (320, 200), 1033: (270, 358), 3011: (300, 148), 3021: (266, 148),
    3022: (315, 118), 3030: (420, 300), 3031: (400, 622), 3040: (315, 118),
    3041: (308, 178), 3042: (360, 112), 3043: (250, 184), 3044: (300, 118),
    3001: (287, 112), 3002: (287, 406), 3003: (287, 112),
    3051: (250, 112), 3052: (250, 112), 3053: (270, 202), 3071: (360, 468),
    4001: (270, 118), 4002: (270, 430), 4003: (270, 468),
    9999: (1650, 950),
}

README_NOTE = (
    "# 一镜到底-分段 · 全链三采(1114 用户裁定「都过三采」)\n\n"
    "## 件用途\n分段生成(一采,绕 15s 封顶)→ 二采 TaoMate 精修(1440×832)→ 三采 ReCaVSR 超分"
    "(3840×2220 终档)。与 单镜.json 分工:单镜 ≤15s 高质线 / 本件任意时长全梯线。\n\n"
    "## 操作手册(1122 裁定:整图一发直跑)\n"
    "Run 一按直出 p1(960×544)/p2(1440×832)/p3(3840×2220 4K)+p-final 终档(1065 开关控修脸)。\n"
    "史鉴:1115 整图一发含段B 曾原生崩引擎(当时 mode=4 全链驻留下 ReCaVSR 上卡,日志 17:04:42 零 traceback)"
    "而立两步法;1118 起 1066 LowVRAM+ChunkFFN 削峰已改变显存格局,1122 用户裁定解旁路(mode 4→0)恢复整图一发,"
    "两态实弹复判绿(判据档 apps/output/multiseg-mode0-oneshot-1122/livefire-summary.json:A 态 1065=false 150s"
    " 四产物齐·p-final≡p3 md5 逐字节直通;B 态 1065=true 200s·p-final≢p3=修脸臂实吃 4002 出片;两态均"
    " p3/p-final=3840×2220/24fps/56帧);若再崩,回退 mode=4 须用户再裁。\n"
    "App 派发/批量/livefire 恒走 API 两发拆链+间中 `POST /free {\"unload_models\": true}`(Note103 运行法则,"
    "显存纪律与 UI 整图一发并行不悖)。\n\n"
    "## 同步点三则(手改必读)\n1. 改分段时长必须按帧数公式同步 [3031].length(targets→snap17 网格→Σnew,"
    "出厂 2×1秒=56),实跑以 p1 ffprobe 实测帧数双核对(雷#13/#17);\n2. [3030] 与 [100] 提示词是两份拷贝,"
    "手改同频(雷#14,契约测试出厂态断言同文);\n3. 组框五组横排与布局 est 宪法由 "
    "`apps/build/scripts/multiseg_full3stage_extend.py --verify` 把门,改版后整体重跑(雷#7)。\n\n"
    "## 模型/配方速查(1115 B3 定谳)\n一采=**正典全配方臂**:turbo@1.0+sol-attn τ1.3+ChunkFFN[2]+kitchen+"
    "σshift[**6,3**]+**lcm**+simple/8(Pika 必须 lcm=全库正典;裸 euler 已废,B3 实弹 p1 胜/p2 平);"
    "二采=taomate@0.7+sol-attn τ1.3+σshift[12,3]+kitchen+lcm+simple/3步/dn0.2(UP 定谳);"
    "三采=ReCaVSR scale2.667 int8 ConvRot(1122 起与单镜同款 4K 出厂)。seed=42 复现。"
    "⚠ 段缓存指纹不含外接 sampler——A/B 试验须 enable_cache=False(1115 实证)。"
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
    # 一采正典臂(1115 B3 定谳:41 turbo→sol-attn→ChunkFFN2→kitchen→σshift[6,3]→101;外接 lcm+simple/8)
    (46, 41, 0, 1041, 0, "MODEL"),
    (47, 1041, 0, 1042, 0, "MODEL"),
    (48, 1042, 0, 1043, 0, "MODEL"),
    (49, 1043, 0, 1044, 0, "MODEL"),
    (50, 1044, 0, 101, 0, "MODEL"),
    (51, 1046, 0, 101, 5, "SAMPLER"),
    (52, 1044, 0, 1045, 0, "MODEL"),
    (53, 1045, 0, 101, 6, "SIGMAS"),
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
    # 段B 三采(1115 内联正典:3053 直喂 4002,UI 整图一发直出三档;先例=单镜 UI 件 link780)
    (43, 4001, 0, 4002, 0, "RECAVSR"),
    (44, 3053, 0, 4002, 1, "VIDEO"),
    (45, 4002, 0, 4003, 0, "VIDEO"),
]


def _new_nodes() -> list[dict]:
    nodes = [
        # —— 一采正典臂(1115 B3 定谳;逐值照抄 单镜 i2v 臂 1031/1034/1041/1051/2021/2022)——
        _node(1041, "BlockSparseAttention",
              ["sol-attn", 1.3, 0, 1, "", 12288, 256, "exact_kv_and_rows", False],
              inputs=[_in("model", "MODEL", 46)],
              outputs=[_out("model", "MODEL", [47])],
              title="sol-attn τ1.3(一采正典臂)"),
        _node(1042, "MiniMaxChunkFeedForward", [2, 4096],
              inputs=[_in("model", "MODEL", 47)],
              outputs=[_out("model", "MODEL", [48])],
              title="H3 Chunk FFN(一采,chunks=2 照抄 i2v 臂)"),
        _node(1043, "ModelAttentionBackend", ["comfy kitchen attention"],
              inputs=[_in("model", "MODEL", 48)],
              outputs=[_out("MODEL", "MODEL", [49])],
              title="kitchen attention(一采)"),
        _node(1044, "MiniMaxH3SigmaShift", [6, 3],
              inputs=[_in("model", "MODEL", 49)],
              outputs=[_out("MODEL", "MODEL", [50, 52])],
              title="Sigma Shift [6,3](一采值,非二采[12,3])"),
        _node(1045, "BasicScheduler", ["simple", 8, 1.0],
              inputs=[_in("model", "MODEL", 52)],
              outputs=[_out("SIGMAS", "SIGMAS", [53])],
              title="一采 σ 源 simple/8/dn1.0"),
        _node(1046, "KSamplerSelect", ["lcm"],
              outputs=[_out("SAMPLER", "SAMPLER", [51])],
              title="lcm(一采;Pika 必须 lcm 全库正典)"),
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
        _node(3053, "CreateVideo", [24, 8, "sRGB"],   # 3 元组=实弹绿形态(chroma/codec 走引擎默认;sancai API 孪生 3053 同构)
              inputs=[_in("images", "IMAGE", 40), _in("audio", "AUDIO", 41, shape=7)],
              outputs=[_out("VIDEO", "VIDEO", [42, 44])]),
        _node(3071, "SaveVideo", [P2_PREFIX, "auto", "auto", "auto"],
              inputs=[_in("video", "VIDEO", 42)],
              outputs=[],
              title="p2 长片(1440×832)"),
        # —— 段B 三采(1122 用户裁定解旁路:出厂激活 mode=0,整图一发直出 p1/p2/p3;
        #    scale=2.667 正典=3840×2220 4K,与单镜同款)——
        _node(4001, "ReCaVSRLoader", ["transformer_int8_convrot.safetensors"],
              outputs=[_out("model", "RECAVSR", [43])]),
        _node(4002, "ReCaVSRUpscale",
              [2.667, "none", 42, "fixed", "flashdecoder", "fast", False, "auto", 30],
              inputs=[_in("model", "RECAVSR", 43), _in("video", "VIDEO", 44),
                      _in("images", "IMAGE", None), _in("vae", "VAE", None)],
              outputs=[_out("VIDEO", "VIDEO", [45])]),
        _node(4003, "SaveVideo", [P3_PREFIX, "auto", "auto", "auto"],
              inputs=[_in("video", "VIDEO", 45)],
              outputs=[],
              title="p3 终档(3840×2220)"),
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
    nodes_by_id[41]["outputs"][0]["links"] = [46]                    # MODEL → 1041(1115 正典臂,旧 2 改道)
    n101 = nodes_by_id[101]
    ins = [i for i in n101["inputs"] if i.get("name") not in ("sampler", "sigmas")]
    ins[0]["link"] = 50                                              # model ← 1044 σshift(旧直连废除)
    ins.append({"name": "sampler", "type": "SAMPLER", "link": 51})  # ← 1046 lcm(外接覆盖,README :205)
    ins.append({"name": "sigmas", "type": "SIGMAS", "link": 53})    # ← 1045 simple/8(重建式=幂等)
    nodes_by_id[21]["outputs"][0]["links"] = [3, 23]                 # CLIP → 101, 3031
    nodes_by_id[7]["outputs"][0]["links"] = [4, 8, 24, 38]           # VAE → 101, 6, 3031, 3051
    nodes_by_id[13]["outputs"][0]["links"] = [5, 10, 25, 39]         # VAE → 101, 2, 3031, 3052
    nodes_by_id[101]["outputs"][1]["links"] = [31]                   # denoised_latent → 3001


def _harvest_old_links(base: dict) -> list[list]:
    """收割旧链 1-14(除 2 改道正典臂)并归一化源端。

    1118 lowvram 役后盘面 link1/link15 源=1066(MiniMaxLowVRAMAttention 插桩改源),而重建图
    无 1066 节点——原样带入即悬空端点(verify ⑥ 对缺端点链曾无守卫直接 KeyError 崩整链;
    三面登记也破)。归一化:l[1]==1066 的旧链回指 (34, slot0)——1066 出槽 0 MODEL ≡ 34 出槽 0
    MODEL,中间态三面自洽(_fanout_patch 本就声明 34=[1,15]);随后 lowvram_dual_node_1118.py
    重跑会把 link1+link15 双双改源回 1066(anchor=34),终态与直改殊途同归。"""
    out = []
    for l in base["links"]:
        if l[0] > ORIGINAL_LINKS_MAX or l[0] == 2:   # 2(41→101)改道正典臂
            continue
        l = list(l)
        if l[1] == 1066:
            l[1] = 34
        out.append(l)
    return out


def build_full3stage_graph(base: dict) -> dict:
    """现件(base 含 12 旧节点)→ 术后全链三采图。幂等:重跑(喂术后件)产出逐字节一致。"""
    base_nodes = {n["id"]: n for n in base["nodes"]}
    missing = [i for i in ORIGINAL_IDS if i not in base_nodes]
    if missing:
        raise SystemExit(f"基件缺旧锚节点: {missing}")
    originals = [copy.deepcopy(base_nodes[i]) for i in ORIGINAL_IDS]
    for n in originals:
        n["pos"] = list(LAYOUT[n["id"]])          # 种子平面序(经 _compact_layout 压缩后落盘)
        n.setdefault("size", list(SIZES.get(n["id"], [320, 200])))
    new_nodes = _new_nodes()
    by_id = {n["id"]: n for n in originals + new_nodes}
    _fanout_patch(by_id)
    old_links = _harvest_old_links(base)
    _compact_layout(by_id, sorted(old_links + [list(l) for l in NEW_LINKS], key=lambda l: l[0]))
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
    101: {0: "model", 1: "clip", 2: "vae", 3: "audio_vae", 4: "parameter",
          5: "sampler", 6: "sigmas"},   # 1115 正典臂外接口(object_info 序:sampler 先于 sigmas)
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
    """段B prompt=仅 4001/4002/4003 子图+合成 [300] LoadVideo(零拷贝 [output] 注解名)。
    1115 起 UI 件内段B=内联正典(3053→4002);API 两发拆链仍走本出口(livefire 判决门/
    App 派发同此):内联线不进 API 形,4002.video 改吃 [300],file=source_file。"""
    links_by_target = {l[0]: (l[1], l[2]) for l in graph["links"]}
    out = {}
    for n in graph["nodes"]:
        if n["id"] not in STAGE_B_IDS:
            continue
        entry = _api_node(n, links_by_target)
        if n["id"] == 4002:
            entry["inputs"]["video"] = ["300", 0]
        out[str(n["id"])] = entry
    out["300"] = {"class_type": "LoadVideo", "inputs": {"file": source_file}}
    return out


# ---------------------------------------------------------------------------
# --verify(只读校验;门=结构三面/组框/布局 est 宪法/出厂自洽/段B 出厂旁路/锚点)
# ---------------------------------------------------------------------------
_IMAGE_PREVIEW_TYPES = {"SaveImage", "LoadImage", "SaveVideo", "PreviewVideo"}
NEW_NODE_TYPES = {
    1041: "BlockSparseAttention", 1042: "MiniMaxChunkFeedForward", 1043: "ModelAttentionBackend",
    1044: "MiniMaxH3SigmaShift", 1045: "BasicScheduler", 1046: "KSamplerSelect",
    1021: "LoraLoaderModelOnly", 1033: "BlockSparseAttention", 3011: "MiniMaxChunkFeedForward",
    3021: "MiniMaxH3SigmaShift", 3022: "KSamplerSelect", 3030: "PrimitiveStringMultiline",
    3031: "MiniMaxH3ReferenceToVideo", 3040: "RandomNoise", 3041: "BasicScheduler",
    3042: "BasicGuider", 3043: "SamplerCustomAdvanced", 3044: "ModelAttentionBackend",
    3001: "LTXVSeparateAVLatent", 3002: "MinimaxH3LatentUpscaler3D", 3003: "LTXVConcatAVLatent",
    3051: "VAEDecode", 3052: "VAEDecodeAudio", 3053: "CreateVideo", 3071: "SaveVideo",
    4001: "ReCaVSRLoader", 4002: "ReCaVSRUpscale", 4003: "SaveVideo",
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


# ---------------------------------------------------------------------------
# 紧凑化(1115 用户观感令「节点间隔太大/线条要横向」:紧凑档节奏,est 宪法下限恒硬门)
# ---------------------------------------------------------------------------
_X_GAP_CAP = 4000.0      # 轴间隙钳:相邻坐标间隙超帽即收到帽(序严格保持;1115 观感令;900=首绿档,试紧失败自动回此)
_Y_GAP_CAP = 4000.0     # y 帽(须 ≥ 最大 est 高 728+85;首绿档 1150)
_MIN_X_GAP = 205.0      # est 同排间隙下限 200+5 余量
_MIN_Y_GAP = 85.0       # est 同列间隙下限 80+5 余量


def _est_box(n: dict) -> list[float]:
    return [n["pos"][0], n["pos"][1], *_est_size(n)]


def _clamp_axis(nodes_by_id: dict[int, dict], axis: int, cap: float) -> None:
    """单调分段间隙钳:按种子序排,相邻坐标间隙 min(orig, cap);序严格不变
    ⇒ 右向/平面拓扑保持;帽只吃大空隙(间隔太大→紧凑,观感令)。"""
    order = sorted(nodes_by_id, key=lambda i: (LAYOUT[i][axis], i))
    prev = None
    for nid in order:
        pos = nodes_by_id[nid]["pos"]
        if prev is not None:
            gap = min(pos[axis] - prev[axis], cap)
            pos[axis] = prev[axis] + gap
        prev = pos


def _pair_est_repair(nodes_by_id: dict[int, dict]) -> None:
    """全对 est 终修(右推/下推小位移,不再回摆;8 轮或收敛)。"""
    for _ in range(8):
        moved = False
        boxes = {nid: _est_box(n) for nid, n in nodes_by_id.items()}
        ids = sorted(boxes)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                a, b = boxes[ids[i]], boxes[ids[j]]
                xov = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
                yov = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
                na, nb = nodes_by_id[ids[i]], nodes_by_id[ids[j]]
                if xov > 0 and yov > 0:
                    (nb if nb["pos"][1] >= na["pos"][1] else na)["pos"][1] += yov + 5
                    moved = True
                elif yov > 0 and xov <= 0 and -xov < _MIN_X_GAP:
                    # 同排:x 向实隙=-xov,补到 _MIN_X_GAP(推力恒正,右推 x 大者)
                    (nb if nb["pos"][0] >= na["pos"][0] else na)["pos"][0] += _MIN_X_GAP + xov + 5
                    moved = True
                elif xov > 0 and yov <= 0 and -yov < _MIN_Y_GAP:
                    # 同列:y 向实隙=-yov,补到 _MIN_Y_GAP(推力恒正,下推 y 大者)
                    (nb if nb["pos"][1] >= na["pos"][1] else na)["pos"][1] += _MIN_Y_GAP + yov + 5
                    moved = True
        if not moved:
            break


def _rightward_fix(nodes_by_id: dict[int, dict], links: list[list]) -> None:
    """右向安全环:修复道推位后若出现 target.x ≤ source.x(级联/纵叠形态下 est 推位可翻非重叠对),
    把 target 右推到 source+40;随后由外层再跑一轮 est 修复。"""
    for _ in range(3):
        moved = False
        for l in links:
            _, s, _ss, t, _ts, _ty = l
            if s not in nodes_by_id or t not in nodes_by_id:
                continue
            sp, tp = nodes_by_id[s]["pos"], nodes_by_id[t]["pos"]
            if tp[0] <= sp[0]:
                tp[0] = sp[0] + 40.0
                moved = True
        if not moved:
            break


def _groups_overlap(nodes_by_id: dict[int, dict]) -> bool:
    aabbs = []
    for _, ids_g, _c in GROUPS:
        mem = [_est_box(nodes_by_id[i]) for i in ids_g]
        x0 = min(m[0] for m in mem) - 30; y0 = min(m[1] for m in mem) - 60
        x1 = max(m[0] + m[2] for m in mem) + 30; y1 = max(m[1] + m[3] for m in mem) + 60
        aabbs.append((x0, y0, x1, y1))
    for i in range(len(aabbs)):
        for j in range(i + 1, len(aabbs)):
            a, b = aabbs[i], aabbs[j]
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                return True
    return False


def _seg_hits_box(p1, p2, box, margin=10.0) -> bool:
    """Liang-Barsky:线段与外扩盒是否相交。"""
    x0, y0, x1, y1 = box[0] - margin, box[1] - margin, box[0] + box[2] + margin, box[1] + box[3] + margin
    dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    t0, t1 = 0.0, 1.0
    for pp, qq in ((-dx, p1[0] - x0), (dx, x1 - p1[0]), (-dy, p1[1] - y0), (dy, y1 - p1[1])):
        if pp == 0:
            if qq < 0:
                return False
        else:
            r = qq / pp
            if pp < 0:
                if r > t1: return False
                t0 = max(t0, r)
            else:
                if r < t0: return False
                t1 = min(t1, r)
    return t0 <= t1


def _occlusion_repair(nodes_by_id: dict[int, dict], links: list[list]) -> None:
    """线遮修复(layout_check occlusion 口径近似:中芯连线×盒):遮挡块沿垂直于主线方向让线;
    推完交 _pair_est_repair 复清;4 轮或收敛。"""
    for _ in range(4):
        moved = False
        boxes = {nid: _est_box(n) for nid, n in nodes_by_id.items()}
        for l in links:
            _, s, _ss, t, _ts, _ty = l
            if s not in boxes or t not in boxes:
                continue
            sb, tb = boxes[s], boxes[t]
            p1 = (sb[0] + sb[2], sb[1] + sb[3] / 2)
            p2 = (tb[0], tb[1] + tb[3] / 2)
            for nid, bx in boxes.items():
                if nid in (s, t) or not _seg_hits_box(p1, p2, bx):
                    continue
                horiz = abs(p2[1] - p1[1]) <= abs(p2[0] - p1[0])
                if horiz:
                    cx = (bx[0] + bx[0] + bx[2]) / 2
                    frac = (cx - p1[0]) / (p2[0] - p1[0]) if p2[0] != p1[0] else 0.5
                    y_line = p1[1] + (p2[1] - p1[1]) * max(0.0, min(1.0, frac))
                    if y_line > bx[1] + bx[3] / 2 and bx[1] - (y_line - bx[1] - bx[3]) + 40 >= 80:
                        nodes_by_id[nid]["pos"][1] -= (y_line - bx[1] - bx[3]) + 40   # 上让
                    else:
                        nodes_by_id[nid]["pos"][1] += (bx[1] - y_line) + 40 if y_line < bx[1] else 40  # 下让
                else:
                    nodes_by_id[nid]["pos"][0] += 40 + bx[2] / 2
                moved = True
                boxes = {nid2: _est_box(n) for nid2, n in nodes_by_id.items()}
        if not moved:
            break


def _load_layout_check():
    """导入 node-graph 判据真模型(贝塞尔口径);缺席则返回 None(polish 道自跳过)。"""
    import importlib.util
    lc_path = REPO_ROOT / ".zcode/skills/node-graph/tools/layout_check.py"
    if not lc_path.exists():
        return None
    spec = importlib.util.spec_from_file_location("layout_check_polish", lc_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _polish(nodes_by_id: dict[int, dict], links: list[list]) -> None:
    """真判据局部搜索(确定性,首改善接受):目标=layout_check 违规加权
    (线遮 300/超帽交叉 30/其余 1000)+画布占地。1115 收敛后烘焙进 LAYOUT,
    默认跳过(秒级幂等);重优化=MULTISEG_POLISH=1 复跑(分钟级)。"""
    import os
    if os.environ.get("MULTISEG_POLISH") != "1":
        return
    lc = _load_layout_check()
    if lc is None:
        return

    ordered = sorted(nodes_by_id.values(), key=lambda n: n["order"])
    wf = {"nodes": ordered, "links": links}   # 只读判据;组框由 _groups_overlap 另把

    def score():
        s = 0.0
        for sc in lc.check_workflow(wf, max_crossings=40):
            for k, v in sc["counts"].items():
                if k == "crossings":
                    s += 30 * max(0, v - 40)
                elif k == "occlusion":
                    s += 300 * v
                elif v:
                    s += 1000 * v
        xs = [n["pos"][0] + n["size"][0] for n in ordered]
        ys = [n["pos"][1] + n["size"][1] for n in ordered]
        return s + (max(xs) + max(ys)) / 2000.0

    best = score()
    deltas = [(-0, -480), (-0, -320), (-0, -200), (-0, -120), (-0, -60), (0, 60), (0, 120), (0, 200), (0, 320), (0, 480),
              (-240, 0), (-120, 0), (120, 0), (240, 0)]
    ids = sorted(nodes_by_id)
    for _sweep in range(6):
        improved = False
        for nid in ids:
            n = nodes_by_id[nid]
            bx, by = n["pos"]
            for dx, dy in deltas:
                nx, ny = bx + dx, by + dy
                if nx < 80 or ny < 80:
                    continue
                n["pos"] = [nx, ny]
                s = score()
                if s < best - 1e-9:
                    best, bx, by, improved = s, nx, ny, True
                else:
                    n["pos"] = [bx, by]
        if not improved:
            break


def _seed_clean(nodes_by_id: dict[int, dict]) -> bool:
    """种子洁净判:管线自家 est 谓词(与 verify ⑥ 同式)零违规。"""
    boxes = {nid: _est_box(n) for nid, n in nodes_by_id.items()}
    ids = sorted(boxes)
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = boxes[ids[i]], boxes[ids[j]]
            xov = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            yov = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            if (xov > 0 and yov > 0) or (yov > 0 and xov <= 0 and -xov < _MIN_X_GAP) \
               or (xov > 0 and yov <= 0 and -yov < _MIN_Y_GAP):
                return False
    return True


def _compact_layout(nodes_by_id: dict[int, dict], links: list[list]) -> None:
    """紧凑化(1115 用户观感令「节点间隔太大/线条要横向」):
    轴间隙钳(序严格保持=右向/拓扑不破)→ 全对 est 终修 → 组框 AABB 检;
    组框咬合则帽 ×1.2 自种子重试(≤6 档),帽常量即最终观感节奏。"""
    if _seed_clean(nodes_by_id) and not _groups_overlap(nodes_by_id):
        for n in nodes_by_id.values():                      # 种子已洁净(烘焙态):原样落盘
            n["pos"] = [max(80.0, round(v)) for v in n["pos"]]
        return
    xc, yc = _X_GAP_CAP, _Y_GAP_CAP
    snapshot = {nid: list(n["pos"]) for nid, n in nodes_by_id.items()}
    for _ in range(6):
        for nid, n in nodes_by_id.items():
            n["pos"] = list(snapshot[nid])
        _clamp_axis(nodes_by_id, 0, xc)
        _clamp_axis(nodes_by_id, 1, yc)
        _pair_est_repair(nodes_by_id)
        _rightward_fix(nodes_by_id, links)
        _pair_est_repair(nodes_by_id)
        if not _groups_overlap(nodes_by_id):
            _polish(nodes_by_id, links)
            _pair_est_repair(nodes_by_id)
            _rightward_fix(nodes_by_id, links)
            if _groups_overlap(nodes_by_id):
                continue
            for n in nodes_by_id.values():
                n["pos"] = [max(80.0, round(v)) for v in n["pos"]]
            return
        xc *= 1.2
        yc *= 1.2
    raise SystemExit("紧凑化 6 档帽均组框咬合,放弃(禁出坏布局)")


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

    # ②b 一采正典臂(1115 B3):链/外接口/逐值
    arm_expect = {46: (41, 0, 1041, 0, "MODEL"), 47: (1041, 0, 1042, 0, "MODEL"),
                  48: (1042, 0, 1043, 0, "MODEL"), 49: (1043, 0, 1044, 0, "MODEL"),
                  50: (1044, 0, 101, 0, "MODEL"), 51: (1046, 0, 101, 5, "SAMPLER"),
                  52: (1044, 0, 1045, 0, "MODEL"), 53: (1045, 0, 101, 6, "SIGMAS")}
    for lid, exp in arm_expect.items():
        l = links.get(lid)
        if not l or tuple(l[1:6]) != exp:
            problems.append(f"一采臂 link {lid} 漂移: 期望 {exp}")
    if nodes[41]["outputs"][0]["links"] != [46]:
        problems.append("[41] MODEL 出线应 [46](正典臂改道,旧直连废除)")
    if nodes[1044]["widgets_values"] != [6, 3]:
        problems.append("[1044] σshift 应 [6,3](一采值)")
    if nodes[1042]["widgets_values"] != [2, 4096]:
        problems.append("[1044] ChunkFFN 应 [2,4096](照抄 i2v 臂)")
    if nodes[1046]["widgets_values"] != ["lcm"]:
        problems.append("[1046] 一采采样器应 lcm(Pika 必须 lcm 全库正典)")
    if nodes[1045]["widgets_values"] != ["simple", 8, 1.0]:
        problems.append("[1045] 一采 σ 源应 simple/8/1.0")

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

    # ⑤ 段B 出厂激活+内联接线(1122 用户裁定解旁路:mode=0,整图一发直出 p1/p2/p3)
    if 4000 in nodes:
        problems.append("[4000] LoadVideo 应不存在(内联接线正典)")
    for nid in STAGE_B_IDS:
        if nodes[nid].get("mode") != 0:
            problems.append(f"[{nid}] 出厂应激活 mode=0(1122 用户裁定解旁路,整图一发直出三档)")
    l44 = links.get(44)
    if not l44 or (l44[1], l44[2], l44[3], l44[4]) != (3053, 0, 4002, 1):
        problems.append("段B 内联接线漂移: link44 应 3053.0→4002.1")
    if nodes[3053]["outputs"][0]["links"] != [42, 44]:
        problems.append("[3053] VIDEO 扇出应 [42,44](p2 存盘+三采直喂)")
    if nodes[4002]["outputs"][0]["links"] != [45]:
        problems.append("[4002]→[4003] 接线漂移")

    # ⑥ 布局 est 宪法(零负区/零左向/est 零重叠/同排≥200/同列≥80;判据=layout_check)
    for nid, n in nodes.items():
        if n["pos"][0] < 80 or n["pos"][1] < 80:
            problems.append(f"[{nid}] 负区 pos={n['pos']}")
    for l in d["links"]:
        if l[1] not in nodes or l[3] not in nodes:
            problems.append(f"link {l[0]} 端点缺席 [{l[1]}]→[{l[3]}](悬空链,布局判据跳过)")
            continue
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
    if len(gs) != 6:
        problems.append(f"应六组横排(1115 增⑥一采正典臂),现 {len(gs)} 组")
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
    if d["last_link_id"] != 53:
        problems.append(f"last_link_id={d['last_link_id']} 应 53(14+31+8臂−1改道)")
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
    print(f"✅ verify 全绿({len(graph['nodes'])} 节点 {len(graph['links'])} 连线;三面/组框/est 宪法/出厂自洽/段B 出厂激活)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
