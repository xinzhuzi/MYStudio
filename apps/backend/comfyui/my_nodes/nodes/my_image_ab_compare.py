# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影图对比审片器(MyImageABCompare,0929 TE-MAN 排查 B2 仿写件)。

画布侧审片件:关键帧迭代时把新旧两版图接进来肉眼对比(应用侧生成记录
对比已有,本件补画布上关键帧迭代场景)。形态=透传旁观件:IMAGE 双入
双出原样透传,可串在产物链上任一位置;执行时把 A/B 首帧 PNG 落引擎
temp 目录(ui.abCompare 携 /view 可取的文件引用;ui 值=双元素列表
[侧a,侧b]——引擎 execution.get_output_from_returns 对每个 ui 值做
列表扁平化,嵌套 dict 会被迭代成键名,0929 实弹红条),前端节点件
(my-image-ab-compare.js)onExecuted 接住后全程 canvas 自绘——滑动帘
横拖对比 + 2-7x 放大镜悬停放大。对比交互(帘位/倍率/镜位)全在前端
完成,执行后零后端往返;交互状态存 node.properties 随工作流携带。

批>1 时取每路首帧入镜(ui 报 batch 数)。纯逻辑(倍率夹取/档位循环/
帘位夹取/校验)模块级零依赖供单测直测;PIL/folder_paths 引擎库全部
函数内懒加载(同包 my_cloud_image 先例);temp 落盘重路径不单测,由
实弹阶段在引擎里现场冒烟。
"""

from __future__ import annotations

import os
from typing import Any

from ._input_writeback import frame_to_uint8

# 放大镜倍率区间:下限 2x / 上限 7x(设计真源 B2 行口径,widget/夹取双保险)
ZOOM_MIN = 2.0
ZOOM_MAX = 7.0
# 倍率档位(画布按钮循环次序;含上下限,首项=默认)
ZOOM_STEPS: tuple[float, ...] = (2.0, 3.0, 4.0, 5.0, 7.0)

DEFAULT_CURTAIN = 0.5  # 帘位初值=正中(A 左半 / B 右半)


def clamp_ratio(value: Any) -> float:
    """0-1 夹取(帘位/镜位通用;非数/NaN 兜回正中)。"""
    try:
        x = float(value)
    except (TypeError, ValueError):
        return DEFAULT_CURTAIN
    if x != x:  # NaN
        return DEFAULT_CURTAIN
    return min(max(x, 0.0), 1.0)


def clamp_zoom(zoom: Any) -> float:
    """倍率夹取进 [2,7](非数/越界一律夹回界内)。"""
    try:
        z = float(zoom)
    except (TypeError, ValueError):
        return ZOOM_MIN
    if z != z:  # NaN
        return ZOOM_MIN
    return min(max(z, ZOOM_MIN), ZOOM_MAX)


def next_zoom(zoom: Any) -> float:
    """档位循环:按当前倍率取 ZOOM_STEPS 下一档(超界回落首档 2x)。

    当前值恰在档位上→下一档;落在档间→就近升档(尾部则绕回首档)。
    """
    z = clamp_zoom(zoom)
    for step in ZOOM_STEPS:
        if z < step:
            return step
    return ZOOM_STEPS[0]


def lens_center(cx: Any, cy: Any) -> tuple[float, float]:
    """镜心归一化坐标(各自独立 0-1 夹取;放大镜取样中心)。"""
    return (clamp_ratio(cx), clamp_ratio(cy))


def validate_ab_images(images_a: Any, images_b: Any) -> None:
    """双路 IMAGE 批校验:各非空;违例中文报错(空批=上游没有可看之图)。"""
    for name, images in (("A 路", images_a), ("B 路", images_b)):
        if images is None or len(images) == 0:
            raise ValueError(
                f"图对比 {name}收到空 IMAGE 批——上游没有可对比的图")


def _write_frame_to_temp(array: Any, filename_prefix: str, suffix: str,
                         width: int, height: int) -> dict[str, Any]:
    """uint8 单帧 PNG 写引擎 temp 目录 → ui 引用(/view 可取;纯预览不占 input)。

    与 _input_writeback 同族但落 temp(审片预览语义,非回灌新输入);
    PIL/folder_paths 函数内懒加载;命名走 ComfyUI 计数器口径防覆盖。
    """
    from PIL import Image
    import folder_paths

    full_folder, filename, counter, subfolder, _prefix = (
        folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_temp_directory(), width, height))
    name = f"{filename}_{counter:05}_{suffix}.png"
    Image.fromarray(array).save(os.path.join(full_folder, name), format="PNG")
    return {"filename": name, "subfolder": subfolder, "type": "temp"}


class MyImageABCompare:
    """漫影图对比审片器:IMAGE 双入双出透传 + A/B 首帧落 temp 供画布滑帘对比。

    前端件 canvas 自绘滑动帘+2-7x 放大镜(零后端交互);倍率区间=ZOOM_MIN~
    ZOOM_MAX;帘位/镜位/倍率状态存 node.properties(随工作流保存复原)。
    """

    CATEGORY = "漫影"
    OUTPUT_NODE = True
    DESCRIPTION = ("A/B 双图透传旁观对比:首帧落 temp,画布滑动帘+2-7x "
                   "放大镜纯前端对比(关键帧迭代审片;零后端交互)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "image_a": ("IMAGE", {"tooltip": "A 路图(画面左侧/帘左;"
                                              "透传输出可继续串链)"}),
                "image_b": ("IMAGE", {"tooltip": "B 路图(画面右侧/帘右;"
                                              "与 A 路对比的迭代新版)"}),
            },
            "optional": {
                "label_a": ("STRING", {"default": "A",
                                        "tooltip": "A 路标签(画布角标显示)"}),
                "label_b": ("STRING", {"default": "B",
                                        "tooltip": "B 路标签(画布角标显示)"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE")
    RETURN_NAMES = ("image_a", "image_b")
    FUNCTION = "compare"

    def compare(self, image_a: Any, image_b: Any, label_a: str = "A",
                label_b: str = "B") -> dict[str, Any]:
        """双路首帧落 temp + 原样透传;返回 ui.abCompare(前端滑帘取图用)。"""
        validate_ab_images(image_a, image_b)
        sides = []
        for side, (images, label, prefix, suffix) in (
                ("a", (image_a, label_a, "my_ab_compare_a", "a00000")),
                ("b", (image_b, label_b, "my_ab_compare_b", "b00000"))):
            array = frame_to_uint8(images[0])
            height, width = int(array.shape[0]), int(array.shape[1])
            entry = _write_frame_to_temp(array, prefix, suffix, width, height)
            entry.update({"side": side, "label": str(label), "width": width,
                          "height": height, "batch": int(len(images))})
            sides.append(entry)
        return {"ui": {"abCompare": sides},
                "result": (image_a, image_b)}
