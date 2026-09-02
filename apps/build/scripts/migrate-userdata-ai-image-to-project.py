#!/usr/bin/env python3
"""一次性迁移(09-02 生成记录治理 R4,幂等可复跑):

把 userData(漫影工作室)/media/ai-image/ 的存量生成图迁进当前活动项目
<project>/media/ai-image/<YYYY-MM>/ (按文件 mtime 分月),迁完清空
userData 侧该目录——该位置 08-30 已裁定退役,09-02 实证新图仍在写入后
本脚本配合 run-node-generation 项目落位改造一并收口。

用法:
  python3 apps/build/scripts/migrate-userdata-ai-image-to-project.py \
      --project /Users/zhengbingjin/Project/IP/MA [--dry-run]
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

USERDATA_MEDIA = Path.home() / "Library/Application Support/漫影工作室/media/ai-image"


def month_of(path: Path) -> str:
    import time

    mtime = path.stat().st_mtime
    t = time.localtime(mtime)
    return f"{t.tm_year}-{t.tm_mon:02d}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True, help="活动项目根(如 IP/MA)")
    parser.add_argument("--dry-run", action="store_true", help="只列出迁移计划不执行")
    args = parser.parse_args()

    project_media = Path(args.project) / "media/ai-image"
    if not USERDATA_MEDIA.is_dir():
        print(f"[skip] 源目录不存在: {USERDATA_MEDIA}")
        return 0

    images = sorted(p for p in USERDATA_MEDIA.iterdir() if p.is_file() and p.suffix.lower() == ".png")
    if not images:
        print(f"[ok] 源目录已空: {USERDATA_MEDIA}(可能已迁移)")
        return 0

    print(f"待迁移 {len(images)} 张 → {project_media}/<YYYY-MM>/")
    moved = 0
    for image in images:
        month = month_of(image)
        target_dir = project_media / month
        target = target_dir / image.name
        if target.exists():
            print(f"  [dedup] {month}/{image.name} 已存在,跳过")
            continue
        print(f"  {'[dry]' if args.dry_run else '[move]'} {image.name} → {month}/{image.name}")
        if not args.dry_run:
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(image), str(target))
            moved += 1

    if args.dry_run:
        print(f"[dry-run] 实跑将迁移上述文件;dry-run 不做任何改动")
        return 0

    remaining = [p for p in USERDATA_MEDIA.iterdir() if p.is_file()]
    if not remaining:
        USERDATA_MEDIA.rmdir()
        print(f"[done] 迁移 {moved} 张;userData/media/ai-image 已清空并移除目录")
    else:
        print(f"[warn] 迁移 {moved} 张,仍有 {len(remaining)} 个非 PNG 文件留在源目录,人工确认后清理")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
