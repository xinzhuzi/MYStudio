"""AudioGen 推理引擎(09-09 引擎层统一,自 audio_gen/worker 原样拆出)。

照 Piper 纯引擎包先例:零 HTTP/零 CLI;audio_gen/ 服务包(worker=spawn 面/
download_model/model_inventory)向下调用。模型必须已在 HF 缓存,绝不自动下载。
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

from .model_cache import (
    AUDIO_MODELS,
    find_cached_audio_model,

)

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
