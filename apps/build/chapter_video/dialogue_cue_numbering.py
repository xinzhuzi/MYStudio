#!/usr/bin/env python3
"""Dialogue cue numbering for chapter-001(§五台词分段编号,P4 python 可达部分).

编号即契约(字幕 cue 侧共用键,§七P4「三处取值一致」中的分镜表/TTS 两处由本
工具落 python 侧,字幕 cue 侧按同一格式接入):
    ``S{镜号}-D{台词序}{段序}``  如 ``S07-D2a``/``S07-D2b``
    - 镜号两位零填充(≥100 自然三位):S07=第 7 镜;
    - 台词序:镜内台词单元 1 起密集编号(单元=真实 store 既有 ``<br>`` 分隔约定,
      与 ``lines``/``line``/``ttsSpokenText`` 同源,不另造输入格式);
    - 段序:小写字母 a/b/c…,未拆段的单元恒为单段 a;跨镜跨切形态(同一 D 的
      b/c 段落在后镜,§五示例 S07-D1b 属 SH08)属人工排镜层指派——编号格式
      接受该形态,自动拆分不做语义判断。

拆段依据(§五原文=标点/换气/语义转折)只落**机检可判子集**:
    - 超长单元(> max-segment-chars,缺省 30)先按句末标点(。！？!?…)拆段;
    - 拆后仍超长的段再按换气/停顿符(，、；：,;:)拆;
    - 无停顿符的超长段**不硬切**(防断词),整段保留;语义转折不建模(人工层)。
    阈值属台词容量口径(提案二),可经参数/CLI 调整,本工具不锁数值。

对账(P4 验收 python 可达部分)=分镜 store 台词(``line`` 优先,缺则 ``lines``
剥主说话人前缀)与 TTS 绑定(``ttsSpokenText`` 链,build_chapter001_workflow.py
:2934-2970 build_storyboard_voiceover 产链)按编号对账:
    - 同段编号两处取值一致(经 normalize_tts_spoken_text 同规归一后比较,
      build_chapter001_workflow.py:2930 先例);
    - 缺段(missing-in-tts / missing-in-dialogue)、重段(duplicate)、
      跳段(non-contiguous:段序 a→c 缺 b、台词序 1→3 缺 2)均可检出。
编号生成复用 ``source_dialogue_units`` 先例(build_chapter001_workflow.py:2507,
只读 import)。

本工具只读不写:永不修改生产 store、不读 provider 凭据、不调用网络;对账报告
以 JSON 打印(advisory,同 lint_chapter001_dialogue_capacity 形态)。

依据:docs/comfyui-kb/跨镜连续性规范.md §五(:121-137)+§七P4(:183-187)。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
try:
    from apps.build.chapter_video.build_chapter001_workflow import (
        normalize_tts_spoken_text,
        source_dialogue_units,
    )
    from apps.build.chapter_video.path_resolver import resolve_project_dir
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from build_chapter001_workflow import (
        normalize_tts_spoken_text,
        source_dialogue_units,
    )
    from path_resolver import resolve_project_dir


CUE_ID_PATTERN = r"S\d{2,}-D\d+[a-z]"
CUE_ID_RE = re.compile(CUE_ID_PATTERN)
CUE_ID_PARSE_RE = re.compile(r"^S(\d{2,})-D(\d+)([a-z])$")

DEFAULT_MAX_SEGMENT_CHARS = 30
SENTENCE_END_CHARS = "。！？!?…"
CLOSING_CHARS = "」』”’)】"
BREATH_CHARS = "，、；：,;:"
UNIT_SEPARATOR_RE = re.compile(r"<br\s*/?>", re.IGNORECASE)
PRIMARY_SPEAKER_PREFIX_RE = re.compile(r"^[^：:<>\n]{1,12}[：:]\s*")

SIDES = ("dialogue", "tts")


def segment_letter(index: int) -> str:
    """段序字母 a..z(§五示例小写);单镜单元超过 26 段属异常输入,显式报错。"""
    if index < 1 or index > 26:
        raise RuntimeError(f"段序超出 a-z 范围: {index}(单元过长或停顿符异常)")
    return chr(ord("a") + index - 1)


def split_dialogue_units(text: Any) -> list[str]:
    """台词单元=store 既有 ``<br>`` 分隔约定;空单元丢弃(不占台词序)。"""
    raw = str(text or "")
    return [unit.strip() for unit in UNIT_SEPARATOR_RE.split(raw) if unit.strip()]


def strip_primary_speaker_prefix(text: str) -> str:
    """剥 ``lines`` 字段的主说话人前缀(「名：」);镜内换人前缀(单元内)保留。"""
    return PRIMARY_SPEAKER_PREFIX_RE.sub("", text, count=1)


def _split_after_runs(part: str, cut_chars: str) -> list[str]:
    """在 cut_chars 字符(含连续run与后随收尾引号)之后切分,切分符留在左段。"""
    pieces: list[str] = []
    start = 0
    index = 0
    while index < len(part):
        char = part[index]
        if char in cut_chars:
            end = index + 1
            while end < len(part) and (
                part[end] in cut_chars or part[end] in CLOSING_CHARS
            ):
                end += 1
            pieces.append(part[start:end])
            start = end
            index = end
        else:
            index += 1
    if start < len(part):
        pieces.append(part[start:])
    return pieces


def split_overlong_unit(unit: str, max_segment_chars: int) -> list[str]:
    """超长单元拆段(机检子集):句末标点优先,仍超长按换气符;无停顿不硬切。"""
    text = unit.strip()
    if len(text) <= max_segment_chars:
        return [text]
    segments: list[str] = []
    for sentence in _split_after_runs(text, SENTENCE_END_CHARS):
        if len(sentence) <= max_segment_chars:
            segments.append(sentence)
            continue
        segments.extend(_split_after_runs(sentence, BREATH_CHARS))
    pieces = [piece for piece in segments if piece.strip()]
    return pieces or [text]


def build_shot_cues(
    shot_index: int,
    text: Any,
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> list[dict[str, Any]]:
    """镜内台词编号:S{镜号:02d}-D{台词序}{段序};单元序密集、段序 a 起。"""
    cues: list[dict[str, Any]] = []
    for unit_number, unit in enumerate(split_dialogue_units(text), 1):
        for segment_index, segment in enumerate(
            split_overlong_unit(unit, max_segment_chars), 1
        ):
            cues.append({
                "cueId": f"S{shot_index:02d}-D{unit_number}{segment_letter(segment_index)}",
                "shot": shot_index,
                "unit": unit_number,
                "segment": segment_letter(segment_index),
                "text": segment,
            })
    return cues


def episode_dialogue_cues(
    episode_id: str = "chapter-001",
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> list[dict[str, Any]]:
    """编号生成的剧集模式:复用 source_dialogue_units 先例(只读 import)。"""
    cues: list[dict[str, Any]] = []
    for shot_index, text in enumerate(source_dialogue_units("", episode_id), 1):
        cues.extend(build_shot_cues(shot_index, text, max_segment_chars=max_segment_chars))
    return cues


def _shot_index(shot: dict[str, Any]) -> int:
    raw = shot.get("index")
    if isinstance(raw, int) and raw > 0:
        return raw
    match = re.search(r"-(\d+)$", str(shot.get("id") or ""))
    if match:
        return int(match.group(1))
    raise RuntimeError(f"分镜缺 index 且 id 无镜号可解析: {shot.get('id')}")


def story_cues_from_shot(
    shot: dict[str, Any],
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> list[dict[str, Any]]:
    """分镜侧台词 cue:``line``(无主前缀)优先,缺则 ``lines`` 剥主前缀。"""
    text = shot.get("line")
    if text is None:
        text = strip_primary_speaker_prefix(str(shot.get("lines") or ""))
    return build_shot_cues(
        _shot_index(shot), text, max_segment_chars=max_segment_chars
    )


def tts_cues_from_shot(
    shot: dict[str, Any],
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
) -> list[dict[str, Any]]:
    """TTS 绑定侧 cue:ttsSpokenText 链落库值(缺失=空,对账即报缺段)。"""
    return build_shot_cues(
        _shot_index(shot), shot.get("ttsSpokenText"), max_segment_chars=max_segment_chars
    )


def _parse_cue_id(cue_id: str) -> tuple[int, int, str] | None:
    match = CUE_ID_PARSE_RE.match(str(cue_id or ""))
    if match is None:
        return None
    return int(match.group(1)), int(match.group(2)), match.group(3)


def _contiguity_issues(cues: list[dict[str, Any]], side: str) -> list[dict[str, Any]]:
    """跳段检出:台词序按镜(S 组)须 1..n 连续;段序按 (S,D) 组须 a.. 连续。"""
    issues: list[dict[str, Any]] = []
    representative: dict[int, str] = {}
    units_by_shot: dict[int, set[int]] = {}
    letters_by_dialogue: dict[tuple[int, int], list[tuple[str, str]]] = {}
    for item in cues:
        cue_id = str(item.get("cueId") or "")
        parsed = _parse_cue_id(cue_id)
        if parsed is None:
            issues.append({"type": "invalid-id", "side": side, "cueId": cue_id})
            continue
        shot, unit, letter = parsed
        units_by_shot.setdefault(shot, set()).add(unit)
        letters_by_dialogue.setdefault((shot, unit), []).append((letter, cue_id))
        representative.setdefault(unit, cue_id)
    for shot, units in sorted(units_by_shot.items()):
        expected = 1
        for unit in sorted(units):
            if unit > expected:
                first_id = next(
                    cid for _, cid in sorted(letters_by_dialogue[(shot, unit)])
                )
                issues.append({
                    "type": "non-contiguous",
                    "side": side,
                    "cueId": first_id,
                    "detail": f"S{shot:02d} 台词序 {expected - 1}→{unit} 跳段",
                })
            expected = unit + 1
    for (shot, unit), entries in sorted(letters_by_dialogue.items()):
        expected_letter = "a"
        for letter, cue_id in sorted(entries):
            if letter > expected_letter:
                issues.append({
                    "type": "non-contiguous",
                    "side": side,
                    "cueId": cue_id,
                    "detail": f"S{shot:02d}-D{unit} 段序 {expected_letter}→{letter} 跳段",
                })
            expected_letter = chr(ord(letter) + 1)
    return issues


def reconcile_cues(
    dialogue_cues: list[dict[str, Any]],
    tts_cues: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """纯对账器(字幕 cue 侧接入同一契约):重段/缺段/取值不一致/跳段/非法编号。

    取值一致=两侧文本经 normalize_tts_spoken_text 同规归一后相等
    (build_chapter001_workflow.py:2930 先例,只读复用)。
    """
    issues: list[dict[str, Any]] = []
    for side, cues in (("dialogue", dialogue_cues), ("tts", tts_cues)):
        counts = Counter(str(item.get("cueId") or "") for item in cues)
        for cue_id, count in sorted(counts.items()):
            if count > 1:
                issues.append({
                    "type": "duplicate",
                    "side": side,
                    "cueId": cue_id,
                    "detail": f"同侧出现 {count} 次",
                })
        issues.extend(_contiguity_issues(cues, side))
    dialogue_values = {
        str(item.get("cueId")): normalize_tts_spoken_text(item.get("text"))
        for item in dialogue_cues
    }
    tts_values = {
        str(item.get("cueId")): normalize_tts_spoken_text(item.get("text"))
        for item in tts_cues
    }
    for cue_id in sorted(set(dialogue_values) - set(tts_values)):
        issues.append({"type": "missing-in-tts", "cueId": cue_id})
    for cue_id in sorted(set(tts_values) - set(dialogue_values)):
        issues.append({"type": "missing-in-dialogue", "cueId": cue_id})
    for cue_id in sorted(set(dialogue_values) & set(tts_values)):
        if dialogue_values[cue_id] != tts_values[cue_id]:
            issues.append({
                "type": "value-mismatch",
                "cueId": cue_id,
                "dialogueText": dialogue_values[cue_id],
                "ttsText": tts_values[cue_id],
            })
    return issues


def _storyboards(store: dict[str, Any]) -> list[dict[str, Any]]:
    state = store.get("state") or store
    storyboards = state.get("storyboards")
    if not isinstance(storyboards, list):
        raise RuntimeError("store 缺少 state.storyboards 数组")
    return [item for item in storyboards if isinstance(item, dict)]


def reconcile_store(
    store: dict[str, Any],
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
    shot_filter: int | None = None,
) -> dict[str, Any]:
    """整店对账(只读):逐镜分镜台词 vs TTS 绑定按编号对账,输出报告。"""
    shot_reports = []
    total_issues = 0
    total_cues = 0
    for shot in _storyboards(store):
        index = _shot_index(shot)
        if shot_filter is not None and index != shot_filter:
            continue
        story = story_cues_from_shot(shot, max_segment_chars=max_segment_chars)
        tts = tts_cues_from_shot(shot, max_segment_chars=max_segment_chars)
        issues = reconcile_cues(story, tts)
        total_issues += len(issues)
        total_cues += len(story) + len(tts)
        shot_reports.append({
            "shotId": shot.get("id"),
            "index": index,
            "storyCueCount": len(story),
            "ttsCueCount": len(tts),
            "issues": issues,
        })
    return {
        "ok": total_issues == 0,
        "shots": shot_reports,
        "totals": {
            "shots": len(shot_reports),
            "cues": total_cues,
            "issues": total_issues,
        },
    }


def reconcile_store_path(
    store_path: Path,
    *,
    max_segment_chars: int = DEFAULT_MAX_SEGMENT_CHARS,
    shot_filter: int | None = None,
) -> dict[str, Any]:
    """读盘对账:全程只读(store 字节不变由测试锁定)。"""
    value = json.loads(store_path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"store 根节点必须是对象: {store_path}")
    return reconcile_store(
        value, max_segment_chars=max_segment_chars, shot_filter=shot_filter
    )


def default_store_path() -> Path:
    return resolve_project_dir() / "studio-workflow-store.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="§五台词分段编号 S{镜}-D{台词}{段}:编号生成+分镜/TTS 对账(只读)",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--store", type=Path, help="对账模式:生产 store JSON 路径")
    source.add_argument(
        "--episode",
        nargs="?",
        const="chapter-001",
        default=None,
        help="编号生成模式:复用 source_dialogue_units(可带 episode id)",
    )
    parser.add_argument("--shot", type=int, help="对账模式:只看指定镜号")
    parser.add_argument(
        "--max-segment-chars",
        type=int,
        default=DEFAULT_MAX_SEGMENT_CHARS,
        help=f"超长拆段阈值(缺省 {DEFAULT_MAX_SEGMENT_CHARS},容量口径属提案二可调)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.episode is not None:
        cues = episode_dialogue_cues(
            args.episode, max_segment_chars=args.max_segment_chars
        )
        print(json.dumps(cues, ensure_ascii=False, indent=2))
        return
    store_path = (
        args.store if args.store is not None else default_store_path()
    ).expanduser().resolve()
    report = reconcile_store_path(
        store_path,
        max_segment_chars=args.max_segment_chars,
        shot_filter=args.shot,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
