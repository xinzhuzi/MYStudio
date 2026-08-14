#!/usr/bin/env python3
"""Local image generation HTTP server — OpenAI images API compatible.

Routes:
  GET  /health                          (no auth)
  POST /v1/images/generations           (auth: fixed local token)
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
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .model_cache import IMAGE_MODELS, find_cached_image_model
from .pipeline import PipelineError, generate_image

LOCAL_TOKEN = "manying-local-image"

_progress_state: dict[str, dict] = {}
_progress_lock = threading.Lock()


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
            models = []
            for name, spec in IMAGE_MODELS.items():
                cached = find_cached_image_model(spec["repo_ids"])
                models.append(
                    {
                        "modelName": name,
                        "label": spec["label"],
                        "downloaded": cached is not None,
                        "sizeMb": cached["size_mb"] if cached else None,
                    }
                )
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
        if path == "/models/download":
            self._handle_download(payload)
            return
        self._send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    # -- handlers ---------------------------------------------------------

    def _handle_generate(self, payload: dict) -> None:
        model = str(payload.get("model") or "sdxl-turbo")
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

        # Reference image (character/scene consistency): the cloud flow sends
        # data-URI references via image_urls; take the first for img2img.
        reference_b64: str | None = None
        image_urls = payload.get("image_urls")
        if isinstance(image_urls, list) and image_urls and isinstance(image_urls[0], str):
            first = image_urls[0]
            if first.startswith("data:image"):
                reference_b64 = first
            elif not first.startswith("http"):
                reference_b64 = f"data:image/png;base64,{first}"

        try:
            b64 = generate_image(
                model,
                prompt,
                aspect_ratio=aspect_ratio,
                resolution=resolution,
                negative_prompt=negative_prompt,
                reference_image_b64=reference_b64,
            )
        except PipelineError as exc:
            status = HTTPStatus.SERVICE_UNAVAILABLE if exc.code == "model-not-downloaded" else HTTPStatus.INTERNAL_SERVER_ERROR
            self._send_error_json(status, exc.message, exc.code)
            return
        except Exception as exc:
            self._send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"生成失败: {exc}")
            return

        self._send_json({"created": int(time.time()), "data": [{"b64_json": b64}]})

    def _handle_download(self, payload: dict) -> None:
        model_name = str(payload.get("model") or "")
        spec = IMAGE_MODELS.get(model_name)
        if not spec:
            self._send_error_json(HTTPStatus.BAD_REQUEST, f"未知模型: {model_name}", "unknown_model")
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
