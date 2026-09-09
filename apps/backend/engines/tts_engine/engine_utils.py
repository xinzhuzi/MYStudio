"""Pure utility functions and data types for the TTS engine.

Extracted from ``engine.py`` to reduce file size.  Contains only stateless
helpers: text chunking, WAV I/O, emotion-capability resolution, custom-voice
request construction, and the ``SynthesisResult`` dataclass.

Mutable global model-cache variables and the ``_generate_*`` adapters remain
in ``engine.py``.
"""

from __future__ import annotations

import struct
import wave
from array import array
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .engine_config import LANGUAGE_CODE_TO_NAME, QWEN_CUSTOM_DEFAULT_SPEAKER


@dataclass(frozen=True)
class SynthesisResult:
    duration: float
    backend: str
    mocked: bool
    warning: str | None = None
    emotion_capability: str = "not-requested"
    emotion_warning: str | None = None


def resolve_emotion_capability(
    engine: str,
    *,
    emotion: str | None = None,
    voice_style: str | None = None,
) -> tuple[str, str | None]:
    requested = bool((emotion or "").strip() or (voice_style or "").strip())
    if not requested:
        return "not-requested", None
    if engine == "qwen_custom_voice" and ((emotion or "").strip() or (voice_style or "").strip()):
        return "applied", None
    if engine in {"qwen_custom_voice", "qwen", "kokoro"}:
        return "metadata-only", f"{engine} 未应用逐镜动态情绪，emotion/voiceStyle 仅作为审计元数据"
    return "unsupported", f"{engine} 不支持逐镜动态情绪，emotion/voiceStyle 仅作为审计元数据"


def _with_emotion_capability(
    result: SynthesisResult,
    engine: str,
    emotion: str | None,
    voice_style: str | None,
) -> SynthesisResult:
    capability, warning = resolve_emotion_capability(
        engine,
        emotion=emotion,
        voice_style=voice_style,
    )
    if result.mocked and capability == "applied":
        return replace(
            result,
            emotion_capability="metadata-only",
            emotion_warning="mock 音频未应用逐镜动态情绪，emotion/voiceStyle 仅作为审计元数据",
        )
    return replace(result, emotion_capability=capability, emotion_warning=warning)


def split_text_into_chunks(text: str, max_chars: int = 800) -> list[str]:
    remaining = text.strip()
    if not remaining:
        raise ValueError("text cannot be empty")
    if max_chars <= 0:
        raise ValueError("max_chars must be positive")

    chunks: list[str] = []
    sentence_boundaries = "。！？.!?"
    clause_boundaries = "；;，,:"
    while len(remaining) > max_chars:
        window = remaining[:max_chars]
        split_at = max((window.rfind(mark) for mark in sentence_boundaries), default=-1)
        if split_at < 0:
            split_at = max((window.rfind(mark) for mark in clause_boundaries), default=-1)
        if split_at < 0:
            split_at = window.rfind(" ")
        if split_at < 0:
            split_at = max_chars - 1
        chunk = remaining[: split_at + 1].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[split_at + 1 :].lstrip()
    if remaining:
        chunks.append(remaining)
    return chunks


def _join_wavs(parts: list[Path], output: Path, crossfade_ms: int) -> float:
    sample_rate: int | None = None
    combined = array("h")
    for part in parts:
        with wave.open(str(part), "rb") as wav:
            if wav.getnchannels() != 1 or wav.getsampwidth() != 2:
                raise RuntimeError("TTS chunk output must be mono PCM16 WAV")
            if sample_rate is None:
                sample_rate = wav.getframerate()
            elif sample_rate != wav.getframerate():
                raise RuntimeError("TTS chunk outputs use different sample rates")
            samples = array("h")
            samples.frombytes(wav.readframes(wav.getnframes()))

        overlap = min(
            int((sample_rate or 0) * max(0, crossfade_ms) / 1000),
            len(combined),
            len(samples),
        )
        for index in range(overlap):
            fade_in = index / max(1, overlap)
            fade_out = 1.0 - fade_in
            combined[len(combined) - overlap + index] = int(
                combined[len(combined) - overlap + index] * fade_out + samples[index] * fade_in
            )
        combined.extend(samples[overlap:])

    if sample_rate is None:
        raise RuntimeError("No audio chunks were generated")
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(combined.tobytes())
    return float(len(combined) / sample_rate)


def _write_float_wav(output: Path, samples: Any, sample_rate: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        for sample in samples:
            value = max(-1.0, min(1.0, float(sample)))
            wav.writeframes(struct.pack("<h", int(value * 32767)))


# MLX 与 PyTorch 共用此拼接逻辑，确保逐镜情绪和风格进入同一模型请求。
def _custom_voice_instruct(
    profile: dict[str, Any],
    emotion: str | None,
    voice_style: str | None,
) -> str | None:
    profile_instruct = profile.get("instruct") or profile.get("style_instruction") or profile.get("styleInstruction")
    dynamic_emotion = (emotion or "").strip()
    dynamic_style = (voice_style or "").strip()
    instruct_parts: list[str] = []
    if profile_instruct:
        instruct_parts.append(str(profile_instruct))
    if dynamic_emotion:
        instruct_parts.append(f"逐镜情绪：{dynamic_emotion}")
    if dynamic_style:
        instruct_parts.append(f"逐镜风格：{dynamic_style}")
    return "\n".join(instruct_parts) or None


def _custom_voice_request(
    text: str,
    profile: dict[str, Any],
    language: str,
    emotion: str | None,
    voice_style: str | None,
) -> dict[str, str]:
    language_name = LANGUAGE_CODE_TO_NAME.get(language, "auto")
    request = {
        "text": text,
        "language": language_name.capitalize() if language_name != "auto" else "Auto",
        "speaker": profile.get("preset_voice_id") or profile.get("presetVoiceId") or QWEN_CUSTOM_DEFAULT_SPEAKER,
    }
    instruct = _custom_voice_instruct(profile, emotion, voice_style)
    if instruct:
        request["instruct"] = instruct
    return request


def _adapt_mlx_generation_results(
    output: Path,
    generation_results: Any,
    default_sample_rate: int = 24000,
) -> SynthesisResult:
    import numpy as np

    chunks: list[Any] = []
    sample_rate: int | None = None
    for result in generation_results:
        audio = getattr(result, "audio", None)
        if audio is None:
            continue
        current_sample_rate = int(getattr(result, "sample_rate", default_sample_rate))
        if current_sample_rate <= 0:
            raise RuntimeError("MLX TTS returned an invalid sample rate")
        if sample_rate is None:
            sample_rate = current_sample_rate
        elif sample_rate != current_sample_rate:
            raise RuntimeError("MLX TTS results use different sample rates")
        chunks.append(np.asarray(audio, dtype=np.float32).reshape(-1))

    if not chunks or sample_rate is None:
        raise RuntimeError("Qwen CustomVoice MLX generated empty audio")

    samples = np.concatenate(chunks).astype(np.float32)
    _write_float_wav(output, samples, sample_rate)
    return SynthesisResult(
        duration=float(len(samples) / sample_rate),
        backend="qwen-custom-voice",
        mocked=False,
    )
