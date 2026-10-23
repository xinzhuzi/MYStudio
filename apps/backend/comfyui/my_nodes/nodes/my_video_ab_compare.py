# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影视频对比审片器(MyVideoABCompare,0929 TE-MAN 排查 B2 仿写件)。

画布侧审片件:两版视频(如不同加速档/不同 seed 出片)接进来同步审看。
形态=透传旁观件:VIDEO 双入双出原样透传,可串在出片链上任一位置;执行
时把 A/B 各落一份 mp4 到引擎 temp 目录(ui.abCompare 携 /view 可取的
文件引用+frame_count/frame_rate 元数据;ui 值=双元素列表[侧a,侧b]——
引擎 execution.get_output_from_returns 对每个 ui 值做列表扁平化,嵌套
dict 会被迭代成键名,0929 实弹红条),前端节点件
(my-video-ab-compare.js)双 <video> 滑帘+rAF 同步播放(syncToken 防竞态)
+帧对齐换算+A/B 声道切换,交互状态存 node.properties 随工作流携带。

VIDEO 输入契约=引擎 Input.Video.get_components() 解码(帧号 index 语义
与 ffmpeg/cv2 同构,同包 my_video_frame_grab 先例):本节点全量解码进
内存取帧数/帧率/尺寸/有无声道,长视频请先接核心 VideoSlice/VideoTrim
裁窗。temp 落盘=video.save_to(mp4,H.264 口径)供浏览器直接播放。

