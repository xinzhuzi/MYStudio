# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""镜节点(主分镜视图 ComfyUI 化,09-09 批7):章节总览图的展示单元。

不参与执行(纯展示/导航锚点):镜号/描述/媒体生产状态随 widget 展示;
选中后业务侧栏(漫影)提供该镜的生产动作入口。
"""

from __future__ import annotations

import base64
import io
import re

from ..bridge import writeback


class _VideoBuffer(io.BytesIO):
    """Stop an encoder before it grows the bridge payload beyond its byte cap."""

    def write(self, data):
        if self.tell() + len(data) > 64 * 1024 * 1024:
            raise RuntimeError("视频文件超过64MB限制")
        return super().write(data)


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
            },
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID", "prompt": "PROMPT"},
        }

    RETURN_TYPES = ()
    FUNCTION = "run"
    OUTPUT_NODE = True

    def run(self, shot_id, label, description, media_status="", video=None, extra_pnginfo=None, unique_id=None, prompt=None):
        result = {"shotId": shot_id or label, "label": label, "status": media_status}
        if video is not None:
            if not isinstance(shot_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]+", shot_id):
                raise RuntimeError("视频回写需要合法shot_id(仅字母、数字、-、_)")
            # SaveVideo returns its input VIDEO unchanged, not the saved filename.
            # The queued prompt supplies destination metadata, never media bytes.
            own_node = prompt.get(str(unique_id)) if isinstance(prompt, dict) else None
            own_inputs = own_node.get("inputs") if isinstance(own_node, dict) else None
            link = own_inputs.get("video") if isinstance(own_inputs, dict) else None
            if not isinstance(link, list) or len(link) != 2 or type(link[1]) is not int or link[1] != 0:
                raise RuntimeError("视频回写需要直接连接SaveVideo的视频输出")
            source = prompt.get(str(link[0]))
            if not isinstance(source, dict) or source.get("class_type") != "SaveVideo":
                raise RuntimeError("视频回写需要直接连接SaveVideo的视频输出")
            inputs = source.get("inputs")
            prefix = inputs.get("filename_prefix") if isinstance(inputs, dict) else None
            parts = prefix.split("/") if isinstance(prefix, str) else []
            if (len(parts) != 5 or parts[:2] != ["video", "漫影"] or parts[3] != shot_id
                    or any(not part.strip() or part in (".", "..") or "\\" in part or "\x00" in part for part in parts)):
                raise RuntimeError("视频回写需要SaveVideo的明确章节/分镜路径")
            policy = parts[4]
            if not re.fullmatch(r"[A-Za-z0-9._-]+", policy):
                raise RuntimeError("视频回写策略名不合法")
            if not callable(getattr(video, "save_to", None)):
                raise RuntimeError("视频回写收到无效VIDEO输入")
            # Export the supplied object so edits/trim windows remain effective;
            # get_stream_source() can expose an untrimmed underlying file.
            try:
                with _VideoBuffer() as buffer:
                    video.save_to(buffer, format="mp4")
                    if buffer.getbuffer().nbytes == 0:
                        raise RuntimeError("视频回写收到空视频")
                    video_b64 = base64.b64encode(buffer.getvalue()).decode("ascii")
            except Exception as exc:
                raise RuntimeError(f"视频导出失败:{exc}") from exc
            # Read only this node's immutable queued workflow, never current host state.
            workflow = extra_pnginfo.get("workflow") if isinstance(extra_pnginfo, dict) else None
            nodes = workflow.get("nodes") if isinstance(workflow, dict) else None
            origin_project_id = ""
            for node in nodes if isinstance(nodes, list) else []:
                if not isinstance(node, dict) or str(node.get("id")) != str(unique_id):
                    continue
                props = node.get("properties")
                origin = props.get("myOriginProjectId") if isinstance(props, dict) else None
                if isinstance(origin, str) and origin.strip():
                    origin_project_id = origin
                break
            accepted = writeback.deliver_video(
                shot_id,
                video_b64,
                "/".join(parts[:4]),
                policy,
                origin_project_id=origin_project_id,
            )
            result["videoWriteback"] = accepted.get("id")
        return {
            "ui": {"my_shot": result},
            "result": (),
        }
