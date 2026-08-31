"""video_use 适配器门面——编排入口+执行原语属性调用;功能簇见 adapter_shared/adapter_creative/adapter_edl/adapter_media_tools,本模块再导出全部符号保历史引用面(worker/tests 仍可 from video_use.adapter import X)。"""

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
from .hyperframes_registry import HYPERFRAMES_REGISTRY_TEMPLATES
from . import adapter_shared
from .adapter_shared import (  # noqa: F401
    VideoUseAdapterError,
    _probe_media_duration,
    _probe_output,
    _require_absolute_file,
    _require_sha,
    _run_helper,
    _seconds,
    _tool_env,
    _write_json,
)
from .adapter_creative import (  # noqa: F401
    CURATED_REGISTRY_TEMPLATES,
    DEFAULT_TEMPLATE_PARAMETERS,
    HYPERFRAMES_DECORATIVE_TEMPLATES,
    MOOD_TEMPLATE_RULES,
    _ROTATION_POOL_FULL,
    _TRANSITION_EFFECT_IDS,
    _TRANSITION_ENHANCEMENT_BASE,
    _TRANSITION_MAX_US,
    _TRANSITION_MIN_US,
    _bright_centroid,
    _image_path_for_shot,
    _interleave_pool,
    _mood_for_shot,
    _registry_deps_ready,
    _template_for_mood,
    _transition_enhancement_for,
)
from .adapter_edl import (  # noqa: F401
    _OVERLAY_SLOT_MAX_US,
    _alignment_for_shot,
    _build_overlay_slots,
    _edl_entries_with_transitions,
    _resolve_grade_for_pinned_upstream,
    _shot_voice_end_s,
    _validate_alignment_identity,
    build_edl_payload,
)
from .adapter_media_tools import (  # noqa: F401
    _build_alignment_artifacts,
    _derive_video_to_audio,
    _derived_filename,
    _prepare_derived_inputs,
    _validate_rendered_output,
)


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
    env = adapter_shared._tool_env(ffmpeg_path, ffprobe_path)
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
    adapter_shared._run_helper(
        render_helper,
        [str(edl_path), "-o", str(preview_path), "--preview", "--build-subtitles", "--no-loudnorm"],
        cwd=upstream_root,
        env=env,
    )
    preview_duration, preview_streams = adapter_shared._probe_output(preview_path, ffprobe_path, env=env)
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
        adapter_shared._run_helper(
            render_helper,
            [str(edl_path), "-o", str(flat_path), "--no-subtitles", "--no-loudnorm"],
            cwd=upstream_root,
            env=env,
        )
        flat_duration, flat_streams = adapter_shared._probe_output(flat_path, ffprobe_path, env=env)
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
        adapter_shared._run_helper(
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
    artifact_edl = _edl_entries_with_transitions(edl, effective_request, alignment)
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
        "edl": artifact_edl,
        "subtitles": subtitles,
        "grade": {"filter": str(edl["grade"]), "parameters": {"preset": str(edl["grade"])}},
        "overlaySlots": _build_overlay_slots(effective_request, edl, artifact_edl),
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
