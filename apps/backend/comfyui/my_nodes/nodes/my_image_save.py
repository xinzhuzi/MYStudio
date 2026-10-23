# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影存图可追溯(MyImageSave,1001 TE-MAN B7 子件①仿写件)。

画布侧 prompt 可追溯:存图节点底部 prompt 面板常驻折行显示、双击复制。
本节点=核心 SaveImage 的子类(完整继承存图行为——output
目录/计数器命名/PNG 嵌 workflow+prompt 元数据,零改本体),新增 optional
STRING 口 prompt_text 显式接线(想追溯哪段文本由用户连线表达,零启发式;
槽名禁用 prompt——核心 hidden 槽名就是 prompt(=PROMPT 全 API 图),
同名即注册冲突)。执行时经 ui.myPrompt 单元素列表回传面板载荷:
引擎 execution.get_output_from_returns 对每个 ui 值做列表扁平化,
ui 值必须是列表(元素=扁平 dict),嵌套 dict 会被迭代成键名(0929 实弹
红条,AB 件同款家法)。前端件 save-prompt-panel.js onExecuted 接住后存
node.properties.mySavePrompt(随工作流保存复原),画布底部面板折行显示
(默认折叠 2 行+省略号,展开 30 行封顶),双击复制全文(单击头行切折叠)。

缓存语义如实记档:prompt_text 变更=输入变更→触发重存图(新计数器文件);
只改文本想刷面板会多存一张同图文件;输入未变时引擎缓存跳过执行=面板
维持旧值(与原生预览图行为一致,非缺陷)。

真存盘重路径不单测,由实弹阶段在引擎里现场冒烟(B1/B3 同款);引擎根层
nodes 模块按包纪律降级占位(sidecar 源码位无引擎根层,占位类与引擎
SaveImage 输入面同形,单测契约锚)。"""

from __future__ import annotations

from typing import Any

try:  # 运行位:引擎根层 nodes.py(v0.37.0 签名已核:save_images(images,
    # filename_prefix, prompt=None, extra_pnginfo=None),hidden=prompt/
    # extra_pnginfo;升级轮随批回归)
    from nodes import SaveImage
except ImportError:  # sidecar 源码位:无引擎根层——占位基类保包可导入
    class SaveImage:  # noqa: D401(占位:与引擎 SaveImage 输入面同形)
        """sidecar 占位基类:真存盘只在引擎内发生,此处只锁输入面形状。"""

        CATEGORY = "image"
        OUTPUT_NODE = True

        @classmethod
        def INPUT_TYPES(cls) -> dict[str, Any]:
            return {
                "required": {
                    "images": ("IMAGE", {"tooltip": "The images to save."}),
                    "filename_prefix": ("STRING", {"default": "ComfyUI"}),
                },
                "hidden": {
                    "prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO",
                },
            }

        RETURN_TYPES = ("IMAGE",)
        RETURN_NAMES = ("images",)
        FUNCTION = "save_images"

        def save_images(self, images: Any, filename_prefix: str = "ComfyUI",
                        prompt: Any = None, extra_pnginfo: Any = None
                        ) -> dict[str, Any]:
            raise NotImplementedError(
                "sidecar 占位:真存盘只在引擎内发生(实弹阶段现场冒烟)")


def panel_payload(prompt_text: Any) -> dict[str, Any]:
    """prompt 面板载荷(纯函数):strip 全文+字数;任何输入安全归一为 str。

    空串/空白串→{text:"", chars:0}(面板空态);非串输入(None/数字)按
    str() 归一,引擎执行图里 widget 缺省与断线均为合法到达路径。
    """
    text = "" if prompt_text is None else str(prompt_text)
    text = text.strip()
    return {"text": text, "chars": len(text)}


class MyImageSave(SaveImage):
    """漫影存图可追溯:核心存图子类 + 底部 prompt 面板(ui.myPrompt 回传)。

    输出面/FUNCTION/OUTPUT_NODE 全继承不动(存图行为=核心照旧);仅加
    optional prompt_text 口与 ui.myPrompt 单元素列表(扁平化契约)。
    """

    CATEGORY = "漫影"
    DESCRIPTION = ("存图+底部 prompt 面板(随图追溯,双击复制;"
                   "其余同核心存图)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        spec = super().INPUT_TYPES()
        # required: images/filename_prefix;hidden: prompt/extra_pnginfo
        # ——两节全继承;仅追加 optional prompt_text(与 hidden 的 prompt
        # 不同名共存,撞名即注册冲突)。
        spec["optional"] = {
            "prompt_text": ("STRING", {
                "multiline": True, "default": "",
                "tooltip": "随图追溯的提示词,接 MyPrompt.positive / "
                           "装配全文件.装配全文 等 STRING 口;留空=面板空"}),
        }
        return spec

    def save_images(self, images: Any, filename_prefix: str = "ComfyUI",
                    prompt_text: Any = "", prompt: Any = None,
                    extra_pnginfo: Any = None) -> dict[str, Any]:
        """核心存图照旧 + ui.myPrompt 单元素列表回传(前端面板数据源)。"""
        result = super().save_images(
            images, filename_prefix, prompt=prompt,
            extra_pnginfo=extra_pnginfo)
        ui = result.get("ui") if isinstance(result, dict) else None
        if not isinstance(ui, dict):
            ui = {}
            result["ui"] = ui
        ui["myPrompt"] = [panel_payload(prompt_text)]
        return result
