# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""镜节点(主分镜视图 ComfyUI 化,09-09 批7):章节总览图的展示单元。

不参与执行(纯展示/导航锚点):镜号/描述/媒体生产状态随 widget 展示;
选中后业务侧栏(漫影)提供该镜的生产动作入口。
"""

from __future__ import annotations


class ManyingShot:
    CATEGORY = "manying"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "shot_id": ("STRING", {"default": ""}),
                "label": ("STRING", {"default": ""}),
                "description": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                "media_status": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True

    def run(self, shot_id, label, description, media_status=""):
        return {
            "ui": {"manying_shot": {"shotId": shot_id or label, "label": label, "status": media_status}},
            "result": (),
        }
