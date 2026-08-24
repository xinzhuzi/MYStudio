#!/usr/bin/env python3
"""分镜 mediaRef 绝对路径归一为 project-file:// 虚拟路径(08-24 用户裁定)。

背景:direct_storyboard_images.py(08-23 版)曾把绝对路径写进 store 的
storyboard.mediaRef.path(镜 57-82 共 25 条)。裁定:store 一律落
`project-file://<projectId>/<relative>` 拼接路径,绝不写绝对路径。

行为:
1. 备份 studio-workflow 分片树 -> studio-workflow.bak-absfix-<ts>/
2. 扫描所有章节 storyboards-*.json,把指向项目根内的绝对路径(含 file://
   前缀形态)改写为逐段编码的虚拟路径
3. 每条改写前校验解码后的物理文件存在,不存在则跳过并告警
4. --dry 只打印不落盘

用法: python3 normalize_storyboard_abs_media_refs.py [--dry]
须在应用退出状态下运行(store 直写)。
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import quote, unquote

PROJECT_ROOT = Path("/Users/zhengbingjin/Project/IP/MA")
STORE_DIR = PROJECT_ROOT / "store" / "studio-workflow"


def _project_id() -> str:
    registry = Path.home() / "Library" / "Application Support" / "漫影工作室" / "projects" / "mystudio-project-store.json"
    data = json.loads(registry.read_text())
    for project in data.get("state", data).get("projects", []):
        if Path(project.get("location", "")).resolve() == PROJECT_ROOT.resolve():
            return str(project["id"])
    raise SystemExit(f"注册表未找到 location={PROJECT_ROOT} 的项目")


def _to_virtual(abs_path: str, pid: str) -> str | None:
    """绝对路径(可带 file:// 前缀)-> 虚拟路径;不在项目根内返回 None。"""
    raw = unquote(abs_path)
    if raw.startswith("file://"):
        raw = raw[len("file://"):]
    candidate = Path(raw)
    try:
        rel = candidate.resolve().relative_to(PROJECT_ROOT.resolve())
    except ValueError:
        return None
    if not candidate.is_file():
        return None
    segments = "/".join(quote(part, safe="") for part in rel.parts)
    return f"project-file://{quote(pid, safe='')}/{segments}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true")
    args = parser.parse_args()

    pid = _project_id()
    shards = sorted(STORE_DIR.glob("chapters/*/storyboards-*.json"))
    if not shards:
        print(f"未找到分镜分片: {STORE_DIR}")
        return 1

    rewritten = skipped = untouched = 0
    changed_shards: list[Path] = []
    for shard in shards:
        data = json.loads(shard.read_text())
        state = data.get("state", data)
        shard_dirty = False
        for value in state.values():
            if not isinstance(value, list):
                continue
            for item in value:
                if not isinstance(item, dict):
                    continue
                ref = item.get("mediaRef")
                if not (isinstance(ref, dict) and ref.get("kind") in ("image", "video", "audio")):
                    continue
                path = ref.get("path", "")
                if not isinstance(path, str) or path.startswith("project-file://"):
                    untouched += 1
                    continue
                virtual = _to_virtual(path, pid)
                if virtual is None:
                    skipped += 1
                    print(f"[跳过] {item.get('id')} 路径不在项目根内或文件缺失: {path[:110]}")
                    continue
                print(f"[归一] {item.get('id')}: {path[:70]}... -> {virtual[:90]}...")
                ref["path"] = virtual
                shard_dirty = True
                rewritten += 1
        if shard_dirty:
            changed_shards.append(shard)
            if not args.dry:
                shard.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")

    if args.dry:
        print(f"\n[dry] 将改写 {rewritten} 条,跳过 {skipped} 条,虚拟形态已合规 {untouched} 条;未落盘。")
        return 0

    if changed_shards:
        stamp = time.strftime("%Y%m%d-%H%M%S")
        backup = STORE_DIR.parent / f"studio-workflow.bak-absfix-{stamp}"
        shutil.copytree(STORE_DIR, backup)
        print(f"\n备份: {backup}")

    print(f"完成: 改写 {rewritten} / 跳过 {skipped} / 原本合规 {untouched};涉及分片 {len(changed_shards)} 个。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
