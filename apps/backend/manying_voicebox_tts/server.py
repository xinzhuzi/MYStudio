from __future__ import annotations

import argparse
import json
import os
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import __version__
from .catalog import TTS_MODELS, get_model
from .engine import unload_engine
from .generation_routes import GenerationRoutesMixin
from .model_cache import download_hf_cache_dir, hf_cache_dirs, primary_hf_cache_dir
from .model_routes import ModelRoutesMixin
from .runtime_state import RuntimeState
from .storage import RuntimeStore


STATE: RuntimeState | None = None


def json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(ModelRoutesMixin, GenerationRoutesMixin, BaseHTTPRequestHandler):
    server_version = "MYStudioVoiceboxTTS/0.1"

    def log_message(self, fmt, *args):
        print(f"[tts-sidecar] {self.address_string()} - {fmt % args}")

    @property
    def state(self) -> RuntimeState:
        if STATE is None:
            raise RuntimeError("Runtime state is not initialized")
        return STATE

    def read_json(self) -> dict:
        length = int(self.headers.get("content-length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json_bytes(payload)
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "app://manying-studio")
        self.send_header("Access-Control-Allow-Headers", "content-type,x-manying-tts-token")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status: HTTPStatus, message: str):
        self.send_json({"detail": message, "error": message}, status=status)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "app://manying-studio")
        self.send_header("Access-Control-Allow-Headers", "content-type,x-manying-tts-token")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()

    def authorize_control(self) -> bool:
        expected = os.environ.get("MANYING_TTS_CONTROL_TOKEN")
        provided = self.headers.get("X-Manying-TTS-Token")
        if not expected or provided != expected:
            self.send_error_json(HTTPStatus.FORBIDDEN, "TTS control token is invalid")
            return False
        return True

    def do_GET(self):
        route = urlparse(self.path).path
        if route == "/health":
            self.send_json(
                {
                    "ok": True,
                    "service": "manying-voicebox-tts",
                    "version": __version__,
                    "routes": ["/health", "/profiles", "/generate", "/audio", "/models", "/tasks"],
                }
            )
            return
        if not self.authorize_control():
            return
        if route == "/models/status":
            self.send_json({"models": [self.model_status(model) for model in TTS_MODELS]})
            return
        if route == "/models/cache-dir":
            self.send_json(
                {
                    "path": str(primary_hf_cache_dir()),
                    "download_path": str(download_hf_cache_dir()),
                    "scan_paths": [str(path) for path in hf_cache_dirs()],
                }
            )
            return
        if route.startswith("/models/progress-json/"):
            model_name = unquote(route.removeprefix("/models/progress-json/"))
            self.send_json(self.model_progress(model_name))
            return
        if route.startswith("/models/progress/"):
            self.send_sse(unquote(route.removeprefix("/models/progress/")))
            return
        if route == "/tasks/active":
            self.send_json({"downloads": self.state.active_downloads(), "generations": self.state.active_generations()})
            return
        if route == "/profiles":
            self.send_json(self.state.store.list_profiles())
            return
        if route.startswith("/generate/") and route.endswith("/status"):
            generation_id = route.removeprefix("/generate/").removesuffix("/status")
            generation = self.state.store.get_generation(generation_id)
            if not generation:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Generation not found")
                return
            self.send_json(generation)
            return
        if route.startswith("/audio/"):
            self.send_audio(route.removeprefix("/audio/"))
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_POST(self):
        route = urlparse(self.path).path
        try:
            payload = self.read_json()
            if not self.authorize_control():
                return
            if route == "/shutdown":
                self.handle_shutdown()
                return
            if route == "/models/download":
                self.handle_download(payload)
                return
            if route == "/models/download/cancel":
                model_name = payload.get("model_name") or payload.get("modelName")
                if model_name:
                    self.state.set_progress(model_name, status="error", error="Download cancelled", current=0, total=0)
                self.send_json({"message": f"Download task for {model_name} cancelled"})
                return
            if route.endswith("/unload") and route.startswith("/models/"):
                self.handle_model_unload(unquote(route.removeprefix("/models/").removesuffix("/unload")))
                return
            if route == "/profiles":
                self.send_json(self.state.store.create_profile(payload), status=HTTPStatus.CREATED)
                return
            if route == "/generate":
                self.handle_generate(payload)
                return
            if route == "/transcribe":
                self.handle_transcribe(payload)
                return
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Invalid JSON body")
            return
        except Exception as exc:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_DELETE(self):
        route = urlparse(self.path).path
        if not self.authorize_control():
            return
        if route.startswith("/models/"):
            self.delete_model_cache(unquote(route.removeprefix("/models/")))
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def handle_shutdown(self):
        self.send_json({"message": "TTS backend shutting down"})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def handle_model_unload(self, model_name: str):
        model = get_model(model_name)
        if not model:
            self.send_error_json(HTTPStatus.BAD_REQUEST, f"Unknown model: {model_name}")
            return
        unloaded = unload_engine(model.engine)
        message = f"Model {model_name} unloaded" if unloaded else f"Model {model_name} is not loaded"
        self.send_json({"message": message, "unloaded": unloaded})

    def send_sse(self, model_name: str):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "app://manying-studio")
        self.end_headers()
        last_payload = None
        for _ in range(7200):
            progress = self.state.get_progress(model_name) or {
                "model_name": model_name,
                "current": 0,
                "total": 0,
                "progress": 0,
                "status": "idle",
            }
            payload = json.dumps(progress, ensure_ascii=False)
            if payload != last_payload:
                self.wfile.write(f"data: {payload}\n\n".encode("utf-8"))
                self.wfile.flush()
                last_payload = payload
            if progress.get("status") in ("complete", "error", "idle"):
                break
            time.sleep(0.5)


def run(host: str, port: int, data_dir: Path):
    global STATE
    STATE = RuntimeState(RuntimeStore(data_dir))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"[tts-sidecar] listening on http://{host}:{port}, data={data_dir}", flush=True)
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=17593)
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("MANYING_TTS_DATA_DIR", "./tts-runtime")))
    args = parser.parse_args()
    run(args.host, args.port, args.data_dir)
