#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 [7034] 风格LoRA·mikkoani 默认强度 ×1.0→×0.8(役号 1019mikko08;用户令「改成默认 x0.8」)。

- 现态:mikkoani×1.0 mode0(1018mikko 转正值)→ 终态:×0.8 mode0(拓扑零动)。
- 足迹:六件(3 画布+3 蓝图)+ i2i 桥契约模板 graph["7:7034"];edit 变体无 7016
  注释节点=1018 同款容差;t2i 桥渠道本就不挂 mikkoani(本次不扩权,候令)。
- 双写:widgets_values + widgets_values_named 同改(widget 双槽序列化家法);
  title (×1.0)→(×0.8);Note 7016 段内 mikkoani 行换文(其余 ×1.0 字样他因不动)。
- 守卫:术前锚(wv/wvn/mode/title 逐字)+回读+备份 apps/output/bak/qi21-mikkoani-str08-1019/;
  幂等 exit 3;半批 fail。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
BAK = REPO / "apps/output/bak/qi21-mikkoani-str08-1019"
SG_NAME = "道劫·加速子图"
LORA_FILE = "qi21-mikkoani.safetensors"
OLD_STR, NEW_STR = 1.0, 0.8
OLD_TITLE = "[7034] 风格LoRA·mikkoani(×1.0)"
NEW_TITLE = "[7034] 风格LoRA·mikkoani(×0.8)"
SEG_OLD = "[7034] 风格LoRA·mikkoani ×1.0(1018 用户令「使用 mikkoani,默认打开」——"
SEG_NEW = ("[7034] 风格LoRA·mikkoani ×0.8(1019 用户令「默认改×0.8」,原×1.0=1018 用户令"
           "「使用 mikkoani,默认打开」——")
FILES = [BASE / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-edit.json"]
API = BASE / "workflows/1_图片/Q2-1图像/2_图生图/qwen21-道劫-i2i-api.json"
API_NODE = "7:7034"


def fail(m):
    print(f"[1019mikko08] FAIL: {m}")
    sys.exit(1)


def find7034(doc):
    sg = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    assert len(sg) == 1
    sg = sg[0]
    return sg, next(n for n in sg["nodes"] if n["id"] == 7034)


def note_state(sg):
    note = next((x for x in sg["nodes"] if x["id"] == 7016), None)
    if note is None:
        return None
    wv0 = (note.get("widgets_values") or [""])[0]
    named = (note.get("widgets_values_named") or {}).get("text")
    return wv0, named


def applied_six(doc):
    sg, n = find7034(doc)
    wvn = n.get("widgets_values_named")
    if n["widgets_values"] != [LORA_FILE, NEW_STR] or n.get("mode") != 0 \
            or n.get("title") != NEW_TITLE:
        return False
    if wvn is not None and wvn.get("strength_model") != NEW_STR:
        return False
    st = note_state(sg)
    if st is not None:
        for t in st:
            if t is not None and (SEG_NEW not in t or SEG_OLD in t):
                return False
    return True


def anchor_six(doc, name):
    sg, n = find7034(doc)
    wvn = n.get("widgets_values_named")
    if n["widgets_values"] != [LORA_FILE, OLD_STR] or n.get("mode") != 0 \
            or n.get("title") != OLD_TITLE:
        fail(f"{name}: 术前锚失 wv={n['widgets_values']} mode={n.get('mode')} title={n.get('title')!r}")
    if wvn is not None and wvn.get("strength_model") != OLD_STR:
        fail(f"{name}: wvn 术前锚失 {wvn}")
    return sg, n


def rewrite(path, doc):
    raw = path.read_bytes()
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode()
    bk = BAK / path.relative_to(REPO)
    bk.parent.mkdir(parents=True, exist_ok=True)
    if not bk.exists():
        shutil.copy2(path, bk)
        if hashlib.md5(bk.read_bytes()).hexdigest() != hashlib.md5(raw).hexdigest():
            fail(f"{path.name}: 备份损坏")
    tmp = path.with_name(path.name + ".tmp-1019mikko08")
    tmp.write_bytes(blob)
    tmp.replace(path)


def main():
    states = {}
    for p in FILES:
        doc = json.loads(p.read_bytes())
        if applied_six(doc):
            states[p.name] = "applied"
            continue
        sg, n = anchor_six(doc, p.name)
        n["widgets_values"] = [LORA_FILE, NEW_STR]
        if n.get("widgets_values_named") is not None:
            n["widgets_values_named"] = {"lora_name": LORA_FILE, "strength_model": NEW_STR}
        n["title"] = NEW_TITLE
        st = note_state(sg)
        if st is not None:
            note = next(x for x in sg["nodes"] if x["id"] == 7016)
            if SEG_OLD in st[0]:
                note["widgets_values"][0] = st[0].replace(SEG_OLD, SEG_NEW)
            if st[1] is not None and SEG_OLD in st[1]:
                note["widgets_values_named"]["text"] = st[1].replace(SEG_OLD, SEG_NEW)
        rewrite(p, doc)
        if not applied_six(json.loads(p.read_bytes())):
            fail(f"{p.name}: 回读终验未过")
        states[p.name] = "done"

    raw = API.read_bytes()
    api = json.loads(raw)
    node = api["graph"].get(API_NODE)
    if node is None or node["inputs"].get("lora_name") != LORA_FILE:
        fail(f"{API.name}: graph[{API_NODE}] 术前锚失")
    if node["inputs"].get("strength_model") == NEW_STR:
        states[API.name] = "applied"
    elif node["inputs"].get("strength_model") != OLD_STR:
        fail(f"{API.name}: strength 术前锚失 {node['inputs'].get('strength_model')}")
    else:
        node["inputs"]["strength_model"] = NEW_STR
        rewrite(API, api)
        chk = json.loads(API.read_bytes())["graph"][API_NODE]["inputs"]
        if chk.get("strength_model") != NEW_STR or chk.get("lora_name") != LORA_FILE:
            fail(f"{API.name}: 回读终验未过")
        states[API.name] = "done"

    print(f"[1019mikko08] {states}")
    vals = set(states.values())
    if len(vals) > 1:
        fail("七件半批")
    return 3 if vals == {"applied"} else 0


if __name__ == "__main__":
    sys.exit(main())
