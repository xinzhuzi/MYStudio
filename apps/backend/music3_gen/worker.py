"""Music3 generation worker — CLI wrapper around the self-contained MLX repo.

Usage:
  python -m music3_gen.worker --generate --prompt "紧张激烈的武侠配乐,鼓点密集" \
      --seconds 120 --seed 42 --output /abs/path/bgm.wav [--artifact /abs/path/artifact.json]
  python -m music3_gen.worker --probe

Delegates actual synthesis to the repo's own generate.py (prompt/lyrics/
seconds/steps/seed/model-dir/output), always in [Instrumental] mode — this
engine exists to produce chapter BGM, not songs with vocals. Model downloads
NEVER happen here (explicit download from settings only).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .model_cache import (
    MAX_MUSIC3_DURATION_S,
    MIN_MUSIC3_DURATION_S,
    MUSIC3_MODELS,
    detect_hardware_profile,
    evaluate_availability,
    find_cached_music3_model,
)

DEFAULT_MODEL = "minimax-music3-mlx"
GENERATE_TIMEOUT_S = 30 * 60


class Music3GenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _require_downloaded(model_name: str) -> Path:
    spec = MUSIC3_MODELS.get(model_name)
    if not spec:
        raise Music3GenError("unknown-model", f"未知音乐模型: {model_name}")
    cached = find_cached_music3_model(spec["repo_ids"])
    if not cached:
        raise Music3GenError(
            "model-not-downloaded",
            f"音乐模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 本地音乐生成 下载。",
        )
    if cached["layout"] != "pocket":
        raise Music3GenError(
            "mlxserv-only",
            "当前音乐权重是 mlx-serve 扁平布局，请在运行时配置中选择 mlx-serve 引擎。",
        )
    return Path(cached["repo_cache_dir"])


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clamp_duration(seconds: float) -> float:
    return max(MIN_MUSIC3_DURATION_S, min(MAX_MUSIC3_DURATION_S, seconds))


def generate_music3(
    prompt: str,
    output_path: str,
    seconds: float = 60.0,
    seed: int = 7,
    steps: int = 30,
    model_name: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    snapshot_dir = _require_downloaded(model_name)
    spec = MUSIC3_MODELS[model_name]
    seconds = _clamp_duration(seconds)

    # 平台×硬件门禁:不同平台按硬件选择不同模型(08-19 用户裁定)。
    availability = evaluate_availability(spec)
    if not availability["available"]:
        raise Music3GenError("platform-unsupported", availability["reason"])

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    started = time.time()
    try:
        import mlx.core  # noqa: F401 — 探依赖:mlx 由托管 Python 运行时提供
        import numpy  # noqa: F401
    except ImportError as exc:
        raise Music3GenError("mlx-missing", f"mlx/numpy 未安装(随 Python 运行环境提供): {exc}") from exc

    command = [
        sys.executable,
        str(snapshot_dir / "generate.py"),
        "--prompt", prompt,
        "--lyrics", "[Instrumental]",
        "--seconds", str(seconds),
        "--steps", str(steps),
        "--seed", str(seed),
        "--model-dir", str(snapshot_dir),
        "--output", str(output_file),
    ]
    try:
        completed = subprocess.run(
            command,
            cwd=str(snapshot_dir),
            capture_output=True,
            text=True,
            timeout=GENERATE_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise Music3GenError("generation-timeout", f"整曲生成超过 {GENERATE_TIMEOUT_S // 60} 分钟超时") from exc

    if completed.returncode != 0 or not output_file.exists():
        tail = (completed.stderr or completed.stdout or "").strip().splitlines()[-3:]
        raise Music3GenError(
            "generation-failed",
            f"Music3 生成失败({spec['label']}): {' | '.join(tail) if tail else f'exit {completed.returncode}'}",
        )

    # generate.py 末行打印 resolve 后的输出路径;以实际落盘文件为准。
    try:
        import wave

        with wave.open(str(output_file), "rb") as wav:
            sampling_rate = wav.getframerate()
            duration_s = round(wav.getnframes() / sampling_rate, 3)
            channels = wav.getnchannels()
    except Exception:
        sampling_rate, duration_s, channels = 44100, seconds, 2

    return {
        "status": "accepted",
        "outputPath": str(output_file.resolve()),
        "outputSha256": _sha256(output_file),
        "samplingRate": int(sampling_rate),
        "durationS": duration_s,
        "channels": int(channels),
        "seed": int(seed),
        "model": model_name,
        "elapsedSeconds": round(time.time() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio MiniMax-Music3 local music worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--generate", action="store_true")
    parser.add_argument("--prompt", type=str)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--seconds", type=float, default=60.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=str)
    parser.add_argument("--artifact", type=str, help="Optional artifact JSON output path")
    args = parser.parse_args()

    if args.probe:
        spec = MUSIC3_MODELS.get(args.model)
        cached = find_cached_music3_model(spec["repo_ids"]) if spec else None
        layout = cached["layout"] if cached else None
        model_dir = cached["repo_cache_dir"] if cached else None
        engine = "mlx-serve" if layout == "mlxserv" else "pocket" if layout == "pocket" else None
        worker_runnable = layout == "pocket"
        deps_ok = True
        try:
            import mlx.core  # noqa: F401
            import numpy  # noqa: F401
        except ImportError:
            deps_ok = False
        hardware = detect_hardware_profile()
        availability = evaluate_availability(spec, hardware) if spec else {
            "available": False, "reason": f"未知模型: {args.model}",
        }
        status = "ready" if (cached and worker_runnable and deps_ok and availability["available"]) else "blocked"
        reason = None
        if cached and layout == "mlxserv":
            reason = "当前缓存为 mlx-serve 扁平布局，请由 Electron mlx-serve HTTP 路线运行；Python worker 仅支持 Pocket snapshot。"
        elif cached and not worker_runnable:
            reason = "当前缓存布局不是 Python worker 可运行的 Pocket snapshot。"
        print(json.dumps({
            "status": status,
            "model": args.model,
            "depsOk": deps_ok,
            "sizeMb": cached["size_mb"] if cached else None,
            "cacheDir": cached["cache_dir"] if cached else None,
            "repoCacheDir": cached["repo_cache_dir"] if cached else None,
            "modelDir": model_dir,
            "layout": layout,
            "engine": engine,
            "workerRunnable": worker_runnable,
            "reason": reason,
            "hardware": hardware,
            "availability": availability,
        }, ensure_ascii=False))
        return

    if args.generate:
        if not args.prompt or not args.output:
            print(json.dumps({"status": "blocked", "code": "missing-args", "message": "--generate 需要 --prompt 和 --output"}))
            sys.exit(2)
        try:
            result = generate_music3(args.prompt, args.output, args.seconds, args.seed, args.steps, args.model)
        except Music3GenError as exc:
            payload = {"status": "blocked", "code": exc.code, "message": exc.message}
            if args.artifact:
                Path(args.artifact).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
            print(json.dumps(payload, ensure_ascii=False))
            sys.exit(2)
        if args.artifact:
            Path(args.artifact).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return


if __name__ == "__main__":
    main()
