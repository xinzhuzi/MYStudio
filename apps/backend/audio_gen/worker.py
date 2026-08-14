"""MusicGen generation worker — CLI, writes a WAV file.

Usage:
  python -m audio_gen.worker --generate --prompt "轻柔的钢琴曲" \
      --seconds 15 --output /abs/path/bgm.wav [--artifact /abs/path/artifact.json]

Model downloads NEVER happen here — the model must already be in the HF cache
(downloaded explicitly from the settings panel).
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

from .model_cache import AUDIO_MODELS, find_cached_audio_model

DEFAULT_MODEL = "musicgen-small"


class AudioGenError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _require_downloaded(model_name: str) -> None:
    spec = AUDIO_MODELS.get(model_name)
    if not spec:
        raise AudioGenError("unknown-model", f"未知音频模型: {model_name}")
    if not find_cached_audio_model(spec["repo_ids"]):
        raise AudioGenError(
            "model-not-downloaded",
            f"音频模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 本地音乐生成 下载。",
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def generate_music(
    prompt: str,
    output_path: str,
    seconds: float = 15.0,
    model_name: str = DEFAULT_MODEL,
) -> dict[str, Any]:
    _require_downloaded(model_name)
    spec = AUDIO_MODELS[model_name]

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    started = time.time()
    try:
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
    except ImportError as exc:
        raise AudioGenError("transformers-missing", f"transformers/torch 未安装: {exc}") from exc

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    try:
        processor = AutoProcessor.from_pretrained(spec["repo_id"], local_files_only=True)
        model = MusicgenForConditionalGeneration.from_pretrained(spec["repo_id"], local_files_only=True)
        model = model.to(device)
    except Exception as exc:
        raise AudioGenError("model-load-failed", f"模型 {spec['label']} 加载失败: {exc}") from exc

    inputs = processor(text=[prompt], padding=True, return_tensors="pt").to(device)
    max_new_tokens = int(51 * max(1.0, seconds))  # MusicGen: 51 tokens ≈ 1s at 32kHz

    try:
        with torch.no_grad():
            audio_values = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=True)
    except Exception as exc:
        raise AudioGenError("generation-failed", f"BGM 生成失败: {exc}") from exc

    sampling_rate = model.config.audio_encoder.sampling_rate
    waveform = audio_values[0, 0].cpu().numpy()

    # Save as 16-bit PCM WAV without scipy: manual RIFF writer.
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
        "elapsedSeconds": round(time.time() - started, 1),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="MYStudio local music generation worker")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--probe", action="store_true")
    group.add_argument("--generate", action="store_true")
    parser.add_argument("--prompt", type=str)
    parser.add_argument("--seconds", type=float, default=15.0)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--output", type=str)
    parser.add_argument("--artifact", type=str, help="Optional artifact JSON output path")
    args = parser.parse_args()

    if args.probe:
        spec = AUDIO_MODELS.get(args.model)
        cached = find_cached_audio_model(spec["repo_ids"]) if spec else None
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
            result = generate_music(args.prompt, args.output, args.seconds, args.model)
        except AudioGenError as exc:
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
