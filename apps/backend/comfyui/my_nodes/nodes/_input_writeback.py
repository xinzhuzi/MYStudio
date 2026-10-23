# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""帧写回引擎 input 目录共享件(B1 截帧/B3 切格 0929 件私有底座;零注册)。

命名口径=ComfyUI SaveImage 计数器语义:{base}_{counter:05}_{suffix}.png——
folder_paths.get_save_image_path 扫描同前缀既有文件自增 counter(同次多帧
共享 counter、以 suffix 互斥,不覆盖历史产物);子目录随 filename_prefix
的目录段落地。PIL/folder_paths 引擎库全部函数内懒加载(源码位 sidecar
可测纪律,同包 my_cloud_image 先例)。
"""

from __future__ import annotations

import os
from typing import Any, Sequence

import numpy as np

# 通道数→PIL 模式(IMAGE 常规 3 通道;带 alpha 4 通道)
IMAGE_MODES: dict[int, str] = {3: "RGB", 4: "RGBA"}


def frame_to_uint8(frame: Any) -> np.ndarray:
    """IMAGE 单帧([H,W,C] float 0-1;torch/numpy 双态防御)→ uint8 数组。

    取整口径=(x*255).round(),与包内 my_cloud_image 出图侧一致。
    """
    for op in ("detach", "cpu"):
        if callable(getattr(frame, op, None)):
            frame = getattr(frame, op)()
    if callable(getattr(frame, "clamp", None)):
        frame = frame.clamp(0, 1)
    if callable(getattr(frame, "numpy", None)):
        frame = frame.numpy()
    return (np.asarray(frame, dtype="float32") * 255.0).round().astype("uint8")


def input_name(base: str, counter: int, suffix: str) -> str:
    """ComfyUI 计数器口径文件名(纯函数;counter 五位补零,suffix=格/帧标识)。"""
    return f"{base}_{counter:05}_{suffix}.png"


def write_arrays_to_input(arrays: Sequence[Any], filename_prefix: str,
                          width: int, height: int, suffixes: Sequence[str],
                          ) -> tuple[list[dict[str, Any]], list[str]]:
    """uint8 帧序列写回 input 目录 → (ui images 结果, 展示名列表)。

    ui 结果 type="input"(LoadImage 即取);展示名=子目录/文件名(LoadImage
    取值口径)。width/height 仅参与前缀 %width%/%height% 变量替换(以源图/
    源视频尺寸为准)。arrays 与 suffixes 等长且非空,违者程序性报错。
    """
    from PIL import Image
    import folder_paths

    if len(arrays) == 0:
        raise ValueError("写回 input 收到空帧序列——没有任何可写内容")
    if len(arrays) != len(suffixes):
        raise ValueError(
            f"写回 input 帧数与命名数不一致({len(arrays)} vs {len(suffixes)})")
    full_folder, filename, counter, subfolder, _prefix = (
        folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_input_directory(), width, height))
    ui_images: list[dict[str, Any]] = []
    display_names: list[str] = []
    for array, suffix in zip(arrays, suffixes):
        channels = array.shape[2] if array.ndim == 3 else 0
        if channels not in IMAGE_MODES:
            raise ValueError(
                f"写回 input 只认 3/4 通道图,收到 {channels} 通道——"
                "请检查上游 IMAGE 是否为常规 RGB/RGBA")
        name = input_name(filename, counter, suffix)
        Image.fromarray(array).save(os.path.join(full_folder, name), format="PNG")
        ui_images.append({"filename": name, "subfolder": subfolder, "type": "input"})
        display_names.append(f"{subfolder}/{name}" if subfolder else name)
    return ui_images, display_names
