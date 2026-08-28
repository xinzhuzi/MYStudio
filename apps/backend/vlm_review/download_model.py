"""Explicit VLM model download — triggered ONLY from Settings page button.

Download source strategy (08-28): ModelScope direct links FIRST (measured
~4MB/s on this network vs HF ~0.1MB/s which reads as a frozen progress bar),
huggingface_hub.snapshot_download as fallback. Resume supported both ways:
ModelScope via HTTP Range on partial files, HF via its native resume.

Target dir: <storageBase>/model/vlm/<model_name> (flat HF-layout files; the
probe accepts config.json + *.safetensors + chat_template.jinja/tokenizer_*).
Progress is written every second by a monitor thread scanning the target dir.
"""
from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from pathlib import Path
from urllib.parse import quote

from .model_cache import DEFAULT_VLM_MODEL, VLM_MODELS

TOTAL_BYTES_FALLBACK_MB = 9900
MODELSCOPE_BASE = "https://modelscope.cn"


def _write_progress(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def _resolve_target_dir(model_name: str, progress_path: Path | None) -> Path | None:
    """<storageBase>/model/vlm/<model_name>;storageBase 优先从进度文件路径反推。"""
    import os

    storage_base = os.environ.get("MYSTUDIO_STORAGE_BASE", "")
    if not storage_base and progress_path is not None:
        # progress 文件位于 <storageBase>/profiles/vlm-review/download-progress.json
        candidate = progress_path.parent.parent
        if candidate.name == "profiles":
            storage_base = str(candidate.parent)
    if not storage_base:
        return None
    return Path(storage_base) / "model" / "vlm" / model_name


def _list_modelscope_files(repo_id: str) -> list[tuple[str, int]]:
    """ModelScope 文件列表 API → [(path, size_bytes)];失败抛异常由调用方回退 HF。"""
    import urllib.request

    url = f"{MODELSCOPE_BASE}/api/v1/models/{repo_id}/repo/files?Recursive=true"
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.load(response)
    entries = payload.get("Data", {}).get("Files", [])
    return [
        (entry["Path"], int(entry.get("Size") or 0))
        for entry in entries
        if entry.get("Type") == "blob"
    ]


def _download_from_modelscope(repo_id: str, target_dir: Path) -> None:
    """逐文件流式下载(Range 续传);已完整存在的文件跳过。"""
    import requests

    session = requests.Session()
    for path, expected_size in _list_modelscope_files(repo_id):
        dest = target_dir / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        have = dest.stat().st_size if dest.exists() else 0
        if expected_size and have == expected_size:
            continue
        url = f"{MODELSCOPE_BASE}/models/{repo_id}/resolve/master/{quote(path)}"
        headers = {"Range": f"bytes={have}-"} if have else {}
        with session.get(url, stream=True, headers=headers, timeout=(15, 120)) as resp:
            resp.raise_for_status()
            if have and resp.status_code != 206:
                # 服务器忽略 Range(返回 200 全量)——从头重下。
                have = 0
            with open(dest, "ab" if have else "wb") as handle:
                for chunk in resp.iter_content(chunk_size=1024 * 512):
                    handle.write(chunk)


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

    target_dir = _resolve_target_dir(model_name, progress_path)
    total_bytes = int(spec.get("size_mb", TOTAL_BYTES_FALLBACK_MB)) * 1024 * 1024

    def report(status: str, downloaded: int, percentage: float, message: str | None = None) -> None:
        if not progress_path:
            return
        payload = {
            "status": status,
            "percentage": round(percentage, 1),
            "downloadedMB": round(downloaded / 1024 / 1024, 1),
            "totalMB": round(total_bytes / 1024 / 1024, 1),
            "timestamp": int(time.time() * 1000),
        }
        if message:
            payload["message"] = message[:300]
        _write_progress(progress_path, payload)

    report("downloading", 0, 0)

    stop_monitor = threading.Event()

    def _dir_size(path: Path) -> int:
        try:
            return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
        except Exception:
            return 0

    def _monitor() -> None:
        while not stop_monitor.is_set():
            try:
                if target_dir is not None and target_dir.exists():
                    downloaded = _dir_size(target_dir)
                    pct = min(99.0, downloaded / total_bytes * 100) if total_bytes else 0
                    report("downloading", downloaded, pct)
            except Exception:
                pass
            stop_monitor.wait(1.0)

    try:
        threading.Thread(target=_monitor, daemon=True).start()
        result = None
        # ModelScope 直链优先(本机实测 ~4MB/s,HF ~0.1MB/s 形同卡死);失败回退 HF。
        if target_dir is not None:
            try:
                _download_from_modelscope(repo_id, target_dir)
                result = str(target_dir)
            except Exception as exc:
                print(f"[vlm-download] ModelScope 失败,回退 HF: {exc}", file=sys.stderr)
        if result is None:
            result = snapshot_download(
                repo_id=repo_id,
                local_dir=str(target_dir) if target_dir else None,
                resume_download=True,
            )
        report("done", total_bytes, 100)
        print(json.dumps({"status": "done", "path": str(result)}))
    except Exception as exc:
        report("error", 0, 0, message=str(exc))
        sys.exit(2)
    finally:
        stop_monitor.set()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default=DEFAULT_VLM_MODEL)
    parser.add_argument("--progress", type=str)
    args = parser.parse_args()
    download_model(args.model, args.progress)
