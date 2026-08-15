#!/usr/bin/env python3
"""Register the 173 missing 设定集 assets into the app's assets.db.

Companion to daojie-migrate-shezhi-to-ipma.py: that script placed files in
IP/MA/assets/files (workspace mirror); this one makes the RUNNING app's
素材库 aware of the previously-unregistered assets:

  1. online SQLite backup of assets.db
  2. copy 设定集 file -> app assets/files/<type>/<sanitized name>
  3. sips -z 200 200 thumbnail -> app assets/thumbs/<type>/<same name>
     (mirrors studio-assets-storage.ts enqueueThumb convention)
  4. INSERT row (id=uuid, name=stem, source='toonflow-migrated',
     images/tags='[]', ISO timestamps)

Idempotent: rows are keyed by filePath; existing filePath or name+type rows
are skipped. App-safe: the app shells out to sqlite3 per operation with no
long-lived connection; online .backup avoids torn reads.
"""
from __future__ import annotations

import json
import re
import shutil
import sqlite3
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

CORPUS = Path("/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集")
ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
IPMA_REPORTS = Path("/Users/zhengbingjin/Project/IP/MA")

UNSAFE = re.compile(r'[/\\:*?"<>|\']')


def latest_plan() -> list[dict]:
    plans = sorted(IPMA_REPORTS.glob("assets-migration-report-*/plan.json"))
    data = json.load(open(plans[-1]))
    return [r for r in data["plan"] if r["note"] == "missing(corpus-name)"]


def main() -> int:
    rows = latest_plan()
    print(f"[plan] {len(rows)} missing assets to register")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    db = ASSETS / "assets.db"
    backup = ASSETS / f"assets.db.bak-shezhi-import-{stamp}"
    subprocess.run(["sqlite3", str(db), f".backup '{backup}'"], check=True)
    print(f"[backup] {backup.name} ({backup.stat().st_size/1e6:.1f} MB)")

    con = sqlite3.connect(db)
    existing_paths = {
        r[0] for r in con.execute("SELECT filePath FROM assets WHERE filePath IS NOT NULL")
    }
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    inserted, skipped_path, skipped_name, errors = 0, 0, 0, []
    for row in rows:
        src = Path(row["src"])
        atype = row["dst"].split("assets/files/")[-1].split("/")[0]
        safe = UNSAFE.sub("_", src.stem) + src.suffix.lower()
        rel = f"{atype}/{safe}"
        name = UNSAFE.sub("_", src.stem)

        if rel in existing_paths:
            skipped_path += 1
            continue
        dup = con.execute(
            "SELECT id FROM assets WHERE type=? AND name=? LIMIT 1", (atype, name)
        ).fetchone()
        if dup:
            skipped_name += 1
            continue

        dst = ASSETS / "files" / rel
        thumb = ASSETS / "thumbs" / rel
        try:
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists():
                shutil.copy2(src, dst)
            thumb.parent.mkdir(parents=True, exist_ok=True)
            if not thumb.exists():
                subprocess.run(
                    ["sips", "-z", "200", "200", str(dst), "--out", str(thumb)],
                    check=True, capture_output=True,
                )
            con.execute(
                "INSERT INTO assets (id,type,name,description,prompt,setting,remark,"
                "tags,filePath,images,source,createdAt,updatedAt) VALUES "
                "(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (str(uuid.uuid4()), atype, name, "", "", "", "", "[]", rel, "[]",
                 "toonflow-migrated", now, now),
            )
            inserted += 1
        except (OSError, subprocess.CalledProcessError) as exc:
            errors.append({"src": str(src), "error": str(exc)})

    con.commit()

    # verify: every inserted filePath resolves to an existing file + thumb
    bad_files, bad_thumbs, total_type = [], [], {}
    for rel, in con.execute(
        "SELECT filePath FROM assets WHERE source='toonflow-migrated' AND createdAt=?", (now,)
    ):
        if not (ASSETS / "files" / rel).exists():
            bad_files.append(rel)
        if not (ASSETS / "thumbs" / rel).exists():
            bad_thumbs.append(rel)
    for atype, in con.execute("SELECT DISTINCT type FROM assets"):
        n = con.execute("SELECT COUNT(*) FROM assets WHERE type=?", (atype,)).fetchone()[0]
        total_type[atype] = n
    con.close()

    print(f"[db] inserted={inserted} skipped(existing path)={skipped_path} "
          f"skipped(name dup)={skipped_name} errors={len(errors)}")
    print(f"[verify] missing files={len(bad_files)} missing thumbs={len(bad_thumbs)}")
    print(f"[db] totals by type: {total_type}")
    report = ASSETS / f"shezhi-import-report-{stamp}.json"
    report.write_text(json.dumps({
        "inserted": inserted, "skipped_path": skipped_path, "skipped_name": skipped_name,
        "errors": errors, "bad_files": bad_files, "bad_thumbs": bad_thumbs,
        "backup": str(backup),
    }, ensure_ascii=False, indent=1))
    print(f"[report] {report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
