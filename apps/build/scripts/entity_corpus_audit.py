#!/usr/bin/env python3
"""全书剧本实体语料覆盖审计(10-20 C3 会话模型轮)。

对照剧本场次标题/人物行,检查每章语料是否覆盖:
- 每个场次标题地点(或主地点归并)至少一条 scene 行;
- 每个具名人物行/台词说话人至少一条 character 行(名称或别名命中);
- 可疑道具(手册明列不入的背景物/概念)预警;
- 同一章内同类型同名重复行。

用法:
  python3 apps/build/scripts/entity_corpus_audit.py --corpus-dir DIR [--total 4125]
  python3 apps/build/scripts/entity_corpus_audit.py --corpus-dir DIR --fix
  python3 apps/build/scripts/entity_corpus_audit.py --corpus-dir DIR --report out.json

--fix 只补机械可判的缺失角色/场景行(备注为通用占位),不改动已有行。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from entity_corpus_tool import SECTION_RE, load_all  # noqa: E402

HEADING_RE = re.compile(r"^\d+-\d+\s+")
DIALOG_RE = re.compile(r"^([^\s：（）]{1,16})(?:（[^）]*）)?：")
OS_RE = re.compile(r"^(?:OS|V\.S\.|VO)（([^，）]+)")
NON_CHARACTER = {
    "旁白", "SFX", "BGM", "音效", "镜头", "字幕", "画面", "系统", "画外", "画外音",
    "注", "备注", "说明", "摘要", "门内人语", "新增场", "叫卖", "正文源", "新增说明",
    "低沉", "低沉警醒", "寒", "冷", "平淡", "压抑", "急促", "平静", "愤怒", "颤抖",
    "沙哑", "低声", "高声", "轻笑", "冷笑", "苦笑", "沉声", "轻声", "厉声", "漠然",
    "冷硬", "涩", "哑", "低",
}
NON_CHARACTER_PREFIX = ("镜头", "字幕", "画面", "音效", "SFX", "BGM", "旁白", "场景", "转场")
GROUP_MARKERS = ("若干", "一群", "众", "们", "队员", "追兵")
PROP_RED_FLAGS = (
    "竹筹", "门板", "风灯", "算盘", "碎银", "灵气", "吐纳", "灵根", "锁灵链",
    "墨汁", "白土笔", "矿渣", "油灯", "灯笼", "糖葫芦", "蒸笼", "草席", "干草",
    "石板", "麻绳", "藤筐", "铁链", "窗户", "门闩", "门框", "柜台",
)


def normalize(value: str) -> str:
    value = re.sub(r"（[^）]*）|\([^)]*\)", "", value)
    value = re.sub(r"[一二三四五六七八九十两几]人$", "", value)
    return re.sub(r"[\s·\-—、,，/]+", "", value).lower()


def heading_location(line: str) -> str | None:
    rest = HEADING_RE.sub("", line.strip())
    m = re.search(r"[/／](内|外)\s*(?:·约.*)?$", rest)
    if m:
        rest = rest[: m.start()]
    rest = re.sub(r"·?\s*约?\d+秒\s*$", "", rest).strip()
    parts = rest.split()
    if len(parts) > 1:
        rest = " ".join(parts[:-1])
    rest = rest.strip("·-— ")
    return rest or None


GROUP_TOKEN_RE = re.compile(
    r"^(?:众|一群|若干).*"
    r"|.*(?:若干|一群|[一二三四五六七八九十两几数]+(?:人|名|骑|只|口|位|个|团|头))$"
    r"|^[一二三四五六七八九十两几数]+(?:名|骑|只|口|位|个|团|头).+$"
)
SENTENCE_PUNCT = re.compile(r"[，。！？；、…]")


def parse_drama(path: Path) -> tuple[list[str], list[str], dict[str, str], dict[str, str]]:
    scene_names: list[str] = []
    required_chars: list[str] = []
    seen_chars: set[str] = set()
    scene_notes: dict[str, str] = {}
    char_notes: dict[str, str] = {}
    current_scene: str | None = None
    current_scene_body: list[str] = []

    raw_lines = path.read_text(encoding="utf-8").splitlines()
    cast_tokens: list[str] = []
    for raw in raw_lines:
        line = raw.strip()
        if line.startswith("人物："):
            cast_tokens.extend(t for t in re.split(r"[\s　]+", line[len("人物："):].strip()) if t)
    standalone_cast = {normalize(t) for t in cast_tokens if not GROUP_TOKEN_RE.match(t)}
    group_tokens = [normalize(t) for t in cast_tokens if GROUP_TOKEN_RE.match(t)]

    def add_char(name: str, from_speaker: bool = False) -> None:
        name = re.sub(r"（[^）]*）|\([^)]*\)", "", name).strip()
        if not name or len(name) > 6:
            return
        if SENTENCE_PUNCT.search(name):
            return
        if name in NON_CHARACTER or name.startswith(NON_CHARACTER_PREFIX):
            return
        if GROUP_TOKEN_RE.match(name):
            return
        if any(marker in name for marker in GROUP_MARKERS):
            return
        if from_speaker and normalize(name) not in standalone_cast and any(
            normalize(name) in token for token in group_tokens
        ):
            return
        key = normalize(name)
        if not key or key in seen_chars:
            return
        seen_chars.add(key)
        required_chars.append(name)

    def note_from(line: str) -> str:
        if line.startswith("人物：") or line.startswith("#"):
            return ""
        text = re.sub(r"^镜头\s*\d+(?:（[^）]*）|\([^)]*\))?[：:]\s*", "", line)
        text = re.sub(r"^\[[^\]]*\]\s*", "", text)
        return text.strip()[:80]

    for index, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line:
            continue
        if HEADING_RE.match(line):
            if current_scene and current_scene not in scene_notes:
                for body_line in current_scene_body:
                    note = note_from(body_line)
                    if note:
                        scene_notes[current_scene] = note
                        break
            location = heading_location(line)
            current_scene = location
            current_scene_body = []
            if location:
                scene_names.append(location)
            continue
        if current_scene is not None and len(current_scene_body) < 8:
            current_scene_body.append(line)
        if line.startswith("人物："):
            for token in re.split(r"[\s　]+", line[len("人物："):].strip()):
                if token:
                    add_char(token)
                    char_notes.setdefault(
                        normalize(re.sub(r"（[^）]*）|\([^)]*\)", "", token)),
                        note_from(" ".join(raw_lines[index:index + 6])),
                    )
            continue
        m = OS_RE.match(line)
        if m:
            add_char(m.group(1), from_speaker=True)
            char_notes.setdefault(normalize(m.group(1)), note_from(line))
            continue
        m = DIALOG_RE.match(line)
        if m:
            add_char(m.group(1), from_speaker=True)
            char_notes.setdefault(normalize(m.group(1)), note_from(line))
    if current_scene and current_scene not in scene_notes:
        for body_line in current_scene_body:
            note = note_from(body_line)
            if note:
                scene_notes[current_scene] = note
                break
    for name in required_chars:
        key = normalize(name)
        if char_notes.get(key):
            continue
        for line in raw_lines:
            if name in line and not line.startswith("人物：") and not line.startswith("#"):
                note = note_from(line)
                if note:
                    char_notes[key] = note
                    break
    return scene_names, required_chars, scene_notes, char_notes


def scene_covered(location: str, scene_keys: set[str], scene_names: list[str]) -> bool:
    loc = normalize(location)
    if not loc:
        return True
    if loc in scene_keys:
        return True
    for name in scene_names:
        key = normalize(name)
        if len(key) >= 2 and (key.startswith(loc) or loc.startswith(key)):
            return True
    return False


def char_covered(name: str, char_keys: set[str]) -> bool:
    key = normalize(name)
    if key in char_keys:
        return True
    if len(key) < 2:
        return False
    return any(len(other) >= 2 and (key in other or other in key) for other in char_keys)


def audit_chapter(
    chapter: str,
    rows: list[str],
    drama_dir: Path,
    fix: bool,
) -> tuple[list[dict[str, str]], list[str]]:
    issues: list[dict[str, str]] = []
    chapter_number = int(chapter.split("-")[1])
    drama = drama_dir / f"chapter-{chapter_number:03d}_漫剧.md"
    if not drama.exists():
        return [{"chapter": chapter, "kind": "missing_drama", "detail": str(drama)}], rows

    scene_names, required_chars, scene_notes, char_notes = parse_drama(drama)
    parsed: list[tuple[str, str, list[str], str]] = []
    for line in rows:
        fields = [item.strip() for item in line[1:-1].split("|")]
        if len(fields) != 5:
            continue
        kind, name, aliases = fields[0].lower(), fields[1], fields[2]
        parsed.append((kind, name, [a for a in re.split(r"[、,，/]+", aliases) if a], line))

    char_names = [name for kind, name, _, _ in parsed if kind == "character"]
    char_keys = {
        normalize(value)
        for kind, name, aliases, _ in parsed
        if kind == "character"
        for value in [name, *aliases]
        if normalize(value)
    }
    scene_names_corpus = [name for kind, name, _, _ in parsed if kind == "scene"]
    scene_keys = {
        normalize(value)
        for kind, name, aliases, _ in parsed
        if kind == "scene"
        for value in [name, *aliases]
        if normalize(value)
    }

    for location in scene_names:
        if not scene_covered(location, scene_keys, scene_names_corpus):
            issues.append({"chapter": chapter, "kind": "missing_scene", "detail": location})
            if fix:
                note = scene_notes.get(location) or f"第{chapter_number}章场次地点，见剧本场次标题"
                note = note.replace("|", "／")
                rows.append(f"| scene | {location} | | {chapter} | {note} |")
                scene_keys.add(normalize(location))
                scene_names_corpus.append(location)

    for name in required_chars:
        if not char_covered(name, char_keys):
            issues.append({"chapter": chapter, "kind": "missing_character", "detail": name})
            if fix:
                def note_mentions(line: str) -> bool:
                    fields = [item.strip() for item in line[1:-1].split("|")]
                    return len(fields) == 5 and fields[0].lower() == "character" and normalize(name) in normalize(fields[4])

                candidates = [idx for idx, line in enumerate(rows) if note_mentions(line)]
                if len(candidates) == 1:
                    idx = candidates[0]
                    fields = [item.strip() for item in rows[idx][1:-1].split("|")]
                    aliases = [a for a in re.split(r"[、,，/]+", fields[2]) if a]
                    if name not in aliases:
                        fields[2] = "、".join([*aliases, name])
                        rows[idx] = "| " + " | ".join(fields) + " |"
                    char_keys.add(normalize(name))
                    continue
                note = char_notes.get(normalize(name)) or f"第{chapter_number}章出场角色，见剧本人物行/台词"
                note = note.replace("|", "／")
                rows.append(f"| character | {name} | | {chapter} | {note} |")
                char_keys.add(normalize(name))
                char_names.append(name)

    seen_rows: dict[tuple[str, str], int] = defaultdict(int)
    for kind, name, _, _ in parsed:
        seen_rows[(kind, normalize(name))] += 1
        if kind == "prop" and any(flag in name for flag in PROP_RED_FLAGS):
            issues.append({"chapter": chapter, "kind": "prop_red_flag", "detail": name})
    for (kind, key), count in seen_rows.items():
        if count > 1:
            issues.append({"chapter": chapter, "kind": "duplicate_row", "detail": f"{kind}:{key}x{count}"})

    return issues, rows


def sort_key(chapter: str) -> int:
    m = re.match(r"chapter-(\d+)", chapter)
    return int(m.group(1)) if m else 10**9


def write_corpus_file(path: Path, sections: dict[str, list[str]]) -> None:
    blocks = []
    for chapter in sorted(sections, key=sort_key):
        rows = sections[chapter]
        if rows:
            blocks.append(f"### {chapter}\n" + "\n".join(rows))
    path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus-dir", required=True)
    parser.add_argument("--drama-dir", default="/Users/zhengbingjin/Project/IP/MA/novel/drama")
    parser.add_argument("--total", type=int, default=4125)
    parser.add_argument("--fix", action="store_true")
    parser.add_argument("--report")
    args = parser.parse_args()

    corpus_dir = Path(args.corpus_dir)
    merged, errors, origin = load_all(corpus_dir)
    if errors:
        print(f"语料自身校验错误 {len(errors)} 条;先跑 validate", file=sys.stderr)
        for item in errors[:20]:
            print("  -", item, file=sys.stderr)
        return 1

    all_issues: list[dict[str, str]] = []
    fixed_sections: dict[str, list[str]] = {}
    fixed_count = 0
    changed_files: set[Path] = set()
    per_file_sections: dict[Path, dict[str, list[str]]] = {}

    for chapter in sorted(merged, key=sort_key):
        rows = list(merged[chapter])
        issues, rows = audit_chapter(chapter, rows, Path(args.drama_dir), args.fix)
        all_issues.extend(issues)
        if rows != merged[chapter]:
            fixed_count += max(0, len(rows) - len(merged[chapter]))
            path = corpus_dir / origin[chapter]
            per_file_sections.setdefault(path, {})[chapter] = rows
            changed_files.add(path)
        fixed_sections[chapter] = rows

    missing_chapters = [
        f"chapter-{i:03d}" for i in range(1, args.total + 1) if f"chapter-{i:03d}" not in merged
    ]

    summary: dict[str, int] = defaultdict(int)
    for issue in all_issues:
        summary[issue["kind"]] += 1
    print(f"审计章数={len(merged)}/{args.total} 缺失章={len(missing_chapters)}")
    print(
        "问题="
        + " ".join(f"{kind}:{count}" for kind, count in sorted(summary.items()))
        or "问题=0"
    )
    print(f"自动补齐行={fixed_count} 涉及文件={len(changed_files)}")
    if missing_chapters:
        print(f"缺失章前20={missing_chapters[:20]}")

    if args.fix:
        for path, sections in per_file_sections.items():
            # 只重写被修改的章节,其他章节保持原文件内容
            original, file_errors = load_all_file(path)
            if file_errors:
                print(f"跳过重写 {path.name}: {file_errors[:3]}", file=sys.stderr)
                continue
            original.update(sections)
            write_corpus_file(path, original)
            print(f"已重写 {path.name}(补 {sum(len(v) for v in sections.values())} 行)")

    if args.report:
        report = Path(args.report)
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(
            json.dumps(
                {
                    "chapters": len(merged),
                    "total": args.total,
                    "missing_chapters": missing_chapters,
                    "summary": dict(summary),
                    "fixed_rows": fixed_count,
                    "issues": all_issues,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        print(f"报告 -> {report}")

    hard_kinds = {"missing_scene", "missing_character", "missing_drama"}
    hard = [issue for issue in all_issues if issue["kind"] in hard_kinds]
    return 1 if hard and not args.fix else 0


def load_all_file(path: Path) -> tuple[dict[str, list[str]], list[str]]:
    from entity_corpus_tool import parse_corpus_file

    return parse_corpus_file(path)


if __name__ == "__main__":
    raise SystemExit(main())
