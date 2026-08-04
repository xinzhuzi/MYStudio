from __future__ import annotations

import os
import platform
import tempfile
import struct
import wave
from array import array
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .tts import generate_mock_wav


KOKORO_REPO_ID = "hexgrad/Kokoro-82M"
KOKORO_SAMPLE_RATE = 24000
KOKORO_LANG_CODES = {
    "en": "a",
    "es": "e",
    "fr": "f",
    "hi": "h",
    "it": "i",
    "pt": "p",
    "ja": "j",
    "zh": "z",
}
KOKORO_DEFAULT_VOICES = {
    "en": "af_heart",
    "es": "ef_dora",
    "fr": "ff_siwis",
    "hi": "hf_alpha",
    "it": "if_sara",
    "pt": "pf_dora",
    "ja": "jf_alpha",
    "zh": "zf_xiaobei",
}

QWEN_MLX_REPOS = {
    "1.7B": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "0.6B": "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-bf16",
}
QWEN_PYTORCH_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-Base",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-Base",
}
QWEN_CUSTOM_VOICE_REPOS = {
    "1.7B": "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice",
    "0.6B": "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice",
}
QWEN_CUSTOM_DEFAULT_SPEAKER = "Ryan"
LANGUAGE_CODE_TO_NAME = {
    "zh": "chinese",
    "en": "english",
    "ja": "japanese",
    "ko": "korean",
    "de": "german",
    "fr": "french",
    "ru": "russian",
    "pt": "portuguese",
    "es": "spanish",
    "it": "italian",
}


@dataclass(frozen=True)
class SynthesisResult:
    duration: float
    backend: str
    mocked: bool
    warning: str | None = None
    emotion_capability: str = "not-requested"
    emotion_warning: str | None = None


_kokoro_model: Any | None = None
_kokoro_pipelines: dict[str, Any] = {}
_qwen_model: Any | None = None
_qwen_backend: str | None = None
_qwen_model_size: str | None = None
_qwen_custom_voice_model: Any | None = None
_qwen_custom_voice_model_size: str | None = None
_qwen_custom_voice_backend: str | None = None
_RETRYABLE_REAL_ENGINES = {"qwen", "qwen_custom_voice", "kokoro"}


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


def synthesize_to_wav(
    *,
    output: Path,
    text: str,
    profile: dict[str, Any],
    engine: str,
    model_size: str | None,
    language: str,
    seed: int | None = None,
    emotion: str | None = None,
    voice_style: str | None = None,
    max_chunk_chars: int = 800,
    crossfade_ms: int = 50,
) -> SynthesisResult:
    chunks = split_text_into_chunks(text, max_chunk_chars)
    if len(chunks) > 1:
        result = _synthesize_chunks(
            output=output,
            chunks=chunks,
            profile=profile,
            engine=engine,
            model_size=model_size,
            language=language,
            seed=seed,
            emotion=emotion,
            voice_style=voice_style,
            crossfade_ms=crossfade_ms,
        )
    else:
        result = _synthesize_single(
            output=output,
            text=text,
            profile=profile,
            engine=engine,
            model_size=model_size,
            language=language,
            seed=seed,
            emotion=emotion,
            voice_style=voice_style,
        )
    return _with_emotion_capability(result, engine, emotion, voice_style)


