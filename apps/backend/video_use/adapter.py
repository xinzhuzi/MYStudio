from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from .alignment import AlignmentError, sha256_file, sha256_text


class VideoUseAdapterError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _require_absolute_file(value: Any, field: str) -> Path:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute():
        raise VideoUseAdapterError("path-not-absolute", f"{field} 必须是绝对路径")
    if not path.is_file():
        raise VideoUseAdapterError("media-missing", f"{field} 文件不存在: {path}")
    return path


def _require_sha(value: Any, field: str) -> str:
    sha = str(value or "")
    if len(sha) != 64 or any(char not in "0123456789abcdef" for char in sha):
        raise VideoUseAdapterError("sha-invalid", f"{field} 必须是 64 位小写 SHA-256")
    return sha


def _seconds(value: Any, field: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise VideoUseAdapterError("duration-invalid", f"{field} 必须是数字") from error
    if number <= 0 or number != number or number == float("inf"):
        raise VideoUseAdapterError("duration-invalid", f"{field} 必须大于 0")
    return number


def _alignment_for_shot(alignment: dict[str, Any], shot_id: str) -> dict[str, Any]:
    shots = alignment.get("shots")
    if not isinstance(shots, list):
        raise VideoUseAdapterError("alignment-invalid", "alignment artifact 缺少 shots")
    for shot in shots:
        if isinstance(shot, dict) and shot.get("shotId") == shot_id:
            return shot
    raise VideoUseAdapterError("alignment-shot-missing", f"alignment 缺少 shot: {shot_id}")


def _validate_alignment_identity(request: dict[str, Any], alignment: dict[str, Any]) -> None:
    if alignment.get("schemaVersion") != 1 or alignment.get("status") != "ready":
        raise VideoUseAdapterError("alignment-not-ready", "alignment artifact 必须是 schema 1/ready")
    for key in ("projectId", "chapterId", "revision"):
        if alignment.get(key) != request.get(key):
            raise VideoUseAdapterError("alignment-identity-mismatch", f"alignment {key} 与当前章节不一致")
    if not isinstance(alignment.get("shots"), list) or not alignment["shots"]:
        raise VideoUseAdapterError("alignment-invalid", "alignment artifact 缺少 shots")


def build_edl_payload(
    request: dict[str, Any],
    alignment: dict[str, Any],
    edit_dir: Path,
) -> tuple[dict[str, Any], Path]:
    shots = request.get("shots")
    if not isinstance(shots, list) or not shots:
        raise VideoUseAdapterError("shots-invalid", "至少需要一个 shot")
    edit_dir.mkdir(parents=True, exist_ok=True)
    transcripts_dir = edit_dir / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    sources: dict[str, str] = {}
    ranges: list[dict[str, Any]] = []
    offset = 0.0
    for index, shot in enumerate(shots):
        if not isinstance(shot, dict):
            raise VideoUseAdapterError("shot-invalid", f"shots[{index}] 必须是对象")
        shot_id = str(shot.get("shotId") or "").strip()
        if not shot_id:
            raise VideoUseAdapterError("shot-invalid", f"shots[{index}] 缺少 shotId")
        video_path = _require_absolute_file(shot.get("videoPath"), f"shot {shot_id} videoPath")
        audio_path = _require_absolute_file(shot.get("audioPath"), f"shot {shot_id} audioPath")
        source_sha = _require_sha(shot.get("sourceSha256"), f"shot {shot_id} sourceSha256")
        audio_sha = _require_sha(shot.get("audioSha256"), f"shot {shot_id} audioSha256")
        text = str(shot.get("ttsSpokenText") or "")
        if not text.strip():
            raise VideoUseAdapterError("canonical-text-empty", f"shot {shot_id} ttsSpokenText 为空")
        if text != text.strip():
            raise VideoUseAdapterError("canonical-text-whitespace", f"shot {shot_id} ttsSpokenText 首尾不能有空白")
        if sha256_file(video_path) != source_sha:
            raise VideoUseAdapterError("source-sha-mismatch", f"shot {shot_id} 视频 SHA-256 不匹配")
        if sha256_file(audio_path) != audio_sha:
            raise VideoUseAdapterError("audio-sha-mismatch", f"shot {shot_id} 音频 SHA-256 不匹配")
        declared_text_sha = _require_sha(shot.get("textSha256"), f"shot {shot_id} textSha256")
        if sha256_text(text) != declared_text_sha:
            raise VideoUseAdapterError("text-sha-mismatch", f"shot {shot_id} 文本 SHA-256 不匹配")
        duration = _seconds(float(shot.get("durationUs") or 0) / 1_000_000, f"shot {shot_id} durationUs")
        aligned = _alignment_for_shot(alignment, shot_id)
        if str(aligned.get("ttsSpokenText") or "").strip() != text:
            raise VideoUseAdapterError("alignment-text-drift", f"shot {shot_id} alignment 文本已漂移")
        if aligned.get("audioSha256") not in (None, audio_sha):
            raise VideoUseAdapterError("alignment-audio-sha-mismatch", f"shot {shot_id} alignment 音频 SHA-256 已漂移")
        if aligned.get("textSha256") not in (None, declared_text_sha):
            raise VideoUseAdapterError("alignment-text-sha-mismatch", f"shot {shot_id} alignment 文本 SHA-256 已漂移")
        words = aligned.get("words")
        if not isinstance(words, list) or not words:
            raise VideoUseAdapterError("alignment-empty", f"shot {shot_id} alignment 没有词级时间")
        transcript_words: list[dict[str, Any]] = []
        for word in words:
            if not isinstance(word, dict):
                raise VideoUseAdapterError("alignment-invalid", f"shot {shot_id} alignment word 无效")
            start = float(word.get("startS") or 0.0)
            end = float(word.get("endS") or 0.0)
            if start < 0 or end <= start or end > duration + 0.05:
                raise VideoUseAdapterError("alignment-out-of-range", f"shot {shot_id} alignment 时间越界")
            transcript_words.append({
                "type": "word",
                "text": str(word.get("text") or ""),
                "start": start,
                "end": min(end, duration),
                "probability": float(word.get("confidence") or 0.0),
            })
        sources[shot_id] = str(video_path)
        ranges.append({
            "source": shot_id,
            "start": 0.0,
            "end": duration,
            "quote": text,
            "reason": "MYStudio Remotion shot binding，保留已确认分镜顺序",
        })
        _write_json(transcripts_dir / f"{shot_id}.json", {"text": text, "words": transcript_words})
        offset += duration

    grade = request.get("grade") if isinstance(request.get("grade"), str) else "auto"
    edl = {
        "version": 1,
        "sources": sources,
        "ranges": ranges,
        "grade": grade,
        "overlays": [],
        "subtitles": "master.srt",
        "total_duration_s": round(offset, 6),
    }
    edl_path = edit_dir / "edl.json"
    _write_json(edl_path, edl)
    return edl, edl_path


def _tool_env(ffmpeg_path: str, ffprobe_path: str) -> dict[str, str]:
    ffmpeg = Path(ffmpeg_path).expanduser()
    ffprobe = Path(ffprobe_path).expanduser()
    if not ffmpeg.is_absolute() or not ffprobe.is_absolute():
        raise VideoUseAdapterError("shared-tool-path-invalid", "FFmpeg/ffprobe 必须传入同一组绝对路径")
    if not ffmpeg.is_file() or not ffprobe.is_file():
        raise VideoUseAdapterError("shared-tool-missing", "共享 FFmpeg/ffprobe 文件不存在")
    env = os.environ.copy()
    tool_directories = [str(ffmpeg.parent), str(ffprobe.parent)]
    env["MYSTUDIO_FFMPEG_PATH"] = str(ffmpeg)
    env["MYSTUDIO_FFPROBE_PATH"] = str(ffprobe)
    env["PATH"] = os.pathsep.join([*tool_directories, env.get("PATH", "")])
    # Remotion's macOS compositor may load dylibs beside its bundled FFmpeg.
    # The Electron parent injects this path too, but the Python worker creates
    # another subprocess for the pinned helper and must preserve the same
    # shared-toolchain contract when invoked directly or through a retry.
    if sys.platform == "darwin":
        env["DYLD_LIBRARY_PATH"] = os.pathsep.join([
            *tool_directories,
            env.get("DYLD_LIBRARY_PATH", ""),
        ])
    return env


def _run_helper(helper: Path, args: list[str], *, cwd: Path, env: dict[str, str]) -> None:
    if not helper.is_file():
        raise VideoUseAdapterError("upstream-helper-missing", f"缺少 helper: {helper}")
    try:
        subprocess.run(
            [sys.executable, str(helper), *args],
            cwd=str(cwd),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=45 * 60,
        )
    except subprocess.TimeoutExpired as error:
        raise VideoUseAdapterError("upstream-helper-timeout", f"helper 超时: {helper.name}") from error
    except subprocess.CalledProcessError as error:
        raise VideoUseAdapterError("upstream-helper-failed", f"helper 执行失败: {helper.name} (exit={error.returncode})") from error


def _probe_output(
    path: Path,
    ffprobe_path: str,
    *,
    env: dict[str, str] | None = None,
) -> tuple[float, list[str]]:
    try:
        result = subprocess.run(
            [ffprobe_path, "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=60,
            env=env if env is not None else _tool_env(ffprobe_path, ffprobe_path),
        )
        payload = json.loads(result.stdout)
        duration = float((payload.get("format") or {}).get("duration") or 0.0)
        streams = [str(stream.get("codec_type")) for stream in payload.get("streams", []) if isinstance(stream, dict) and stream.get("codec_type")]
    except (OSError, subprocess.SubprocessError, ValueError, json.JSONDecodeError) as error:
        raise VideoUseAdapterError("output-probe-failed", f"输出 ffprobe 失败: {path.name}") from error
    if duration <= 0 or not streams:
        raise VideoUseAdapterError("output-invalid", f"输出媒体缺少有效时长或 streams: {path.name}")
    return duration, streams


def _probe_media_duration(
    path: Path,
    ffprobe_path: str,
    *,
    env: dict[str, str] | None = None,
) -> float:
    """Read one media duration through the shared ffprobe executable."""
    try:
        result = subprocess.run(
            [ffprobe_path, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True,
            timeout=60,
            env=env if env is not None else _tool_env(ffprobe_path, ffprobe_path),
        )
        duration = float(result.stdout.strip())
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        raise VideoUseAdapterError("input-duration-probe-failed", f"输入媒体时长探针失败: {path.name}") from error
    if duration <= 0 or duration != duration or duration == float("inf"):
        raise VideoUseAdapterError("input-duration-invalid", f"输入媒体时长无效: {path.name}")
    return duration


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
    tool_env = env if env is not None else _tool_env(ffmpeg_path, ffprobe_path)
    source_duration = _probe_media_duration(source_path, ffprobe_path, env=tool_env)
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
    derived_duration = _probe_media_duration(derived_path, ffprobe_path, env=tool_env)
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
        source_duration_s = _probe_media_duration(source_path, ffprobe_path, env=env)
        audio_duration_s = _probe_media_duration(audio_path, ffprobe_path, env=env)
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


def execute_pinned_adapter(
    request: dict[str, Any],
    alignment: dict[str, Any],
    *,
    upstream_root: Path,
    ffmpeg_path: str,
    ffprobe_path: str,
    artifact_path: Path,
    now_ms: int,
) -> dict[str, Any]:
    _validate_alignment_identity(request, alignment)
    mode = str(request.get("mode") or "editable-edl")
    if mode not in {"editable-edl", "flat-shot-mp4"}:
        raise VideoUseAdapterError("mode-invalid", f"不支持的 video-use mode: {mode}")
    env = _tool_env(ffmpeg_path, ffprobe_path)
    edit_dir = artifact_path.parent / "video-use-edit"
    effective_request, derived_inputs = _prepare_derived_inputs(
        request,
        edit_dir=edit_dir,
        ffmpeg_path=ffmpeg_path,
        ffprobe_path=ffprobe_path,
        env=env,
        now_ms=now_ms,
    )
    edl, edl_path = build_edl_payload(effective_request, alignment, edit_dir)
    render_helper = upstream_root / "helpers" / "render.py"
    timeline_helper = upstream_root / "helpers" / "timeline_view.py"
    preview_path = edit_dir / "preview.mp4"
    # video-use's upstream renderer creates/keeps the source audio stream, but
    # it has no TTS/extra-audio mixing API.  MYStudio supplies the canonical
    # local WAV later to Remotion, so loudnorm here would only measure the
    # silent placeholder track and fail with -inf.  Keep the EDL/grade/subtitle
    # preview intact and disable only this unrelated upstream post-process.
    _run_helper(
        render_helper,
        [str(edl_path), "-o", str(preview_path), "--preview", "--build-subtitles", "--no-loudnorm"],
        cwd=upstream_root,
        env=env,
    )
    preview_duration, preview_streams = _probe_output(preview_path, ffprobe_path, env=env)
    _validate_rendered_output(
        preview_path,
        preview_duration,
        preview_streams,
        float(edl["total_duration_s"]),
        segment_count=len(edl["ranges"]),
    )

    flat_path: Path | None = None
    if mode == "flat-shot-mp4":
        flat_path = edit_dir / "clean-flat-shot.mp4"
        _run_helper(
            render_helper,
            [str(edl_path), "-o", str(flat_path), "--no-subtitles", "--no-loudnorm"],
            cwd=upstream_root,
            env=env,
        )
        flat_duration, flat_streams = _probe_output(flat_path, ffprobe_path, env=env)
        _validate_rendered_output(
            flat_path,
            flat_duration,
            flat_streams,
            float(edl["total_duration_s"]),
            segment_count=len(edl["ranges"]),
        )

    self_eval_dir = edit_dir / "self-eval"
    self_eval_dir.mkdir(parents=True, exist_ok=True)
    total_duration = float(edl["total_duration_s"])
    boundaries = [0.0]
    timeline = 0.0
    for item in edl["ranges"]:
        timeline += float(item["end"]) - float(item["start"])
        boundaries.append(timeline)
    sample_points = boundaries + [1.0, max(0.0, total_duration - 1.0), total_duration / 2.0]
    seen: set[tuple[float, float]] = set()
    evaluated = 0
    for point in sample_points:
        start = max(0.0, min(total_duration, point - 1.5))
        end = max(start + 0.1, min(total_duration, point + 1.5))
        if end > total_duration:
            start = max(0.0, end - min(1.5, total_duration))
        key = (round(start, 3), round(end, 3))
        if key in seen or end <= start:
            continue
        seen.add(key)
        evaluated += 1
        _run_helper(
            timeline_helper,
            [str(preview_path), f"{start:.3f}", f"{end:.3f}", "--n-frames", "5", "-o", str(self_eval_dir / f"sample-{evaluated:03d}.png")],
            cwd=upstream_root,
            env=env,
        )
    if evaluated == 0:
        raise VideoUseAdapterError("self-eval-empty", "self-eval 没有产生时间线探针")

    cues, subtitles = _build_alignment_artifacts(effective_request, alignment)
    input_sha = _require_sha(effective_request.get("sourceSha256"), "request.sourceSha256")
    audio_sha = _require_sha(effective_request.get("audioSha256"), "request.audioSha256")
    text_sha = _require_sha(effective_request.get("textSha256"), "request.textSha256")
    accepted_at = now_ms
    artifact: dict[str, Any] = {
        "schemaVersion": 1,
        "projectId": request.get("projectId"),
        "chapterId": request.get("chapterId"),
        "revision": request.get("revision"),
        "mode": mode,
        **({"storyboardSourcePolicy": request["storyboardSourcePolicy"]} if request.get("storyboardSourcePolicy") in {"current-ready", "reuse-existing"} else {}),
        # The worker has completed the mechanical edit, but a person has not
        # approved the preview yet.  The Electron review boundary upgrades
        # this same revision to ready/accepted and writes the review sidecar.
        "stage": "awaiting-review",
        "status": "pending",
        "timeUnit": "seconds",
        "timelineTimeUnit": "microseconds",
        "sourceSha256": input_sha,
        "audioSha256": audio_sha,
        "textSha256": text_sha,
        "alignment": cues,
        "edl": [
            {
                "shotId": item["source"],
                "sourcePath": edl["sources"][item["source"]],
                "sourceInS": float(item["start"]),
                "sourceOutS": float(item["end"]),
                "timelineStartS": sum(float(previous["end"]) - float(previous["start"]) for previous in edl["ranges"][:index]),
                "durationS": float(item["end"]) - float(item["start"]),
            }
            for index, item in enumerate(edl["ranges"])
        ],
        "subtitles": subtitles,
        "grade": {"filter": str(edl["grade"]), "parameters": {"preset": str(edl["grade"])}},
        "overlaySlots": [],
        "preview": {
            "path": str(preview_path),
            "sha256": sha256_file(preview_path),
            "subtitlesBurnedIn": True,
            "durationS": preview_duration,
        },
        "selfEval": {
            "passed": True,
            "score": 1.0,
            "notes": [f"timeline_view probes: {evaluated}", f"streams: {','.join(preview_streams)}"],
            "evaluatedAt": accepted_at,
        },
        **({"flatShotMp4Path": str(flat_path)} if flat_path else {}),
        **({"flatShotMp4Sha256": sha256_file(flat_path)} if flat_path else {}),
        "evidence": {
            "inputSha256": input_sha,
            "artifactSha256": "0" * 64,
            "toolVersion": f"video-use@{request.get('upstreamCommit') or 'pinned'}+mystudio-adapter-v1",
            "acceptedAt": accepted_at,
        },
        **({"derivedInputs": derived_inputs} if derived_inputs else {}),
    }
    digest_payload = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    artifact["evidence"]["artifactSha256"] = hashlib.sha256(digest_payload).hexdigest()
    return artifact


def run_pinned_adapter(
    request: dict[str, Any],
    alignment: dict[str, Any],
    *,
    upstream_root: Path,
    ffmpeg_path: str,
    ffprobe_path: str,
    artifact_path: Path,
    now_ms: int,
) -> dict[str, Any]:
    try:
        return execute_pinned_adapter(
            request,
            alignment,
            upstream_root=upstream_root,
            ffmpeg_path=ffmpeg_path,
            ffprobe_path=ffprobe_path,
            artifact_path=artifact_path,
            now_ms=now_ms,
        )
    except (VideoUseAdapterError, AlignmentError):
        raise
    except Exception as error:
        raise VideoUseAdapterError("adapter-failed", f"video-use adapter 失败: {error}") from error
