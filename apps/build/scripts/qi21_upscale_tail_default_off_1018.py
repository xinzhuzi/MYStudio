#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 ⑤超分尾档·2K 默认旁路(役号 1018tailoff)。

背景(1018 用户令「道劫·⑤超分尾档·2K 默认不生效」):
  - 现态:t2i/i2i 主图 [503] SeedVR2 宿主与 [504] 2K 保存均 ON——每次生图默认
    跑 2K 超分并存第二张 MYStudio-2K(150s 级开销)。
  - 设计意图(契约 6g docstring 明文):「⑤组框=Ctrl+B 整组旁路语义载体」——
    默认应为整组旁路,要 2K 时框选 Ctrl+B 打开。本刀把默认态拨回旁路。
  - 契约安全核:SaveImage 计数(_by_type 不看 mode)/可达性 BFS(走连线)/
    类型白名单(超集)均不受 mode 影响;6g 无任何 mode 锚。

做法(t2i/i2i 两件;幂等 fail-closed):
  [503](D 宿主)/[504](2K 保存) mode→4;t2i [505] 对比件应已 4(术前锚验,
  不动);其余零触碰。备份 apps/output/bak/qi21-upscale-off-1018/。
用法:python3 qi21_upscale_tail_default_off_1018.py [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
W = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像"
FILES = [W / "1_文生图/qi21-道劫-t2i.json", W / "2_图生图/qi21-道劫-i2i.json"]
BAK_ROOT = REPO / "apps/output/bak/qi21-upscale-off-1018"
CAMPAIGN = "1018tailoff"
SG_NAME = "道劫·超分·SeedVR2"
TARGETS = (503, 504)
PREFIX = "MYStudio-2K"


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def verify(doc, applied):
    nodes = {n["id"]: n for n in doc["nodes"]}
    sg_ids = {s["id"] for s in doc["definitions"]["subgraphs"] if s["name"] == SG_NAME}
    assert len(sg_ids) == 1, "SeedVR2 子图定义应恰 1"
    n503, n504 = nodes[503], nodes[504]
    assert n503["type"] in sg_ids and n503.get("properties", {}).get("subgraph") in sg_ids, \
        "[503] 非 SeedVR2 宿主(术前锚失)"
    assert n504["type"] == "SaveImage" and n504["widgets_values"] == [PREFIX], \
        "[504] 非 2K 保存(术前锚失)"
    want = 4 if applied else 0
    assert n503.get("mode", 0) == want and n504.get("mode", 0) == want, \
        f"[503]/[504] mode 应 {want},得 {n503.get('mode')}/{n504.get('mode')}"
    n505 = nodes.get(505)
    if n505 is not None and n505["type"].startswith("Image Comparer"):
        assert n505.get("mode") == 4, "[505] 对比件应保持旁路"
    return True


def process(path):
    raw = path.read_bytes()
    doc = json.loads(raw)
    try:
        verify(doc, applied=True)
        return "applied"
    except AssertionError:
        pass
    try:
        verify(doc, applied=False)
    except AssertionError as e:
        fail(f"{path.name}: 术前锚失({e})")
    for n in doc["nodes"]:
        if n["id"] in TARGETS:
            n["mode"] = 4
    verify(doc, applied=True)
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode()
    bak = BAK_ROOT / path.relative_to(REPO)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)
    if hashlib.md5(bak.read_bytes()).hexdigest() != hashlib.md5(raw).hexdigest():
        fail(f"{path.name}: 备份损坏")
    tmp = path.with_name(path.name + f".tmp-{CAMPAIGN}")
    tmp.write_bytes(blob)
    tmp.replace(path)
    verify(json.loads(path.read_bytes()), applied=True)
    print(f"[{CAMPAIGN}] {path.name}: [503]/[504] mode→4(默认旁路;Ctrl+B 开启)"
          f" | 备份=apps/output/bak/qi21-upscale-off-1018/…")
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    if args.check:
        for p in FILES:
            try:
                verify(json.loads(p.read_bytes()), applied=True)
                print(f"[{CAMPAIGN}] --check {p.name}: 已施")
            except AssertionError:
                print(f"[{CAMPAIGN}] --check {p.name}: 未施")
        return 0
    states = [process(p) for p in FILES]
    if set(states) == {"applied"}:
        print(f"[{CAMPAIGN}] 幂等复跑:两件均处已施态,exit 3")
        return 3
    if len(set(states)) > 1:
        fail(f"两件状态不一致:{dict(zip([p.name for p in FILES], states))}")
    print(f"[{CAMPAIGN}] 手术完成:⑤尾档默认旁路(要 2K=框选⑤组 Ctrl+B;"
          f"fire 正器 --upscale2k 显式路径不受影响)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
