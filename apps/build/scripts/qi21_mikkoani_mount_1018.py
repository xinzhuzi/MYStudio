#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 [7034] 换装 mikkoani×1.0 默认打开(役号 1018mikko;用户令「使用 mikkoani,默认打开」)。

- 现态:Inklingv2×0.3 mode4(旁路,1018inkbp)→ 终态:qi21-mikkoani.safetensors×1.0 mode0。
- 拓扑零动(挂载位/四扇出/入针全沿用);换 wv 双写/title/mode+Note 1018 行换文。
- 水墨件文件留盘(未删);无触发词(Q2.1 版未登记,实测口径)。
- 守卫:术前锚(Inkling 逐字/0.3/mode4)+回读+备份 apps/output/bak/qi21-mikkoani-1018/;幂等 exit 3。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
BAK = REPO / "apps/output/bak/qi21-mikkoani-1018"
SG_NAME = "道劫·加速子图"
OLD_FILE, OLD_STR, OLD_MODE = "Inklingv2-qwen21_c1-st6000.safetensors", 0.3, 4
NEW_FILE, NEW_STR = "qi21-mikkoani.safetensors", 1.0
NEW_TITLE = "[7034] 风格LoRA·mikkoani(×1.0)"
OLD_NOTE = ("[7034] 水墨风格LoRA·Inklingv2 ×0.3(1018 用户令:替代动漫件同位复挂——model 边界→[7034]"
            "→四扇出 Turbo[7028]/viggle[7011]/段B底模[7022]/原生臂,三支路共吃;"
            "civitai 2977039 v1.0=3374270;触发词 Inklingv2 卡片自标,词法未加候试;强度沿用槽位 0.3)")
NEW_NOTE = ("[7034] 风格LoRA·mikkoani ×1.0(1018 用户令「使用 mikkoani,默认打开」——model 边界→[7034]"
            "→四扇出 Turbo[7028]/viggle[7011]/段B底模[7022]/原生臂,三支路共吃;civitai 2470371 Qwen2.1 版"
            "=3400689,160.1MB;无登记触发词,词法零动;实测:饱和抬升 68→80(T)/98(原生),风格拉力强不惧蒸馏)")
FILES = [BASE / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json",
         BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json",
         BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-edit.json"]


def fail(m):
    print(f"[1018mikko] FAIL: {m}")
    sys.exit(1)


def find7034(doc):
    sg = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    assert len(sg) == 1
    sg = sg[0]
    return sg, next(n for n in sg["nodes"] if n["id"] == 7034)


def applied(doc):
    sg, n = find7034(doc)
    if n["widgets_values"] != [NEW_FILE, NEW_STR] or n.get("mode") != 0 \
            or n.get("title") != NEW_TITLE:
        return False
    note = next((x for x in sg["nodes"] if x["id"] == 7016), None)
    if note is not None:
        wv0 = (note.get("widgets_values") or [""])[0]
        named = (note.get("widgets_values_named") or {}).get("text")
        if NEW_NOTE not in wv0 or OLD_NOTE in wv0:
            return False
        if named is not None and (NEW_NOTE not in named or OLD_NOTE in named):
            return False
    return True


def main():
    states = {}
    for p in FILES:
        raw = p.read_bytes()
        d0 = hashlib.md5(raw).hexdigest()
        doc = json.loads(raw)
        if applied(doc):
            states[p.name] = "applied"
            continue
        sg, n = find7034(doc)
        if n["widgets_values"] != [OLD_FILE, OLD_STR] or n.get("mode") != OLD_MODE:
            fail(f"{p.name}: 术前锚失 {n['widgets_values']} mode={n.get('mode')}")
        n["widgets_values"] = [NEW_FILE, NEW_STR]
        n["widgets_values_named"] = {"lora_name": NEW_FILE, "strength_model": NEW_STR}
        n["mode"] = 0
        n["title"] = NEW_TITLE
        note = next((x for x in sg["nodes"] if x["id"] == 7016), None)
        if note is not None:
            wv0 = note.get("widgets_values")
            if isinstance(wv0, list) and isinstance(wv0[0], str) and OLD_NOTE in wv0[0]:
                wv0[0] = wv0[0].replace(OLD_NOTE, NEW_NOTE)
            named = note.get("widgets_values_named")
            if isinstance(named, dict) and isinstance(named.get("text"), str) \
                    and OLD_NOTE in named["text"]:
                named["text"] = named["text"].replace(OLD_NOTE, NEW_NOTE)
        blob = (json.dumps(doc, ensure_ascii=False, indent=2)
                + ("\n" if raw.endswith(b"\n") else "")).encode()
        bk = BAK / p.relative_to(REPO)
        bk.parent.mkdir(parents=True, exist_ok=True)
        if not bk.exists():
            shutil.copy2(p, bk)
            if hashlib.md5(bk.read_bytes()).hexdigest() != d0:
                fail(f"{p.name}: 备份损坏")
        tmp = p.with_name(p.name + ".tmp-1018mikko")
        tmp.write_bytes(blob)
        tmp.replace(p)
        if not applied(json.loads(p.read_bytes())):
            fail(f"{p.name}: 回读终验未过")
        states[p.name] = "done"
    print(f"[1018mikko] {states}")
    vals = set(states.values())
    if len(vals) > 1:
        fail("六件半批")
    return 3 if vals == {"applied"} else 0


if __name__ == "__main__":
    sys.exit(main())
