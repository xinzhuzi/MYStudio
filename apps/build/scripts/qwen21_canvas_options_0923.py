#!/usr/bin/env python3
"""Qwen-Image-2.1 画布三改造(09-23 深夜拍板,幂等脚本)。

三项改造(用户裁定:PE进画布 / RGBA要选项 / 道劫单独适配):

  A. qwen21-t2i.json 加「PE 提示词改写组」(默认旁路)
     PE 专用 CLIPLoader(qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16, type=qwen_image;09-23 起换
     自转 bf16 单件——int8_convrot 在 MPS 首矩阵乘即死 aten::_int_mm 无内核,转换脚本
     qwen21_pe_bf16_convert_0923.py)
     → 插件节点 QwenImage21_T2IPromptRewrite(类名逐字;参数按引擎家插件源码
     custom_nodes/ComfyUI-Qwen-Image-2.1-Prompt-Enhancer/nodes/prompt_rewrite_nodes.py
     的 INPUT_TYPES 真实字段序:prompt/temperature/top_p/top_k/presence_penalty/
     max_new_tokens/seed = 官方 T2I 硬口径 1.0/0.95/20/1.5/16256/42)
     → 核心 ComfySwitchNode(STRING)二选一 → TextEncodeQwenImage21.prompt。
     选型依据:核心 nodes_logic.py 实读,ComfySwitchNode 是 io.MatchType 泛型开关
     (官方 edit 模板在 LATENT 上用它;类型无关,STRING/CONDITIONING 皆可),且
     check_lazy_status 懒执行——switch=false 时 PE 子树不求值、PE 模型不加载,
     天然「默认旁路」。widgets 转输入的序列化口径照抄在库 Yue2 件的既有形态
     (converted widget 在 widgets_values 保留占位槽,inputs 带 widget 标记)。

  B. qwen21-t2i.json 加「RGBA 透明开关」(默认普通)
     双 TextEncodeQwenImage21 conditioning(普通 vs 官方 RGBA 包裹句式)→
     ComfySwitchNode(CONDITIONING)二选一 → KSampler.positive。与 A 共用同款
     switch 节点类型。

  C. 新建 qwen21-daojie-t2i.json(道劫风格适配版)
     以改造后 t2i 为骨架(含 PE 组与 RGBA 开关),默认直写提示词换成按官方
     PE 宪法五件套手写的道劫水墨国风修仙英文长文(锚定句/走帧 10 个句首位置
     短语/光照句/唯一总结句;道劫 DNA:水墨=ink wash 笔性=expressive brushwork
     留白=expansive negative space 国风修仙=Chinese cultivation-fantasy;
     零质量词 masterpiece/8K 一类)。

幂等性:A/B 以「图内已存在 QwenImage21_T2IPromptRewrite」为已施标记,重复运行
零改动;C 每次从当前 t2i 确定性派生,字节稳定,内容相同则不写盘。

用法:python3 apps/build/scripts/qwen21_canvas_options_0923.py(仓库根或任意 cwd)
"""
from __future__ import annotations

import copy
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]  # scripts → build → apps → 仓库根
Q21_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
T2I_PATH = Q21_DIR / "1_文生图/qwen21-t2i.json"
DAOJIE_PATH = Q21_DIR / "1_文生图/qwen21-daojie-t2i.json"

# ── 常量(契约测试互锁,改动须同步 test_qwen21_workflow_contract.py)──────
PE_CLIP_FILE = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
PE_CLASS = "QwenImage21_T2IPromptRewrite"
# QwenImage21_T2IPromptRewrite widgets_values 序(插件 INPUT_TYPES 真实字段序):
# [prompt, temperature, top_p, top_k, presence_penalty, max_new_tokens, seed]
PE_PARAMS = [1.0, 0.95, 20, 1.5, 16256, 42]
RGBA_HEAD = "This is an RGBA format image with transparency."
RGBA_TAIL = "The image has an alpha channel and a transparent background."

