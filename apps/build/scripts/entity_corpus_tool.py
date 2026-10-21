#!/usr/bin/env python3
"""剧本实体提取语料校验/合并工具(10-19 C3 会话模型轮)。

语料形态:每批一个 txt,章以 `### chapter-NNN` 分节,节内每行是生产解析器
(entity-extraction.ts parseEntityExtraction)要求的五列竖线行。

用法:
  python3 apps/build/scripts/entity_corpus_tool.py validate <dir>
  python3 apps/build/scripts/entity_corpus_tool.py merge <dir> --out replay-map.json
  python3 apps/build/scripts/entity_corpus_tool.py coverage <dir> --total 4125
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SECTION_RE = re.compile(r"^###\s+(chapter-\d+)\s*$")
KINDS = {"character", "scene", "prop"}


def parse_corpus_file(path: Path) -> tuple[dict[str, list[str]], list[str]]:
    sections: dict[str, list[str]] = {}
    errors: list[str] = []
    current: str | None = None
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        m = SECTION_RE.match(line)
        if m:
            current = m.group(1)
            if current in sections:
                errors.append(f"{path.name}:{lineno} 重复章标题 {current}")
            sections.setdefault(current, [])
            continue
        if current is None:
            errors.append(f"{path.name}:{lineno} 数据行出现在任何章标题之前")
            continue
        if not (line.startswith("|") and line.endswith("|")):
            errors.append(f"{path.name}:{lineno} 行首尾不是竖线: {line[:60]}")
            continue
        fields = [item.strip() for item in line[1:-1].split("|")]
        if len(fields) != 5:
            errors.append(f"{path.name}:{lineno} 字段数={len(fields)} (需5): {line[:60]}")
            continue
        kind = fields[0].lower()
        name = fields[1]
        if kind not in KINDS:
            errors.append(f"{path.name}:{lineno} 非法 KIND={kind!r}")
            continue
        if not name:
            errors.append(f"{path.name}:{lineno} 名称为空")
            continue
        if not fields[4]:
            errors.append(f"{path.name}:{lineno} 备注为空({name})")
            continue
        sections[current].append(line)
    return sections, errors


def load_all(corpus_dir: Path) -> tuple[dict[str, list[str]], list[str], dict[str, str]]:
    merged: dict[str, list[str]] = {}
    errors: list[str] = []
    origin: dict[str, str] = {}
    files = sorted(corpus_dir.glob("batch-*.txt"))
    if not files:
        errors.append(f"{corpus_dir} 下没有 batch-*.txt")
    for path in files:
        sections, file_errors = parse_corpus_file(path)
        errors.extend(file_errors)
        for chapter, rows in sections.items():
            if chapter in merged:
                errors.append(f"{path.name} 与其他批次重复输出 {chapter}(已有 {origin.get(chapter)})")
                continue
            merged[chapter] = rows
            origin[chapter] = path.name
    return merged, errors, origin


def chapter_block(chapter: str, path: Path) -> str:
    text = path.read_text(encoding="utf-8").strip()
    lines = [line.strip() for line in text.splitlines()]
    scene_headings = [line for line in lines if re.match(r"^\d+-\d+\s+", line)]
    cast_lines = [line for line in lines if line.startswith("人物：")]
    calibration = [
        "【场次标题（逐场核对；场景名按手册归并，禁止截短）】",
        *[f"- {line}" for line in scene_headings],
        "【人物行（具名者必列；若干群演不入）】",
        *[f"- {line}" for line in cast_lines],
        "【正文】",
    ]
    return f"### {chapter}\n" + "\n".join(calibration) + "\n" + text


def cmd_next_inputs(args: argparse.Namespace) -> int:
    merged, _, _ = load_all(Path(args.corpus_dir))
    drama_dir = Path(args.drama_dir)
    missing = [n for n in range(1, args.total + 1) if f"chapter-{n:03d}" not in merged]
    batches: list[dict[str, object]] = []
    i = 0
    while i < len(missing) and len(batches) < args.count:
        start = missing[i]
        picks = [start]
        j = i + 1
        while j < len(missing) and missing[j] == picks[-1] + 1 and len(picks) < args.size:
            picks.append(missing[j])
            j += 1
        i = j
        end = picks[-1]
        name = f"batch-{start:03d}-{end:03d}.txt"
        blocks = [
            chapter_block(f"chapter-{number:03d}", drama_dir / f"chapter-{number:03d}_漫剧.md")
            for number in picks
        ]
        outdir = Path(args.outdir)
        outdir.mkdir(parents=True, exist_ok=True)
        (outdir / name).write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
        batches.append({
            "input": str(outdir / name),
            "corpus_out": str(Path(args.corpus_dir) / name),
            "start": start,
            "end": end,
        })
    print(json.dumps({"missing_total": len(missing), "batches": batches}, ensure_ascii=False, indent=2))
    return 0


def cmd_validate(args: argparse.Namespace) -> int:
    if args.file:
        sections, errors = parse_corpus_file(Path(args.file))
        merged = sections
        origin = {chapter: Path(args.file).name for chapter in sections}
    else:
        merged, errors, origin = load_all(Path(args.dir))
    total_rows = sum(len(rows) for rows in merged.values())
    kind_counts: dict[str, int] = defaultdict(int)
    per_kind_chapters: dict[str, int] = defaultdict(int)
    empty_chapters: list[str] = []
    for chapter, rows in merged.items():
        seen: dict[str, int] = defaultdict(int)
        for line in rows:
            fields = [item.strip() for item in line[1:-1].split("|")]
            kind_counts[fields[0].lower()] += 1
            seen[fields[0].lower()] += 1
            ids = [item.strip() for item in re.split(r"[,，]+", fields[3]) if item.strip()]
            if ids and chapter not in ids:
                errors.append(f"{chapter} 行内集ID不匹配 {fields[3]!r}: {fields[1]}")
        if not rows:
            empty_chapters.append(chapter)
        for kind, count in seen.items():
            if count:
                per_kind_chapters[kind] += 1
    print(f"章数={len(merged)} 实体行={total_rows} 批次文件={len(set(origin.values()))}")
    print(
        "分型=" + " ".join(f"{kind}:{kind_counts.get(kind, 0)}" for kind in sorted(KINDS))
    )
    if empty_chapters:
        print(f"空章({len(empty_chapters)})={empty_chapters[:20]}")
    if errors:
        print(f"错误={len(errors)}")
        for item in errors[:50]:
            print("  -", item)
        return 1
    print("校验通过")
    return 0


def cmd_merge(args: argparse.Namespace) -> int:
    merged, errors, _ = load_all(Path(args.dir))
    if errors:
        for item in errors[:50]:
            print("  -", item, file=sys.stderr)
        print(f"存在 {len(errors)} 条错误,拒绝合并", file=sys.stderr)
        return 1
    out = Path(args.out)
    payload = {chapter: "\n".join(rows) for chapter, rows in sorted(merged.items())}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"合并 {len(payload)} 章 -> {out} ({out.stat().st_size} bytes)")
    return 0


def cmd_make_input(args: argparse.Namespace) -> int:
    drama_dir = Path(args.drama_dir)
    out = Path(args.out)
    chunks: list[str] = []
    missing: list[str] = []
    for number in range(args.start, args.end + 1):
        chapter = f"chapter-{number:03d}"
        path = drama_dir / f"{chapter}_漫剧.md"
        if not path.exists():
            missing.append(chapter)
            continue
        text = path.read_text(encoding="utf-8").strip()
        lines = [line.strip() for line in text.splitlines()]
        scene_headings = [line for line in lines if re.match(r"^\d+-\d+\s+", line)]
        cast_lines = [line for line in lines if line.startswith("人物：")]
        calibration = [
            "【场次标题（逐场核对；场景名按手册归并，禁止截短）】",
            *[f"- {line}" for line in scene_headings],
            "【人物行（具名者必列；若干群演不入）】",
            *[f"- {line}" for line in cast_lines],
            "【正文】",
        ]
        chunks.append(f"### {chapter}\n" + "\n".join(calibration) + "\n" + text)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n\n".join(chunks) + "\n", encoding="utf-8")
    print(f"输入批次 {args.start}-{args.end} -> {out} ({out.stat().st_size} bytes, {len(chunks)} 章)")
    if missing:
        print(f"缺失={missing[:20]}")
        return 1
    return 0


def cmd_coverage(args: argparse.Namespace) -> int:
    merged, _, _ = load_all(Path(args.dir))
    total = args.total
    missing = [f"chapter-{i:03d}" for i in range(1, total + 1) if f"chapter-{i:03d}" not in merged]
    print(f"覆盖率={len(merged)}/{total}")
    if missing:
        print(f"缺失={len(missing)}; 前20={missing[:20]}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    p_next = sub.add_parser("next-inputs")
    p_next.add_argument("--corpus-dir", required=True)
    p_next.add_argument("--outdir", required=True)
    p_next.add_argument("--drama-dir", default="/Users/zhengbingjin/Project/IP/MA/novel/drama")
    p_next.add_argument("--total", type=int, default=4125)
    p_next.add_argument("--size", type=int, default=10)
    p_next.add_argument("--count", type=int, default=8)
    p_next.set_defaults(func=cmd_next_inputs)
    p_validate = sub.add_parser("validate")
    p_validate.add_argument("dir", nargs="?")
    p_validate.add_argument("--file")
    p_validate.set_defaults(func=cmd_validate)
    p_merge = sub.add_parser("merge")
    p_merge.add_argument("dir")
    p_merge.add_argument("--out", required=True)
    p_merge.set_defaults(func=cmd_merge)
    p_make_input = sub.add_parser("make-input")
    p_make_input.add_argument("--start", type=int, required=True)
    p_make_input.add_argument("--end", type=int, required=True)
    p_make_input.add_argument("--drama-dir", default="/Users/zhengbingjin/Project/IP/MA/novel/drama")
    p_make_input.add_argument("--out", required=True)
    p_make_input.set_defaults(func=cmd_make_input)
    p_coverage = sub.add_parser("coverage")
    p_coverage.add_argument("dir")
    p_coverage.add_argument("--total", type=int, default=4125)
    p_coverage.set_defaults(func=cmd_coverage)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
