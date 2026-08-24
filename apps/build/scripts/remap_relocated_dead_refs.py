#!/usr/bin/env python3
"""定向重映射「搬过家」的死引用(08-24 复核修正:923 条残留里 897 条文件其实还在,只是换了位置)。

实证(08-24 晚全盘搜索):
  ① 716 条(715 imageUrl+1 thumbnailUrl)→ 活跃资产库已删的旧主角形象 uuid,
     文件存于项目侧归档副本 <项目根>/assets/files/role/ → project-file://
  ② 78 条 exports mp4 → 已归档 <项目根>/backups/legacy-pipeline/exports/ → project-file://
  ③ 26 条仓库 output 证据缩略图 → 文件确已不存在,保留不动。

用法: python3 remap_relocated_dead_refs.py [--dry]  (须退出应用)
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORE = PROJECT_ROOT / "store"
OLD_APP_ASSETS = Path.home() / "Library/Application Support/漫影工作室/assets/files"
ABS = re.compile(r"^file:///Users/|^/Users/")


def _pid_from_registry() -> str:
    registry = Path.home() / "Library/Application Support/漫影工作室/projects/mystudio-project-store.json"
    data = json.loads(registry.read_text())
    for project in data.get("state", data).get("projects", []):
        if Path(project.get("location", "")).resolve() == PROJECT_ROOT.resolve():
            return str(project["id"])
    raise SystemExit("注册表反查项目 id 失败")


PID = _pid_from_registry()


def _virtual(abs_path: str) -> tuple[str, str] | None:
    raw = unquote(abs_path)
    if raw.startswith("file://"):
        raw = raw[len("file://"):]
    p = Path(raw)
    # ① 活跃资产树缺失 → 项目侧归档副本 assets/files/**
    try:
        rel = p.relative_to(OLD_APP_ASSETS)
    except ValueError:
        rel = None
    if rel is not None:
        archived = PROJECT_ROOT / "assets/files" / rel
        if archived.is_file():
            seg = "/".join(quote(x, safe="") for x in ("assets", "files", *rel.parts))
            return f"project-file://{quote(PID, safe='')}/{seg}", "asset-archived"
        return None
    # ② exports/** → backups/legacy-pipeline/exports/** 归档
    try:
        rel2 = p.relative_to(PROJECT_ROOT / "exports")
    except ValueError:
        rel2 = None
    if rel2 is not None:
        archived = PROJECT_ROOT / "backups/legacy-pipeline/exports" / rel2
        if archived.is_file():
            seg = "/".join(quote(x, safe="") for x in ("backups", "legacy-pipeline", "exports", *rel2.parts))
            return f"project-file://{quote(PID, safe='')}/{seg}", "export-archived"
    # ③ 项目外迁前旧内部位置 projects/_p/<pid>/** → 项目根现位
    marker = f"projects/_p/{PID}/"
    raw_str = str(p)
    if marker in raw_str:
        rel3 = Path(raw_str.split(marker, 1)[1])
        if (PROJECT_ROOT / rel3).is_file():
            seg = "/".join(quote(x, safe="") for x in rel3.parts)
            return f"project-file://{quote(PID, safe='')}/{seg}", "project-moved"
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    stats = {"asset-archived": 0, "export-archived": 0, "project-moved": 0}
    counters = {"untouched": 0}
    changed_files: list[Path] = []

    def rewrite(node, key=""):
        if isinstance(node, dict):
            for k, x in list(node.items()):
                if isinstance(x, str) and ABS.match(x) and "fingerprint" not in k.lower():
                    mapped = _virtual(x)
                    if mapped:
                        node[k] = mapped[0]
                        stats[mapped[1]] += 1
                    else:
                        counters["untouched"] += 1
                else:
                    rewrite(x, k)
        elif isinstance(node, list):
            for i, x in enumerate(node):
                if isinstance(x, str) and ABS.match(x) and "fingerprint" not in key.lower():
                    mapped = _virtual(x)
                    if mapped:
                        node[i] = mapped[0]
                        stats[mapped[1]] += 1
                    else:
                        counters["untouched"] += 1
                else:
                    rewrite(x, key)

    for f in sorted(STORE.rglob("*.json")):
        if "bak-" in f.name or ".backup" in f.name or "/backups/" in str(f):
            continue
        try:
            data = json.loads(f.read_text())
        except Exception:
            continue
        before = sum(stats.values())
        rewrite(data)
        if sum(stats.values()) > before:
            changed_files.append(f)
            if not args.dry:
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    if not args.dry and changed_files:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = STORE.parent / f"store.bak-relocate-{stamp}"
        for f in changed_files:
            dest = backup / f.relative_to(STORE)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
        print(f"备份 {len(changed_files)} 个文件 -> {backup}")
    print(("完成: " if not args.dry else "[dry] 将改写: ") + json.dumps(stats, ensure_ascii=False)
          + f";不可映射保留 {counters['untouched']} 条")
    return 0


if __name__ == "__main__":
    sys.exit(main())
