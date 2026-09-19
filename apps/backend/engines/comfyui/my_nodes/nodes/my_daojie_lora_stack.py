# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫 LoRA 栈节点(09-19 LoRA快速启停 R2:C3 实装,九型驱动启停的执行层)。

单节点吃下道劫 t2i 全部 14 槽 LoRA(现链 14 件 LoraLoaderModelOnly +
[85] 按型装组的合体):MODEL 入 → 槽位串行 apply(链序=数据文件序)→
MODEL 出 → [12] 采样;另出 applied STRING=实际生效清单(审计/预览用,
接 easy showAnything 可见,同 MyDaojieLoras 先例)。

槽位真源=本目录 daojie_lora_stack.json(单源数据面,与 daojie_bases.json
同纪律:磁盘现读、mtime 失效、热改即时生效;新增 LoRA 只改数据文件,
工作流零改动——节点 widget 面随 json 动态生长)。槽序=现链运行时序
(turbo→projector→detail→asianmix→liujin→…,其中 67→76→73 对齐
[85] daojie_loras.json 人物条目序):ComfyUI lora patch 按调用序累积
进同键补丁表、逐项浮点累加(comfy/lora.py calculate_weight for-p 循环),
顺序即舍入路径——链序错位=出图漂移隐形根因,等价性双跑的逐字节前提。

preset 三态语义(design.md 阶段2 + research/九型LoRA启停设计.md §二):
  「跟随底座型」(默认)= 读 [80].base 供线(可选 COMBO forceInput,
   同 [85] 接法)得当前型,按矩阵点亮;未接线回退「人物」并警告。
  九型名任一 = 同上,但型钉死(联动不可达时的人选降级路径)。
  「专家·全自定义」= 每槽 enable/weight widget 全手拨。
enable 语义(任务硬指标):enable=false 一律真关=跳过 comfy 加载调用
(不 load_torch_file、不 add_patches,比权重 0 快);preset 模式下
enable=false = 该槽急停(矩阵点亮也被开关压下),applied 清单披露。
文件缺失=该槽报错并点名缺件(不静默跳过,对齐「半装残留=死端」教训)。

