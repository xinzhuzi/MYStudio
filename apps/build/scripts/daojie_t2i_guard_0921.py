#!/usr/bin/env python3
"""道劫 t2i 主线工作流布局守卫(09-21 用户令:布局也不许破坏)。

以 ~/Downloads/mystudio-baselines/ 的字节级基底备份为参照,比对当前仓库文件的
**布局指纹**:外层与子图内每个节点的 (type, pos, size, mode)、外层与子图内每个
组框的 (title, id, bounding, color)。内容性改动(权重/文案)不触发布局指纹,
任何坐标/尺寸/组框漂移=FAIL 并逐项列出差异。

用法:
  python3 daojie_t2i_guard_0921.py            # 布局守卫(内容改动后跑这个)
  python3 daojie_t2i_guard_0921.py --full     # 全量守卫:连内容都不许变(整哈希)
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows"
MAIN = REPO / "1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
BASELINE = Path.home() / "Downloads/mystudio-baselines/K2-文生图-道劫-基底-0921-v3-场景终态.json"
BASELINE_SHA = "f581b8ecaceb2e9a82cdfb3931dd41e588f118609e09514e7951269b680c408b"
# 基线沿革:v1=0921-1937(用户手调0.2版,556cfffda3d776d9223accb96abfd642a2399b51997f2b4913cee488a3be9f55)
#          v2=0921 晚(注入手动配置区 7 桩+组20,f8c36b45130f220faad9a1134c08d6c0072841f239c4ad225bf2594d4ad6a9af)
#          v3=0921 深夜(用户画布终态:场景+美学/湿画/鎏金、人物+Afterlight0.2、道具+湿画/鎏金0.2、
#              自建节点153-158、九行加速件全旁路;即上值)


def layout_fingerprint(wf: dict) -> list[str]:
    """布局指纹行列表:节点坐标/尺寸/模式 + 组框。与内容(widgets/links)无关。"""
    lines: list[str] = []

    def nodes_of(ns: list[dict], scope: str) -> None:
        for n in sorted(ns, key=lambda x: (isinstance(x.get("id"), str), x.get("id"))):
            pos = n.get("pos")
            size = n.get("size")
            lines.append(
                f"{scope}#{n.get('id')} {n.get('type')} pos={pos} size={size} mode={n.get('mode', 0)}"
            )

    def groups_of(gs: list[dict], scope: str) -> None:
        for g in sorted(gs, key=lambda x: str(x.get("id"))):
            lines.append(
                f"{scope}#group{g.get('id')} title={g.get('title')!r} bounding={g.get('bounding')} color={g.get('color')}"
            )

    nodes_of(wf.get("nodes", []), "外")
    groups_of(wf.get("groups", []), "外")
    for sg in (wf.get("definitions", {}) or {}).get("subgraphs", []):
        nodes_of(sg.get("nodes", []), f"子图{sg.get('name')}")
        groups_of(sg.get("groups", []), f"子图{sg.get('name')}")
        io = sg.get("inputNode"), sg.get("outputNode")
        lines.append(f"子图{sg.get('name')}#IO锚 input={io[0]} output={io[1]}")
        for slot in sg.get("inputs", []) + sg.get("outputs", []):
            lines.append(
                f"子图{sg.get('name')}#槽 {slot.get('name')}({slot.get('type')}) pos={slot.get('pos')}"
            )
    return lines


def main() -> int:
    if not BASELINE.exists():
        print(f"[FAIL] 基底备份不存在: {BASELINE}")
        return 1
    base_sha = hashlib.sha256(BASELINE.read_bytes()).hexdigest()
    if base_sha != BASELINE_SHA:
        print("[FAIL] 基底备份哈希与登记值不符,备份本身被动过,先查备份!")
        return 1
    cur = json.loads(MAIN.read_text(encoding="utf-8"))
    base = json.loads(BASELINE.read_text(encoding="utf-8"))

    if "--full" in sys.argv:
        cur_sha = hashlib.sha256(MAIN.read_bytes()).hexdigest()
        if cur_sha == base_sha:
            print("[PASS] 全量守卫:当前文件与基底逐字节一致")
            return 0
        print("[FAIL] 全量守卫:文件与基底存在内容差异(若为预期改动请改用默认布局守卫)")
        return 1

    cur_fp = layout_fingerprint(cur)
    base_fp = layout_fingerprint(base)
    if cur_fp == base_fp:
        print(f"[PASS] 布局守卫:布局指纹与基底一致(节点 {len(cur_fp)} 项全同;内容性改动不在守卫范围)")
        return 0
    base_set = set(base_fp)
    cur_set = set(cur_fp)
    print("[FAIL] 布局被改动!与基底差异:")
    for line in cur_fp:
        if line not in base_set:
            print(f"  现值 {line}")
    for line in base_fp:
        if line not in cur_set:
            print(f"  基底 {line}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