# ── 道劫默认直写提示词(五件套:锚定 1 句 + 走帧 12 句(10 句位置短语开头)──
# ── + 光照 1 句 + 平涂 1 句 + 唯一总结 1 句 = 16 句;DNA 词全部落位)────────
DAOJIE_PROMPT = (
    "The image is a vertical ink-wash illustration of a solitary cultivator standing "
    "on a high stone terrace, the background dissolving into pale ink washes and empty "
    "paper. In the centre of the frame, the robed figure stands full-body with weight "
    "settled on one leg, head turned three-quarters toward the viewer, hands folded "
    "behind the back around a sheathed straight sword. Along the upper edge, a ragged "
    "strip of cloud drifts in from the left corner, set down in one pass of diluted "
    "grey ink. At the lower left, the terrace breaks into a few angular rocks, their "
    "contours drawn in expressive brushwork, fine ink lines that thicken and thin as "
    "they turn. Below the figure, a narrow band of blank paper carries the eye down "
    "toward the bottom margin, reading as a cliff face swallowed by fog. To the right "
    "of the figure, a single leafless pine leans into the frame from the right edge, "
    "its trunk described in dry-brush strokes, its needles in clustered dark dabs. "
    "Behind the pine, one distant peak floats halfway up the frame, its ridge "
    "suggested by three pale wash contours and nothing more. Near the top right "
    "corner, a small flock of birds crosses the open sky, each bird a single "
    "calligraphic stroke. The figure's robe is a deep ink blue-grey with layered "
    "folds, the sleeves widening as they fall, the hem lifting slightly as if in "
    "mountain wind. Around the waist, a sash of cinnabar red gives the composition "
    "its single small accent of vivid colour within a restrained traditional palette, "
    "while a round jade pendant at the chest offers the only cool highlight against "
    "the dark cloth. The face is calm and ageless, the hair bound in a simple "
    "topknot held by a plain wooden pin. Across the middle distance, successive "
    "washes of lighter ink push the terraces back, so that near forms keep firm "
    "outlines while far forms hold only their silhouettes. Along the left margin, a "
    "tall column of untouched paper balances the lean of the pine on the right. The "
    "lighting is even and diffuse, like daylight through deep cloud, casting no hard "
    "shadows and letting every ink value read clearly. Surfaces lie in flat, "
    "unhurried washes with the faint grain of the paper showing through. The overall "
    "composition balances the dark figure against expansive negative space, holds "
    "the palette to ink greys warmed by one cinnabar accent, and carries the quiet, "
    "austere mood of a Chinese cultivation-fantasy scene on the eve of a heavenly "
    "tribulation."
)
DAOJIE_RGBA_DESC = (
    "an ink-wash illustration of a solitary cultivator standing on a cloud-wreathed "
    "stone terrace, expressive brushwork, expansive negative space, one small "
    "cinnabar accent"
)
DAOJIE_PE_SEED = "水墨国风修仙:一位修士立于云中山巅,渡劫前夜,大面积留白,一小块朱砂点题色"

# ── 句首位置短语(五件套走帧自查口径:8-10 个句首位置短语)────────────────
_POSITIONAL_OPENS = (
    "In the centre of the frame,", "Along the upper edge,", "At the lower left,",
    "Below the figure,", "To the right of the figure,", "Behind the pine,",
    "Near the top right corner,", "Around the waist,", "Across the middle distance,",
    "Along the left margin,",
)
_QUALITY_WORDS = ("masterpiece", "8k", "highly detailed", "award-winning", "best quality", "ultra detailed")

