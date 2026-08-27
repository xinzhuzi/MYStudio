"""HyperFrames Registry AI 分类路由决策(08-21 Child3).

两层决策:
  1. AI 按镜头情绪选大类(transition/vfx/particle/caption/text-motion/camera/light/motion-gfx)
  2. 大类内选具体 hy:* 模板 + 参数

分类从 catalog.json 的 477 个 tag 归并为 8 类;blocks 标注 [FULL-FRAME](选中后
画面被完全替换,适合空镜/标题卡/转场),components 标注 [OVERLAY](叠加)。

与 adapter.py 的 43 个本地 CSS 模板池(mood 轮换)互补——本模块只在 AI
显式启用 registry 模板时被查询,不改变既有轮换行为。
"""

from __future__ import annotations

import json
import re

# 分类定义:tag 归并 → AI 可理解的大类
CATEGORY_TAG_MAP: dict[str, set[str]] = {
    "transition": {"transition", "transition-primitive", "transitions-dev-port", "wipe", "slide"},
    "vfx": {"vfx", "shader", "webgl", "portal", "shatter", "magnetic"},
    "particle": {"particle", "confetti", "fireflies", "dust", "sparkle", "bokeh", "star"},
    "caption": {"captions", "caption-style", "karaoke", "subtitle"},
    "text-motion": {"typography", "text", "text-effect", "kinetic", "typewriter", "scramble"},
    "camera": {"camera", "zoom", "parallax", "rack-focus", "shake", "dolly", "handheld"},
    "light": {"light", "glow", "flare", "lens", "vignette", "leak", "neon"},
    "motion-gfx": {"motion-primitive", "video-primitive", "chart", "graph", "grid", "flow", "ui-props", "mock-ui", "social"},
}

# 情绪→大类映射(与 adapter.py MOOD_TEMPLATE_RULES 风格一致)
MOOD_CATEGORY_MAP: dict[str, str] = {
    "战斗": "vfx", "打斗": "vfx", "爆发": "vfx", "碎裂": "vfx",
    "回忆": "light", "梦境": "light", "柔": "light", "温暖": "light",
    "雪": "particle", "雨": "particle", "花": "particle", "星": "particle",
    "转场": "transition", "切换": "transition", "过渡": "transition",
    "字幕": "caption", "歌词": "caption", "旁白": "caption",
    "科技": "motion-gfx", "数据": "motion-gfx", "图表": "motion-gfx",
    "运镜": "camera", "变焦": "camera", "震动": "camera",
    "文字": "text-motion", "打字": "text-motion", "弹出": "text-motion",
}

# 全画面类 tag(blocks 有背景色,会覆盖画面)
FULL_FRAME_TAGS = {"showcase", "background", "title-card", "lower-third", "terminal", "code"}

def _load_catalog() -> list[dict]:
    from .hyperframes_registry import catalog_path

    resolved = catalog_path()
    if resolved is None:
        return []
    return json.loads(resolved.read_text()).get("items", [])

_CATALOG = _load_catalog()

def categorize_template(item: dict) -> str:
    """将 registry item 按 tags 归入 8 大类之一(优先级:最先匹配的类)."""
    tags = set(item.get("tags", []))
    # 全画面检测
    for cat, cat_tags in CATEGORY_TAG_MAP.items():
        if tags & cat_tags:
            return cat
    return "motion-gfx"  # 兜底

def has_template(name: str) -> bool:
    """catalog 中是否存在该模板名(不含 hy: 前缀)。"""
    clean = name.removeprefix("hy:")
    return any(item.get("name") == clean for item in _load_catalog())


def is_full_frame(item: dict) -> bool:
    tags = set(item.get("tags", []))
    return bool(tags & FULL_FRAME_TAGS) or item.get("type") == "block"

def build_category_prompt(shot_mood: str | None) -> str:
    """构建 AI 选配 prompt(分类路由:先大类后模板)."""
    lines = ["你是视频特效指导,为镜头选择 HyperFrames Registry 特效模板。", ""]

    # 推荐大类
    if shot_mood:
        for keyword, cat in MOOD_CATEGORY_MAP.items():
            if keyword in shot_mood:
                lines.append(f"镜头情绪「{shot_mood}」→ 推荐大类: {cat}")
                break

    lines.append("")
    lines.append("可选大类: transition / vfx / particle / caption / text-motion / camera / light / motion-gfx")
    lines.append("")

    for cat in CATEGORY_TAG_MAP:
        items = [i for i in _CATALOG if categorize_template(i) == cat]
        if not items:
            continue
        lines.append(f"## {cat} ({len(items)} 个)")
        for item in items[:10]:  # 每类最多展示 10 个(prompt 控制)
            frame_tag = " [FULL-FRAME]" if is_full_frame(item) else " [OVERLAY]"
            desc = item.get("description", "")[:60]
            lines.append(f"  hy:{item['name']}{frame_tag} — {desc}")
        if len(items) > 10:
            lines.append(f"  ...另有 {len(items) - 10} 个同类模板")
        lines.append("")

    lines.append("输出格式:")
    lines.append('{"category": "大类", "template": "hy:模板名", "reason": "简述原因"}')
    lines.append("[FULL-FRAME] 模板会完全替换画面,适合空镜/标题卡/章节转场;[OVERLAY] 叠加在画面上。")
    return "\n".join(lines)

def get_templates_by_category(category: str) -> list[dict]:
    return [i for i in _CATALOG if categorize_template(i) == category]

def get_template_info(template_id: str) -> dict | None:
    name = template_id.replace("hy:", "", 1)
    for item in _CATALOG:
        if item["name"] == name:
            return item
    return None

def validate_registry_choice(template_id: str) -> bool:
    return get_template_info(template_id) is not None
