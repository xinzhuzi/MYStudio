#!/usr/bin/env python3
"""晏燎图库重置(1020 用户两步令·第一步):设定集主角 30 张全量替换图库+改写 db 引用。

终态:files/role/晏燎/ == 设定集源 30 张(逐文件 md5 全等,文件名=源基名);
db 晏燎行 main=晏燎_练气期_正视图_v1.png,images[]=30 条(name=去扩展名基名,
顺序=源境界目录序);thumbs/role/晏燎/ 镜像 200x200;旧件(含日期名生成图)移备份目录不直删。

安全:默认 dry-run;--apply 先备份 assets.db 再动刀;建议动刀前另拍 store 快照
(store_snapshot.py)并退出 App。

用法:
  python3 asset_yanliao_refresh_1020.py --apply
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

SRC = Path("/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集/1.人物角色/1.主角")
ASSETS_ROOT = Path("/Users/zhengbingjin/Project/IP/MA/store/assets")
DST = ASSETS_ROOT / "files" / "role" / "晏燎"
THUMB = ASSETS_ROOT / "thumbs" / "role" / "晏燎"
DB = ASSETS_ROOT / "assets.db"
ASSET_ID = "a985c52a-af2a-4089-a188-39281fa20976"
MAIN_REL = "role/晏燎/晏燎_练气期_正视图_v1.png"
IMG_EXTS = (".png", ".jpg", ".jpeg", ".webp")


def md5(p: Path) -> str:
    h = hashlib.md5()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def source_files() -> list[Path]:
    out: list[Path] = []
    for dp, _, names in os.walk(SRC):
        for n in sorted(names):
            if n.lower().endswith(IMG_EXTS):
                out.append(Path(dp) / n)
    # 境界目录序:1.炼气期 … 10.共主期(目录名本身可字典序排)
    return sorted(out, key=lambda p: (p.parent.name, p.name))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    srcs = source_files()
    if not (5 <= len(srcs) <= 80):
        print(f"源图数异常: {len(srcs)}")
        return 2

    dst_now = {p.name for p in DST.iterdir() if p.is_file() and not p.name.startswith(".")}
    src_names = {p.name for p in srcs}
    to_copy = [p for p in srcs if p.name not in dst_now or md5(p) != md5(DST / p.name)]
    to_drop = sorted(dst_now - src_names)

    print(f"源={len(srcs)} 图库现存={len(dst_now)} 拷入/覆盖={len(to_copy)} 移出={len(to_drop)}")
    for p in to_copy:
        print("  + ", p.name)
    for n in to_drop:
        print("  - ", n)

    if not args.apply:
        print("dry-run:未改动。加 --apply 执行。")
        return 0

    # 动刀三保险:db 备份 + 旧件移备份目录(不直删)
    bak_db = ASSETS_ROOT / f"assets.db.bak-yanliao-refresh-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(DB, bak_db)
    print(f"db 备份 -> {bak_db.name}")
    old_dir = ASSETS_ROOT / "backups" / f"yanliao-refresh-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    old_dir.mkdir(parents=True, exist_ok=True)
    for n in to_drop:
        (DST / n).rename(old_dir / n)
        t = THUMB / n
        if t.exists():
            t.rename(old_dir / f"thumb__{n}")

    for p in to_copy:
        shutil.copy2(p, DST / p.name)

    # db:main + images[](name=去扩展名基名,顺序=源境界序)
    images = [{"name": p.stem, "filePath": f"role/晏燎/{p.name}"} for p in srcs]
    con = sqlite3.connect(DB)
    con.execute(
        "UPDATE assets SET filePath=?, images=?, updatedAt=? WHERE id=?",
        (MAIN_REL, json.dumps(images, ensure_ascii=False), datetime.utcnow().isoformat() + "Z", ASSET_ID),
    )
    con.commit()
    con.close()
    print(f"db 改写: main={MAIN_REL}, images[]={len(images)} 条")

    # thumbs 镜像(app 同款 sips 200x200)
    THUMB.mkdir(parents=True, exist_ok=True)
    for p in srcs:
        subprocess.run(["sips", "-z", "200", "200", str(DST / p.name), "--out", str(THUMB / p.name)],
                       capture_output=True)
    print(f"thumbs 镜像 {len(srcs)} 张")
    print(f"旧件备份目录: {old_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