def _synthesize_single(
    *,
    output: Path,
    text: str,
    profile: dict[str, Any],
    engine: str,
    model_size: str | None,
    language: str,
    seed: int | None,
    emotion: str | None,
    voice_style: str | None,
) -> SynthesisResult:
    mode = os.environ.get("MANYING_TTS_ENGINE_MODE", "auto").strip().lower()
    if mode not in {"auto", "mock", "real"}:
        mode = "auto"

    if mode == "mock":
        return _generate_mock(output, text)

    def generate_real_once() -> SynthesisResult:
        if engine == "qwen":
            return _generate_qwen(output, text, profile, model_size, language, seed)
        if engine == "qwen_custom_voice":
            return _generate_qwen_custom_voice(
                output,
                text,
                profile,
                model_size,
                language,
                seed,
                emotion,
                voice_style,
            )
        if engine == "kokoro":
            return _generate_kokoro(output, text, profile, language, seed)
        raise RuntimeError(f"No real TTS adapter for engine: {engine}")

    try:
        return generate_real_once()
    except Exception as exc:
        unload_engine(engine)
        final_exc = exc
        if engine in _RETRYABLE_REAL_ENGINES:
            try:
                return generate_real_once()
            except Exception as retry_exc:
                unload_engine(engine)
                final_exc = retry_exc
        if mode == "real":
            raise final_exc
        result = _generate_mock(output, text)
        return SynthesisResult(
            duration=result.duration,
            backend=result.backend,
            mocked=True,
            warning=f"Real {engine} adapter unavailable, used mock audio: {final_exc}",
        )


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


def _synthesize_chunks(
    *,
    output: Path,
    chunks: list[str],
    profile: dict[str, Any],
    engine: str,
    model_size: str | None,
    language: str,
    seed: int | None,
    emotion: str | None,
    voice_style: str | None,
    crossfade_ms: int,
) -> SynthesisResult:
    output.parent.mkdir(parents=True, exist_ok=True)
    results: list[SynthesisResult] = []
    with tempfile.TemporaryDirectory(prefix="tts-chunks-", dir=str(output.parent)) as tmp_dir:
        part_paths: list[Path] = []
        for index, chunk in enumerate(chunks):
            part_path = Path(tmp_dir) / f"chunk-{index}.wav"
            part_paths.append(part_path)
            results.append(
                _synthesize_single(
                    output=part_path,
                    text=chunk,
                    profile=profile,
                    engine=engine,
                    model_size=model_size,
                    language=language,
                    seed=seed + index if seed is not None else None,
                    emotion=emotion,
                    voice_style=voice_style,
                )
            )
        duration = _join_wavs(part_paths, output, crossfade_ms)

    backends = {result.backend for result in results}
    warnings = [result.warning for result in results if result.warning]
    return SynthesisResult(
        duration=duration,
        backend=results[0].backend if len(backends) == 1 else "mixed",
        mocked=any(result.mocked for result in results),
        warning="; ".join(dict.fromkeys(warnings)) or None,
    )


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


def is_engine_loaded(engine: str) -> bool:
    if engine == "qwen":
        return _qwen_model is not None
    if engine == "qwen_custom_voice":
        return _qwen_custom_voice_model is not None
    if engine == "kokoro":
        return _kokoro_model is not None
    return False


def unload_engine(engine: str) -> bool:
    global _kokoro_model, _qwen_model, _qwen_backend, _qwen_model_size
    global _qwen_custom_voice_model, _qwen_custom_voice_model_size, _qwen_custom_voice_backend
    if engine == "qwen" and _qwen_model is not None:
        _qwen_model = None
        _qwen_backend = None
        _qwen_model_size = None
        return True
    if engine == "qwen_custom_voice" and _qwen_custom_voice_model is not None:
        _qwen_custom_voice_model = None
        _qwen_custom_voice_model_size = None
        _qwen_custom_voice_backend = None
        return True
    if engine == "kokoro" and _kokoro_model is not None:
        _kokoro_model = None
        _kokoro_pipelines.clear()
        return True
    return False


def _generate_mock(output: Path, text: str) -> SynthesisResult:
    duration = generate_mock_wav(output, text)
    return SynthesisResult(duration=duration, backend="mock", mocked=True)


