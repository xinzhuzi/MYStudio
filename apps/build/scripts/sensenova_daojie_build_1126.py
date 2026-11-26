# -*- coding: utf-8 -*-
"""1126 SenseNova-U1.6 道劫产线·幂等生成器(道劫三层装配 × SenseNova-U1.6 官方采样链)。

装配段逐字复用 qi21 三件(MyQi21DaojieBase / MyQi21PromptAssembly / MyQi21PromptPreview,
零新节点、零新数据文件);采样段节点形态与参数逐字取官方模板
(1_图片/SenseNova/0_官方模板/image_sensenova_u16_t2i.json 与 …_image_edit.json)。
任务档:.trellis/tasks/11-26-sensenova-daojie-t2i-i2i/(design §1–§3)。

产物(确定性字节,重跑恒同;四件均落 apps/backend/comfyui/workflows/1_图片/SenseNova/):
  1_文生图/sn-道劫-t2i.json       画布件 25 节点:选型→三层装配→编码→双臂→32 对齐画幅→采样→输出
  1_文生图/sn-道劫-t2i-api.json   直投件(画布件平铺;注入锚见文件内 _doc)
  2_图生图/sn-道劫-i2i.json       画布件 28 节点:指令→装配→编码→参考图链→双臂→采样→输出
  2_图生图/sn-道劫-i2i-api.json   直投件(同上)

取值纪律(零手抄):
  · 采样段节点=深拷贝官方模板同类节点(输入槽/输出槽/widgets_values_named 键序/properties/
    配色逐字),widget 值先继承官方默认、只覆盖设计点名的差量(Turbo 默认 true、32 对齐表达式、
    保存前缀、清空编码器 text);官方件的双臂接法与参考图链接法每次生成前现读现校,漂移即拒生成;
  · 默认主体句=docs/prompts/道劫_类型主体句示例.md §1 代码块逐字;
  · 美术风格底座=qi21_bases.json art_style_base.positive_text 现读;
  · i2i 默认指令=本文件常量 I2I_INSTRUCTION(按 09 篇 §四 模板手写,来源见常量注)。

用法: python3 sensenova_daojie_build_1126.py [--out <目录>] [--dry-run]
  --out  四件按文件名平铺导出到该目录(契约测试比对用);缺省写仓库真源位
"""
from __future__ import annotations

import argparse
import copy
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_ROOT = REPO / "apps/backend/comfyui/workflows/1_图片/SenseNova"
OFFICIAL = {
    "t2i": WF_ROOT / "0_官方模板/image_sensenova_u16_t2i.json",
    "edit": WF_ROOT / "0_官方模板/image_sensenova_u16_image_edit.json",
}
QI21_BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
EXAMPLE_DOC = REPO / "docs/prompts/道劫_类型主体句示例.md"

# 四件产物:文件名 → 真源子目录(WF_ROOT 下);--out 时按文件名平铺
ARTIFACTS = {
    "sn-道劫-t2i.json": "1_文生图",
    "sn-道劫-t2i-api.json": "1_文生图",
    "sn-道劫-i2i.json": "2_图生图",
    "sn-道劫-i2i-api.json": "2_图生图",
}

# ── 设计点名的取值(出处=任务档 design §1–§4 / prd R5–R7;其余一律现读) ──────────
DEFAULT_TYPE = "人物海报"             # 底座节点默认型(design §1/§2 节点 1)
DEFAULT_SEED = 42                     # prd R6:seed=42 且控件跟 fixed
TURBO_DEFAULT = True                  # prd R6:Turbo 默认 true(24G 实测可用)
ALIGN_EXPR = "floor(a / 32) * 32"     # prd R5:底座宽高各经 32 对齐再进 latent
PURPOSE_T2I = "道劫美术类型"           # 装配节点默认「组装用途」(design §1 节点 4)
PURPOSE_I2I = "道劫美术风格转换"       # 装配节点默认「组装用途」(design §2 节点 3 / prd R7)
SAVE_PREFIX_T2I = "sensenova_daojie/"
SAVE_PREFIX_I2I = "sensenova_daojie_i2i/"

# i2i 默认指令(画布件节点 2「指令」的默认值):按 docs/prompts/Qwen-Image-2.1/09-图生图指令写作规范.md
# §四「复杂编辑参考模板」手写的画风转换句(design §4)。逐条落位:§四 段1 操作+保真开场(「把整幅画面
# 转换为道劫美术风格」操作动词领头+身份指图不描字;**风格名不进指令**——画法由装配节点追加「锁层A全文」,
# 指令复述画风=09 篇 §三.1 底座双写,1126 自检修)/ 段2 变化项(仅绘画画法)/ 段3 保真段(发型发长质感、面部身份、
# 服装配饰、背景、光线逐类点名+取景构图锁)/ 段5 收束句;§二 格式七规(单段无换行、比例分辨率禁入、
# 肯定式、斩钉截铁);§三 叠加纪律(N=1 单图自然指称「输入图片/画中人物」、全角标点、只写「改什么」——
# 画法由装配节点追加「锁层A全文」,指令不复述画法细节、否定式禁令);型负面词(「投影」等)已避开。
I2I_INSTRUCTION = (
    "把整幅画面转换为道劫美术风格，画中人物的面部身份保持不变；本次变化仅为绘画画法，"
    "画中全部人物、器物与环境都以同一种绘画语言整体重绘；在此基础上，完整保留画中每一位人物的"
    "发型、发色、发长与发丝质感，面部五官与面容、表情与视线方向，服装款式、颜色与全部配饰，"
    "身体姿态、手部动作，以及人物之间的前后位置和遮挡关系，完整保留背景环境的全部内容与各元素的位置，"
    "保留原有的光线方向与受光明暗分布；保持原图的取景、构图与人物在画面中的大小和位置完全不变；"
    "本次编辑仅针对绘画画法这一项，其余未提及之处保持原样。")

