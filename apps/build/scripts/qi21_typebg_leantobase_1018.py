#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人物海报型类型句·背景段底座化(役号 1018typebg)。

背景(1018 用户令「这个背景描述时,可以偏向美术风格底座」):
  - 人物海报型 positive_text 的背景段是平铺的工笔程式描述,风格化弱于 art_style_base
    (底座自述=工笔重彩与白描/细彩线/平整分层色面/矿物色鲜泽通透/连环画概括)。
  - 本刀把底座风格词汇移植进背景段;人物海报型其余段(主体/衣褶/持握/光色/设色配比)
    与美宣型(同段共享)不动——美宣候另令。

落点(三副本同刀,md5 三方一致才收工):
  ①仓库真源 apps/frontend/assets/studio-manuals/.../qi21_bases.json
  ②引擎热读 ~/Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json
  ③装机 Resources /Applications/漫影工作室.app/.../qi21_bases.json
守卫:锚串恰一次+原子写+回读+备份 apps/output/bak/qi21-typebg-1018/;幂等 exit 3。
用法:python3 qi21_typebg_leantobase_1018.py [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
HOME = Path.home()
FILES = [
    REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json",
    HOME / "Library/Application Support/漫影工作室/comfyui/daojie-data/qi21_bases.json",
    Path("/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"),
]
BAK_ROOT = REPO / "apps/output/bak/qi21-typebg-1018"
CAMPAIGN = "1018typebg"
TYPE_ZH = "人物海报"

OLD = ("背景以工笔概括手法铺陈：近景物象细线勾形、边缘清楚，中景物象线描勾出形体，"
       "远景归纳为整块平整色面、边界清晰分明，层与层以色相与明度阶区分，云雾亦画为成片色面，"
       "树木山石以勾线定形、色面填彩的程式归纳；背景色相出自画中场景与时段，"
       "传统色较高强度多色相并陈，宣纸白仅作局部透气。")
NEW = ("背景以工笔重彩与白描铺陈：近景物象以细彩线勾形，线条细稳连贯、边缘清楚锐利；"
       "中景物象白描线勾出形体、平整色面填彩，带彩色连环画的概括造型感；"
       "远景归纳为整块平整色面，色面平整分层、边界清晰锐利，层与层以色相与明度阶区分；"
       "云雾亦画为成片平整色面；树木山石以细彩线定形、矿物色面填彩。"
       "背景用色矿物色质感鲜泽通透，多色相并陈、主次分明、饱和度适中，"
       "色相出自画中场景与时段；画面洁净平整，宣纸白仅作局部透气。")


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def apply_to(doc) -> str:
    """返回 applied/done;锚失 raise。"""
    t = next((x for x in doc["types"] if x.get("zh") == TYPE_ZH), None)
    if t is None:
        raise KeyError("人物海报型缺失")
    pt = t["positive_text"]
    if NEW in pt and OLD not in pt:
        if pt.count(NEW) != 1:
            raise ValueError("新段计数≠1")
        return "applied"
    if pt.count(OLD) != 1:
        raise ValueError(f"旧背景段计数 {pt.count(OLD)}≠1(锚失/半态)")
    t["positive_text"] = pt.replace(OLD, NEW)
    return "done"


def process(path: Path) -> str:
    raw = path.read_bytes()
    digest0 = hashlib.md5(raw).hexdigest()
    doc = json.loads(raw)
    state = apply_to(doc)
    if state == "applied":
        return "applied"
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode()
    json.loads(blob)
    bak = BAK_ROOT / path.relative_to(REPO if REPO in path.parents else path.anchor)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)
    if hashlib.md5(bak.read_bytes()).hexdigest() != digest0:
        fail(f"{path}: 备份损坏")
    tmp = path.with_name(path.name + f".tmp-{CAMPAIGN}")
    tmp.write_bytes(blob)
    tmp.replace(path)
    reread = json.loads(path.read_bytes())
    if apply_to(reread) != "applied":
        fail(f"{path}: 回读终验未过")
    print(f"[{CAMPAIGN}] {path}: 人物海报型背景段已底座化(备份=apps/output/bak/qi21-typebg-1018/…)")
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()
    states = {}
    for p in FILES:
        if not p.exists():
            fail(f"缺副本 {p}")
        if args.check:
            doc = json.loads(p.read_bytes())
            try:
                states[str(p)] = apply_to(doc)
            except (KeyError, ValueError) as e:
                states[str(p)] = f"锚失:{e}"
            continue
        try:
            states[str(p)] = process(p)
        except (KeyError, ValueError) as e:
            fail(f"{p}: 锚失({e}),拒动")
    if args.check:
        for k, v in states.items():
            print(f"[{CAMPAIGN}] --check {k}: {v}")
        return 0
    vals = set(states.values())
    if "applied" in vals and "done" in vals:
        fail(f"三副本状态不一致:{states}")
    if vals == {"applied"}:
        print(f"[{CAMPAIGN}] 幂等复跑:三副本均处已施态,exit 3")
        return 3
    # md5 三方一致(改后整文件应逐字节一致)
    md5s = {hashlib.md5(p.read_bytes()).hexdigest() for p in FILES}
    if len(md5s) != 1:
        fail(f"三副本 md5 不一致(改前即异源?):{md5s}")
    print(f"[{CAMPAIGN}] 手术完成:三副本一致 md5={list(md5s)[0][:10]}…;引擎热读即时生效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
