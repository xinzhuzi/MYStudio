#!/usr/bin/env python3
"""Migrate 设定集 images into the IP/MA workspace asset library.

Scope (per user contract 2026-08-15):
  - Source (READ-ONLY, never written): 设定集 under Unity MA Design.
  - Target: /Users/zhengbingjin/Project/IP/MA/assets/files/<role|scene|tool>/
  - 道具/场景/人物 categories:
      1.人物角色 -> role | 2.背景势力 -> scene | 3.地理形状 -> scene
      4.经济资源 -> tool  | 8.仙国政治 -> scene (国家概念图)
  - Mapped assets (assets.db rows whose name matches a corpus filename) copy
    under their APP filename so existing project references stay aligned.
  - Missing assets (corpus files never migrated) copy under original names.
  - Same-name overwrite: if target exists with different SHA-256, back it up
    to IP/MA/backups/assets-migration-<ts>/ then replace. Identical -> skip.
  - Excludes *_thumb*, *production_prev*, non-image files.

Usage:
  python3 daojie-migrate-shezhi-to-ipma.py            # dry-run + plan report
  python3 daojie-migrate-shezhi-to-ipma.py --execute  # copy + verify report
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

CORPUS = Path("/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集")
ASSETS_DB = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets/assets.db")
IPMA = Path("/Users/zhengbingjin/Project/IP/MA")

DIR_TYPE = {
    "1.人物角色": "role",
    "2.背景势力": "scene",
    "3.地理形状": "scene",
    "4.经济资源": "tool",
    "8.仙国政治": "scene",
}
IMG_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
SUBSTRING_HIT_LIMIT = 8


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def wanted(path: Path) -> bool:
    parts = path.parts
    name = path.name
    return (
        path.suffix.lower() in IMG_SUFFIXES
        and "_thumb" not in path.stem
        and "production_prev" not in path.stem
        # 缩略图 subtree = thumbnail PNG copies (names lack _thumb);
        # AI生图 subtree = generation workbench (same-name boards per category).
        and "缩略图" not in parts
        and "AI生图" not in parts
        and not name.startswith(".")
    )


def build_name_pairs(corpus_by_stem: dict[str, list[Path]]):
    con = sqlite3.connect(ASSETS_DB)
    rows = con.execute(
        "SELECT id, type, name, filePath FROM assets "
        "WHERE filePath IS NOT NULL AND (filePath LIKE '%.png' OR filePath LIKE '%.jpg' "
        "OR filePath LIKE '%.jpeg' OR filePath LIKE '%.webp')"
    ).fetchall()
    con.close()
    pairs, unmatched = [], 0
    for aid, atype, name, fpath in rows:
        if not name:
            unmatched += 1
            continue
        if name in corpus_by_stem:
            best = sorted(corpus_by_stem[name], key=lambda p: len(p.stem))[0]
            pairs.append((atype, Path(fpath).name, best))
            continue
        hits = [ps for stem, ps in corpus_by_stem.items() if name in stem]
        flat = [p for group in hits for p in group]
        if len(flat) <= SUBSTRING_HIT_LIMIT and flat:
            best = sorted(flat, key=lambda p: len(p.stem))[0]
            pairs.append((atype, Path(fpath).name, best))
        else:
            unmatched += 1
    return pairs, unmatched


@dataclass
class PlanRow:
    action: str          # copy_new | overwrite_diff | skip_same | collision_skip
    src: str
    dst: str
    src_sha: str = ""
    dst_sha: str = ""
    note: str = ""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="actually copy (default dry-run)")
    parser.add_argument("--limit", type=int, default=0, help="debug: cap plan size")
    args = parser.parse_args()

    started = time.time()
    corpus_by_stem: dict[str, list[Path]] = {}
    for top, _ in DIR_TYPE.items():
        for p in (CORPUS / top).rglob("*"):
            if p.is_file() and wanted(p):
                corpus_by_stem.setdefault(p.stem, []).append(p)
    corpus_all = [p for group in corpus_by_stem.values() for p in group]
    print(f"[corpus] {len(corpus_all)} candidate images across {len(DIR_TYPE)} category dirs")

    pairs, unmatched_assets = build_name_pairs(corpus_by_stem)
    print(f"[assets.db] mapped pairs: {len(pairs)}, unmatched app assets (left as-is): {unmatched_assets}")

    # --- build plan: mapped assets first (they claim their app filename) ---
    plan: list[PlanRow] = []
    claimed_dst: dict[str, str] = {}   # dst -> src sha (for collision detect)
    used_corpus: set[str] = set()

    def add_row(atype: str, filename: str, src: Path, note: str) -> None:
        dst = IPMA / "assets" / "files" / atype / filename
        dst_key = str(dst)
        src_sha = sha256(src)
        if dst_key in claimed_dst:
            if claimed_dst[dst_key] != src_sha:
                plan.append(PlanRow("collision_skip", str(src), dst_key, src_sha,
                                    note=f"{note}; dst already claimed by different content"))
            return
        claimed_dst[dst_key] = src_sha
        used_corpus.add(str(src))
        action, dst_sha = "copy_new", ""
        if dst.exists():
            dst_sha = sha256(dst)
            action = "skip_same" if dst_sha == src_sha else "overwrite_diff"
        plan.append(PlanRow(action, str(src), dst_key, src_sha, dst_sha, note))

    for atype, app_filename, corpus_path in pairs:
        add_row(atype, app_filename, corpus_path, "mapped(app-name)")

    missing_count = 0
    for p in sorted(corpus_all):
        if str(p) in used_corpus:
            continue
        top = p.relative_to(CORPUS).parts[0]
        add_row(DIR_TYPE[top], p.name, p, "missing(corpus-name)")
        missing_count += 1
    print(f"[plan] missing corpus files to add: {missing_count}")

    if args.limit:
        plan = plan[: args.limit]

    counts: dict[str, int] = {}
    for row in plan:
        counts[row.action] = counts.get(row.action, 0) + 1
    print(f"[plan] {len(plan)} rows: {counts}")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = IPMA / f"assets-migration-report-{stamp}"
    report_dir.mkdir(parents=True, exist_ok=True)

    # --- execute ---
    backup_root = IPMA / "backups" / f"assets-migration-{stamp}"
    copied, overwritten, errors = 0, 0, []
    if args.execute:
        for row in plan:
            src, dst = Path(row.src), Path(row.dst)
            try:
                if row.action == "copy_new":
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
                    copied += 1
                elif row.action == "overwrite_diff":
                    backup = backup_root / dst.relative_to(IPMA)
                    backup.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(dst, backup)
                    shutil.copy2(src, dst)
                    overwritten += 1
            except OSError as exc:
                errors.append({"src": row.src, "error": str(exc)})
        print(f"[execute] copied={copied} overwritten={overwritten} errors={len(errors)}")

        # --- post-verify: every plan row's dst sha must equal src sha ---
        bad = []
        for row in plan:
            if row.action == "collision_skip":
                continue
            try:
                if sha256(Path(row.dst)) != row.src_sha:
                    bad.append(row.dst)
            except OSError:
                bad.append(row.dst)
        print(f"[verify] hash mismatches after copy: {len(bad)}")
        (report_dir / "verify-mismatch.json").write_text(json.dumps(bad, ensure_ascii=False, indent=1))
        (report_dir / "errors.json").write_text(json.dumps(errors, ensure_ascii=False, indent=1))

    payload = {
        "schema": "mystudio.daojie.ipma.migration.v1",
        "mode": "execute" if args.execute else "dry-run",
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "corpus_root": str(CORPUS),
        "target_root": str(IPMA / "assets" / "files"),
        "counts": counts,
        "mapped_pairs": len(pairs),
        "missing_added": missing_count,
        "backup_root": str(backup_root) if args.execute else None,
        "plan": [asdict(r) for r in plan],
    }
    (report_dir / "plan.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1))

    md = report_dir / "report.md"
    with md.open("w") as f:
        f.write(f"# 设定集 → IP/MA 资产迁移{'(执行)' if args.execute else '(预演)'}\n\n")
        f.write(f"时间: {payload['generated_at']}  耗时: {time.time()-started:.0f}s\n\n")
        f.write(f"- 语料图片: {len(corpus_all)}(排除 _thumb/production_prev)\n")
        f.write(f"- assets.db 名称映射: {len(pairs)} 对;未匹配应用资产(不动): {unmatched_assets}\n")
        f.write(f"- 缺失补齐: {missing_count}\n")
        for action, n in sorted(counts.items()):
            f.write(f"- {action}: {n}\n")
        if args.execute:
            f.write(f"- 实际复制: {copied};覆盖(含备份): {overwritten};错误: {len(errors)}\n")
            f.write(f"- 备份目录: {backup_root}\n")
    print(f"[report] {md}")
    print(f"[done] {time.time()-started:.0f}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
