#!/usr/bin/env python3
"""Lint chapter-001 per-shot dialogue capacity (提案二「分镜表自检门」).

This tool never reads provider credentials, calls a generation endpoint, or
mutates the production storyboard store. It reads exactly one JSON document
(a bare shot array or an object with a ``shots`` array), computes each shot's
dialogue capacity, and prints an advisory JSON report. Over-capacity shots are
listed with remedy suggestions only — the lint never rewrites durations,
speeds, or dialogue text (机械翻倍/加快语速的禁止路径在自动逻辑中不可达).

数值真源(逐字镜像,不另立数值):
- 情绪语速表: apps/frontend/lib/studio/storyboard-table.ts:67-75 ``resolveSpeed``
  (文档口径: docs/workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md:136-140)
- 非说话开销缺省 1.0 秒: storyboard-table.ts:78-81 ``computeDurationSec``
  的 +1 秒固定余量(文档口径: WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md:144-146);
  允许逐镜经 ``nonspeechOverheadSec`` 覆写(听者反应镜/走位多的镜可加大)。

字数统计镜像真源 ``(text).length`` 的原样长度(含「角色名:」前缀的口径偏差
与正向公式同偏,双向自洽,记为已知边界)。
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

FAST_EMOTION_HINTS = ["愤怒", "激动", "急促", "亢奋", "暴怒", "嘶吼", "怒"]
SLOW_EMOTION_HINTS = ["悲伤", "绝望", "低语", "虚弱", "哽咽", "无力", "气若游丝", "垂死"]

DEFAULT_NONSPEECH_OVERHEAD_SEC = 1.0
MISSING_DURATION_REASON = "缺有效时长无法核容"
REMEDIES = ["按语义拆段跨镜", "延长镜头时长", "人工裁定删改"]


def resolve_rate(emotion: Any) -> int:
    """镜像 resolveSpeed(storyboard-table.ts:70-75):先判怒 4,再判悲 2,其余 3。"""
    text = emotion if isinstance(emotion, str) else ""
    if any(hint in text for hint in FAST_EMOTION_HINTS):
        return 4
    if any(hint in text for hint in SLOW_EMOTION_HINTS):
        return 2
    return 3


def resolve_overhead_sec(shot: dict[str, Any]) -> float:
    """非说话开销:缺省 1.0 秒;逐镜可经 nonspeechOverheadSec 覆写(非法值回缺省)。"""
    value = shot.get("nonspeechOverheadSec", DEFAULT_NONSPEECH_OVERHEAD_SEC)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
        return DEFAULT_NONSPEECH_OVERHEAD_SEC
    return float(value)


def dialogue_chars(shot: dict[str, Any]) -> int:
    """台词字数:镜像真源 ``(text).length`` 的原样长度;非字符串按空台词处理。"""
    lines = shot.get("lines")
    return len(lines) if isinstance(lines, str) else 0


def is_valid_duration(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float)) and value > 0


def lint_dialogue_capacity(shots: list[dict[str, Any]]) -> dict[str, Any]:
    """对分镜表跑台词容量自检门,返回只读报告(零改写输入)。

    每镜输入: {storyboardId, durationSec, lines, emotion, nonspeechOverheadSec?};
    计算链固定: 语速(怒4/平3/悲2) → 可用说话时间(durationSec-开销,缺省1s)
    → 容量字数 floor(可用×语速) → 台词字数超容量即违例。空台词镜记 skipped
    不查;durationSec 缺失或 ≤0 且有台词记「缺有效时长无法核容」违例。
    """
    report: dict[str, Any] = {
        "shots": 0,
        "checked": 0,
        "skipped": [],
        "violations": [],
    }
    for shot in shots:
        if not isinstance(shot, dict):
            continue
        report["shots"] += 1
        storyboard_id = shot.get("storyboardId")
        chars = dialogue_chars(shot)
        if chars == 0:
            report["skipped"].append({"storyboardId": storyboard_id, "reason": "空台词"})
            continue
        duration = shot.get("durationSec")
        if not is_valid_duration(duration):
            report["violations"].append({
                "storyboardId": storyboard_id,
                "kind": "missingDuration",
                "durationSec": duration,
                "overheadSec": None,
                "availableSec": None,
                "rate": None,
                "dialogueChars": chars,
                "capacityChars": None,
                "overflowChars": None,
                "reason": MISSING_DURATION_REASON,
                "remedies": list(REMEDIES),
            })
            continue
        report["checked"] += 1
        rate = resolve_rate(shot.get("emotion"))
        overhead_sec = resolve_overhead_sec(shot)
        available_sec = float(duration) - overhead_sec
        capacity_chars = math.floor(available_sec * rate)
        if chars > capacity_chars:
            report["violations"].append({
                "storyboardId": storyboard_id,
                "kind": "capacityOverflow",
                "durationSec": float(duration),
                "overheadSec": overhead_sec,
                "availableSec": available_sec,
                "rate": rate,
                "dialogueChars": chars,
                "capacityChars": capacity_chars,
                "overflowChars": chars - capacity_chars,
                "reason": None,
                "remedies": list(REMEDIES),
            })
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "分镜台词容量自检门(只读 lint):读 JSON 分镜表,超容量镜亮红并列出处理建议。"
        ),
    )
    parser.add_argument(
        "shots_json",
        type=Path,
        help="分镜 JSON 文件路径;根节点可为裸分镜数组或 {shots: [...]} 对象",
    )
    args = parser.parse_args(argv)
    document = json.loads(args.shots_json.read_text(encoding="utf-8"))
    shots = document.get("shots") if isinstance(document, dict) else document
    if not isinstance(shots, list):
        parser.error("JSON 根节点必须是分镜数组或 {shots: [...]} 对象")
    report = lint_dialogue_capacity(shots)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if report["violations"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
