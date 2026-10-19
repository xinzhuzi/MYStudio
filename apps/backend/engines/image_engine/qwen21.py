"""Qwen-Image-2.1(qi21)文生图/图生图引擎模块——经自管 ComfyUI 引擎执行。

复用 comfyui_bridge 的提交/轮询/取图机制,模板=qwen21_道劫_t2i_api
(qi21-道劫-t2i.json 工作流本体按 fire 展平逻辑生成:装配子图[6] ApiPE 双链回落
+加速子图[7] viggle 9步双段(detail-fix×0.5 在链)+SeedVR2 2K 超分双产物;生成器=
apps/build/scripts/qwen21_bridge_template_build.py,型/档随画布现值)。
10-19 图生图·画风转换:带参考图走 qwen21_道劫_i2i_api(qi21-道劫-i2i.json 展平,
单参考 [10];快照=画布现值,运行时覆写 6:4011 组装用途=画风转换——底座由装配层
自动追加;seed 每次随机,fire 铁令);无参考走原 t2i 路(逐字节不变)。
"""
from __future__ import annotations

import base64
import math
import os
import random
import time
import uuid
from pathlib import Path
from typing import Any
from urllib import parse
from urllib.parse import urlencode

from .comfyui_bridge import (
    _available_node_classes,
    _fetch_bytes,
    _history_output,
    _http_json,
    _pipeline_error,
    _upload_image,
    _warn_if_version_below_min,
    bridge_url,
    curated_node_class_packs,
    graph_node_classes,
    instantiate_template,
    load_template,
    missing_nodes_message,
)

MODEL_NAME = "qwen-image-2-1"
LAYOUT = "qwen21-viggle"
SUPPORTS_REFERENCE = True
SUPPORTS_MULTI_REFERENCE = False

SPEC = {
    "label": "Qwen-Image-2.1",
    "repo_id": "ComfyUI 服务(本机)",
    "repo_ids": ("ComfyUI 服务(本机)",),
    "size_mb": 0,
    "license": "本机 ComfyUI 配置",
    "steps": 6,
    "description": "本地 Qwen-Image-2.1 生图(道劫产线工作流:viggle 9步双段+SeedVR2 2K 超分;图生图=画风转换)",
    "layout": LAYOUT,
}

TEMPLATE_NAME = "qwen21_道劫_t2i_api"
TEMPLATE_NAME_I2I = "qwen21_道劫_i2i_api"
ASSEMBLY_PURPOSE_STYLE_TRANSFER = "画风转换"

ASPECT_RATIOS = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}


