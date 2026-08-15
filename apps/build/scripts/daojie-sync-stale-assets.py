#!/usr/bin/env python3
"""Sync the 62 stale app-library assets to their 设定集 current versions.

Source of truth: apps/output/automation/daojie-shezhi-compare-final/daojie_rows.json
(rows with strong_name + verdict in {similar_version, different_content} +
corpus_newer). The app-side copies date from the May toonflow migration while
设定集 (ma-imagegen audited workflow) has since regenerated them.

Steps per asset:
  1. backup old app file -> assets/backups-shezhi-sync-<ts>/<type>/<name>
  2. copy 设定集 version -> assets/files/<type>/<name> (same filename: DB
     filePath stays valid, no schema touch needed)
  3. regenerate thumbnail via sips -z 200 200 -> assets/thumbs/<type>/<name>
  4. post-verify SHA-256(dst) == SHA-256(corpus)

The 16 app-newer pairs (local regens) are deliberately NOT touched.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime
from hashlib import sha256
from pathlib import Path

ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
ROWS = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/automation/"
            "daojie-shezhi-compare-final/daojie_rows.json")


def sha(p: Path) -> str:
    h = sha256()
    with p.open("rb") as f:
        for c in iter(lambda: f.read(1 << 20), b""):
            h.update(c)
    return h.hexdigest()


def main() -> int:
    rows = json.load(open(ROWS))
    targets = [
        r for r in rows
        if r["verdict"] in ("similar_version", "different_content")
        and r["strong_name"] and r["corpus_newer"]
    ]
    print(f"[plan] {len(targets)} stale assets to sync (app<-设定集)")

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_root = ASSETS / f"backups-shezhi-sync-{stamp}"
    synced, skipped_same, errors = 0, 0, []

    for r in targets:
        src = Path(r["corpus_path"])
        dst = Path(r["app_path"])
        try:
            if not dst.exists():
                errors.append({"dst": str(dst), "error": "app file missing"})
                continue
            if sha(dst) == sha(src):
                skipped_same += 1
                continue
            rel = dst.relative_to(ASSETS / "files")
            backup = backup_root / rel
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(dst, backup)
            shutil.copy2(src, dst)
            thumb = ASSETS / "thumbs" / rel
            if thumb.parent.exists():
                subprocess.run(
                    ["sips", "-z", "200", "200", str(dst), "--out", str(thumb)],
                    check=True, capture_output=True,
                )
            synced += 1
        except (OSError, subprocess.CalledProcessError) as exc:
            errors.append({"dst": str(dst), "error": str(exc)})

    print(f"[sync] synced={synced} already-current={skipped_same} errors={len(errors)}")

    bad = [
        r["name"] for r in targets
        if Path(r["app_path"]).exists() and sha(Path(r["app_path"])) != sha(Path(r["corpus_path"]))
    ]
    print(f"[verify] post-sync hash mismatches: {len(bad)} {bad[:5]}")
    report = ASSETS / f"shezhi-sync-report-{stamp}.json"
    report.write_text(json.dumps({
        "synced": synced, "skipped_same": skipped_same, "errors": errors,
        "verify_mismatches": bad, "backup_root": str(backup_root),
        "targets": [
            {"name": r["name"], "type": r["type"], "app": r["app_path"],
             "corpus": r["corpus_path"], "dhash": r["dhash"]}
            for r in targets
        ],
    }, ensure_ascii=False, indent=1))
    print(f"[report] {report}")
    print(f"[backup] {backup_root}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
