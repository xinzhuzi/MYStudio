# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""参考图节点:input 目录读图(编号语义由业务侧栏注入文件名,阶段2 接)。"""

from __future__ import annotations


class ManyingReference:
    CATEGORY = "manying"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_name": ("STRING", {"default": "", "placeholder": "bridge 上传的文件名(hash 命名)"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "run"

    def run(self, image_name):
        import folder_paths  # 引擎侧,懒加载
        from PIL import Image
        import numpy as np
        import torch

        path = folder_paths.get_annotated_filepath(image_name)
        try:
            image = Image.open(path)
        except Exception as exc:
            raise RuntimeError(f"参考图不存在或不可读:{image_name}({exc});参考图由漫影资产库经 bridge 上传,请在漫影里重新发起") from exc
        image = image.convert("RGB")
        array = np.array(image).astype(np.float32) / 255.0
        return (torch.from_numpy(array)[None,],)
