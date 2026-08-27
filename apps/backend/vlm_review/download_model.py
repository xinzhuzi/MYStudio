"""Explicit VLM model download — triggered ONLY from Settings page button.

Downloads via huggingface_hub.snapshot_download with resume support.
Progress is written to a JSON file that the frontend polls.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

from .model_cache import DEFAULT_VLM_MODEL, VLM_MODELS


def _write_progress(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def download_model(
    model_name: str = DEFAULT_VLM_MODEL,
    progress_file: str | None = None,
) -> None:
    spec = VLM_MODELS.get(model_name)
    if not spec:
        print(f"Unknown model: {model_name}", file=sys.stderr)
        sys.exit(1)

    repo_id = spec["repo_id"]
    progress_path = Path(progress_file) if progress_file else None

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        if progress_path:
            _write_progress(progress_path, {
                "status": "error", "code": "huggingface-hub-missing",
                "message": "huggingface_hub 未安装",
            })
        sys.exit(2)

    def on_progress(progress: int, total: int, *_args) -> None:
        if progress_path:
            _write_progress(progress_path, {
                "status": "downloading",
                "percentage": round(progress / total * 100, 1) if total else 0,
                "downloadedMB": round(progress / 1024 / 1024, 1),
                "totalMB": round(total / 1024 / 1024, 1),
                "timestamp": int(time.time() * 1000),
            })

    try:
        # Determine target dir: <storageBase>/model/vlm/<model_name>
        import os
        storage_base = os.environ.get("MYSTUDIO_STORAGE_BASE", "")
        if not storage_base:
            # Fallback: use HF cache
            target_dir = None
        else:
            target_dir = Path(storage_base) / "model" / "vlm" / model_name

        result = snapshot_download(
            repo_id=repo_id,
            local_dir=str(target_dir) if target_dir else None,
            resume_download=True,
        )

        if progress_path:
            _write_progress(progress_path, {
                "status": "done",
                "path": str(result),
                "timestamp": int(time.time() * 1000),
            })
        print(json.dumps({"status": "done", "path": str(result)}))
    except Exception as exc:
        if progress_path:
            _write_progress(progress_path, {
                "status": "error",
                "message": str(exc)[:300],
                "timestamp": int(time.time() * 1000),
            })
        sys.exit(2)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default=DEFAULT_VLM_MODEL)
    parser.add_argument("--progress", type=str)
    args = parser.parse_args()
    download_model(args.model, args.progress)