# ── 官方模板取形节点:key → (模板, 节点 id, 类型) ─────────────────────────────
# 节点 JSON 形态与 widget 默认值逐字取自这里;官方模板改版致 id/类型对不上即拒生成。
_SKELETON = {
    "ckpt": ("t2i", 1, "CheckpointLoaderSimple"),
    "lora": ("t2i", 27, "LoraLoaderModelOnly"),
    "encode_pos": ("t2i", 4, "CLIPTextEncode"),       # 官方正向下 text 已接线(带 widget 标记)
    "encode_neg": ("t2i", 5, "CLIPTextEncode"),       # 官方负向下 text 未接线,由 wire() 按名补槽
    "latent": ("t2i", 6, "EmptyHiDreamO1LatentImage"),
    "seed": ("t2i", 7, "PrimitiveInt"),               # 官方 Int (Seed)=42/fixed
    "turbo": ("t2i", 34, "PrimitiveBoolean"),
    "steps_turbo": ("t2i", 35, "PrimitiveInt"),
    "steps_native": ("t2i", 36, "PrimitiveInt"),
    "cfg_native": ("t2i", 37, "PrimitiveFloat"),
    "cfg_turbo": ("t2i", 38, "PrimitiveFloat"),
    "switch_model": ("t2i", 41, "ComfySwitchNode"),
    "switch_steps": ("t2i", 47, "ComfySwitchNode"),
    "switch_cfg": ("t2i", 40, "ComfySwitchNode"),
    "math": ("t2i", 15, "ComfyMathExpression"),
    "sampler": ("t2i", 67, "KSampler"),               # 官方直采路(seed/steps/cfg 三槽已接线)
    "decode": ("t2i", 69, "VAEDecode"),
    "save": ("t2i", 24, "SaveImage"),
    "multiline": ("t2i", 64, "PrimitiveStringMultiline"),
    "note": ("t2i", 66, "MarkdownNote"),
    "load_image": ("edit", 79, "LoadImage"),
    "resize_mp": ("edit", 80, "ResizeImageMaskNode"),
    "resize_mult": ("edit", 81, "ResizeImageMaskNode"),
    "image_size": ("edit", 82, "GetImageSize"),
    "ref_images": ("edit", 29, "HiDreamO1ReferenceImages"),
    "cond": ("edit", 85, "SenseNovaConditioning"),
}
# 节点键序=官方模板同类节点落盘键序
_NODE_KEYS = ("id", "type", "pos", "size", "flags", "order", "mode", "inputs", "outputs",
              "title", "properties", "widgets_values", "widgets_values_named", "color", "bgcolor")
_OFFICIAL_DOCS: dict[str, dict] = {}


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise SystemExit(f"[sensenova_daojie_build_1126] {msg}")


def _official(src: str, nid: int) -> dict:
    if src not in _OFFICIAL_DOCS:
        _OFFICIAL_DOCS[src] = json.loads(OFFICIAL[src].read_text(encoding="utf-8"))
    node = next((n for n in _OFFICIAL_DOCS[src]["nodes"] if n["id"] == nid), None)
    _require(node is not None, f"官方模板 {OFFICIAL[src].name} 缺节点 {nid}(模板已改版,须复核本生成器)")
    return node


# ── 真源现读 ──────────────────────────────────────────────────────────────
def read_subject_example() -> str:
    """默认主体句=例句库 §1 代码块逐字(design §4:取「## 1. 人物海报」之后第一个代码块)。"""
    lines = EXAMPLE_DOC.read_text(encoding="utf-8").split("\n")
    start = next((k for k, line in enumerate(lines) if re.match(r"^## 1\. 人物海报", line)), None)
    _require(start is not None, f"{EXAMPLE_DOC.name} 缺「## 1. 人物海报」标题(文档改版须复核取法)")
    opened = next((k for k in range(start + 1, len(lines)) if lines[k].startswith("```")), None)
    _require(opened is not None, "例句库 §1 标题后无代码块")
    closed = next((k for k in range(opened + 1, len(lines)) if lines[k].startswith("```")), None)
    _require(closed is not None, "例句库 §1 代码块未闭合")
    subject = "\n".join(lines[opened + 1:closed])
    _require(subject and "\n" not in subject and subject == subject.strip(),
             "例句库 §1 代码块应为单段且无首尾空白")
    return subject


def read_style_base() -> str:
    """美术风格底座=qi21_bases.json art_style_base.positive_text 现读(design §4)。"""
    bases = json.loads(QI21_BASES.read_text(encoding="utf-8"))
    style = bases.get("art_style_base", {}).get("positive_text")
    _require(isinstance(style, str) and style.strip(), "qi21_bases.json 缺 art_style_base.positive_text")
    _require(any(t.get("zh") == DEFAULT_TYPE for t in bases.get("types", [])),
             f"qi21_bases.json 无「{DEFAULT_TYPE}」型")
    return style