T2I_NOTE = (
    "## Qwen-Image-2.1 文生图 · 使用说明\n"
    "\n"
    "**权重三件套(bf16,MPS 主选;int8_convrot 是 CUDA 路线,Mac 不用)**\n"
    "\n"
    "- diffusion_models/qwen_image_2.1_bf16.safetensors\n"
    "- text_encoders/qwen3vl_8b_bf16.safetensors(CLIPLoader type=qwen_image)\n"
    "- vae/qwen_image_2.1_vae_bf16.safetensors\n"
    "\n"
    "### 参数圣经(官方模板 Note 要点)\n"
    "\n"
    "- **cfg 恒 1**(官方路径):cfg=1 时负向提示词不参与采样(与 K2 turbo 同款数学);只有真要用负向才抬 cfg。\n"
    "- **步数**:官方管线 40-50 步 euler,本流 25 步起手;更强采样器可更少步。\n"
    "- **分辨率**:ResolutionSelector([4])直出宽高,默认 1MP(1024×1024);原生 2K=1:1 + 4MP(2048×2048);宽高宜 32 的倍数。\n"
    "- 提示词点名参考图的语法 `<image1>`..`<image10>` 属改图流;t2i 无参考图。\n"
    "\n"
    "### PE 提示词改写组(默认旁路)\n"
    "\n"
    "- 默认:[13] 直写提示词 → [14] 开关(switch=false)→ [6] 编码;PE 组不参与出图(开关懒执行,旁路时 PE 模型不加载)。\n"
    "- **开启步骤**:①装插件 ComfyUI-Qwen-Image-2.1-Prompt-Enhancer 到 custom_nodes/;②PE 权重落 text_encoders/qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors(约 19GB,[11] 加载,type=qwen_image);③在 [12] PE改写节点写短句想法(任意语言,输出恒英文长文);④把 [14] 开关 switch 勾上(true)→ PE 自动扩写喂 [6]。presence_penalty=1.5 是 T2I 硬口径勿改。\n"
    "\n"
    "### RGBA 透明开关(默认普通)\n"
    "\n"
    "- 默认 [16] RGBA开关=false 走 [6] 普通 conditioning;透明路 [15] 是独立编码节点。\n"
    "- **开启**:把 [16] switch 勾上(true),并在 [15] 编辑官方包裹句式的中间描述:This is an RGBA format image with transparency. [your description]. The image has an alpha channel and a transparent background.\n"
    "- **透明路出图必须存 PNG 才保 alpha**(JPEG 会丢透明通道)。\n"
    "\n"
    "### 提示词起草\n"
    "\n"
    "已装技能 **qwen-image-2-1-prompter**(官方 PE 宪法封装)——起草/改写提示词时唤取它。"
)

DAOJIE_NOTE = (
    "## 道劫 · Qwen-Image-2.1 文生图(水墨国风修仙适配版)\n"
    "\n"
    "以 qwen21-t2i 为骨架的道劫风格适配首发版(09-23):同一加载器三件套/采样参数/PE 组/RGBA 开关,默认提示词换成按官方 PE 宪法五件套手写的道劫水墨英文长文([13] 直写节点)。\n"
    "\n"
    "### 道劫 DNA → 英文表述(默认直写提示词 [13])\n"
    "\n"
    "- 水墨 → ink wash / ink-wash;笔性 → expressive brushwork(fine lines that thicken and thin / dry-brush)\n"
    "- 留白 → expansive negative space;国风修仙 → Chinese cultivation-fantasy\n"
    "- 画法五要素对位:细墨线=expressive brushwork / 墨色浓淡分明=distinct ink values(pale washes receding)/ 素净底+一小块点题色=one small accent of vivid colour / 均匀柔光=even diffuse light / 平涂=flat washes\n"
    "- 全文零质量词(无 masterpiece/8K/highly detailed 一类),零比例词(分辨率走 ResolutionSelector),句首位置短语 10 个(宪法 8-14 区间)。\n"
    "\n"
    "### 与 krea2 道劫线的关系\n"
    "\n"
    "- krea2 道劫线(K2-文生图-道劫 等)= 九型底座 MyDaojieBase + 主体句装配,4 步 turbo 快产线;qwen21 道劫件 = 观察者长文直出,25 步,cfg 恒 1。\n"
    "- 两线各自独立出图;**风格终审=用户,此为适配首发版**,实拍对拍(krea2 道劫 vs qwen21 道劫)后再定产线分工(对拍计划见 docs/prompts/Qwen-Image-2.1/04-道劫风格适配.md)。\n"
    "\n"
    "### 参数圣经\n"
    "\n"
    "- **cfg 恒 1**;步数 25 起手(官方 40-50);分辨率 ResolutionSelector 默认 1MP,宽高宜 32 倍数。\n"
    "- PE 组/RGBA 开关用法同 qwen21-t2i(见其 Note);RGBA 句式原文:This is an RGBA format image with transparency. [your description]. The image has an alpha channel and a transparent background.\n"
    "- **透明路出图必须存 PNG 才保 alpha**;起草/改写提示词唤取技能 **qwen-image-2-1-prompter**。"
)

