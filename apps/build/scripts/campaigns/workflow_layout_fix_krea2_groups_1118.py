# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""krea2 组框越界修复(1118,批次②):两件几何缺陷,只动 pos/groups[].bounding。

① K2-角色设定-道劫: 组①『模型与道劫 LoRA 栈』bbox [40,40,5520,1300] 高到 y1340,
   把并列工序组 ②参考图臂/③补丁/④采样/⑤对比(y700..1460)整排吞进框内 → 4 处 group_overlap。
   实意图只需罩模型装载列(UNET/CLIP/VAE/302/164/90),其最下成员中心 y=570 → 高 620 足矣。
   同步整画布 x+20(节点最左 x=60 → 80, 符合 pos>=80 负区规)。

② K2-道劫修手: 组③ x20..1440 与组② x1420..1820 横向重叠 20px;组③ 最右成员右缘恰 1400,
   宽度 1420→1400 即解除。同步整画布 x+40(节点最左 x=40 → 80)。

守卫: 序列化往返逐字节等价;pos/bbox 只允许旧态或新态(禁混态);改后无节点失去全部组覆盖;
幂等(--check 在已修文件上报 done)。
"""
from __future__ import annotations

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[3]
WF_DIR = ROOT / "apps/backend/comfyui/workflows/1_图片/krea2"

PLANS = {
    "2_图生图/K2-角色设定-道劫.json": {
        "dx": 20,
        "groups": {
            0: [60, 40, 5520, 620],                    # 原 [40,40,5520,1300]
            4: [3800, 700, 1340, 930],                 # 原 [3780,700,1020,930];右缘 4800→5140 包住 307(4770..5100)
        },
    },
    "3_改图/K2-道劫修手.json": {
        "dx": 40,
        "groups": {3: [60, 700, 1400, 500]},           # 原 [20,700,1420,500]
    },
}
INDENT = 2
TRAILING_NL = "\n"


def _dump(doc):
    return json.dumps(doc, ensure_ascii=False, indent=INDENT) + TRAILING_NL


def _center(n):
    s = n.get("size") or [0, 0]
    return n["pos"][0] + s[0] / 2, n["pos"][1] + s[1] / 2


def _inside(bbox, cx, cy):
    return bbox[0] <= cx <= bbox[0] + bbox[2] and bbox[1] <= cy <= bbox[1] + bbox[3]


def _covered(doc):
    overlay = {"Reroute", "AddLabel", "PrimitiveNode"}
    return {n["id"]: sum(1 for g in doc["groups"] if _inside(g["bounding"], *_center(n)))
            for n in doc["nodes"] if n["type"] != "MarkdownNote" and n["type"] not in overlay}


def plan(rel):
    path = WF_DIR / rel
    raw = path.read_text(encoding="utf-8")
    doc = json.loads(raw)
    assert _dump(doc) == raw, f"{rel}: 序列化往返不等价"
    spec = PLANS[rel]
    dx = spec["dx"]
    gtargets = spec["groups"]

    already = (all(n["pos"][0] >= 80 for n in doc["nodes"])
               and all(doc["groups"][gi]["bounding"] == nb for gi, nb in gtargets.items()))
    if already:
        return None

    # 禁混态: 要么全旧(dx 未生效),要么全新
    minx = min(n["pos"][0] for n in doc["nodes"])
    assert minx in (80, 80 - dx), f"{rel}: 非旧/新态 minx={minx}"

    new = json.loads(raw)
    for n in new["nodes"]:
        n["pos"] = [n["pos"][0] + dx, n["pos"][1]]
    for g in new["groups"]:
        b = g["bounding"]
        g["bounding"] = [b[0] + dx, b[1], b[2], b[3]]
    for gi, nb in gtargets.items():
        new["groups"][gi]["bounding"] = list(nb)

    before, after = _covered(doc), _covered(new)
    lost = [nid for nid, c in after.items() if c == 0 and before.get(nid, 0) > 0]
    assert not lost, f"{rel}: 节点失去全部组覆盖 {lost}"
    assert min(n["pos"][0] for n in new["nodes"]) >= 80, rel
    return path, new


def main(argv):
    assert len(argv) == 2 and argv[1] in ("--check", "--apply"), "usage: --check|--apply"
    apply = argv[1] == "--apply"
    for rel in PLANS:
        res = plan(rel)
        if res is None:
            print(f"done  {rel} (已是新态)")
            continue
        path, new = res
        if apply:
            body = _dump(new)
            assert json.loads(body) == new
            path.write_text(body, encoding="utf-8")
            print(f"apply {rel}")
        else:
            print(f"plan  {rel}")


if __name__ == "__main__":
    main(sys.argv)