def official_facts() -> dict:
    """官方模板现读采样参数,并校验设计依赖的官方接法未漂移(prd F4/F5/R4)。

    设计照抄的两处官方接法——双臂(三 Switch 同吃 Turbo,臂位 true=LoRA/8步/cfg1)与参考图链
    (LoadImage→两次缩放→尺寸/参考图;SenseNovaConditioning 直采)——每次生成前按官方连线表
    逐槽现校:官方件改版改了接法,这里响亮拒生成,而不是沿用旧印象。
    """
    def named(src: str, nid: int) -> dict:
        return dict(_official(src, nid)["widgets_values_named"])

    def feeds(src: str, target: int, slot_name: str) -> tuple[int, int]:
        """官方模板里 target 节点 slot_name 输入槽所接的 (源节点 id, 源槽)。"""
        node = _official(src, target)
        slot = next(k for k, x in enumerate(node["inputs"]) if x["name"] == slot_name)
        link = next(x for x in _OFFICIAL_DOCS[src]["links"] if x[0] == node["inputs"][slot]["link"])
        _require(link[3] == target and link[4] == slot,
                 f"官方 {src} 连线 {link[0]} 不回指节点 {target} 槽 {slot}")
        return link[1], link[2]

    lora, ks = named("t2i", 27), named("t2i", 67)
    facts = {
        "ckpt_name": named("t2i", 1)["ckpt_name"],
        "lora_name": lora["lora_name"],
        "lora_strength": lora["strength_model"],
        "turbo_steps": named("t2i", 35)["value"],
        "native_steps": named("t2i", 36)["value"],
        "turbo_cfg": named("t2i", 38)["value"],
        "native_cfg": named("t2i", 37)["value"],
        "sampler": ks["sampler_name"],
        "scheduler": ks["scheduler"],
        "denoise": ks["denoise"],
        "ref_image": named("edit", 79)["image"],
        "ref_megapixels": named("edit", 80)["resize_type.megapixels"],
        "ref_multiple": named("edit", 81)["resize_type.multiple"],
    }
    # 双臂(prd R4):Turbo true=LoRA+8 步+cfg1,false=无 LoRA+50 步+cfg4;三 Switch 同吃 Turbo Mode?[34]
    _require([feeds("t2i", 41, s) for s in ("on_true", "on_false")] == [(27, 0), (1, 0)],
             "官方模型 Switch[41] 臂位变了(应 on_true=LoRA[27] / on_false=ckpt[1])")
    _require([feeds("t2i", 47, s) for s in ("on_true", "on_false")] == [(35, 0), (36, 0)],
             "官方步数 Switch[47] 臂位变了(应 on_true=[35] / on_false=[36])")
    _require([feeds("t2i", 40, s) for s in ("on_true", "on_false")] == [(38, 0), (37, 0)],
             "官方 CFG Switch[40] 臂位变了(应 on_true=[38] / on_false=[37])")
    _require([feeds("t2i", s, "switch") for s in (41, 47, 40)] == [(34, 0)] * 3,
             "官方三 Switch 不再同吃 Turbo Mode?[34]")
    _require([feeds("t2i", 67, s) for s in ("model", "seed", "steps", "cfg")] == [(41, 0), (7, 0), (47, 0), (40, 0)],
             "官方直采 KSampler[67] 不再吃三 Switch[41/47/40]+种子[7]")
    _require(facts["lora_strength"] == 1 and ks["steps"] == facts["turbo_steps"]
             and ks["cfg"] == facts["turbo_cfg"], "官方 KSampler[67] widget 值不再对应 Turbo 臂")
    _require(named("t2i", 34)["value"] is False, "官方 Turbo Mode?[34] 默认值变了(本役按 prd R6 覆写为 true)")
    # 参考图链(prd F5):LoadImage[79]→[80]总量→[81]32 倍数→尺寸[82]/参考图[29];条件走 SenseNovaConditioning[85]
    _require([feeds("edit", 80, "input"), feeds("edit", 81, "input")] == [(79, 0), (80, 0)],
             "官方参考图链变了(应 LoadImage[79]→[80]→[81])")
    _require([feeds("edit", 82, "image"), feeds("edit", 29, "images.image_1")] == [(81, 0), (81, 0)],
             "官方尺寸/参考图不再同吃第二级缩放[81]")
    _require([feeds("edit", 6, "width"), feeds("edit", 6, "height")] == [(82, 0), (82, 1)],
             "官方画幅不再取 GetImageSize[82] 的 width/height")
    _require([feeds("edit", 85, s) for s in ("conditioning", "clip", "negative")] == [(29, 0), (1, 1), (29, 1)],
             "官方 SenseNovaConditioning[85] 入线变了(应 [29].0 / ckpt.CLIP / [29].1)")
    _require([feeds("edit", 67, s) for s in ("positive", "negative", "model", "steps", "cfg")]
             == [(85, 0), (85, 2), (41, 0), (47, 0), (40, 0)],
             "官方直采 KSampler[67] 不再吃 SenseNovaConditioning[85] 出 0/2 与三 Switch")
    _require(named("edit", 85)["task"] == "image", "官方 SenseNovaConditioning[85] task 不再是 image")
    return facts


# ── 画布构造小件 ───────────────────────────────────────────────────────────
def _in(name: str, ntype: str, link: int | None = None, *, widget: bool = False,
        optional: bool = False) -> dict:
    """输入槽条目(键序照官方模板/正典件):widget=由 widget 转来的输入;optional=可缺槽(shape 7)。"""
    slot = {"name": name}
    if optional:
        slot["shape"] = 7
    slot["type"] = ntype
    if widget:
        slot["widget"] = {"name": name}
    slot["link"] = link
    return slot


def _out(name: str, ntype: str, links: list | None = None, slot: int | None = 0) -> dict:
    """输出槽条目(自研节点用,links 恒为列表,照正典件);slot=None 落正典件「无 slot_index」形态。"""
    out = {"name": name, "type": ntype}
    if slot is not None:
        out["slot_index"] = slot
    out["links"] = [] if links is None else links
    return out


