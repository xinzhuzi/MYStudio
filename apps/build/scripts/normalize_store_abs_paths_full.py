#!/usr/bin/env python3
"""store 全量绝对路径归一(08-24 路径裁定收口,Trellis 08-24-store-abs-path-migration)。

映射规则(与产品代码同构):
  /Users/.../Project/IP/MA/**            → project-file://<projectId>/<rel>
  <userData>/assets/files/**             → asset-file://<rel>
  <userData>/assets/thumbs/**            → asset-file://<rel>?thumb=1
  <userData>/media/**                    → local-image://<category>/<rest>
其余根(含不存在文件)跳过并告警。值级匹配(以 /Users/ 或 file:///Users/ 开头),
天然排除指纹字段内嵌路径(其值以 { 开头)。media-tasks 的 *Fingerprint 等内容寻址
缓存键一律不动。

用法: python3 normalize_store_abs_paths_full.py [--dry]
须在应用退出状态下运行。只备份被改写的文件(store.bak-absfull-<ts>/ 保形)。
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

STORE_ROOT = Path("/Users/zhengbingjin/Project/IP/MA/store")
PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORAGE_BASE = Path.home() / "Library" / "Application Support" / "漫影工作室"
ASSETS_FILES = STORAGE_BASE / "assets" / "files"
ASSETS_THUMBS = STORAGE_BASE / "assets" / "thumbs"
MEDIA_ROOT = STORAGE_BASE / "media"

ABS_PREFIX = re.compile(r"^file:///Users/|^/Users/")
FINGERPRINT_KEY = re.compile(r"fingerprint", re.IGNORECASE)


def _project_id() -> str:
    registry = STORAGE_BASE / "projects" / "mystudio-project-store.json"
    data = json.loads(registry.read_text())
    for project in data.get("state", data).get("projects", []):
        if Path(project.get("location", "")).resolve() == PROJECT_ROOT.resolve():
            return str(project["id"])
    raise SystemExit(f"注册表未找到 location={PROJECT_ROOT} 的项目")


PID = _project_id()


def _virtual(absolute: str) -> tuple[str, str] | None:
    """绝对路径 → (scheme 形态, 分类);失败返回 None。"""
    raw = unquote(absolute)
    if raw.startswith("file://"):
        raw = raw[len("file://"):]
    p = Path(raw)
    for root, kind in ((PROJECT_ROOT, "project"), (ASSETS_FILES, "files"), (ASSETS_THUMBS, "thumbs"), (MEDIA_ROOT, "media")):
        try:
            rel = p.resolve().relative_to(root.resolve())
        except ValueError:
            continue
        if not p.is_file():
            return None
        seg = lambda parts: "/".join(quote(str(x), safe="") for x in parts)
        if kind == "project":
            return f"project-file://{quote(PID, safe='')}/{seg(rel.parts)}", "project"
        if kind == "files":
            return f"asset-file://{seg(rel.parts)}", "asset"
        if kind == "thumbs":
            return f"asset-file://{seg(rel.parts)}?thumb=1", "asset-thumb"
        parts = rel.parts
        return f"local-image://{quote(str(parts[0]), safe='')}/{seg(parts[1:])}", "media"
    return None


def walk(v, key: str):
    if isinstance(v, dict):
        for k, x in v.items():
            yield from walk(x, k)
    elif isinstance(v, list):
        for x in v:
            yield from walk(x, key)
    elif isinstance(v, str) and ABS_PREFIX.match(v):
        yield key, v


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    files = [
        f for f in sorted(STORE_ROOT.rglob("*.json"))
        if "bak-" not in f.name and ".backup" not in f.name and "bak" != f.suffix and "/backups/" not in str(f)
    ]
    stats = {"project": 0, "asset": 0, "asset-thumb": 0, "media": 0}
    skipped: list[str] = []
    changed: dict[Path, int] = {}

    for f in files:
        try:
            data = json.loads(f.read_text())
        except Exception as e:
            print(f"[解析失败跳过] {f.name}: {e}")
            continue
        dirty = 0

        def rewrite(node, key: str = "") -> None:
            nonlocal dirty
            if isinstance(node, dict):
                for k, x in list(node.items()):
                    if isinstance(x, str) and ABS_PREFIX.match(x) and not FINGERPRINT_KEY.search(k):
                        mapped = _virtual(x)
                        if mapped is None:
                            skipped.append(f"{f.name}:{k} {x[:90]}")
                            continue
                        url, kind = mapped
                        print(f"[{kind}] {f.name}:{k} -> {url[:96]}")
                        node[k] = url
                        stats[kind] += 1
                        dirty += 1
                    else:
                        rewrite(x, k)
            elif isinstance(node, list):
                for i, x in enumerate(node):
                    if isinstance(x, str) and ABS_PREFIX.match(x) and not FINGERPRINT_KEY.search(key):
                        mapped = _virtual(x)
                        if mapped is None:
                            skipped.append(f"{f.name}:{key}[] {x[:90]}")
                            continue
                        url, kind = mapped
                        print(f"[{kind}] {f.name}:{key}[] -> {url[:96]}")
                        node[i] = url
                        stats[kind] += 1
                        dirty += 1
                    else:
                        rewrite(x, key)

        rewrite(data)
        if dirty:
            changed[f] = dirty
            if not args.dry:
                f.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    if args.dry:
        print(f"\n[dry] 将改写 {sum(changed.values())} 条;跳过 {len(skipped)} 条;未落盘。")
        return 0

    if changed:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup_root = STORE_ROOT.parent / f"store.bak-absfull-{stamp}"
        for f in changed:
            dest = backup_root / f.relative_to(STORE_ROOT)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest)
        print(f"\n备份 {len(changed)} 个被改文件 -> {backup_root}")

    print(f"完成: {stats};跳过 {len(skipped)} 条(非受管根或文件缺失)")
    for s in skipped[:12]:
        print("  跳过:", s)
    return 0


if __name__ == "__main__":
    sys.exit(main())
