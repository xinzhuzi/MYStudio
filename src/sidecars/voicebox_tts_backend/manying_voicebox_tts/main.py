from __future__ import annotations

import argparse
import json
import os
import shutil
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import __version__
from .catalog import TTS_MODELS, get_model, model_to_dict
from .engine import is_engine_loaded, synthesize_to_wav, unload_engine
from .storage import RuntimeStore


class RuntimeState:
    def __init__(self, store: RuntimeStore):
        self.store = store
        self.lock = threading.RLock()
        self.progress: dict[str, dict] = {}
        self.download_threads: dict[str, threading.Thread] = {}
        self.generations: dict[str, dict] = {}

    def set_progress(self, model_name: str, **updates):
        with self.lock:
            current = self.progress.get(model_name, {"model_name": model_name})
            current.update(updates)
            current["timestamp"] = int(time.time() * 1000)
            self.progress[model_name] = current
            return dict(current)

    def get_progress(self, model_name: str):
        with self.lock:
            progress = self.progress.get(model_name)
            return dict(progress) if progress else None

    def active_downloads(self):
        with self.lock:
            return [dict(task) for task in self.progress.values() if task.get("status") == "downloading"]

    def start_generation(self, generation_id: str, profile_id: str, text: str):
        with self.lock:
            self.generations[generation_id] = {
                "task_id": generation_id,
                "profile_id": profile_id,
                "text": text,
                "status": "generating",
            }

    def finish_generation(self, generation_id: str, error: str | None = None):
        with self.lock:
            task = self.generations.get(generation_id)
            if not task:
                return
            if error:
                task["status"] = "failed"
                task["error"] = error
            else:
                self.generations.pop(generation_id, None)

    def active_generations(self):
        with self.lock:
            return [dict(task) for task in self.generations.values()]


STATE: RuntimeState | None = None


def hf_cache_dir() -> Path:
    try:
        from huggingface_hub import constants as hf_constants

        return Path(hf_constants.HF_HUB_CACHE)
    except Exception:
        return Path.home() / ".cache" / "huggingface" / "hub"


def repo_cache_dir(repo_id: str) -> Path:
    return hf_cache_dir() / ("models--" + repo_id.replace("/", "--"))


def is_model_downloaded(repo_id: str) -> tuple[bool, float | None]:
    cache = repo_cache_dir(repo_id)
    if not cache.exists():
        return False, None
    has_snapshot = (cache / "snapshots").exists()
    incomplete = list((cache / "blobs").glob("*.incomplete")) if (cache / "blobs").exists() else []
    if not has_snapshot or incomplete:
        return False, None
    size = sum(file.stat().st_size for file in cache.rglob("*") if file.is_file() and not file.name.endswith(".incomplete"))
    return True, round(size / 1024 / 1024, 2)


