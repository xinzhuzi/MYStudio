"""video_use 媒体工具簇——派生音频/输入预备/成片校验/对齐工件。"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any
from .alignment import sha256_file
from . import adapter_shared
from .adapter_shared import VideoUseAdapterError, _require_absolute_file, _require_sha
from .adapter_edl import _alignment_for_shot


def _derived_filename(shot_id: str, index: int) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", shot_id).strip("._") or "shot"
    return f"{index:04d}-{safe}.mp4"
def _derive_video_to_audio(
    source_path: Path,
    derived_path: Path,
    target_duration_s: float,
    *,
    ffmpeg_path: str,
    ffprobe_path: str,
    env: dict[str, str] | None = None,
) -> float:
    """Clone the final video frame and pad the existing audio to TTS duration.

    This function is only called after the explicit ``pad-video-to-audio``
    policy has been selected. It never overwrites the source MP4 and always
    re-probes the resulting file before returning its measured duration.
    """
    source_path = source_path.resolve()
    derived_path = derived_path.resolve()
    derived_path.parent.mkdir(parents=True, exist_ok=True)
    tool_env = env if env is not None else adapter_shared._tool_env(ffmpeg_path, ffprobe_path)
    source_duration = adapter_shared._probe_media_duration(source_path, ffprobe_path, env=tool_env)
    pad_duration = max(0.0, target_duration_s - source_duration)
    try:
        subprocess.run(
            [
                ffmpeg_path,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(source_path),
                "-vf",
                f"tpad=stop_mode=clone:stop_duration={pad_duration:.6f}",
                "-af",
                "apad",
                "-t",
                f"{target_duration_s:.6f}",
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-movflags",
                "+faststart",
                str(derived_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=15 * 60,
            env=tool_env,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise VideoUseAdapterError("derived-input-ffmpeg-failed", f"派生视频生成失败: {source_path.name}") from error
    if not derived_path.is_file():
        raise VideoUseAdapterError("derived-input-missing", f"派生视频文件不存在: {derived_path}")
    derived_duration = adapter_shared._probe_media_duration(derived_path, ffprobe_path, env=tool_env)
    # Allow one 30fps frame of mux/container quantization, but do not accept a
    # derived video that is still shorter than the canonical audio duration.
    if derived_duration + (1.0 / 30.0) < target_duration_s:
        raise VideoUseAdapterError(
            "derived-input-duration-insufficient",
            f"派生视频仍短于 TTS 音频: expected={target_duration_s:.3f}s actual={derived_duration:.3f}s",
        )
    return derived_duration
def _prepare_derived_inputs(
    request: dict[str, Any],
    *,
    edit_dir: Path,
    ffmpeg_path: str,
    ffprobe_path: str,
    env: dict[str, str],
    now_ms: int,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    policy = str(request.get("derivedInputPolicy") or "reject")
    if policy not in {"reject", "pad-video-to-audio"}:
        raise VideoUseAdapterError("derived-input-policy-invalid", f"不支持的派生输入策略: {policy}")
    shots = request.get("shots")
    if not isinstance(shots, list) or not shots:
        raise VideoUseAdapterError("shots-invalid", "至少需要一个 shot")
    derived_dir = edit_dir.parent / "derived-inputs"
    effective_request = dict(request)
    effective_shots: list[dict[str, Any]] = []
    derived_inputs: list[dict[str, Any]] = []
    for index, raw_shot in enumerate(shots, start=1):
        if not isinstance(raw_shot, dict):
            raise VideoUseAdapterError("shot-invalid", f"shots[{index - 1}] 必须是对象")
        shot = dict(raw_shot)
        shot_id = str(shot.get("shotId") or "").strip()
        if not shot_id:
            raise VideoUseAdapterError("shot-invalid", f"shots[{index - 1}] 缺少 shotId")
        source_path = _require_absolute_file(shot.get("videoPath"), f"shot {shot_id} videoPath")
        audio_path = _require_absolute_file(shot.get("audioPath"), f"shot {shot_id} audioPath")
        declared_source_sha = _require_sha(shot.get("sourceSha256"), f"shot {shot_id} sourceSha256")
        actual_source_sha = sha256_file(source_path)
        if actual_source_sha != declared_source_sha:
            raise VideoUseAdapterError("source-sha-mismatch", f"shot {shot_id} 视频 SHA-256 不匹配")
        source_duration_s = adapter_shared._probe_media_duration(source_path, ffprobe_path, env=env)
        audio_duration_s = adapter_shared._probe_media_duration(audio_path, ffprobe_path, env=env)
        # A source may be one frame longer than the WAV after Remotion muxing;
        # only a video shorter than the canonical TTS audio needs derivation.
        if source_duration_s + (1.0 / 30.0) < audio_duration_s:
            if policy == "reject":
                raise VideoUseAdapterError(
                    "input-duration-mismatch",
                    f"shot {shot_id} 视频短于 TTS 音频: video={source_duration_s:.3f}s audio={audio_duration_s:.3f}s；请选择显式派生策略",
                )
            derived_path = derived_dir / _derived_filename(shot_id, index)
            derived_duration_s = _derive_video_to_audio(
                source_path,
                derived_path,
                audio_duration_s,
                ffmpeg_path=ffmpeg_path,
                ffprobe_path=ffprobe_path,
                env=env,
            )
            derived_sha = sha256_file(derived_path)
            evidence = {
                "schemaVersion": 1,
                "kind": "padded-video",
                "derivation": "ffmpeg-tpad-clone-apad",
                "sourcePath": str(source_path),
                "sourceSha256": actual_source_sha,
                "sourceDurationUs": round(source_duration_s * 1_000_000),
                "derivedPath": str(derived_path),
                "derivedSha256": derived_sha,
                "derivedDurationUs": round(derived_duration_s * 1_000_000),
                "derivedRevision": int(request.get("revision") or 0),
                "createdAt": now_ms,
            }
            shot["videoPath"] = str(derived_path)
            shot["sourceSha256"] = derived_sha
            # EDL and timeline projection use the canonical TTS duration, not
            # the frame-quantized container duration measured above.
            shot["durationUs"] = round(audio_duration_s * 1_000_000)
            shot["derivedInput"] = evidence
            derived_inputs.append(evidence)
        effective_shots.append(shot)
    effective_request["shots"] = effective_shots
    # Keep the chapter fingerprint tied to the bytes actually consumed by the
    # pinned adapter. Audio/text fingerprints remain unchanged.
    source_fingerprint = [
        {"shotId": str(shot["shotId"]), "sha256": str(shot["sourceSha256"])}
        for shot in effective_shots
    ]
    effective_request["sourceSha256"] = hashlib.sha256(
        json.dumps(source_fingerprint, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return effective_request, derived_inputs
def _validate_rendered_output(
    path: Path,
    duration: float,
    streams: list[str],
    expected_duration: float,
    *,
    segment_count: int = 1,
) -> None:
    if "video" not in streams:
        raise VideoUseAdapterError("output-video-missing", f"输出媒体缺少 video stream: {path.name}")
    if "audio" not in streams:
        raise VideoUseAdapterError("output-audio-missing", f"输出媒体缺少 audio stream: {path.name}")
    # The pinned helper re-encodes each EDL range at 30 fps and then muxes an
    # AAC stream. A multi-shot timeline can therefore accumulate at most one
    # video frame plus a small container tail per range even when every source
    # range is valid. Keep the tolerance tied to the segment count; never make
    # arbitrary duration drift acceptable.
    frame_quantization_tolerance = max(0.15, max(1, segment_count) / 30.0 + 0.1)
    if abs(duration - expected_duration) > frame_quantization_tolerance:
        raise VideoUseAdapterError(
            "output-duration-mismatch",
            f"输出时长与 EDL 不一致: expected={expected_duration:.3f}s actual={duration:.3f}s tolerance={frame_quantization_tolerance:.3f}s",
        )
def _build_alignment_artifacts(
    request: dict[str, Any],
    alignment: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    cues: list[dict[str, Any]] = []
    subtitles: list[dict[str, Any]] = []
    timeline_offset_us = 0
    for shot in request["shots"]:
        shot_id = str(shot["shotId"])
        aligned = _alignment_for_shot(alignment, shot_id)
        words = aligned["words"]
        word_values = [
            {
                "id": str(word["id"]),
                "text": str(word["text"]),
                "startUs": timeline_offset_us + round(float(word["startS"]) * 1_000_000),
                "durationUs": round((float(word["endS"]) - float(word["startS"])) * 1_000_000),
                "confidence": max(0.0, min(1.0, float(word["confidence"]))),
            }
            for word in words
        ]
        for sentence_index, sentence in enumerate(aligned.get("sentences") or [], start=1):
            start_us = timeline_offset_us + round(float(sentence["startS"]) * 1_000_000)
            duration_us = round((float(sentence["endS"]) - float(sentence["startS"])) * 1_000_000)
            sentence_words = [
                word for word in word_values
                if word["startUs"] < start_us + duration_us and word["startUs"] + word["durationUs"] > start_us
            ]
            cue = {
                "cueId": f"{shot_id}-sentence-{sentence_index:04d}",
                "shotId": shot_id,
                "text": str(sentence["text"]),
                "startUs": start_us,
                "durationUs": duration_us,
                "confidence": max(0.0, min(1.0, float(sentence["confidence"]))),
                "words": sentence_words,
            }
            cues.append(cue)
            subtitles.append({
                "cueId": cue["cueId"],
                "shotId": shot_id,
                "text": cue["text"],
                "startUs": start_us,
                "durationUs": duration_us,
                "source": "alignment",
            })
        timeline_offset_us += int(shot["durationUs"])
    return cues, subtitles
