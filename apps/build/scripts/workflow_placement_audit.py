#!/usr/bin/env python3
"""工作流落位审计(09-21 立,单源=docs/comfyui-kb/工作流落位规范.md)。

检查项(任一 FAIL → 退出码 1):
  1. 真源库树 json 计数 == 清单文档锚点 <!-- audit:workflow-tree-total=N -->
  2. 引擎家用户区(装机家)零 *.json(会话恒零写入,用户另存除外→发现即报警)
  3. 引擎家用户区零 MY- 前缀残留
  4. 引擎家 snapshots/workflow-backups 不存在或为空(分镜域零实体)
  5. 真源库树无 *.laid-out.json / 无 MY- 前缀件
  6. *.api.json 桥格式件必须与同名 UI 件成对(孤立即脏)
  7. docs/comfyui-kb 无旧命名参考目录(outfit_transfer_参考工作流 / 工作流备份)
  8. 仓库根零 *.png(会话截图垃圾)

用法: python3 apps/build/scripts/workflow_placement_audit.py [--home <comfy-home>]
默认 home = ~/Library/Application Support/漫影工作室/comfyui(装机家)。
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = REPO / "apps/backend/engines/comfyui/workflows"
INVENTORY = REPO / "docs/comfyui-kb/漫影工作流清单.md"
KB = REPO / "docs/comfyui-kb"
DEFAULT_HOME = Path.home() / "Library/Application Support/漫影工作室/comfyui"

results: list[tuple[bool, str]] = []


def check(ok: bool, label: str, detail: str = "") -> None:
    results.append((ok, f"{label}{(' :: ' + detail) if detail and not ok else ''}"))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=DEFAULT_HOME, help="comfy 引擎家(装机家)")
    opts = parser.parse_args()
    user_wf = opts.home / "ComfyUI/user/default/workflows"

    # 1. 真源计数 == 清单锚点
    tree_jsons = sorted(TRUTH.rglob("*.json"))
    tree_count = len(tree_jsons)
    anchor = None
    if INVENTORY.exists():
        m = re.search(r"audit:workflow-tree-total=(\d+)", INVENTORY.read_text(encoding="utf-8"))
        anchor = int(m.group(1)) if m else None
    check(anchor is not None, "清单审计锚点存在", f"{INVENTORY} 缺 <!-- audit:workflow-tree-total=N -->")
    check(anchor == tree_count, f"真源计数 {tree_count} == 清单锚点 {anchor}")

    # 2. 用户区零 json
    stray_user = sorted(user_wf.rglob("*.json")) if user_wf.exists() else []
    check(not stray_user, "用户区零 json(会话恒零写入)",
          "; ".join(p.name for p in stray_user[:5]))

    # 3. 用户区零 MY- 残留(含任何文件类型)
    stray_my = [p for p in user_wf.rglob("MY-*")] if user_wf.exists() else []
    check(not stray_my, "用户区零 MY- 残留", "; ".join(p.name for p in stray_my[:5]))

    # 4. snapshots/workflow-backups 分镜零实体
    wb = opts.home / "snapshots/workflow-backups"
    check(not wb.exists() or not any(wb.iterdir()), "snapshots/workflow-backups 恒空(分镜零实体)")

    # 5. 真源无 laid-out / MY- 件
    laid = [p.name for p in tree_jsons if p.name.endswith(".laid-out.json")]
    my_prefix = [p.name for p in tree_jsons if p.name.startswith("MY-")]
    check(not laid, "真源无 .laid-out.json 中间件", "; ".join(laid[:5]))
    check(not my_prefix, "真源无 MY- 前缀件", "; ".join(my_prefix[:5]))

    # 6. .api.json 成对
    orphans = []
    for p in tree_jsons:
        if p.name.endswith(".api.json"):
            if not (p.parent / (p.name[: -len(".api.json")] + ".json")).exists():
                orphans.append(p.name)
    check(not orphans, ".api.json 全成对(孤立即脏)", "; ".join(orphans[:5]))

    # 7. docs 参考区旧命名目录不复活
    stale_dirs = [d.name for d in KB.iterdir()
                  if d.is_dir() and d.name in {"outfit_transfer_参考工作流", "工作流备份"}]
    check(not stale_dirs, "docs 参考区无旧命名目录", "; ".join(stale_dirs))

    # 8. 仓库根零 PNG
    root_png = [p.name for p in REPO.glob("*.png")]
    check(not root_png, "仓库根零 PNG(会话截图禁落根)", "; ".join(root_png[:5]))

    width = max(len(label) for _, label in results)
    failed = 0
    for ok, label in results:
        print(f"{'PASS' if ok else 'FAIL'}  {label}")
        failed += 0 if ok else 1
    print(f"\n{'=' * 40}\n{len(results) - failed}/{len(results)} 项通过"
          + ("; 有 FAIL,见上" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
