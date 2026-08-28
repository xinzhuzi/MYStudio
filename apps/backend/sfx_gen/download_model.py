#!/usr/bin/env python3
"""Explicit sfx model downloader. Usage:
  python -m sfx_gen.download_model --model sfx-musicgen-small --progress <progress.json>
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import time
from pathlib import Path

from .model_cache import SFX_MODELS, primary_hf_cache_dir, repo_cache_dir


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def download_model(model_name: str, progress_path: Path) -> int:
    spec = SFX_MODELS.get(model_name)
    if not spec:
        _write_progress(
            progress_path,
            {"modelName": model_name, "status": "error", "current": 0, "total": 0, "progress": 0,
             "error": f"未知模型: {model_name}", "updatedAt": int(time.time() * 1000)},
        )
        return 2
    if not spec["enabled"]:
        _write_progress(
            progress_path,
            {"modelName": model_name, "status": "error", "current": 0, "total": 0, "progress": 0,
             "error": f"模型 {spec['label']} 为选型候选尚未启用(需实测与许可核定)", "updatedAt": int(time.time() * 1000)},
        )
        return 2

    total_bytes = spec["size_mb"] * 1024 * 1024

    def report(status: str, current: int, progress: int, error: str | None = None) -> None:
        _write_progress(
            progress_path,
            {"modelName": model_name, "status": status, "current": current, "total": total_bytes,
             "progress": progress, "filename": spec["repo_id"], "error": error,
             "updatedAt": int(time.time() * 1000)},
        )

    report("downloading", 0, 0)
    try:
        from huggingface_hub import snapshot_download

        cache_dir = str(primary_hf_cache_dir())
        repo_dir = repo_cache_dir(spec["repo_id"], Path(cache_dir))

        stop_monitor = threading.Event()

        def _monitor() -> None:
            while not stop_monitor.is_set():
                try:
                    if repo_dir.exists():
                        downloaded = sum(f.stat().st_size for f in repo_dir.rglob("*") if f.is_file())
                        pct = min(99, int(downloaded / total_bytes * 100)) if total_bytes else 0
                        report("downloading", downloaded, pct)
                except Exception:
                    pass
                stop_monitor.wait(1.0)

        monitor = threading.Thread(target=_monitor, daemon=True)
        monitor.start()
        try:
            try:
                # ModelScope 直链优先(实测 ~4-18MB/s;endpoint 参数路线协议不兼容从未生效)。
                from modelscope_hub import download_repo_to_hf_cache

                download_repo_to_hf_cache(spec["repo_id"], cache_dir)
            except Exception as exc:
                print(f"[download] ModelScope 直链失败,回退 HF: {exc}", file=sys.stderr)
                snapshot_download(repo_id=spec["repo_id"], cache_dir=cache_dir)
        finally:
            stop_monitor.set()

        report("complete", total_bytes, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, error=str(exc))
        return 2


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio sfx model downloader")
    parser.add_argument("--model", required=True)
    parser.add_argument("--progress", required=True)
    args = parser.parse_args()

    progress_path = Path(args.progress)
    if not progress_path.is_absolute():
        print(json.dumps({"error": "--progress 必须是绝对路径"}))
        sys.exit(2)
    sys.exit(download_model(args.model, progress_path))


if __name__ == "__main__":
    main()
