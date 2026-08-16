#!/usr/bin/env python3
"""Explicit upscale model downloader — user-triggered from the settings panel.

Usage:
  python -m upscale.download_model --model realesrgan-x4plus-anime-6b \
      --progress <progress.json>

Download strategy (all sha256-pinned, atomic publish):
  1. modelscope.cn snapshot_download (CN-fast) for catalog entries with a
     verified mirror, falling back to huggingface.co.
  2. GitHub release direct URL streaming fallback (canonical source).

Progress is written to --progress as JSON (atomic temp-file rename) by a
monitor thread, mirroring the depth/TTS download progress payload shape:
  {"modelName", "status": "downloading"|"complete"|"error",
   "current", "total", "progress", "filename", "error", "updatedAt"}
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import threading
import time
import urllib.request
from pathlib import Path

from .model_cache import UPSCALE_MODELS, file_sha256, primary_model_dir


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _download_via_snapshot(repo_id: str, repo_file: str, temp_cache: Path) -> Path:
    from huggingface_hub import snapshot_download

    last_error: Exception | None = None
    for endpoint in ("https://modelscope.cn", "https://huggingface.co"):
        try:
            snapshot_download(
                repo_id=repo_id,
                allow_patterns=[repo_file],
                cache_dir=str(temp_cache),
                endpoint=endpoint,
            )
            matches = [p for p in temp_cache.rglob(repo_file) if p.is_file()]
            if matches:
                return matches[0]
            last_error = FileNotFoundError(f"{repo_id} 中未找到 {repo_file}")
        except Exception as exc:  # try the next endpoint
            last_error = exc
    raise RuntimeError(f"镜像下载失败: {last_error}")


def _download_via_url(spec: dict, destination: Path, report) -> None:
    url = spec["url"]
    request = urllib.request.Request(url, headers={"User-Agent": "MYStudio-upscale/0.1"})
    total = spec["size_mb"] * 1024 * 1024
    part = destination.with_name(f".{destination.name}.{os.getpid()}.part")
    downloaded = 0
    with urllib.request.urlopen(request, timeout=60) as response, part.open("wb") as handle:
        raw_total = response.headers.get("content-length")
        if raw_total is not None:
            total = int(raw_total)
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            downloaded += len(chunk)
            report("downloading", downloaded, min(99, int(downloaded / total * 100)) if total else 0)
    if file_sha256(part) != spec["sha256"]:
        part.unlink(missing_ok=True)
        raise ValueError("模型 sha256 校验失败")
    part.replace(destination)


def download_model(model_name: str, progress_path: Path) -> int:
    spec = UPSCALE_MODELS.get(model_name)
    if not spec:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": "error",
                "current": 0,
                "total": 0,
                "progress": 0,
                "filename": "",
                "error": f"未知模型: {model_name}",
                "updatedAt": int(time.time() * 1000),
            },
        )
        return 2

    total_bytes = spec["size_mb"] * 1024 * 1024
    model_dir = primary_model_dir()
    destination = model_dir / spec["file"]
    temp_cache = model_dir / "._hf_snapshot_tmp"

    def report(status: str, current: int, progress: int, error: str | None = None) -> None:
        _write_progress(
            progress_path,
            {
                "modelName": model_name,
                "status": status,
                "current": current,
                "total": total_bytes,
                "progress": progress,
                "filename": spec["file"],
                "error": error,
                "updatedAt": int(time.time() * 1000),
            },
        )

    report("downloading", 0, 0)
    try:
        if destination.is_file() and file_sha256(destination) == spec["sha256"]:
            report("complete", total_bytes, 100)
            return 0

        model_dir.mkdir(parents=True, exist_ok=True)

        for repo_id, repo_file in spec["sources"]:
            stop_monitor = threading.Event()

            def _monitor_progress() -> None:
                while not stop_monitor.is_set():
                    try:
                        if temp_cache.exists():
                            downloaded = sum(
                                f.stat().st_size
                                for f in temp_cache.rglob("*")
                                if f.is_file() and not f.name.endswith(".incomplete")
                            )
                            pct = min(99, int(downloaded / total_bytes * 100)) if total_bytes else 0
                            report("downloading", downloaded, pct)
                    except Exception:
                        pass
                    stop_monitor.wait(1.0)

            monitor = threading.Thread(target=_monitor_progress, daemon=True)
            monitor.start()
            try:
                snapshot_file = _download_via_snapshot(repo_id, repo_file, temp_cache)
                if file_sha256(snapshot_file) != spec["sha256"]:
                    raise ValueError("镜像文件 sha256 校验失败")
                shutil.copyfile(snapshot_file, destination)
            except Exception:
                continue
            finally:
                stop_monitor.set()
                shutil.rmtree(temp_cache, ignore_errors=True)
            if destination.is_file() and file_sha256(destination) == spec["sha256"]:
                report("complete", total_bytes, 100)
                return 0

        try:
            _download_via_url(spec, destination, report)
        except Exception as exc:
            destination.unlink(missing_ok=True)
            raise
        report("complete", total_bytes, 100)
        return 0
    except Exception as exc:
        report("error", 0, 0, str(exc))
        return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="MYStudio upscale model downloader")
    parser.add_argument("--model", required=True, help="Model name from UPSCALE_MODELS")
    parser.add_argument("--progress", required=True, help="Absolute path for progress JSON")
    args = parser.parse_args()
    return download_model(args.model, Path(args.progress))


if __name__ == "__main__":
    sys.exit(main())
