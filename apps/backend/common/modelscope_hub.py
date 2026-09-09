"""ModelScope 直链下载助手 — 全族模型下载器共用(08-28)。

为什么存在:此前各下载器给 huggingface_hub 传 endpoint="https://modelscope.cn"
寄望走国内源,但 modelscope.cn 不说 HF 协议,该调用必然报错并静默回退 HF
(本机实测 HF ~0.1MB/s,9.9GB 要 28 小时,进度条形同卡死)。本助手走
ModelScope 原生 REST(文件列表 API + resolve 直链 + Range 断点续传),
实测 ~4-18MB/s。

落盘布局:文件平铺写进 <cache_dir>/models--<org>--<name>/snapshots/main/<path>。
各族 find_cached_*/_has_complete_model_files 的完整性检查只 glob snapshots/
下的实际文件,天然兼容;与 HF 原生下载的 blobs/snapshots 布局共存无害。

仓库未在 ModelScope 镜像时抛异常,由调用方回退 HF snapshot_download。
"""
from __future__ import annotations

import json
import time
from pathlib import Path
from urllib.parse import quote

MODELSCOPE_BASE = "https://modelscope.cn"


def repo_cache_name(repo_id: str) -> str:
    return "models--" + repo_id.replace("/", "--")


def list_modelscope_files(repo_id: str) -> list[tuple[str, int]]:
    """ModelScope 文件列表 API → [(path, size_bytes)];仓库不存在时抛异常。"""
    import urllib.request

    url = f"{MODELSCOPE_BASE}/api/v1/models/{repo_id}/repo/files?Recursive=true"
    with urllib.request.urlopen(url, timeout=30) as response:
        payload = json.load(response)
    entries = payload.get("Data", {}).get("Files", [])
    files = [
        (entry["Path"], int(entry.get("Size") or 0))
        for entry in entries
        if entry.get("Type") == "blob"
    ]
    if not files:
        raise RuntimeError(f"ModelScope 仓库 {repo_id} 文件列表为空")
    return files


def download_repo_to_hf_cache(repo_id: str, cache_dir: str, allow_paths: tuple[str, ...] | list[str] | None = None) -> Path:
    """把仓库文件下载到 HF 快照布局的 snapshots/main/ 下;返回该目录。

    allow_paths 非空时只下载清单内的精确路径(08-30 imagegen 自足回退:
    大件仓 Comfy-Org/Qwen-Image_ComfyUI 整仓含 38G×数个扩散模型,必须过滤)。
    已完整存在的文件跳过;部分文件按 Range 断点续传;任何失败抛异常。
    """
    import requests

    target = Path(cache_dir) / repo_cache_name(repo_id) / "snapshots" / "main"
    target.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    last_progress_log = 0.0
    for path, expected_size in list_modelscope_files(repo_id):
        if allow_paths is not None and path not in allow_paths:
            continue
        dest = target / path
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
        now = time.monotonic()
        if now - last_progress_log > 5.0:
            print(f"[modelscope] {repo_id}: 已完成 {path}", flush=True)
            last_progress_log = now
    return target
