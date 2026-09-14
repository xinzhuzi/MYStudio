# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影自研 ComfyUI 节点包(09-09 comfyui-frontend-swap 阶段1 第一梯队)。

源码位=engines/comfyui/my_nodes(随 backend 平铺打包);运行位=
<comfyui-home>/ComfyUI/custom_nodes/my-nodes/(plugin_manager 硬拷,
design.md 2.1)。引擎库(torch/PIL/folder_paths)全懒加载——源码位可在
sidecar pytest 里验契约。业务语义层见 lib/studio/image-workflow。

09-14 manying→my 改名:注册面正名 My*(CATEGORY=my);旧键 Manying* 以
DEPRECATED 别名保留——存量工作流(库 JSON/用户存档)按旧名照常加载执行,
object_info 标 deprecated=前端默认从菜单/搜索隐藏(Comfy.Node.ShowDeprecated
默认关),不会出现重复菜单项。显示名维持「漫影 …」用户裁定不变。
"""

from .nodes.my_prompt import MyPrompt
from .nodes.my_reference import MyReference
from .nodes.my_generated import MyGenerated
from .nodes.my_shot import MyShot
from .nodes.my_cloud_image import MyCloudImage
from .nodes.my_stage import MyStage
from . import cloud_takeover


class MyPromptLegacy(MyPrompt):
    """旧键 "ManyingPrompt" 兼容别名(仅存量工作流加载,菜单隐藏)。"""

    DEPRECATED = True


class MyReferenceLegacy(MyReference):
    """旧键 "ManyingReference" 兼容别名。"""

    DEPRECATED = True


class MyGeneratedLegacy(MyGenerated):
    """旧键 "ManyingGenerated" 兼容别名。"""

    DEPRECATED = True


class MyShotLegacy(MyShot):
    """旧键 "ManyingShot" 兼容别名。"""

    DEPRECATED = True


class MyCloudImageLegacy(MyCloudImage):
    """旧键 "ManyingCloudImage" 兼容别名。"""

    DEPRECATED = True


class MyStageLegacy(MyStage):
    """旧键 "ManyingStage" 兼容别名:连线类型钉回旧 MANYING_FLOW,
    使纯旧链(旧 JSON 里 links 两端都是旧类型)校验自洽。"""

    DEPRECATED = True
    RETURN_TYPES = ("MANYING_FLOW",)

    @classmethod
    def INPUT_TYPES(cls):
        spec = MyStage.INPUT_TYPES()
        spec["optional"]["upstream"] = ("MANYING_FLOW",)
        return spec


# 云端收编二轮(09-10 纠偏):云端节点全保留,凭据经补丁改道漫影网关
# (URL 侧由 engine_manager 叠官方 --comfy-api-base;上游漂移时静默回落)。
cloud_takeover.apply_cloud_takeover()

NODE_CLASS_MAPPINGS = {
    "MyPrompt": MyPrompt,
    "MyReference": MyReference,
    "MyGenerated": MyGenerated,
    "MyShot": MyShot,
    "MyCloudImage": MyCloudImage,
    "MyStage": MyStage,
    # 旧名别名(09-14 改名前存量工作流的节点 type 键)
    "ManyingPrompt": MyPromptLegacy,
    "ManyingReference": MyReferenceLegacy,
    "ManyingGenerated": MyGeneratedLegacy,
    "ManyingShot": MyShotLegacy,
    "ManyingCloudImage": MyCloudImageLegacy,
    "ManyingStage": MyStageLegacy,
}

# ComfyUI 前端扩展目录声明(无此=web/ 下 JS 不进 /extensions,不可见)
WEB_DIRECTORY = "./web"

NODE_DISPLAY_NAME_MAPPINGS = {
    "MyPrompt": "漫影 提示词",
    "MyReference": "漫影 参考图",
    "MyGenerated": "漫影 成图回写",
    "MyShot": "漫影",
    "MyCloudImage": "漫影 云端生图",
    "MyStage": "漫影 环节",
    # 旧键同名显示(画布上旧工作流节点标题照旧渲染「漫影 …」)
    "ManyingPrompt": "漫影 提示词",
    "ManyingReference": "漫影 参考图",
    "ManyingGenerated": "漫影 成图回写",
    "ManyingShot": "漫影",
    "ManyingCloudImage": "漫影 云端生图",
    "ManyingStage": "漫影 环节",
}
