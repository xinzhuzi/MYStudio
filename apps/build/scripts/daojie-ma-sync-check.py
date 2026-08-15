#!/usr/bin/env python3
"""道劫手册 ↔ MA ma-imagegen 同步检查。

比对 MYStudio daojie_ink_guofeng 手册(硬锁节/锚点)与 MA 工作区权威文件的词级一致性,
输出漂移报告。MA 侧演化后先跑本脚本定位差异,再人工更新手册与 ma_sync 快照。

用法:
  python3 apps/build/scripts/daojie-ma-sync-check.py [--ma-root <MA技能根目录>]

默认 MA 根: /Users/zhengbingjin/Project/Unity/MA/.claude/skills/ma-imagegen
退出码: 0=一致或 MA 不存在(仅警告), 1=发现漂移。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
DAOJIE_DIR = REPO_ROOT / "frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
DEFAULT_MA_ROOT = Path("/Users/zhengbingjin/Project/Unity/MA/.claude/skills/ma-imagegen")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ma-root", type=Path, default=DEFAULT_MA_ROOT)
    args = parser.parse_args()

    anchors_path = DAOJIE_DIR / "ma_sync/lock-anchors.json"
    anchors = json.loads(anchors_path.read_text(encoding="utf-8"))

    drifts: list[str] = []
    warnings: list[str] = []

    # 1) 手册侧:manualAnchor 必须在锁声明的 manualFile
    manual_cache: dict[str, str] = {}
    for lock in anchors["locks"]:
        rel = lock["manualFile"]
        if rel not in manual_cache:
            manual_cache[rel] = (DAOJIE_DIR / rel).read_text(encoding="utf-8")
        for anchor in lock["manualAnchors"]:
            if anchor not in manual_cache[rel]:
                drifts.append(f"[手册漂移] {lock['name']}: {rel} 缺锚句「{anchor}」")

    # 2) MA 侧:maAnchor 必须在 sourceIndex 指向的权威文件;文件 sha 与快照比对
    if not args.ma_root.is_dir():
        warnings.append(f"MA 工作区不存在({args.ma_root}),跳过直连比对")
    else:
        source_contents: dict[str, str] = {}
        for source in anchors["maSources"]:
            ma_path = Path(source["path"])
            if not ma_path.is_file():
                warnings.append(f"MA 文件缺失: {ma_path}")
                continue
            actual = sha256_of(ma_path)
            if actual != source["sha256"]:
                warnings.append(
                    f"[快照过期] {ma_path.name} sha256 变化:快照 {source['sha256'][:8]}… → 实际 {actual[:8]}…(锁文本可能已演化,需人工核对)"
                )
            source_contents[str(ma_path)] = ma_path.read_text(encoding="utf-8")
        for lock in anchors["locks"]:
            ma_path = anchors["maSources"][lock["sourceIndex"]]["path"]
            content = source_contents.get(ma_path)
            if content is None:
                continue
            for anchor in lock["maAnchors"]:
                if anchor not in content:
                    drifts.append(f"[MA漂移] {lock['name']}: {Path(ma_path).name} 缺锚句「{anchor}」")

    # 3) 手册中残留 MA 已废除的宣纸赞美词(冗余守护,与契约测试同口径)
    for banned in ("宣纸质感", "宣纸肌理", "rice paper texture", "xuan paper texture", "clean paper texture"):
        for md in sorted(DAOJIE_DIR.rglob("*.md")):
            if md.parent.name == "ma_sync":
                continue
            text = md.read_text(encoding="utf-8")
            for i, line in enumerate(text.splitlines(), 1):
                if banned in line and not re.search(r"禁|不得|不写|改写|替代|例外|列入负面|赞美词|标记块|→", line):
                    drifts.append(f"[废词残留] {md.relative_to(DAOJIE_DIR)}:{i}:「{banned}」不在规则语境")

    for warning in warnings:
        print(f"WARN {warning}")
    if drifts:
        print(f"\n发现 {len(drifts)} 处漂移:")
        for drift in drifts:
            print(f"  DRIFT {drift}")
        print("\n处理:MA 侧变化→更新 prefix.md 硬锁节+lock-anchors.json(锚点/sha256/日期);手册侧误改→按快照恢复。")
        return 1
    print(f"OK 锚点一致({len(anchors['locks'])} 把锁);警告 {len(warnings)} 条。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