# ── A+B:qwen21-t2i.json 结构改造 ─────────────────────────────────────


def _switch_inputs(on_false_link: int, on_true_link: int, typ: str) -> list[dict]:
    """核心 ComfySwitchNode 输入槽形态(照官方 edit 模板子图内 468 号节点抄)。"""
    return [
        {"name": "on_false", "shape": 7, "type": typ, "link": on_false_link},
        {"name": "on_true", "shape": 7, "type": typ, "link": on_true_link},
        {"name": "switch", "type": "BOOLEAN", "widget": {"name": "switch"}, "link": None},
    ]


def apply_ab(graph: dict) -> dict:
    """就地改造 t2i 图:PE 组(默认旁路)+ RGBA 开关(默认普通)。"""
    nodes = {n["id"]: n for n in graph["nodes"]}
    te = nodes[6]        # TextEncodeQwenImage21 主编码
    ks = nodes[7]        # KSampler
    clip = nodes[2]      # 主 CLIPLoader
    vae = nodes[3]       # VAELoader
    note = nodes[10]     # MarkdownNote

    # 1) 主编码 prompt widget 转输入(接 PE 开关);widgets_values 保留占位槽
    #    (Yue2 在库件口径:converted widget 在 widgets_values 保留原槽位值)。
    te["inputs"].append(
        {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": 15}
    )
    te["title"] = "[6] Qwen2.1 文本编码(prompt 接 [14] 开关)"
    te["size"] = [420, 320]

    # 2) link 6 改向:TE.positive → RGBA开关.on_false(原直连 KSampler.positive)
    for link in graph["links"]:
        if link[0] == 6:
            assert link == [6, 6, 0, 7, 1, "CONDITIONING"], f"link6 形态意外: {link}"
            link[3], link[4] = 16, 0
    ks_positive = next(i for i in ks["inputs"] if i["name"] == "positive")
    ks_positive["link"] = 19

    # 3) 主 CLIP/VAE 输出登记追加 RGBA 编码消费
    clip["outputs"][0]["links"] = [3, 16]
    vae["outputs"][0]["links"] = [4, 10, 17]

    # 4) 新节点 11-16
    graph["nodes"] += [
        {
            "id": 11, "type": "CLIPLoader",
            "title": "[11] PE文本编码加载(qwen_image)",
            "pos": [-880, 1120], "size": [400, 130], "flags": {}, "order": 10, "mode": 0,
            "inputs": [
                {"name": "clip_name", "type": "COMBO", "widget": {"name": "clip_name"}, "link": None},
                {"name": "type", "type": "COMBO", "widget": {"name": "type"}, "link": None},
                {"name": "device", "type": "COMBO", "shape": 7, "widget": {"name": "device"}, "link": None},
            ],
            "outputs": [{"name": "CLIP", "type": "CLIP", "links": [12]}],
            "properties": {"Node name for S&R": "CLIPLoader"},
            "widgets_values": [PE_CLIP_FILE, "qwen_image", "default"],
        },
        {
            "id": 12, "type": PE_CLASS,
            "title": "[12] PE提示词改写(短句→英文长文,默认旁路)",
            "pos": [-420, 1120], "size": [440, 340], "flags": {}, "order": 11, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 12},
                {"name": "prompt", "type": "STRING", "widget": {"name": "prompt"}, "link": None},
                {"name": "temperature", "type": "FLOAT", "widget": {"name": "temperature"}, "link": None},
                {"name": "top_p", "type": "FLOAT", "widget": {"name": "top_p"}, "link": None},
                {"name": "top_k", "type": "INT", "widget": {"name": "top_k"}, "link": None},
                {"name": "presence_penalty", "type": "FLOAT", "widget": {"name": "presence_penalty"}, "link": None},
                {"name": "max_new_tokens", "type": "INT", "widget": {"name": "max_new_tokens"}, "link": None},
                {"name": "seed", "type": "INT", "widget": {"name": "seed"}, "link": None},
            ],
            "outputs": [
                {"name": "positive_prompt", "type": "STRING", "links": [13]},
                {"name": "negative_prompt", "type": "STRING", "links": None},
                {"name": "wh_ratio", "type": "STRING", "links": None},
                {"name": "thinking", "type": "STRING", "links": None},
                {"name": "parse_ok", "type": "BOOLEAN", "links": None},
            ],
            "properties": {"Node name for S&R": PE_CLASS},
            "widgets_values": ["", *PE_PARAMS],
        },
        {
            "id": 13, "type": "StringConstant",
            "title": "[13] 直写提示词(默认路)",
            "pos": [-880, 1500], "size": [420, 380], "flags": {}, "order": 12, "mode": 0,
            "inputs": [],
            "outputs": [{"name": "STRING", "type": "STRING", "links": [14]}],
            "properties": {"Node name for S&R": "StringConstant"},
            "widgets_values": [""],
        },
        {
            "id": 14, "type": "ComfySwitchNode",
            "title": "[14] 提示词开关(false=直写 / true=PE扩写)",
            "pos": [120, 1120], "size": [260, 120], "flags": {}, "order": 13, "mode": 0,
            "inputs": _switch_inputs(14, 13, "STRING"),
            "outputs": [{"name": "output", "type": "STRING", "links": [15]}],
            "properties": {"Node name for S&R": "ComfySwitchNode"},
            "widgets_values": [False],
        },
        {
            "id": 15, "type": "TextEncodeQwenImage21",
            "title": "[15] RGBA文本编码(透明路,默认旁路)",
            "pos": [280, 420], "size": [420, 320], "flags": {}, "order": 14, "mode": 0,
            "inputs": [
                {"name": "clip", "type": "CLIP", "link": 16},
                {"name": "images.image_1", "type": "IMAGE", "shape": 7, "link": None},
                {"name": "vae", "type": "VAE", "shape": 7, "link": 17},
            ],
            "outputs": [
                {"name": "positive", "type": "CONDITIONING", "links": [18]},
                {"name": "negative", "type": "CONDITIONING", "links": None},
                {"name": "latent", "type": "LATENT", "links": None},
            ],
            "properties": {"Node name for S&R": "TextEncodeQwenImage21"},
            "widgets_values": [f"{RGBA_HEAD} [your description]. {RGBA_TAIL}", "", 1024],
        },
        {
            "id": 16, "type": "ComfySwitchNode",
            "title": "[16] RGBA开关(false=普通 / true=透明,透明图存PNG)",
            "pos": [760, 0], "size": [260, 120], "flags": {}, "order": 15, "mode": 0,
            "inputs": _switch_inputs(6, 18, "CONDITIONING"),
            "outputs": [{"name": "output", "type": "CONDITIONING", "links": [19]}],
            "properties": {"Node name for S&R": "ComfySwitchNode"},
            "widgets_values": [False],
        },
    ]

    # 5) 新 link 12-19
    graph["links"] += [
        [12, 11, 0, 12, 0, "CLIP"],
        [13, 12, 0, 14, 1, "STRING"],
        [14, 13, 0, 14, 0, "STRING"],
        [15, 14, 0, 6, 3, "STRING"],
        [16, 2, 0, 15, 0, "CLIP"],
        [17, 3, 0, 15, 2, "VAE"],
        [18, 15, 0, 16, 1, "CONDITIONING"],
        [19, 16, 0, 7, 1, "CONDITIONING"],
    ]
    graph["last_node_id"] = 16
    graph["last_link_id"] = 19

    # 6) 分组:主链组扩高(收 RGBA 编码行),新增 PE 组
    for group in graph["groups"]:
        if group["id"] == 2:
            group["bounding"] = [-640, -140, 2980, 900]
    graph["groups"].append({
        "id": 3,
        "title": "PE 提示词改写(默认旁路,开启即自动扩写)",
        "bounding": [-900, 1100, 1300, 800],
        "color": "#a1309b",
        "flags": {},
    })

    # 7) 使用说明 Note 重写(PE/RGBA 开关用法 + 原参数圣经要点)
    note["widgets_values"] = [T2I_NOTE]
    return graph


