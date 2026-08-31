"""video_use 创意决策簇——模板池/情绪/转场增强/图像定位/亮心计算。"""

from __future__ import annotations

import os
import sys
from typing import Any


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
HYPERFRAMES_DECORATIVE_TEMPLATES = (
    "light-leak", "film-grain", "lens-flare", "vignette-pulse",
    "particle-dust", "letterbox-cinematic", "highlight-box",
    "ink-bloom", "mist-drift", "gold-flecks", "brush-sweep", "paper-breath",
    "candle-flicker", "moon-glow", "rain-streaks", "snow-drift", "aura-pulse",
    "sword-flash", "seal-glow", "dust-motes",
    "speed-lines", "shockwave-ring", "breathing-light",
    # 08-21 剪映风格特效扩容(20 新模板,3 类:故障/光效粒子/动态)
    "glitch-rgb", "glitch-slice", "glitch-scanline", "vhs-rewind", "pixel-blur",
    "strobe-flash", "neon-glow", "bokeh-lights", "star-twinkle", "confetti-burst",
    "heart-float", "bubble-rise", "zoom-pulse", "shake-earthquake", "wobble-jelly",
    "spin-hypnotic", "ripple-water", "fade-dip-black", "flash-white", "dream-soft",
)
CURATED_REGISTRY_TEMPLATES = (
    "hy:ripple-waves", "hy:ink-bleed-reveal", "hy:light-sweep-pass",
    "hy:organic-light-leak-overlay", "hy:particle-image-reveal",
    "hy:domain-warp-dissolve", "hy:grain-overlay", "hy:light-leak", "hy:glitch",
    "hy:halftone-dissolve", "hy:yt-feather-highlight", "hy:chromatic-aberration-wipe",
    "hy:cross-warp-morph", "hy:fade-through", "hy:grain-field", "hy:sdf-iris",
    "hy:soft-blur-in", "hy:ascii-trail-reveal", "hy:aurora-drift", "hy:blur-in",
    "hy:inline-highlight", "hy:directional-wipe", "hy:echo-trail", "hy:facet-morph",
    "hy:grid-pixelate-wipe", "hy:halftone-field", "hy:iris-reveal", "hy:slit-scan-reveal",
)
def _interleave_pool() -> tuple[str, ...]:
    pool: list[str] = []
    li = ci = 0
    local = list(HYPERFRAMES_DECORATIVE_TEMPLATES)
    curated = list(CURATED_REGISTRY_TEMPLATES)
    while li < len(local) or ci < len(curated):
        for _ in range(2):
            if li < len(local):
                pool.append(local[li]); li += 1
        if ci < len(curated):
            pool.append(curated[ci]); ci += 1
    return tuple(pool)
_ROTATION_POOL_FULL = _interleave_pool()
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
    # 08-21 剪映风格扩容(20 新):缺省值与 hyperframes-worker.ts numberParameter 一致。
    "glitch-rgb": {"intensity": 0.6, "speed": 3},
    "glitch-slice": {"intensity": 0.5, "slices": 6},
    "glitch-scanline": {"intensity": 0.4, "speed": 8},
    "vhs-rewind": {"intensity": 0.5, "hue": 280},
    "pixel-blur": {"intensity": 0.5, "size": 12},
    "strobe-flash": {"speed": 4, "color": 60},
    "neon-glow": {"hue": 190, "intensity": 0.7},
    "bokeh-lights": {"count": 12, "hue": 40, "speed": 5},
    "star-twinkle": {"count": 15, "speed": 2},
    "confetti-burst": {"count": 20, "speed": 3},
    "heart-float": {"count": 8, "speed": 4},
    "bubble-rise": {"count": 10, "speed": 6},
    "zoom-pulse": {"intensity": 0.06, "speed": 2},
    "shake-earthquake": {"intensity": 8, "speed": 10},
    "wobble-jelly": {"intensity": 0.02, "speed": 3},
    "spin-hypnotic": {"speed": 8, "size": 300},
    "ripple-water": {"x": 50, "y": 50, "speed": 2},
    "fade-dip-black": {"hold": 0.3},
    "flash-white": {"hold": 0.15},
    "dream-soft": {"blur": 6, "glow": 0.4},
    # 08-22 Registry 策展 28 条:参数留空(默认值在 registry HTML 内,worker 物化)
    **{template: {} for template in CURATED_REGISTRY_TEMPLATES},
}
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
def _registry_deps_ready() -> bool:
    """hy: 模板依赖是否已下载(Electron 侧维护 <deps>/.ready 标记)。

    未接线(无 env)或未就绪时返回 False——_template_for_mood 回退本地 43 池,
    避免 AI/决策层推了 hy: 模板却在渲染时被降级丢弃。
    """
    deps_dir = os.environ.get("MYSTUDIO_REGISTRY_DEPS_DIR", "").strip()
    if not deps_dir:
        return False
    return os.path.isfile(os.path.join(deps_dir, ".ready"))
def _template_for_mood(mood_word: str | None, index: int) -> tuple[str, dict[str, str | int | float | bool]]:
    # 08-21 hy-registry: 优先查 registry_decision 的情绪→大类→推荐模板
    # 08-22 门控修:依赖未就绪只跳过 registry 推荐,本地 mood 表必须照常生效——
    # 原实现把本地表一并收进门控 if 内,deps 未就绪时 mood 命中也掉轮换
    # (存量红测 test_overlay_slots_follow_mood_rules 的根因)。
    # 08-22 深审补:轮换池同样过 deps 门控——未就绪退本地 43 池,避免决策层推
    # hy: 却在渲染端被降级丢窗(_registry_deps_ready docstring 的设计意图)。
    if mood_word:
        if _registry_deps_ready():
            from .registry_decision import MOOD_CATEGORY_MAP, get_templates_by_category, is_full_frame
            for keyword, category in MOOD_CATEGORY_MAP.items():
                if keyword in mood_word:
                    # 从该大类找 overlay 兼容的(非全画面)
                    candidates = [t for t in get_templates_by_category(category) if not is_full_frame(t)]
                    if candidates:
                        chosen = candidates[index % len(candidates)]
                        return f"hy:{chosen['name']}", {}
        # 本地 mood 表(恒生效;hy: 轮换池 08-22 扩到 71 见 CURATED_REGISTRY_TEMPLATES)
        for key, decision in MOOD_TEMPLATE_RULES.items():
            if key in mood_word:
                template, base = decision
                return template, dict(base)
    print(f"[video-use] overlay mood missing/unmatched; fallback rotation index={index}", file=sys.stderr)
    rotation_pool = _ROTATION_POOL_FULL if _registry_deps_ready() else HYPERFRAMES_DECORATIVE_TEMPLATES
    template = rotation_pool[index % len(rotation_pool)]
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