def _node(nid: int, ntype: str, widgets: list, named: dict, inputs: list, outputs: list) -> dict:
    """自研节点(qi21 三件,不在官方模板内):形态照正典件 qi21-道劫-t2i/i2i.json 同类节点。"""
    _require(list(named.values()) == list(widgets), f"节点 {nid}({ntype}) positional 与 named 两面不一致")
    return {"id": nid, "type": ntype, "flags": {}, "order": 0, "mode": 0, "inputs": inputs,
            "outputs": outputs, "properties": {"Node name for S&R": ntype},
            "widgets_values": list(widgets), "widgets_values_named": dict(named)}


def _skel(key: str, nid: int, title: str | None = None, **widgets) -> dict:
    """官方同类节点深拷贝取形:清连线,换 id;widget 值=官方默认+差量(两面同写)。

    前端 1.59.6 有 widgets_values_named 时按名恢复 widget 值并比对 positional 影子,
    故 named 键序/键集照官方、positional 恒=list(named.values())。
    标题默认留官方原件的(「Turbo Mode?」「Int (Steps)」「Int (Setps)」等,design 节点表照官方原文);
    传入 title 才覆盖(编码器/多行文本/对齐表达式等设计另起标题的节点)。
    """
    src, oid, ntype = _SKELETON[key]
    node = copy.deepcopy(_official(src, oid))
    _require(node["type"] == ntype, f"官方模板 {src} 节点 {oid} 应为 {ntype},实得 {node['type']}")
    named = node.get("widgets_values_named")
    if named is None:
        _require(not widgets, f"{key}: 官方 {ntype}[{oid}] 无 widget,却要写 {sorted(widgets)}")
    else:
        _require(list(named.values()) == node["widgets_values"], f"官方 {ntype}[{oid}] positional 与 named 两面不一致")
        _require(not (set(widgets) - set(named)), f"{key}: 官方 {ntype}[{oid}] 无 widget {sorted(set(widgets) - set(named))}")
        named.update(widgets)
        node["widgets_values"] = list(named.values())
    for entry in node.get("inputs", []):
        entry["link"] = None
    for out in node.get("outputs", []):
        if out.get("links"):
            out["links"] = []
    node.update(id=nid, flags={}, order=0, mode=0)
    node.pop("showAdvanced", None)
    if title is not None:
        node["title"] = title
    return node


class _Graph:
    """画布件装配器:节点表+连线表。连线条目=[id, 源, 源槽, 目标, 目标槽下标, 类型],
    目标槽下标=目标节点 inputs 数组的真实下标(1123 #11 口径)。"""

    def __init__(self, layout: dict[int, tuple[list, list]]):
        self.layout = layout
        self.nodes: list[dict] = []
        self.links: list[list] = []
        self.by_id: dict[int, dict] = {}

    def add(self, node: dict) -> dict:
        nid = node["id"]
        _require(nid not in self.by_id, f"节点 id {nid} 重复")
        node["pos"], node["size"] = list(self.layout[nid][0]), list(self.layout[nid][1])
        node = {k: node[k] for k in _NODE_KEYS if k in node}
        self.nodes.append(node)
        self.by_id[nid] = node
        return node

    def wire(self, src: int, src_slot: int, dst: int, name: str, link_type: str) -> None:
        """连一条线 src 出槽→dst 的 name 输入槽(无则按名追加;widget 可转槽带 widget 标记)。"""
        target = self.by_id[dst]
        out = self.by_id[src]["outputs"][src_slot]
        slot = next((k for k, x in enumerate(target["inputs"]) if x["name"] == name), None)
        if slot is None:
            target["inputs"].append(_in(name, link_type, widget=name in (target.get("widgets_values_named") or {})))
            slot = len(target["inputs"]) - 1
        entry = target["inputs"][slot]
        _require(entry["link"] is None, f"节点 {dst}.{name} 已接线,不可重复接")
        accept = [t.strip() for t in entry["type"].split(",")]
        _require(out["type"] in accept or "*" in accept,
                 f"节点 {dst}.{name} 不接受 {out['type']}(该槽收 {accept})")
        lid = len(self.links) + 1
        self.links.append([lid, src, src_slot, dst, slot, link_type])
        entry["link"] = lid
        out["links"] = (out.get("links") or []) + [lid]

    def finish(self, groups: list[dict]) -> dict:
        """算拓扑序写进 order,按节点 id 升序落表,出画布件顶层结构(键序照 Moss 件)。"""
        preds = {nid: set() for nid in self.by_id}
        for _, src, _, dst, _, _ in self.links:
            preds[dst].add(src)
        order, done = {}, set()
        while len(done) < len(preds):
            ready = [nid for nid in sorted(preds) if nid not in done and preds[nid] <= done]
            _require(bool(ready), f"连线成环:{sorted(set(preds) - done)}")
            for nid in ready:
                order[nid] = len(done)
                done.add(nid)
        for node in self.nodes:
            node["order"] = order[node["id"]]
        self.nodes.sort(key=lambda n: n["id"])
        return {"last_node_id": max(self.by_id), "last_link_id": len(self.links), "nodes": self.nodes,
                "links": self.links, "groups": groups, "config": {}, "extra": {}, "version": 0.4, "revision": 0}


