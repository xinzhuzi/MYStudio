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


# gl:* = gl-transitions 收录白名单镜像（TS 权威: composition/gl-transition-registry.ts,
# 孪生对拍: composition/transition-enum-sync.test.ts——扩条目三处必须同步）。
# gl:* = gl-transitions 收录白名单镜像（TS 权威: composition/gl-transition-registry.ts
# + gl-transition-shaders.generated.ts,孪生对拍: composition/transition-enum-sync.test.ts——扩条目三处必须同步）。
_TRANSITION_EFFECT_IDS = {
    "cut", "fade", "crossfade", "flash", "blackout", "impact-frame", "ink-bleed",
    "gl:AdvancedMosaic",
    "gl:BlockDissolve",
    "gl:BookFlip",
    "gl:Bounce",
    "gl:BowTieHorizontal",
    "gl:BowTieVertical",
    "gl:BowTieWithParameter",
    "gl:Box",
    "gl:ButterflyWaveScrawler",
    "gl:CircleCrop",
    "gl:ColourDistance",
    "gl:CrazyParametricFun",
    "gl:CrossZoom",
    "gl:DefocusBlur",
    "gl:Directional",
    "gl:DirectionalScaled",
    "gl:DoomScreenTransition",
    "gl:Dreamy",
    "gl:DreamyZoom",
    "gl:Drop_Zone_Flicker",
    "gl:EdgeTransition",
    "gl:FilmBurn",
    "gl:Fold",
    "gl:GlitchDisplace",
    "gl:GlitchMemories",
    "gl:GridFlip",
    "gl:HSVfade",
    "gl:HorizontalClose",
    "gl:HorizontalOpen",
    "gl:InvertedPageCurl",
    "gl:LeftRight",
    "gl:LinearBlur",
    "gl:Mosaic",
    "gl:Overexposure",
    "gl:PolkaDotsCurtain",
    "gl:PuzzleRight",
    "gl:Radial",
    "gl:Rectangle",
    "gl:RectangleCrop",
    "gl:Revolve_Left",
    "gl:Rolls",
    "gl:RotateScaleVanish",
    "gl:SimpleFlip",
    "gl:SimpleZoom",
    "gl:SimpleZoomOut",
    "gl:Slides",
    "gl:StarWipe",
    "gl:StaticFade",
    "gl:StereoViewer",
    "gl:StripDatamoshGlitch",
    "gl:Swirl",
    "gl:TVStatic",
    "gl:TilesWave",
    "gl:TopBottom",
    "gl:VerticalClose",
    "gl:VerticalOpen",
    "gl:WaterDrop",
    "gl:ZoomInCircles",
    "gl:ZoomLeftWipe",
    "gl:ZoomRigthWipe",
    "gl:angular",
    "gl:burn",
    "gl:burn0",
    "gl:cannabisleaf",
    "gl:chessboard",
    "gl:circle",
    "gl:circleopen",
    "gl:colorphase",
    "gl:coord-from-in",
    "gl:crosshatch",
    "gl:crosswarp",
    "gl:cube",
    "gl:directional-easing",
    "gl:directionalwarp",
    "gl:directionalwipe",
    "gl:dissolve",
    "gl:doorway",
    "fade",
    "gl:fadecolor",
    "gl:fadegrayscale",
    "gl:flyeye",
    "gl:fragment",
    "gl:heart",
    "gl:hexagonalize",
    "gl:kaleidoscope",
    "gl:luminance_melt",
    "gl:morph",
    "gl:mosaic_transition",
    "gl:multiply_blend",
    "gl:old_tv_lost_signal",
    "gl:parametric_glitch",
    "gl:perlin",
    "gl:pinwheel",
    "gl:pixelize",
    "gl:polar_function",
    "gl:powerKaleido",
    "gl:randomNoisex",
    "gl:randomsquares",
    "gl:ripple",
    "gl:rotateTransition",
    "gl:rotate_scale_fade",
    "gl:scale-in",
    "gl:splitSlideInHorizontal",
    "gl:splitSlideInOutHorizontal",
    "gl:splitSlideInOutVertical",
    "gl:splitSlideInVertical",
    "gl:splitSlideOutHorizontal",
    "gl:splitSlideOutVertical",
    "gl:squareswire",
    "gl:squeeze",
    "gl:static_wipe",
    "gl:swap",
    "gl:tangentMotionBlur",
    "gl:undulatingBurnOut",
    "gl:wind",
    "gl:windowblinds",
    "gl:windowslice",
    "gl:wipeDown",
    "gl:wipeLeft",
    "gl:wipeRight",
    "gl:wipeUp",
    "gl:x_axis_translation",
    "gl:zoomInOut",
    "gl:IrisWipe",
    "gl:fade",
}
_TRANSITION_MIN_US = 200_000
_TRANSITION_MAX_US = 1_200_000
# 与 run-full-pipeline legacy 装饰窗的 1.1s 钳制保持同一装饰语义。
_OVERLAY_SLOT_MAX_US = 1_100_000

