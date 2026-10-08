#!/usr/bin/env python3
# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""palette-canon.json 重投影更新器(1009;daojie-ma-sync-check 的配套修具)。

背景:1009 双域红灯根因=d346cfa4 对 ma_sync/palette-canon.json 单行手改
(「禁网文封面美人」→「禁网文封面画风」)未走 MA 源,canon 内容自此与其
sources 注册的 MA TOML 投影语义脱钩——daojie-ma-sync-check 报
palette_canon_semantic_mismatch,三测试连锁红(真工作区零漂移断言+以真 MA
为底本的两只桩测)。守护 hint 即修法:「重跑投影更新正典(勿手改)」。

本工具=该 hint 的可重跑落地:
  1. 以 MA 工作区现实文件为准,重算两 TOML 的 sha256 回写 sources(锚随源);
  2. 用 daojie-ma-sync-check.project_palette_canon 重投影,替换 canon 正文
     (sources 段的 path/sha256/responsibility 原位保留,仅 sha 刷新);
  3. 格式不变:indent=2 / ensure_ascii=False / 无尾换行(与现档逐格式一致);
  4. 幂等:重跑零 diff 零写盘;--check 只验不写。

用法:python3 apps/build/scripts/daojie_palette_canon_reproject.py [--check] [--ma-root PATH]
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CANON_PATH = (REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng"
              / "ma_sync/palette-canon.json")
DEFAULT_MA_ROOT = Path.home() / "Project/Unity/MA"
_CHECK = importlib.util.spec_from_file_location(
    "daojie_ma_sync_check", Path(__file__).resolve().parent / "daojie-ma-sync-check.py")
assert _CHECK and _CHECK.loader
macheck = importlib.util.module_from_spec(_CHECK)
_CHECK.loader.exec_module(macheck)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--check", action="store_true", help="只验不写")
    ap.add_argument("--ma-root", type=Path, default=DEFAULT_MA_ROOT,
                    help=f"MA 工作区根(默认 {DEFAULT_MA_ROOT})")
    args = ap.parse_args()

    canon = json.loads(CANON_PATH.read_text(encoding="utf-8"))
    skill_root = args.ma_root / ".claude/skills/ma-imagegen"
    if not skill_root.is_dir():
        print(f"MA 技能根不存在: {skill_root}", file=sys.stderr)
        return 2

    # ① 源文件在位性 + sha 重算(锚随源)
    sources, toml_payloads = [], {}
    for src in canon["sources"]:
        rel = str(src["path"])
        f = skill_root / rel
        if not f.is_file():
            print(f"MA 源缺失: {f}", file=sys.stderr)
            return 2
        raw = f.read_bytes()
        sources.append({**src, "sha256": hashlib.sha256(raw).hexdigest()})
        toml_payloads[rel.rsplit("/", 1)[-1]] = raw.decode("utf-8")

    # ② 重投影(与守护同一投影函数,零平行实现)
    import tomllib
    palette = tomllib.loads(toml_payloads["三轨选色配料.toml"])
    faction = tomllib.loads(toml_payloads["阵营配色与黄金公式.toml"])
    projected = macheck.project_palette_canon(palette, faction)

    stored = {k: v for k, v in canon.items() if k != "sources"}
    drifted = [s["path"] for s, old in zip(sources, canon["sources"]) if s["sha256"] != old["sha256"]]
    semantic = macheck.canonical_json(projected) != macheck.canonical_json(stored)
    if not drifted and not semantic:
        print("CHECK-ONLY(未写盘)" if args.check else "NOOP: canon 已与 MA 源一致,零 diff 零写盘")
        return 0
    if drifted:
        print(f"源 sha 刷新: {drifted}")
    if semantic:
        print("正文语义跟源: canon 内容 → MA TOML 现投影")

    updated = {"canonVersion": canon["canonVersion"], "sources": sources, **projected}
    if args.check:
        print("CHECK-ONLY(有漂移,未写盘)")
        return 1
    CANON_PATH.write_text(
        json.dumps(updated, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已重投影落盘: {CANON_PATH.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
