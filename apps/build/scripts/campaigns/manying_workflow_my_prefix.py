# DEPRECATED(2026-09-22 归档):已与 09-18 裁定反向(会把全库改回 MY- 前缀),勿再运行;详见 AGENTS.md 与 .claude/CLAUDE.md「文件命名铁律」。
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""[09-18 已废弃·勿再运行] 09-18 用户裁定废弃 MY- 前缀(去前缀+下划线转连字符),本脚本方向已反——运行会把全库改回 MY- 前缀。仅作历史留档。

漫影工作流 `MY-` 前缀迁移(09-14 用户裁定·二次修订)。

裁定演进:早同日先裁定 `_my.json` 后缀,随即二次修订为 **`MY-` 前缀**
(如 `K2-图生图_my.json` → `MY-K2-图生图.json`)。本脚本是终态执行者,
兼容回收两种历史形态:
- 无前缀无后缀(装机旧代码所落,如 `分镜工作流.json`)
- `_my` 后缀(同日早间裁定形态,如 `分镜工作流_my.json`)

规则:
- 幂等可重跑:已带 `MY-` 前缀的跳过。
- 豁免:`.keep.json`(空夹占位)与 `4_参考_提示词工程/Easy指南/manifest.json`
  (指南包元数据,非工作流)。
- 零丢失:撞名(旧形态与 `MY-` 目标并存)时,内容相同才去重删源;
  内容不同只报告不动,留人工裁定。

用法:
    python3 manying_workflow_my_prefix.py <workflows目录> [--dry-run]

例:
    python3 manying_workflow_my_prefix.py \
        "$HOME/Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows" --dry-run
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path

ROOT = "漫影"
PREFIX = "MY-"
LEGACY_SUFFIX = "_my"
# 相对 ROOT 的豁免清单(非工作流 JSON)
EXEMPT = {
    Path("4_参考_提示词工程/Easy指南/manifest.json"),
}


def _same_file(a: Path, b: Path) -> bool:
    def digest(p: Path) -> str:
        return hashlib.sha256(p.read_bytes()).hexdigest()

    return digest(a) == digest(b)


def normalize_name(name: str) -> str:
    """剥 `_my` 历史后缀与 `漫影-` 冗余前段;无 `MY-` 前缀则补。"""
    stem = name[:-len(".json")] if name.endswith(".json") else name
    if stem.endswith(LEGACY_SUFFIX):
        stem = stem[: -len(LEGACY_SUFFIX)]
    stem = stem.removeprefix("漫影-")
    return stem if stem.startswith(PREFIX) else f"{PREFIX}{stem}"


def migrate(workflows_dir: Path, dry_run: bool) -> int:
    root = workflows_dir / ROOT
    if not root.is_dir():
        print(f"[skip] {root} 不存在(未初始化的引擎家?)")
        return 0
    renamed = deduped = conflicts = 0
    for path in sorted(root.rglob("*.json")):
        rel = path.relative_to(root)
        if path.name == ".keep.json" or rel in EXEMPT:
            continue
        target = path.with_name(f"{normalize_name(path.name)}.json")
        if target == path:
            continue  # 幂等:已达标
        if target.exists():
            if _same_file(path, target):
                if not dry_run:
                    path.unlink()
                deduped += 1
                print(f"[dedupe] {rel} ≡ {target.name},删旧名副本")
            else:
                conflicts += 1
                print(f"[conflict] {rel} 与 {target.name} 内容不同,留人工裁定(未动)")
            continue
        if not dry_run:
            path.rename(target)
        renamed += 1
        print(f"[rename] {rel} -> {target.name}")
    mode = "dry-run " if dry_run else ""
    print(f"\n{mode}完成:重命名 {renamed} · 去重删旧 {deduped} · 冲突待裁 {conflicts}")
    return 1 if conflicts else 0


def main() -> None:
    parser = argparse.ArgumentParser(description="漫影工作流 `MY-` 前缀迁移(幂等,兼容 _my/无标记两形态)")
    parser.add_argument("workflows_dir", type=Path, help="ComfyUI user/default/workflows 目录")
    parser.add_argument("--dry-run", action="store_true", help="只报告不落盘")
    args = parser.parse_args()
    sys.exit(migrate(args.workflows_dir, args.dry_run))


if __name__ == "__main__":
    main()