# Single source for the video-use → HyperFrames decorative decision. Keep the
# values primitive because they cross the JSON artifact boundary unchanged.
# 08-18-hy-effects Phase 1：本地自写装饰模板（worker 内 HTML/CSS）加入轮询池——
# 与 TS 契约 HYPERFRAMES_DECORATIVE_TEMPLATE_IDS 同步（worker 白名单为渲染侧闭集）。
HYPERFRAMES_DECORATIVE_TEMPLATES = (
    "light-leak", "film-grain", "lens-flare", "vignette-pulse",
    "particle-dust", "letterbox-cinematic", "highlight-box",
    "ink-bloom", "mist-drift", "gold-flecks", "brush-sweep", "paper-breath",
    "candle-flicker", "moon-glow", "rain-streaks", "snow-drift", "aura-pulse",
    "sword-flash", "seal-glow", "dust-motes",
    "speed-lines", "shockwave-ring", "breathing-light",
)
MOOD_TEMPLATE_RULES: dict[str, tuple[str, dict[str, str | int | float | bool]]] = {
    "战斗": ("lens-flare", {"x": 18, "y": 24, "size": 260}),
    "回忆": ("light-leak", {"intensity": 0.35, "hue": 0}),
    "天道": ("highlight-box", {"x": 50, "y": 50, "color": "#f4d06f"}),
    "阴谋": ("vignette-pulse", {"darkness": 0.4, "speed": 1.8}),
    "日常": ("film-grain", {"opacity": 0.1}),
    "承接": ("letterbox-cinematic", {"barHeight": 8, "fadeIn": 0.25}),
    # 08-18-hy-effects：新 mood 语义映射到本地自写模板。
    "梦境": ("mist-drift", {"opacity": 0.3, "speed": 16}),
    "雪": ("snow-drift", {"count": 12, "speed": 8}),
    "雨": ("rain-streaks", {"count": 12, "speed": 1.0}),
    "剑": ("sword-flash", {"angle": 24}),
    "灵": ("aura-pulse", {"intensity": 0.4, "speed": 2.0}),
    "夜": ("moon-glow", {"x": 24, "y": 20, "size": 300}),
}
DEFAULT_TEMPLATE_PARAMETERS: dict[str, dict[str, str | int | float | bool]] = {
    "light-leak": {"intensity": 0.42, "hue": 0},
    "film-grain": {"opacity": 0.2},
    "lens-flare": {"x": 18, "y": 24, "size": 260},
    "vignette-pulse": {"darkness": 0.42, "speed": 2.4},
    "particle-dust": {"count": 40, "speed": 7},
    "letterbox-cinematic": {"barHeight": 12, "fadeIn": 0.25},
    "highlight-box": {"x": 50, "y": 50, "color": "#f4d06f"},
    "ink-bloom": {"intensity": 0.5, "x": 50, "y": 45},
    "mist-drift": {"opacity": 0.25, "speed": 14},
    "gold-flecks": {"count": 8, "intensity": 0.5},
    "brush-sweep": {"hue": 210, "speed": 3},
    "paper-breath": {"warmth": 0.15, "speed": 6},
    "candle-flicker": {"intensity": 0.4, "x": 70, "y": 65},
    "moon-glow": {"x": 24, "y": 22, "size": 260},
    "rain-streaks": {"count": 10, "speed": 1.2},
    "snow-drift": {"count": 10, "speed": 9},
    "aura-pulse": {"intensity": 0.35, "speed": 2.5},
    "sword-flash": {"angle": 24},
    # 08-18-hy-effects Phase 1 三模板漏补(08-20 修):轮换池有而本表无 →
    # _template_for_mood 轮换落到这三槽 KeyError,整条 ChapterVideo 链被卡死。
    # 缺省值与 hyperframes-worker.ts numberParameter 缺省逐项一致。
    "speed-lines": {"intensity": 0.5, "direction": 0},
    "shockwave-ring": {"intensity": 0.6, "speed": 1.5},
    "breathing-light": {"intensity": 0.35, "speed": 3, "hue": 45},
    "seal-glow": {"intensity": 0.3},
    "dust-motes": {"count": 12, "speed": 18},
}

# 完备性断言(fail-closed,08-20 修):轮换池模板必须都有默认参数,缺键=轮换
# 落到该槽时 KeyError 卡死整条章节链(前科:speed-lines/shockwave-ring/breathing-light)。
assert set(HYPERFRAMES_DECORATIVE_TEMPLATES) <= set(DEFAULT_TEMPLATE_PARAMETERS), (
    "HYPERFRAMES_DECORATIVE_TEMPLATES 轮换池模板缺 DEFAULT_TEMPLATE_PARAMETERS 条目: "
    + str(sorted(set(HYPERFRAMES_DECORATIVE_TEMPLATES) - set(DEFAULT_TEMPLATE_PARAMETERS)))
)



