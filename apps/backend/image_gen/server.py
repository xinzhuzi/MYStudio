#!/usr/bin/env python3
"""Local image generation HTTP server — OpenAI images API compatible.

Routes:
  GET  /health                          (no auth)
  POST /v1/images/generations           (auth: fixed local token)
  POST /v1/images/uncloth               (auth: fixed local token; 双分割+两遍 masked SDEdit)
  GET  /models/status                   (auth)
  POST /models/download                 (auth) — explicit user-triggered
  GET  /models/progress-json/{name}     (auth)
  /comfy/* 引擎托管+插件管理组           (auth;契约见 tasks/09-08-comfy-ecosystem-migration/design.md 十一节)

Auth: the server binds 127.0.0.1 only and accepts either
`Authorization: Bearer <MAN YING-LOCAL-IMAGE>` or the placeholder key the
frontend provider carries — both are the fixed local token below. This is a
local-only convenience (same trust model as the media bridge).
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import signal
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import error as urllib_error
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__
from engines.image_engine.model_cache import (
    DEFAULT_IMAGE_MODEL,
    IMAGE_MODELS,
    QWEN_SMALL_PIECES_SIZE_MB,
    comfyui_models_dir,
    find_cached_image_model_for_spec,
    download_hf_cache_dir,
    hf_snapshot_dir,
    qwen_small_pieces_status,
    resolve_image_model_name,
    z_image_comfyui_models_dir,
)
from .pipeline import PipelineError, generate_image

LOCAL_TOKEN = "manying-local-image"
# bridge 回写令牌单源核对(swap 阶段1):engines/comfyui/bridge_contract 与本文件
# 固定令牌必须一致,漂移即启动失败(manying_generated 回写会被全拒)
from engines.comfyui import bridge_contract as _bridge_contract  # noqa: E402

assert _bridge_contract.BRIDGE_TOKEN == LOCAL_TOKEN, "bridge 令牌漂移:bridge_contract 与 server.LOCAL_TOKEN 不一致"

_progress_state: dict[str, dict] = {}
_progress_lock = threading.Lock()


def _nearest_existing_dir(path: Path) -> Path:
    current = path
    while not current.exists():
        if current.parent == current:
            return Path.home()
        current = current.parent
    return current


def _set_progress(model_name: str, **fields) -> None:
    with _progress_lock:
        entry = _progress_state.setdefault(model_name, {})
        entry.update(fields)
        entry["updatedAt"] = int(time.time() * 1000)


def _get_progress(model_name: str) -> dict:
    with _progress_lock:
        return dict(_progress_state.get(model_name, {"status": "idle", "progress": 0}))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -- helpers ----------------------------------------------------------

    def log_message(self, fmt, *args):  # noqa: N802 — stdlib signature
        print(f"[image-sidecar] {fmt % args}", flush=True)

    def _cors_origin(self) -> str:
        # 回显请求 Origin：生产渲染器经 file:// 加载（Origin: null），
        # 开发经 localhost —— 固定白名单会全拒，回显是本地回环服务的正确姿势。
        return self.headers.get("Origin") or "*"

    def _send_json(self, payload, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Headers", "content-type,authorization,x-manying-image-token")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def _send_error_json(self, status: int, message: str, code: str = "error") -> None:
        self._send_json({"error": {"message": message, "code": code}, "status": int(status)}, status)

    def _authorized(self) -> bool:
        header = self.headers.get("Authorization", "")
        if header == f"Bearer {LOCAL_TOKEN}":
            return True
        return self.headers.get("X-Manying-Image-Token", "") == LOCAL_TOKEN

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            value = json.loads(raw.decode("utf-8"))
        except Exception as exc:
            raise ValueError(f"无效 JSON 请求体: {exc}") from exc
        if not isinstance(value, dict):
            raise ValueError("请求体必须是 JSON 对象")
        return value

    # -- routing ----------------------------------------------------------

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", self._cors_origin())
        self.send_header("Access-Control-Allow-Headers", "content-type,authorization,x-manying-image-token")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/health":
            self._send_json(
                {
                    "ok": True,
                    "service": "manying-local-image",
                    "version": __version__,
                    "routes": ["/health", "/v1/images/generations", "/models/status", "/models/download", "/models/progress-json/{name}", "/comfy/*"],
                }
            )
            return
        if not self._authorized():
            self._send_error_json(HTTPStatus.FORBIDDEN, "无效本地令牌", "invalid_local_token")
            return
        if path == "/models/status":
            # Keep the HTTP status contract aligned with the offline inventory:
            # every engine (Qwen/Z/FLUX.2) must expose its own big-file source,
            # pointed paths, and small-piece readiness rather than silently
            # reporting only Qwen's state.
            from .model_inventory import build_model_status

            models = build_model_status()
            self._send_json({"models": models})
            return
        if path.startswith("/models/progress-json/"):
            name = path.rsplit("/", 1)[-1]
            self._send_json({"model_name": name, **_get_progress(name)})
            return
        if path.startswith("/comfy/"):
            self._comfy("GET", path, {}, parse_qs(urlparse(self.path).query))
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if not self._authorized():
            self._send_error_json(HTTPStatus.FORBIDDEN, "无效本地令牌", "invalid_local_token")
            return
        try:
            payload = self._read_json()
        except ValueError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc), "invalid_payload")
            return

        if path == "/v1/images/generations":
            self._handle_generate(payload)
            return
        if path == "/v1/images/uncloth":
            self._handle_uncloth(payload)
            return
        if path == "/v1/images/cancel":
            # 服务端真取消(09-02):置位取消事件,在途推理逐步中止,锁即释放
            from .pipeline import cancel_generation

            cancel_generation()
            self._send_json({"ok": True, "cancelled": True})
            return
        if path == "/models/download":
            self._handle_download(payload)
            return
        if path.startswith("/comfy/"):
            self._comfy("POST", path, payload, parse_qs(urlparse(self.path).query))
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_DELETE(self):  # noqa: N802 — stdlib signature
        path = urlparse(self.path).path
        if not self._authorized():
            self._send_error_json(HTTPStatus.FORBIDDEN, "无效本地令牌", "invalid_local_token")
            return
        if path.startswith("/comfy/"):
            self._comfy("DELETE", path, {}, parse_qs(urlparse(self.path).query))
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    # -- handlers ---------------------------------------------------------

    def _handle_generate(self, payload: dict) -> None:
        model = resolve_image_model_name(str(payload.get("model") or DEFAULT_IMAGE_MODEL))
        prompt = payload.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            self._send_error_json(HTTPStatus.BAD_REQUEST, "prompt 必须是非空字符串", "invalid_prompt")
            return
        aspect_ratio = str(payload.get("aspect_ratio") or payload.get("size") or "1:1")
        if aspect_ratio not in ("1:1", "16:9", "9:16", "4:3", "3:4"):
            # Tolerate OpenAI-style size strings like "1024x1024".
            if "x" in aspect_ratio:
                try:
                    w, h = aspect_ratio.lower().split("x", 1)
                    ratio = int(w) / int(h)
                    aspect_ratio = "16:9" if ratio > 1.2 else ("9:16" if ratio < 0.83 else "1:1")
                except Exception:
                    aspect_ratio = "1:1"
            else:
                aspect_ratio = "1:1"
        resolution = str(payload.get("resolution") or "1024")
        negative_prompt = payload.get("negative_prompt")
        if not isinstance(negative_prompt, str):
            negative_prompt = None

        # Reference images (character/scene consistency): collect data-URI
        # entries in order, with the same four-image soft cap used by the
        # bridge engine. Keep the first item in the legacy single-image field.
        reference_images_b64: list[str] = []
        image_urls = payload.get("image_urls")
        if isinstance(image_urls, list):
            for item in image_urls:
                if not isinstance(item, str) or item.startswith("http"):
                    continue
                if item.startswith("data:image"):
                    reference_images_b64.append(item)
                else:
                    reference_images_b64.append(f"data:image/png;base64,{item}")
                if len(reference_images_b64) == 4:
                    break
        reference_b64 = reference_images_b64[0] if reference_images_b64 else None

        # NSFW/identity LoRA 显式开关(默认关;仅 Krea2 消费,其余引擎经 **ctx 吸收)
        use_lora = payload.get("use_lora") is True

        try:
            b64 = generate_image(
                model,
                prompt,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                negative_prompt=negative_prompt,
                reference_image_b64=reference_b64,
                reference_images_b64=reference_images_b64 or None,
                use_lora=use_lora,
                template=(payload.get("template") if isinstance(payload.get("template"), str) else None),
                checkpoint=(payload.get("checkpoint") if isinstance(payload.get("checkpoint"), str) else None),
                loras=(
                    payload.get("loras")
                    if isinstance(payload.get("loras"), list)
                    and all(isinstance(item, dict) and "file" in item for item in payload["loras"])
                    else None
                ),
            )
        except PipelineError as exc:
            if exc.code == "model-not-downloaded":
                status = HTTPStatus.SERVICE_UNAVAILABLE
            elif exc.code == "generation-busy":
                status = HTTPStatus.CONFLICT
            elif exc.code == "reference-unsupported":
                status = HTTPStatus.BAD_REQUEST
            elif exc.code == "bridge-unreachable":
                status = HTTPStatus.SERVICE_UNAVAILABLE
            elif exc.code == "bridge-timeout":
                status = HTTPStatus.GATEWAY_TIMEOUT
            else:
                status = HTTPStatus.INTERNAL_SERVER_ERROR
            self._send_error_json(status, exc.message, exc.code)
            return
        except Exception as exc:
            from .pipeline import is_generation_cancelled

            if is_generation_cancelled():
                # 用户主动停止:取消位在锁释放前保持,下一个请求持锁后会清位
                self._send_error_json(HTTPStatus.OK, "已停止", "generation-cancelled")
                return
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"生成失败: {exc}")
            return

        self._send_json({"created": int(time.time()), "data": [{"b64_json": b64}]})

    def _handle_uncloth(self, payload: dict) -> None:
        """无衣物管线(09-04):双分割+两遍 masked SDEdit,全参数经 params 传入。"""
        prompt = payload.get("prompt")
        input_image = payload.get("input_image")
        params = payload.get("params") or {}
        if not isinstance(prompt, str) or not prompt.strip():
            self._send_error_json(HTTPStatus.BAD_REQUEST, "prompt 必须是非空字符串", "invalid_prompt")
            return
        if not isinstance(input_image, str) or not input_image:
            self._send_error_json(HTTPStatus.BAD_REQUEST, "input_image 必须是 base64/data URL", "invalid_input")
            return
        try:
            from .pipeline import _CANCEL_EVENT
            from engines.image_engine import model_cache
            from engines.image_engine import krea2
            from .uncloth_pipeline import run_uncloth_pipeline

            # 取消位是一次性的(服务端真取消 09-02):每个新请求入口复位,
            # 防止上一次在途生成的取消毒化本请求(引擎步进回调懒读即抛)。
            _CANCEL_EVENT.clear()
            small_repo = getattr(krea2, "SMALL_REPO", getattr(krea2, "IMAGE_REPO", None))
            b64 = run_uncloth_pipeline(
                prompt,
                input_image,
                params if isinstance(params, dict) else {},
                {
                    "models_dir": model_cache.comfyui_models_dir(),
                    "snapshot_dir": model_cache.hf_snapshot_dir(small_repo) if small_repo else None,
                },
            )
            self._send_json({"created": int(time.time()), "data": [{"b64_json": b64}]})
        except Exception as exc:
            from .pipeline import is_generation_cancelled

            if is_generation_cancelled():
                self._send_error_json(HTTPStatus.OK, "已停止", "generation-cancelled")
                return
            self._send_error_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                f"无衣物管线失败: {exc}",
            )

    def _handle_download(self, payload: dict) -> None:
        model_name = resolve_image_model_name(str(payload.get("model") or ""))
        spec = IMAGE_MODELS.get(model_name)
        if not spec:
            self._send_error_json(HTTPStatus.BAD_REQUEST, f"未知模型: {model_name}", "unknown_model")
            return

        layout = spec.get("layout", "")
        if layout == "comfyui-bridge":
            from engines.image_engine import comfyui_bridge

            if not comfyui_bridge.resolve_big_files():
                self._send_error_json(
                    HTTPStatus.SERVICE_UNAVAILABLE,
                    "ComfyUI 没在运行，请先打开它再试",
                    "bridge-unreachable",
                )
                return
            template_status = comfyui_bridge.small_pieces_status()
            if not template_status["ready"]:
                self._send_error_json(
                    HTTPStatus.INTERNAL_SERVER_ERROR,
                    f"ComfyUI 工作流模板不可用: {', '.join(template_status['missing'])}",
                    "bridge-template-missing",
                )
                return
            _set_progress(model_name, status="complete", progress=100, current=0, total=0)
            self._send_json({"message": "ComfyUI 桥接使用已运行服务，无需下载"})
            return
        if "pointed" in layout:
            # 缺什么下什么:大件在 → 只补小件;大件缺 → 完整(引擎分派)
            from engines.image_engine import ALL_ENGINES as _ENGINES
            engine = next((e for e in _ENGINES if e.LAYOUT == layout), None)
            if engine is None:
                self._send_error_json(HTTPStatus.BAD_REQUEST, f"未知布局: {layout}", "unknown_layout")
                return

            models_dir = z_image_comfyui_models_dir() if layout == "z-image-pointed" else comfyui_models_dir()
            cache_dir = Path(download_hf_cache_dir())
            if model_name == "qwen-image-edit-2511":
                resolved = engine.resolve_big_files(models_dir, hf_snapshot_dir, cache_dir)
            else:
                resolved = engine.resolve_big_files(models_dir)
            full_mode = resolved is None
            small_mb = getattr(engine, "SMALL_PIECES_SIZE_MB", 400)
            total_bytes = spec["size_mb"] * 1024 * 1024 if full_mode else small_mb * 1024 * 1024
            display_label = "Krea2" if model_name == "krea2-turbo" else ("FLUX.2" if model_name == "flux2-klein-9b" else spec["label"])

            if full_mode and not hasattr(engine, "fetch_big_files"):
                self._send_error_json(
                    HTTPStatus.BAD_REQUEST,
                    f"{display_label} 大件缺失,当前引擎不支持自动下载完整模型",
                    "full-download-unsupported",
                )
                return
            if full_mode:
                required_bytes = max(
                    total_bytes,
                    38 * 1024**3 if model_name == "qwen-image-edit-2511" else total_bytes,
                )
                try:
                    free_bytes = shutil.disk_usage(
                        _nearest_existing_dir(cache_dir)
                    ).free
                except OSError as exc:
                    self._send_error_json(HTTPStatus.INSUFFICIENT_STORAGE, f"无法检查磁盘空间: {exc}", "disk-space-check-failed")
                    return
                if free_bytes < required_bytes:
                    self._send_error_json(
                        HTTPStatus.INSUFFICIENT_STORAGE,
                        f"磁盘空间不足:至少需要 {required_bytes / 1024**3:.1f} GiB",
                        "insufficient-disk-space",
                    )
                    return

            def _download_pieces() -> None:
                _set_progress(model_name, status="downloading", progress=0, current=0,
                              total=total_bytes,
                              filename=(f"{display_label} 完整模型" if full_mode
                                        else f"{display_label} 小件"))
                try:
                    from .download_model import _hf_download, _ms_download
                    engine.fetch_small_pieces(str(cache_dir), _hf_download, _ms_download)
                    if full_mode and hasattr(engine, "fetch_big_files"):
                        engine.fetch_big_files(str(cache_dir), _hf_download, _ms_download)
                    _set_progress(model_name, status="complete", progress=100)
                except Exception as exc:
                    _set_progress(model_name, status="error", progress=0, error=str(exc))

            threading.Thread(target=_download_pieces, daemon=True).start()
            self._send_json({"message": f"Model {model_name} {'full' if full_mode else 'small pieces'} download started"})
            return

        def _download() -> None:
            _set_progress(model_name, status="downloading", progress=0, current=0,
                          total=spec["size_mb"] * 1024 * 1024, filename=spec["repo_id"])
            try:
                from huggingface_hub import snapshot_download

                cache_dir = str(Path(os.environ.get("MYSTUDIO_IMAGE_MODEL_DIR", "") or Path.home() / ".cache" / "huggingface" / "hub").expanduser())
                try:
                    snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir, endpoint="https://modelscope.cn")
                except Exception:
                    snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir, endpoint="https://huggingface.co")
                _set_progress(model_name, status="complete", progress=100)
            except Exception as exc:
                _set_progress(model_name, status="error", progress=0, error=str(exc))

        threading.Thread(target=_download, daemon=True).start()
        self._send_json({"message": f"Model {model_name} download started"})

    # -- /comfy/* 组(ComfyUI 引擎托管+插件管理,一期后端流 A) -----------
    # 契约:tasks/09-08-comfy-ecosystem-migration/design.md 十一节。
    # 重操作(install/update/reset/start/插件装卸)返回 jobId,进度轮询
    # GET /comfy/jobs/{id}(既有 job/进度范式的 HTTP 化);轻操作同步应答。

    def _comfy(self, method: str, path: str, payload: dict, query: dict) -> None:
        from engines.comfyui.engine_manager import EngineOpError, engine_manager, jobs
        from engines.comfyui import plugin_manager as pm
        from engines.comfyui import bridge_inbox

        def q(name: str) -> str:
            return (query.get(name) or [""])[0]

        try:
            # ── 引擎 ──
            # ── manying 自研节点 + bridge 回写(swap 阶段1)──
            if method == "POST" and path == "/comfy/manying/sync":
                result = pm.sync_manying_nodes()
                result["restartRequired"] = engine_manager().status().get("state") == "running"
                self._send_json(result)
                return
            if method == "GET" and path == "/comfy/manying/status":
                self._send_json(pm.manying_sync_state())
                return
            if method == "POST" and path == "/comfy/bridge/writeback":
                image_b64 = payload.get("imageB64")
                video_b64 = payload.get("videoB64")
                has_image = isinstance(image_b64, str) and bool(image_b64)
                has_video = isinstance(video_b64, str) and bool(video_b64)
                if has_image == has_video:
                    self._send_error_json(400, "回写必须二选一提供imageB64或videoB64", "bridge-writeback-invalid")
                    return
                meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
                if has_video:
                    subfolder = meta.get("subfolder")
                    policy = meta.get("policy")
                    segments = subfolder.split("/") if isinstance(subfolder, str) else []
                    if (
                        meta.get("kind") != "video"
                        or len(segments) != 4
                        or segments[:2] != ["video", "漫影"]
                        or any(not segment or segment in {".", ".."} for segment in segments[2:])
                        or not isinstance(policy, str)
                        or not policy
                        or "/" in policy
                        or "\\" in policy
                    ):
                        self._send_error_json(400, "视频回写缺少meta.kind/subfolder/policy", "bridge-writeback-invalid")
                        return
                item_id = bridge_inbox.append(
                    {
                        "kind": "video" if has_video else "image",
                        "client": payload.get("client") or "manying-nodes",
                        "shotTarget": payload.get("shotTarget") or "",
                        "prompt": payload.get("prompt") or "",
                        "meta": meta,
                        "ts": payload.get("ts") or int(time.time() * 1000),
                    },
                    video_b64 if has_video else image_b64,
                    "videoB64" if has_video else "imageB64",
                )
                self._send_json({"accepted": True, "id": item_id})
                return
            if method == "GET" and path == "/comfy/bridge/writebacks":
                cursor = int(q("cursor") or 0)
                self._send_json(bridge_inbox.list_since(cursor, include_image=q("include_image") != "0"))
                return
            if method == "POST" and path == "/comfy/bridge/reference":
                # 参考图上传闭环(swap 阶段2 批2):占位名同名覆写进引擎 input 目录
                image_b64 = payload.get("imageB64")
                name = payload.get("name")
                if not isinstance(image_b64, str) or not image_b64 or not isinstance(name, str) or not name:
                    self._send_error_json(400, "参考图上传缺少 name/imageB64", "bridge-reference-invalid")
                    return
                if "/" in name or "\\" in name or ".." in name:
                    self._send_error_json(400, "参考图文件名不合法(禁止路径段)", "bridge-reference-invalid")
                    return
                from engines.comfyui import uploads
                result = uploads.upload_reference(image_b64, name)
                self._send_json({"accepted": True, "name": result.get("name"), "subfolder": result.get("subfolder", "")})
                return
            if method == "POST" and path == "/comfy/bridge/storyboards":
                # 业务侧栏数据面(阶段2 批3):渲染层推分镜快照
                from engines.comfyui import bridge_sidepanel
                try:
                    result = bridge_sidepanel.update(payload.get("shots") or [], payload)
                except ValueError as exc:
                    self._send_error_json(400, str(exc), "bridge-storyboards-invalid")
                    return
                self._send_json(result)
                return
            if method == "GET" and path == "/comfy/bridge/storyboards":
                from engines.comfyui import bridge_sidepanel
                self._send_json(bridge_sidepanel.snapshot())
                return
            if method == "POST" and path == "/comfy/bridge/actions":
                # 制作动作通道(09-11):引擎漫影侧栏提交,宿主渲染层消费执行;
                # note=付费生成的补充要求(09-12 功能差异补齐 B1)
                from engines.comfyui import bridge_actions
                try:
                    self._send_json(bridge_actions.submit(
                        str(payload.get("kind") or ""),
                        str(payload.get("note") or ""),
                    ))
                except ValueError as exc:
                    self._send_error_json(400, str(exc), "bridge-actions-invalid")
                return
                return
            if method == "GET" and path == "/comfy/bridge/actions":
                from engines.comfyui import bridge_actions
                self._send_json(bridge_actions.list_since(int(q("cursor") or 0)))
                return
            if method == "POST" and path == "/comfy/bridge/actions/ack":
                from engines.comfyui import bridge_actions
                self._send_json({"deleted": bridge_actions.ack(int(payload.get("upTo") or 0))})
                return
            if method == "POST" and path == "/comfy/bridge/writebacks/ack":
                self._send_json({"deleted": bridge_inbox.ack(int(payload.get("upTo") or 0))})
                return

            if method == "GET" and path == "/comfy/engine/snapshots":
                self._send_json(engine_manager().list_snapshots())
                return
            if method == "GET" and path == "/comfy/engine/status":
                self._send_json(engine_manager().status())
                return
            if method == "GET" and path == "/comfy/engine/models":
                # 模型库清单(09-10 用户裁定:模型页展示 comfyui/models 真实内容)
                self._send_json(engine_manager().list_models())
                return
            if method == "POST" and path == "/comfy/engine/install":
                self._send_json({"jobId": engine_manager().install_job()})
                return
            if method == "POST" and path == "/comfy/engine/start":
                # 冷启动含 torch 加载(最长 2 分钟),走 job 由前端轮询就绪
                self._send_json({"jobId": engine_manager().start_job()})
                return
            if method == "POST" and path == "/comfy/engine/stop":
                self._send_json(engine_manager().stop())
                return
            if method == "POST" and path == "/comfy/engine/update-check":
                self._send_json(engine_manager().update_check())
                return
            if method == "POST" and path == "/comfy/engine/update":
                self._send_json({"jobId": engine_manager().update_job()})
                return
            if method == "POST" and path == "/comfy/engine/reset":
                self._send_json({"jobId": engine_manager().reset_job()})
                return
            if method == "POST" and path == "/comfy/engine/rollback":
                # 一键回滚(更新失败报告携带 snapshotId;缺省回最近一次快照)。
                snapshot_id = str(payload.get("snapshotId") or "")
                if not snapshot_id:
                    snapshots = engine_manager().list_snapshots()
                    if not snapshots:
                        raise EngineOpError("没有可回滚的快照")
                    snapshot_id = str(snapshots[0].get("id") or "")
                self._send_json(engine_manager().rollback_snapshot(snapshot_id))
                return
            if method == "GET" and path == "/comfy/engine/object-info":
                # object_info 摘要(工作流库缺插件检测口径);引擎未跑给 null 不误报。
                # ?class=X → 单类详情(09-08 三期B 通用节点直放的 schema 拉取)。
                engine = engine_manager()
                detail_class = q("class")
                if detail_class:
                    if not engine.is_healthy():
                        self._send_json({"engineOnline": False, "detail": None})
                        return
                    try:
                        from engines.comfyui import execute as comfy_execute

                        self._send_json({"engineOnline": True, "detail": comfy_execute.object_info_detail(detail_class)})
                    except (EngineOpError, OSError, urllib_error.URLError, json.JSONDecodeError) as exc:
                        self._send_json({"engineOnline": False, "error": str(exc), "detail": None})
                    return
                if not engine.is_healthy():
                    self._send_json({"engineOnline": False, "classTypes": None})
                    return
                try:
                    self._send_json({"engineOnline": True, "classTypes": sorted(engine.object_info_names())})
                except (EngineOpError, OSError, urllib_error.URLError, json.JSONDecodeError):
                    self._send_json({"engineOnline": False, "classTypes": None})
                return
            if method == "POST" and path == "/comfy/engine/config":
                # 引擎卡设置区(模型目录/性能档;契约外的补充端点)
                self._send_json(engine_manager().update_config(payload))
                return

            # ── 存储位置(09-09 comfyui-frontend-swap 0a:四目录配置/校验/迁移) ──
            if method == "GET" and path == "/comfy/paths":
                self._send_json(engine_manager().paths_status())
                return
            if method == "POST" and path == "/comfy/paths/validate":
                self._send_json(engine_manager().validate_paths(payload))
                return
            if method == "POST" and path == "/comfy/paths/set":
                # 未安装态直接改;已安装抛错指路 migrate
                self._send_json(engine_manager().set_paths(payload))
                return
            if method == "POST" and path == "/comfy/paths/io":
                # 输入/输出目录更改(09-11:可迁出源码目录;引擎须停,改完重启生效)
                self._send_json(engine_manager().set_io_dirs(payload))
                return
            if method == "POST" and path == "/comfy/paths/migrate":
                self._send_json({"jobId": engine_manager().migrate_paths_job(payload)})
                return

            # ── 插件 ──
            if method == "GET" and path == "/comfy/plugins":
                self._send_json({"plugins": pm.list_plugins()})
                return
            if method == "POST" and path == "/comfy/plugins/clean-orphans":
                self._send_json(pm.clean_orphan_plugins())
                return
            if method == "GET" and path == "/comfy/plugins/doctor":
                self._send_json(pm.doctor())
                return
            if method == "POST" and path == "/comfy/plugins/install":
                result = pm.install_plugin_job(
                    str(payload.get("source") or ""), str(payload.get("ref") or ""),
                    dry_run=payload.get("dryRun") is True,
                )
                self._send_json(result)
                return
            if method == "POST" and path.endswith("/update") and path.startswith("/comfy/plugins/"):
                plugin_id = unquote(path[len("/comfy/plugins/"):-len("/update")])
                self._send_json({"jobId": pm.update_plugin_job(plugin_id)})
                return
            if method == "GET" and path.endswith("/references") and path.startswith("/comfy/plugins/"):
                plugin_id = unquote(path[len("/comfy/plugins/"):-len("/references")])
                self._send_json(pm.plugin_references(plugin_id))
                return
            if method == "DELETE" and path.startswith("/comfy/plugins/"):
                plugin_id = unquote(path[len("/comfy/plugins/"):])
                if q("confirm") != "true":
                    # 卸载杀手锏:先给引用清单(哪些工作流在用它),确认由前端做
                    references = pm.plugin_references(plugin_id)
                    self._send_json({"needsConfirmation": True, **references})
                    return
                self._send_json({"jobId": pm.uninstall_plugin_job(plugin_id)})
                return

            # ── 目录搜索(策展 + Registry 合并;离线仅策展) ──
            if method == "GET" and path == "/comfy/catalog/search":
                self._send_json(pm.catalog_search(q("q")))
                return

            # ── 工作流库(纯文件操作组) ──
            if method == "GET" and path == "/comfy/workflows":
                # 09-12 workflow-single-open:prefix=路径前缀过滤/light=轻量清单
                # (跳过逐文件解析;海量库性能)。缺省两者皆无=旧行为不变。
                self._send_json(pm.list_workflows(
                    prefix=(q("prefix") or None),
                    light=q("light") in ("1", "true", "yes"),
                ))
                return
            if method == "POST" and path == "/comfy/workflows/import":
                self._send_json(pm.import_workflows(payload.get("files"), overwrite=payload.get("overwrite") is True))
                return
            workflow_prefix = "/comfy/workflows/"
            if path.startswith(workflow_prefix) and path.endswith("/content") and method == "GET":
                self._send_json(pm.read_workflow(unquote(path[len(workflow_prefix):-len("/content")])))
                return
            for action in ("rename", "move", "delete"):
                suffix = f"/{action}"
                if path.startswith(workflow_prefix) and path.endswith(suffix) and method == "POST":
                    workflow_id = unquote(path[len(workflow_prefix):-len(suffix)])
                    if action == "rename":
                        self._send_json(pm.rename_workflow(workflow_id, str(payload.get("name") or "")))
                    elif action == "move":
                        self._send_json(pm.move_workflow(workflow_id, str(payload.get("to") or "")))
                    else:
                        self._send_json(pm.delete_workflow(workflow_id, confirm=payload.get("confirm") is True or q("confirm") == "true"))
                    return

            # ── 任意工作流执行(09-08 二期/三期收官共用;job 化,进度轮询) ──
            if method == "POST" and path == "/comfy/execute":
                from engines.comfyui import execute as comfy_execute

                self._send_json({"jobId": comfy_execute.execute_job(payload)})
                return

            # ── job 进度(重操作的轮询通道) ──
            if method == "GET" and path.startswith("/comfy/jobs/"):
                job = jobs.get(path.rsplit("/", 1)[-1])
                if job:
                    self._send_json(job)
                    return
                self._send_error_json(HTTPStatus.NOT_FOUND, "任务不存在或已过期(服务重启会丢失进行中的任务)", "job-not-found")
                return

            self._send_error_json(HTTPStatus.NOT_FOUND, "Route not found")
        except EngineOpError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc), "comfy-op-error")
        except ValueError as exc:
            self._send_error_json(HTTPStatus.BAD_REQUEST, str(exc), "invalid_payload")
        except Exception as exc:  # noqa: BLE001 — 面向前端的大白话兜底
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"操作失败: {exc}", "comfy-internal-error")


def _shutdown_signals() -> list:
    """优雅退出信号集(Windows 无 SIGHUP 常量,守卫注册)。"""
    sigs = [signal.SIGTERM, signal.SIGINT]
    if hasattr(signal, "SIGHUP"):
        sigs.append(signal.SIGHUP)
    return sigs


def _shutdown_sequence(server, log=print) -> list[str]:
    """退出收摊(09-14 生命周期审计 P3),顺序即契约:

    ① 先 shutdown+server_close 释放 17595 端口——Electron 侧 kill 后 ~300ms
    复验端口,先放口=不会被升级 SIGKILL,侧车得以从容收尾;
    ② 优雅停 ComfyUI 引擎(SIGTERM 组→SIGKILL 兜底,替代看门狗的纯硬杀);
    ③ 释放 engine.lock(此前生产路径从不释放,退出后恒留死锁文件)。
    引擎未启动时 stop() 为幂等空操作;任何一步失败不阻断后续步与进程退出。
    """
    events: list[str] = []
    try:
        server.shutdown()
        server.server_close()
        events.append("port-released")
    except Exception as exc:  # noqa: BLE001 — 收摊路径不因单步失败弃守其余步
        log(f"[image-sidecar] 释放监听端口失败: {exc}")
    try:
        from engines.comfyui.engine_manager import engine_manager

        engine_manager().stop()
        events.append("engine-stopped")
    except Exception as exc:  # noqa: BLE001
        log(f"[image-sidecar] 退出时停引擎失败(看门狗会兜底回收): {exc}")
    try:
        from engines.comfyui.engine_manager import release_engine_lock

        release_engine_lock()
    except Exception as exc:  # noqa: BLE001
        log(f"[image-sidecar] 退出时释放引擎锁失败: {exc}")
    return events


def run(host: str = "127.0.0.1", port: int = 17595) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[image-sidecar] listening on http://{host}:{port}", flush=True)
    # serve_forever 挪进工作线程、主线程等信号:信号处理器在主线程执行,
    # 若在 serve_forever 所属线程里调 server.shutdown() 会自死锁。
    stop_requested = threading.Event()
    for sig in _shutdown_signals():
        signal.signal(sig, lambda *_: stop_requested.set())
    # poll_interval 收紧到 0.1s:收到信号后 shutdown() 最长等一轮轮询才放端口,
    # 默认 0.5s 会撞上 Electron 侧回收器 TERM 后 ~300ms 的端口复验窗,被误升级
    # SIGKILL、废掉整条优雅收摊路径。
    server_thread = threading.Thread(
        target=lambda: server.serve_forever(poll_interval=0.1),
        name="image-sidecar-http", daemon=True)
    server_thread.start()
    stop_requested.wait()
    print("[image-sidecar] 收到退出信号,收摊:放端口 → 停引擎 → 释放锁", flush=True)
    _shutdown_sequence(server)
    print("[image-sidecar] shutdown complete", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio local image generation sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MANYING_LOCAL_IMAGE_PORT", "17595")))
    args = parser.parse_args()
    # 冷启动序列第一步:旧家 <userData>/python/comfyui 一次性收编到
    # <userData>/comfyui(09-09 用户裁定;此刻引擎进程必未起,move 安全)
    try:
        from engines.comfyui.manifest import ensure_home_migrated

        ensure_home_migrated()
    except Exception as exc:  # noqa: BLE001 — 迁移失败不拦 sidecar 起服
        print(f"[image-sidecar] home migration skipped: {exc}", flush=True)
    run(args.host, args.port)


if __name__ == "__main__":
    main()