# ── C:道劫派生(从已改造 t2i 确定性生成)───────────────────────────────

_DAOJIE_TITLES = {
    1: "[1] 道劫·UNET加载", 2: "[2] 道劫·CLIP加载(qwen_image)", 3: "[3] 道劫·VAE加载",
    4: "[4] 道劫·分辨率选择", 5: "[5] 道劫·空潜空(宽高接 [4])",
    6: "[6] 道劫·文本编码(prompt 接 [14] 开关)",
    7: "[7] 道劫·KSampler(25步·cfg1)", 8: "[8] 道劫·VAE解码", 9: "[9] 道劫·保存",
    10: "[10] 道劫·适配说明",
    11: "[11] 道劫·PE文本编码加载(qwen_image)",
    12: "[12] 道劫·PE改写(短句→英文长文,默认旁路)",
    13: "[13] 道劫·直写提示词(默认路,水墨五件套长文)",
    14: "[14] 道劫·提示词开关(false=直写 / true=PE扩写)",
    15: "[15] 道劫·RGBA编码(透明路,默认旁路)",
    16: "[16] 道劫·RGBA开关(false=普通 / true=透明,透明图存PNG)",
}
_DAOJIE_GROUPS = {
    1: "道劫·Qwen-Image-2.1 加载器(bf16 三件套)",
    2: "道劫·文生图主链(水墨国风修仙,分辨率→潜空→编码→采样→解码→保存)",
    3: "道劫·PE 提示词改写(默认旁路,开启即自动扩写)",
}


