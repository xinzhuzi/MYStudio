# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""道劫按型线路路由(MyDaojieRoute,09-21 用户裁定:
[90] 内 9 条真实 LoRA 线路按型分流进入、汇出——替代聚合栈节点)。

base=型值([80] 选型直连);九个可选 MODEL 槽=九条线路尾;执行时把
base 对应线路的模型原样路由出去,applied 披露所选线路。
线路本身是画布上真实可见的 LoraLoaderModelOnly 链,本节点只做选线。

九个 MODEL 槽声明为 lazy 输入(09-21 概念气氛图实弹第 1 轮根修):
真前端路径 graphToPrompt 会把子图内全部 45 件 LoraLoaderModelOnly 九行
全展开进 API 图——不 lazy 时服务端须把 45 件全部执行完才轮到本节点选线,
单任务 2~5 分钟,九型并行排队时排在队尾的型 720s 内进不了 history
(引擎日志 09-21 11:52 实证:前 4 型累计 832s)。lazy 后执行器
(comfy_execution/graph.py add_node)对九槽默认不建强依赖,由
check_lazy_status 只拉起 base 对应一条线路,其余 8 行 40 件不加载
(范式同 kjnodes LazySwitchKJ;验证器仍对九槽全量做类型检查,两道门不破)。

applied 披露(09-21 晚用户令:展示该线用了哪些 LoRA;09-22 修复:屏蔽件不得
展示):hidden PROMPT+UNIQUE_ID 注入执行图,沿 base 槽回溯真实加载链——
UI→API 转换已剔除旁路(mode=4)件,走链结果=实际加载的件与画布强度,与
执行严格一致。件名从台账 daojie_lora_stack.json 取 label(未登记件退文件名
stem),链序=头(底模侧)在前。PROMPT 不可用/结构不可识别=退回台账口径
(列台账 on 件),台账缺席/坏=退回纯路线文案,永不阻断生图。限制:手动区
悬空桩接线不在台账,不进披露(但走链口径能捕获台账外真实加载件)。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]

_LEDGER = Path(__file__).resolve().parent / "daojie_lora_stack.json"
_PLAIN = "路线={base}线(9条真实线路按型分流)"
_LOADER = "LoraLoaderModelOnly"


def _walk_applied(prompt: Any, unique_id: Any, base: str) -> list[tuple[str, float]] | None:
    """沿执行图 base 槽回溯真实加载链(09-22 修复:披露与实际执行一致)。

    旁路件在 UI→API 转换期已被剔除,故走链只含真正加载的件;强度取加载器
    画布值。起点不是链接/节点缺失=结构不可识别返回 None(退台账口径);
    首个上游就是非加载器=全线旁路,返回 [](0 件是真实态,不是失败)。
    """
    if not isinstance(prompt, dict):
        return None
    me = prompt.get(str(unique_id))
    if me is None and unique_id is not None:
        me = prompt.get(unique_id)
    src = ((me or {}).get("inputs") or {}).get(base)
    if not isinstance(src, list) or len(src) != 2:
        return None
    chain: list[tuple[str, float]] = []
    seen: set[str] = set()
    hops = 0
    while isinstance(src, list) and len(src) == 2 and hops < 64:
        nid = str(src[0])
        node = prompt.get(nid) or {}
        if nid in seen or node.get("class_type") != _LOADER:
            break
        win = node.get("inputs") or {}
        # API 真名=lora_name/strength_model(前端画布显示名 lora/strength 不入 API;
        # 09-22 真弹验证抓出此坑,双名兼容防旧形状)
        name = win.get("lora_name") or win.get("lora")
        strength = win.get("strength_model", win.get("strength", 1.0))
        if not isinstance(name, str):
            break
        seen.add(nid)
        chain.append((name, float(strength) if isinstance(strength, (int, float)) else 1.0))
        src = win.get("model")
        hops += 1
    if not chain:
        return []
    chain.reverse()  # 头(底模侧)在前,与台账文件序对齐
    return chain


def _ledger_labels() -> dict[str, str]:
    pieces = json.loads(_LEDGER.read_text(encoding="utf-8"))
    return {p["file"]: p.get("label") or Path(p["file"]).stem for p in pieces}


def _line_disclosure(base: str, applied: list[tuple[str, float]] | None = None) -> str:
    plain = _PLAIN.format(base=base)
    if applied is not None:
        # 执行图口径(09-22 用户令:屏蔽加载的件不得展示):只列真实加载的件
        try:
            labels = _ledger_labels()
        except Exception:
            labels = {}
        if not applied:
            return f"路线={base}线·0件(全旁路,直连底模)"
        parts = [f"{labels.get(f, Path(f).stem)}×{s:g}" for f, s in applied]
        return f"路线={base}线·{len(parts)}件 | {' → '.join(parts)}"
    # 台账口径(兜底,PROMPT 不可用时):列台账 on 件
    try:
        pieces = json.loads(_LEDGER.read_text(encoding="utf-8"))
        parts = [
            f"{p['label']}×{p['presets'][base]['weight']:g}"
            for p in pieces
            if (p.get("presets") or {}).get(base, {}).get("on")
        ]
    except Exception:
        return plain
    if not parts:
        return plain
    return f"路线={base}线·{len(parts)}件 | {' → '.join(parts)}"


class MyDaojieRoute:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        # base 用裸 "COMBO" 型而非九型列表:服务端 validate_node_input 对组合框
        # 列表输入只认纯值(链接形态 received_type="COMBO" vs input_type=列表
        # 字符串→必拒,09-21 道劫子图实弹炸过);[90] 宿主侧的用户下拉由子图
        # inputs[].type_data(九型列表)提供,不受此影响。值层仍是九型字符串,
        # route() 内已做成员校验。
        return {
            "required": {"base": ("COMBO",)},
            "optional": {zh: ("MODEL", {"lazy": True}) for zh in NINE},
            # 09-22:PROMPT=执行图全量(UNIQUE_ID=自身id),供披露走真实加载链
            # (旁路件转换期已剔除);hidden 不进前端渲染与类型校验,旧工作流兼容。
            "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("MODEL", "STRING")
    RETURN_NAMES = ("model", "applied")
    FUNCTION = "route"
    CATEGORY = "漫影/道劫"

    def check_lazy_status(self, base: str | None = None, **kwargs: Any) -> list[str] | None:
        """九条线路全 lazy:执行期只请求 base 对应线路(未执行槽收 None)。"""
        if base is not None and base in NINE and kwargs.get(base) is None:
            return [base]
        return None

    def route(self, base: str, **kwargs: Any) -> tuple[Any, str]:
        picked = kwargs.get(base)
        if picked is None:
            wired = [k for k in NINE if kwargs.get(k) is not None]
            raise ValueError(
                f"型「{base}」的线路未接线(已接:{wired or '无'})——请在 [90] 子图内把该型线路尾连到本节点对应槽")
        walked = _walk_applied(kwargs.get("prompt"), kwargs.get("unique_id"), base)
        return (picked, _line_disclosure(base, walked))


NODE_CLASS_MAPPINGS = {"MyDaojieRoute": MyDaojieRoute}
NODE_DISPLAY_NAME_MAPPINGS = {"MyDaojieRoute": "道劫·按型线路路由"}
