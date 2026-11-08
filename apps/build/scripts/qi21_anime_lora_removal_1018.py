#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 加速子图摘除动漫风格 LoRA [7034](役号 1018animerem;1018anime 逆向)。

背景(1018 用户令「GPT_Image_2_Anime_Illustration_Style_LoRA_qwen_12138 这个
Lora 不行,清理一下吧」):
  - 1018anime 挂件全线退役:6 件(t2i/i2i/edit 三主件+三蓝图)摘 [7034] 节点,
    四扇出原线**保 id 改 origin 回**(-10:0;原线 id 各形逐字核),入针线删除,
    model 入口 linkIds 复原原序;[7016] Note 1018 行清除(双字段);
    edit ④组还原题名「④seed 单源」+原 bounding;t2i/i2i 共用组按立宪公式
    由剩余成员重算(margin30,撞组降 12)。
  - 摘节点配方=1018 超分终裁役沉淀:摘节点必重建节点级链路双向一致性
    (每条改 origin 的线,目标端 input.link 回指核对)。

守卫:术前锚([7034] 在册/文件名逐字/扇出恰四线且 id 逐字=本形预期集)+术后终验
  (节点零残留/零悬空/model 入口四线 origin 全 -10:0/Note 行零残留/edit 组名还原)
  +md5 锚+备份 apps/output/bak/qi21-anime-lora-removal-1018/+原子写+回读终验。
用法:python3 qi21_anime_lora_removal_1018.py [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
BAK_ROOT = REPO / "apps/output/bak/qi21-anime-lora-removal-1018"
CAMPAIGN = "1018animerem"
SG_NAME = "道劫·加速子图"
LORA_FILE = "GPT_Image_2_Anime_Illustration_Style_LoRA_qwen_12138.safetensors"
NEW_ID = 7034
NOTE_LINE = ("[7034] 动漫风格LoRA·GPT-Image-2 ×0.3(1018 用户令:入口单挂——model 边界→[7034]"
             "→四扇出 Turbo[7028]/viggle[7011]/段B底模[7022]/原生臂,三支路共吃;"
             "civitai 2736538 Qwen 2.1 版 3360462;强度上限 0.3)")
EDIT_GROUP_NEW = "④共用控制(seed 单源 · 风格LoRA)"
EDIT_GROUP_OLD = "④seed 单源"
EDIT_GROUP_BB = [40, 350, 320, 230]

W = BASE / "workflows/1_图片/Q2-1图像"
B = BASE / "my_nodes/subgraphs"
FILES = [("t2i", W / "1_文生图/qi21-道劫-t2i.json"),
         ("i2i", W / "2_图生图/qi21-道劫-i2i.json"),
         ("edit", W / "2_图生图/qi21-edit.json"),
         ("t2i", B / "qi21-道劫-加速子图.json"),
         ("i2i", B / "qi21-道劫-加速子图-i2i.json"),
         ("edit", B / "qi21-道劫-加速子图-edit.json")]
# 1018anime 术前实测:各形 model 入口原四线 id(复原目标,逐字)
FANOUT = {"t2i": [103, 4313, 4323, 4400],
          "i2i": [247, 263, 284, 4400],
          "edit": [247, 263, 4410, 4400]}
SHARED_KEYS = ("共用控制", "共享输入")


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def _sg(doc):
    hits = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    if len(hits) != 1:
        raise KeyError("加速子图应恰1")
    return hits[0]


def _node(sg, nid):
    return next(n for n in sg["nodes"] if n["id"] == nid)


def verify_pre(sg, form):
    n = _node(sg, NEW_ID)
    if n["widgets_values"][0] != LORA_FILE:
        fail(f"{form}: [7034] 文件名非目标件({n['widgets_values'][0][:40]}…)")
    outs = n["outputs"][0].get("links") or []
    if sorted(outs) != sorted(FANOUT[form]):
        fail(f"{form}: [7034] 扇出线集 {sorted(outs)} ≠ 预期 {sorted(FANOUT[form])}")
    mi = sg["inputs"][0]
    if mi["name"] != "model" or len(mi.get("linkIds") or []) != 1:
        fail(f"{form}: model 入口 linkIds 非单线态:{mi.get('linkIds')}")


def surgery(sg, form):
    n = _node(sg, NEW_ID)
    L = {l["id"]: l for l in sg["links"]}
    fan = list(n["outputs"][0]["links"])
    in_link = n["inputs"][0]["link"]
    # 四扇出原线:origin 回 -10:0(目标端 input.link 本就指同 id,回接即双向一致)
    for lid in fan:
        L[lid]["origin_id"] = -10
        L[lid]["origin_slot"] = 0
    # 删入针线+节点
    sg["links"] = [l for l in sg["links"] if l["id"] != in_link]
    sg["nodes"] = [x for x in sg["nodes"] if x["id"] != NEW_ID]
    # model 入口复原原序
    sg["inputs"][0]["linkIds"] = list(FANOUT[form])
    # Note 1018 行清除(双字段)
    note = next((x for x in sg["nodes"] if x["id"] == 7016), None)
    if note is not None:
        wv = note.get("widgets_values")
        if isinstance(wv, list) and isinstance(wv[0], str) and NOTE_LINE in wv[0]:
            wv[0] = wv[0].replace("\n" + NOTE_LINE, "").replace(NOTE_LINE, "")
        named = note.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str) \
                and NOTE_LINE in named["text"]:
            named["text"] = named["text"].replace("\n" + NOTE_LINE, "").replace(NOTE_LINE, "")
    # 组还原:edit 题名+bounding 原值;t2i/i2i 共用组公式重算(剩员)
    if form == "edit":
        g = next(g for g in sg["groups"] if g.get("title") == EDIT_GROUP_NEW)
        g["title"] = EDIT_GROUP_OLD
        g["bounding"] = list(EDIT_GROUP_BB)
    else:
        g = next(gg for gg in sg["groups"] if any(k in gg.get("title", "") for k in SHARED_KEYS))
        bx = g["bounding"]
        x0, y0, x1, y1 = bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3]
        mem = [x for x in sg["nodes"]
               if x0 <= x["pos"][0] and x["pos"][0] + x["size"][0] <= x1
               and y0 <= x["pos"][1] and x["pos"][1] + x["size"][1] <= y1]
        others = [gg["bounding"] for gg in sg["groups"] if gg is not g]

        def hits(b):
            return any(b[0] < o[0] + o[2] and o[0] < b[0] + b[2]
                       and b[1] < o[1] + o[3] and o[1] < b[1] + b[3] for o in others)

        for mx in (30, 12):
            b = [min(x["pos"][0] for x in mem) - mx,
                 min(x["pos"][1] for x in mem) - 50,
                 max(x["pos"][0] + x["size"][0] for x in mem) + mx - (min(x["pos"][0] for x in mem) - mx),
                 max(x["pos"][1] + x["size"][1] for x in mem) + 30 - (min(x["pos"][1] for x in mem) - 50)]
            if not hits(b):
                g["bounding"] = [round(v, 1) for v in b]
                break
        else:
            fail(f"{form}: 共用组重算仍撞组")


