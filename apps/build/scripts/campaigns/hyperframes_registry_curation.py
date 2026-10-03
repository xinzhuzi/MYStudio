#!/usr/bin/env python3
"""HY Registry 策展预筛器(08-22-video-use-vision-release R3 步骤一)。

从 catalog.json(370 模板)按 tag/名称做确定性排除与分级,产出「适合仙侠叙事
装饰/氛围」的候选清单(含草拟「情绪+场景语义」描述,喂法同 ATMOSPHERE_GUIDE)。

纪律:本脚本只做预筛——**候选不入闭集**;按 PRD AC3,入集须逐条渲染实证
(零 dev 向混入 + 每条有渲染样本帧),由后续批量渲染 + 人工/AI 视觉三审完成。

用法:
  python3 hyperframes_registry_curation.py --catalog <catalog.json> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

# 排除:开发者作品集/产品演示/终端/GitHub README 向(与叙事装饰无关,混入污染片质)
EXCLUDE_TAG_PATTERNS = (
    "code", "developer", "product-demo", "showcase", "transitions-dev-port",
    "portfolio", "github", "readme", "terminal", "dashboard", "mockup",
    "browser", "website", "landing", "docs", "documentation", "sdk", "api",
    "chart", "graph", "data-viz", "analytics", "form", "input", "button",
    "card", "pricing", "testimonial", "navbar", "hero", "footer", "link",
    "logo", "avatar", "skeleton", "loading", "spinner", "progress",
)
EXCLUDE_NAME_PATTERNS = (
    r"code|dev|terminal|console|browser|github|readme|logo|navbar|footer|"
    r"button|input|form|card|pricing|avatar|spinner|loader|progress|chart|"
    r"graph|dashboard|mockup|skeleton|typing|cursor|snippet|stack"
)
# 正向信号:叙事装饰/氛围相关 tag
POSITIVE_TAGS = {
    "overlay": 3, "transition": 2, "captions": 2, "reveal": 2, "shader": 2,
    "transition-primitive": 2, "video-primitive": 2, "motion-primitive": 1,
    "deterministic": 1,
}
POSITIVE_NAME_HINTS = {
    "particle": 3, "fog": 3, "mist": 3, "smoke": 3, "dust": 3, "glow": 3,
    "light": 2, "spark": 3, "ember": 3, "flame": 3, "fire": 3, "snow": 3,
    "rain": 3, "wind": 3, "cloud": 2, "star": 2, "moon": 2, "ink": 3,
    "paint": 2, "brush": 2, "water": 2, "wave": 2, "bloom": 2, "blur": 1,
    "fade": 1, "zoom": 1, "pan": 1, "shake": 1, "flash": 1, "glitch": 1,
    "shadow": 2, "beam": 3, "ray": 3, "flare": 3, "petal": 3, "leaf": 3,
    "ripple": 2, "drift": 2, "float": 2, "pulse": 1, "dissolve": 2,
}
# 仙侠叙事场景分类提示(名称关键词 → 场景语义草稿)
SCENE_HINTS = [
    (r"particle|dust|ember|spark", "战意/尘嚣/余烬——激烈交锋或战后残局"),
    (r"fog|mist|smoke|cloud", "梦境/幽谷/秘境——缥缈朦胧的过渡场"),
    (r"glow|light|beam|ray|flare|bloom", "灵光/法诀/顿悟——高光与神异时刻"),
    (r"snow|rain|wind|storm", "风雪/夜雨/荒途——肃杀孤旅的环境氛围"),
    (r"ink|paint|brush|water|ripple", "水墨/留白/意境——文戏与回忆段落"),
    (r"star|moon|night", "星夜/月下/遥思——抒情静场"),
    (r"petal|leaf|flower|blossom", "花雨/春信/柔情——温软情绪点缀"),
    (r"shake|glitch|flash|impact", "震爆/异变/心魔——冲突爆点强化"),
]


def classify(name: str) -> str | None:
    lowered = name.lower()
    for pattern, scene in SCENE_HINTS:
        if re.search(pattern, lowered):
            return scene
    return None


def score(item: dict) -> tuple[int, str | None, list[str]]:
    name = str(item.get("name") or "")
    tags = [str(tag).lower() for tag in item.get("tags", [])]
    excluded_by_tag = [tag for tag in tags if any(pat in tag for pat in EXCLUDE_TAG_PATTERNS)]
    excluded_by_name = re.search(EXCLUDE_NAME_PATTERNS, name.lower())
    if excluded_by_tag or excluded_by_name:
        return -1, (f"tag:{excluded_by_tag[0]}" if excluded_by_tag else f"name:{excluded_by_name.group(0)}"), tags
    total = sum(POSITIVE_TAGS.get(tag, 0) for tag in tags)
    total += sum(weight for hint, weight in POSITIVE_NAME_HINTS.items() if hint in name.lower())
    return total, None, tags


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--min-score", type=int, default=2)
    args = parser.parse_args()

    items = json.loads(Path(args.catalog).read_text(encoding="utf-8")).get("items", [])
    kept, excluded = [], []
    for item in items:
        total, exclusion, tags = score(item)
        if total < 0:
            excluded.append({"name": item.get("name"), "reason": exclusion})
            continue
        scene = classify(str(item.get("name") or ""))
        kept.append({
            "name": item.get("name"),
            "templateId": f"hy:{item.get('name')}",
            "score": total,
            "tags": tags,
            "kind": item.get("kind"),
            "sceneDraft": scene or "(待看渲染样本后补)",
        })
    kept.sort(key=lambda entry: (-entry["score"], str(entry["name"])))
    shortlist = [entry for entry in kept if entry["score"] >= args.min_score]

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "registry-curation-shortlist.json").write_text(
        json.dumps({
            "catalogTotal": len(items),
            "excluded": len(excluded),
            "shortlist": len(shortlist),
            "minScore": args.min_score,
            "entries": shortlist,
            "exclusionSample": excluded[:40],
            "nextStep": "批量渲染样本帧(hyperframes worker)→ 视觉三审 → 按 atmosphere-templates 模式带描述入闭集;未实证不入集(PRD AC3)",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    from collections import Counter
    print(f"总 {len(items)} → 排除 {len(excluded)} → 候选 {len(shortlist)}(score≥{args.min_score})")
    print("场景草稿覆盖:", sum(1 for e in shortlist if not e["sceneDraft"].startswith("(待")), "/", len(shortlist))
    print("前 12 候选:")
    for entry in shortlist[:12]:
        print(f"  {entry['score']:2d} {entry['templateId']} — {entry['sceneDraft'][:38]}")
    print(f"输出: {out_dir / 'registry-curation-shortlist.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
