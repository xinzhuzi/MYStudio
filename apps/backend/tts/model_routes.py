from __future__ import annotations

import os
import shutil
import threading
import time
from http import HTTPStatus
from pathlib import Path

from .catalog import get_model
from .engine import is_engine_loaded
from .model_cache import download_hf_cache_dir, find_cached_model, repo_cache_dir
from .model_inventory import (
    ALIGNMENT_MODEL_NAME,
    ALIGNMENT_TOKENIZER_REPO,
    build_model_status,
)


class ModelRoutesMixin:
    def model_status(self, model):
        configured_cache_dirs = [download_hf_cache_dir()] if (
            os.environ.get("MANYING_TTS_MODELS_DIR") or os.environ.get("VOICEBOX_MODELS_DIR")
        ) else None
        progress = self.state.get_progress(model.model_name)
        downloading = progress is not None and progress.get("status") == "downloading"
        return build_model_status(
            model,
            cache_dirs=configured_cache_dirs,
            downloading=downloading,
            loaded=is_engine_loaded(model.engine),
        )

    def model_progress(self, model_name: str):
        return self.state.get_progress(model_name) or {
            "model_name": model_name,
            "current": 0,
            "total": 0,
            "progress": 0,
            "status": "idle",
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
                    try:
                        snapshot_download(repo_id=model.hf_repo_id, cache_dir=cache_dir, endpoint="https://modelscope.cn")
                    except Exception:
                        snapshot_download(repo_id=model.hf_repo_id, cache_dir=cache_dir, endpoint="https://huggingface.co")
                    if model_name == ALIGNMENT_MODEL_NAME:
                        try:
                            snapshot_download(repo_id=ALIGNMENT_TOKENIZER_REPO, cache_dir=cache_dir, endpoint="https://modelscope.cn")
                        except Exception:
                            snapshot_download(repo_id=ALIGNMENT_TOKENIZER_REPO, cache_dir=cache_dir, endpoint="https://huggingface.co")
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

    def delete_model_cache(self, model_name: str):
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