def derive_daojie(t2i_graph: dict) -> dict:
    g = copy.deepcopy(t2i_graph)
    g["id"] = "8f4c1a92-6d27-4b8e-9a15-2c7d58b0e003"
    nodes = {n["id"]: n for n in g["nodes"]}
    for nid, title in _DAOJIE_TITLES.items():
        if nid in nodes:
            nodes[nid]["title"] = title
    # 默认直写提示词 = 道劫五件套长文
    nodes[13]["widgets_values"] = [DAOJIE_PROMPT]
    # PE 改写节点的短句种子(旁路态惰性;开启 PE 时作扩写起点)
    nodes[12]["widgets_values"] = [DAOJIE_PE_SEED, *PE_PARAMS]
    # RGBA 透明路默认描述 = 道劫短版(官方包裹句式内换描述)
    nodes[15]["widgets_values"] = [f"{RGBA_HEAD} {DAOJIE_RGBA_DESC}. {RGBA_TAIL}", "", 1024]
    for group in g["groups"]:
        if group["id"] in _DAOJIE_GROUPS:
            group["title"] = _DAOJIE_GROUPS[group["id"]]
    nodes[10]["widgets_values"] = [DAOJIE_NOTE]
    return g


# ── 自查(三件套:改了什么/在哪/怎么自查——本节即机器自查)───────────────


