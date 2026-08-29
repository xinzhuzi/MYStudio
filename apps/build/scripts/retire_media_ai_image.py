#!/usr/bin/env python3
"""副本库退役迁移:media/ai-image → IP/MA/media/ai-image + project-file:// 协议改写(B 方案)。

规则(2026-08-30 用户裁定 B):
- 415 张独有图 → 复制到 IP/MA/media/ai-image/(文件名不变),引用改
  project-file://<pid>/media/ai-image/<f>
- 52 张与项目真源同字节的重复件 → 不迁副本,引用直接改指真源
  project-file://<pid>/<真源相对路径>(零重复存储)
- 4 张无引用独有图 → 也进 media/ai-image(留档完整)
- 全量 467 张原件冻结到 IP/MA/backups/media-ai-image-retired-20260830/all/
- store/media.json 改写前先备份到同 backups 目录;manifest.json 记录全部去向+SHA256

用法: python3 retire_media_ai_image.py [--dry-run]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import time
from pathlib import Path

APP_MEDIA = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/media/ai-image")
PROJECT = Path("/Users/zhengbingjin/Project/IP/MA")
MEDIA_JSON = PROJECT / "store" / "media.json"
STAMP = "20260830"
BACKUP = PROJECT / "backups" / f"media-ai-image-retired-{STAMP}"
TARGET = PROJECT / "media" / "ai-image"
PID = "49dce4c1-64b1-42de-85c2-9f266698aec4"
TRUE_SOURCE_ROOTS = [PROJECT / "workflow-images", PROJECT / "assets"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    dry = args.dry_run

    # 1) 项目真源哈希 → 相对路径(优先 workflow-images)
    truth: dict[str, str] = {}
    for root in TRUE_SOURCE_ROOTS:
        for p in root.rglob("*.png"):
            rel = p.relative_to(PROJECT).as_posix()
            truth.setdefault(sha(p), rel)

    # 2) 引用集合
    data = json.loads(MEDIA_JSON.read_text())
    state = data.get("state", data)
    refs = set()
    for f in state.get("mediaFiles", []):
        u = f.get("url") or ""
        if u.startswith("local-image://ai-image/"):
            refs.add(u.split("local-image://ai-image/", 1)[1])

    # 3) 分类
    manifest = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "entries": []}
    copied = deduped = archived_only = 0
    for p in sorted(APP_MEDIA.glob("*.png")):
        h = sha(p)
        entry = {"file": p.name, "sha256": h, "referenced": p.name in refs}
        if h in truth:
            entry["action"] = "dedupe-to-truth"
            entry["targetUrl"] = f"project-file://{PID}/{truth[h]}"
            deduped += 1
        else:
            entry["action"] = "migrate-copy"
            entry["targetUrl"] = f"project-file://{PID}/media/ai-image/{p.name}"
            copied += 1
        if not p.name in refs:
            entry["note"] = "unreferenced"
            archived_only += 1
        manifest["entries"].append(entry)

    print(f"迁移计划: 复制={copied} 判重改指真源={deduped} (其中无引用={archived_only})")
    if dry:
        print(json.dumps(manifest["entries"][:3], ensure_ascii=False, indent=2))
        return 0

    # 4) 执行:冻结全量 → 复制独有 → 改写 media.json
    (BACKUP / "all").mkdir(parents=True, exist_ok=True)
    for p in APP_MEDIA.glob("*.png"):
        shutil.copy2(p, BACKUP / "all" / p.name)
    TARGET.mkdir(parents=True, exist_ok=True)
    for e in manifest["entries"]:
        if e["action"] == "migrate-copy":
            shutil.copy2(APP_MEDIA / e["file"], TARGET / e["file"])
    (BACKUP / "store-media.json.bak").write_text(MEDIA_JSON.read_text())

    # 5) media.json 引用改写
    mapping = {e["file"]: e["targetUrl"] for e in manifest["entries"]}
    changed = 0
    for f in state.get("mediaFiles", []):
        u = f.get("url") or ""
        if u.startswith("local-image://ai-image/"):
            name = u.split("local-image://ai-image/", 1)[1]
            if name in mapping:
                f["url"] = mapping[name]
                changed += 1
    MEDIA_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2))
    (BACKUP / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(f"完成: media.json 改写 {changed} 条;冻结 467 → {BACKUP}/all;真源落位 {TARGET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
