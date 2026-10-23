# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影宫格切割回灌(MyImageGridSplit,0929 TE-MAN 排查 B3 仿写件)。

一次生成 N 宫格(K2/云端直出 2×2/3×3 拼格)后,本节点把宫格图按 rows×cols
逐格切割,每格 PNG 写回引擎 input 目录变新输入(LoadImage 直接可选;文件名
={前缀}_{计数}_{r行c列}.png,ComfyUI 计数器口径防覆盖)。切割=PIL crop 像素
盒语义:先可选框选 crop(归一化 0-1,默认 0/0/1/1=不裁),再对盒内 floor 边界
切格——并集恰=原盒、格间互不重叠、右/下边缘格吸收整除余数。IMAGE 批>1 时
逐张切割各自成套(计数器随之递增)。

⚠️ A5 铁约束(docs/comfyui-kb/参考_TE-MAN可吸收排查.md §A5,v1.0 演示管线
同款口径):宫格图只作中间产物、切割后再用;宫格图本身绝不当视频参考——
视频模型会把宫格版式带进成片(版式泄漏)。本节点即该约束的落地形态:出口
永远是切割后的单格文件,绝不回吐宫格图。

纯逻辑(几何/命名/校验)模块级零依赖供单测直测;PIL/folder_paths 引擎库
全部函数内懒加载(同包 my_cloud_image 先例);存盘重路径不单测,由实弹
阶段在引擎里现场冒烟。
"""

from __future__ import annotations

from typing import Any

from ._input_writeback import (
    frame_to_uint8, input_name, write_arrays_to_input)

MAX_GRID_AXIS = 8  # 单轴格数上限(8×8=64 格;widget max 同值双保险)


def validate_grid_shape(rows: Any, cols: Any) -> None:
    """行列校验:各为 ≥1 整数且 ≤MAX_GRID_AXIS;违例中文报错。

    (widget min/max 已挡常规路径;此处兜住 /prompt 直投与直调。)
    """
    for name, value in (("行数 rows", rows), ("列数 cols", cols)):
        if not isinstance(value, int) or isinstance(value, bool) or value < 1:
            raise ValueError(
                f"宫格切割 {name} 须为 ≥1 的整数,收到:{value!r}")
        if value > MAX_GRID_AXIS:
            raise ValueError(
                f"宫格切割 {name} 上限 {MAX_GRID_AXIS}(防误切海量小格),"
                f"收到:{value}")


def resolve_crop_box(width: int, height: int, left: float, top: float,
                     right: float, bottom: float) -> tuple[int, int, int, int]:
    """归一化框选(0-1,越界值夹回)→像素盒 (x0,y0,x1,y1);默认整幅。

    按边长半进位取整;取整后不足 1px 的空盒抛中文错(小图窄条常见)。
    """

    def _axis(size: int, lo: float, hi: float, lo_name: str,
              hi_name: str) -> tuple[int, int]:
        lo = min(max(float(lo), 0.0), 1.0)
        hi = min(max(float(hi), 0.0), 1.0)
        a = min(int(lo * size + 0.5), size)
        b = min(int(hi * size + 0.5), size)
        if b - a < 1:
            raise ValueError(
                f"宫格切割框选区过小:{lo_name}~{hi_name} 取整后不足 1 像素"
                f"(边长 {size}px,收到 {lo:.3f}~{hi:.3f})——请扩大框选")
        return a, b

    x0, x1 = _axis(width, left, right, "左", "右")
    y0, y1 = _axis(height, top, bottom, "上", "下")
    return (x0, y0, x1, y1)


def grid_cell_boxes(box: tuple[int, int, int, int], rows: int, cols: int
                    ) -> list[tuple[int, int, int, int]]:
    """像素盒 → rows×cols 格盒列表(行主序:先左→右,再上→下)。

    floor 边界 x0+(w*c)//cols:并集恰=原盒、互不重叠、边缘格吸收余数;
    待切区宽/高不足列/行数(必有 0 像素格)抛中文错。
    """
    validate_grid_shape(rows, cols)
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    if w < cols or h < rows:
        raise ValueError(
            f"宫格切割像素不足:待切区 {w}×{h}px 撑不起 {rows}×{cols} 格"
            "(每格至少 1 像素)——请减小行列数或扩大框选")
    boxes: list[tuple[int, int, int, int]] = []
    for r in range(rows):
        ys, ye = y0 + (h * r) // rows, y0 + (h * (r + 1)) // rows
        for c in range(cols):
            xs, xe = x0 + (w * c) // cols, x0 + (w * (c + 1)) // cols
            boxes.append((xs, ys, xe, ye))
    return boxes


def cell_suffixes(rows: int, cols: int) -> list[str]:
    """格标识 r{行}c{列}(文件名与 ui 同源,行主序)。"""
    return [f"r{r}c{c}" for r in range(rows) for c in range(cols)]


def cell_filenames(base: str, counter: int, rows: int, cols: int) -> list[str]:
    """一次切割全套格件名(纯函数;口径=input_name,计数器段随 ComfyUI 解析)。"""
    return [input_name(base, counter, s) for s in cell_suffixes(rows, cols)]


class MyImageGridSplit:
    """漫影宫格切割回灌:宫格 IMAGE → rows×cols 单格 PNG 写回 input 目录。

    ⚠️ A5 铁约束:宫格图只作中间产物、切割后再用;「宫格图本身绝不当视频参考」
    (视频模型会把宫格版式带进成片)。本节点出口=切割后的单格文件,
    永不回吐宫格图。框选 crop 归一化 0-1(默认整幅);格命名 r行c列。
    """

    CATEGORY = "漫影"
    OUTPUT_NODE = True
    DESCRIPTION = ("宫格图按 rows×cols 逐格切割成 PNG 写回输入目录变新输入"
                   "(A5 铁约束:宫格图只作中间产物,绝不当视频参考)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "images": ("IMAGE", {"tooltip": "宫格图(中间产物;切割后再用,绝不当视频参考)"}),
                "rows": ("INT", {"default": 2, "min": 1, "max": MAX_GRID_AXIS,
                                  "step": 1, "tooltip": "切几行(1-8)"}),
                "cols": ("INT", {"default": 2, "min": 1, "max": MAX_GRID_AXIS,
                                  "step": 1, "tooltip": "切几列(1-8)"}),
                "filename_prefix": ("STRING", {
                    "default": "my_grid_split",
                    "tooltip": "写回 input 的文件名前缀(可带子目录)"}),
            },
            "optional": {
                "crop_left": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0,
                                         "step": 0.001, "tooltip": "框选左界(归一化 0-1)"}),
                "crop_top": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 1.0,
                                        "step": 0.001, "tooltip": "框选上界(归一化 0-1)"}),
                "crop_right": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0,
                                          "step": 0.001, "tooltip": "框选右界(归一化 0-1)"}),
                "crop_bottom": ("FLOAT", {"default": 1.0, "min": 0.0, "max": 1.0,
                                           "step": 0.001, "tooltip": "框选下界(归一化 0-1)"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("input_names",)
    FUNCTION = "split"

    def split(self, images: Any, rows: int, cols: int, filename_prefix: str,
              crop_left: float = 0.0, crop_top: float = 0.0,
              crop_right: float = 1.0, crop_bottom: float = 1.0
              ) -> dict[str, Any]:
        """逐张切割写回;返回 ui.images(input 件)+ input_names(换行串)。"""
        validate_grid_shape(rows, cols)
        if len(images) == 0:
            raise ValueError("宫格切割收到空 IMAGE 批——上游没有可切之图")
        ui_images: list[dict[str, Any]] = []
        display_names: list[str] = []
        for grid in images:
            array = frame_to_uint8(grid)
            height, width = array.shape[0], array.shape[1]
            box = resolve_crop_box(width, height, crop_left, crop_top,
                                   crop_right, crop_bottom)
            boxes = grid_cell_boxes(box, rows, cols)
            cells = [array[ys:ye, xs:xe] for xs, ys, xe, ye in boxes]
            added_ui, added_names = write_arrays_to_input(
                cells, filename_prefix, width, height,
                cell_suffixes(rows, cols))
            ui_images.extend(added_ui)
            display_names.extend(added_names)
        return {"ui": {"images": ui_images},
                "result": ("\n".join(display_names),)}