# ── 版式:全正向(节点与组框最小坐标 ≥ 0)、四组横排、组框包住本组节点、节点互不重叠 ────
_ARM_ORIGIN = (1720, 100)      # ③ 组内十件的共同原点(相对坐标见 _ARM_OFFSET)
_ARM_OFFSET = {                # key → (相对坐标, 尺寸)
    "turbo": ([0, 0], [300, 80]),
    "ckpt": ([0, 130], [440, 120]),
    "lora": ([0, 300], [440, 120]),
    "steps_native": ([0, 470], [440, 110]),
    "steps_turbo": ([0, 630], [440, 110]),
    "cfg_native": ([0, 790], [440, 80]),
    "cfg_turbo": ([0, 920], [440, 80]),
    "switch_model": ([500, 130], [340, 160]),
    "switch_steps": ([500, 470], [340, 160]),
    "switch_cfg": ([500, 790], [340, 160]),
}
# ③ 模型·双臂十件的节点 id(design §1 的 8–17;i2i 为同序的 7–16)
_ARMS_T2I = {"ckpt": 8, "lora": 9, "turbo": 10, "steps_turbo": 11, "steps_native": 12,
             "cfg_turbo": 13, "cfg_native": 14, "switch_model": 15, "switch_steps": 16, "switch_cfg": 17}
_ARMS_I2I = {key: nid - 1 for key, nid in _ARMS_T2I.items()}

_LAYOUT_T2I = {
    1: ([40, 100], [420, 220]),       # MyQi21DaojieBase
    2: ([40, 370], [440, 330]),       # 主体句
    3: ([40, 750], [440, 280]),       # 美术风格底座
    4: ([540, 100], [460, 330]),      # MyQi21PromptAssembly
    5: ([540, 480], [460, 300]),      # MyQi21PromptPreview
    25: ([540, 830], [460, 470]),     # MarkdownNote
    6: ([1120, 100], [460, 230]),     # CLIP Text Encode (正向)
    7: ([1120, 380], [460, 220]),     # CLIP Text Encode (负向)
    18: ([2960, 100], [360, 190]),    # 宽 32 对齐
    19: ([2960, 340], [360, 190]),    # 高 32 对齐
    20: ([2960, 580], [360, 160]),    # EmptyHiDreamO1LatentImage
    21: ([2960, 790], [360, 110]),    # Int (Seed)
    22: ([3400, 100], [340, 330]),    # KSampler
    23: ([3800, 100], [260, 100]),    # VAEDecode
    24: ([3800, 240], [560, 700]),    # SaveImage
}
_LAYOUT_I2I = {
    1: ([40, 100], [420, 220]),       # MyQi21DaojieBase
    2: ([40, 370], [440, 330]),       # 指令
    28: ([40, 750], [440, 550]),      # MarkdownNote
    3: ([540, 100], [460, 330]),      # MyQi21PromptAssembly
    4: ([540, 480], [460, 300]),      # MyQi21PromptPreview
    5: ([1120, 100], [460, 230]),     # CLIP Text Encode (正向)
    6: ([1120, 380], [460, 220]),     # CLIP Text Encode (负向)
    17: ([2960, 100], [380, 500]),    # LoadImage
    24: ([2960, 660], [380, 110]),    # Int (Seed)
    18: ([3400, 100], [340, 170]),    # ResizeImageMaskNode(总量)
    19: ([3400, 320], [340, 170]),    # ResizeImageMaskNode(32 倍数)
    20: ([3400, 540], [340, 110]),    # GetImageSize
    21: ([3400, 700], [340, 160]),    # EmptyHiDreamO1LatentImage
    22: ([3800, 100], [320, 150]),    # HiDreamO1ReferenceImages
    23: ([3800, 300], [320, 170]),    # SenseNovaConditioning
    25: ([4180, 100], [340, 330]),    # KSampler
    26: ([4180, 470], [260, 100]),    # VAEDecode
    27: ([4180, 610], [340, 500]),    # SaveImage
}


def _arm_layout(ids: dict) -> dict:
    return {ids[key]: ([_ARM_ORIGIN[0] + pos[0], _ARM_ORIGIN[1] + pos[1]], size)
            for key, (pos, size) in _ARM_OFFSET.items()}


_LAYOUT_T2I.update(_arm_layout(_ARMS_T2I))
_LAYOUT_I2I.update(_arm_layout(_ARMS_I2I))


def _group(gid: int, title: str, bounding: list, color: str) -> dict:
    return {"id": gid, "title": title, "bounding": bounding, "color": color, "flags": {}}


def groups_t2i(facts: dict) -> list[dict]:
    return [_group(1, "① 型库·三层装配(qi21_bases.json 复用)", [0, 0, 1020, 1330], "#3f789e"),
            _group(2, "② 编码", [1080, 0, 540, 640], "#88A"),
            _group(3, f"③ 模型·双臂(Turbo {facts['turbo_steps']} 步 | 原生 {facts['native_steps']} 步)",
                   [1680, 0, 1160, 1160], "#a33"),
            _group(4, "④ 画幅·采样·输出", [2920, 0, 1500, 1160], "#4a7")]


def groups_i2i(facts: dict) -> list[dict]:
    return [_group(1, "① 型库·三层装配(qi21_bases.json 复用)", [0, 0, 1020, 1330], "#3f789e"),
            _group(2, "② 编码", [1080, 0, 540, 640], "#88A"),
            _group(3, f"③ 模型·双臂(Turbo {facts['turbo_steps']} 步 | 原生 {facts['native_steps']} 步)",
                   [1680, 0, 1160, 1160], "#a33"),
            _group(4, "④ 参考图·画幅·采样·输出", [2920, 0, 1660, 1160], "#4a7")]


