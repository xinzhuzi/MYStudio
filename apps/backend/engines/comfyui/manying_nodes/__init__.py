# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影自研 ComfyUI 节点包(09-09 comfyui-frontend-swap 阶段1 第一梯队)。

源码位=engines/comfyui/manying_nodes(随 backend 平铺打包);运行位=
<comfyui-home>/ComfyUI/custom_nodes/manying-nodes/(plugin_manager 硬拷,
design.md 2.1)。引擎库(torch/PIL/folder_paths)全懒加载——源码位可在
sidecar pytest 里验契约。业务语义层见 lib/studio/image-workflow。
"""

from .nodes.manying_prompt import ManyingPrompt
from .nodes.manying_reference import ManyingReference
from .nodes.manying_generated import ManyingGenerated
from .nodes.manying_shot import ManyingShot

NODE_CLASS_MAPPINGS = {
    "ManyingPrompt": ManyingPrompt,
    "ManyingReference": ManyingReference,
    "ManyingGenerated": ManyingGenerated,
    "ManyingShot": ManyingShot,
}

# ComfyUI 前端扩展目录声明(无此=web/ 下 JS 不进 /extensions,不可见)
WEB_DIRECTORY = "./web"

NODE_DISPLAY_NAME_MAPPINGS = {
    "ManyingPrompt": "漫影 提示词",
    "ManyingReference": "漫影 参考图",
    "ManyingGenerated": "漫影 成图回写",
    "ManyingShot": "漫影 分镜",
}
