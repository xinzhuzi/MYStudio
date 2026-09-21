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

applied 披露(09-21 晚用户令:展示该线用了哪些 LoRA):按 base 从同目录台账
daojie_lora_stack.json 拼「路线=X线·N件 | 件名×强度 → …」(链序=文件序;
台账与九行由 test_workflow_subgraph_contract 锁单源一比一)。台账缺席/坏
=退回纯路线文案,永不阻断生图。限制:手动区悬空桩接线不在台账,不进披露。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]

_LEDGER = Path(__file__).resolve().parent / "daojie_lora_stack.json"
_PLAIN = "路线={base}线(9条真实线路按型分流)"


def _line_disclosure(base: str) -> str:
    plain = _PLAIN.format(base=base)
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
        return (picked, _line_disclosure(base))


NODE_CLASS_MAPPINGS = {"MyDaojieRoute": MyDaojieRoute}
NODE_DISPLAY_NAME_MAPPINGS = {"MyDaojieRoute": "道劫·按型线路路由"}