def note_t2i(facts: dict) -> str:
    return f"""## SenseNova 道劫 t2i(道劫三层装配 × SenseNova-U1.6 官方采样链,1126 役)

- **装配段=qi21 三件逐字复用**(零新节点、零新数据文件):`MyQi21DaojieBase`(选型→BASE/WIDTH/HEIGHT/负面词)→ `MyQi21PromptAssembly`(美术风格底座 → 类型句 → 主体句)→ 编码器 `.text`;`MyQi21PromptPreview` 出正/负终稿,可逐字对账
- **型库=`qi21_bases.json` 现读**:美术风格底座节点默认值=`art_style_base.positive_text`;主体句默认值=`道劫_类型主体句示例.md` §1 代码块逐字
- **双臂**:`Turbo Mode?`=true(默认)→ 8step LoRA@1.0 + {facts['turbo_steps']} 步 + CFG{facts['turbo_cfg']};false → 无 LoRA + {facts['native_steps']} 步 + CFG{facts['native_cfg']};模型/步数/CFG 三个 Switch 同吃这一个开关;{facts['sampler']} / {facts['scheduler']} / denoise {facts['denoise']} 照官方
- **画幅**:底座 WIDTH/HEIGHT 各经 `{ALIGN_EXPR}` 对齐后进 `EmptyHiDreamO1LatentImage`(step=32);已对齐的型数值不变
- **模型**:`{facts['ckpt_name']}`(ckpt 自带 CLIP 与 VAE)+ `{facts['lora_name']}`
- **首版未接**:PE 链(会把装配文整段改写成英文,与逐字装配冲突)、自修正环;透明型不出透明(SenseNova 输出 RGB 无 alpha,型文不动)
- 主体句纪律与发车前预检同 qi21 线(`daojie_subject_overlap.py`)
"""


def note_i2i(facts: dict) -> str:
    return f"""## SenseNova 道劫 i2i(道劫装配 × SenseNova-U1.6 官方图像编辑链,1126 役)

- **装配段=qi21 三件逐字复用**:指令(唯一手写位)→ `MyQi21PromptAssembly` → 编码器 `.text`;`MyQi21PromptPreview` 出正/负终稿,可逐字对账
- **组装用途**:默认「{PURPOSE_I2I}」=指令 + 画法(画法=装配节点「锁层A全文」);画布可切「自由出图」(仅指令);切「道劫美术类型」=型层+画法、底座节点选型生效,但须把「指令」改写成带发色的 t2i 主体句(该档走 t2i 全量门,画风转换句会被「发色必写」拦下)
- **参考图链照官方**:LoadImage → 总量 {facts['ref_megapixels']}MP → {facts['ref_multiple']} 倍数 → 画幅随参考图(GetImageSize)+ `HiDreamO1ReferenceImages.image_1`;条件走 `SenseNovaConditioning`(task=image)直采
- **双臂**:同 t2i 件(`Turbo Mode?` 一个开关同吃模型/步数/CFG)
- **模型**:`{facts['ckpt_name']}`(ckpt 自带 CLIP 与 VAE)+ `{facts['lora_name']}`
- **指令写法**:`docs/prompts/Qwen-Image-2.1/09-图生图指令写作规范.md`(单图自然指称、肯定式、操作段+保真段);cfg=1 下负向不参与采样
- **首版未接**:PE 链、自修正环
"""


def _add_dual_arm(g: _Graph, ids: dict) -> None:
    """③ 模型·双臂:ckpt→(LoRA)→Switch;Turbo 一个开关同吃模型/步数/CFG 三 Switch(官方接法,见 official_facts)。"""
    for key in ("ckpt", "lora"):
        g.add(_skel(key, ids[key]))
    g.add(_skel("turbo", ids["turbo"], value=TURBO_DEFAULT))
    for key in ("steps_turbo", "steps_native", "cfg_turbo", "cfg_native"):
        g.add(_skel(key, ids[key]))
    for key in ("switch_model", "switch_steps", "switch_cfg"):
        g.add(_skel(key, ids[key]))
    g.wire(ids["ckpt"], 0, ids["lora"], "model", "MODEL")
    for sw, on_true, on_false, link_type in (("switch_model", "lora", "ckpt", "MODEL"),
                                             ("switch_steps", "steps_turbo", "steps_native", "INT"),
                                             ("switch_cfg", "cfg_turbo", "cfg_native", "FLOAT")):
        g.wire(ids[on_true], 0, ids[sw], "on_true", link_type)     # true=Turbo 端
        g.wire(ids[on_false], 0, ids[sw], "on_false", link_type)   # false=原生端
        g.wire(ids["turbo"], 0, ids[sw], "switch", "BOOLEAN")


def _base_node() -> dict:
    """① 类型底座:MyQi21DaojieBase(形态照正典件 [4010];六出槽序=RETURN_NAMES)。"""
    return _node(1, "MyQi21DaojieBase", [DEFAULT_TYPE, False], {"base": DEFAULT_TYPE, "透明覆盖": False}, [],
                 [_out("BASE", "STRING"), _out("WIDTH", "INT", slot=1), _out("HEIGHT", "INT", slot=2),
                  _out("负面词", "STRING", slot=3), _out("透明值", "BOOLEAN", slot=4), _out("型名", "STRING", slot=5)])


def _assembly_node(nid: int, subject: str, style: str, purpose: str, style_linked: bool) -> dict:
    """装配节点(形态照正典件 [4011]):六槽 widget 顺序=BASE/BASE负面/主体句/主体句负面/锁层A全文/组装用途。"""
    linked = [_in("BASE", "STRING", widget=True, optional=True), _in("BASE负面", "STRING", optional=True),
              _in("主体句", "STRING", widget=True, optional=True)]
    if style_linked:
        linked.append(_in("锁层A全文", "STRING", widget=True, optional=True))   # t2i:吃底座节点连线
    return _node(nid, "MyQi21PromptAssembly",
                 ["", "", subject, "", style, purpose],
                 {"BASE": "", "BASE负面": "", "主体句": subject, "主体句负面": "",
                  "锁层A全文": style, "组装用途": purpose},
                 linked, [_out("装配全文", "STRING", slot=None), _out("负面词", "STRING", slot=None)])


