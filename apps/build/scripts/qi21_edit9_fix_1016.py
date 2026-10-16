#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1016edit9 换血后的格式账修复(幂等):
① 宿主[7] inputs 恢复 edit 原序(model/positive/positive_single/negative/latent,
   只删尾部的 速度档位/seed 两 widget 项)——顶层 link 的 target_slot 槽位随原序有效;
② 子图 def inputs[].linkIds 按现链重算(origin_id=-10 按 origin_slot 归档;
   outputs[-20].linkIds 同法重算)——治「入口线未登记进 linkIds」。
③ 蓝图再抽取同步。
"""

from __future__ import annotations

import copy
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EDIT_WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
EDIT_BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-道劫-加速子图-edit.json"
ORDER = ["model", "positive", "negative", "positive_single", "latent"]
# 同序安全项:宿主输入序对齐子图定义序(i2i/t2i 皆同序;防按位绑定错线);
# 顶层两线槽位随序互换:link8(negative)→slot2、link69(positive_single)→slot3
TOP_LINK_SLOT_SWAP = {8: 2, 69: 3}
CAMPAIGN = "1016edit9fix"


def main() -> int:
    doc = json.loads(EDIT_WF.read_text(encoding="utf-8"))
    host = next(n for n in doc["nodes"] if n.get("id") == 7)
    by_name = {i["name"]: i for i in host.get("inputs", [])}
    missing = [nm for nm in ORDER if nm not in by_name]
    if missing:
        print(f"[{CAMPAIGN}] FAIL 宿主缺输入口 {missing}")
        return 1
    new_inputs = [by_name[nm] for nm in ORDER]
    if host["inputs"] != new_inputs:
        host["inputs"] = new_inputs
        print(f"[{CAMPAIGN}] ①宿主 inputs 对齐子图定义序: {[i['name'] for i in new_inputs]}")
    for l in doc.get("links", []):
        if isinstance(l, dict) and l.get("id") in TOP_LINK_SLOT_SWAP:
            old = l.get("target_slot")
            l["target_slot"] = TOP_LINK_SLOT_SWAP[l["id"]]
            print(f"[{CAMPAIGN}] ①顶层 link{l['id']} target_slot {old} → {l['target_slot']}")
        elif isinstance(l, list) and len(l) >= 5 and l[0] in TOP_LINK_SLOT_SWAP:
            old = l[4]
            l[4] = TOP_LINK_SLOT_SWAP[l[0]]
            print(f"[{CAMPAIGN}] ①顶层 link{l[0]} target_slot {old} → {l[4]}")
    sg = next(s for s in doc["definitions"]["subgraphs"] if s.get("id") == host["type"])
    slot_ids: dict[int, list[int]] = {}
    out_ids: list[int] = []
    for l in sg.get("links", []):
        if l.get("origin_id") == -10:
            slot_ids.setdefault(int(l["origin_slot"]), []).append(int(l["id"]))
        if l.get("target_id") == -20:
            out_ids.append(int(l["id"]))
    for idx, ent in enumerate(sg.get("inputs", [])):
        want = sorted(slot_ids.get(idx, []))
        got = sorted(ent.get("linkIds") or [])
        if want != got:
            ent["linkIds"] = want
            print(f"[{CAMPAIGN}] ②inputs[{idx}]({ent.get('name')}) linkIds {got} → {want}")
    for ent in sg.get("outputs", []):
        want = sorted(out_ids)
        got = sorted(ent.get("linkIds") or [])
        if want != got:
            ent["linkIds"] = want
            print(f"[{CAMPAIGN}] ②outputs({ent.get('name')}) linkIds {got} → {want}")
    text = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    json.loads(text)
    bak = EDIT_WF.with_name(EDIT_WF.name + ".bak-1016edit9fix")
    if not bak.exists():
        shutil.copy2(EDIT_WF, bak)
    EDIT_WF.write_text(text, encoding="utf-8")
    sys.path.insert(0, str(REPO / "apps/build/scripts"))
    import qi21_accel_turbo_1016 as camp
    bp_doc = camp._extract_blueprint("edit", json.loads(text), camp.FORMS["edit"])
    bpbak = EDIT_BP.with_name(EDIT_BP.name + ".bak-1016edit9fix")
    if not bpbak.exists():
        shutil.copy2(EDIT_BP, bpbak)
    EDIT_BP.write_text(json.dumps(bp_doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[{CAMPAIGN}] 落盘+蓝图再抽取完成")
    return 0


if __name__ == "__main__":
    sys.exit(main())
