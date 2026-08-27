#!/usr/bin/env python3
"""扫描 IP/MA 中武侠味词汇(修仙世界不应出现/需人工裁定的词)。

用法:
  python3 apps/build/scripts/xianxia_wuxia_vocab_scan.py [--root <IP/MA路径>]

输出:
  - stdout: 摘要(按词统计 + 成片可见层统计)
  - apps/build/scripts/xianxia-wuxia-scan-report.md: 全量明细报告

词表分两档:
  - 明确武侠(修仙世界直接判违和): 江湖 武林 大侠 少侠 女侠 侠客 侠士 侠义
    镖局 镖师 走镖 押镖 盟主 快意恩仇 行侠仗义
  - 边缘(修仙语境可能对可能错,需上下文裁定): 武功 掌门 门派 帮派 客栈
    轻功 内力 招式 剑客 刀客
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

HARD_TERMS = [
    "江湖", "武林", "大侠", "少侠", "女侠", "侠客", "侠士", "侠义",
    "镖局", "镖师", "走镖", "押镖", "盟主", "快意恩仇", "行侠仗义",
]

SOFT_TERMS = [
    "武功", "掌门", "门派", "帮派", "客栈", "轻功", "内力", "招式",
    "剑客", "刀客",
]

# 成片可见字段关键词(台词/旁白/提示词/字幕/标题)——命中这些字段 = 用户看得见听得着
VISIBLE_FIELD_HINTS = (
    "dialogue", "line", "speech", "narrat", "voice", "caption", "subtitle",
    "prompt", "title", "heading", "summary", "description", "text", "label",
    "name",
)

BACKUP_MARKERS = (".bak-", ".backup", ".bak2", "/backups/", "/bak-")

TEXT_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".ts", ".tsx", ".py", ".toml", ".yaml", ".yml"}

CTX = 28  # 上下文半宽(字符)


def is_backup(path_str: str) -> bool:
    return any(m in path_str for m in BACKUP_MARKERS)


def extract_field_key(line: str) -> str:
    """从 '  "someKey": "value...' 行提取 someKey。"""
    m = re.match(r'\s*"([^"]+)"\s*:', line)
    return m.group(1) if m else ""


def classify_field(field_key: str) -> str:
    k = field_key.lower()
    return "visible" if any(h in k for h in VISIBLE_FIELD_HINTS) else "internal"


def scan_file(path: Path, terms: list[str], chapter_scope: bool):
    """返回 hits: list of (term, tier, field_key, bucket, context, line_no, chapter)"""
    hits = []
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return hits
    lines = text.splitlines()
    is_chapter = "chapter-001" in str(path)
    for i, line in enumerate(lines, 1):
        for term in terms:
            if term not in line:
                continue
            field_key = extract_field_key(line)
            bucket = classify_field(field_key)
            start = 0
            occurrences = 0
            while True:
                idx = line.find(term, start)
                if idx < 0:
                    break
                occurrences += 1
                lo, hi = max(0, idx - CTX), min(len(line), idx + len(term) + CTX)
                snippet = line[lo:hi].strip()
                snippet = snippet.replace("\\n", " ")
                if len(snippet) > 130:
                    snippet = snippet[:130] + "…"
                hits.append((term, field_key, bucket, snippet, i, is_chapter))
                start = idx + len(term)
    return hits


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="/Users/zhengbingjin/Project/IP/MA")
    parser.add_argument(
        "--report",
        default=str(Path(__file__).with_name("xianxia-wuxia-scan-report.md")),
    )
    args = parser.parse_args()
    root = Path(args.root)

    if not root.is_dir():
        print(f"[error] root not found: {root}", file=sys.stderr)
        return 1

    terms = HARD_TERMS + SOFT_TERMS
    hard_set = set(HARD_TERMS)

    all_hits = []          # live files only
    backup_hit_count = 0   # 备份目录命中总数(只计数)
    live_files_scanned = 0

    for path in root.rglob("*"):
        if not path.is_file():
            continue
        p_str = str(path)
        if path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if is_backup(p_str):
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")
                backup_hit_count += sum(text.count(t) for t in terms)
            except OSError:
                pass
            continue
        live_files_scanned += 1
        all_hits.extend(scan_file(path, terms, chapter_scope=True))

    # ── 统计 ──────────────────────────────────────────────
    per_term = defaultdict(lambda: {"total": 0, "visible": 0, "chapter": 0})
    per_term_file = defaultdict(lambda: defaultdict(int))
    per_term_visible_samples = defaultdict(list)
    files_by_term = defaultdict(set)

    for term, field_key, bucket, snippet, line_no, is_chapter in all_hits:
        tier_is_hard = term in hard_set
        d = per_term[term]
        d["total"] += 1
        d["hard"] = tier_is_hard
        if bucket == "visible":
            d["visible"] += 1
            if len(per_term_visible_samples[term]) < 12:
                per_term_visible_samples[term].append(
                    (field_key, snippet, line_no)
                )
        if is_chapter:
            d["chapter"] += 1
        files_by_term[term].add(field_key)

    # ── 输出报告 ──────────────────────────────────────────
    report_lines: list[str] = []
    report_lines.append("# IP/MA 武侠味词汇扫描报告\n")
    report_lines.append(f"- 扫描根目录: `{root}`")
    report_lines.append(f"- 活数据文本文件数: {live_files_scanned}")
    report_lines.append(f"- 备份/快照命中总数(不计入明细): {backup_hit_count}")
    report_lines.append("- 档位: **明确武侠** = 修仙世界直接违和;**边缘** = 需上下文裁定\n")

    def render_group(title: str, term_list: list[str]) -> None:
        report_lines.append(f"\n## {title}\n")
        report_lines.append("| 词 | 总命中 | 台词/提示词等可见层 | chapter-001 范围 |")
        report_lines.append("|---|---|---|---|")
        for t in term_list:
            d = per_term.get(t)
            if not d:
                continue
            report_lines.append(
                f"| {t} | {d['total']} | {d['visible']} | {d['chapter']} |"
            )
        for t in term_list:
            samples = per_term_visible_samples.get(t)
            if not samples:
                continue
            report_lines.append(f"\n### 「{t}」可见层样例\n")
            for field_key, snippet, _ in samples:
                report_lines.append(f"- `{field_key or '?(非键值行)'}`: …{snippet}…")

    hits_terms = [t for t in per_term]
    render_group("明确武侠词", [t for t in HARD_TERMS if t in hits_terms])
    render_group("边缘词", [t for t in SOFT_TERMS if t in hits_terms])

    # 可见层样例需要文件名,重扫一遍补 file
    report_lines.append("\n## 可见层命中明细(字段+文件)\n")
    from collections import defaultdict as dd
    vis_by_file = dd(list)
    for term, field_key, bucket, snippet, line_no, is_chapter in all_hits:
        if bucket == "visible":
            vis_by_file[(field_key, snippet)].append(term)
    # 按 (field_key, snippet) 去重聚合词
    merged = {}
    for (field_key, snippet), term_list in vis_by_file.items():
        key = (field_key, snippet)
        if key not in merged:
            merged[key] = set(term_list)
    for (field_key, snippet), term_set in sorted(merged.items(), key=lambda kv: (-len(kv[1]), kv[0][0] or "")):
        report_lines.append(
            f"- [{'/'.join(sorted(term_set))}] `{field_key or '?'}`: …{snippet}…"
        )

    report_path = Path(args.report)
    report_path.write_text("\n".join(report_lines), encoding="utf-8")

    # ── stdout 摘要 ────────────────────────────────────────
    print(f"live files scanned: {live_files_scanned}")
    print(f"backup hits (excluded): {backup_hit_count}")
    print()
    print("== 明确武侠词(活数据) ==")
    for t in HARD_TERMS:
        d = per_term.get(t)
        if d:
            print(f"  {t}: total={d['total']} visible={d['visible']} chapter001={d['chapter']}")
    print("== 边缘词(活数据) ==")
    for t in SOFT_TERMS:
        d = per_term.get(t)
        if d:
            print(f"  {t}: total={d['total']} visible={d['visible']} chapter001={d['chapter']}")
    print()
    print(f"report: {report_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
