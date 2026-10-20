#!/usr/bin/env python3
"""晏燎图生图战役·轮间主图指针(1020):把行级主图直指下一张目标原图。

每轮一句 UPDATE:filePath=目标原图相对路径(文件零复制);若现主图是上一轮产物
(名带 _xxxx年xx月xx日 后缀)且未在 images[] 里,同句收编防孤儿。
弹窗重开后 index0=新主图,图生图参考与产物名(原图名_中文日期)均由此天然正确。

用法: python3 asset_yanliao_i2i_pointer_1020.py --target 晏燎_练气期_三视图_v1
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB = Path("/Users/zhengbingjin/Project/IP/MA/store/assets/assets.db")
ASSET_ID = "a985c52a-af2a-4089-a188-39281fa20976"
FOLDER = "role/晏燎"
OUT_RE = re.compile(r"_\d{4}年\d{2}月\d{2}日(_\d+)?$")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", required=True, help="目标原图基名(不含扩展名)")
    args = ap.parse_args()

    rel = f"{FOLDER}/{args.target}.png"
    con = sqlite3.connect(DB)
    fp, imgs = con.execute("SELECT filePath, images FROM assets WHERE id=?", (ASSET_ID,)).fetchone()
    images = json.loads(imgs or "[]")
    appended = None
    if fp and OUT_RE.search(fp.rsplit("/", 1)[-1].rsplit(".", 1)[0]) and not any(i.get("filePath") == fp for i in images):
        appended = {"name": fp.rsplit("/", 1)[-1].rsplit(".", 1)[0], "filePath": fp}
        images.append(appended)
    con.execute(
        "UPDATE assets SET filePath=?, images=?, updatedAt=? WHERE id=?",
        (rel, json.dumps(images, ensure_ascii=False), datetime.utcnow().isoformat() + "Z", ASSET_ID),
    )
    con.commit()
    con.close()
    print(json.dumps({"main": rel, "appendedOutput": appended, "imagesCount": len(images)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
