#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 [7034] Inklingv2 暂时旁路(役号 1018inkbp;用户令「暂时先旁路这个节点」)。

做法:六件(t2i/i2i/edit 三主件+三蓝图)的 [7034] mode→4(Ctrl+B 同款;节点/连线/
widget 全保留,复启=再跑本脚本 --resume 或画布 Ctrl+B)。随刀:契约 style_lora
锚翻旁路态+fire 两件 mode 感知(另笔直改)。守卫:锚验(7034 在册/文件名逐字/
当前 mode==0)+回读+备份 apps/output/bak/qi21-inkling-bypass-1018/;幂等 exit 3。
用法:python3 qi21_inkling_bypass_1018.py [--check] [--resume]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/engines/comfyui"
BAK = REPO / "apps/output/bak/qi21-inkling-bypass-1018"
SG_NAME = "道劫·加速子图"
LORA_FILE = "Inklingv2-qwen21_c1-st6000.safetensors"
FILES = [BASE / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-edit.json"]


def fail(m):
    print(f"[1018inkbp] FAIL: {m}")
    sys.exit(1)


def get7034(doc):
    sg = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    assert len(sg) == 1
    sg = sg[0]
    return sg, next(n for n in sg["nodes"] if n["id"] == 7034)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--resume", action="store_true", help="复启(mode 4→0)")
    args = ap.parse_args()
    want = 0 if args.resume else 4
    states = {}
    for p in FILES:
        raw = p.read_bytes()
        d0 = hashlib.md5(raw).hexdigest()
        doc = json.loads(raw)
        sg, n = get7034(doc)
        if n["widgets_values"][0] != LORA_FILE:
            fail(f"{p.name}: [7034] 非 Inklingv2")
        cur = n.get("mode", 0)
        if cur == want:
            states[p.name] = "applied"
            continue
        n["mode"] = want
        blob = (json.dumps(doc, ensure_ascii=False, indent=2)
                + ("\n" if raw.endswith(b"\n") else "")).encode()
        bk = BAK / p.relative_to(REPO)
        bk.parent.mkdir(parents=True, exist_ok=True)
        if not bk.exists():
            shutil.copy2(p, bk)
            if hashlib.md5(bk.read_bytes()).hexdigest() != d0:
                fail(f"{p.name}: 备份损坏")
        tmp = p.with_name(p.name + ".tmp-1018inkbp")
        tmp.write_bytes(blob)
        tmp.replace(path := p)
        _, n2 = get7034(json.loads(p.read_bytes()))
        assert n2.get("mode") == want, "回读未过"
        states[p.name] = "done"
    print(f"[1018inkbp] {('复启' if args.resume else '旁路')}态:{states}")
    vals = set(states.values())
    if len(vals) > 1:
        fail("六件半批")
    return 3 if vals == {"applied"} else 0


if __name__ == "__main__":
    sys.exit(main())
