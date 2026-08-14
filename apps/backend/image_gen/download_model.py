#!/usr/bin/env python3
"""Explicit image model downloader — user-triggered from the settings panel.

Usage:
  python -m image_gen.download_model --model sdxl-turbo --progress <progress.json>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

from .model_cache import IMAGE_MODELS, download_hf_cache_dir, repo_cache_dir


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def download_model(model_name: str, progress_path: Path) -> int:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": "error",
                "current": 0,
                "total": 0,
                "progress": 0,
                "error": f"未知模型: {model_name}",
                "updatedAt": int(time.time() * 1000),
            },
        )
        return 2

    total_bytes = spec["size_mb"] * 1024 * 1024

    def report(status: str, current: int, progress: int, error: str | None = None) -> None:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": status,
                "current": current,
                "total": total_bytes,
                "progress": progress,
                "filename": spec["repo_id"],
                "error": error,
                "updatedAt": int(time.time() * 1000),
            },
        )

    report("downloading", 0, 0)
    try:
        from huggingface_hub import snapshot_download

        cache_dir = str(download_hf_cache_dir())
        repo_dir = repo_cache_dir(spec["repo_id"], Path(cache_dir))

        stop_monitor = threading.Event()

        def _monitor_progress() -> None:
            while not stop_monitor.is_set():
                try:
                    if repo_dir.exists():
                        downloaded = sum(
                            f.stat().st_size for f in repo_dir.rglob("*") if f.is_file()
                        )
                        pct = min(99, int(downloaded / total_bytes * 100)) if total_bytes else 0
                        report("downloading", downloaded, pct)
                except Exception:
                    pass
                stop_monitor.wait(1.0)

        monitor = threading.Thread(target=_monitor_progress, daemon=True)
        monitor.start()
        try:
            try:
                snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir, endpoint="https://modelscope.cn")
            except Exception:
                snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir, endpoint="https://huggingface.co")
        finally:
            stop_monitor.set()

        report("complete", total_bytes, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, error=str(exc))
        return 2


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio image model downloader")
    parser.add_argument("--model", required=True)
    parser.add_argument("--progress", required=True, help="Absolute path for the progress JSON")
    args = parser.parse_args()

    progress_path = Path(args.progress)
    if not progress_path.is_absolute():
        print(json.dumps({"error": "--progress 必须是绝对路径"}))
        sys.exit(2)

    sys.exit(download_model(args.model, progress_path))


if __name__ == "__main__":
    main()