引擎依赖(folder_paths/comfy.*)在 run 内懒加载——repo 侧测试用假模块
覆盖装/缺件/真关路径,不 import 引擎库(同包其余节点纪律)。"""
from __future__ import annotations

import json
from pathlib import Path

_STACK_JSON = Path(__file__).resolve().parent / "daojie_lora_stack.json"

# preset COMBO 首尾两档(九型名夹中间,现读 json);
# 「跟随底座型」未接 [80] 时的回退型(同 my_daojie_base.DEFAULT_BASE 纪律显式钉死)
FOLLOW_PRESET = "跟随底座型"
EXPERT_PRESET = "专家·全自定义"
DEFAULT_TYPE = "人物"

_JSON_MISSING_COMBO = ["(LoRA栈槽位库未找到,请重启漫影或检查安装)"]

# 模块级缓存(mtime 失效):INPUT_TYPES 与 run 共用,热改即时生效
_slots_cache: dict = {"mtime": None, "entries": None}


def _load_slots() -> list:
    """daojie_lora_stack.json 现读;mtime 变化即重扫(增删改槽位即刻可见)。"""
    try:
        mtime = _STACK_JSON.stat().st_mtime
    except OSError:
        mtime = None
    cache = _slots_cache
    if cache["mtime"] == mtime and cache["entries"] is not None:
        return cache["entries"]
    if mtime is None:
        entries = []
    else:
        try:
            entries = json.loads(_STACK_JSON.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            entries = []
    cache["mtime"], cache["entries"] = mtime, entries
    return entries


def nine_types() -> list:
    """九型名现读(全槽 presets 键序的首次并集;数据纪律=每槽九型齐备,
    测试钉死与 daojie_bases.json 一比一)。"""
    seen: list = []
    for slot in _load_slots():
        if not isinstance(slot, dict):
            continue
        for t in (slot.get("presets") or {}):
            if t not in seen:
                seen.append(t)
    return seen


def preset_choices() -> list:
    """preset COMBO 值:跟随底座型 + 九型(json 序) + 专家·全自定义。"""
    nine = nine_types()
    if not nine:
        return list(_JSON_MISSING_COMBO)
    return [FOLLOW_PRESET] + nine + [EXPERT_PRESET]


def slot_widgets() -> list:
    """(slot, enable 输入名, weight 输入名) 列表,槽序=文件序。"""
    out = []
    for slot in _load_slots():
        if isinstance(slot, dict) and slot.get("key") and slot.get("file"):
            key = str(slot["key"])
            out.append((slot, f"enable_{key}", f"weight_{key}"))
    return out


def _weight_or_default(slot: dict, weight):
    """权重兜底:非法/缺省回退槽 default_weight(再兜 1.0)。"""
    default = slot.get("default_weight", 1.0)
    if isinstance(default, bool) or not isinstance(default, (int, float)):
        default = 1.0
    if isinstance(weight, bool) or not isinstance(weight, (int, float)):
        return float(default)
    return float(weight)


def resolve_plan(slots, preset, base=None, enables=None, weights=None):
    """纯函数:槽位集+preset/enable widget → (生效计划, 展示名, 急停清单)。

    生效计划=[(slot, weight)],槽序=文件序(链序敏感,勿重排)。
    enables/weights 容忍缺键(存量工作流 node 未带新槽 widget):
    enable 仅显式 False 才压停;weight 缺省回退槽 default_weight。
    未知道劫型抛 RuntimeError(镜像 MyDaojieLoras 文案纪律)。"""
    if preset == EXPERT_PRESET:
        plan, masked = [], []
        for slot in slots:
            key = str(slot.get("key", ""))
            if enables is not None and enables.get(key) is False:
                continue
            plan.append((slot, _weight_or_default(slot, (weights or {}).get(key))))
        return plan, preset, masked
    ptype = preset if preset != FOLLOW_PRESET else (base or DEFAULT_TYPE)
    nine = nine_types()
    if ptype not in nine:
        raise RuntimeError(
            f"未知道劫型:「{ptype}」。LoRA 栈现支持 {'/'.join(nine or ['(空)'])},"
            "请检查 [80]→栈节点 base 供线,或 my_nodes/nodes/daojie_lora_stack.json")
    display = f"{FOLLOW_PRESET}·{ptype}" if preset == FOLLOW_PRESET else ptype
    plan, masked = [], []
    for slot in slots:
        key = str(slot.get("key", ""))
        p = (slot.get("presets") or {}) or {}
        entry = p.get(ptype) or {}
        if not entry.get("on"):
            continue
        if enables is not None and enables.get(key) is False:
            masked.append(str(slot.get("label", key)))  # 矩阵点亮被开关急停
            continue
        w = entry.get("weight")
        if isinstance(w, bool) or not isinstance(w, (int, float)):
            print(f"[漫影 LoRA栈] 槽「{slot.get('label', key)}」{ptype} 预设权重异常,"
                  f"回退 {slot.get('default_weight', 1.0)}(请检查 daojie_lora_stack.json)")
        plan.append((slot, _weight_or_default(slot, w)))
    return plan, display, masked


class MyDaojieLoraStack:
    """漫影道劫 LoRA 栈:14 槽单节点,preset 一处切组、每槽 enable 真关+权重;
    applied 出=生效清单文本(如「跟随底座型·人物(5/14):Krea2-Turbo-4步蒸馏×1
    + …」)。"""

    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls):
        required = {
            "model": ("MODEL",),
            "preset": (preset_choices(), {"default": FOLLOW_PRESET}),
        }
        for slot, en, wt in slot_widgets():
            label = str(slot.get("label", slot["key"]))
            required[en] = ("BOOLEAN", {"default": True, "label": f"{label} 开"})
            required[wt] = ("FLOAT", {"default": _weight_or_default(slot, None),
                                      "min": -4.0, "max": 4.0, "step": 0.01,
                                      "label": f"{label} 权重"})
        return {
            "required": required,
            # forceInput(照 [85]/[61] 先例):无 widget,值由 [80].base 供线;
            # widgets_values 序恒为 [preset, (enable,weight)×N]——工作流接线
            # 对齐的前提,勿加 default。
            # enable 默认恒 True:换型亮暗全由矩阵驱动,不被默认值压暗;
            # 专家模式全默认=True(全开)风险由速查卡互斥纪律兜底(画风≤1)。
            "optional": {"base": ("COMBO", {"forceInput": True})},
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "applied")
    FUNCTION = "run"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        """json 热改须穿透引擎输出缓存(同 MyDaojieBase/MyDaojieLoras 根修:
        外部文件不进输入哈希,同输入重跑像素全同,槽位/权重改动被缓存吞)。
        返回 preset+base+json mtime 签名。"""
        try:
            return (f"{kwargs.get('preset')}|{kwargs.get('base')}"
                    f"|{_STACK_JSON.stat().st_mtime_ns}")
        except OSError:
            return float("nan")

    def run(self, model, preset, base=None, **widgets):
        slots = _load_slots()
        if not slots:
            raise RuntimeError(
                "LoRA 栈槽位库缺失或不可解析:my_nodes/nodes/daojie_lora_stack.json"
                " 未找到/非法 JSON。请在漫影设置里重新同步自研节点,或重启漫影工作室")
        if preset not in preset_choices():
            raise RuntimeError(
                f"未知 preset:「{preset}」。可选 {'/'.join(preset_choices())},"
                "请重新选择下拉,或检查 my_nodes/nodes/daojie_lora_stack.json")
        if preset == FOLLOW_PRESET and not base:
            print(f"[漫影 LoRA栈] preset=跟随底座型 但 base 未供线,"
                  f"回退「{DEFAULT_TYPE}」(正常接线=[80].base → 栈.base)")
        enables = {k[7:]: v for k, v in widgets.items() if k.startswith("enable_")}
        weights = {k[7:]: v for k, v in widgets.items() if k.startswith("weight_")}
        plan, display, masked = resolve_plan(slots, preset, base, enables, weights)

        try:
            import folder_paths
            import comfy.utils
            import comfy.sd
        except ImportError as exc:  # repo 侧测试/无引擎环境
            raise RuntimeError(
                "LoRA 栈节点须运行在漫影 ComfyUI 引擎内(缺 comfy 运行库)") from exc

        applied = []
        for slot, weight in plan:
            name = str(slot.get("file", ""))
            label = str(slot.get("label", slot.get("key", "?")))
            if not name:
                raise RuntimeError(
                    f"LoRA 栈槽位「{label}」file 字段为空,无法加载;"
                    "请检查 my_nodes/nodes/daojie_lora_stack.json")
            path = folder_paths.get_full_path("loras", name)
            if path is None:
                raise RuntimeError(
                    f"LoRA 栈槽位「{label}」文件未找到:{name};"
                    "请检查引擎模型目录或 my_nodes/nodes/daojie_lora_stack.json")
            lora = comfy.utils.load_torch_file(path, safe_load=True)
            model = comfy.sd.load_lora_for_models(model, None, lora, weight, 0.0)[0]
            applied.append(f"{Path(name).stem}×{weight:g}")
        total = len([s for s in slots if isinstance(s, dict) and s.get("file")])
        head = f"{display}({len(applied)}/{total})"
        if masked:
            head += ";开关急停:" + "/".join(masked)
        return (model, head + ":" + (" + ".join(applied) if applied else "无(直通)"))
