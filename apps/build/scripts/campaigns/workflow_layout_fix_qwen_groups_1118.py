# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""Qwen 四件组框越界修复(1118,批次②尾巴):只动 groups[].bounding(本批不需要平移)。

- qwen21-charcard-t2i: 组0『人物提示词』右缘 590 压进组1『千问生成』(左缘 -60) 650px,
  实际只罩节点[1](右缘 -740) → 宽 2230→1560(右缘 -80,留 20 距)。
- qwen21-pose-edit: 组1『加载器+Cache』右缘 2340 压进组2『编辑主链』(左缘 2060) 280px,
  加载器三件右缘≤1900,宽 1240→940(右缘 2040,留 20 距;Cache[9] 中心 2140 归组2,不丢覆盖)。
- t2i-通用: 组0『加载器』右缘 460 压进组1『提示词』(左缘 430) 30px,三件右缘 400,宽 400→360。
- qwen21-t2i: 组0『加载器』右缘 2160 压进组2『PE 提示词改写』(左缘 1860) 300px,
  两件右缘≤1560,宽 1020→700(右缘 1840,留 20 距)。

守卫: 序列化往返逐字节等价;bbox 旧态→新态幂等;改后各节点组覆盖数不降(中心最小面积归属不变);
禁动 links/节点/标题。
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
WF_DIR = ROOT / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1"

PLANS = {
    "5_角色设定卡/qwen21-charcard-t2i.json": {0: [-1640, 20, 1560, 680]},
    "4_姿势编辑/qwen21-pose-edit.json": {1: [1100, 1180, 940, 340]},
    "1_文生图/t2i-通用.json": {0: [60, 120, 360, 620]},
    "1_文生图/qwen21-t2i.json": {0: [1140, 40, 700, 1000]},
    # 生成器 qwen21-multiref-edit-build.py 写的是已退役 engines 旧路径,在此直接修件(见文末注)
    "2_图生图/qwen21-multiref-edit.json": {2: [1620, 700, 1520, 620]},
}
INDENT = 2


def _dump(doc, ind, nl):
    return json.dumps(doc, ensure_ascii=False, indent=ind) + nl


def _raw_and_nl(path):
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    for ind in (1, 2, 4):
        for nl in ("", "\n"):
            if _dump(doc, ind, nl) == raw:
                return raw, ind, nl
    raise AssertionError(f"{path.name}: 序列化往返不等价(未知格式)")


def _cover(doc):
    out = {}
    for n in doc["nodes"]:
        s = n.get("size") or [0, 0]
        cx, cy = n["pos"][0] + s[0] / 2, n["pos"][1] + s[1] / 2
        hits = [gi for gi, g in enumerate(doc["groups"])
                if g["bounding"][0] <= cx <= g["bounding"][0] + g["bounding"][2]
                and g["bounding"][1] <= cy <= g["bounding"][1] + g["bounding"][3]]
        out[n["id"]] = hits
    return out


def plan(rel):
    path = WF_DIR / rel
    raw, ind, nl = _raw_and_nl(path)
    doc = json.loads(raw)
    targets = PLANS[rel]
    if all(doc["groups"][gi]["bounding"] == nb for gi, nb in targets.items()):
        return None
    old_cover = _cover(doc)
    new = json.loads(raw)
    for gi, nb in targets.items():
        assert doc["groups"][gi]["bounding"] != nb, (rel, gi)  # 禁混态
        new["groups"][gi]["bounding"] = list(nb)
    # 非几何字段守卫
    a, b = json.loads(raw), json.loads(raw)
    for d in (a, b):
        for g in d["groups"]:
            g["bounding"] = None
    assert a == b, rel
    new_cover = _cover(new)
    for nid, hits in new_cover.items():
        assert hits or not old_cover[nid], f"{rel}: 节点{nid} 失去全部组覆盖(原 {old_cover[nid]})"
    # 目标: 组框两两不再相交
    bs = [g["bounding"] for g in new["groups"]]
    for i in range(len(bs)):
        for j in range(i + 1, len(bs)):
            A, B = bs[i], bs[j]
            ox = min(A[0] + A[2], B[0] + B[2]) - max(A[0], B[0])
            oy = min(A[1] + A[3], B[1] + B[3]) - max(A[1], B[1])
            assert not (ox > 0 and oy > 0), f"{rel}: 组{i}×{j} 仍重叠 {ox}×{oy}"
    return path, new, ind, nl


def main(argv):
    assert len(argv) == 2 and argv[1] in ("--check", "--apply"), "usage: --check|--apply"
    apply = argv[1] == "--apply"
    for rel in PLANS:
        res = plan(rel)
        if res is None:
            print(f"done  {rel}")
            continue
        path, new, ind, nl = res
        if apply:
            path.write_text(_dump(new, ind, nl), encoding="utf-8")
            print(f"apply {rel}")
        else:
            print(f"plan  {rel}")


if __name__ == "__main__":
    main(sys.argv)
