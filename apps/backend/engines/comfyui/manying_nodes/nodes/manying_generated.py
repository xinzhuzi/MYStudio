# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""成图回写终端节点:收 IMAGE+目标 → bridge 落 sidecar(台账口径不变)。

输出不走 ComfyUI output/(09-08 裁定):图像经 bridge 收件箱转运,渲染层
既有链落 项目 store/媒体库/台账/分镜。失败抛大白话=画布可见执行错误。
"""

from __future__ import annotations


class ManyingGenerated:
    CATEGORY = "manying"
    OUTPUT_NODE = True

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "shot_target": ("STRING", {"default": "", "placeholder": "回写目标(镜号),业务侧栏注入"}),
            },
            "optional": {
                "prompt": ("STRING", {"default": "", "multiline": True}),
                "meta": ("STRING", {"default": "", "multiline": True, "placeholder": "JSON:参考指纹/模型/seed 等"}),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "run"

    def run(self, images, shot_target, prompt="", meta=""):
        from ..bridge import writeback as _writeback

        body = _writeback.deliver(images, shot_target, prompt, meta)
        return {
            "ui": {"manying": {"shotTarget": shot_target, "acceptedId": body.get("id")}},
            "result": {"delivered": True},
        }
