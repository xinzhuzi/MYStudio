#!/usr/bin/env python3
"""entity_merge_audit —— 剧本资产提取离线合并审计(只读)。

任务:10-19-script-asset-extract-all-chapters C3(D3/D8/D24;design §8;
子任务 10-19-extract-all-c3-audit-runs R1)。全量提取后扫描全部
entity-extractions 章分片与出场索引,输出**疑似重复对**清单(MD+CSV)交用户
裁定合并;用户在 UI 完成合并后重跑本脚本复核零重复(AC3' 收口口径,D24)。

输入(全部只读;工程根 = --project-root):
  store/studio-workflow/chapters/<chapterId>/entity-extractions-NNN-*.json
      —— schema 对齐 types/studio-production-types.ts:713-741:
      {version, state.entityExtractions[]: {characters/scenes/props[]…}}。
      章归属=分片所在章节目录名(落盘真源,chapterKeyOf=chapterId,见
      studio-workflow-shards.ts:97-100)。
  store/extraction/entity-appearances.json
      —— C1 出场索引(D18/D23):{key: {kind,name,aliases[],importance?,
      firstChapterId,chapterIds[]}}(entity-appearances.ts:30-43)。

审计宇宙 = 章分片聚合(按 kind+normalizeName(主名),别名/章集合并集)
∪ 出场索引条目(同键并集)——索引可能领先或滞后分片,并集兜底。

四规则(全部**同 kind** 前提;规范名 = normalizeName,与前端
entity-extraction.ts:230-236 同公式:全角转半角+lower+去空白):
  1. 别名互含   —— 双侧 {主名∪别名} 规范 token 集合相交(deduEntities
                   同款匹配面残余,entity-extraction.ts:196-200)。
  2. 编辑距离≤1 —— 规范主名 Levenshtein ≤1;**双侧名长≥2**(任意两个
                   不同单字名距离恒 1,全量误报无信息量,故单字名不参与)。
  3. 同首字+共现≥3章 —— 规范主名首字相同且 |章集A∩章集B| ≥ 3。
  4. 名称包含   —— 一侧规范主名是另一侧的严格子串(如 赵四 ⊂ 监工赵四,
                   D23 引用的跨章归并断链典型形态)。

--coverage:覆盖率 = 可解析章分片章数 / manifest chapterIndex 总数;附
分片解析失败清单与台账(store/extraction/extraction-run.json)state=failed
失败清单(真实错误文本,R6)。

只读铁律:生产数据永不以写模式打开;唯一写位 = --out 目录。
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

RULE_ALIAS = "别名互含"
RULE_EDIT = "编辑距离≤1"
RULE_COOCCUR = "同首字+共现≥3章"
RULE_CONTAIN = "名称包含"

KIND_DOMAINS = {"characters": "character", "scenes": "scene", "props": "prop"}
LIBRARY_ID_FIELDS = ("characterId", "sceneId", "assetId")
IMPORTANCE_RANK = {"npc": 1, "supporting": 2, "protagonist": 3}
RULE_SEPARATOR = "、"

CHAPTERS_REL = "store/studio-workflow/chapters"
MANIFEST_REL = "store/studio-workflow/manifest.json"
INDEX_REL = "store/extraction/entity-appearances.json"
LEDGER_REL = "store/extraction/extraction-run.json"

MD_NAME = "entity-merge-audit.md"
CSV_NAME = "entity-merge-audit.csv"


# ---------------------------------------------------------------- 归一化(与前端同公式)


def to_half_width(value: str) -> str:
    """全角 !(U+FF01)~(U+FF5E) → ASCII(entity-extraction.ts:234-236 同款)。"""
    return "".join(
        chr(ord(ch) - 0xFEE0) if 0xFF01 <= ord(ch) <= 0xFF5E else ch for ch in value
    )


def normalize_name(value: str) -> str:
    return "".join(to_half_width(value).lower().split())


def chapter_number(chapter_id: str) -> int:
    tail = chapter_id.rsplit("-", 1)[-1] if "-" in chapter_id else chapter_id
    try:
        return int(tail)
    except ValueError:
        return 0


def edit_distance_le_one(a: str, b: str) -> bool:
    """Levenshtein ≤ 1 快判(长度差先剪枝)。"""
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) == len(b):
        return sum(1 for x, y in zip(a, b) if x != y) <= 1
    if len(a) < len(b):
        a, b = b, a
    i = j = 0
    skipped = False
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        if skipped:
            return False
        skipped = True
        i += 1
    return True


# ---------------------------------------------------------------- 审计宇宙


@dataclass
class AuditEntity:
    kind: str
    key: str  # f"{kind}:{norm}"(与索引键同式)
    name: str
    aliases: list[str] = field(default_factory=list)
    chapter_ids: set[str] = field(default_factory=set)
    importance: str | None = None
    library_ids: set[str] = field(default_factory=set)

    @property
    def norm_name(self) -> str:
        return normalize_name(self.name)

    @property
    def tokens(self) -> set[str]:
        toks = {normalize_name(a) for a in self.aliases}
        toks.discard("")
        toks.add(self.norm_name)
        return toks

    @property
    def first_chapter(self) -> str:
        return min(self.chapter_ids, key=lambda c: (chapter_number(c), c)) if self.chapter_ids else "-"


@dataclass
class UniverseStats:
    shard_files: int = 0
    parse_errors: list[dict[str, str]] = field(default_factory=list)
    covered_chapters: set[str] = field(default_factory=set)
    shard_chapters: set[str] = field(default_factory=set)
    index_entries: int = 0
    entity_count: int = 0


def _merge_into(
    universe: dict[tuple[str, str], AuditEntity],
    kind: str,
    name: str,
    aliases: list[str],
    chapter_ids,
    importance: str | None,
    library_id: str | None,
) -> None:
    norm = normalize_name(name)
    if not norm:
        return
    key = (kind, norm)
    ent = universe.get(key)
    if ent is None:
        ent = AuditEntity(kind=kind, key=f"{kind}:{norm}", name=name)
        universe[key] = ent
    alias_norms = {normalize_name(a) for a in ent.aliases}
    for alias in aliases:
        an = normalize_name(alias)
        if an and an != norm and an not in alias_norms:
            alias_norms.add(an)
            ent.aliases.append(alias)
    ent.chapter_ids.update(chapter_ids)
    if importance and (
        ent.importance is None
        or IMPORTANCE_RANK.get(importance, 0) > IMPORTANCE_RANK.get(ent.importance, 0)
    ):
        ent.importance = importance
    if library_id:
        ent.library_ids.add(library_id)


def load_universe(chapters_dir: Path, index_path: Path) -> tuple[dict, UniverseStats]:
    stats = UniverseStats()
    universe: dict[tuple[str, str], AuditEntity] = {}

    if chapters_dir.is_dir():
        for chapter_dir in sorted(p for p in chapters_dir.iterdir() if p.is_dir()):
            chapter_id = chapter_dir.name
            for shard in sorted(chapter_dir.glob("entity-extractions-*.json")):
                stats.shard_files += 1
                stats.shard_chapters.add(chapter_id)
                try:
                    data = json.loads(shard.read_text(encoding="utf-8"))
                    batches = data["state"]["entityExtractions"]
                    if not isinstance(batches, list):
                        raise ValueError("state.entityExtractions 非列表")
                except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                    stats.parse_errors.append(
                        {
                            "chapter": chapter_id,
                            "path": str(shard.relative_to(chapters_dir)),
                            "error": f"{type(exc).__name__}: {exc}",
                        }
                    )
                    continue
                stats.covered_chapters.add(chapter_id)
                for batch in batches:
                    if not isinstance(batch, dict):
                        continue
                    for domain, kind in KIND_DOMAINS.items():
                        rows = batch.get(domain) or []
                        if not isinstance(rows, list):
                            continue
                        for row in rows:
                            if not isinstance(row, dict):
                                continue
                            name = str(row.get("name") or "").strip()
                            if not name:
                                continue
                            aliases = [
                                str(a).strip()
                                for a in (row.get("aliases") or [])
                                if str(a).strip()
                            ]
                            lib_id = next(
                                (str(row[f]) for f in LIBRARY_ID_FIELDS if row.get(f)),
                                None,
                            )
                            importance = row.get("importance")
                            _merge_into(
                                universe,
                                kind,
                                name,
                                aliases,
                                [chapter_id],
                                importance if importance in IMPORTANCE_RANK else None,
                                lib_id,
                            )

    if index_path.is_file():
        try:
            index = json.loads(index_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, json.JSONDecodeError):
            index = None
        if isinstance(index, dict):
            for entry in index.values():
                if not isinstance(entry, dict):
                    continue
                kind = entry.get("kind")
                name = str(entry.get("name") or "").strip()
                if kind not in set(KIND_DOMAINS.values()) or not name:
                    continue
                stats.index_entries += 1
                aliases = [
                    str(a).strip() for a in (entry.get("aliases") or []) if str(a).strip()
                ]
                chapters = [
                    str(c) for c in (entry.get("chapterIds") or []) if str(c).strip()
                ]
                _merge_into(
                    universe,
                    kind,
                    name,
                    aliases,
                    chapters,
                    entry.get("importance"),
                    None,
                )
    stats.entity_count = len(universe)
    return universe, stats


# ---------------------------------------------------------------- 规则与配对


@dataclass
class SuspectPair:
    kind: str
    a: AuditEntity
    b: AuditEntity
    rules: list[str]
    cooccur: int


def pair_rules(a: AuditEntity, b: AuditEntity) -> list[str]:
    rules: list[str] = []
    if a.tokens & b.tokens:
        rules.append(RULE_ALIAS)
    na, nb = a.norm_name, b.norm_name
    if len(na) >= 2 and len(nb) >= 2 and edit_distance_le_one(na, nb):
        rules.append(RULE_EDIT)
    if na and nb and na[0] == nb[0] and len(a.chapter_ids & b.chapter_ids) >= 3:
        rules.append(RULE_COOCCUR)
    if na != nb and (na in nb or nb in na):
        rules.append(RULE_CONTAIN)
    return rules


def build_pairs(universe: dict[tuple[str, str], AuditEntity]) -> list[SuspectPair]:
    entities = sorted(universe.values(), key=lambda e: (e.kind, e.key))
    pairs: list[SuspectPair] = []
    for i, a in enumerate(entities):
        for b in entities[i + 1 :]:
            if a.kind != b.kind:
                continue
            rules = pair_rules(a, b)
            if rules:
                pairs.append(
                    SuspectPair(
                        kind=a.kind,
                        a=a,
                        b=b,
                        rules=rules,
                        cooccur=len(a.chapter_ids & b.chapter_ids),
                    )
                )
    return pairs


# ---------------------------------------------------------------- 报告


def _row(pair: SuspectPair) -> dict[str, str]:
    return {
        "类别": pair.a.kind,
        "实体A": pair.a.name,
        "A别名": "/".join(pair.a.aliases) or "-",
        "A首章": pair.a.first_chapter,
        "A章数": str(len(pair.a.chapter_ids)),
        "实体B": pair.b.name,
        "B别名": "/".join(pair.b.aliases) or "-",
        "B首章": pair.b.first_chapter,
        "B章数": str(len(pair.b.chapter_ids)),
        "命中规则": RULE_SEPARATOR.join(pair.rules),
        "共现章数": str(pair.cooccur),
    }


def write_reports(pairs: list[SuspectPair], out_dir: Path, stats: UniverseStats,
                  coverage_lines: list[str] | None = None) -> tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / CSV_NAME
    md_path = out_dir / MD_NAME
    rows = [_row(p) for p in pairs]

    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()) if rows else
                                ["类别", "实体A", "A别名", "A首章", "A章数",
                                 "实体B", "B别名", "B首章", "B章数", "命中规则", "共现章数"])
        writer.writeheader()
        writer.writerows(rows)

    lines = [
        "# 实体合并审计报告(疑似重复对)",
        "",
        f"- 生成时刻: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        f"- 输入: 章分片 {stats.shard_files} 件(解析失败 {len(stats.parse_errors)}),"
        f"出场索引条目 {stats.index_entries},聚合实体 {stats.entity_count}",
        f"- 疑似重复对: {len(pairs)} 对(规则仅同 kind 前提;单字名不参与编辑距离规则)",
        "- 规则: ①别名互含(名∪别名的规范 token 相交) ②编辑距离≤1(名长≥2)"
        " ③同首字+共现≥3章 ④名称包含(严格子串)",
        "",
    ]
    if coverage_lines:
        lines += ["## 覆盖率与失败清单", ""] + coverage_lines + [""]
    if rows:
        header = ("| # | 类别 | 实体A | A别名 | A首章 | A章数 | 实体B | B别名 | B首章"
                  " | B章数 | 命中规则 | 共现章数 |")
        lines += [header, "|" + "---|" * 12]
        for idx, row in enumerate(rows, 1):
            cells = [str(idx)] + [str(row[k]) for k in
                                  ("类别", "实体A", "A别名", "A首章", "A章数",
                                   "实体B", "B别名", "B首章", "B章数", "命中规则", "共现章数")]
            lines.append("| " + " | ".join(cells) + " |")
    else:
        lines += ["(无疑似重复对)"]
    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return md_path, csv_path


# ---------------------------------------------------------------- 覆盖率


def build_coverage(
    stats: UniverseStats,
    manifest_path: Path,
    ledger_path: Path,
    total_override: int | None,
) -> list[str]:
    if total_override is not None:
        total = total_override
        manifest_note = "--total-chapters"
    elif manifest_path.is_file():
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            ids = [str(c.get("id")) for c in (manifest.get("chapterIndex") or [])]
            total = len(ids)
            manifest_note = "manifest"
        except (OSError, ValueError, json.JSONDecodeError, AttributeError):
            ids, total, manifest_note = [], 0, "manifest 解析失败"
    else:
        raise SystemExit(
            f"error: 覆盖率分母不可得(manifest 缺失: {manifest_path});"
            "请传 --total-chapters 或 --manifest"
        )

    covered = len(stats.covered_chapters & set(ids)) if ids else len(stats.covered_chapters)
    pct = (covered / total * 100) if total else 0.0
    lines = [
        "== 实体提取覆盖率 ==",
        f"总章数({manifest_note}): {total}",
        f"已覆盖: {covered}",
        f"覆盖率: {pct:.1f}%",
    ]
    if ids:
        no_shard = [cid for cid in ids if cid not in stats.shard_chapters]
        if no_shard:
            lines.append(f"无分片章: {len(no_shard)}")
            lines += [f"  - {cid}" for cid in no_shard]
    outside = sorted(stats.shard_chapters - set(ids)) if ids else []
    if outside:
        lines.append(f"分片章不在 manifest: {len(outside)}")
        lines += [f"  - {cid}" for cid in outside]
    if stats.parse_errors:
        lines.append(f"分片解析失败: {len(stats.parse_errors)}")
        lines += [f"  - {p['path']}: {p['error']}" for p in stats.parse_errors]
    failures = []
    if ledger_path.is_file():
        try:
            ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
            chapters = ledger.get("chapters") or {}
            failures = [
                (cid, entry) for cid, entry in chapters.items()
                if isinstance(entry, dict) and entry.get("state") == "failed"
            ]
        except (OSError, ValueError, json.JSONDecodeError):
            lines.append("台账: 解析失败(失败清单不可得)")
    if failures:
        lines.append(f"台账失败章: {len(failures)}")
        for cid, entry in sorted(failures):
            err = entry.get("error") or "(无错误文本)"
            attempts = entry.get("attempts")
            suffix = f" (attempts={attempts})" if attempts is not None else ""
            lines.append(f"  - {cid}: {err}{suffix}")
    return lines


# ---------------------------------------------------------------- CLI


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="剧本资产提取离线合并审计(只读;输出疑似重复对与覆盖率)"
    )
    parser.add_argument("--project-root", required=True, help="工程数据根(如 …/IP/MA)")
    parser.add_argument("--out", help="报告输出目录(写 entity-merge-audit.md/.csv)")
    parser.add_argument("--coverage", action="store_true", help="输出覆盖率与失败清单")
    parser.add_argument("--total-chapters", type=int, default=None,
                        help="覆盖率分母覆写(默认取 manifest chapterIndex 数)")
    parser.add_argument("--chapters-dir", default=None, help="覆写章分片目录")
    parser.add_argument("--index", default=None, help="覆写出场索引路径")
    parser.add_argument("--manifest", default=None, help="覆写 manifest 路径")
    parser.add_argument("--ledger", default=None, help="覆写台账路径")
    args = parser.parse_args(argv)

    if not args.out and not args.coverage:
        parser.error("--out 与 --coverage 至少其一")

    root = Path(args.project_root)
    chapters_dir = Path(args.chapters_dir) if args.chapters_dir else root / CHAPTERS_REL
    index_path = Path(args.index) if args.index else root / INDEX_REL
    manifest_path = Path(args.manifest) if args.manifest else root / MANIFEST_REL
    ledger_path = Path(args.ledger) if args.ledger else root / LEDGER_REL

    universe, stats = load_universe(chapters_dir, index_path)
    pairs = build_pairs(universe)

    coverage_lines = build_coverage(stats, manifest_path, ledger_path,
                                    args.total_chapters) if args.coverage else None

    if args.out:
        md_path, csv_path = write_reports(pairs, Path(args.out), stats, coverage_lines)
        print(
            f"实体 {len(universe)} / 疑似重复对 {len(pairs)};"
            f"报告 → {md_path} / {csv_path}"
        )
    if coverage_lines:
        print("\n".join(coverage_lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