def _preview_node(nid: int) -> dict:
    """预览节点(形态照正典件 [401]):OUTPUT_NODE,ui.positive/negative 进 /history 供逐字对账。"""
    return _node(nid, "MyQi21PromptPreview", ["", ""], {"正向终稿": "", "负向终稿": ""},
                 [_in("正向提示词", "STRING"), _in("负向提示词", "STRING")], [_out("合并预览", "STRING", slot=None)])


# ── 产物 1/3:画布件 ───────────────────────────────────────────────────────
def build_canvas_t2i(subject: str, style: str, facts: dict) -> dict:
    """t2i 画布件(design §1,25 节点):选型→三层装配→编码→双臂→32 对齐画幅→采样→输出。"""
    g = _Graph(_LAYOUT_T2I)
    g.add(_base_node())                                              # ① 型库·三层装配
    g.add(_skel("multiline", 2, "主体句", value=subject))
    g.add(_skel("multiline", 3, "美术风格底座", value=style))
    g.add(_assembly_node(4, subject, style, PURPOSE_T2I, style_linked=True))
    g.add(_preview_node(5))
    g.add(_skel("note", 25, text=note_t2i(facts)))
    g.add(_skel("encode_pos", 6, "CLIP Text Encode (正向)", text=""))  # ② 编码
    g.add(_skel("encode_neg", 7, "CLIP Text Encode (负向)", text=""))
    _add_dual_arm(g, _ARMS_T2I)                                      # ③ 模型·双臂
    g.add(_skel("math", 18, "宽 32 对齐", expression=ALIGN_EXPR))     # ④ 画幅·采样·输出
    g.add(_skel("math", 19, "高 32 对齐", expression=ALIGN_EXPR))
    g.add(_skel("latent", 20))
    g.add(_skel("seed", 21, value=DEFAULT_SEED))
    g.add(_skel("sampler", 22))
    g.add(_skel("decode", 23))
    g.add(_skel("save", 24, filename_prefix=SAVE_PREFIX_T2I))
    for wire in ((1, 0, 4, "BASE", "STRING"), (1, 3, 4, "BASE负面", "STRING"),
                 (2, 0, 4, "主体句", "STRING"), (3, 0, 4, "锁层A全文", "STRING"),
                 (4, 0, 5, "正向提示词", "STRING"), (4, 1, 5, "负向提示词", "STRING"),
                 (4, 0, 6, "text", "STRING"), (8, 1, 6, "clip", "CLIP"),
                 (4, 1, 7, "text", "STRING"), (8, 1, 7, "clip", "CLIP"),
                 (1, 1, 18, "values.a", "INT"), (1, 2, 19, "values.a", "INT"),
                 (18, 1, 20, "width", "INT"), (19, 1, 20, "height", "INT"),
                 (15, 0, 22, "model", "MODEL"), (6, 0, 22, "positive", "CONDITIONING"),
                 (7, 0, 22, "negative", "CONDITIONING"), (20, 0, 22, "latent_image", "LATENT"),
                 (21, 0, 22, "seed", "INT"), (16, 0, 22, "steps", "INT"), (17, 0, 22, "cfg", "FLOAT"),
                 (22, 0, 23, "samples", "LATENT"), (8, 2, 23, "vae", "VAE"), (23, 0, 24, "images", "IMAGE")):
        g.wire(*wire)
    return g.finish(groups_t2i(facts))


def build_canvas_i2i(style: str, facts: dict) -> dict:
    """i2i 画布件(design §2,28 节点):指令→装配→编码→参考图链→双臂→采样→输出。"""
    g = _Graph(_LAYOUT_I2I)
    g.add(_base_node())                                              # ① 型库·三层装配
    g.add(_skel("multiline", 2, "指令", value=I2I_INSTRUCTION))
    g.add(_skel("note", 28, text=note_i2i(facts)))
    g.add(_assembly_node(3, I2I_INSTRUCTION, style, PURPOSE_I2I, style_linked=False))  # 锁层A全文用 widget 值
    g.add(_preview_node(4))
    g.add(_skel("encode_pos", 5, "CLIP Text Encode (正向)", text=""))  # ② 编码
    g.add(_skel("encode_neg", 6, "CLIP Text Encode (负向)", text=""))
    _add_dual_arm(g, _ARMS_I2I)                                      # ③ 模型·双臂
    for key, nid in (("load_image", 17), ("resize_mp", 18), ("resize_mult", 19),   # ④ 参考图·画幅·采样·输出
                     ("image_size", 20), ("latent", 21), ("ref_images", 22), ("cond", 23),
                     ("seed", 24), ("sampler", 25), ("decode", 26)):
        g.add(_skel(key, nid, **({"value": DEFAULT_SEED} if key == "seed" else {})))
    g.add(_skel("save", 27, filename_prefix=SAVE_PREFIX_I2I))
    for wire in ((1, 0, 3, "BASE", "STRING"), (1, 3, 3, "BASE负面", "STRING"), (2, 0, 3, "主体句", "STRING"),
                 (3, 0, 4, "正向提示词", "STRING"), (3, 1, 4, "负向提示词", "STRING"),
                 (3, 0, 5, "text", "STRING"), (7, 1, 5, "clip", "CLIP"),
                 (3, 1, 6, "text", "STRING"), (7, 1, 6, "clip", "CLIP"),
                 (17, 0, 18, "input", "IMAGE"), (18, 0, 19, "input", "IMAGE"),
                 (19, 0, 20, "image", "IMAGE"), (19, 0, 22, "images.image_1", "IMAGE"),
                 (20, 0, 21, "width", "INT"), (20, 1, 21, "height", "INT"),
                 (5, 0, 22, "positive", "CONDITIONING"), (6, 0, 22, "negative", "CONDITIONING"),
                 (22, 0, 23, "conditioning", "CONDITIONING"), (7, 1, 23, "clip", "CLIP"),
                 (22, 1, 23, "negative", "CONDITIONING"),
                 (14, 0, 25, "model", "MODEL"), (23, 0, 25, "positive", "CONDITIONING"),
                 (23, 2, 25, "negative", "CONDITIONING"), (21, 0, 25, "latent_image", "LATENT"),
                 (24, 0, 25, "seed", "INT"), (15, 0, 25, "steps", "INT"), (16, 0, 25, "cfg", "FLOAT"),
                 (25, 0, 26, "samples", "LATENT"), (7, 2, 26, "vae", "VAE"), (26, 0, 27, "images", "IMAGE")):
        g.wire(*wire)
    return g.finish(groups_i2i(facts))


