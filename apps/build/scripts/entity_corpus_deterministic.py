#!/usr/bin/env python3
"""会话内确定性剧本实体语料生成器(10-20 C3 续作)。

子代理日额度不可用时,由本脚本按生产手册的机械可判部分补齐全书:
- scene:每个场次标题一条(同名地点同章归并),备注取该场首条正文;
- character:人物行具名者 + 台词/OS 说话人(沿用审计器过滤),短称自动并作别名;
- prop:以既有语料中已人工/模型裁定的道具为词表,按本章正文实匹配,
  备注取首次出现句。新章新道具靠审计 red_flag 曝光后再人工裁。

只读剧本与既有语料,只写 corpus 目录;不碰 store/。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from entity_corpus_audit import (  # noqa: E402
    DIALOG_RE,
    OS_RE,
    parse_drama,
    normalize,
)
from entity_corpus_tool import SECTION_RE, load_all  # noqa: E402

MAX_PROPS = 8
NOTE_LEN = 80
HEADING_RE = re.compile(r"^\d+-\d+\s+")
# 手册明列的可疑背景物/概念;只保留已裁定确有剧情功能的少数项
PROP_KEEP = {
    "草席卷", "三丈麻绳", "灵气残影图", "镇灵铁链", "异灵根连坐碑",
    "全家福石板", "亡者名录石板", "灵气储存球", "机关球", "三色灵气图",
    "门框暗号", "矿渣提灵装置",
}
PROP_RED_FLAGS = (
    "竹筹", "门板", "风灯", "算盘", "碎银", "灵气", "吐纳", "灵根", "锁灵链",
    "墨汁", "白土笔", "矿渣", "油灯", "灯笼", "糖葫芦", "蒸笼", "草席", "干草",
    "石板", "麻绳", "藤筐", "铁链", "窗户", "门闩", "门框", "柜台",
)
GENERIC_PROPS = {
    "麻袋", "布袋", "木箱", "箱子", "桌子", "椅子", "凳子", "窗户", "门板", "门闩",
    "茶水", "干粮", "碎银", "铜钱", "银两", "灵石", "丹药",
    "青石", "木板", "油布", "灰布", "木簪", "柳叶",
}


def clean_note(text: str) -> str:
    text = re.sub(r"^镜头\s*\d+(?:（[^）]*）|\([^)]*\))?[：:]\s*", "", text.strip())
    text = re.sub(r"^\[[^\]]*\]\s*", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = text.replace("|", "／")
    return text[:NOTE_LEN]


def prop_allowed(name: str) -> bool:
    key = normalize(name)
    if len(key) < 2 or key in GENERIC_PROPS:
        return False
    if name in PROP_KEEP:
        return True
    return not any(flag in name for flag in PROP_RED_FLAGS)


def load_prop_glossary(corpus_dir: Path) -> dict[str, str]:
    """normalized surface -> canonical prop name; canonical exact names plus
    specific (>=4 chars) aliases, red-flagged background terms excluded."""
    merged, errors, _ = load_all(corpus_dir)
    if errors:
        raise SystemExit(f"既有语料自身有错,拒绝生成:{errors[:3]}")
    glossary: dict[str, str] = {}
    for rows in merged.values():
        for line in rows:
            fields = [item.strip() for item in line[1:-1].split("|")]
            if len(fields) != 5 or fields[0].lower() != "prop":
                continue
            name = fields[1]
            if not prop_allowed(name):
                continue
            glossary.setdefault(normalize(name), name)
            for alias in re.split(r"[、,，/]+", fields[2]):
                key = normalize(alias)
                if len(key) >= 4 and prop_allowed(alias):
                    glossary.setdefault(key, name)
    return glossary


def match_props(text: str, glossary: dict[str, str]) -> list[tuple[int, str, str]]:
    """Return [(position, surface, canonical)] deduped by canonical."""
    best: dict[str, tuple[int, str]] = {}
    max_len = min(8, max((len(key) for key in glossary), default=2))
    for index in range(len(text)):
        for length in range(2, max_len + 1):
            key = text[index:index + length]
            canonical = glossary.get(key)
            if canonical is None:
                continue
            follow = text[index + length:index + length + 1]
            if follow in "气意势光影法诀招技术道心魂灵力劲风声味色":
                continue
            if canonical not in best or index < best[canonical][0]:
                best[canonical] = (index, key)
    ordered = sorted((pos, surface, canonical) for canonical, (pos, surface) in best.items())
    return ordered[:MAX_PROPS]


def sentence_at(text: str, position: int) -> str:
    left = 0
    for ch in "。！？\n":
        found = text.rfind(ch, 0, position)
        left = max(left, found + 1)
    right = len(text)
    for ch in "。！？\n":
        found = text.find(ch, position)
        if found != -1:
            right = min(right, found)
    return text[left:right]


def speaker_names(raw_lines: list[str]) -> list[str]:
    names: list[str] = []
    seen: set[str] = set()
    for line in raw_lines:
        line = line.strip()
        m = OS_RE.match(line) or DIALOG_RE.match(line)
        if not m:
            continue
        name = re.sub(r"（[^）]*）|\([^)]*\)", "", m.group(1)).strip()
        key = normalize(name)
        if len(key) >= 2 and key not in seen:
            seen.add(key)
            names.append(name)
    return names


def first_meaningful_line(raw_lines: list[str], name: str) -> str:
    started = False
    for line in raw_lines:
        s = line.strip()
        if HEADING_RE.match(s):
            started = True
            continue
        if not started or not s:
            continue
        if s.startswith(("#", "-", "【", "人物：")):
            continue
        m = OS_RE.match(s) or DIALOG_RE.match(s)
        if m and name in m.group(1):
            return s
    for line in raw_lines:
        s = line.strip()
        if not s or s.startswith(("#", "-", "【", "人物：")) or HEADING_RE.match(s):
            continue
        if name in s:
            return s
    return ""


def build_rows(chapter: str, drama: Path, glossary: dict[str, str]) -> list[str]:
    text = drama.read_text(encoding="utf-8")
    raw_lines = text.splitlines()
    scene_names, required_chars, scene_notes, _ = parse_drama(drama)
    chapter_number = int(chapter.split("-")[1])

    start = next((i for i, line in enumerate(raw_lines) if HEADING_RE.match(line.strip())), 0)
    body_lines: list[str] = []
    for line in raw_lines[start:]:
        stripped = line.strip()
        if stripped.startswith(("|", "##")):
            break
        if not stripped or stripped.startswith(("#", "【", "注：", "新增")):
            continue
        body_lines.append(line)
    body_text = "\n".join(line for line in body_lines if not HEADING_RE.match(line.strip()))

    cast_tokens: set[str] = set()
    paren_aliases: dict[str, list[str]] = defaultdict(list)
    for line in raw_lines:
        if not line.strip().startswith("人物："):
            continue
        for token in re.split(r"[\s　]+", line.strip()[len("人物："):].strip()):
            if not token:
                continue
            base = re.sub(r"（[^）]*）|\([^)]*\)", "", token).strip()
            cast_tokens.add(normalize(base))
            for alias in re.findall(r"（([^）]*)）|\(([^)]*)\)", token):
                value = (alias[0] or alias[1]).strip()
                if len(normalize(value)) >= 2:
                    paren_aliases[normalize(base)].append(value)
    speakers = speaker_names(raw_lines)
    speaker_keys = {normalize(name) for name in speakers}

    drop: set[str] = set()
    alias_of: dict[str, list[str]] = defaultdict(list)
    for name in required_chars:
        key = normalize(name)
        if len(key) < 2:
            continue
        owners = [
            other for other in required_chars
            if normalize(other) != key and normalize(other).endswith(key)
        ]
        if len(owners) == 1:
            drop.add(key)
            alias_of[normalize(owners[0])].append(name)
    for name in required_chars:
        key = normalize(name)
        for other in required_chars:
            other_key = normalize(other)
            if other_key == key or len(other_key) < 2 or other_key not in key:
                continue
            if other_key not in cast_tokens and other_key in speaker_keys:
                owners = [n for n in required_chars if other_key in normalize(n)]
                if len(owners) == 1:
                    drop.add(other_key)
                    alias_of[key].append(other)

    rows: list[str] = []
    for name in required_chars:
        key = normalize(name)
        if key in drop:
            continue
        aliases = list(dict.fromkeys([*alias_of.get(key, []), *paren_aliases.get(key, [])]))
        alias_text = "、".join(aliases)
        note = clean_note(first_meaningful_line(raw_lines, name.strip()))
        if not note:
            note = f"第{chapter_number}章人物行/台词出场"
        rows.append(f"| character | {name.strip()} | {alias_text} | {chapter} | {note} |")

    seen_scenes: set[str] = set()
    for location in scene_names:
        key = normalize(location)
        if not key or key in seen_scenes:
            continue
        seen_scenes.add(key)
        note = clean_note(scene_notes.get(location) or f"第{chapter_number}章场次地点,见剧本标题")
        rows.append(f"| scene | {location.strip()} | | {chapter} | {note} |")

    for position, surface, canonical in match_props(body_text, glossary):
        note = clean_note(sentence_at(body_text, position))
        rows.append(f"| prop | {canonical} | | {chapter} | {note} |")

    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-dir", required=True)
    parser.add_argument("--drama-dir", default="/Users/zhengbingjin/Project/IP/MA/novel/drama")
    parser.add_argument("--total", type=int, default=4125)
    parser.add_argument("--limit", type=int, default=0, help="only generate first N missing batches")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    corpus_dir = Path(args.corpus_dir)
    drama_dir = Path(args.drama_dir)
    merged, errors, _ = load_all(corpus_dir)
    if errors:
        raise SystemExit(f"既有语料自身有错:{errors[:3]}")
    glossary = load_prop_glossary(corpus_dir)
    missing = [n for n in range(1, args.total + 1) if f"chapter-{n:03d}" not in merged]

    batches: dict[int, list[int]] = defaultdict(list)
    for number in missing:
        batches[(number - 1) // 10 * 10].append(number)

    stats = {"batches": 0, "chapters": 0, "rows": 0, "kinds": Counter()}
    for start in sorted(batches):
        if args.limit and stats["batches"] >= args.limit:
            break
        numbers = batches[start]
        sections: list[str] = []
        for number in numbers:
            chapter = f"chapter-{number:03d}"
            drama = drama_dir / f"chapter-{number:03d}_漫剧.md"
            if not drama.exists():
                raise SystemExit(f"缺剧本:{drama}")
            rows = build_rows(chapter, drama, glossary)
            sections.append(f"### {chapter}\n" + "\n".join(rows))
            stats["chapters"] += 1
            stats["rows"] += len(rows)
            for row in rows:
                stats["kinds"][row.split("|")[1].strip()] += 1
        out = corpus_dir / f"batch-{start:03d}.txt"
        if out.exists():
            raise SystemExit(f"拒绝覆盖既有批次:{out}")
        if not args.dry_run:
            out.write_text("\n\n".join(sections) + "\n", encoding="utf-8")
        stats["batches"] += 1

    print(json.dumps({
        "missing_total": len(missing),
        "generated_batches": stats["batches"],
        "generated_chapters": stats["chapters"],
        "rows": stats["rows"],
        "kinds": dict(stats["kinds"]),
        "glossary": len(glossary),
        "dry_run": args.dry_run,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