def _generate_kokoro(
    output: Path,
    text: str,
    profile: dict[str, Any],
    language: str,
    seed: int | None,
) -> SynthesisResult:
    global _kokoro_model

    import numpy as np
    import torch
    from kokoro import KModel, KPipeline

    if seed is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if _kokoro_model is None:
        _kokoro_model = KModel(repo_id=KOKORO_REPO_ID).to(device).eval()

    language = language or profile.get("language") or "en"
    kokoro_lang = KOKORO_LANG_CODES.get(language, "a")
    if kokoro_lang not in _kokoro_pipelines:
        _kokoro_pipelines[kokoro_lang] = KPipeline(
            lang_code=kokoro_lang,
            repo_id=KOKORO_REPO_ID,
            model=_kokoro_model,
        )

    voice_id = (
        profile.get("preset_voice_id")
        or profile.get("presetVoiceId")
        or KOKORO_DEFAULT_VOICES.get(language)
        or "af_heart"
    )
    pipeline = _kokoro_pipelines[kokoro_lang]
    chunks = []
    for item in pipeline(text, voice=voice_id, speed=1.0):
        audio = getattr(item, "audio", None)
        if audio is None:
            continue
        if hasattr(audio, "detach"):
            audio = audio.detach().cpu().numpy()
        chunks.append(np.asarray(audio, dtype=np.float32).squeeze())

    if chunks:
        samples = np.concatenate(chunks).astype(np.float32)
    else:
        samples = np.zeros(KOKORO_SAMPLE_RATE, dtype=np.float32)

    _write_float_wav(output, samples, KOKORO_SAMPLE_RATE)
    return SynthesisResult(
        duration=float(len(samples) / KOKORO_SAMPLE_RATE),
        backend="kokoro",
        mocked=False,
    )


def _generate_qwen(
    output: Path,
    text: str,
    profile: dict[str, Any],
    model_size: str | None,
    language: str,
    seed: int | None,
) -> SynthesisResult:
    ref_audio = profile.get("reference_audio_path") or profile.get("referenceAudioPath")
    ref_text = profile.get("reference_text") or profile.get("referenceText") or ""
    # 确保 ref_text 非空以帮助模型锁定语言
    if not ref_text and language in ("zh", "chinese"):
        ref_text = "这是一段参考音频。"
    if not ref_audio:
        raise RuntimeError("Qwen voice cloning requires reference_audio_path")
    if not Path(str(ref_audio)).exists():
        raise RuntimeError(f"Qwen reference audio does not exist: {ref_audio}")

    backend = _preferred_qwen_backend()
    if backend == "mlx":
        return _generate_qwen_mlx(output, text, str(ref_audio), ref_text, model_size, language, seed)
    return _generate_qwen_pytorch(output, text, str(ref_audio), ref_text, model_size, language, seed)


def _preferred_qwen_backend() -> str:
    requested = os.environ.get("MANYING_TTS_QWEN_BACKEND", "").strip().lower()
    if requested in {"mlx", "pytorch"}:
        return requested
    is_apple_silicon = platform.system() == "Darwin" and platform.machine() in {"arm64", "aarch64"}
    return "mlx" if is_apple_silicon else "pytorch"


def _generate_qwen_mlx(
    output: Path,
    text: str,
    ref_audio: str,
    ref_text: str,
    model_size: str | None,
    language: str,
    seed: int | None,
) -> SynthesisResult:
    global _qwen_model, _qwen_backend, _qwen_model_size

    import numpy as np
    from mlx_audio.tts import load

    size = model_size or "0.6B"
    if size not in QWEN_MLX_REPOS:
        raise RuntimeError(f"Unknown Qwen model size: {size}")
    if _qwen_model is None or _qwen_backend != "mlx" or _qwen_model_size != size:
        _qwen_model = load(QWEN_MLX_REPOS[size])
        _qwen_backend = "mlx"
        _qwen_model_size = size

    if seed is not None:
        import mlx.core as mx

        np.random.seed(seed)
        mx.random.seed(seed)

    lang = LANGUAGE_CODE_TO_NAME.get(language, "auto")
    chunks = []
    sample_rate = 24000
    for item in _qwen_model.generate(text, ref_audio=ref_audio, ref_text=ref_text, lang_code=lang):
        audio = getattr(item, "audio", None)
        if audio is None:
            continue
        chunks.append(np.asarray(audio, dtype=np.float32).squeeze())
        sample_rate = int(getattr(item, "sample_rate", sample_rate))

    if not chunks:
        raise RuntimeError("Qwen MLX generated empty audio")

    samples = np.concatenate(chunks).astype(np.float32)
    _write_float_wav(output, samples, sample_rate)
    return SynthesisResult(duration=float(len(samples) / sample_rate), backend="qwen-mlx", mocked=False)


