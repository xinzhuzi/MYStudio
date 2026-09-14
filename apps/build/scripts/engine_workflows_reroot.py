#!/usr/bin/env python3
"""引擎家工作流库改根迁移(09-14 晚二次裁定:引擎家 workflows 恒无漫影)。

把引擎家 userdata 工作流库里的动态流从旧「漫影/」树迁到新根:
  漫影/1_图片/分镜/**                    → 分镜/**            (0_主线/1_总览/2_单镜图)
  漫影/2_视频/H3视频/1_漫影自研/0_单镜视频/** → 分镜/3_单镜视频/**
其余漫影/ 残留(静态流应已迁仓):与仓库真源字节相同→删;不同→挪「自留/」
(用户改过,永不丢)。最后清空并移除 漫影/ 根。幂等:再跑=零动作。
装机旧代码窗口期若回写旧位,重跑本脚本即清。

用法:
  python3 apps/build/scripts/engine_workflows_reroot.py [--dry-run] [--home <comfy-home>]
  默认 home=装机家 ~/Library/Application Support/漫影工作室/comfyui
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
REPO_TRUTH = REPO / "apps/backend/engines/comfyui/workflows"
DEFAULT_HOME = Path.home() / "Library/Application Support/漫影工作室/comfyui"

MOVES: list[tuple[str, str]] = [
    ("漫影/1_图片/分镜", "分镜"),
    ("漫影/2_视频/H3视频/1_漫影自研/0_单镜视频", "分镜/3_单镜视频"),
]


def plan_and_run(root: Path, repo: Path, dry: bool) -> int:
    legacy = root / "漫影"
    if not legacy.is_dir():
        print("漫影/ 不存在——已是终态,零动作")
        return 0
    moved = deleted = parked = conflicts = 0
    handled: set[Path] = set()
    # 1) 搬迁对
    for src_rel, dst_rel in MOVES:
        src = root / src_rel
        if not src.is_dir():
            continue
        for f in sorted(src.rglob("*.json")):
            if f.name == ".keep.json":
                continue  # 空夹占位随树清除,不搬
            handled.add(f)
            rel = f.relative_to(src)
            dst = root / dst_rel / rel
            mark = "MOVE"
            if dst.exists():
                if dst.read_bytes() == f.read_bytes():
                    mark, deleted = "DEL-IDENTICAL", deleted + 1
                    (f.unlink if not dry else lambda p: None)(f)
                else:
                    dst = root / "自留" / "冲突" / dst_rel / rel
                    mark, conflicts = "PARK-CONFLICT", conflicts + 1
            if mark != "DEL-IDENTICAL":
                moved += 1
            print(f"  [{mark}] {f.relative_to(root)} → {dst.relative_to(root)}")
            if not dry and mark != "DEL-IDENTICAL":
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dst))
    # 2) 其余漫影残留(搬迁对以外):比对仓库真源
    for f in sorted(legacy.rglob("*.json")):
        if f.name == ".keep.json" or f in handled:
            continue
        rel = f.relative_to(legacy)
        truth = repo / rel
        if truth.is_file() and truth.read_bytes() == f.read_bytes():
            deleted += 1
            print(f"  [DEL-REPO-SAME] {f.relative_to(root)}(与仓库真源字节相同)")
            if not dry:
                f.unlink()
        else:
            dst = root / "自留" / rel
            parked += 1
            print(f"  [PARK-KEEP] {f.relative_to(root)} → {dst.relative_to(root)}(无同源真源/内容有改,保留)")
            if not dry:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(f), str(dst))
    # 3) 清漫影根(此时应只剩空夹/.keep;有漏网文件则中止保护)
    # 点文件(.keep.json/.DS_Store 等)=占位/系统元数据,非工作流数据,随树清除
    leftover = [p for p in legacy.rglob("*") if p.is_file() and not p.name.startswith(".")]
    if leftover:
        print(f"  ⚠️ 漫影/ 仍有 {len(leftover)} 个未处理文件,保留目录不删:")
        for p in leftover[:10]:
            print(f"     {p.relative_to(root)}")
    else:
        print("  [RMDIR] 漫影/(已空,含 .keep/空夹一并移除)")
        if not dry:
            shutil.rmtree(legacy)
    tail = " (dry-run)" if dry else ""
    print(f"完成:搬 {moved} / 删 {deleted} / 留 {parked} / 冲突 {conflicts}{tail}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--home", default=str(DEFAULT_HOME), help="comfy 家目录(默认装机家)")
    args = ap.parse_args()
    root = Path(args.home) / "ComfyUI/user/default/workflows"
    if not root.is_dir():
        print(f"工作流库不存在:{root}")
        return 1
    print(f"库根:{root}")
    print(f"仓库真源:{REPO_TRUTH}{'(缺,残留一律保留)' if not REPO_TRUTH.is_dir() else ''}")
    return plan_and_run(root, REPO_TRUTH, args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
