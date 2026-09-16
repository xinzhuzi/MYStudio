#!/usr/bin/env python3
"""art_skills 全库中文化战役·基线锁定(09-16 用户令)。

翻译前锁死三样(写 JSON 到本目录,供门禁比对):
  1. 开放风格名册:展示名 → {dir, level(canon/variant)}
  2. 每风格 prefix.md H1 原文(展示名来源,翻译不得动)
  3. 排除名单实际生效集
stdout 额外打印 dir 清单 JSON(供工作流分批)。
幂等:翻译前跑一次;翻译后由 gate 重算比对,本脚本不重写基线。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps" / "backend"))

from engines.comfyui.my_nodes.nodes import my_styles  # noqa: E402

if len(sys.argv) > 1:  # world.run 传不了 env,argv 显式指根(repo 真源)
    import os
    os.environ["MYSTUDIO_ART_SKILLS"] = sys.argv[1]

BASE_JSON = Path(__file__).resolve().parent / ".artskills_zh_baseline.json"


def main() -> int:
    root = my_styles._resolve_art_skills_root()
    if root is None:
        print("art_skills 根未找到(需 MYSTUDIO_ART_SKILLS 或装机固定位)", file=sys.stderr)
        return 1
    catalog = my_styles._get_catalog(root)
    baseline = {}
    for name, entry in sorted(catalog.items()):
        style_dir = root / entry["dir"]
        h1 = ""
        prefix = style_dir / "prefix.md"
        if prefix.is_file():
            match = my_styles._PREFIX_H1.search(prefix.read_text(encoding="utf-8", errors="replace"))
            h1 = match.group(1).strip() if match else ""
        baseline[name] = {"dir": entry["dir"], "level": entry["level"], "h1": h1}
    if BASE_JSON.exists():
        print("基线已存在,拒绝覆盖(防翻译中途重置基准)", file=sys.stderr)
    else:
        BASE_JSON.write_text(json.dumps(baseline, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({
        "count": len(baseline),
        "dirs": sorted({v["dir"] for v in baseline.values()}),
        "names": sorted(baseline),
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