# ── 产物 2/4:API 直投件(画布件平铺) ──────────────────────────────────────
# 前端专用件,不上 /prompt(上役已跑通的 payload 同款:PrimitiveInt/KSampler 无 control_after_generate、
# LoadImage 无 upload)
_FRONTEND_ONLY_WIDGETS = frozenset({"control_after_generate", "upload"})


def _flatten(canvas: dict, doc: str) -> dict:
    """画布件 → API 直投件(同节点表):连线→[源 id 字符串, 源槽];未接线的 widget→值;不含 MarkdownNote。

    含装配与预览节点(与 Moss 件有意不同):装配恒在引擎内按真源完成,预览节点 ui 载荷进 /history 可对账。
    """
    origin = {link[0]: (link[1], link[2]) for link in canvas["links"]}
    api: dict = {}
    for node in canvas["nodes"]:
        if node["type"] == "MarkdownNote":
            continue
        linked = {entry["name"]: entry["link"] for entry in node["inputs"] if entry.get("link") is not None}
        inputs = {key: value for key, value in (node.get("widgets_values_named") or {}).items()
                  if key not in _FRONTEND_ONLY_WIDGETS and key not in linked}
        for name, lid in linked.items():
            src, slot = origin[lid]
            inputs[name] = [str(src), slot]
        api[str(node["id"])] = {"class_type": node["type"], "inputs": inputs}
    api["_doc"] = doc
    return api


def api_doc_t2i(facts: dict) -> str:
    return (f"SenseNova 道劫 t2i 直投模板(=画布件 sn-道劫-t2i.json 的平铺,同节点表;默认臂=Turbo "
            f"{facts['turbo_steps']} 步)。注入锚:型→1.base / 主体句→2.value / seed→21.value / Turbo→10.value"
            f"(true=LoRA+{facts['turbo_steps']} 步+cfg{facts['turbo_cfg']},false={facts['native_steps']} 步+"
            f"cfg{facts['native_cfg']})。装配在引擎内按 qi21_bases.json 现读完成;预览节点 5 的 ui.positive[0] "
            "可逐字对账。直投前须剥除本 _doc 键(非节点键,引擎不认)。")


def api_doc_i2i(facts: dict) -> str:
    return (f"SenseNova 道劫 i2i 直投模板(=画布件 sn-道劫-i2i.json 的平铺,同节点表;默认臂=Turbo "
            f"{facts['turbo_steps']} 步)。注入锚:指令→2.value / 组装用途→3.组装用途 / 参考图名→17.image / "
            f"seed→24.value / Turbo→9.value(true=LoRA+{facts['turbo_steps']} 步+cfg{facts['turbo_cfg']},"
            f"false={facts['native_steps']} 步+cfg{facts['native_cfg']})。装配在引擎内完成;预览节点 4 的 "
            "ui.positive[0] 可逐字对账。直投前须剥除本 _doc 键(非节点键,引擎不认)。")


# ── 装配总成与入口 ──────────────────────────────────────────────────────────
def build_all() -> list[tuple[str, dict]]:
    """四件产物:文件名 → 对象(序=ARTIFACTS;纯函数,同输入恒同输出)。"""
    facts = official_facts()
    subject, style = read_subject_example(), read_style_base()
    t2i, i2i = build_canvas_t2i(subject, style, facts), build_canvas_i2i(style, facts)
    return [(name, obj) for name, obj in (
        ("sn-道劫-t2i.json", t2i),
        ("sn-道劫-t2i-api.json", _flatten(t2i, api_doc_t2i(facts))),
        ("sn-道劫-i2i.json", i2i),
        ("sn-道劫-i2i-api.json", _flatten(i2i, api_doc_i2i(facts))))]


def render(obj: dict) -> bytes:
    """确定性落盘字节(照 Moss 件:UTF-8、indent=1、保留非 ASCII、末尾一个换行)。"""
    return (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def main() -> int:
    ap = argparse.ArgumentParser(description="1126 SenseNova-U1.6 道劫产线幂等生成器")
    ap.add_argument("--out", type=Path, help="四件按文件名平铺导出到该目录(契约测试比对用);缺省写仓库真源位")
    ap.add_argument("--dry-run", action="store_true", help="只演算不写盘")
    args = ap.parse_args()
    for name, obj in build_all():
        path = (args.out / name) if args.out else (WF_ROOT / ARTIFACTS[name] / name)
        where = path.relative_to(REPO) if path.is_relative_to(REPO) else path
        if args.dry_run:
            count = f"{len(obj['nodes'])} 节点/{len(obj['links'])} 连线" if "nodes" in obj else f"{len(obj) - 1} 节点+_doc"
            print(f"[DRY] {where}  ({count})")
        elif path.is_file() and path.read_bytes() == render(obj):
            print(f"SKIP(字节未变) {where}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(render(obj))
            print(f"OK {where}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
