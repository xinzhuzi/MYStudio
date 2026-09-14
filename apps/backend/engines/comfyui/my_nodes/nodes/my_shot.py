# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""镜节点(主分镜视图 ComfyUI 化,09-09 批7):章节总览图的展示单元。

不参与执行(纯展示/导航锚点):镜号/描述/媒体生产状态随 widget 展示;
选中后业务侧栏(漫影)提供该镜的生产动作入口。
"""

from __future__ import annotations

import base64
import re
from pathlib import Path

from ..bridge import writeback


class MyShot:
    # 09-14 通用化裁定:分镜网格改载荷渲染,产线不再生成 MyShot 实体——
    # DEPRECATED(菜单/搜索默认隐藏);存量档照常加载(别名与本文均保留)。
    DEPRECATED = True
    CATEGORY = "my"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "shot_id": ("STRING", {"default": ""}),
                "label": ("STRING", {"default": ""}),
                "description": ("STRING", {"multiline": True, "default": ""}),
            },
            "optional": {
                "media_status": ("STRING", {"default": ""}),
                "video": ("VIDEO",),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True

    def run(self, shot_id, label, description, media_status="", video=None):
        result = {"shotId": shot_id or label, "label": label, "status": media_status}
        if video is not None:
            if not isinstance(shot_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", shot_id):
                raise RuntimeError("视频回写需要合法shot_id(仅字母、数字、-、_)")
            import folder_paths

            output_dir = Path(folder_paths.get_output_directory())
            matches = sorted(
                output_dir.glob(f"video/漫影/*/{shot_id}/*.mp4"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            if not matches:
                raise RuntimeError("视频文件未找到,请确认SaveVideo已执行")
            video_path = matches[0]
            if video_path.stat().st_size > 64 * 1024 * 1024:
                raise RuntimeError("视频文件超过64MB限制")
            relative_path = video_path.relative_to(output_dir)
            stem_parts = relative_path.stem.rsplit("_", 2)
            policy = stem_parts[0] if len(stem_parts) == 3 else relative_path.stem
            accepted = writeback.deliver_video(
                shot_id,
                base64.b64encode(video_path.read_bytes()).decode("ascii"),
                relative_path.parent.as_posix(),
                policy,
            )
            result["videoWriteback"] = accepted.get("id")
        return {
            "ui": {"my_shot": result},
            "result": (),
        }