def _generate_qwen_pytorch(
    output: Path,
    text: str,
    ref_audio: str,
    ref_text: str,
    model_size: str | None,
    language: str,
    seed: int | None,
) -> SynthesisResult:
    global _qwen_model, _qwen_backend, _qwen_model_size

    import numpy as np
    import torch
    from qwen_tts import Qwen3TTSModel

    size = model_size or "0.6B"
    if size not in QWEN_PYTORCH_REPOS:
        raise RuntimeError(f"Unknown Qwen model size: {size}")
    if _qwen_model is None or _qwen_backend != "pytorch" or _qwen_model_size != size:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        kwargs: dict[str, Any] = {"torch_dtype": dtype}
        if device != "cpu":
            kwargs["device_map"] = device
        else:
            kwargs["low_cpu_mem_usage"] = False
        _qwen_model = Qwen3TTSModel.from_pretrained(QWEN_PYTORCH_REPOS[size], **kwargs)
        _qwen_backend = "pytorch"
        _qwen_model_size = size

    if seed is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)

    prompt = _qwen_model.create_voice_clone_prompt(
        ref_audio=ref_audio,
        ref_text=ref_text,
        x_vector_only_mode=False,
    )
    audio_list, sample_rate = _qwen_model.generate_voice_clone(
        text=text,
        voice_clone_prompt=prompt,
        language=LANGUAGE_CODE_TO_NAME.get(language, "auto"),
    )
    if not audio_list:
        raise RuntimeError("Qwen PyTorch generated empty audio")

    samples = np.asarray(audio_list[0], dtype=np.float32).squeeze()
    _write_float_wav(output, samples, int(sample_rate))
    return SynthesisResult(duration=float(len(samples) / sample_rate), backend="qwen-pytorch", mocked=False)


def _generate_qwen_custom_voice(
    output: Path,
    text: str,
    profile: dict[str, Any],
    model_size: str | None,
    language: str,
    seed: int | None,
    emotion: str | None,
    voice_style: str | None,
) -> SynthesisResult:
    if _preferred_qwen_backend() == "mlx":
        return _generate_qwen_custom_voice_mlx(
            output,
            text,
            profile,
            model_size,
            language,
            seed,
            emotion,
            voice_style,
        )
    return _generate_qwen_custom_voice_pytorch(
        output,
        text,
        profile,
        model_size,
        language,
        seed,
        emotion,
        voice_style,
    )


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


def _resolve_qwen_custom_voice_mlx_snapshot(model_size: str) -> Path:
    from .catalog import get_model
    from .model_cache import find_cached_model

    model = get_model(f"qwen-custom-voice-{model_size}")
    if model is None:
        raise RuntimeError(f"Unknown Qwen CustomVoice model size: {model_size}")
    cached = find_cached_model(model)
    if cached is None:
        raise RuntimeError(
            f"Qwen CustomVoice MLX model is not cached locally: {model.hf_repo_id}"
        )

    snapshots_dir = cached.repo_cache_dir / "snapshots"
    snapshots = [path for path in snapshots_dir.iterdir() if path.is_dir()] if snapshots_dir.is_dir() else []
    if not snapshots:
        raise RuntimeError(f"Qwen CustomVoice MLX cache has no snapshot: {cached.repo_cache_dir}")

    main_ref = cached.repo_cache_dir / "refs" / "main"
    revision = main_ref.read_text(encoding="utf-8").strip() if main_ref.is_file() else ""
    if revision:
        snapshot = snapshots_dir / revision
        if snapshot.is_dir():
            return snapshot
    if len(snapshots) == 1:
        return snapshots[0]
    raise RuntimeError(f"Qwen CustomVoice MLX cache has no unambiguous snapshot: {cached.repo_cache_dir}")


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