def resolve_big_files(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    from .comfyui_bridge import resolve_big_files as _bridge_resolve

    return _bridge_resolve(models_dir, cache_dir)


def find_cached(models_dir: Path | None = None, cache_dir: Path | None = None) -> dict[str, Any] | None:
    stats = resolve_big_files()
    if not stats:
        return None
    host = parse.urlparse(bridge_url()).netloc
    return {"repo_id": f"comfyui-service:{host}", "cache_dir": stats["cache_dir"], "repo_cache_dir": stats["cache_dir"], "size_mb": 0}


def small_pieces_status(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    try:
        load_template(TEMPLATE_NAME)
        return {"ready": True, "missing": [], "snapshot_dirs": {}}
    except Exception:
        return {"ready": False, "missing": [TEMPLATE_NAME], "snapshot_dirs": {}}


def fetch_small_pieces(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
    return small_pieces_status()



def _prefer_upscaled_output(history: dict[str, Any], prompt_id: str) -> tuple[str, dict[str, Any] | None]:
    """道劫工作流双产物:优先 SeedVR2 2K(SaveImage 504),回落基础图(SaveImage 8)。"""
    entry = history.get(prompt_id)
    if not isinstance(entry, dict):
        return "pending", None
    status = entry.get("status", {})
    state = status.get("status_str")
    if state == "error":
        detail = str(status.get("messages", "ComfyUI 执行失败"))[:500]
        raise _pipeline_error("bridge-execution-failed", f"ComfyUI 执行失败: {detail}")
    if state != "success":
        return "pending", None
    outputs = entry.get("outputs", {})
    for node_id in ("504", "8"):
        images = outputs.get(node_id, {}).get("images", []) if isinstance(outputs.get(node_id), dict) else []
        if images:
            return "success", images[0]
    return "success", None


def apply_base_type(graph: dict[str, Any], base_type: Any) -> None:
    """调用方显式点名型(如分镜调用传「分镜」)时覆写装配子图[6]的型选择;
    非法类型由 ComfyUI 的 COMBO 校验拒单兜底。缺省不动的=模板里画布现值。"""
    if isinstance(base_type, str) and base_type.strip():
        graph["6:4010"]["inputs"]["base"] = base_type.strip()


def generate(prompt: str, aspect_ratio: str, negative_prompt: str | None, steps: int, seed: int | None, reference_b64: str | None = None, **ctx: Any) -> str:
    from image_gen.pipeline import is_generation_cancelled

    def check_cancelled(prompt_id: str | None = None) -> None:
        if not is_generation_cancelled():
            return
        if prompt_id:
            try:
                _http_json("POST", f"{bridge_url()}/api/jobs/{parse.quote(prompt_id, safe='')}/cancel", {}, timeout=5)
            except Exception:
                pass
        raise _pipeline_error("generation-cancelled", "已停止")

    check_cancelled()
    from engines.comfyui import engine_manager as _em
    try:
        _em.engine_manager().ensure_engine_ready()
    except _em.EngineOpError as exc:
        raise _pipeline_error("engine-start-failed", str(exc)) from exc
    check_cancelled()
    stats = resolve_big_files()
    if not stats:
        raise _pipeline_error("bridge-unreachable", "ComfyUI 没在运行，请先打开它再试")
    # 参考图分族(与 comfyui_bridge 同款约定):ctx 显式列表优先,否则单张 positional
    references = list(ctx.get("reference_images_b64") or ([] if not reference_b64 else [reference_b64]))
    if references:
        # 10-19 图生图·画风转换(D3/D4):恒单参考;模板快照=画布现值,仅运行时
        # 覆写组装用途=画风转换(底座由装配层追加);seed 每次随机(fire 铁令)
        if len(references) > 1:
            raise _pipeline_error(
                "reference-unsupported",
                "Qwen-Image-2.1 本地渠道图生图仅支持单参考图(画风转换)。",
            )
        template = load_template(TEMPLATE_NAME_I2I)
        _warn_if_version_below_min(stats, template)
        check_cancelled()
        upload_name = _upload_image(
            f"{bridge_url()}/upload/image",
            references[0],
            f"qwen21-i2i-{uuid.uuid4().hex}.png",
        ).get("name")
        if not isinstance(upload_name, str) or not upload_name:
            raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回参考图文件名")
        seed = seed if seed is not None else random.randint(1, 2**31 - 1)
        # 负面不传(cfg=1;模板无 negative_prompt 绑定,显式 None 表态)
        graph = instantiate_template(template, prompt, None, steps, seed, aspect_ratio, [upload_name])
        assembly = graph.get("6:4011")
        if not isinstance(assembly, dict) or "组装用途" not in assembly.get("inputs", {}):
            # fail-closed 防模板文件手术漂移(快照重构须重跑 build --target i2i)
            raise _pipeline_error(
                "bridge-template-missing",
                f"i2i 模板缺组装节点 6:4011: {TEMPLATE_NAME_I2I}",
            )
        assembly["inputs"]["组装用途"] = ASSEMBLY_PURPOSE_STYLE_TRANSFER
    else:
        template = load_template(TEMPLATE_NAME)
        _warn_if_version_below_min(stats, template)
        graph = instantiate_template(template, prompt, negative_prompt, steps, seed, aspect_ratio, [])
        apply_base_type(graph, ctx.get("base_type"))
    message = missing_nodes_message(
        [cls for cls in graph_node_classes(graph) if cls not in _available_node_classes()],
        curated_node_class_packs(),
    )
    if message:
        raise _pipeline_error("bridge-missing-nodes", message)
    check_cancelled()
    client_id = str(uuid.uuid4())
    submitted = _http_json("POST", f"{bridge_url()}/prompt", {"prompt": graph, "client_id": client_id}, timeout=20)
    prompt_id = submitted.get("prompt_id")
    if not isinstance(prompt_id, str) or not prompt_id.strip():
        if submitted.get("node_errors"):
            raise _pipeline_error("bridge-execution-failed", f"ComfyUI 拒绝工作流: {str(submitted['node_errors'])[:500]}")
        raise _pipeline_error("bridge-execution-failed", "ComfyUI 未返回任务编号")
    if submitted.get("node_errors"):
        print(f"[image-sidecar] qwen21: 任务 {prompt_id} 部分输出校验失败,继续跟踪已接受输出: {str(submitted['node_errors'])[:500]}", flush=True)
    try:
        timeout_s = float(os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S", "600"))
    except (TypeError, ValueError, OverflowError):
        timeout_s = 600.0
    if not math.isfinite(timeout_s) or timeout_s <= 0:
        timeout_s = 600.0
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        check_cancelled(prompt_id)
        try:
            history = _http_json("GET", f"{bridge_url()}/history/{prompt_id}", timeout=5)
        except Exception:
            check_cancelled(prompt_id)
            raise
        check_cancelled(prompt_id)
        state, image = _prefer_upscaled_output(history, prompt_id)
        if state == "success":
            if not image:
                raise _pipeline_error("bridge-no-output", "ComfyUI 已完成但没有输出图片")
            query = urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": image.get("type", "output")})
            try:
                content = _fetch_bytes(f"{bridge_url()}/view?{query}")
            except Exception:
                check_cancelled(prompt_id)
                raise
            check_cancelled(prompt_id)
            return base64.b64encode(content).decode("ascii")
        time.sleep(1)
    check_cancelled(prompt_id)
    try:
        _http_json("POST", f"{bridge_url()}/api/jobs/{parse.quote(prompt_id, safe='')}/cancel", {}, timeout=5)
    except Exception:
        pass
    raise _pipeline_error("bridge-timeout", "ComfyUI 生成超时")
