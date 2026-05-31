from __future__ import annotations
from __future__ import annotations

import argparse
import json
import os

# 默认使用 ModelScope 作为 HuggingFace 镜像（国内全量支持 mlx-community）
if not os.environ.get("HF_ENDPOINT"):
    os.environ["HF_ENDPOINT"] = "https://modelscope.cn"
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
from .model_cache import download_hf_cache_dir, find_cached_model, hf_cache_dirs, is_model_downloaded, primary_hf_cache_dir, repo_cache_dir
from .storage import RuntimeStore

import queue


def _inference_worker(task_queue: queue.Queue):
    """Dedicated thread for all MLX/TTS inference (MLX is not thread-safe)."""
    while True:
        task = task_queue.get()
        if task is None:
            break
        fn, args = task
        try:
            fn(*args)
        except Exception:
            pass
        task_queue.task_done()


class RuntimeState:
    def __init__(self, store: RuntimeStore):
        self.store = store
        self.lock = threading.RLock()
        self.progress: dict[str, dict] = {}
        self.download_threads: dict[str, threading.Thread] = {}
        self.generations: dict[str, dict] = {}
        self.inference_queue: queue.Queue = queue.Queue()
        self._inference_thread = threading.Thread(target=_inference_worker, args=(self.inference_queue,), daemon=True)
        self._inference_thread.start()

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
            generation_id = route.removeprefix("/audio/")
            self.send_audio(generation_id)
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def do_POST(self):
        parsed = urlparse(self.path)
        route = parsed.path
        try:
            payload = self.read_json()
            if not self.authorize_control():
                return
            if route == "/shutdown":
                self.handle_shutdown(payload)
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
            model_name = unquote(route.removeprefix("/models/"))
            model = get_model(model_name)
            if not model:
                self.send_error_json(HTTPStatus.BAD_REQUEST, f"Unknown model: {model_name}")
                return
            cached = find_cached_model(model)
            cache = cached.repo_cache_dir if cached else repo_cache_dir(model.hf_repo_id)
            if not cache.exists():
                self.send_error_json(HTTPStatus.NOT_FOUND, f"Model {model_name} not found in cache")
                return
            shutil.rmtree(cache)
            self.send_json({"message": f"Model {model_name} deleted successfully"})
            return
        self.send_error_json(HTTPStatus.NOT_FOUND, "Route not found")

    def model_status(self, model):
        cached = find_cached_model(model)
        downloaded = cached is not None
        size_mb = cached.size_mb if cached else None
        progress = self.state.get_progress(model.model_name)
        downloading = progress is not None and progress.get("status") == "downloading"
        return {
            "model_name": model.model_name,
            "display_name": model.display_name,
            "hf_repo_id": model.hf_repo_id,
            "downloaded": downloaded and not downloading,
            "downloading": downloading,
            "size_mb": size_mb,
            "model_cache_dir": str(cached.cache_dir) if cached else None,
            "model_repo_path": str(cached.repo_cache_dir) if cached else None,
            "loaded": is_engine_loaded(model.engine),
            "engine": model.engine,
            "model_size": model.model_size,
            "languages": list(model.languages),
            "purpose": model.purpose,
            "description": model.description,
        }

    def model_progress(self, model_name: str):
        return self.state.get_progress(model_name) or {
            "model_name": model_name,
            "current": 0,
            "total": 0,
            "progress": 0,
            "status": "idle",
        }

    def handle_shutdown(self, payload: dict):
        self.send_json({"message": "TTS backend shutting down"})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

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

                total_bytes = model.size_mb * 1024 * 1024
                self.state.set_progress(
                    model_name,
                    current=0,
                    total=total_bytes,
                    progress=0,
                    filename=model.hf_repo_id,
                    status="downloading",
                )
                cache_dir = str(download_hf_cache_dir())
                repo_dir = repo_cache_dir(model.hf_repo_id, Path(cache_dir))

                # 后台线程监控下载进度（通过缓存目录大小）
                stop_monitor = threading.Event()

                def _monitor_progress():
                    while not stop_monitor.is_set():
                        try:
                            if repo_dir.exists():
                                downloaded = sum(f.stat().st_size for f in repo_dir.rglob("*") if f.is_file())
                                pct = min(99, int(downloaded / total_bytes * 100)) if total_bytes else 0
                                self.state.set_progress(
                                    model_name,
                                    current=downloaded,
                                    total=total_bytes,
                                    progress=pct,
                                    filename=model.hf_repo_id,
                                    status="downloading",
                                )
                        except Exception:
                            pass
                        stop_monitor.wait(1.0)

                monitor = threading.Thread(target=_monitor_progress, daemon=True)
                monitor.start()
                try:
                    # 尝试下载：先用 ModelScope 镜像，失败则直连 HF
                    try:
                        snapshot_download(repo_id=model.hf_repo_id, cache_dir=cache_dir, endpoint="https://modelscope.cn")
                    except Exception:
                        snapshot_download(repo_id=model.hf_repo_id, cache_dir=cache_dir, endpoint="https://huggingface.co")
                finally:
                    stop_monitor.set()
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
        self.state.inference_queue.put((self.generate_audio, (generation["id"], text, profile, engine, model_size, language, payload.get("seed"))))
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

    def handle_transcribe(self, payload: dict):
        audio_path = payload.get("audio_path") or payload.get("audioPath")
        if not audio_path:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "audio_path is required")
            return
        if not Path(str(audio_path)).exists():
            self.send_error_json(HTTPStatus.NOT_FOUND, f"Audio file not found: {audio_path}")
            return
        # 同步执行转录（在推理线程中）
        import queue as _queue
        result_queue: _queue.Queue = _queue.Queue()

        def _do_transcribe():
            try:
                import wave
                import contextlib
                # 获取音频时长（仅 wav 精确，其他格式按 SenseVoice 处理）
                duration = 0.0
                try:
                    with contextlib.closing(wave.open(str(audio_path), 'r')) as wf:
                        duration = wf.getnframes() / float(wf.getframerate())
                except Exception:
                    duration = 0.0  # 非 wav，默认走 SenseVoice

                try:
                    from mlx_audio.stt import load as load_stt
                    _has_mlx = True
                except Exception:
                    _has_mlx = False

                if _has_mlx:
                    # ≤30秒优先用 SenseVoice（带标点，短音频更准）
                    sensevoice_model = get_model("sensevoice-small")
                    use_sensevoice = duration <= 30 and sensevoice_model and find_cached_model(sensevoice_model)
                    if use_sensevoice:
                        if not hasattr(self.state, '_sensevoice') or self.state._sensevoice is None:
                            self.state._sensevoice = load_stt("mlx-community/SenseVoiceSmall")
                        result = self.state._sensevoice.generate(str(audio_path), language="zh", use_itn=True)
                    else:
                        if not hasattr(self.state, '_stt_model') or self.state._stt_model is None:
                            model = load_stt("mlx-community/whisper-large-v3-turbo")
                            if model._processor is None:
                                from transformers import WhisperProcessor
                                model._processor = WhisperProcessor.from_pretrained("openai/whisper-large-v3-turbo")
                            self.state._stt_model = model
                        result = self.state._stt_model.generate(str(audio_path), language="zh")
                else:
                    # 非 Apple 平台（Windows/Linux）：用 transformers Whisper（CUDA/CPU）
                    import torch
                    from transformers import pipeline
                    if not hasattr(self.state, '_stt_pipe') or self.state._stt_pipe is None:
                        device = 0 if torch.cuda.is_available() else -1
                        self.state._stt_pipe = pipeline(
                            "automatic-speech-recognition",
                            model="openai/whisper-large-v3-turbo",
                            device=device,
                            chunk_length_s=30,
                        )
                    result = self.state._stt_pipe(str(audio_path), generate_kwargs={"language": "chinese"})
                if isinstance(result, str):
                    text = result.strip()
                elif isinstance(result, dict):
                    text = result.get("text", "").strip()
                elif hasattr(result, "text"):
                    text = result.text.strip()
                else:
                    text = str(result).strip()
                result_queue.put(("ok", text))
            except Exception as exc:
                result_queue.put(("error", str(exc)))

        self.state.inference_queue.put((_do_transcribe, ()))
        # 等待结果（最多 60 秒）
        try:
            status, value = result_queue.get(timeout=60)
            if status == "ok":
                self.send_json({"text": value})
            else:
                self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, f"转录失败: {value}")
        except Exception:
            self.send_error_json(HTTPStatus.INTERNAL_SERVER_ERROR, "转录超时")

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
        self.send_header("Access-Control-Allow-Origin", "app://manying-studio")
        self.end_headers()
        self.wfile.write(data)

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


if __name__ == "__main__":
    main()
