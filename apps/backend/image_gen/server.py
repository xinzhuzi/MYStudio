#!/usr/bin/env python3
"""Local image generation HTTP server — OpenAI images API compatible.

Routes:
  GET  /health                          (no auth)
  POST /v1/images/generations           (auth: fixed local token)
  POST /v1/images/uncloth               (auth: fixed local token; 双分割+两遍 masked SDEdit)
  GET  /models/status                   (auth)
  POST /models/download                 (auth) — explicit user-triggered
  GET  /models/progress-json/{name}     (auth)

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
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .model_cache import (
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
                    "routes": ["/health", "/v1/images/generations", "/models/status", "/models/download", "/models/progress-json/{name}"],
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
            from . import model_cache
            from .engines import krea2
            from .uncloth_pipeline import run_uncloth_pipeline

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
            from .engines import comfyui_bridge

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
            from .engines import ALL_ENGINES as _ENGINES
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


def run(host: str = "127.0.0.1", port: int = 17595) -> None:
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[image-sidecar] listening on http://{host}:{port}", flush=True)
    server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio local image generation sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MANYING_LOCAL_IMAGE_PORT", "17595")))
    args = parser.parse_args()
    run(args.host, args.port)


if __name__ == "__main__":
    main()
