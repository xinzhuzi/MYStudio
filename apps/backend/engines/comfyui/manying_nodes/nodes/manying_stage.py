# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""流程环节节点(旧分镜画布工作流链迁移,09-11):

旧 React Flow 分镜画布的七环节链(剧本→导演规划→[衍生资产]→分镜表→
分镜面板→单镜视频生产→视频工作台)迁入 ComfyUI 的展示锚点。不参与
执行:环节名/实时摘要/状态随 widget 展示;upstream→output 的
MANYING_FLOW 链只作连线语义(Queue 空跑无害,同 ManyingShot 先例)。
环节动作(生成/生图/渲染)不在节点上触发——归「漫影」侧栏与悬浮球
阶段直达(design.md D4)。
"""

from __future__ import annotations


class ManyingStage:
    CATEGORY = "manying"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "stage_key": ("STRING", {"default": ""}),
                "title": ("STRING", {"default": ""}),
                "summary": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                "status": ("STRING", {"default": ""}),
                "upstream": ("MANYING_FLOW",),
            },
        }

    RETURN_TYPES = ("MANYING_FLOW",)
    FUNCTION = "run"
    OUTPUT_NODE = True

    def run(self, stage_key, title, summary, status="", upstream=None):
        return {
            "ui": {"manying_stage": {"stageKey": stage_key, "title": title, "status": status}},
            "result": ("flow",),
        }
