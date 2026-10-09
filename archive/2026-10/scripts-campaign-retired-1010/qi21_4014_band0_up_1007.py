#!/usr/bin/env python3
"""qi21-道劫-t2i 装配子图 [4014] 最终输出 布局上移手术(1007 用户令「节点布局向上」)。

改动:y 340 → 80(带0 顶带,与三真源 [4030]/[4032] 顶对齐;pos≥80 零负区内)。
不动:x/size/连线/widgets/出口轨 outputs[].pos(装饰字段,装载期现算)零波及。

安全性(1007 出口销役 d84ed3f5 成果不回退的论证):
  出口销(-20)装载期按「最右节点 pos.x+50 / 最顶节点 pos.y」推导=[2400,80],
  恒内落 [4014] x 带——与 y 无关,任何 y 都一样;恒向右 enforcement 由
  my_nodes/web/subgraph-io-anchor.js 看门狗承担(锚至最右右缘+80=2810,
  [4014] 右缘 2730,横向净距 80)。故本手术不依赖 y 向销盒净距。
验证:layout_check 三 scope 计数对拍零变化(main 10/装配 4+既有遮挡 2/加速 0);
  契约带锚 [4014] 留带0(y<400)。

落点(双件同批):①仓库工作流真源 ②装配蓝图(测试 test_blueprint_definition_
matches_host_subgraph 全等锚)。幂等:已应用则零写入退出 0。fail-closed:
坐标不匹配旧值且非新值 → 全批不落盘。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
TARGETS = [
    REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图.json",
]
SG_NAME = "[6] 文本提示词类型优化子图"
NODE_ID = 4014
OLD_POS = [2350.260416666668, 340]
NEW_Y = 80.0


def patch_doc(doc: dict, label: str) -> str:
    """返回 applied / already / mismatch;只改内存,不落盘。"""
    sgs = doc.get("definitions", {}).get("subgraphs", [])
    sg = next((s for s in sgs if s.get("name") == SG_NAME), None)
    if sg is None:
        return f"{label}: 子图 {SG_NAME!r} 不在场"
    hits = [n for n in sg["nodes"] if n.get("id") == NODE_ID]
    if len(hits) != 1:
        return f"{label}: 节点 {NODE_ID} 命中 {len(hits)} 件(应恰 1)"
    pos = hits[0]["pos"]
    if pos == [OLD_POS[0], NEW_Y]:
        return "already"
    if pos != OLD_POS:
        return f"{label}: [4014] pos={pos} 非预期旧值 {OLD_POS}(并行改动?拒动)"
    hits[0]["pos"] = [OLD_POS[0], NEW_Y]
    return "applied"


def main() -> int:
    docs, statuses = [], []
    for path in TARGETS:
        doc = json.loads(path.read_text(encoding="utf-8"))
        st = patch_doc(doc, path.name)
        if st not in ("applied", "already"):
            print(f"FAIL  {st}")
            return 1
        docs.append(doc)
        statuses.append((path, st))
    # 全批断言过才落盘(fail-closed);序列化=既有件同款 indent=2 无尾换行(保最小 diff)
    for path, doc, (_, st) in zip(TARGETS, docs, statuses):
        if st == "applied":
            path.write_text(
                json.dumps(doc, ensure_ascii=False, indent=2, separators=(",", ": ")),
                encoding="utf-8")
    for path, st in statuses:
        print(f"{'WRITE' if st == 'applied' else 'SKIP '}  {st:8} {path.relative_to(REPO)}")
    print(f"[4014] y {OLD_POS[1]} → {NEW_Y} 完成;后续=契约测试+layout_check+canvas_deploy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