def _generate_qwen_custom_voice_mlx(
    output: Path,
    text: str,
    profile: dict[str, Any],
    model_size: str | None,
    language: str,
    seed: int | None,
    emotion: str | None,
    voice_style: str | None,
) -> SynthesisResult:
    global _qwen_custom_voice_model, _qwen_custom_voice_model_size, _qwen_custom_voice_backend

    import numpy as np
    from mlx_audio.tts import load

    size = model_size or "0.6B"
    if size not in QWEN_CUSTOM_VOICE_REPOS:
        raise RuntimeError(f"Unknown Qwen CustomVoice model size: {size}")
    if (
        _qwen_custom_voice_model is None
        or _qwen_custom_voice_backend != "mlx"
        or _qwen_custom_voice_model_size != size
    ):
        snapshot = _resolve_qwen_custom_voice_mlx_snapshot(size)
        _qwen_custom_voice_model = load(snapshot, lazy=True, strict=False)
        _qwen_custom_voice_backend = "mlx"
        _qwen_custom_voice_model_size = size

    if seed is not None:
        import mlx.core as mx

        np.random.seed(seed)
        mx.random.seed(seed)

    request = _custom_voice_request(text, profile, language, emotion, voice_style)
    return _adapt_mlx_generation_results(
        output,
        _qwen_custom_voice_model.generate_custom_voice(**request),
    )


def _generate_qwen_custom_voice_pytorch(
    output: Path,
    text: str,
    profile: dict[str, Any],
    model_size: str | None,
    language: str,
    seed: int | None,
    emotion: str | None,
    voice_style: str | None,
) -> SynthesisResult:
    global _qwen_custom_voice_model, _qwen_custom_voice_model_size, _qwen_custom_voice_backend

    import numpy as np
    import torch
    from qwen_tts import Qwen3TTSModel

    size = model_size or "0.6B"
    if size not in QWEN_CUSTOM_VOICE_REPOS:
        raise RuntimeError(f"Unknown Qwen CustomVoice model size: {size}")

    if _qwen_custom_voice_model is None or _qwen_custom_voice_backend != "pytorch" or _qwen_custom_voice_model_size != size:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        kwargs: dict[str, Any] = {"torch_dtype": dtype}
        if device != "cpu":
            kwargs["device_map"] = device
        else:
            kwargs["low_cpu_mem_usage"] = False
        _qwen_custom_voice_model = Qwen3TTSModel.from_pretrained(QWEN_CUSTOM_VOICE_REPOS[size], **kwargs)
        _qwen_custom_voice_backend = "pytorch"
        _qwen_custom_voice_model_size = size

    if seed is not None:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed(seed)

    kwargs = _custom_voice_request(text, profile, language, emotion, voice_style)

    wavs, sample_rate = _qwen_custom_voice_model.generate_custom_voice(**kwargs)
    if not wavs:
        raise RuntimeError("Qwen CustomVoice generated empty audio")

    samples = np.asarray(wavs[0], dtype=np.float32).squeeze()
    _write_float_wav(output, samples, int(sample_rate))
    return SynthesisResult(
        duration=float(len(samples) / sample_rate),
        backend="qwen-custom-voice",
        mocked=False,
    )


def _write_float_wav(output: Path, samples: Any, sample_rate: int) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(output), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        for sample in samples:
            value = max(-1.0, min(1.0, float(sample)))
            wav.writeframes(struct.pack("<h", int(value * 32767)))
