#!/usr/bin/env python3
"""daojie_sheet_formats_freeze.py — 设定卡格式注册表冻结快照再生工具(1114)。

真源 qi21_bases.json#sheet_card_qwen.formats → 重生
apps/backend/comfyui/my_nodes/nodes/sheet_card_formats.py 的 _FROZEN 字面量。
幂等可复现:同真源跑 N 次产出逐字节相同;未来加格式后一键同步快照。

用法:python3 apps/build/scripts/daojie_sheet_formats_freeze.py [--check]
  --check 只校验快照是否与真源一致(不写文件;不一致 exit 1)。
"""
from __future__ import annotations

import argparse
import ast
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TRUTH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/"
         "daojie_ink_guofeng/json/qi21_bases.json")
TARGET = REPO / "apps/backend/comfyui/my_nodes/nodes/sheet_card_formats.py"

MARKER = "# ── _FROZEN 冻结快照(由 apps/build/scripts/daojie_sheet_formats_freeze.py 再生;勿手改)──"


def _module():
    spec = importlib.util.spec_from_file_location("sheet_card_formats_freeze", TARGET)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _literal(reg: dict) -> str:
    return MARKER + "\n_FROZEN: dict = " + json.dumps(
        reg, ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="只校验快照与真源一致(不写文件;不一致 exit 1)")
    args = ap.parse_args()

    reg = json.loads(TRUTH.read_text(encoding="utf-8"))["sheet_card_qwen"]["formats"]
    _module().validate_registry(reg)      # 快照入口同过五道闸(坏真源=明确拒冻)

    src = TARGET.read_text(encoding="utf-8")
    head, sep, tail = src.partition(MARKER)
    assert sep, f"{TARGET.name} 缺 _FROZEN 标记行"
    assert "_FROZEN: dict = " in tail and tail.count("_FROZEN: dict = ") == 1, \
        "标记行后应只有 _FROZEN 赋值(若模块尾部新增了代码,请先改本脚本的替换范围)"
    new_src = head + _literal(reg)
    ast.parse(new_src)                    # 写前语法闸

    if args.check:
        if new_src == src:
            print(f"[FREEZE CHECK OK] _FROZEN 与真源一致:{TRUTH.name} "
                  f"formats={list(reg)}")
            return 0
        print("[FREEZE CHECK FAIL] _FROZEN 与真源漂移,请运行本脚本再生快照")
        return 1
    if new_src == src:
        print(f"[FREEZE OK·幂等无变动] {len(reg)} 格式:{list(reg)}")
        return 0
    TARGET.write_text(new_src, encoding="utf-8")
    print(f"[FREEZE OK·已再生] {len(reg)} 格式:{list(reg)} → {TARGET.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
