#!/usr/bin/env python3
"""移除全部 entity-extractions 章分片(带备份,默认 dry-run)。

用途:全书重提前清理旧提取分片,避免归档章合并逻辑把旧分片与新分片同名双装载
(storage-project-sharded.ts 只跳过 activeChapterId)。只动 entity-extractions,
不碰 novel-chapters/storyboards/media-tasks 等其他分片,也不动三库。

用法:
  python3 apps/build/scripts/entity_extraction_shard_reset.py --project /path/to/project
  python3 apps/build/scripts/entity_extraction_shard_reset.py --project /path/to/project --apply
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir", default=None)
    args = parser.parse_args()

    project = Path(args.project)
    workflow = project / "store" / "studio-workflow"
    manifest_path = workflow / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    targets = [
        name
        for name in manifest.get("shards", [])
        if name.startswith("chapters/") and "/entity-extractions-" in name
    ]
    chapters = sorted({name.split("/")[1] for name in targets})
    print(f"entity-extractions 分片={len(targets)} 涉及章={len(chapters)}")
    print(f"章范围: {chapters[:5]} ... {chapters[-5:]}" if chapters else "无")
    if not args.apply:
        print("dry-run:未改动。加 --apply 执行(会先备份)。")
        return 0

    backup_dir = Path(args.backup_dir) if args.backup_dir else workflow / "backups" / f"entity-extractions-reset-{__import__('time').strftime('%Y%m%d-%H%M%S')}"
    backup_dir.mkdir(parents=True, exist_ok=True)
    copied = 0
    for name in targets:
        src = workflow / name
        if src.exists():
            dst = backup_dir / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1

    manifest["shards"] = [name for name in manifest.get("shards", []) if name not in set(targets)]
    manifest["version"] = int(manifest.get("version", 0)) + 1
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    removed = 0
    for name in targets:
        src = workflow / name
        if src.exists():
            src.unlink()
            removed += 1
    print(f"备份 {copied} 个 -> {backup_dir}")
    print(f"manifest 移除 {len(targets)} 项,version={manifest['version']},删除文件 {removed} 个")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
