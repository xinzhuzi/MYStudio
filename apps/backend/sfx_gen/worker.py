"""SFX generation worker — CLI, writes a deterministic WAV file.

Usage:
  python -m sfx_gen.worker --generate --prompt "短促的呼啸声" \
      --seed 42 --seconds 2 --output /abs/path/sfx.wav [--artifact /abs/path/artifact.json]

Determinism contract: same (prompt, seed, model, device) -> byte-identical WAV,
so renderer hashInput caching stays valid. Model downloads NEVER happen here —
the model must already be in the HF cache (explicit download from settings).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from .model_cache import (
    MAX_SFX_DURATION_S,
    MIN_SFX_DURATION_S,
    SFX_MODELS,
    find_cached_sfx_model,
)

DEFAULT_MODEL = "sfx-musicgen-small"


class SfxGenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _require_downloaded(model_name: str) -> None:
    spec = SFX_MODELS.get(model_name)
    if not spec:
        raise SfxGenError("unknown-model", f"未知音效模型: {model_name}")
    if not spec["enabled"]:
        raise SfxGenError("model-disabled", f"模型 {spec['label']} 为选型候选尚未启用")
    if not find_cached_sfx_model(spec["repo_ids"]):
        raise SfxGenError(
            "model-not-downloaded",
            f"音效模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 本地音效生成 下载。",
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clamp_duration(seconds: float) -> float:
    return max(MIN_SFX_DURATION_S, min(MAX_SFX_DURATION_S, seconds))


def generate_sfx(
    prompt: str,
    output_path: str,
    seconds: float = 2.0,
    seed: int = 0,
    model_name: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    _require_downloaded(model_name)
    spec = SFX_MODELS[model_name]
    seconds = _clamp_duration(seconds)

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    started = time.time()
    # probe/inventory 认 MYSTUDIO_AUDIO_MODEL_DIR,但 transformers/huggingface_hub 只认
    # HF_HUB_CACHE/HF_HOME(且在 import 时固化)。懒加载 transformers 前把应用缓存目录
    # 翻译过去——否则模型在 model/TTS 时 probe ready、生成却 offline 找不到
    # (2026-08-28 实证:model-load-failed "couldn't find them in the cached files")。
    from .model_cache import primary_hf_cache_dir

    primary_cache = primary_hf_cache_dir()
    if str(primary_cache) != os.environ.get("HF_HUB_CACHE", ""):
        os.environ["HF_HUB_CACHE"] = str(primary_cache)
    try:
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
    except ImportError as exc:
        raise SfxGenError("transformers-missing", f"transformers/torch 未安装: {exc}") from exc

    if spec["engine"] != "transformers-musicgen":
        raise SfxGenError("engine-unsupported", f"引擎 {spec['engine']} 尚未接线(选型候选)")

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    try:
        processor = AutoProcessor.from_pretrained(spec["repo_id"], local_files_only=True)
        model = MusicgenForConditionalGeneration.from_pretrained(spec["repo_id"], local_files_only=True)
        model = model.to(device)
    except Exception as exc:
        raise SfxGenError("model-load-failed", f"模型 {spec['label']} 加载失败: {exc}") from exc

    # 音效域提示词约束:引导模型产出短促、干净的单次事件声而非乐曲。
    sfx_prompt = f"a single short sound effect: {prompt.strip()} (no music, no melody, dry one-shot)"
    inputs = processor(text=[sfx_prompt], padding=True, return_tensors="pt").to(device)
    max_new_tokens = max(64, int(51 * seconds))  # MusicGen: 51 tokens ≈ 1s at 32kHz

    # 种子确定性:同 prompt+seed+model+device → 同 WAV。
    torch.manual_seed(seed)

    try:
        with torch.no_grad():
            audio_values = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=True)
    except Exception as exc:
        raise SfxGenError("generation-failed", f"音效生成失败: {exc}") from exc

    sampling_rate = model.config.audio_encoder.sampling_rate
    waveform = audio_values[0, 0].cpu().numpy()

    # 短音效常用尾部留白裁剪:去掉 -60dB 以下的尾部静音,保住事件本体。
    import numpy as np

    peak = float(np.max(np.abs(waveform))) or 1.0
    threshold = peak * (10 ** (-60 / 20))
    nonzero = np.where(np.abs(waveform) > threshold)[0]
    if len(nonzero):
        tail = min(len(waveform), int(nonzero[-1]) + int(0.05 * sampling_rate))
        waveform = waveform[:tail]

    import struct

    scaled = (waveform * 32767).clip(-32768, 32767).astype("<i2")
    data = scaled.tobytes()
    with output_file.open("wb") as f:
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + len(data)))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<IHHIIHH", 16, 1, 1, sampling_rate, sampling_rate * 2, 2, 16))
        f.write(b"data")
        f.write(struct.pack("<I", len(data)))
        f.write(data)

    return {
        "status": "accepted",
        "outputPath": str(output_file.resolve()),
        "outputSha256": _sha256(output_file),
        "samplingRate": int(sampling_rate),
        "durationS": round(len(scaled) / sampling_rate, 3),
        "seed": int(seed),
        "model": model_name,
        "elapsedSeconds": round(time.time() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio local sfx generation worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--generate", action="store_true")
    parser.add_argument("--prompt", type=str)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--seconds", type=float, default=2.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=str)
    parser.add_argument("--artifact", type=str, help="Optional artifact JSON output path")
    args = parser.parse_args()

    if args.probe:
        spec = SFX_MODELS.get(args.model)
        cached = find_cached_sfx_model(spec["repo_ids"]) if spec else None
        print(json.dumps({
            "status": "ready" if cached else "blocked",
            "model": args.model,
            "sizeMb": cached["size_mb"] if cached else None,
        }, ensure_ascii=False))
        return

    if args.generate:
        if not args.prompt or not args.output:
            print(json.dumps({"status": "blocked", "code": "missing-args", "message": "--generate 需要 --prompt 和 --output"}))
            sys.exit(2)
        try:
            result = generate_sfx(args.prompt, args.output, args.seconds, args.seed, args.model)
        except SfxGenError as exc:
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