纯逻辑(帧号换算/对齐夹取/声道枚举/校验)模块级零依赖供单测直测;
folder_paths 引擎库函数内懒加载;解码落盘重路径不单测,由实弹阶段在
引擎里现场冒烟。
"""

from __future__ import annotations

import os
from typing import Any

# 声道枚举:combo 顺序即画布按钮次序;元组=(显示串, 键);分隔符=U+00B7
# 中点(随包内 combo 先例)。声道切换是前端 <video>.muted 行为,键值随
# ui 契约与前端件同源;后端枚举=契约真源供单测锁定。
AUDIO_CHANNELS: tuple[tuple[str, str], ...] = (
    ("A · 前路出声", "a"),
    ("B · 后路出声", "b"),
    ("静音 · 不出声", "mute"),
)
DEFAULT_AUDIO_KEY = AUDIO_CHANNELS[0][1]

DEFAULT_CURTAIN = 0.5  # 帘位初值=正中(A 左半 / B 右半)
FRAME_DRIFT_TOLERANCE = 0.5  # rAF 同步漂移容限(秒;超过即校正对齐)


def clamp_ratio(value: Any) -> float:
    """0-1 夹取(帘位通用;非数/NaN 兜回正中)。"""
    try:
        x = float(value)
    except (TypeError, ValueError):
        return DEFAULT_CURTAIN
    if x != x:  # NaN
        return DEFAULT_CURTAIN
    return min(max(x, 0.0), 1.0)


def validate_frame_rate(frame_rate: Any) -> float:
    """帧率校验:正有限数;违例中文报错(解码失败/损坏源的兜底)。"""
    try:
        rate = float(frame_rate)
    except (TypeError, ValueError):
        rate = 0.0
    if not (rate > 0.0 and rate < float("inf")) or rate != rate:
        raise ValueError(
            f"视频对比:源视频帧率无效({frame_rate!r})——"
            "请检查视频文件是否可解码")
    return rate


def frame_to_time(frame: Any, frame_rate: Any) -> float:
    """帧号 → 秒(=帧号/帧率;帧对齐换算的正向半边)。"""
    rate = validate_frame_rate(frame_rate)
    try:
        f = int(frame)
    except (TypeError, ValueError):
        raise ValueError(f"视频对比:帧号须为整数,收到:{frame!r}") from None
    if f < 0:
        raise ValueError(f"视频对比:帧号须为 ≥0 的整数,收到:{f}")
    return f / rate


def time_to_frame(time_seconds: Any, frame_rate: Any, frame_count: Any
                  ) -> int:
    """秒 → 帧号(四舍五入后夹进 [0, frame_count-1];反向半边)。"""
    rate = validate_frame_rate(frame_rate)
    if (not isinstance(frame_count, int) or isinstance(frame_count, bool)
            or frame_count < 1):
        raise ValueError(
            f"视频对比:源视频帧数无效({frame_count!r})——"
            "请检查视频文件是否可解码")
    try:
        t = float(time_seconds)
    except (TypeError, ValueError):
        raise ValueError(
            f"视频对比:时间须为数,收到:{time_seconds!r}") from None
    if t != t:  # NaN
        return 0
    return min(max(int(t * rate + 0.5), 0), frame_count - 1)


def aligned_time(frame: Any, frame_rate: Any, frame_count: Any) -> float:
    """共享帧号 → 该路自己的播放秒(帧对齐核心:两路帧率可不同)。

    秒=帧号/本路帧率,再夹进 [0, (总帧数-1)/帧率] 防越界 seek。
    """
    rate = validate_frame_rate(frame_rate)
    if (not isinstance(frame_count, int) or isinstance(frame_count, bool)
            or frame_count < 1):
        raise ValueError(
            f"视频对比:源视频帧数无效({frame_count!r})——"
            "请检查视频文件是否可解码")
    try:
        f = int(frame)
    except (TypeError, ValueError):
        raise ValueError(f"视频对比:帧号须为整数,收到:{frame!r}") from None
    if f < 0:
        raise ValueError(f"视频对比:帧号须为 ≥0 的整数,收到:{f}")
    last = (frame_count - 1) / rate
    return min(max(f / rate, 0.0), last)


def alignment_frame_range(frame_count_a: Any, frame_count_b: Any) -> int:
    """两路共享帧号总档数=较小总帧数(超出短路的帧无从对齐)。"""
    for name, count in (("A 路", frame_count_a), ("B 路", frame_count_b)):
        if (not isinstance(count, int) or isinstance(count, bool)
                or count < 1):
            raise ValueError(
                f"视频对比:{name}源视频帧数无效({count!r})——"
                "请检查视频文件是否可解码")
    return min(frame_count_a, frame_count_b)


def _save_video_to_temp(video: Any, filename_prefix: str, suffix: str,
                        width: int, height: int) -> dict[str, Any]:
    """VIDEO 落引擎 temp 目录成 mp4(H.264 口径)→ ui 引用(/view 可取)。

    video.save_to=引擎官方落盘面(已编码源走流拷贝;张量源现场编码);
    folder_paths 函数内懒加载;命名走 ComfyUI 计数器口径防覆盖(同包
    _input_writeback.input_name 同族,suffix=a/b 路标识互斥)。
    """
    import folder_paths

    full_folder, filename, counter, subfolder, _prefix = (
        folder_paths.get_save_image_path(
            filename_prefix, folder_paths.get_temp_directory(), width, height))
    name = f"{filename}_{counter:05}_{suffix}.mp4"
    video.save_to(os.path.join(full_folder, name))
    return {"filename": name, "subfolder": subfolder, "type": "temp"}


class MyVideoABCompare:
    """漫影视频对比审片器:VIDEO 双入双出透传 + 双路落 temp 供画布同步审看。

    前端件双 video 滑帘+rAF 同步(syncToken 防竞态)+帧对齐(frame_count/
    frame_rate 换算,两路帧率可不同)+A/B 声道切换(AUDIO_CHANNELS 枚举)。
    """

    CATEGORY = "漫影"
    OUTPUT_NODE = True
    DESCRIPTION = ("A/B 双视频透传旁观对比:双路落 temp mp4,画布双 video "
                   "滑帘+rAF 同步+帧对齐+A/B 声道切换(审片;长视频先裁窗)")

    @classmethod
    def INPUT_TYPES(cls) -> dict[str, Any]:
        return {
            "required": {
                "video_a": ("VIDEO", {"tooltip": "A 路视频(前路/旧版;"
                                               "透传输出可继续串链)"}),
                "video_b": ("VIDEO", {"tooltip": "B 路视频(后路/新版;"
                                               "与 A 路同步对比审看)"}),
            },
            "optional": {
                "label_a": ("STRING", {"default": "A",
                                        "tooltip": "A 路标签(画布角标显示)"}),
                "label_b": ("STRING", {"default": "B",
                                        "tooltip": "B 路标签(画布角标显示)"}),
            },
        }

    RETURN_TYPES = ("VIDEO", "VIDEO")
    RETURN_NAMES = ("video_a", "video_b")
    FUNCTION = "compare"

    def compare(self, video_a: Any, video_b: Any, label_a: str = "A",
                label_b: str = "B") -> dict[str, Any]:
        """双路解码取元数据+落 temp mp4 + 原样透传;返回 ui.abCompare。

        两路先全量校验(帧数/帧率)再落盘:任一路不可解码都在写盘前
        中文报错,不留半套 temp 产物。
        """
        metas = []
        for video, label in ((video_a, label_a), (video_b, label_b)):
            components = video.get_components()
            images = components.images
            total = int(images.shape[0])
            if total < 1:
                raise ValueError(
                    f"视频对比:{label} 路源视频帧数无效({total})——"
                    "请检查视频文件是否可解码")
            rate = validate_frame_rate(components.frame_rate)
            metas.append((video, str(label), int(images.shape[2]),
                          int(images.shape[1]), total, rate,
                          components.audio is not None))
        sides = []
        for index, (video, label, width, height, total, rate, has_audio) in enumerate(metas):
            side = "a" if index == 0 else "b"
            entry = _save_video_to_temp(
                video, f"my_ab_compare_v{side}", f"{side}00000", width, height)
            entry.update({
                "side": side, "label": label, "width": width, "height": height,
                "frame_count": total, "frame_rate": rate,
                "duration": total / rate,
                "has_audio": has_audio,
            })
            sides.append(entry)
        return {"ui": {"abCompare": sides},
                "result": (video_a, video_b)}
