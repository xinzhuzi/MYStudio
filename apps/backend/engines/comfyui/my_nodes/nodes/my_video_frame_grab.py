# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影视频截帧回灌(MyVideoFrameGrab,0929 TE-MAN 排查 B1 仿写件)。

keyframes 体系「出片→抽帧→候选关键帧→回接」最后一跳:输入 VIDEO(核心
LoadVideo 或任一视频产出节点直供),按抽帧策略取 N 帧,每帧 PNG 写回引擎
input 目录变新输入(LoadImage/参考图体系即取;文件名={前缀}_{计数}_
{f帧号}.png,ComfyUI 计数器口径防覆盖)。

帧对齐=frame_count 口径:以解码批实际帧数为总数、按帧号精确取帧(引擎
Input.Video.get_components() 解码;帧号 index 语义与 ffmpeg/cv2 逐帧抽取
同构,无时间取整漂移)。抽帧数大于总帧数时取全帧。长视频请先接核心
VideoSlice/VideoTrim 裁窗(本节点全量解码进内存)。

纯逻辑(抽帧计划/命名/校验)模块级零依赖供单测直测;PIL/folder_paths/
视频解码引擎库全部函数内懒加载;解码存盘重路径不单测,由实弹阶段在
引擎里现场冒烟。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

from ._input_writeback import (
    frame_to_uint8, input_name, write_arrays_to_input)

# 抽帧策略表:combo 顺序即画布下拉顺序,首项=默认=均匀;
# 元组=(策略串, 计划器键);分隔符=U+00B7 中点(随包内 combo 先例)。
FRAME_STRATEGIES: tuple[tuple[str, str], ...] = (
    ("均匀 · 等距N帧", "uniform"),
    ("头部 · 前N帧", "head"),
    ("尾部 · 后N帧", "tail"),
)

STRATEGY_NAMES: list[str] = [name for name, _key in FRAME_STRATEGIES]
DEFAULT_STRATEGY: str = STRATEGY_NAMES[0]

MAX_FRAME_COUNT = 512  # 单次抽帧上限(widget max 同值双保险)


def validate_frame_request(total_frames: Any, frame_count: Any) -> None:
    """总帧数/抽帧数校验:各为 ≥1 整数,frame_count 另受上限;违例中文报错。"""
    if (not isinstance(total_frames, int) or isinstance(total_frames, bool)
            or total_frames < 1):
        raise ValueError(
            f"视频截帧:源视频帧数无效({total_frames!r})——"
            "请检查视频文件是否可解码")
    if (not isinstance(frame_count, int) or isinstance(frame_count, bool)
            or frame_count < 1):
        raise ValueError(
            f"视频截帧:抽帧数 frame_count 须为 ≥1 的整数,收到:{frame_count!r}")
    if frame_count > MAX_FRAME_COUNT:
        raise ValueError(
            f"视频截帧:单次抽帧上限 {MAX_FRAME_COUNT} 帧,收到:{frame_count}")


def plan_uniform_frames(total_frames: int, count: int) -> list[int]:
    """等距抽帧(含首尾;整数算术半进位,零浮点漂移)。

    count≥总帧数→全帧;count=1→正中帧;余者第 i 帧=(i*(总-1)/(count-1))
    半进位取整——间距 ≥1 保证严格递增不重复。
    """
    if count >= total_frames:
        return list(range(total_frames))
    if count == 1:
        return [(total_frames - 1) // 2]
    span, den = total_frames - 1, count - 1
    return [(2 * i * span + den) // (2 * den) for i in range(count)]


def plan_head_frames(total_frames: int, count: int) -> list[int]:
    """前 N 帧(count 超出总帧数取全帧)。"""
    return list(range(min(count, total_frames)))


def plan_tail_frames(total_frames: int, count: int) -> list[int]:
    """后 N 帧(count 超出总帧数取全帧)。"""
    return list(range(total_frames - min(count, total_frames), total_frames))


_PLANNERS: dict[str, Callable[[int, int], list[int]]] = {
    "uniform": plan_uniform_frames,
    "head": plan_head_frames,
    "tail": plan_tail_frames,
}


def plan_frames(strategy: str, total_frames: int, frame_count: int) -> list[int]:
    """策略分发入口:未知策略中文报错并枚举可选项(combo 闭集的节点内兜底)。"""
    validate_frame_request(total_frames, frame_count)
    key = dict(FRAME_STRATEGIES).get(strategy)
    if key is None:
        raise ValueError(
            f"未知抽帧策略:「{strategy}」。可选:{' / '.join(STRATEGY_NAMES)}"
            "——请在画布重新选择策略下拉,或检查自研节点是否为旧版")
    return _PLANNERS[key](total_frames, frame_count)


def frame_suffixes(indices: list[int]) -> list[str]:
    """帧标识 f{帧号:05d}(文件名与 ui 同源;帧号保留原值可反查)。"""
    return [f"f{idx:05d}" for idx in indices]


def frame_filenames(base: str, counter: int, indices: list[int]) -> list[str]:
    """一次截帧全套帧件名(纯函数;口径=input_name,计数器段随 ComfyUI 解析)。"""
    return [input_name(base, counter, s) for s in frame_suffixes(indices)]


class MyVideoFrameGrab:
    """漫影视频截帧回灌:VIDEO → 按策略抽 N 帧 PNG 写回 input 目录。

    keyframes 体系最后一跳:出片→抽帧→候选关键帧→回接。帧对齐=frame_count
    口径(按帧号精确取帧);策略三档见 FRAME_STRATEGIES(默认均匀等距)。
    """

    CATEGORY = "漫影"
    OUTPUT_NODE = True
    DESCRIPTION = ("视频按策略抽 N 帧成 PNG 写回输入目录变新输入"
                   "(候选关键帧;帧号精确对齐 frame_count 口径)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "video": ("VIDEO", {"tooltip": "核心 LoadVideo 或视频产出节点直供;"
                                                "长视频先 VideoSlice/VideoTrim 裁窗"}),
                "strategy": (STRATEGY_NAMES, {
                    "default": DEFAULT_STRATEGY,
                    "tooltip": "均匀=等距含首尾 / 头部=前N帧 / 尾部=后N帧"}),
                "frame_count": ("INT", {"default": 6, "min": 1,
                                        "max": MAX_FRAME_COUNT, "step": 1,
                                        "tooltip": "抽帧数 N(超出总帧数取全帧)"}),
                "filename_prefix": ("STRING", {
                    "default": "my_frame_grab",
                    "tooltip": "写回 input 的文件名前缀(可带子目录)"}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("input_names",)
    FUNCTION = "grab"

    def grab(self, video: Any, strategy: str, frame_count: int,
             filename_prefix: str) -> dict[str, Any]:
        """解码→按计划取帧→写回;返回 ui.images(input 件)+ input_names(换行串)。"""
        components = video.get_components()
        images = components.images
        total = int(images.shape[0])
        indices = plan_frames(strategy, total, frame_count)
        arrays = [frame_to_uint8(images[idx]) for idx in indices]
        height, width = int(images.shape[1]), int(images.shape[2])
        ui_images, display_names = write_arrays_to_input(
            arrays, filename_prefix, width, height, frame_suffixes(indices))
        return {"ui": {"images": ui_images},
                "result": ("\n".join(display_names),)}
