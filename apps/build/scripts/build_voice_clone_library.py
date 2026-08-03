from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import secrets
import shutil
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
import wave
from pathlib import Path
from typing import Any, Iterable, Sequence


EXPECTED_SOURCE_SHA256 = "7b70d8251807c5181b6a1a0b64e32256ec1da5b73f1fc7c75db8cd784c81a760"
DEFAULT_SOURCE = Path("/Users/zhengbingjin/Downloads/木成.mp3")
DEFAULT_OUTPUT_ROOT = Path("/Users/zhengbingjin/Documents/音频/800+音色合集/克隆参考音色/木成")
DEFAULT_PYTHON_RUNTIME = Path(
    "/Users/zhengbingjin/Library/Application Support/漫影工作室/python/bin/python3.12"
)
DEFAULT_TEST_TEXT = "你终于来了。我等了很久，也有很多话想当面告诉你。现在，请听我把事情说完。"
ACCEPTANCE_CRITICAL_TERMS = ("终于", "很久", "很多话", "当面", "现在", "请听", "事情", "说完")
SENSEVOICE_QUARANTINE_EVENTS = {"BGM", "Laughter", "Applause"}
SIDECAR_HOST = "127.0.0.1"
SIDECAR_PORT = 17594
SAMPLE_RATE = 24_000
CHANNELS = 1
SILENCE_THRESHOLD_DB = -40
SILENCE_MIN_DURATION = 0.25
PREFERRED_BOUNDARY_MIN_SILENCE = 0.5
SPEECH_GUARD_SECONDS = 0.05
FADE_SECONDS = 0.01
MIN_CLIP_SECONDS = 3.0
MAX_CLIP_SECONDS = 15.0
MAX_CLEAN_TIMELINE_DELTA_SECONDS = 0.1
MODEL_WEIGHT_EXTENSIONS = (".safetensors", ".bin", ".pt", ".pth", ".npz", ".onnx")
LOCAL_MODEL_REPOS = {
    "qwen": "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-bf16",
    "sensevoice": "mlx-community/SenseVoiceSmall",
    "whisper": "mlx-community/whisper-large-v3-turbo",
}
QUARANTINE_WINDOW = (192.92, 221.26)
EMOTION_WINDOWS = {
    "平静": (55.0, 75.0),
    "坚定": (110.0, 135.0),
    "悲伤": (140.0, 180.0),
    "兴奋": (257.0, 275.0),
    "愤怒": (275.0, 307.826939),
}
EMOTION_CODES = {
    "平静": "calm",
    "坚定": "firm",
    "悲伤": "sad",
    "兴奋": "excited",
    "愤怒": "angry",
}


class FileConflictError(RuntimeError):
    """An existing artifact does not match the expected SHA-256."""


class HumanReviewRequiredError(RuntimeError):
    """Acceptance is fail-closed until a human approves a reference."""


class PipelineError(RuntimeError):
    """A user-facing pipeline validation or execution error."""


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_source_sha256(path: Path, expected_sha256: str = EXPECTED_SOURCE_SHA256) -> str:
    path = Path(path)
    if not path.is_file():
        raise ValueError(f"source file not found: {path}")
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise ValueError(f"source SHA-256 mismatch: expected {expected_sha256}, got {actual}")
    return actual


def ensure_file_matches_or_raise(path: Path, expected_sha256: str) -> str:
    path = Path(path)
    if not path.is_file():
        return "missing"
    actual = sha256_file(path)
    if actual != expected_sha256:
        raise FileConflictError(
            f"refusing to overwrite mismatched file: {path} (expected {expected_sha256}, got {actual})"
        )
    return "reused"


def _write_bytes_if_absent(path: Path, data: bytes, expected_sha256: str) -> str:
    actual_sha256 = hashlib.sha256(data).hexdigest()
    if actual_sha256 != expected_sha256:
        raise FileConflictError(
            f"refusing to publish bytes with unexpected SHA-256 for {path}: "
            f"expected {expected_sha256}, got {actual_sha256}"
        )
    state = ensure_file_matches_or_raise(path, expected_sha256)
    if state == "reused":
        return state
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", dir=path.parent, delete=False) as handle:
        temp_path = Path(handle.name)
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return "created"


def atomic_write_json(
    path: Path,
    payload: dict[str, Any],
    *,
    allow_same_source_replace: bool = False,
    allow_existing_replace: bool = False,
) -> str:
    """Publish JSON atomically and reject unrelated existing state."""
    path = Path(path)
    encoded = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if path.exists():
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise FileConflictError(f"refusing to replace unreadable JSON: {path}") from exc
        same = existing == payload
        same_source = (
            allow_same_source_replace
            and isinstance(existing, dict)
            and isinstance(payload, dict)
            and existing.get("source", {}).get("sha256") == payload.get("source", {}).get("sha256")
            and existing.get("processing") == payload.get("processing")
        )
        if not same and not same_source and not allow_existing_replace:
            raise FileConflictError(f"refusing to overwrite inconsistent JSON: {path}")
        if same:
            return "reused"
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", prefix=f".{path.name}.", dir=path.parent, delete=False
    ) as handle:
        temp_path = Path(handle.name)
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return "replaced"