def json_bytes(payload) -> bytes:
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def send_error_json(self, status: HTTPStatus, message: str):
        self.send_json({"detail": message, "error": message}, status=status)

    def do_OPTIONS(self):
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "content-type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        route = parsed.path
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
        if route == "/models/status":
            self.send_json({"models": [self.model_status(model) for model in TTS_MODELS]})
            return
        if route == "/models/cache-dir":
            self.send_json({"path": str(hf_cache_dir())})
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
            generation_id = route.removeprefix("/audio/")
            self.send_audio(generation_id)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            payload = self.read_json()
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
                model_name = unquote(route.removeprefix("/models/").removesuffix("/unload"))
                model = get_model(model_name)
                if not model:
                    self.send_error_json(HTTPStatus.BAD_REQUEST, f"Unknown model: {model_name}")
                    return
                unloaded = unload_engine(model.engine)
                message = f"Model {model_name} unloaded" if unloaded else f"Model {model_name} is not loaded"
                self.send_json({"message": message, "unloaded": unloaded})
                return
            if route == "/profiles":
                self.send_json(self.state.store.create_profile(payload), status=HTTPStatus.CREATED)
                return
            if route == "/generate":
                self.handle_generate(payload)
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
        if route.startswith("/models/"):
            model_name = unquote(route.removeprefix("/models/"))
            model = get_model(model_name)
            if not model:
                self.send_error_json(HTTPStatus.BAD_REQUEST, f"Unknown model: {model_name}")
                return
            cache = repo_cache_dir(model.hf_repo_id)
            if not cache.exists():
                self.send_error_json(HTTPStatus.NOT_FOUND, f"Model {model_name} not found in cache")
                return
            shutil.rmtree(cache)
            self.send_json({"message": f"Model {model_name} deleted successfully"})
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def model_status(self, model):
        downloaded, size_mb = is_model_downloaded(model.hf_repo_id)
        progress = self.state.get_progress(model.model_name)
        downloading = progress is not None and progress.get("status") == "downloading"
        return {
            "model_name": model.model_name,
            "display_name": model.display_name,
            "hf_repo_id": model.hf_repo_id,
            "downloaded": downloaded and not downloading,
            "downloading": downloading,
            "size_mb": size_mb,
            "loaded": is_engine_loaded(model.engine),
            "engine": model.engine,
            "model_size": model.model_size,
            "languages": list(model.languages),
            "purpose": model.purpose,
            "description": model.description,
        }

    def handle_download(self, payload: dict):
        model_name = payload.get("model_name") or payload.get("modelName")
        model = get_model(model_name)
        if not model:
            self.send_error_json(HTTPStatus.BAD_REQUEST, f"Unknown model: {model_name}")
            return
        if model_name in self.state.download_threads and self.state.download_threads[model_name].is_alive():
            self.send_json({"message": f"Model {model_name} download already running"})
            return
        self.state.set_progress(
            model_name,
            current=0,
            total=model.size_mb * 1024 * 1024,
            progress=0,
            filename="Connecting to HuggingFace...",
            status="downloading",
        )
        thread = threading.Thread(target=self.download_model, args=(model.model_name,), daemon=True)
        self.state.download_threads[model.model_name] = thread
        thread.start()
        self.send_json({"message": f"Model {model.model_name} download started"})

    def download_model(self, model_name: str):
        model = get_model(model_name)
        if not model:
            return
        try:
            if os.environ.get("MANYING_TTS_DRY_RUN_DOWNLOADS") == "1":
                for step in range(1, 6):
                    time.sleep(0.2)
                    self.state.set_progress(
                        model_name,
                        current=step,
                        total=5,
                        progress=step * 20,
                        filename=f"dry-run-{step}",
                        status="downloading",
                    )
            else:
                from huggingface_hub import snapshot_download

                self.state.set_progress(
                    model_name,
                    current=0,
                    total=model.size_mb * 1024 * 1024,
                    progress=0,
                    filename=model.hf_repo_id,
                    status="downloading",
                )
                snapshot_download(repo_id=model.hf_repo_id)
            self.state.set_progress(
                model_name,
                current=model.size_mb * 1024 * 1024,
                total=model.size_mb * 1024 * 1024,
                progress=100,
                filename=model.hf_repo_id,
                status="complete",
            )
        except Exception as exc:
            self.state.set_progress(model_name, current=0, total=0, progress=0, status="error", error=str(exc))

    def handle_generate(self, payload: dict):
        profile_id = payload.get("profile_id") or payload.get("profileId")
        text = (payload.get("text") or "").strip()
        if not profile_id:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "profile_id is required")
            return
        if not text:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "text is required")
            return
        profile = self.state.store.get_profile(profile_id)
        if not profile:
            self.send_error_json(HTTPStatus.NOT_FOUND, "Profile not found")
            return
        engine = payload.get("engine") or profile.get("default_engine") or "qwen"
        model_size = payload.get("model_size") or payload.get("modelSize") or profile.get("default_model_size")
        language = payload.get("language") or profile.get("language") or "zh"
        generation = self.state.store.create_generation(profile_id, text, engine, model_size, language)
        self.state.start_generation(generation["id"], profile_id, text)
        thread = threading.Thread(target=self.generate_audio, args=(generation["id"], text, profile, engine, model_size, language, payload.get("seed")), daemon=True)
        thread.start()
        self.send_json(generation, status=HTTPStatus.CREATED)

    def generate_audio(self, generation_id: str, text: str, profile: dict, engine: str, model_size: str | None, language: str, seed: int | None):
        try:
            output = self.state.store.audio_dir / f"{generation_id}.wav"
            result = synthesize_to_wav(
                output=output,
                text=text,
                profile=profile,
                engine=engine,
                model_size=model_size,
                language=language,
                seed=seed,
            )
            self.state.store.update_generation(
                generation_id,
                status="completed",
                audio_path=str(output),
                duration=result.duration,
                backend=result.backend,
                mocked=1 if result.mocked else 0,
                warning=result.warning,
                error=None,
            )
            self.state.finish_generation(generation_id)
        except Exception as exc:
            self.state.store.update_generation(generation_id, status="failed", error=str(exc))
            self.state.finish_generation(generation_id, str(exc))

    def send_audio(self, generation_id: str):
        generation = self.state.store.get_generation(generation_id)
        if not generation or not generation.get("audio_path"):
            self.send_error_json(HTTPStatus.NOT_FOUND, "Audio not found")
            return
        audio_path = Path(generation["audio_path"])
        if not audio_path.exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, "Audio file missing")
            return
        data = audio_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def send_sse(self, model_name: str):
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
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


if __name__ == "__main__":
    main()