def verify_post(sg, form):
    assert not [x for x in sg["nodes"] if x["id"] == NEW_ID], "[7034] 残留"
    L = {l["id"]: l for l in sg["links"]}
    assert not [l for l in sg["links"]
                if NEW_ID in (l["origin_id"], l["target_id"])], "7034 线残留"
    mi = sg["inputs"][0]
    assert mi["name"] == "model" and mi["linkIds"] == list(FANOUT[form]), \
        f"model 入口未复原:{mi['linkIds']}"
    for lid in FANOUT[form]:
        l = L[lid]
        assert (l["origin_id"], l["origin_slot"]) == (-10, 0), f"线 {lid} 未回接边界"
        tgt = _node(sg, l["target_id"])
        assert tgt["inputs"][l["target_slot"]]["link"] == lid, f"目标端回指失 {lid}"
    note = next((x for x in sg["nodes"] if x["id"] == 7016), None)
    if note is not None:
        for f in ((note.get("widgets_values") or [""])[0],
                  (note.get("widgets_values_named") or {}).get("text") or ""):
            assert NOTE_LINE not in f and "7034" not in f, "Note 1018 行残留"
    if form == "edit":
        assert not [g for g in sg["groups"] if g.get("title") == EDIT_GROUP_NEW], "edit 新组名残留"
        g = next(g for g in sg["groups"] if g.get("title") == EDIT_GROUP_OLD)
        assert g["bounding"] == EDIT_GROUP_BB, "edit ④ bounding 未还原"
    # 悬空线
    nids = {x["id"] for x in sg["nodes"]} | {-10, -20}
    for l in sg["links"]:
        assert l["origin_id"] in nids and l["target_id"] in nids, f"悬空线 {l['id']}"
    return True


def process(path, form):
    raw = path.read_bytes()
    doc = json.loads(raw)
    sg = _sg(doc)
    if not [x for x in sg["nodes"] if x["id"] == NEW_ID]:
        try:
            verify_post(sg, form)
        except AssertionError as e:
            fail(f"{path.name}: 已摘态但终验未过({e})")
        return "applied"
    verify_pre(sg, form)
    surgery(sg, form)
    verify_post(sg, form)
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
    verify_post(_sg(json.loads(path.read_bytes())), form)
    print(f"[{CAMPAIGN}] {path.name}: [7034] 摘除,四线回接边界,Note/edit④组还原"
          f" | 备份=apps/output/bak/qi21-anime-lora-removal-1018/…")
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    states = {}
    for form, p in FILES:
        if not p.exists():
            fail(f"缺文件 {p}")
        sg = _sg(json.loads(p.read_bytes()))
        if args.check:
            has = bool([x for x in sg["nodes"] if x["id"] == NEW_ID])
            states[p.name] = "未摘" if has else "已摘"
            continue
        states[p.name] = process(p, form)
    if args.check:
        print(f"[{CAMPAIGN}] --check: {states}")
        vals = set(states.values())
        return 3 if vals == {"已摘"} else 0
    vals = set(states.values())
    if "applied" in vals and "done" in vals:
        fail(f"六件状态不一致:{states}")
    print(f"[{CAMPAIGN}] " + ("幂等复跑:六件均处已摘态,exit 3" if vals == {"applied"}
                              else "摘除完成(随刀:契约 style_lora 全套回退+fire 两件回退+引擎删件)"))
    return 3 if vals == {"applied"} else 0


if __name__ == "__main__":
    sys.exit(main())
