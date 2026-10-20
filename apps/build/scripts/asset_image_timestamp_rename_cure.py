#!/usr/bin/env python3
"""存量治愈:资产库图片文件名时间戳后缀 → 中文日期后缀(10-19 命名裁定,1020 追报)。

背景:replaceAssetMainImage 旧版恒给换上的主图起 `资产名_<13位时间戳>.png`
(271bf030 已绝根);本脚本把库内既存的时间戳后缀文件名按时间戳自身编码的
生成日期转成 `<原名>_xxxx年xx月xx日`,并同步改写 assets.db 的行级 filePath
与 images[](filePath+name)与 files/thumbs 两镜像目录里的实体文件。

安全:
  - 默认 dry-run,--apply 才动刀;动刀前自动备份 assets.db;
  - 只认严格 `_<恰好13位数字>` 尾缀(扩展名前),不误伤含数字的正常名;
  - 目标名撞车(盘上已有/同批已占)用 _2/_3 数字后缀,与存储层去重式样一致;
  - 库外交叉引用已核零(2026-10-20 扫 store/ 全域,只有 assets.db 引用这些名)。

用法:
  python3 asset_image_timestamp_rename_cure.py --assets-root /path/to/store/assets
  python3 asset_image_timestamp_rename_cure.py --assets-root ... --apply
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

TS_RE = re.compile(r"^(?P<base>.+)_(?P<ts>\d{13})$")
# 尾缀检测:时间戳后跟扩展名或串尾(文件名带 .png,不能裸锚 $)
TS_SUFFIX_RE = re.compile(r"_(\d{13})(?=\.[^.]*$|$)")


def chinese_date(ms: int) -> str:
    dt = datetime.fromtimestamp(ms / 1000)
    return f"{dt.year}年{dt.month:02d}月{dt.day:02d}日"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--assets-root", required=True, help="store/assets 目录(含 assets.db/files/thumbs)")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    root = Path(args.assets_root)
    db_path = root / "assets.db"
    files_dir = root / "files"
    thumbs_dir = root / "thumbs"
    if not db_path.exists():
        print(f"找不到 {db_path}")
        return 2

    con = sqlite3.connect(db_path)
    rows = con.execute("SELECT id, type, name, filePath, images FROM assets").fetchall()

    # subDir 内已占用名(盘上现存 + 本批已计划)
    taken: dict[str, set[str]] = {}

    def occupy(sub: str, stem: str) -> str:
        bucket = taken.setdefault(sub, set())
        # 盘上现存也占名
        d = files_dir / sub
        if d.exists():
            bucket.update(p.stem for p in d.iterdir() if p.is_file())
        final = stem
        n = 2
        while final in bucket:
            final = f"{stem}_{n}"
            n += 1
        bucket.add(final)
        return final

    plans: list[dict] = []  # {assetId, sub, oldRel, newRel, ext, nameOld, nameNew}
    for aid, _typ, _name, fp, imgs in rows:
        entries: list[tuple[str, str | None]] = []
        if fp and TS_SUFFIX_RE.search(fp.rsplit("/", 1)[-1]):
            entries.append(("main", fp))
        try:
            for im in json.loads(imgs or "[]"):
                p = im.get("filePath", "")
                if p and TS_SUFFIX_RE.search(p.rsplit("/", 1)[-1]):
                    entries.append(("img", p))
        except Exception:
            pass
        for kind, rel in entries:
            sub, fname = rel.rsplit("/", 1)
            m = TS_RE.match(fname.rsplit(".", 1)[0]) if "." in fname else None
            ext = ("." + fname.rsplit(".", 1)[1]) if "." in fname else ""
            if not m:
                continue
            stem = f"{m.group('base')}_{chinese_date(int(m.group('ts')))}"
            final_stem = occupy(sub, stem)
            plans.append({
                "assetId": aid, "kind": kind, "sub": sub,
                "oldRel": rel, "newRel": f"{sub}/{final_stem}{ext}",
                "ext": ext, "newStem": final_stem,
            })

    if not plans:
        print("零命中:库内无时间戳尾缀图片名")
        return 0

    print(f"计划改名 {len(plans)} 处(涉及资产 {len({p['assetId'] for p in plans})} 个):")
    for p in plans:
        print(f"  [{p['kind']}] {p['oldRel']}  ->  {p['newRel']}")

    if not args.apply:
        print("dry-run:未改动。加 --apply 执行(会先备份 assets.db)。")
        return 0

    bak = root / f"assets.db.bak-ts-cure-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(db_path, bak)
    print(f"已备份 db -> {bak.name}")

    moved = missing = 0
    for p in plans:
        src_f, dst_f = files_dir / p["oldRel"], files_dir / p["newRel"]
        if src_f.exists():
            src_f.parent.mkdir(parents=True, exist_ok=True)
            src_f.rename(dst_f)
            moved += 1
            src_t = thumbs_dir / p["oldRel"]
            if src_t.exists():
                src_t.parent.mkdir(parents=True, exist_ok=True)
                src_t.rename(thumbs_dir / p["newRel"])
        else:
            missing += 1
            print(f"  ! 缺实体仅改引用: {p['oldRel']}")
    print(f"实体改名 {moved} 处,缺实体 {missing} 处")

    for aid, _typ, _name, fp, imgs in rows:
        new_fp = fp
        for p in plans:
            if p["assetId"] == aid and p["kind"] == "main" and fp == p["oldRel"]:
                new_fp = p["newRel"]
        try:
            images = json.loads(imgs or "[]")
        except Exception:
            images = []
        changed = False
        for im in images:
            for p in plans:
                if p["assetId"] == aid and p["kind"] == "img" and im.get("filePath") == p["oldRel"]:
                    im["filePath"] = p["newRel"]
                    # name 同步:存档名约定=文件基名(旧名带不带时间戳尾缀都对齐新基名)
                    im["name"] = p["newStem"]
                    changed = True
        if new_fp != fp or changed:
            con.execute(
                "UPDATE assets SET filePath=?, images=?, updatedAt=? WHERE id=?",
                (new_fp, json.dumps(images, ensure_ascii=False), datetime.utcnow().isoformat() + "Z", aid),
            )
    con.commit()
    con.close()
    print("assets.db 改写完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
