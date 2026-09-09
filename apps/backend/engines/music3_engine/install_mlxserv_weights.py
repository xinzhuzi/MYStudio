#!/usr/bin/env python3
"""mlx-serve 指向版 bf16 权重获取器(ModelScope 全量 → 本地转 MLX)。

为没有现成权重的机器补齐「下载 bf16」流程(08-19 用户裁定路线):
  1. ModelScope `MiniMax/MiniMax-Music3` 选择性拉取——只下转换所需的
     diffusers 集,跳过上游冗余(qwen_7B/qwen_7B 原始 SGLang 份 +
     flowmatching_vae.pth + dav.pth,共约 18.7 GB),断点续传;
  2. vendored 官方脚本 convert_music3_weights.py --bits 16 转 MLX bf16 布局;
  3. 校验产物(五件 safetensors + tokenizer/ + music_tokenizer/)后清理源目录。

仅标准库(下载阶段不需要 mlx);转换前才检查 mlx——在下载 26 GB 之前 fail-fast。

产物恒为 bf16 全精度(08-19 用户裁定:本机只用 bf16;vendored 脚本的量化分支不走)。

Usage:
  python -m music3_gen.install_mlxserv_weights --src <staging> --out <pack> --progress <progress.json>
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

MODELSCOPE_REPO = "MiniMax/MiniMax-Music3"
MODELSCOPE_FILES_API = f"https://modelscope.cn/api/v1/models/{MODELSCOPE_REPO}/repo/files"
MODELSCOPE_FILE_API = f"https://modelscope.cn/api/v1/models/{MODELSCOPE_REPO}/repo"

# 转换脚本只消费这些子树(COMPONENTS + TOKENIZER_SRC + MUSIC_TOKENIZER_SRC + 各自 config)。
REQUIRED_SUBTREES = (
    "condition_encoder",
    "language_model",
    "rvq_depth_decoder",
    "transformer",
    "vocoder",
    "scheduler",
    "tokenizer",
    "qwen_7B/qwen3-8B-tokenizer-music",
)
REQUIRED_ROOT_FILES = ("LICENSE",)

# 产物完整性(与控制器 MLXSERV_REQUIRED_WEIGHTS/DIRS 同参)。
REQUIRED_OUTPUT_WEIGHTS = (
    "language_model.safetensors",
    "rvq_depth_decoder.safetensors",
    "transformer.safetensors",
    "condition_encoder.safetensors",
    "vocoder.safetensors",
)
REQUIRED_OUTPUT_DIRS = ("tokenizer", "music_tokenizer")

DOWNLOAD_RETRIES = 5
DOWNLOAD_READ_TIMEOUT_S = 60
PROGRESS_THROTTLE_S = 2.0
CONVERT_TIMEOUT_S = 30 * 60
HEARTBEAT_INTERVAL_S = 5.0
# 下载/转换态的心跳上限:超过即视为进程已死(应用退出等),允许重新发起。
STALE_AFTER_S = 5 * 60


def _write_progress(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(path)


def _list_dir(root: str) -> list[dict]:
    """列一个子树下的所有 blob(递归展开 tree)。ModelScope 文件清单 API。"""
    url = f"{MODELSCOPE_FILES_API}?Revision=master&Root={urllib.parse.quote(root)}"
    with urllib.request.urlopen(url, timeout=30) as response:
        body = json.load(response)
    if not isinstance(body, dict) or body.get("Code") != 200:
        raise RuntimeError(f"ModelScope 清单接口异常({root})")
    files = body.get("Data", {}).get("Files", [])
    blobs: list[dict] = []
    for entry in files:
        if entry.get("Type") == "tree":
            blobs.extend(_list_dir(entry["Path"]))
        elif entry.get("Type") == "blob":
            blobs.append({"path": entry["Path"], "size": int(entry.get("Size") or 0)})
    return blobs


def enumerate_files() -> list[dict]:
    blobs: list[dict] = []
    for root in REQUIRED_SUBTREES:
        blobs.extend(_list_dir(root))
    for name in REQUIRED_ROOT_FILES:
        blobs.append({"path": name, "size": 0})  # 根文件大小未知,下载时以实际为准
    # 去重(防御清单重复)
    seen: set[str] = set()
    unique = [b for b in blobs if not (b["path"] in seen or seen.add(b["path"]))]
    return unique


def _file_url(repo_path: str) -> str:
    return f"{MODELSCOPE_FILE_API}?Revision=master&FilePath={urllib.parse.quote(repo_path)}"


def download_file(repo_path: str, expected_size: int, dest: Path) -> bool:
    """单文件断点续传下载。返回 False = 已存在跳过,True = 本次下载。"""
    if dest.exists() and (expected_size == 0 or dest.stat().st_size == expected_size):
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    backoff = 3
    last_error: Exception | None = None
    for _attempt in range(DOWNLOAD_RETRIES):
        try:
            have = part.stat().st_size if part.exists() else 0
            headers = {"User-Agent": "MYStudio/weights-installer"}
            if have > 0:
                headers["Range"] = f"bytes={have}-"
            request = urllib.request.Request(_file_url(repo_path), headers=headers)
            with urllib.request.urlopen(request, timeout=DOWNLOAD_READ_TIMEOUT_S) as response:
                if have > 0 and response.status == 206:
                    mode, done = "ab", have
                else:
                    # 服务器忽略 Range(整包 200)或全新下载:从零开始
                    mode, done = "wb", 0
                with open(part, mode) as handle:
                    while True:
                        chunk = response.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                        done += len(chunk)
            if done != expected_size and expected_size > 0:
                raise RuntimeError(f"大小不符:期望 {expected_size},实得 {done}")
            if expected_size == 0 and done == 0:
                # 某些根文件(空占位)也落盘,保持清单完整
                part.touch()
            os.replace(part, dest)
            return True
        except (urllib.error.URLError, OSError, RuntimeError) as exc:
            last_error = exc
            time.sleep(backoff)
            backoff = min(60, backoff * 2)
    raise RuntimeError(f"下载失败(重试 {DOWNLOAD_RETRIES} 次): {repo_path}: {last_error}")


def _tree_bytes(root: Path) -> int:
    total = 0
    for current, _dirs, names in os.walk(root):
        for name in names:
            try:
                total += os.stat(os.path.join(current, name)).st_size
            except OSError:
                pass
    return total


def validate_output(out: Path) -> str | None:
    for name in REQUIRED_OUTPUT_WEIGHTS:
        if not (out / name).is_file():
            return f"转换产物缺少 {name}"
    for name in REQUIRED_OUTPUT_DIRS:
        if not (out / name).is_dir():
            return f"转换产物缺少目录 {name}/"
    return None


def install(src: Path, out: Path, progress_path: Path) -> int:
    def report(status: str, **extra) -> None:
        payload = {"status": status, "stage": extra.pop("stage", status),
                   "current": extra.pop("current", 0), "total": extra.pop("total", 0),
                   "progress": extra.pop("progress", 0),
                   "updatedAt": int(time.time() * 1000)}
        payload.update(extra)
        _write_progress(progress_path, payload)

    # 幂等:产物已完整则直接收尾(重启后重复点按钮)。
    if out.is_dir() and validate_output(out) is None:
        report("complete", stage="done", progress=100, outputDir=str(out))
        print(json.dumps({"status": "complete", "outputDir": str(out)}))
        return 0

    # mlx 前置检查:转换是本流程必需,26 GB 下载之前 fail-fast。
    if importlib.util.find_spec("mlx.core") is None:
        message = "转换步骤需要 mlx(随共享 Python 运行环境提供);请先在 设置 → 本地配置 完成运行时安装"
        report("error", stage="preflight", error=message)
        print(json.dumps({"status": "blocked", "code": "mlx-missing", "message": message}))
        return 2

    report("downloading", stage="list")
    files = enumerate_files()
    if not files:
        message = "ModelScope 清单为空(网络或仓库异常)"
        report("error", stage="list", error=message)
        print(json.dumps({"status": "blocked", "code": "empty-manifest", "message": message}))
        return 2
    total_bytes = sum(f["size"] for f in files)

    # 磁盘预算:源(≈total)+ bf16 产物(≈total)+ 余量。
    free_bytes = os.statvfs(src).f_bavail * os.statvfs(src).f_frsize
    needed_bytes = total_bytes * 2 + 2 * 1024**3
    if free_bytes < needed_bytes:
        message = (f"磁盘空间不足:需约 {needed_bytes / 1e9:.0f} GB(下载+转换双份),"
                   f"当前可用 {free_bytes / 1e9:.0f} GB")
        report("error", stage="preflight", error=message)
        print(json.dumps({"status": "blocked", "code": "disk-full", "message": message}))
        return 2

    # 进度监视线程:按落盘实际字节统计(与 pocket 下载器同款套路)。
    stop_monitor = threading.Event()

    def _monitor() -> None:
        while not stop_monitor.is_set():
            try:
                done = _tree_bytes(src)
                pct = min(99, int(done / total_bytes * 100)) if total_bytes else 0
                report("downloading", stage="download", current=done,
                       total=total_bytes, progress=pct)
            except Exception:
                pass
            stop_monitor.wait(PROGRESS_THROTTLE_S)

    monitor = threading.Thread(target=_monitor, daemon=True)
    monitor.start()
    try:
        for spec in files:
            download_file(spec["path"], spec["size"], src / spec["path"])
    except Exception as exc:
        stop_monitor.set()
        report("error", stage="download", error=str(exc))
        return 2
    finally:
        stop_monitor.set()

    # 转换:vendored 官方脚本,bf16(--bits 16)。心跳线程保活进度(转换期间无字节可数)。
    report("converting", stage="convert", total=total_bytes, current=total_bytes, progress=99)
    stop_heartbeat = threading.Event()

    def _heartbeat() -> None:
        while not stop_heartbeat.is_set():
            report("converting", stage="convert", total=total_bytes,
                   current=total_bytes, progress=99)
            stop_heartbeat.wait(HEARTBEAT_INTERVAL_S)

    heartbeat = threading.Thread(target=_heartbeat, daemon=True)
    heartbeat.start()
    convert_script = Path(__file__).resolve().parent / "vendor" / "convert_music3_weights.py"
    completed = subprocess.run(
        [sys.executable, str(convert_script), str(src), str(out), "--bits", "16"],  # 脚本默认 8,必须显式 16
        capture_output=True, text=True, timeout=CONVERT_TIMEOUT_S,
    )
    stop_heartbeat.set()
    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip().splitlines()[-5:]
        message = "转换失败: " + " | ".join(tail) if tail else f"退出码 {completed.returncode}"
        report("error", stage="convert", error=message)
        return 2

    missing = validate_output(out)
    if missing:
        report("error", stage="validate", error=missing)
        return 2

    # 源目录是本流程自管暂存,转换成功后清理(失败保留以续传)。
    report("converting", stage="cleanup")
    shutil.rmtree(src, ignore_errors=True)

    report("complete", stage="done", progress=100, total=total_bytes,
           current=total_bytes, outputDir=str(out))
    print(json.dumps({"status": "complete", "outputDir": str(out)}))
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio mlx-serve bf16 weights installer")
    parser.add_argument("--src", required=True, help="staging dir for the ModelScope snapshot")
    parser.add_argument("--out", required=True, help="destination MLX bf16 pack dir")
    parser.add_argument("--progress", required=True, help="absolute path of the progress json")
    args = parser.parse_args()

    progress_path = Path(args.progress)
    if not progress_path.is_absolute():
        print(json.dumps({"error": "--progress 必须是绝对路径"}))
        sys.exit(2)
    src, out = Path(args.src), Path(args.out)
    src.mkdir(parents=True, exist_ok=True)
    sys.exit(install(src, out, progress_path))


if __name__ == "__main__":
    main()
