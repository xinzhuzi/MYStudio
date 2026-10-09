#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 连线槽位迁移补丁 1008——修 qi21_i2i_structure_debt_1008.py 引入的槽移 bug。

上刀给 PromptSelect 实例 inputs 补「负面词直写」(插@1)/「PE负面」(插@3)后,
inputs 槽位号整体后移,但既有连线按 target_slot 索引寻址=全部错指:
  旧槽1 PE出文 → 应迁 2;旧槽2 pe开关 → 应迁 4;旧槽3 透明模式 → 应迁 5;槽0 不动。
落点同上刀四文件(i2i wf×3/i2i 库件×4/edit wf×3/edit 库件×4)。
终验=全子图每条连线 target/origin 槽名与节点 inputs/outputs 名册一致性核对。
DRY_RUN=1 只验不写。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_I2I = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
WF_EDIT = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
LIB_I2I = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
LIB_EDIT = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json"
REMAPPED = {1: 2, 2: 4, 3: 5}  # 旧槽→新槽(PromptSelect 实例)
DRY = os.environ.get("DRY_RUN", "") == "1"


def deployed(rel, lib):
    sub = rel.replace("apps/backend/", "backend/", 1)
    fam = [
        (REPO / rel),
        Path("/Applications/漫影工作室.app/Contents/Resources") / sub,
        REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / sub,
    ]
    if lib:
        fam.append(Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs" / Path(rel).name)
    return fam


FAMILIES = [
    ("i2i 工作流", deployed(WF_I2I, False)),
    ("i2i 库件", deployed(LIB_I2I, True)),
    ("edit 工作流", deployed(WF_EDIT, False)),
    ("edit 库件", deployed(LIB_EDIT, True)),
]


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def subgraph_of(d):
    hits = [s for s in d["definitions"]["subgraphs"] if "文本提示词" in (s.get("name") or "")]
    if len(hits) != 1:
        fail("子图定位失败")
    return hits[0]


def patch(path, report):
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    sg = subgraph_of(d)
    nodes = {n["id"]: n for n in sg["nodes"]}
    sel_ids = {nid for nid, n in nodes.items() if n["type"] == "MyQi21PromptSelect"}
    moved = []
    for l in sg["links"]:
        if l["target_id"] in sel_ids and l["target_slot"] in REMAPPED:
            old = l["target_slot"]
            l["target_slot"] = REMAPPED[old]
            moved.append(f"link{l['id']}槽{old}→{l['target_slot']}")
    if moved:
        report.append(Path(path).name + ": " + "; ".join(moved))
    return d


def coherence(sg):
    """全子图连线-槽名一致性:每条线 target/origin 槽号落在名册内且类型相符。"""
    nodes = {n["id"]: n for n in sg["nodes"]}
    for l in sg["links"]:
        if l["origin_id"] == -10:
            ins = sg["inputs"]
        elif l["origin_id"] in nodes:
            ins = nodes[l["origin_id"]].get("outputs") or []
        else:
            continue
        if l["origin_slot"] >= len(ins):
            fail(f"link{l['id']} origin_slot {l['origin_slot']} 越界({len(ins)} 出)")
        if l["target_id"] == -20:
            outs = sg["outputs"]
        elif l["target_id"] in nodes:
            outs = nodes[l["target_id"]].get("inputs") or []
        else:
            continue
        if l["target_slot"] >= len(outs):
            fail(f"link{l['id']} target_slot {l['target_slot']} 越界({len(outs)} 入)")
        st = outs[l["target_slot"]].get("type") or ""
        if "*" not in (st, l.get("type") or "") and st != (l.get("type") or ""):
            fail(f"link{l['id']} 类型不符: 线{l.get('type')} vs 槽{st}")


def main():
    for name, fam in FAMILIES:
        sigs = {hashlib.md5(p.read_bytes()).hexdigest() for p in fam if p.exists()}
        if len(sigs) != 1 or any(not p.exists() for p in fam):
            fail(f"{name} 家族副本不一致/缺失")
    print("[pre] 四家族 md5 各自一致 ✓")

    report = []
    results = {}
    for path in (REPO / WF_I2I, REPO / LIB_I2I, REPO / WF_EDIT, REPO / LIB_EDIT):
        results[path] = patch(path, report)
    if not report:
        print("无待迁连线(可能已补过),仅做一致性终验")
    for line in report:
        print("  ", line)

    # 终验(写盘前对改后对象验,写盘后对盘面再验)
    for path, d in results.items():
        coherence(subgraph_of(d))

    if DRY:
        print("[dry] 未写盘")
        return

    for (name, fam), repo_path in zip(FAMILIES, [REPO / WF_I2I, REPO / LIB_I2I, REPO / WF_EDIT, REPO / LIB_EDIT]):
        repo_path.write_text(json.dumps(results[repo_path], ensure_ascii=False, indent=2, separators=(",", ": ")), encoding="utf-8")
        for dst in fam[1:]:
            shutil.copy2(repo_path, dst)
        for p in fam:
            coherence(subgraph_of(json.loads(p.read_text(encoding="utf-8"))))
            assert hashlib.md5(p.read_bytes()).hexdigest() == hashlib.md5(repo_path.read_bytes()).hexdigest(), p
        print(f"[sync] {name} {len(fam)} 副本同 md5+一致性 ✓")


if __name__ == "__main__":
    main()