def validate_graph(graph: dict, name: str) -> list[str]:
    errors = []
    nodes = {n["id"]: n for n in graph["nodes"]}
    # 1. link 双向一致
    for link in graph["links"]:
        lid, origin_id, origin_slot, target_id, target_slot, typ = link
        origin, target = nodes[origin_id], nodes[target_id]
        if typ != origin["outputs"][origin_slot]["type"]:
            errors.append(f"{name} link{lid}: origin 槽类型不匹配")
        if lid not in (origin["outputs"][origin_slot].get("links") or []):
            errors.append(f"{name} link{lid}: origin.outputs 未登记")
        if target["inputs"][target_slot].get("link") != lid:
            errors.append(f"{name} link{lid}: target.inputs.link 不一致")
        # 2. 横向纪律:target.x > origin.x
        if not target["pos"][0] > origin["pos"][0]:
            errors.append(f"{name} link{lid}: {origin['type']}→{target['type']} 未向右")
    # 3. groups 全带 int id
    for group in graph["groups"]:
        if not isinstance(group.get("id"), int):
            errors.append(f"{name}: group {group.get('title')!r} 缺 int id")
    # 4. 画布选项契约:PE 组默认旁路 + RGBA 默认普通
    by_type: dict[str, list[dict]] = {}
    for n in graph["nodes"]:
        by_type.setdefault(n["type"], []).append(n)
    if by_type.get(PE_CLASS):
        pe = by_type[PE_CLASS][0]
        if pe["widgets_values"][1:] != PE_PARAMS:
            errors.append(f"{name}: PE 参数漂移 {pe['widgets_values'][1:]}")
        pe_clips = [n for n in by_type.get("CLIPLoader", []) if n["widgets_values"][0] == PE_CLIP_FILE]
        if len(pe_clips) != 1 or pe_clips[0]["widgets_values"][1] != "qwen_image":
            errors.append(f"{name}: PE CLIPLoader 权重/type 不符")
    for sw in by_type.get("ComfySwitchNode", []):
        if sw["widgets_values"][0] is not False:
            errors.append(f"{name}: switch {sw['id']} 默认态非 false(应默认旁路/普通)")
    return errors


def validate_daojie_prompt(text: str) -> list[str]:
    errors = []
    sentences = [s for s in re.split(r"(?<=[.])\s+", text.strip()) if s]
    if not 15 <= len(sentences) <= 20:
        errors.append(f"道劫 prompt 句数 {len(sentences)} 不在 15-20")
    opens = sum(1 for s in sentences if any(s.startswith(p) for p in _POSITIONAL_OPENS))
    if not 8 <= opens <= 10:
        errors.append(f"道劫 prompt 句首位置短语 {opens} 个不在 8-10")
    for word in ("ink", "wash", "brushwork", "negative space", "cultivation"):
        if word not in text.lower():
            errors.append(f"道劫 prompt 缺 DNA 实词 {word!r}")
    lower = text.lower()
    for bad in _QUALITY_WORDS:
        if bad in lower:
            errors.append(f"道劫 prompt 含质量词 {bad!r}")
    if not (text.startswith("The image is a ") and "ink-wash" in text.split(",")[0]):
        errors.append("道劫 prompt 锚定句未点名 ink-wash 媒介")
    if sum(1 for s in sentences if s.startswith("The overall composition")) != 1:
        errors.append("道劫 prompt 总结句非唯一")
    if not any(s.startswith("The lighting is") for s in sentences):
        errors.append("道劫 prompt 缺光照句")
    return errors


def _dump(path: pathlib.Path, data: dict) -> bool:
    text = _serialize(data) + "\n"
    old = path.read_text(encoding="utf-8") if path.exists() else None
    if old == text:
        return False
    path.write_text(text, encoding="utf-8")
    return True


