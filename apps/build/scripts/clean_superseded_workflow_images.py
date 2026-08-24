#!/usr/bin/env python3
"""清理被取代的旧代分镜生图(08-24 用户裁定:旧版图不需要了)。

安全口径:
1. 引用集 = 全 store(live,排 bak)中任何指向 workflow-images/ 的字符串
   (project-file:// 虚拟、绝对路径、file:// 均归一为 workflow-images/ 相对路径);
2. 磁盘集 = <项目根>/workflow-images/** 全部文件;
3. 差集(零引用)移动到 <项目根>/backups/superseded-workflow-images-<ts>/(保形,可整目录回滚);
4. --dry 只统计不移动。应用运行中可安全执行(不动 store,只动无引用文件)。
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import unquote

PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORE = PROJECT_ROOT / "store"
WI_ROOT = PROJECT_ROOT / "workflow-images"
MARKER = "workflow-images/"


def collect_referenced() -> set[str]:
    referenced: set[str] = set()

    def harvest(value):
        if isinstance(value, dict):
            for x in value.values():
                harvest(x)
        elif isinstance(value, list):
            for x in value:
                harvest(x)
        elif isinstance(value, str) and MARKER in value:
            raw = unquote(value)
            idx = raw.index(MARKER)
            rel = raw[idx + len(MARKER):]
            # URL 形态的 %xx 再解一层(双重编码防御)
            rel = unquote(rel)
            referenced.add(rel.strip("/"))

    for f in STORE.rglob("*.json"):
        if "bak-" in f.name or ".backup" in f.name or "/backups/" in str(f):
            continue
        try:
            harvest(json.loads(f.read_text()))
        except Exception:
            continue
    return referenced


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    referenced = collect_referenced()
    disk = [p for p in WI_ROOT.rglob("*") if p.is_file()]
    orphans = [p for p in disk if str(p.relative_to(WI_ROOT)) not in referenced]
    size = sum(p.stat().st_size for p in orphans)

    print(f"引用集: {len(referenced)} 条 workflow-images 引用")
    print(f"磁盘文件: {len(disk)} 个;零引用旧图: {len(orphans)} 个,共 {size/1024/1024:.1f} MB")
    for p in orphans[:8]:
        print("  旧图:", p.relative_to(WI_ROOT))
    if len(orphans) > 8:
        print(f"  …及其余 {len(orphans)-8} 个")

    if args.dry or not orphans:
        return 0

    stamp = time.strftime("%Y%m%d-%H%M%S")
    dest_root = PROJECT_ROOT / "backups" / f"superseded-workflow-images-{stamp}"
    for p in orphans:
        dest = dest_root / p.relative_to(WI_ROOT)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), dest)
    # 清掉因此空掉的工作流目录(只删空目录,绝不动非空)
    for d in sorted((p for p in WI_ROOT.rglob("*") if p.is_dir()), reverse=True):
        try:
            d.rmdir()
        except OSError:
            pass
    print(f"已移动 {len(orphans)} 个旧图 -> {dest_root}(确认无误后可整目录删除)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