def _run(command: Sequence[str], *, cwd: Path | None = None, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(command),
        cwd=str(cwd) if cwd else None,
        env=env,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _tool_path(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise PipelineError(f"required tool is unavailable: {name}")
    return path


def _cached_model_available(models_dir: Path, repo_id: str) -> bool:
    models_dir = Path(models_dir).expanduser()
    roots = [models_dir]
    if models_dir.name != "hub":
        roots.append(models_dir / "hub")
    cache_name = f"models--{repo_id.replace('/', '--')}"
    for root in dict.fromkeys(roots):
        cache = root / cache_name
        snapshots = cache / "snapshots"
        if not snapshots.is_dir():
            continue
        if any(
            path.is_file() and path.suffix in MODEL_WEIGHT_EXTENSIONS
            for path in snapshots.rglob("*")
        ):
            return True
    return False


def _validate_local_dependencies(
    python_runtime: Path,
    models_dir: Path,
    *,
    require_qwen: bool,
) -> None:
    python_runtime = Path(python_runtime).expanduser()
    if not python_runtime.is_file() or not os.access(python_runtime, os.X_OK):
        raise PipelineError(f"bundled Python runtime is unavailable: {python_runtime}")
    required = ("sensevoice", "whisper", "qwen") if require_qwen else ("sensevoice", "whisper")
    missing = [
        f"{label}={LOCAL_MODEL_REPOS[label]}"
        for label in required
        if not _cached_model_available(models_dir, LOCAL_MODEL_REPOS[label])
    ]
    if missing:
        raise PipelineError(f"cached local models are unavailable: {', '.join(missing)}")


def probe_media(path: Path) -> dict[str, Any]:
    ffprobe = _tool_path("ffprobe")
    try:
        result = _run(
            [ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)]
        )
        payload = json.loads(result.stdout)
    except (subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        raise PipelineError(f"ffprobe failed for {path}") from exc
    streams = [stream for stream in payload.get("streams", []) if stream.get("codec_type") == "audio"]
    if not streams:
        raise PipelineError(f"source has no audio stream: {path}")
    stream = streams[0]
    duration = float(stream.get("duration") or payload.get("format", {}).get("duration") or 0.0)
    return {
        "format": payload.get("format", {}).get("format_name", ""),
        "duration": duration,
        "sampleRate": int(stream.get("sample_rate") or 0),
        "channels": int(stream.get("channels") or 0),
        "codec": stream.get("codec_name", ""),
        "sampleFormat": stream.get("sample_fmt", ""),
        "bitRate": int(stream.get("bit_rate") or 0),
        "raw": payload,
    }


def detect_silence(path: Path) -> list[tuple[float, float]]:
    ffmpeg = _tool_path("ffmpeg")
    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-nostats",
                "-i",
                str(path),
                "-af",
                f"silencedetect=n={SILENCE_THRESHOLD_DB}dB:d={SILENCE_MIN_DURATION}",
                "-f",
                "null",
                "-",
            ],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except subprocess.CalledProcessError as exc:
        raise PipelineError(f"ffmpeg silence detection failed for {path}") from exc
    starts: list[float] = []
    intervals: list[tuple[float, float]] = []
    for line in result.stderr.splitlines():
        start_match = re.search(r"silence_start:\s*([0-9.]+)", line)
        end_match = re.search(r"silence_end:\s*([0-9.]+)", line)
        if start_match:
            starts.append(float(start_match.group(1)))
        if end_match and starts:
            intervals.append((starts.pop(0), float(end_match.group(1))))
    return [(start, end) for start, end in intervals if end > start]


def _merge_intervals(intervals: Iterable[tuple[float, float]]) -> list[tuple[float, float]]:
    normalized = sorted((max(0.0, float(start)), max(0.0, float(end))) for start, end in intervals if end > start)
    merged: list[tuple[float, float]] = []
    for start, end in normalized:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def build_primary_speech_regions(
    duration: float,
    silence_intervals: Iterable[tuple[float, float]],
) -> list[tuple[float, float]]:
    duration = max(0.0, float(duration))
    preferred = [
        (max(0.0, start), min(duration, end))
        for start, end in _merge_intervals(silence_intervals)
        if end - start >= PREFERRED_BOUNDARY_MIN_SILENCE
    ]
    speech_regions: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in preferred:
        region_end = max(cursor, start - SPEECH_GUARD_SECONDS)
        region_start = min(cursor, region_end)
        if region_end - region_start >= MIN_CLIP_SECONDS:
            speech_regions.append((region_start, region_end))
        cursor = min(duration, end + SPEECH_GUARD_SECONDS)
    if duration - cursor >= MIN_CLIP_SECONDS:
        speech_regions.append((cursor, duration))
    return speech_regions


def split_speech_regions(
    speech_regions: Iterable[tuple[float, float]],
    *,
    asr_anchors: Iterable[dict[str, Any]] = (),
    energy_valleys: Iterable[dict[str, Any]] = (),
) -> list[tuple[float, float]]:
    anchors = [dict(item) for item in asr_anchors]
    valleys = [dict(item) for item in energy_valleys]
    boundaries: list[tuple[float, float]] = []
    for region_start, region_end in speech_regions:
        start = float(region_start)
        end = float(region_end)
        while end - start > MAX_CLIP_SECONDS:
            earliest = start + MIN_CLIP_SECONDS
            latest = min(start + MAX_CLIP_SECONDS, end - MIN_CLIP_SECONDS)
            eligible_anchors = [
                item
                for item in anchors
                if earliest <= float(item.get("time") or -1.0) <= latest
            ]
            punctuation_anchors = [item for item in eligible_anchors if item.get("punctuation") is True]
            anchor_pool = punctuation_anchors or eligible_anchors
            selected_anchor = min(
                anchor_pool,
                key=lambda item: (
                    abs(float(item.get("time") or 0.0) - latest),
                    float(item.get("time") or 0.0),
                ),
            ) if anchor_pool else None
            nearby_valleys = []
            if selected_anchor:
                anchor_time = float(selected_anchor["time"])
                nearby_valleys = [
                    item
                    for item in valleys
                    if earliest <= float(item.get("time") or -1.0) <= latest
                    and abs(float(item.get("time") or 0.0) - anchor_time) <= 0.75
                ]
            valley_pool = nearby_valleys or [
                item
                for item in valleys
                if earliest <= float(item.get("time") or -1.0) <= latest
            ]
            if valley_pool:
                target = float(selected_anchor["time"]) if selected_anchor else latest
                cut = float(
                    min(
                        valley_pool,
                        key=lambda item: (
                            float(item.get("rmsDb") or 0.0),
                            abs(float(item.get("time") or 0.0) - target),
                        ),
                    )["time"]
                )
            elif selected_anchor:
                cut = float(selected_anchor["time"])
            else:
                cut = latest
            cut = round(min(max(cut, earliest), latest), 3)
            boundaries.append((round(start, 3), cut))
            start = cut
        if end - start >= MIN_CLIP_SECONDS:
            boundaries.append((round(start, 3), round(end, 3)))
    return boundaries


def find_energy_valleys(
    path: Path,
    regions: Iterable[tuple[float, float]],
    *,
    block_seconds: float = 0.02,
) -> list[dict[str, float]]:
    readings: list[dict[str, float]] = []
    try:
        with wave.open(str(path), "rb") as handle:
            frame_rate = handle.getframerate()
            if handle.getnchannels() != 1 or handle.getsampwidth() != 2:
                raise PipelineError(f"energy analysis requires mono PCM s16le WAV: {path}")
            block_frames = max(1, int(frame_rate * block_seconds))
            total_frames = handle.getnframes()
            for region_start, region_end in regions:
                start_frame = max(0, min(total_frames, int(float(region_start) * frame_rate)))
                end_frame = max(start_frame, min(total_frames, int(float(region_end) * frame_rate)))
                handle.setpos(start_frame)
                cursor = start_frame
                region_readings: list[dict[str, float]] = []
                while cursor < end_frame:
                    frame_count = min(block_frames, end_frame - cursor)
                    raw = handle.readframes(frame_count)
                    if not raw:
                        break
                    values = struct.unpack("<" + "h" * (len(raw) // 2), raw)
                    rms = math.sqrt(sum(value * value for value in values) / max(len(values), 1))
                    region_readings.append(
                        {
                            "time": round((cursor + len(values) / 2) / frame_rate, 3),
                            "rmsDb": round(20 * math.log10(max(rms, 1) / 32767), 3),
                        }
                    )
                    cursor += len(values)
                if len(region_readings) < 3:
                    readings.extend(region_readings)
                    continue
                local = [
                    region_readings[index]
                    for index in range(1, len(region_readings) - 1)
                    if region_readings[index]["rmsDb"] <= region_readings[index - 1]["rmsDb"]
                    and region_readings[index]["rmsDb"] <= region_readings[index + 1]["rmsDb"]
                ]
                readings.extend(local or [min(region_readings, key=lambda item: item["rmsDb"])])
    except (OSError, wave.Error) as exc:
        raise PipelineError(f"unable to analyze local energy valleys: {path}") from exc
    return sorted(readings, key=lambda item: item["time"])


def build_candidate_boundaries(
    duration: float,
    silence_intervals: Iterable[tuple[float, float]],
    *,
    asr_anchors: Iterable[dict[str, Any]] = (),
    energy_valleys: Iterable[dict[str, Any]] = (),
) -> list[tuple[float, float]]:
    """Create stable 3-15 second source ranges around preferred silence cuts."""
    speech_regions = build_primary_speech_regions(duration, silence_intervals)
    return split_speech_regions(
        speech_regions,
        asr_anchors=asr_anchors,
        energy_valleys=energy_valleys,
    )


def classify_quarantine(
    start: float,
    end: float,
    *,
    non_speech_heavy: bool = False,
    uncertain: bool = False,
) -> tuple[bool, str]:
    if max(float(start), QUARANTINE_WINDOW[0]) < min(float(end), QUARANTINE_WINDOW[1]):
        return True, "source_window_192.92_221.26"
    if non_speech_heavy:
        return True, "non_speech_heavy"
    if uncertain:
        return True, "identity_or_background_uncertain"
    return False, ""


def sensevoice_quarantine_reason(event: str) -> str:
    return f"sensevoice_event_{event}" if event in SENSEVOICE_QUARANTINE_EVENTS else ""


def _existing_quarantine_reason(clip: dict[str, Any]) -> str:
    values = list(clip.get("qualityGate", {}).get("reasons") or [])
    values.append(str(clip.get("rejectionReason") or ""))
    tokens = []
    for value in values:
        for token in str(value).split(";"):
            if token and token not in tokens:
                tokens.append(token)
    for reason in (
        "source_window_192.92_221.26",
        "identity_or_background_uncertain",
        "non_speech_heavy",
    ):
        if reason in tokens:
            return reason
    for token in tokens:
        if token.startswith("sensevoice_event_"):
            return token
    return "previously_quarantined"


def emotion_for_range(start: float, end: float) -> tuple[str, str]:
    overlaps = []
    for emotion, (window_start, window_end) in EMOTION_WINDOWS.items():
        overlap = max(0.0, min(end, window_end) - max(start, window_start))
        if overlap:
            overlaps.append((overlap, emotion))
    if not overlaps:
        return "unavailable", "unavailable"
    _overlap, emotion = max(overlaps, key=lambda item: (item[0], -list(EMOTION_WINDOWS).index(item[1])))
    return emotion, EMOTION_CODES[emotion]


def _db_to_linear(db: float) -> float:
    return 10 ** (db / 20.0)


def measure_wav(path: Path) -> dict[str, Any]:
    try:
        with wave.open(str(path), "rb") as handle:
            frame_rate = handle.getframerate()
            channels = handle.getnchannels()
            sample_width = handle.getsampwidth()
            frame_count = handle.getnframes()
            sample_format = handle.getcomptype()
            peak = 0
            square_sum = 0.0
            sample_count = 0
            leading_silent = 0
            trailing_silent = 0
            threshold = int(32767 * _db_to_linear(SILENCE_THRESHOLD_DB))
            first_non_silent = False
            while True:
                raw = handle.readframes(8192)
                if not raw:
                    break
                if sample_width != 2:
                    raise PipelineError(f"expected PCM s16le WAV: {path}")
                values = struct.unpack("<" + "h" * (len(raw) // 2), raw)
                for value in values:
                    magnitude = abs(value)
                    peak = max(peak, magnitude)
                    square_sum += float(value * value)
                    sample_count += 1
                    if not first_non_silent:
                        if magnitude <= threshold:
                            leading_silent += 1
                        else:
                            first_non_silent = True
            if sample_count:
                handle.rewind()
                all_values = []
                while True:
                    raw = handle.readframes(8192)
                    if not raw:
                        break
                    all_values.extend(struct.unpack("<" + "h" * (len(raw) // 2), raw))
                for value in reversed(all_values):
                    if abs(value) <= threshold:
                        trailing_silent += 1
                    else:
                        break
            duration = frame_count / frame_rate if frame_rate else 0.0
            rms = math.sqrt(square_sum / sample_count) if sample_count else 0.0
    except (OSError, wave.Error) as exc:
        raise PipelineError(f"unable to measure WAV: {path}") from exc
    return {
        "duration": round(duration, 6),
        "sampleRate": frame_rate,
        "channels": channels,
        "sampleFormat": sample_format,
        "peakSample": peak,
        "peakDb": round(20 * math.log10(max(peak, 1) / 32767), 3),
        "rmsDb": round(20 * math.log10(max(rms, 1) / 32767), 3),
        "clippingDetected": peak >= 32767,
        "leadingSilenceMs": round(leading_silent / frame_rate * 1000, 3) if frame_rate else 0.0,
        "trailingSilenceMs": round(trailing_silent / frame_rate * 1000, 3) if frame_rate else 0.0,
    }


def _preflight(source: Path) -> dict[str, Any]:
    source = Path(source).expanduser()
    source_sha256 = verify_source_sha256(source)
    media = probe_media(source)
    silence_intervals = detect_silence(source)
    boundaries = build_candidate_boundaries(media["duration"], silence_intervals)
    return {
        "source": {
            "path": str(source),
            "filename": source.name,
            "sha256": source_sha256,
            "sizeBytes": source.stat().st_size,
            "duration": media["duration"],
        },
        "media": {key: value for key, value in media.items() if key != "raw"},
        "tools": {"ffmpeg": _tool_path("ffmpeg"), "ffprobe": _tool_path("ffprobe")},
        "silence": {
            "thresholdDb": SILENCE_THRESHOLD_DB,
            "minimumDuration": SILENCE_MIN_DURATION,
            "intervalCount": len(silence_intervals),
            "intervals": [
                {"start": round(start, 3), "end": round(end, 3), "duration": round(end - start, 3)}
                for start, end in silence_intervals
            ],
        },
        "candidateBoundaries": [
            {
                "start": start,
                "end": end,
                "duration": round(end - start, 3),
                "emotion": emotion_for_range(start, end)[0],
                "quarantine": classify_quarantine(start, end)[0],
            }
            for start, end in boundaries
        ],
        "processing": _processing_config(),
    }


def _processing_config() -> dict[str, Any]:
    return {
        "sampleRate": SAMPLE_RATE,
        "channels": CHANNELS,
        "codec": "pcm_s16le",
        "cleanMasterTimelinePreserved": True,
        "edgeSilenceGate": {
            "scope": "candidate_and_reference",
            "thresholdDb": SILENCE_THRESHOLD_DB,
            "maximumMs": 150,
        },
        "fadeInMs": 10,
        "fadeOutMs": 10,
        "silenceDetection": {
            "thresholdDb": SILENCE_THRESHOLD_DB,
            "minimumDurationSec": SILENCE_MIN_DURATION,
            "preferredBoundaryMinimumSec": PREFERRED_BOUNDARY_MIN_SILENCE,
        },
        "speechGuardMs": 50,
        "overlongRegionRefinement": {
            "maximumClipSeconds": MAX_CLIP_SECONDS,
            "preferredAnchor": "whisper_punctuation_or_segment_end",
            "energySnapRadiusSeconds": 0.75,
            "energyBlockSeconds": 0.02,
        },
        "sourceWindowQuarantine": list(QUARANTINE_WINDOW),
        "emotionWindows": {key: list(value) for key, value in EMOTION_WINDOWS.items()},
        "analysis": {
            "whisper": "draft_pending_or_local_sidecar",
            "senseVoice": "auxiliary_pending_or_local_sidecar",
            "manualCorrectionRequired": True,
        },
    }


def _json_or_none(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FileConflictError(f"invalid existing manifest: {path}") from exc
    if not isinstance(payload, dict):
        raise FileConflictError(f"existing manifest is not an object: {path}")
    return payload


def _assert_manifest_compatible(existing: dict[str, Any] | None, source_sha256: str) -> None:
    if not existing:
        return
    old_source = existing.get("source", {}).get("sha256")
    if old_source and old_source != source_sha256:
        raise FileConflictError(
            f"existing manifest source SHA-256 differs: expected {source_sha256}, got {old_source}"
        )
    if existing.get("processing") and existing["processing"] != _processing_config():
        raise FileConflictError("existing manifest processing configuration differs")


def _existing_candidate_boundaries(existing: dict[str, Any] | None) -> list[tuple[float, float]]:
    if not existing or not existing.get("clips"):
        return []
    boundaries: list[tuple[float, float]] = []
    for clip in existing["clips"]:
        source_range = clip.get("sourceRange") if isinstance(clip, dict) else None
        if not isinstance(source_range, dict):
            raise FileConflictError("existing clip is missing sourceRange")
        start = source_range.get("start")
        end = source_range.get("end")
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise FileConflictError("existing clip sourceRange is not numeric")
        start = round(float(start), 3)
        end = round(float(end), 3)
        if start < 0 or end <= start or end - start < MIN_CLIP_SECONDS - 0.001 or end - start > MAX_CLIP_SECONDS + 0.001:
            raise FileConflictError(f"existing clip sourceRange is invalid: {start}-{end}")
        boundaries.append((start, end))
    boundaries.sort()
    for previous, current in zip(boundaries, boundaries[1:]):
        if current[0] < previous[1] - 0.001:
            raise FileConflictError(f"existing clip source ranges overlap: {previous} and {current}")
    return boundaries


def _confined_subtree_root(output_root: Path, subtree: str) -> Path:
    root = Path(output_root).expanduser().resolve()
    allowed_root = (root / subtree).resolve()
    if not allowed_root.is_relative_to(root):
        raise FileConflictError(f"library subtree escapes output root: {subtree}")
    return allowed_root


def _confined_library_path(output_root: Path, value: str | Path, *, subtree: str) -> tuple[Path, Path]:
    root = Path(output_root).expanduser().resolve()
    candidate = (root / Path(value)).resolve()
    allowed_root = _confined_subtree_root(root, subtree)
    if not candidate.is_relative_to(allowed_root):
        raise FileConflictError(
            f"library artifact path escapes {subtree}/: {value}"
        )
    return candidate, candidate.relative_to(root)


def _existing_artifact_sha(existing: dict[str, Any] | None, path_value: str) -> str | None:
    if not existing:
        return None
    if path_value == "clean/木成-master-24k-mono.wav":
        return existing.get("cleanMaster", {}).get("sha256")
    for clip in existing.get("clips", []):
        if clip.get("path") == path_value:
            return clip.get("sha256")
    return None


def _materialize_from_temp(path: Path, producer, expected_sha256: str | None = None) -> tuple[str, str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent, delete=False) as handle:
        temp_path = Path(handle.name)
    temp_path.unlink()
    try:
        producer(temp_path)
        expected_sha = sha256_file(temp_path)
        if expected_sha256 and expected_sha != expected_sha256:
            raise FileConflictError(
                f"derived artifact SHA-256 differs for {path}: expected {expected_sha256}, got {expected_sha}"
            )
        state = ensure_file_matches_or_raise(path, expected_sha)
        if state == "missing":
            os.replace(temp_path, path)
            return "created", expected_sha
        return state, expected_sha
    finally:
        if temp_path.exists():
            temp_path.unlink()


def _ffmpeg_clean_master(source: Path, target: Path, expected_sha256: str | None = None) -> tuple[str, str]:
    ffmpeg = _tool_path("ffmpeg")

    def producer(temp_path: Path) -> None:
        _run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vn",
                "-ac",
                str(CHANNELS),
                "-ar",
                str(SAMPLE_RATE),
                "-sample_fmt",
                "s16",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                str(temp_path),
            ]
        )
        duration = probe_media(temp_path)["duration"]
        faded_path = temp_path.with_suffix(".faded.wav")
        try:
            _run(
                [
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(temp_path),
                    "-af",
                    f"afade=t=in:st=0:d={FADE_SECONDS},afade=t=out:st={max(0.0, duration - FADE_SECONDS)}:d={FADE_SECONDS}",
                    "-ac",
                    str(CHANNELS),
                    "-ar",
                    str(SAMPLE_RATE),
                    "-sample_fmt",
                    "s16",
                    "-c:a",
                    "pcm_s16le",
                    str(faded_path),
                ]
            )
            os.replace(faded_path, temp_path)
            source_duration = probe_media(source)["duration"]
            clean_duration = probe_media(temp_path)["duration"]
            if abs(clean_duration - source_duration) > MAX_CLEAN_TIMELINE_DELTA_SECONDS:
                raise PipelineError(
                    "clean master duration drifted from the source timeline: "
                    f"source={source_duration:.6f}s clean={clean_duration:.6f}s"
                )
        finally:
            if faded_path.exists():
                faded_path.unlink()

    return _materialize_from_temp(target, producer, expected_sha256)


def _ffmpeg_clip(
    master: Path,
    target: Path,
    start: float,
    end: float,
    expected_sha256: str | None = None,
) -> tuple[str, str]:
    ffmpeg = _tool_path("ffmpeg")
    duration = max(0.0, end - start)

    def producer(temp_path: Path) -> None:
        _run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{start:.3f}",
                "-i",
                str(master),
                "-t",
                f"{duration:.3f}",
                "-vn",
                "-ac",
                str(CHANNELS),
                "-ar",
                str(SAMPLE_RATE),
                "-af",
                f"afade=t=in:st=0:d={FADE_SECONDS},afade=t=out:st={max(0.0, duration - FADE_SECONDS)}:d={FADE_SECONDS}",
                "-sample_fmt",
                "s16",
                "-c:a",
                "pcm_s16le",
                "-f",
                "wav",
                str(temp_path),
            ]
        )

    return _materialize_from_temp(target, producer, expected_sha256)


def _clip_record(
    clip_id: str,
    start: float,
    end: float,
    path: Path,
    state: str,
    sha256: str,
    *,
    quarantine_reason: str = "",
) -> dict[str, Any]:
    emotion, emotion_code = emotion_for_range(start, end)
    quarantined = bool(quarantine_reason)
    metrics = measure_wav(path)
    quality_reasons = []
    if not 3.0 <= metrics["duration"] <= 15.0:
        quality_reasons.append("duration_out_of_range")
    if metrics["clippingDetected"]:
        quality_reasons.append("clipping_detected")
    if metrics["leadingSilenceMs"] > 150 or metrics["trailingSilenceMs"] > 150:
        quality_reasons.append("edge_silence_over_150ms")
    if quarantined:
        quality_reasons.append(quarantine_reason)
    return {
        "id": clip_id,
        "sourceRange": {"start": round(start, 3), "end": round(end, 3)},
        "sourceStart": round(start, 3),
        "sourceEnd": round(end, 3),
        "duration": metrics["duration"],
        "path": path.as_posix(),
        "sha256": sha256,
        "emotion": emotion,
        "emotionCode": emotion_code,
        "whisperDraft": "",
        "referenceText": "",
        "sensevoiceLabel": "",
        "audioMetrics": metrics,
        "qualityGate": {
            "automaticEligible": not quality_reasons,
            "reasons": quality_reasons,
        },
        "reviewStatus": "pending",
        "humanReview": {
            "status": "pending",
            "reviewer": "",
            "reviewedAt": "",
            "identityConfirmed": False,
            "singleSpeaker": None,
            "noMusicOrOverlap": None,
            "noTruncation": None,
        },
        "intendedUse": "quarantine" if quarantined or quality_reasons else "candidate_reference",
        "rejectionReason": ";".join(quality_reasons),
        "artifactState": state,
    }


def _preserve_review_fields(new_clip: dict[str, Any], old_clip: dict[str, Any] | None) -> dict[str, Any]:
    if not old_clip:
        return new_clip
    for key in (
        "whisperDraft",
        "referenceText",
        "sensevoiceLabel",
        "sensevoiceEvent",
        "sensevoiceText",
        "artifactState",
        "recutAttempt",
        "recutRevision",
        "supersedes",
        "selectionNotes",
        "reviewStatus",
        "humanReview",
    ):
        if key in old_clip:
            new_clip[key] = old_clip[key]
    if old_clip.get("reviewStatus") == "approved" and old_clip.get("referenceText"):
        new_clip["intendedUse"] = "approved_reference"
        new_clip["rejectionReason"] = ""
    return new_clip


def _write_text_atomic(path: Path, text: str, *, allow_same_source_replace: bool = False, source_sha256: str = "") -> str:
    path = Path(path)
    if path.exists():
        old = path.read_text(encoding="utf-8")
        if old == text:
            return "reused"
        if not allow_same_source_replace:
            raise FileConflictError(f"refusing to overwrite inconsistent text report: {path}")
        if source_sha256 and f"sourceSha256: `{source_sha256}`" not in old:
            raise FileConflictError(f"refusing to overwrite text report for another source: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", prefix=f".{path.name}.", dir=path.parent, delete=False
    ) as handle:
        temp_path = Path(handle.name)
        handle.write(text)
        handle.flush()
        os.fsync(handle.fileno())
    try:
        os.replace(temp_path, path)
    finally:
        if temp_path.exists():
            temp_path.unlink()
    return "replaced"


def _build_quality_report(manifest: dict[str, Any]) -> str:
    clips = manifest.get("clips", [])
    automatic = [clip for clip in clips if clip.get("qualityGate", {}).get("automaticEligible")]
    quarantined = [clip for clip in clips if clip.get("intendedUse") == "quarantine"]
    approved = [clip for clip in clips if clip.get("reviewStatus") == "approved"]
    lines = [
        "# 木成音色库质量报告",
        "",
        f"- schemaVersion: {manifest.get('schemaVersion', 1)}",
        f"- sourceSha256: `{manifest.get('source', {}).get('sha256', '')}`",
        f"- clips: {len(clips)}",
        f"- automaticEligible: {len(automatic)}",
        f"- quarantine: {len(quarantined)}",
        f"- humanApproved: {len(approved)}",
        f"- supersededClips: {len(manifest.get('supersededClips', []))}",
        "",
        "## 结论边界",
        "",
        "自动质量门不能代替人工听审；referenceText 与 identity/emotion 审核保持 pending，直到人工逐字校正并批准。",
        "",
        "## 情绪覆盖",
        "",
    ]
    availability = manifest.get("emotionAvailability", {})
    for emotion in EMOTION_WINDOWS:
        lines.append(f"- {emotion}: {availability.get(emotion, 'unavailable')}")
    review_candidates = [
        clip
        for clip in automatic
        if clip.get("emotion") in EMOTION_WINDOWS
    ]
    emotion_order = {emotion: index for index, emotion in enumerate(EMOTION_WINDOWS)}
    review_candidates.sort(
        key=lambda clip: (
            emotion_order[str(clip.get("emotion"))],
            float(clip.get("sourceRange", {}).get("start") or 0.0),
        )
    )
    lines.extend(
        [
            "",
            "## 人工听审候选",
            "",
            "逐条确认同一说话人、无BGM/重叠、无截断，并把实际台词逐字校正后再批准。SenseVoice仅作旁证。",
            "",
            "| id | 情绪 | 源区间 | 时长 | 路径 | Whisper草稿 | SenseVoice |",
            "| --- | --- | --- | ---: | --- | --- | --- |",
        ]
    )
    for clip in review_candidates:
        source_range = clip.get("sourceRange", {})
        draft = str(clip.get("whisperDraft") or "").replace("|", "\\|").replace("\n", " ")
        sense = "/".join(
            value
            for value in (
                str(clip.get("sensevoiceLabel") or ""),
                str(clip.get("sensevoiceEvent") or ""),
            )
            if value
        )
        lines.append(
            f"| {clip.get('id', '')} | {clip.get('emotion', '')} | "
            f"{float(source_range.get('start') or 0.0):.3f}-{float(source_range.get('end') or 0.0):.3f}s | "
            f"{float(clip.get('duration') or 0.0):.3f}s | {clip.get('path', '')} | {draft} | {sense} |"
        )
    return "\n".join(lines) + "\n"


def _emotion_availability(clips: list[dict[str, Any]]) -> dict[str, str]:
    availability: dict[str, str] = {}
    for emotion in EMOTION_WINDOWS:
        matching = [
            clip
            for clip in clips
            if clip.get("emotion") == emotion and clip.get("intendedUse") != "quarantine"
        ]
        approved = any(
            clip.get("reviewStatus") == "approved"
            and clip.get("humanReview", {}).get("status") == "approved"
            for clip in matching
        )
        availability[emotion] = "approved" if approved else ("pending_review" if matching else "unavailable")
    return availability


_LOCAL_SEGMENT_SCRIPT = r'''
import json
import re
import sys

from mlx_audio.stt import load


payload = json.load(sys.stdin)
clip_timestamps = []
for item in payload.get("ranges", []):
    clip_timestamps.extend([float(item["start"]), float(item["end"])])
whisper = load("mlx-community/whisper-large-v3-turbo")
if getattr(whisper, "_processor", None) is None:
    from transformers import WhisperProcessor
    whisper._processor = WhisperProcessor.from_pretrained(
        "openai/whisper-large-v3-turbo",
        local_files_only=True,
    )
result = whisper.generate(
    payload["path"],
    language="zh",
    clip_timestamps=clip_timestamps,
)
segments = result.get("segments") if isinstance(result, dict) else getattr(result, "segments", None)
anchors = []
for segment in segments or []:
    if not isinstance(segment, dict):
        continue
    text = str(segment.get("text") or "").strip()
    end = float(segment.get("end") or 0.0)
    anchors.append({
        "time": end,
        "text": text,
        "punctuation": bool(re.search(r"[。！？!?；;：:,，、]$", text)),
    })
print(json.dumps(anchors, ensure_ascii=False))
'''


_LOCAL_STT_SCRIPT = r'''
import json
import sys

from mlx_audio.stt import load


def text_value(result):
    if isinstance(result, str):
        return result.strip()
    if isinstance(result, dict):
        return str(result.get("text") or "").strip()
    return str(getattr(result, "text", result)).strip()


def segment_value(result, key):
    if isinstance(result, dict):
        segments = result.get("segments") or []
    else:
        segments = getattr(result, "segments", None) or []
    first = segments[0] if segments else {}
    return str(first.get(key) or "").strip() if isinstance(first, dict) else ""


items = json.load(sys.stdin)
whisper = load("mlx-community/whisper-large-v3-turbo")
if getattr(whisper, "_processor", None) is None:
    from transformers import WhisperProcessor
    whisper._processor = WhisperProcessor.from_pretrained(
        "openai/whisper-large-v3-turbo",
        local_files_only=True,
    )
sensevoice = load("mlx-community/SenseVoiceSmall")
results = []
for item in items:
    whisper_result = whisper.generate(item["path"], language="zh")
    sensevoice_result = sensevoice.generate(item["path"], language="zh", use_itn=True)
    results.append({
        "id": item["id"],
        "whisperDraft": text_value(whisper_result),
        "sensevoiceText": text_value(sensevoice_result),
        "sensevoiceLabel": segment_value(sensevoice_result, "emotion"),
        "sensevoiceEvent": segment_value(sensevoice_result, "event"),
    })
print(json.dumps(results, ensure_ascii=False))
'''


def _analyze_segmentation_anchors(
    audio_path: Path,
    regions: list[tuple[float, float]],
    *,
    python_runtime: Path,
    models_dir: Path,
) -> list[dict[str, Any]]:
    if not regions:
        return []
    python_runtime = Path(python_runtime).expanduser()
    if not python_runtime.is_file() or not os.access(python_runtime, os.X_OK):
        raise PipelineError(f"bundled Python runtime is unavailable for segmentation ASR: {python_runtime}")
    env = os.environ.copy()
    env.update(
        {
            "MANYING_TTS_MODELS_DIR": str(Path(models_dir).expanduser()),
            "VOICEBOX_MODELS_DIR": str(Path(models_dir).expanduser()),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
    )
    payload = json.dumps(
        {
            "path": str(audio_path),
            "ranges": [{"start": start, "end": end} for start, end in regions],
        },
        ensure_ascii=False,
    )
    try:
        result = subprocess.run(
            [str(python_runtime), "-c", _LOCAL_SEGMENT_SCRIPT],
            input=payload,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=True,
        )
        output_lines = [line for line in result.stdout.splitlines() if line.strip()]
        values = json.loads(output_lines[-1] if output_lines else "[]")
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        detail = getattr(exc, "stderr", "") or ""
        raise PipelineError(f"local Whisper segmentation analysis failed: {str(detail)[-500:]}") from exc
    if not isinstance(values, list):
        raise PipelineError("local segmentation analysis returned an invalid result")
    return [item for item in values if isinstance(item, dict) and isinstance(item.get("time"), (int, float))]


def _analyze_clip_transcripts(
    clips: list[dict[str, Any]],
    *,
    python_runtime: Path,
    models_dir: Path,
) -> dict[str, dict[str, str]]:
    if not clips:
        return {}
    python_runtime = Path(python_runtime).expanduser()
    if not python_runtime.is_file() or not os.access(python_runtime, os.X_OK):
        raise PipelineError(f"bundled Python runtime is unavailable for local transcription: {python_runtime}")
    env = os.environ.copy()
    env.update(
        {
            "MANYING_TTS_MODELS_DIR": str(Path(models_dir).expanduser()),
            "VOICEBOX_MODELS_DIR": str(Path(models_dir).expanduser()),
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
        }
    )
    payload = json.dumps(
        [{"id": clip["id"], "path": str(clip["_absolutePath"])} for clip in clips],
        ensure_ascii=False,
    )
    try:
        result = subprocess.run(
            [str(python_runtime), "-c", _LOCAL_STT_SCRIPT],
            input=payload,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=True,
        )
        output_lines = [line for line in result.stdout.splitlines() if line.strip()]
        values = json.loads(output_lines[-1] if output_lines else "[]")
    except (OSError, subprocess.CalledProcessError, json.JSONDecodeError) as exc:
        detail = getattr(exc, "stderr", "") or ""
        raise PipelineError(f"local Whisper/SenseVoice analysis failed: {str(detail)[-500:]}") from exc
    if not isinstance(values, list):
        raise PipelineError("local transcription returned an invalid result")
    return {str(item["id"]): item for item in values if isinstance(item, dict) and item.get("id")}


def build_library(
    source: Path,
    output_root: Path,
    *,
    apply: bool,
    python_runtime: Path = DEFAULT_PYTHON_RUNTIME,
    models_dir: Path = Path.home() / ".cache" / "huggingface" / "hub",
) -> dict[str, Any]:
    preflight = _preflight(source)
    _validate_local_dependencies(python_runtime, models_dir, require_qwen=False)
    source_info = preflight["source"]
    output_root = Path(output_root).expanduser()
    manifest_path = output_root / "library-manifest.json"
    existing = _json_or_none(manifest_path)
    _assert_manifest_compatible(existing, source_info["sha256"])
    if not apply:
        return {
            "command": "build",
            "apply": False,
            "wouldWrite": True,
            "outputRoot": str(output_root),
            "preflight": preflight,
            "message": "validation only; pass --apply to write the external library",
        }

    output_root.mkdir(parents=True, exist_ok=True)
    source_target, _source_relative = _confined_library_path(
        output_root, Path("source") / source_info["filename"], subtree="source"
    )
    _write_bytes_if_absent(source_target, Path(source).read_bytes(), source_info["sha256"])

    clean_path, _clean_relative = _confined_library_path(
        output_root, "clean/木成-master-24k-mono.wav", subtree="clean"
    )
    old_clean_sha = _existing_artifact_sha(existing, "clean/木成-master-24k-mono.wav")
    if old_clean_sha and clean_path.is_file():
        ensure_file_matches_or_raise(clean_path, old_clean_sha)
        clean_state = str((existing or {}).get("cleanMaster", {}).get("artifactState") or "reused")
        clean_sha = old_clean_sha
    else:
        clean_state, clean_sha = _ffmpeg_clean_master(source, clean_path, old_clean_sha)
    clean_metrics = measure_wav(clean_path)
    if clean_metrics["sampleRate"] != SAMPLE_RATE or clean_metrics["channels"] != CHANNELS:
        raise PipelineError("clean master did not satisfy 24kHz mono contract")

    silence_intervals = [
        (float(item["start"]), float(item["end"]))
        for item in preflight["silence"]["intervals"]
    ]
    primary_regions = build_primary_speech_regions(source_info["duration"], silence_intervals)
    overlong_regions = [
        (start, end)
        for start, end in primary_regions
        if end - start > MAX_CLIP_SECONDS
    ]
    existing_boundaries = _existing_candidate_boundaries(existing)
    if existing_boundaries:
        candidate_boundaries = existing_boundaries
        segmentation_evidence = dict((existing or {}).get("segmentation") or {})
    else:
        segmentation_anchors = _analyze_segmentation_anchors(
            clean_path,
            overlong_regions,
            python_runtime=python_runtime,
            models_dir=models_dir,
        )
        energy_valleys = find_energy_valleys(clean_path, overlong_regions)
        candidate_boundaries = build_candidate_boundaries(
            source_info["duration"],
            silence_intervals,
            asr_anchors=segmentation_anchors,
            energy_valleys=energy_valleys,
        )
        segmentation_evidence = {
            "primaryRegionCount": len(primary_regions),
            "overlongRegionCount": len(overlong_regions),
            "asrAnchorCount": len(segmentation_anchors),
            "punctuationAnchorCount": sum(
                1 for item in segmentation_anchors if item.get("punctuation") is True
            ),
            "energyValleyCount": len(energy_valleys),
            "finalBoundaryCount": len(candidate_boundaries),
            "asrAnchors": segmentation_anchors,
            "reusedPublishedBoundaries": False,
        }

    old_by_range = {
        (round(float(clip.get("sourceStart") or 0.0), 3), round(float(clip.get("sourceEnd") or 0.0), 3)): clip
        for clip in (existing or {}).get("clips", [])
        if isinstance(clip, dict)
    }
    clips: list[dict[str, Any]] = []
    counters: dict[str, int] = {}
    for start, end in candidate_boundaries:
        emotion, _emotion_code = emotion_for_range(start, end)
        quarantined, reason = classify_quarantine(start, end)
        old_clip = old_by_range.get((round(start, 3), round(end, 3)))
        if old_clip and str(old_clip.get("path") or "").startswith("clips/quarantine/"):
            quarantined = True
            reason = _existing_quarantine_reason(old_clip)
        bucket = "quarantine" if quarantined else emotion
        counters[bucket] = counters.get(bucket, 0) + 1
        number = counters[bucket]
        if old_clip and old_clip.get("path"):
            relative = Path(str(old_clip["path"]))
        elif quarantined:
            relative = Path("clips") / "quarantine" / f"mucheng-quarantine-{number:03d}.wav"
        else:
            relative = Path("clips") / bucket / f"mucheng-{bucket}-{number:03d}.wav"
        target, relative = _confined_library_path(output_root, relative, subtree="clips")
        clip_id = str((old_clip or {}).get("id") or relative.stem)
        old_sha = old_clip.get("sha256") if old_clip else None
        if old_sha and target.is_file():
            clip_state = ensure_file_matches_or_raise(target, old_sha)
            clip_sha = old_sha
        else:
            clip_state, clip_sha = _ffmpeg_clip(clean_path, target, start, end, old_sha)
        record = _clip_record(
            clip_id,
            start,
            end,
            target,
            clip_state,
            clip_sha,
            quarantine_reason=reason,
        )
        record["path"] = relative.as_posix()
        record["_absolutePath"] = str(target)
        clips.append(_preserve_review_fields(record, old_clip))

    clips_requiring_analysis = [
        clip
        for clip in clips
        if not clip.get("whisperDraft") or not clip.get("sensevoiceEvent")
    ]
    transcript_values = _analyze_clip_transcripts(
        clips_requiring_analysis,
        python_runtime=python_runtime,
        models_dir=models_dir,
    )
    for clip in clips:
        analysis = transcript_values.get(clip["id"], {})
        if analysis:
            clip["whisperDraft"] = str(analysis.get("whisperDraft") or "")
            clip["sensevoiceLabel"] = str(analysis.get("sensevoiceLabel") or "")
            clip["sensevoiceEvent"] = str(analysis.get("sensevoiceEvent") or "")
            clip["sensevoiceText"] = str(analysis.get("sensevoiceText") or "")
        clip.pop("_absolutePath", None)

    for clip in clips:
        event = clip.get("sensevoiceEvent")
        reason = sensevoice_quarantine_reason(str(event or ""))
        if not reason:
            continue
        if str(clip.get("path") or "").startswith("clips/quarantine/"):
            continue
        reasons = list(clip.get("qualityGate", {}).get("reasons") or [])
        if reason not in reasons:
            reasons.append(reason)
        clip["qualityGate"] = {"automaticEligible": False, "reasons": reasons}
        clip["intendedUse"] = "quarantine"
        clip["rejectionReason"] = ";".join(reasons)
        counters["quarantine"] = counters.get("quarantine", 0) + 1
        relative = Path("clips") / "quarantine" / f"mucheng-quarantine-{counters['quarantine']:03d}.wav"
        source_path, _source_relative = _confined_library_path(
            output_root, str(clip["path"]), subtree="clips"
        )
        target_path, relative = _confined_library_path(output_root, relative, subtree="clips")
        if target_path.exists():
            ensure_file_matches_or_raise(target_path, str(clip["sha256"]))
            if source_path.resolve() != target_path.resolve():
                raise FileConflictError(f"refusing to leave a duplicate dynamic quarantine clip: {source_path}")
        elif source_path.resolve() != target_path.resolve():
            target_path.parent.mkdir(parents=True, exist_ok=True)
            os.replace(source_path, target_path)
        clip["id"] = relative.stem
        clip["path"] = relative.as_posix()
        clip["artifactState"] = "relocated_to_quarantine"

    availability = _emotion_availability(clips)

    manifest = {
        "schemaVersion": 1,
        "library": "木成",
        "source": {
            **source_info,
            "copyPath": "source/木成.mp3",
            "copySha256": source_info["sha256"],
        },
        "processing": _processing_config(),
        "cleanMaster": {
            "path": "clean/木成-master-24k-mono.wav",
            "sourceRange": {"start": 0.0, "end": source_info["duration"]},
            "sha256": clean_sha,
            "duration": clean_metrics["duration"],
            "audioMetrics": clean_metrics,
            "artifactState": clean_state,
        },
        "segmentation": segmentation_evidence,
        "emotionAvailability": availability,
        "clips": clips,
        "supersededClips": (existing or {}).get("supersededClips", []),
        "references": (existing or {}).get("references", []),
        "reviewPolicy": {
            "humanApprovalRequired": True,
            "referenceTextMustBeManuallyCorrected": True,
            "automaticApprovalForbidden": True,
        },
    }
    atomic_write_json(manifest_path, manifest, allow_same_source_replace=True)
    _write_text_atomic(
        output_root / "quality-report.md",
        _build_quality_report(manifest),
        allow_same_source_replace=True,
        source_sha256=source_info["sha256"],
    )
    return {
        "command": "build",
        "apply": True,
        "outputRoot": str(output_root),
        "manifestPath": str(manifest_path),
        "sourceSha256": source_info["sha256"],
        "clipCount": len(clips),
        "emotionAvailability": availability,
    }


def _reference_entries(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    explicit = manifest.get("references") or manifest.get("refs") or []
    if isinstance(explicit, dict):
        explicit = list(explicit.values())
    if explicit:
        return [item for item in explicit if isinstance(item, dict)]
    return [
        clip
        for clip in manifest.get("clips", [])
        if isinstance(clip, dict)
        and clip.get("reviewStatus") == "approved"
        and clip.get("humanReview", {}).get("status") == "approved"
    ]


def _resolved_artifact_path(manifest_path: Path, value: str) -> Path:
    path = Path(value).expanduser()
    return path if path.is_absolute() else manifest_path.parent / path


def validate_reviewed_references(manifest_path: Path) -> list[dict[str, Any]]:
    manifest_path = Path(manifest_path)
    library_root = manifest_path.parent.resolve()
    clips_root = _confined_subtree_root(library_root, "clips")
    refs_root = _confined_subtree_root(library_root, "refs")
    manifest = _json_or_none(manifest_path)
    if not manifest:
        raise HumanReviewRequiredError(f"library manifest is missing: {manifest_path}")
    entries = _reference_entries(manifest)
    if not entries:
        raise HumanReviewRequiredError("no human-reviewed reference exists")

    references: list[dict[str, Any]] = []
    for entry in entries:
        human = entry.get("humanReview") or {}
        review_status = entry.get("reviewStatus")
        if review_status != "approved" or human.get("status") != "approved":
            continue
        reference_text = str(entry.get("referenceText") or entry.get("reference_text") or "").strip()
        if not reference_text:
            continue
        if entry.get("qualityGate", {}).get("automaticEligible") is not True:
            continue
        if human.get("identityConfirmed") is not True:
            continue
        if human.get("singleSpeaker") is not True or human.get("noMusicOrOverlap") is not True:
            continue
        if human.get("noTruncation") is not True:
            continue
        source_range = entry.get("sourceRange")
        if (
            not isinstance(source_range, dict)
            or not isinstance(source_range.get("start"), (int, float))
            or not isinstance(source_range.get("end"), (int, float))
            or float(source_range["start"]) < 0
            or float(source_range["end"]) <= float(source_range["start"])
        ):
            continue
        raw_path = entry.get("path") or entry.get("referenceAudioPath") or entry.get("reference_audio_path")
        if not raw_path:
            continue
        audio_path = _resolved_artifact_path(manifest_path, str(raw_path)).resolve()
        if not (audio_path.is_relative_to(clips_root) or audio_path.is_relative_to(refs_root)):
            raise FileConflictError(f"reviewed reference is outside the library clips/refs roots: {audio_path}")
        if not audio_path.is_file():
            continue
        declared_sha = str(entry.get("sha256") or "")
        actual_sha = sha256_file(audio_path)
        if not re.fullmatch(r"[a-f0-9]{64}", declared_sha) or actual_sha != declared_sha:
            raise FileConflictError(f"reviewed reference SHA-256 mismatch: {audio_path}")
        metrics = measure_wav(audio_path)
        if (
            metrics.get("sampleRate") != SAMPLE_RATE
            or metrics.get("channels") != CHANNELS
            or metrics.get("clippingDetected") is True
            or float(metrics.get("duration") or 0) < MIN_CLIP_SECONDS
            or float(metrics.get("duration") or 0) > MAX_CLIP_SECONDS
            or float(metrics.get("leadingSilenceMs") or 0) > 150
            or float(metrics.get("trailingSilenceMs") or 0) > 150
        ):
            continue
        emotion = str(entry.get("emotion") or "unavailable")
        if emotion not in EMOTION_WINDOWS:
            raise HumanReviewRequiredError(f"reviewed reference has unsupported emotion: {emotion}")
        target_path = refs_root / f"木成-{emotion}.wav"
        references.append(
            {
                "id": str(entry.get("id") or target_path.stem),
                "emotion": emotion,
                "emotionCode": entry.get("emotionCode") or EMOTION_CODES.get(emotion, "unavailable"),
                "sourcePath": audio_path,
                "targetPath": target_path,
                "sha256": actual_sha,
                "referenceText": reference_text,
                "sourceRange": {
                    "start": round(float(source_range["start"]), 3),
                    "end": round(float(source_range["end"]), 3),
                },
                "metrics": metrics,
                "reviewStatus": review_status,
                "humanReview": human,
                "qualityGate": entry.get("qualityGate") or {},
            }
        )
    if not references:
        raise HumanReviewRequiredError("no human-reviewed reference passed the fail-closed quality gate")
    emotions = [reference["emotion"] for reference in references]
    if len(emotions) != len(set(emotions)):
        raise HumanReviewRequiredError("each emotion may have only one approved reference")
    return references


def _planned_reference_promotion(
    manifest_path: Path,
    references: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = _json_or_none(manifest_path)
    if not manifest:
        raise HumanReviewRequiredError(f"library manifest is missing: {manifest_path}")
    promoted: list[dict[str, Any]] = []
    for reference in references:
        source_path = Path(reference["sourcePath"]).resolve()
        target_path = Path(reference["targetPath"]).resolve()
        relative_target = target_path.relative_to(manifest_path.parent.resolve()).as_posix()
        promoted.append({**reference, "path": relative_target, "sourcePath": source_path, "targetPath": target_path})

    planned_manifest = dict(manifest)
    by_id = {str(item.get("id")): item for item in manifest.get("references", []) if isinstance(item, dict)}
    for reference in promoted:
        by_id[reference["id"]] = {
            "id": reference["id"],
            "path": reference["path"],
            "sha256": reference["sha256"],
            "emotion": reference["emotion"],
            "emotionCode": reference["emotionCode"],
            "referenceText": reference["referenceText"],
            "sourceRange": reference["sourceRange"],
            "audioMetrics": reference["metrics"],
            "qualityGate": reference["qualityGate"],
            "reviewStatus": reference["reviewStatus"],
            "humanReview": reference["humanReview"],
        }
    planned_manifest["references"] = [by_id[key] for key in sorted(by_id)]
    return planned_manifest, promoted


def _json_payload_sha256(payload: dict[str, Any]) -> str:
    encoded = (json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _validate_acceptance_report_target(
    report_path: Path,
    *,
    manifest_sha256: str,
    test_text: str,
) -> None:
    if not report_path.exists():
        return
    try:
        old_report = json.loads(report_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FileConflictError(f"refusing to replace unreadable acceptance report: {report_path}") from exc
    same_run = (
        old_report.get("manifestSha256") == manifest_sha256
        and old_report.get("testText") == test_text
        and old_report.get("seed") == 42
    )
    if not same_run:
        raise FileConflictError(f"refusing to overwrite acceptance report for another run: {report_path}")


def _promote_references(manifest_path: Path, references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    planned_manifest, promoted = _planned_reference_promotion(manifest_path, references)
    for reference in promoted:
        source_path = Path(reference["sourcePath"])
        target_path = Path(reference["targetPath"])
        _write_bytes_if_absent(target_path, source_path.read_bytes(), reference["sha256"])
    atomic_write_json(manifest_path, planned_manifest, allow_same_source_replace=True)
    return promoted


def _http_json(
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    token: str = "",
    timeout: float = 30.0,
) -> dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if token:
        headers["X-Manying-TTS-Token"] = token
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise PipelineError(f"sidecar HTTP {exc.code}: {detail[:500]}") from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise PipelineError(f"sidecar request failed: {method} {url}") from exc
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise PipelineError(f"sidecar returned invalid JSON: {method} {url}") from exc
    if not isinstance(value, dict):
        raise PipelineError(f"sidecar returned non-object JSON: {method} {url}")
    return value


def _http_bytes(method: str, url: str, *, token: str, timeout: float = 60.0) -> bytes:
    request = urllib.request.Request(url, method=method, headers={"X-Manying-TTS-Token": token})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        raise PipelineError(f"sidecar audio request failed: {method} {url}") from exc


def _process_rss_bytes(pid: int) -> int:
    try:
        result = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        value = int(result.stdout.strip() or "0")
    except (OSError, ValueError, subprocess.CalledProcessError):
        return 0
    return value * 1024


def _start_sidecar(
    runtime_dir: Path,
    python_runtime: Path,
    models_dir: Path,
) -> tuple[subprocess.Popen, str, str]:
    python_runtime = Path(python_runtime).expanduser()
    if not python_runtime.is_file() or not os.access(python_runtime, os.X_OK):
        raise PipelineError(f"bundled Python runtime is unavailable: {python_runtime}")
    backend_root = Path(__file__).resolve().parents[2] / "backend"
    if not (backend_root / "tts" / "main.py").is_file():
        raise PipelineError(f"sidecar backend is unavailable: {backend_root}")
    runtime_dir.mkdir(parents=True, exist_ok=True)
    log_path = runtime_dir / "sidecar.log"
    token = secrets.token_urlsafe(32)
    env = os.environ.copy()
    env.update(
        {
            "MANYING_TTS_DATA_DIR": str(runtime_dir),
            "MANYING_TTS_MODELS_DIR": str(models_dir.expanduser()),
            "VOICEBOX_MODELS_DIR": str(models_dir.expanduser()),
            "MANYING_TTS_CONTROL_TOKEN": token,
            "MANYING_TTS_ENGINE_MODE": "real",
            "MANYING_TTS_QWEN_BACKEND": "mlx",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "PYTHONPATH": str(Path(__file__).resolve().parents[2])
            + os.pathsep
            + env.get("PYTHONPATH", ""),
        }
    )
    log_handle = log_path.open("ab")
    process = subprocess.Popen(
        [
            str(python_runtime),
            "-m",
            "tts.main",
            "--host",
            SIDECAR_HOST,
            "--port",
            str(SIDECAR_PORT),
            "--data-dir",
            str(runtime_dir),
        ],
        cwd=str(backend_root),
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
    )
    log_handle.close()
    base_url = f"http://{SIDECAR_HOST}:{SIDECAR_PORT}"
    try:
        for _ in range(120):
            if process.poll() is not None:
                tail = log_path.read_text(encoding="utf-8", errors="replace")[-1000:]
                raise PipelineError(f"sidecar exited before health check: {tail}")
            try:
                health = _http_json("GET", f"{base_url}/health", timeout=1.0)
                if health.get("ok") is True:
                    return process, token, base_url
            except PipelineError:
                pass
            time.sleep(0.5)
    except Exception:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=5)
        raise
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=5)
    raise PipelineError("sidecar health check timed out")


def _stop_sidecar(process: subprocess.Popen | None, base_url: str, token: str) -> None:
    if process is None:
        return
    try:
        _http_json("POST", f"{base_url}/shutdown", payload={}, token=token, timeout=5)
    except PipelineError:
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=3)


def _normalize_chinese(value: str) -> str:
    return "".join(re.findall(r"[一-鿿]", value or ""))


def _edit_distance(left: str, right: str) -> int:
    previous = list(range(len(right) + 1))
    for index, left_char in enumerate(left, start=1):
        current = [index]
        for right_index, right_char in enumerate(right, start=1):
            current.append(
                min(
                    current[-1] + 1,
                    previous[right_index] + 1,
                    previous[right_index - 1] + (left_char != right_char),
                )
            )
        previous = current
    return previous[-1]


def _cer(expected: str, actual: str) -> float:
    expected_normalized = _normalize_chinese(expected)
    actual_normalized = _normalize_chinese(actual)
    return _edit_distance(expected_normalized, actual_normalized) / max(len(expected_normalized), 1)


def _has_abnormal_repetition(value: str) -> bool:
    normalized = _normalize_chinese(value)
    for width in range(2, min(8, len(normalized) // 3) + 1):
        for start in range(0, len(normalized) - width * 3 + 1):
            token = normalized[start : start + width]
            if normalized[start : start + width * 3] == token * 3:
                return True
    return False


def _missing_critical_terms(actual: str) -> list[str]:
    normalized = _normalize_chinese(actual)
    return [term for term in ACCEPTANCE_CRITICAL_TERMS if _normalize_chinese(term) not in normalized]


def _evaluate_generated_sample(expected: str, sample: dict[str, Any], analysis: dict[str, str]) -> dict[str, Any]:
    recognized = str(analysis.get("whisperDraft") or "")
    cer = _cer(expected, recognized)
    missing_terms = _missing_critical_terms(recognized)
    checks = {
        "backendIsQwenMlx": sample.get("backend") == "qwen-mlx",
        "mockedIsFalse": sample.get("mocked") is False,
        "nonEmpty": bool(sample.get("audioSha256")),
        "noClipping": not bool(sample.get("audioMetrics", {}).get("clippingDetected")),
        "noAbnormalRepetition": not _has_abnormal_repetition(recognized),
        "cerUnderFivePercent": cer <= 0.05,
        "criticalTermsPreserved": not missing_terms,
    }
    return {
        **checks,
        "passed": all(checks.values()),
        "cer": cer,
        "missingCriticalTerms": missing_terms,
    }


def _ensure_reviewed_audio_in_refs(manifest_path: Path, references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    promoted = []
    for reference in references:
        target_path = Path(reference["targetPath"])
        source_path = Path(reference["sourcePath"])
        if source_path.resolve() != target_path.resolve():
            _write_bytes_if_absent(target_path, source_path.read_bytes(), reference["sha256"])
        promoted.append(
            {
                **reference,
                "sourcePath": target_path,
                "targetPath": target_path,
                "path": target_path.relative_to(manifest_path.parent.resolve()).as_posix(),
            }
        )
    return promoted


def _create_profile(base_url: str, token: str, reference: dict[str, Any], profile_id: str) -> dict[str, Any]:
    return _http_json(
        "POST",
        f"{base_url}/profiles",
        token=token,
        payload={
            "id": profile_id,
            "name": f"木成-{reference['emotion']}",
            "voice_type": "reference",
            "language": "zh",
            "default_engine": "qwen",
            "default_model_size": "1.7B",
            "reference_audio_path": str(reference["targetPath"]),
            "reference_text": reference["referenceText"],
        },
    )


def _generate_sample(
    base_url: str,
    token: str,
    sidecar_process: subprocess.Popen,
    profile_id: str,
    text: str,
    output_path: Path,
) -> dict[str, Any]:
    started = time.monotonic()
    peak_memory_bytes = _process_rss_bytes(sidecar_process.pid)
    response = _http_json(
        "POST",
        f"{base_url}/generate",
        token=token,
        timeout=60,
        payload={
            "profile_id": profile_id,
            "text": text,
            "engine": "qwen",
            "model_size": "1.7B",
            "language": "zh",
            "seed": 42,
        },
    )
    generation_id = response.get("id")
    if not generation_id:
        raise PipelineError("sidecar generation response omitted id")
    status = response
    for _ in range(600):
        status = _http_json("GET", f"{base_url}/generate/{generation_id}/status", token=token, timeout=30)
        peak_memory_bytes = max(peak_memory_bytes, _process_rss_bytes(sidecar_process.pid))
        if status.get("status") in {"completed", "failed"}:
            break
        time.sleep(0.5)
    if status.get("status") != "completed":
        raise PipelineError(f"Qwen generation failed: {status.get('error') or status}")
    audio_bytes = _http_bytes("GET", f"{base_url}/audio/{generation_id}", token=token)
    audio_sha = hashlib.sha256(audio_bytes).hexdigest()
    _write_bytes_if_absent(output_path, audio_bytes, audio_sha)
    metrics = measure_wav(output_path)
    if metrics["clippingDetected"] or metrics["duration"] <= 0:
        raise PipelineError(f"generated audio failed automatic quality gate: {output_path}")
    mocked_value = status.get("mocked")
    if isinstance(mocked_value, bool):
        mocked = mocked_value
    elif isinstance(mocked_value, int) and mocked_value in (0, 1):
        mocked = bool(mocked_value)
    else:
        mocked = None
    return {
        "generationId": generation_id,
        "request": response,
        "status": status,
        "backend": status.get("backend"),
        "mocked": mocked,
        "audioPath": str(output_path),
        "audioSha256": audio_sha,
        "duration": metrics["duration"],
        "audioMetrics": metrics,
        "elapsedMs": round((time.monotonic() - started) * 1000, 3),
        "peakMemoryBytes": peak_memory_bytes,
    }


def _blind_listening_materials(directory: Path, samples: list[dict[str, Any]]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    lines = [
        "# 木成 Qwen 盲听记录",
        "",
        "请在不知道预期情绪的情况下填写身份评分、情绪猜测和备注。空白字段表示尚未人工听审。",
        "",
        "| sampleId | identityScore (1-5) | emotionGuess | notes | approved |",
        "| --- | ---: | --- | --- | --- |",
    ]
    for sample in samples:
        lines.append(f"| {sample['blindId']} |  |  |  |  |")
    _write_text_atomic(directory / "worksheet.md", "\n".join(lines) + "\n")
    atomic_write_json(
        directory / "worksheet.json",
        {
            "humanReviewStatus": "pending",
            "samples": [
                {"sampleId": sample["blindId"], "identityScore": None, "emotionGuess": "", "notes": "", "approved": None}
                for sample in samples
            ],
        },
    )


def _write_acceptance_failure_report(
    report_path: Path,
    *,
    source_sha256: str,
    manifest_sha256: str,
    run_identity: str,
    runtime_dir: Path,
    test_text: str,
    stage: str,
    error: Exception,
    profiles: list[dict[str, Any]],
) -> None:
    report = {
        "schemaVersion": 1,
        "command": "accept",
        "status": "failed",
        "sourceSha256": source_sha256,
        "manifestSha256": manifest_sha256,
        "runtime": {
            "host": SIDECAR_HOST,
            "port": SIDECAR_PORT,
            "engineMode": "real",
            "qwenBackend": "mlx",
            "offline": True,
            "runIdentity": run_identity,
            "runtimeDirectory": str(runtime_dir),
        },
        "testText": test_text,
        "seed": 42,
        "profiles": profiles,
        "failure": {
            "stage": stage,
            "errorType": type(error).__name__,
            "message": str(error)[:2000],
        },
        "automaticSummary": {
            "passed": False,
            "failedSampleIds": [],
            "senseVoiceEmotions": [],
            "senseVoiceHasAtLeastTwoEmotions": False,
        },
        "conclusions": {
            "voiceLibraryComplete": True,
            "qwenVoiceCloneQualified": "automatic_gate_failed",
            "qwenEmotionTransferQualified": "automatic_gate_failed",
        },
        "humanReview": {"status": "not_started"},
    }
    atomic_write_json(report_path, report, allow_existing_replace=report_path.exists())


def accept_library(
    source: Path,
    output_root: Path,
    *,
    python_runtime: Path,
    models_dir: Path,
    test_text: str,
    apply: bool,
) -> dict[str, Any]:
    if test_text != DEFAULT_TEST_TEXT:
        raise ValueError("acceptance test text is fixed to the approved baseline")
    source_sha256 = verify_source_sha256(Path(source).expanduser())
    output_root = Path(output_root).expanduser()
    _validate_local_dependencies(python_runtime, models_dir, require_qwen=True)
    manifest_path = output_root / "library-manifest.json"
    manifest = _json_or_none(manifest_path)
    if not manifest:
        raise HumanReviewRequiredError(f"library manifest is missing: {manifest_path}")
    if manifest.get("source", {}).get("sha256") != source_sha256:
        raise FileConflictError("accept source SHA-256 does not match library manifest")
    references = validate_reviewed_references(manifest_path)
    if not any(reference["emotion"] == "平静" for reference in references):
        raise HumanReviewRequiredError("a human-approved calm reference is required before Qwen acceptance")
    if not apply:
        return {
            "command": "accept",
            "apply": False,
            "wouldStartSidecar": True,
            "port": SIDECAR_PORT,
            "referenceCount": len(references),
            "message": "validation only; pass --apply to start the isolated real MLX sidecar",
        }

    planned_manifest, _planned_promoted = _planned_reference_promotion(manifest_path, references)
    manifest_sha256 = _json_payload_sha256(planned_manifest)
    run_identity = hashlib.sha256(
        f"{manifest_sha256}\0{test_text}\0seed=42".encode("utf-8")
    ).hexdigest()[:16]
    report_path = output_root / "acceptance-report.json"
    _validate_acceptance_report_target(
        report_path,
        manifest_sha256=manifest_sha256,
        test_text=test_text,
    )
    _confined_subtree_root(output_root, "acceptance")
    runtime_dir, _runtime_relative = _confined_library_path(
        output_root, Path("acceptance") / "qwen-1.7B" / "runtime" / run_identity, subtree="acceptance"
    )
    generated_root, _generated_relative = _confined_library_path(
        output_root, Path("acceptance") / "qwen-1.7B" / "generated" / run_identity, subtree="acceptance"
    )
    blind_root, _blind_relative = _confined_library_path(
        output_root, Path("acceptance") / "qwen-1.7B" / "blind-listening" / run_identity, subtree="acceptance"
    )
    process: subprocess.Popen | None = None
    base_url = f"http://{SIDECAR_HOST}:{SIDECAR_PORT}"
    token = ""
    profile_reports: list[dict[str, Any]] = []
    failure_stage = "reference_promotion"
    try:
        try:
            promoted = _promote_references(manifest_path, references)
            failure_stage = "sidecar_start"
            process, token, base_url = _start_sidecar(runtime_dir, python_runtime, models_dir)
            emotion_order = {emotion: index for index, emotion in enumerate(EMOTION_WINDOWS)}
            for index, reference in enumerate(
                sorted(promoted, key=lambda item: (emotion_order[item["emotion"]], item["id"])),
                start=1,
            ):
                profile_id = f"mucheng-{reference['emotionCode']}"
                failure_stage = "profile_create"
                profile_response = _create_profile(base_url, token, reference, profile_id)
                profile_root = generated_root / f"profile-{index:03d}"
                samples = []
                for repeat in (1, 2):
                    output_path = profile_root / f"sample-{repeat:03d}.wav"
                    failure_stage = "generation"
                    result = _generate_sample(
                        base_url,
                        token,
                        process,
                        profile_id,
                        test_text,
                        output_path,
                    )
                    blind_id = f"sample-{index:03d}-{repeat:03d}"
                    blind_path = blind_root / f"{blind_id}.wav"
                    _write_bytes_if_absent(blind_path, output_path.read_bytes(), result["audioSha256"])
                    samples.append({**result, "blindId": blind_id, "blindPath": str(blind_path)})
                profile_reports.append(
                    {
                        "profileId": profile_id,
                        "emotion": reference["emotion"],
                        "referenceAudioPath": str(reference["targetPath"]),
                        "referenceAudioSha256": reference["sha256"],
                        "sourceRange": reference["sourceRange"],
                        "referenceText": reference["referenceText"],
                        "profileResponse": profile_response,
                        "samples": samples,
                    }
                )
        finally:
            _stop_sidecar(process, base_url, token)
    except Exception as exc:
        _write_acceptance_failure_report(
            report_path,
            source_sha256=source_sha256,
            manifest_sha256=manifest_sha256,
            run_identity=run_identity,
            runtime_dir=runtime_dir,
            test_text=test_text,
            stage=failure_stage,
            error=exc,
            profiles=profile_reports,
        )
        raise

    all_samples = [sample for profile in profile_reports for sample in profile["samples"]]
    transcript_values = _analyze_clip_transcripts(
        [
            {
                "id": sample["blindId"],
                "_absolutePath": Path(sample["audioPath"]),
            }
            for sample in all_samples
        ],
        python_runtime=python_runtime,
        models_dir=models_dir,
    )
    for sample in all_samples:
        analysis = transcript_values.get(sample["blindId"], {})
        recognized = str(analysis.get("whisperDraft") or "")
        sample["asr"] = {
            "model": "Whisper Large V3 Turbo",
            "text": recognized,
            "cer": _cer(test_text, recognized),
        }
        sample["senseVoice"] = {
            "model": "SenseVoiceSmall",
            "text": str(analysis.get("sensevoiceText") or ""),
            "emotion": str(analysis.get("sensevoiceLabel") or ""),
            "event": str(analysis.get("sensevoiceEvent") or ""),
        }
        sample["automaticQuality"] = _evaluate_generated_sample(test_text, sample, analysis)

    automatic_passed = bool(all_samples) and all(
        sample["automaticQuality"]["passed"] for sample in all_samples
    )
    sensevoice_emotions = sorted(
        {
            sample["senseVoice"]["emotion"]
            for sample in all_samples
            if sample["senseVoice"]["emotion"]
        }
    )
    _blind_listening_materials(blind_root, all_samples)
    report = {
        "schemaVersion": 1,
        "command": "accept",
        "sourceSha256": source_sha256,
        "manifestSha256": manifest_sha256,
        "runtime": {
            "host": SIDECAR_HOST,
            "port": SIDECAR_PORT,
            "engineMode": "real",
            "qwenBackend": "mlx",
            "offline": True,
            "runIdentity": run_identity,
            "runtimeDirectory": str(runtime_dir),
            "controlTokenSha256": hashlib.sha256(token.encode("utf-8")).hexdigest() if token else "",
        },
        "testText": test_text,
        "seed": 42,
        "profiles": profile_reports,
        "automaticSummary": {
            "passed": automatic_passed,
            "failedSampleIds": [
                sample["blindId"]
                for sample in all_samples
                if not sample["automaticQuality"]["passed"]
            ],
            "senseVoiceEmotions": sensevoice_emotions,
            "senseVoiceHasAtLeastTwoEmotions": len(sensevoice_emotions) >= 2,
        },
        "conclusions": {
            "voiceLibraryComplete": True,
            "qwenVoiceCloneQualified": (
                "pending_human_review" if automatic_passed else "automatic_gate_failed"
            ),
            "qwenEmotionTransferQualified": (
                "pending_human_review" if automatic_passed else "automatic_gate_failed"
            ),
        },
        "humanReview": {"status": "pending", "emotionTransferRule": "<75% => Qwen emotion transfer not qualified"},
    }
    atomic_write_json(report_path, report, allow_existing_replace=report_path.exists())
    return {
        "command": "accept",
        "apply": True,
        "sourceSha256": source_sha256,
        "referenceCount": len(promoted),
        "sampleCount": len(all_samples),
        "reportPath": str(report_path),
        "conclusions": report["conclusions"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="木成本地参考音色库 inspect/build/accept pipeline")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("inspect", "build", "accept"):
        subparser = subparsers.add_parser(name)
        subparser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
        subparser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT_ROOT)
        subparser.add_argument("--apply", action="store_true", help="write artifacts or start acceptance")
    build_parser_instance = subparsers.choices["build"]
    build_parser_instance.add_argument("--python-runtime", type=Path, default=DEFAULT_PYTHON_RUNTIME)
    build_parser_instance.add_argument("--models-dir", type=Path, default=Path.home() / ".cache" / "huggingface" / "hub")
    accept_parser = subparsers.choices["accept"]
    accept_parser.add_argument("--python-runtime", type=Path, default=DEFAULT_PYTHON_RUNTIME)
    accept_parser.add_argument("--models-dir", type=Path, default=Path.home() / ".cache" / "huggingface" / "hub")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "inspect":
            result = _preflight(args.source)
            result["command"] = "inspect"
            result["outputRoot"] = str(args.output_root.expanduser())
            result["writes"] = False
        elif args.command == "build":
            result = build_library(
                args.source,
                args.output_root,
                apply=args.apply,
                python_runtime=args.python_runtime,
                models_dir=args.models_dir,
            )
        elif args.command == "accept":
            result = accept_library(
                args.source,
                args.output_root,
                python_runtime=args.python_runtime,
                models_dir=args.models_dir,
                test_text=DEFAULT_TEST_TEXT,
                apply=args.apply,
            )
        else:
            raise PipelineError(f"unsupported command: {args.command}")
    except (FileConflictError, HumanReviewRequiredError, PipelineError, ValueError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