# ── 序列化(逐字复刻两件既有真源的排版口径,最小化 diff)────────────────
# 规则:纯标量数组/≤4 键纯叶子字典单行(POS/size/widgets_values/input 条目/properties);
# 结构性字典与含字典元素的数组多行,数组元素一行一个。

def _scalar(v) -> bool:
    return v is None or isinstance(v, (bool, int, float, str))


def _inlineable(v, max_dict_keys: int = 1) -> bool:
    if _scalar(v):
        return True
    if isinstance(v, list):
        return all(_scalar(x) for x in v)
    if isinstance(v, dict):
        return len(v) <= max_dict_keys and all(_inlineable(x) for x in v.values())
    return False


def _enc(v) -> str:
    return json.dumps(v, ensure_ascii=False)


_ENTRY_KEYS = {"name", "type", "shape", "widget", "link", "links", "localized_name"}


def _element_inline(x) -> bool:
    """数组元素单行口径:标量/纯标量数组/inputs·outputs 条目字典(键签名匹配)。
    group(含 id/title/bounding 等)不在此列,保持多行——对齐原文件排版。"""
    if _scalar(x):
        return True
    if isinstance(x, list):
        return all(_scalar(i) for i in x)
    return isinstance(x, dict) and set(x) <= _ENTRY_KEYS and all(
        _inlineable(v) for v in x.values()
    )


def _render(v, level: int) -> str:
    ind = "  " * level
    if isinstance(v, list):
        if all(_scalar(x) for x in v):
            return "[" + ", ".join(_enc(x) for x in v) + "]"
        parts = [
            ind + "  " + (_enc(x) if _element_inline(x) else _render(x, level + 1))
            for x in v
        ]
        return "[\n" + ",\n".join(parts) + "\n" + ind + "]"
    if isinstance(v, dict) and not _inlineable(v):
        parts = [
            f"{ind}  {_enc(k)}: " + (_enc(x) if _inlineable(x) else _render(x, level + 1))
            for k, x in v.items()
        ]
        return "{\n" + ",\n".join(parts) + "\n" + ind + "}"
    return _enc(v)


def _serialize(data: dict) -> str:
    return _render(data, 0)


def main() -> int:
    graph = json.loads(T2I_PATH.read_text(encoding="utf-8"))
    already = any(n["type"] == PE_CLASS for n in graph["nodes"])
    if already:
        t2i_written = False
    else:
        graph = apply_ab(graph)
        t2i_written = _dump(T2I_PATH, graph)

    daojie = derive_daojie(json.loads(T2I_PATH.read_text(encoding="utf-8")))
    daojie_written = _dump(DAOJIE_PATH, daojie)

    # ── 机器自查(写盘后重读真源,非内存对象)─────────────────────────
    errors = []
    for path, name in ((T2I_PATH, "t2i"), (DAOJIE_PATH, "daojie")):
        g = json.loads(path.read_text(encoding="utf-8"))  # json.loads 自查
        errors += validate_graph(g, name)
    dj = json.loads(DAOJIE_PATH.read_text(encoding="utf-8"))
    dj_prompt = next(n for n in dj["nodes"] if n["id"] == 13)["widgets_values"][0]
    errors += validate_daojie_prompt(dj_prompt)
    if errors:
        for e in errors:
            print("FAIL:", e, file=sys.stderr)
        return 1

    print(f"t2i    {'rewritten' if t2i_written else 'unchanged(idempotent)'}: {T2I_PATH.relative_to(REPO)}")
    print(f"daojie {'written' if daojie_written else 'unchanged(idempotent)'}: {DAOJIE_PATH.relative_to(REPO)}")
    print("selfcheck: json.loads OK / link 双向一致 OK / 全连线 target.x>origin.x OK / groups int id OK /"
          " PE+RGBA 开关默认 false OK / 道劫五件套句数+位置短语+DNA词+零质量词 OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
