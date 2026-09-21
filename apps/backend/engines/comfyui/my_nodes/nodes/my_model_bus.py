# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""模型分线排(MyModelBus,09-21 v11:[90] 子图左侧走线治理)。

子图内 9 条真实线路的行首若全部直连入口节点(-10.model 单槽),左侧必然
形成 9 线扇形;本节点把模型干线一分九,九个输出槽逐行对齐九条线路行首,
走线全部水平。纯透传(模型原样进出),与 MyDaojieRoute 同族:只走线,
不加载。
"""
from typing import Any

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]


class MyModelBus:
    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {"required": {"model": ("MODEL",)}}

    RETURN_TYPES = tuple("MODEL" for _ in NINE)
    RETURN_NAMES = tuple(NINE)
    FUNCTION = "split"
    CATEGORY = "漫影/道劫"

    def split(self, model: Any) -> tuple[Any, ...]:
        return (model,) * len(NINE)


NODE_CLASS_MAPPINGS = {"MyModelBus": MyModelBus}
NODE_DISPLAY_NAME_MAPPINGS = {"MyModelBus": "道劫·模型分线排(1进9出)"}
