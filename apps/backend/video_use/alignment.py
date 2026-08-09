from __future__ import annotations

import hashlib
import math
import os
import re
import unicodedata
from pathlib import Path
from typing import Any, Callable, Iterable


ALIGNMENT_MODEL_REPO = "mlx-community/whisper-large-v3-turbo"
ALIGNMENT_TOKENIZER_REPO = "openai/whisper-large-v3-turbo"


class AlignmentError(RuntimeError):
    """A fail-closed error raised by canonical-text alignment."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as error:
        raise AlignmentError("audio-read-failed", f"无法读取音频: {path}") from error
    return digest.hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _compact(value: str) -> str:
    normalized = unicodedata.normalize("NFC", value)
    return "".join(character for character in normalized if not character.isspace())


def _timing_field(value: Any, name: str) -> Any:
    if isinstance(value, dict):
        return value.get(name)
    return getattr(value, name, None)


def _set_timing_field(value: Any, name: str, field_value: Any) -> None:
    if isinstance(value, dict):
        value[name] = field_value
    else:
        setattr(value, name, field_value)


def _merge_zero_length_timings(timings: list[Any]) -> list[Any]:
    """Keep canonical text when mlx-audio emits a zero-width token.

    Whisper occasionally places an unvoiced character at the exact boundary
    of the next token. We do not invent a timestamp: the zero-width token is
    joined to the next positive interval (or the previous one at the end),
    while punctuation-only entries already merged by mlx-audio are dropped.
    """
    normalized: list[Any] = []
    for index, timing in enumerate(timings):
        word = str(_timing_field(timing, "word") or "")
        if not _compact(word):
            continue
        start = _finite_number(_timing_field(timing, "start"), f"timings[{index + 1}].start")
        end = _finite_number(_timing_field(timing, "end"), f"timings[{index + 1}].end")
        if end > start:
            normalized.append(timing)
            continue
        next_timing = next((
            candidate for candidate in timings[index + 1:]
            if _compact(str(_timing_field(candidate, "word") or ""))
            and _finite_number(_timing_field(candidate, "end"), "timing.end")
            > _finite_number(_timing_field(candidate, "start"), "timing.start")
        ), None)
        if next_timing is not None:
            next_word = str(_timing_field(next_timing, "word") or "")
            _set_timing_field(next_timing, "word", word + next_word)
            probability = min(
                _finite_number(_timing_field(timing, "probability"), "timing.probability"),
                _finite_number(_timing_field(next_timing, "probability"), "timing.probability"),
            )
            _set_timing_field(next_timing, "probability", probability)
            continue
        if normalized:
            previous = normalized[-1]
            _set_timing_field(previous, "word", str(_timing_field(previous, "word") or "") + word)
            _set_timing_field(
                previous,
                "probability",
                min(
                    _finite_number(_timing_field(previous, "probability"), "timing.probability"),
                    _finite_number(_timing_field(timing, "probability"), "timing.probability"),
                ),
            )
    return normalized


def _sentence_spans(text: str) -> list[str]:
    spans = [match.group(0).strip() for match in re.finditer(r"[^。！？!?；;]+[。！？!?；;]?", text) if match.group(0).strip()]
    return spans or [text.strip()]


def _finite_number(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise AlignmentError("alignment-timing-invalid", f"{field} 必须是数字") from error
    if not math.isfinite(number):
        raise AlignmentError("alignment-timing-invalid", f"{field} 必须是有限数字")
    return number


def build_canonical_alignment(
    text: str,
    timings: Iterable[Any],
    *,
    duration_s: float | None = None,
) -> dict[str, Any]:
    """Convert mlx-audio WordTiming values without allowing text rewrites.

    The tokenizer may emit spaces around English words, so comparison removes
    whitespace only. The persisted word/sentence text still comes from the
    canonical `ttsSpokenText` slices, never from ASR output.
    """

    canonical = text.strip()
    if not canonical:
        raise AlignmentError("canonical-text-empty", "ttsSpokenText 不能为空")
    compact_text = _compact(canonical)
    if not compact_text:
        raise AlignmentError("canonical-text-empty", "ttsSpokenText 不包含可对齐文本")

    if duration_s is not None:
        duration_s = _finite_number(duration_s, "durationS")
        if duration_s <= 0:
            raise AlignmentError("audio-duration-invalid", "音频时长必须大于 0")

    words: list[dict[str, Any]] = []
    cursor = 0
    previous_end = 0.0
    for index, timing in enumerate(timings, start=1):
        raw_word = _timing_field(timing, "word")
        word = str(raw_word or "")
        compact_word = _compact(word)
        if not compact_word:
            continue
        start = _finite_number(_timing_field(timing, "start"), f"timings[{index}].start")
        end = _finite_number(_timing_field(timing, "end"), f"timings[{index}].end")
        confidence = _finite_number(_timing_field(timing, "probability"), f"timings[{index}].probability")
        if start < 0 or end <= start:
            raise AlignmentError("alignment-timing-invalid", f"timings[{index}] 时间范围无效")
        if start < previous_end:
            raise AlignmentError("alignment-not-monotonic", f"timings[{index}] 与前一个词重叠")
        if duration_s is not None and end > duration_s + 0.05:
            raise AlignmentError("alignment-out-of-range", f"timings[{index}] 超出音频时长")
        if not compact_text.startswith(compact_word, cursor):
            raise AlignmentError(
                "canonical-text-mismatch",
                f"对齐文本与 ttsSpokenText 不一致: offset={cursor}, word={word!r}",
            )
        end = min(end, duration_s) if duration_s is not None else end
        words.append({
            "id": f"word-{len(words) + 1:04d}",
            "text": word,
            "startS": start,
            "endS": end,
            "confidence": max(0.0, min(1.0, confidence)),
        })
        cursor += len(compact_word)
        previous_end = end

    if not words:
        raise AlignmentError("alignment-empty", "模型没有返回可用的词级时间")
    if cursor != len(compact_text):
        raise AlignmentError(
            "canonical-text-mismatch",
            f"对齐文本未覆盖 ttsSpokenText: covered={cursor}, expected={len(compact_text)}",
        )

    sentences: list[dict[str, Any]] = []
    word_spans: list[tuple[int, int]] = []
    word_offset = 0
    for word in words:
        word_end = word_offset + len(_compact(word["text"]))
        word_spans.append((word_offset, word_end))
        word_offset = word_end
    word_cursor = 0
    compact_cursor = 0
    for sentence_index, sentence_text in enumerate(_sentence_spans(canonical), start=1):
        sentence_compact = _compact(sentence_text)
        if not sentence_compact:
            continue
        sentence_end = compact_cursor + len(sentence_compact)
        sentence_words: list[dict[str, Any]] = []
        for word_index in range(word_cursor, len(words)):
            word = words[word_index]
            word_start, word_end = word_spans[word_index]
            if word_end <= compact_cursor:
                word_cursor += 1
                continue
            if word_start >= sentence_end:
                break
            sentence_words.append(word)
            word_cursor += 1
        if not sentence_words:
            punctuation_only = all(
                character in "。！？!?；;：:，,、………．."
                for character in sentence_compact
            )
            if punctuation_only and sentences:
                sentences[-1]["text"] += sentence_text
                compact_cursor = sentence_end
                continue
            raise AlignmentError("alignment-sentence-empty", f"句子 {sentence_index} 没有词级时间")
        sentences.append({
            "id": f"sentence-{sentence_index:04d}",
            "text": sentence_text,
            "startS": sentence_words[0]["startS"],
            "endS": sentence_words[-1]["endS"],
            "confidence": sum(word["confidence"] for word in sentence_words) / len(sentence_words),
        })
        compact_cursor = sentence_end

    return {
        "text": canonical,
        "words": words,
        "sentences": sentences,
        "durationS": duration_s if duration_s is not None else words[-1]["endS"],
    }


def _snapshot_for_repo(repo_id: str) -> Path:
    # `video_use` and `tts` are sibling packages under the same managed
    # backend interpreter.  The cache registry is owned by the TTS runtime;
    # do not create a second model-cache implementation for alignment.  A
    # worker receives the configured cache explicitly from Electron and must
    # not fall back to an unrelated global Hugging Face cache.
    cache_value = os.environ.get("MANYING_TTS_MODELS_DIR") or os.environ.get("VOICEBOX_MODELS_DIR")
    if not cache_value:
        raise AlignmentError("alignment-model-missing", "未配置应用 TTS 模型缓存路径")
    configured_cache = Path(cache_value).expanduser()
    if not configured_cache.is_absolute():
        raise AlignmentError("alignment-cache-path-not-absolute", "应用 TTS 模型缓存路径必须是绝对路径")
    cache_dirs = [configured_cache]
    if configured_cache.name == "huggingface":
        cache_dirs.append(configured_cache / "hub")
    elif configured_cache.name != "hub":
        cache_dirs.append(configured_cache / "hub")
    from tts.model_cache import find_cached_repo, has_cached_repo_files, repo_cache_dir

    if repo_id == ALIGNMENT_TOKENIZER_REPO:
        if not has_cached_repo_files(repo_id, ("tokenizer.json",), cache_dirs=cache_dirs):
            raise AlignmentError("alignment-model-missing", f"本地模型未准备: {repo_id}")
    else:
        cached = find_cached_repo((repo_id,), cache_dirs=cache_dirs)
        if cached is None:
            raise AlignmentError("alignment-model-missing", f"本地模型未准备: {repo_id}")
        cache_root = cached.repo_cache_dir
    if repo_id == ALIGNMENT_TOKENIZER_REPO:
        cache_root = next(
            repo_cache_dir(repo_id, cache_dir)
            for cache_dir in cache_dirs
            if has_cached_repo_files(repo_id, ("tokenizer.json",), cache_dirs=[cache_dir])
        )
    refs_main = cache_root / "refs" / "main"
    revision = refs_main.read_text(encoding="utf-8").strip() if refs_main.is_file() else ""
    snapshot = cache_root / "snapshots" / revision if revision else None
    if snapshot is None or not snapshot.is_dir():
        snapshots = sorted((cache_root / "snapshots").glob("*"))
        snapshot = snapshots[-1] if snapshots else None
    required_file = "tokenizer.json" if repo_id == ALIGNMENT_TOKENIZER_REPO else "config.json"
    if snapshot is None or not (snapshot / required_file).is_file():
        raise AlignmentError("alignment-model-invalid", f"本地模型快照不完整: {repo_id}")
    return snapshot


def _load_local_whisper(model_path: Path | None = None, tokenizer_path: Path | None = None):
    from mlx_audio.stt import load

    resolved_model = model_path or _snapshot_for_repo(ALIGNMENT_MODEL_REPO)
    resolved_tokenizer = tokenizer_path or _snapshot_for_repo(ALIGNMENT_TOKENIZER_REPO)
    model = load(str(resolved_model))
    if getattr(model, "_processor", None) is None:
        from transformers import WhisperProcessor

        model._processor = WhisperProcessor.from_pretrained(str(resolved_tokenizer), local_files_only=True)
    return model


def align_audio_text(
    audio_path: Path,
    text: str,
    *,
    duration_s: float | None = None,
    language: str = "zh",
    model_path: Path | None = None,
    tokenizer_path: Path | None = None,
    model_loader: Callable[[Path | None, Path | None], Any] | None = None,
) -> dict[str, Any]:
    if not audio_path.is_file():
        raise AlignmentError("audio-missing", f"音频文件不存在: {audio_path}")
    loader = model_loader or _load_local_whisper
    try:
        model = loader(model_path, tokenizer_path)
        tokenizer = model.get_tokenizer(language=language, task="transcribe")
        text_tokens = tokenizer.encode(text.strip())
        if not text_tokens:
            raise AlignmentError("canonical-text-empty", "ttsSpokenText 未生成 tokenizer tokens")
        # mlx-audio 0.4.1's Whisper._prepare_audio() appends a full 30-second
        # padding window to the existing waveform.  That produces a mel tensor
        # longer than the model's fixed 3000-frame positional embedding for
        # every non-empty shot and fails with ``incorrect audio shape``.  Build
        # the same fixed 30-second input explicitly, while preserving the
        # unpadded content frame count used by find_alignment's timestamps.
        from mlx_audio.stt.models.whisper.audio import (
            HOP_LENGTH,
            N_FRAMES,
            N_SAMPLES,
            log_mel_spectrogram,
            pad_or_trim,
        )
        from mlx_audio.stt.utils import load_audio

        waveform = load_audio(str(audio_path))
        # The run contract's durationUs is the StoryboardShot/video slot. A
        # real TTS WAV can be longer than that slot by a few hundred
        # milliseconds; use the actual resampled Whisper duration as the
        # alignment bound while retaining the slot duration for EDL timing.
        audio_duration_s = float(waveform.shape[-1]) / 16_000
        duration_s = max(duration_s or 0.0, audio_duration_s)
        content_frames = min(int(waveform.shape[-1] // HOP_LENGTH), N_FRAMES)
        mel = log_mel_spectrogram(
            pad_or_trim(waveform, length=N_SAMPLES),
            n_mels=model.dims.n_mels,
            padding=0,
        )
        # mlx-audio 0.4.1 stores the default alignment-head matrix on the
        # private ``_alignment_heads`` field, while its timing helper reads the
        # public ``alignment_heads`` attribute.  Expose the already-loaded
        # matrix locally instead of inventing a second model configuration.
        if not hasattr(model, "alignment_heads"):
            alignment_heads = getattr(model, "_alignment_heads", None)
            if alignment_heads is None:
                raise AlignmentError("alignment-heads-missing", "Whisper 模型缺少 alignment heads")
            setattr(model, "alignment_heads", alignment_heads)
        from mlx_audio.stt.models.whisper.timing import find_alignment, merge_punctuations

        timings = find_alignment(model, tokenizer, text_tokens, mel, content_frames)
        # Whisper's timing pass may return a terminal punctuation token with a
        # zero-length interval.  Merge punctuation into the adjacent canonical
        # word before validating monotonic ranges; this preserves the exact
        # ttsSpokenText without manufacturing a timestamp for silence.
        merge_punctuations(
            timings,
            '"\'“¿([{-',
            appended='"\'.。,，!！?？:：”)]}、……',
        )
        timings = _merge_zero_length_timings(list(timings))
    except AlignmentError:
        raise
    except Exception as error:
        raise AlignmentError("alignment-runtime-failed", f"MLX 原文强制对齐失败: {error}") from error
    return build_canonical_alignment(text, timings, duration_s=duration_s)


def align_chapter(
    request: dict[str, Any],
    *,
    model_path: Path | None = None,
    tokenizer_path: Path | None = None,
    model_loader: Callable[[Path | None, Path | None], Any] | None = None,
) -> dict[str, Any]:
    shots = request.get("shots")
    if not isinstance(shots, list) or not shots:
        raise AlignmentError("shots-invalid", "至少需要一个 shot")
    aligned_shots: list[dict[str, Any]] = []
    for index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise AlignmentError("shot-invalid", f"shots[{index}] 必须是对象")
        shot_id = str(shot.get("shotId") or "").strip()
        audio_raw = str(shot.get("audioPath") or "").strip()
        text = str(shot.get("ttsSpokenText") or "")
        if not shot_id or not audio_raw or not text.strip():
            raise AlignmentError("shot-invalid", f"shots[{index}] 缺少 shotId/audioPath/ttsSpokenText")
        if text != text.strip():
            raise AlignmentError("canonical-text-whitespace", f"shot {shot_id} ttsSpokenText 首尾不能有空白")
        audio_path = Path(audio_raw).expanduser()
        declared_audio_sha = str(shot.get("audioSha256") or "")
        actual_audio_sha = sha256_file(audio_path)
        if declared_audio_sha and declared_audio_sha != actual_audio_sha:
            raise AlignmentError("audio-sha-mismatch", f"shot {shot_id} 音频 SHA-256 不匹配")
        declared_text_sha = str(shot.get("textSha256") or "")
        actual_text_sha = sha256_text(text)
        if declared_text_sha and declared_text_sha != actual_text_sha:
            raise AlignmentError("text-sha-mismatch", f"shot {shot_id} 文本 SHA-256 不匹配")
        duration_us = int(shot.get("durationUs") or 0)
        if duration_us <= 0:
            raise AlignmentError("duration-invalid", f"shot {shot_id} durationUs 必须大于 0")
        alignment = align_audio_text(
            audio_path,
            text,
            duration_s=duration_us / 1_000_000,
            language=str(request.get("language") or "zh"),
            model_path=model_path,
            tokenizer_path=tokenizer_path,
            model_loader=model_loader,
        )
        aligned_shots.append({
            "shotId": shot_id,
            "ttsSpokenText": text,
            "audioSha256": actual_audio_sha,
            "textSha256": actual_text_sha,
            **alignment,
        })
    return {
        "schemaVersion": 1,
        "status": "ready",
        "model": ALIGNMENT_MODEL_REPO,
        "tokenizer": ALIGNMENT_TOKENIZER_REPO,
        "projectId": request.get("projectId"),
        "chapterId": request.get("chapterId"),
        "revision": request.get("revision"),
        "shots": aligned_shots,
    }