# 08-18-hy-effects Phase 3：转场增强层（hy: overlay 增强）——每个非 cut 边界在
# 出镜尾段（转场窗后半）叠一个对应风格的 HY overlay 窗，叠在 Remotion 转场上方
# 作视觉增强；不接管时序、不参与 overlapFrames 预算（语音安全门禁不受影响）。
_TRANSITION_ENHANCEMENT_BASE: dict[str, tuple[str, dict[str, str | int | float | bool]]] = {
    "crossfade": ("mist-drift", {"opacity": 0.22, "speed": 12}),
    "fade": ("paper-breath", {"warmth": 0.12, "speed": 5}),
    "flash": ("sword-flash", {"angle": 24}),
    "blackout": ("seal-glow", {"intensity": 0.25}),
    "ink-bleed": ("ink-bloom", {"intensity": 0.5, "x": 50, "y": 46}),
}


def _transition_enhancement_for(effect_id: str) -> tuple[str, dict[str, str | int | float | bool]] | None:
    """风格→增强模板映射（≥4 基线 + gl: 名字分桶 ≥4）。未知 id 返回 None（不增强）。"""
    if effect_id in _TRANSITION_ENHANCEMENT_BASE:
        return _TRANSITION_ENHANCEMENT_BASE[effect_id]
    if effect_id.startswith("gl:"):
        name = effect_id[3:].lower()
        if any(k in name for k in ("zoom", "scale", "push", "slide", "wipe", "directional", "leftright", "radial")):
            return ("brush-sweep", {"hue": 210, "speed": 2})
        if any(k in name for k in ("dissolve", "melt", "wave", "swap", "fade", "pixel", "butterfly", "mosaic", "polka")):
            return ("ink-bloom", {"intensity": 0.45, "x": 50, "y": 45})
        if any(k in name for k in ("glitch", "morph", "burn", "dreamy", "cross")):
            return ("aura-pulse", {"intensity": 0.4, "speed": 2})
        return ("dust-motes", {"count": 12, "speed": 14})
    return None


def _mood_for_shot(request: dict[str, Any], shot_id: str) -> str | None:
    """Resolve the child1 boundary mood for a shot without inventing one."""
    intents = request.get("boundaryIntents")
    if not isinstance(intents, list):
        return None
    for intent in intents:
        if not isinstance(intent, dict) or not intent.get("moodWord"):
            continue
        if str(intent.get("fromShotId") or "") == shot_id:
            return str(intent["moodWord"])
    for intent in intents:
        if isinstance(intent, dict) and str(intent.get("toShotId") or "") == shot_id and intent.get("moodWord"):
            return str(intent["moodWord"])
    return None


def _template_for_mood(mood_word: str | None, index: int) -> tuple[str, dict[str, str | int | float | bool]]:
    if mood_word:
        for key, decision in MOOD_TEMPLATE_RULES.items():
            if key in mood_word:
                template, base = decision
                return template, dict(base)
    print(f"[video-use] overlay mood missing/unmatched; fallback rotation index={index}", file=sys.stderr)
    template = HYPERFRAMES_DECORATIVE_TEMPLATES[index % len(HYPERFRAMES_DECORATIVE_TEMPLATES)]
    return template, dict(DEFAULT_TEMPLATE_PARAMETERS[template])


def _image_path_for_shot(request: dict[str, Any], shot_id: str) -> str | None:
    shots = request.get("shots")
    if isinstance(shots, list):
        for shot in shots:
            if isinstance(shot, dict) and str(shot.get("shotId") or "") == shot_id:
                path_value = shot.get("imagePath")
                return str(path_value) if isinstance(path_value, str) and path_value else None
    return None


def _bright_centroid(image_path: str | None) -> tuple[int, int] | None:
    """画面最亮区域的亮度加权质心（百分比坐标）。

    光效（lens-flare/highlight-box）应落位到画面的光源/主体高亮处，
    而非公式轮换位置。取亮度前 20% 像素的加权质心，缩到 64x36 网格
    保证确定性且开销恒定；任何失败回退 None（调用方走公式）。
    """
    if not image_path:
        return None
    try:
        from PIL import Image  # 应用 venv 自带；缺库时回退公式定位
        with Image.open(image_path) as handle:
            im = handle.convert("L").resize((64, 36))
        px = list(im.getdata())
        ordered = sorted(px)
        threshold = ordered[int(len(ordered) * 0.8)]
        total = 0
        sum_x = 0
        sum_y = 0
        for i, value in enumerate(px):
            if value >= threshold:
                weight = value - threshold + 1
                sum_x += (i % 64) * weight
                sum_y += (i // 64) * weight
                total += weight
        if total <= 0:
            return None
        x_pct = round(sum_x / total / 63 * 100)
        y_pct = round(sum_y / total / 35 * 100)
        return max(5, min(95, x_pct)), max(8, min(92, y_pct))
    except Exception:
        return None


def _build_overlay_slots(
    request: dict[str, Any],
    edl: dict[str, Any],
    artifact_edl: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
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
    """该镜语音（对齐词级时间）结束点，相对镜起点，单位秒；无对齐数据时返回 None。"""
    try:
        aligned = _alignment_for_shot(alignment, shot_id)
    except VideoUseAdapterError:
        return None
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
