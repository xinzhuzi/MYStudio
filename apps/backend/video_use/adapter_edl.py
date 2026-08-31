"""video_use EDL 组装簇——对齐解析/叠层槽位/转场排程/成片 EDL 载荷。"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from .alignment import sha256_file, sha256_text
from .adapter_shared import VideoUseAdapterError, _require_absolute_file, _require_sha, _seconds, _write_json
from .adapter_creative import _TRANSITION_EFFECT_IDS, _TRANSITION_MAX_US, _TRANSITION_MIN_US, _bright_centroid, _image_path_for_shot, _mood_for_shot, _registry_deps_ready, _template_for_mood, _transition_enhancement_for


def _alignment_for_shot(alignment: dict[str, Any], shot_id: str) -> dict[str, Any]:
    shots = alignment.get("shots")
    if not isinstance(shots, list):
        raise VideoUseAdapterError("alignment-invalid", "alignment artifact 缺少 shots")
    for shot in shots:
        if isinstance(shot, dict) and shot.get("shotId") == shot_id:
            return shot
    raise VideoUseAdapterError("alignment-shot-missing", f"alignment 缺少 shot: {shot_id}")
_OVERLAY_SLOT_MAX_US = 1_100_000
def _build_overlay_slots(
    request: dict[str, Any],
    edl: dict[str, Any],
    artifact_edl: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    # 08-22 接线:AI shot-fx 决策的逐镜 registry 提示(shots[].overlayTemplateId)——
    # 校验存在性与依赖就绪后优先采用;非法/未就绪回落 mood 路由(原行为)。
    overlay_hint_by_shot: dict[str, str] = {}
    if _registry_deps_ready():
        from .registry_decision import has_template

        for shot in request.get("shots") or []:
            if not isinstance(shot, dict):
                continue
            hint = str(shot.get("overlayTemplateId") or "")
            if hint and has_template(hint):
                overlay_hint_by_shot[str(shot["shotId"])] = hint.removeprefix("hy:")
    slots: list[dict[str, Any]] = []
    timeline_start_s = 0.0
    shifted_start_us_by_shot: dict[str, int] = {}
    transition_shift_us = 0
    for artifact_entry in artifact_edl or []:
        shot_id = str(artifact_entry.get("shotId") or "")
        if not shot_id:
            continue
        raw_start_us = round(float(artifact_entry.get("timelineStartS") or 0.0) * 1_000_000)
        shifted_start_us_by_shot[shot_id] = max(0, raw_start_us - transition_shift_us)
        transition = artifact_entry.get("transitionToNext")
        if isinstance(transition, dict) and str(transition.get("effectId") or "cut") != "cut":
            duration_us = transition.get("durationUs")
            if isinstance(duration_us, int) and not isinstance(duration_us, bool) and duration_us > 0:
                transition_shift_us += duration_us
    start_us_by_index: list[int] = []
    for entry in edl["ranges"]:
        shot_id = str(entry["source"])
        start_us_by_index.append(shifted_start_us_by_shot.get(shot_id, round(timeline_start_s * 1_000_000)))
        timeline_start_s += float(entry["end"]) - float(entry["start"])
    for index, entry in enumerate(edl["ranges"]):
        shot_id = str(entry["source"])
        mood_word = _mood_for_shot(request, shot_id)
        hint = overlay_hint_by_shot.get(shot_id)
        if hint:
            template_id, parameters = f"hy:{hint}", {}
        else:
            template_id, parameters = _template_for_mood(mood_word, index)
        # 内容感知定位：光效落位到画面最亮区域（质心），而非公式轮换位置。
        centroid = _bright_centroid(_image_path_for_shot(request, shot_id))
        # Keep deterministic per-shot variation while retaining mood/template
        # correlation. The worker remains the final fail-closed range checker.
        if template_id == "light-leak":
            parameters.setdefault("intensity", 0.5)
            parameters["hue"] = (index * 31) % 360
        elif template_id == "lens-flare":
            parameters["size"] = 360
            if centroid:
                parameters["x"], parameters["y"] = centroid
            else:
                parameters["x"] = 18 + ((index * 13) % 64)
                parameters["y"] = 24 + ((index * 7) % 34)
        elif template_id == "highlight-box":
            if centroid:
                parameters["x"], parameters["y"] = centroid
        start_us = start_us_by_index[index]
        duration_us = max(1, round((float(entry["end"]) - float(entry["start"])) * 1_000_000))
        # 装饰槽时长不得越过下一镜的压缩起点：转场重叠期两镜共存，越界会在重叠段
        # 叠加双份特效，也违反 artifact 校验的「时间必须单调且不可重叠」。
        next_start_us = start_us_by_index[index + 1] if index + 1 < len(start_us_by_index) else None
        if next_start_us is not None:
            duration_us = min(duration_us, max(1, next_start_us - start_us))
        duration_us = min(duration_us, _OVERLAY_SLOT_MAX_US)
        # 转场增强层：本镜出镜边界存在非 cut 转场时，增强窗占用出镜尾段
        # （转场窗后半），装饰窗相应让位——保持 artifact「时间单调不重叠」校验。
        enhancement_us = 0
        entry_transition = next(
            (t for t in (artifact_edl or [])
             if str(t.get("shotId") or "") == shot_id and isinstance(t.get("transitionToNext"), dict)
             and str(t["transitionToNext"].get("effectId") or "cut") != "cut"),
            None,
        )
        if entry_transition is not None and next_start_us is not None:
            t_dur_us = int(entry_transition["transitionToNext"].get("durationUs") or 0)
            enhancement = _transition_enhancement_for(str(entry_transition["transitionToNext"].get("effectId")))
            if t_dur_us > 0 and enhancement is not None:
                enhancement_us = min(t_dur_us, max(1, next_start_us - start_us - 1))
                enhancement_us = min(enhancement_us, _OVERLAY_SLOT_MAX_US)
                enhancement_template, enhancement_parameters = enhancement
                slots.append({
                    "slotId": f"transition-enh-{shot_id}",
                    "cueId": f"transition-enhancement-{index + 1}",
                    "startUs": next_start_us - enhancement_us,
                    "durationUs": enhancement_us,
                    "templateId": enhancement_template,
                    "parameters": enhancement_parameters,
                })
        duration_us = min(duration_us, max(1, (next_start_us - enhancement_us if next_start_us is not None else duration_us) - start_us) if next_start_us is not None else duration_us)
        slots.append({
            "slotId": f"effect-{shot_id}",
            "cueId": f"decorative-effect-{index + 1}",
            "startUs": start_us,
            "durationUs": duration_us,
            "templateId": template_id,
            "parameters": parameters,
            **({"moodWord": mood_word} if mood_word else {}),
        })
    # 增强窗与装饰窗统一按时间排序（artifact 校验要求时间单调不重叠）。
    slots.sort(key=lambda slot: slot["startUs"])
    return slots
def _shot_voice_end_s(alignment: dict[str, Any], shot_id: str) -> float | None:
    """该镜语音结束点，相对镜起点，单位秒；无对齐数据时返回 None。

    08-22 根修:取句级(aligned.sentences)末句结束——字幕 cue 与组合层语音挤压门
    同口径;词级末词会低估语音结束(句尾停顿被当静默尾,转场重叠越界必被门拦)。
    无句级数据时退词级(旧口径)。
    """
    try:
        aligned = _alignment_for_shot(alignment, shot_id)
    except VideoUseAdapterError:
        return None
    sentence_ends = [
        float(sentence["endS"])
        for sentence in aligned.get("sentences") or []
        if isinstance(sentence, dict) and sentence.get("endS") is not None
    ]
    if sentence_ends:
        return max(sentence_ends)
    ends = [
        float(word["endS"])
        for word in aligned.get("words") or []
        if isinstance(word, dict) and word.get("endS") is not None
    ]
    return max(ends) if ends else None
def _edl_entries_with_transitions(
    edl: dict[str, Any],
    request: dict[str, Any],
    alignment: dict[str, Any],
) -> list[dict[str, Any]]:
    """Build the artifact EDL and attach director-plan boundary decisions.

    Boundary intents arrive pre-mapped (style word → built-in effectId) from
    the TypeScript layer; this decision layer clamps each duration against
    both neighboring shots and the outgoing shot's voice tail, and fail-closes
    on unknown effect ids. Voice audio is baked into each shot MP4 from its
    head, so a transition overlap pulls the next shot's voice in early — the
    overlap may only consume the outgoing shot's silence after its voice ends
    (standard J-cut grammar), otherwise both voices collide inside the blend.
    Intents that cannot fit any silent tail degrade to implicit hard cuts.
    "cut" intents and unmatched boundaries stay implicit hard cuts.
    """
    entries: list[dict[str, Any]] = [
        {
            "shotId": item["source"],
            "sourcePath": edl["sources"][item["source"]],
            "sourceInS": float(item["start"]),
            "sourceOutS": float(item["end"]),
            "timelineStartS": sum(
                float(previous["end"]) - float(previous["start"]) for previous in edl["ranges"][:index]
            ),
            "durationS": float(item["end"]) - float(item["start"]),
        }
        for index, item in enumerate(edl["ranges"])
    ]
    intents = request.get("boundaryIntents")
    if not isinstance(intents, list) or not intents:
        return entries
    by_pair: dict[tuple[str, str], dict[str, Any]] = {}
    for intent in intents:
        if not isinstance(intent, dict):
            raise VideoUseAdapterError("boundary-intent-invalid", "boundaryIntent 必须是对象")
        effect_id = str(intent.get("effectId") or "")
        if effect_id not in _TRANSITION_EFFECT_IDS:
            raise VideoUseAdapterError(
                "boundary-intent-effect-unknown", f"未知转场类型: {effect_id or '(空)'}"
            )
        from_shot = str(intent.get("fromShotId") or "")
        to_shot = str(intent.get("toShotId") or "")
        if not from_shot or not to_shot:
            raise VideoUseAdapterError("boundary-intent-invalid", "boundaryIntent 缺少 fromShotId/toShotId")
        by_pair[(from_shot, to_shot)] = intent
    for index, entry in enumerate(entries):
        following = entries[index + 1] if index + 1 < len(entries) else None
        if following is None:
            continue
        intent = by_pair.get((str(entry["shotId"]), str(following["shotId"])))
        if intent is None or str(intent["effectId"]) == "cut":
            continue
        requested = intent.get("durationUs")
        if not isinstance(requested, int) or isinstance(requested, bool) or requested <= 0:
            raise VideoUseAdapterError("boundary-intent-invalid", "boundaryIntent durationUs 必须为正整数微秒")
        voice_end_s = _shot_voice_end_s(alignment, str(entry["shotId"]))
        if voice_end_s is None or voice_end_s <= float(entry["sourceInS"]):
            # 无对齐数据时按 fail-closed 处理：假定语音顶满整镜，不给溶镜留预算。
            tail_us = 0
        else:
            tail_us = int((float(entry["sourceOutS"]) - voice_end_s) * 1_000_000)
        if tail_us < _TRANSITION_MIN_US:
            continue
        ceiling = min(
            _TRANSITION_MAX_US,
            int(float(entry["durationS"]) * 1_000_000) // 2,
            int(float(following["durationS"]) * 1_000_000) // 2,
            tail_us,
        )
        duration = min(max(requested, _TRANSITION_MIN_US), max(_TRANSITION_MIN_US, ceiling))
        transition: dict[str, Any] = {"effectId": str(intent["effectId"]), "durationUs": duration}
        if intent.get("styleWord"):
            transition["styleWord"] = str(intent["styleWord"])
        entry["transitionToNext"] = transition
    return entries
def _validate_alignment_identity(request: dict[str, Any], alignment: dict[str, Any]) -> None:
    if alignment.get("schemaVersion") != 1 or alignment.get("status") != "ready":
        raise VideoUseAdapterError("alignment-not-ready", "alignment artifact 必须是 schema 1/ready")
    for key in ("projectId", "chapterId", "revision"):
        if alignment.get(key) != request.get(key):
            raise VideoUseAdapterError("alignment-identity-mismatch", f"alignment {key} 与当前章节不一致")
    if not isinstance(alignment.get("shots"), list) or not alignment["shots"]:
        raise VideoUseAdapterError("alignment-invalid", "alignment artifact 缺少 shots")
def _resolve_grade_for_pinned_upstream(value: Any) -> str:
    """Resolve the adapter grade without invoking the pinned auto analyzer.

    The pinned helper's auto analyzer cannot normalize Remotion's full-range
    ``yuvj420p`` output because FFmpeg may report ``YBITDEPTH=0``.  Keep the
    adapter deterministic and safe by using the helper's explicit subtle
    preset whenever the request leaves grading at its default or asks for
    ``auto``.  Explicit presets/raw filters remain unchanged.
    """
    grade = value if isinstance(value, str) and value else "auto"
    return "subtle" if grade == "auto" else grade
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

    grade = _resolve_grade_for_pinned_upstream(request.get("grade"))
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
