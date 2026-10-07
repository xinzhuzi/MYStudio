#!/usr/bin/env python3
"""qi21-道劫-t2i 根图 [401] 提示词预览 双框手术(1007深夜二轮,用户令
「正负提示词都传入了,但是又多了个渲染控件,布局也不合理」)。

py 侧(MyQi21PromptPreview)单「预览显示」合并框退役→双显示框
「正向终稿/负向终稿」,本脚本同步根图 [401] 节点:
  widgets_values: [''] → ['',''](双显示框值位)
  size: [500,600] → [500,560](双框钉高 245×2+标签,布局合理化)
  pos.x: 3054 → 3060(与 [4015] 主编码左缘对齐,消列错位)
连线(link18/217)/标题/槽序零改动(力输入槽形状由 py 侧定义驱动)。
注意:[401] 是根图节点,不进装配蓝图——蓝图零波及。
幂等:已应用零写入退出 0;fail-closed:现值不匹配旧值即拒动。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
OLD = {"pos0": 3054, "size": [500, 600], "wv": [""]}
NEW = {"pos0": 3060, "size": [500, 560], "wv": ["", ""]}


def main() -> int:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    hits = [n for n in wf["nodes"] if n.get("id") == 401]
    if len(hits) != 1:
        print(f"FAIL  [401] 命中 {len(hits)} 件(应恰 1)")
        return 1
    n = hits[0]
    cur = {"pos0": n["pos"][0], "size": n["size"], "wv": n.get("widgets_values")}
    if cur["pos0"] == NEW["pos0"] and cur["size"] == NEW["size"] and cur["wv"] == NEW["wv"] \
            and n.get("widgets_values_named") == {"正向终稿": "", "负向终稿": ""}:
        print("SKIP  already  [401] 已是双框终态")
        return 0
    if cur not in (OLD, NEW):
        print(f"FAIL  [401] 现值 {cur} 非预期旧值 {OLD}(并行改动?拒动)")
        return 1
    n["pos"][0] = NEW["pos0"]
    n["size"] = list(NEW["size"])
    n["widgets_values"] = list(NEW["wv"])
    # 命名镜像同步(1.53+ 双写):清远古孤儿键,落双框命名形
    n["widgets_values_named"] = {"正向终稿": "", "负向终稿": ""}
    WF.write_text(
        json.dumps(wf, ensure_ascii=False, indent=2, separators=(",", ": ")),
        encoding="utf-8")
    print(f"WRITE applied  [401] wv{OLD['wv']}→{NEW['wv']} size{OLD['size']}→{NEW['size']} x{OLD['pos0']}→{NEW['pos0']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
