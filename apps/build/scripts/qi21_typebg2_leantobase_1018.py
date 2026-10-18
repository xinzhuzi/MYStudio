#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全型背景段底座化·第二批(役号 1018typebg2;1018 用户令「都要改造」)。

范围:有背景描述的其余四型——场景/美宣/分镜剧情图/概念气氛图(人物已随 1018typebg
先行);道具/人物多视图/高清人脸/表情差分=透明底、设定卡=净空板,无背景段不动。
手法:底座词汇移植(工笔重彩与白描/细彩线/线条细稳连贯/平整分层/边界清晰锐利/
矿物色质感鲜泽通透/多色相并陈主次分明饱和度适中/彩色连环画概括/画面洁净平整),
各型结构职责(三层分明/场景净空/铺满画幅/界画程式/低饱和远景/叙事净空)逐条保留。
落点:三副本(仓库真源/引擎 daojie-data 热读/装机 Resources)同刀,md5 三方一致。
守卫:锚段恰一次+原子写+回读+备份 apps/output/bak/qi21-typebg2-1018/;幂等 exit 3。
用法:python3 qi21_typebg2_leantobase_1018.py [--check]
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
BAK_ROOT = REPO / "apps/output/bak/qi21-typebg2-1018"
CAMPAIGN = "1018typebg2"

PAIRS = {
    "场景": (
        "空镜场景，前景、中景、远景三层分明，环境即画面主体。前景物件以细线完整勾勒并分染，材质与结构细节清晰；中景物件以线描勾出形体、单次分染，件件可辨可数，色彩分层罩染，色面交界清楚整齐；远景只留大形，交给低饱和的整块平整色面，层层退远而色相与边界保持清晰，保持场景净空。树木山石水面按工笔程式归纳：树干细线双勾填色，树冠为成块色面、边缘以细线勾出叶形轮廓，叶簇成组排列；山石以勾线分面、整面平涂填彩，石纹以疏线示意；山体归纳为大块色面层叠，远山为单色平涂剪影；水面为平整色面配线描波纹，波光与倒影归纳为平整色面；天空归纳为整片平整色面；建筑按界画程式呈现，墙体屋顶为平整色面，屋脊檐角与斗拱窗棂以细线勾勒，砖瓦归纳为整齐色带。环境色面铺满画幅，色彩出自场景叙事，色面连续铺到画框边缘；色彩层次承担画面呼吸，传统色较高强度多色相并陈，照明与底色服从场景时段。",
        "空镜场景，前景、中景、远景三层分明，环境即画面主体，带彩色连环画的概括造型感。前景物件以细彩线完整勾勒，线条细稳连贯，分染交代材质与结构，细节清晰；中景物件白描线勾出形体、平整色面填彩，件件可辨可数，色彩分层罩染，色面交界清楚锐利；远景只留大形，交给低饱和的整块平整色面，色面平整分层，层层退远而色相与边界保持清晰锐利，保持场景净空。树木山石水面按工笔重彩程式归纳：树干细彩线双勾填色，树冠为成块色面、边缘以细彩线勾出叶形轮廓，叶簇成组排列；山石以细彩线分面、整面平涂填彩，石纹以疏线示意；山体归纳为大块色面层叠，远山为单色平涂剪影；水面为平整色面配线描波纹，波光与倒影归纳为平整色面；天空归纳为整片平整色面；建筑按界画程式呈现，墙体屋顶为平整色面，屋脊檐角与斗拱窗棂以细彩线勾勒，砖瓦归纳为整齐色带。环境色面铺满画幅，色彩出自场景叙事，色面连续铺到画框边缘；色彩层次承担画面呼吸，用色矿物色质感鲜泽通透，多色相并陈、主次分明、饱和度适中；画面洁净平整；照明与底色服从场景时段。",
    ),
    "美宣": (
        "背景以工笔概括手法铺陈：近景物象细线勾形、边缘清楚，中景物象线描勾出形体，远景归纳为整块平整色面、边界清晰分明，层与层以色相与明度阶区分，云雾亦画为成片色面，树木山石以勾线定形、色面填彩的程式归纳；背景色相出自画中场景与时段，传统色较高强度多色相并陈，宣纸白仅作局部透气；光色服从来源事实，落为整片色面的冷暖倾向，明暗以色相深浅与主次关系交代。",
        "背景以工笔重彩与白描铺陈：近景物象以细彩线勾形，线条细稳连贯、边缘清楚锐利；中景物象白描线勾出形体、平整色面填彩，带彩色连环画的概括造型感；远景归纳为整块平整色面，色面平整分层、边界清晰锐利，层与层以色相与明度阶区分；云雾亦画为成片平整色面；树木山石以细彩线定形、矿物色面填彩。背景用色矿物色质感鲜泽通透，多色相并陈、主次分明、饱和度适中，色相出自画中场景与时段，宣纸白仅作局部透气；光色服从来源事实，落为整片色面的冷暖倾向，明暗以色相深浅与主次关系交代。",
    ),
    "分镜剧情图": (
        "一幅单格叙事画面，前后笔意连贯：前景、中景、远景层层分开，人物细节密度最高，衣纹配器与须发细节完整呈现。近处轮廓清楚、线条饱满，远景以低饱和的整块平整色面退去，色面边界清晰，保持叙事所需净空。树木山石以勾线定形、色面填彩的程式归纳。环境色面铺满画幅，色彩出自场景叙事，色面连续铺到画框边缘；传统色较高强度多色相并陈。",
        "一幅单格叙事画面，前后笔意连贯，带彩色连环画的概括造型感：前景、中景、远景层层分开，人物细节密度最高，衣纹配器与须发细节完整呈现。近处以细彩线勾形，轮廓清楚、线条细稳连贯；远景以低饱和的整块平整色面退去，色面平整分层、边界清晰锐利，保持叙事所需净空。树木山石以细彩线定形、矿物色面填彩的程式归纳。环境色面铺满画幅，色彩出自场景叙事，色面连续铺到画框边缘；用色矿物色质感鲜泽通透，多色相并陈、主次分明、饱和度适中。",
    ),
    "概念气氛图": (
        "一幅以气氛为主的画面，主体落在画面偏侧。细线只勾近处轮廓；远处交给色彩分明的低饱和整块平整色面，层层退远，保持场景净空。树木山石以勾线定形、色面填彩的程式归纳。色彩层次承担画面呼吸，画面边缘归纳为整块色面，近处轮廓清楚，主体细节完整呈现；底色随场景时段，焦点色与背景色面多色相并陈各安其位，较高强度、饱和有度；光色与底色服从场景时段，落为整片色面的冷暖倾向。",
        "一幅以气氛为主的画面，主体落在画面偏侧，带彩色连环画的概括造型感。近处以细彩线勾轮廓，线条细稳连贯；远处交给色彩分明的低饱和整块平整色面，色面平整分层、边界清晰锐利，层层退远，保持场景净空。树木山石以细彩线定形、矿物色面填彩的程式归纳。色彩层次承担画面呼吸，画面边缘归纳为整块色面，近处轮廓清楚锐利，主体细节完整呈现；底色随场景时段，焦点色与背景色面多色相并陈、主次分明、各安其位，用色矿物色质感鲜泽通透、饱和度适中；画面洁净平整；光色与底色服从场景时段，落为整片色面的冷暖倾向。",
    ),
}


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def apply_to(doc) -> str:
    states = []
    for zh, (old, new) in PAIRS.items():
        t = next((x for x in doc["types"] if x.get("zh") == zh), None)
        if t is None:
            raise KeyError(f"{zh} 型缺失")
        pt = t["positive_text"]
        if new in pt and old not in pt:
            states.append("applied")
            continue
        if pt.count(old) != 1:
            raise ValueError(f"{zh}: 旧段计数 {pt.count(old)}≠1(锚失/半态)")
        t["positive_text"] = pt.replace(old, new)
        states.append("done")
    if len(set(states)) > 1:
        raise ValueError(f"批内半态:{dict(zip(PAIRS, states))}")
    return states[0]


def process(path: Path) -> str:
    raw = path.read_bytes()
    digest0 = hashlib.md5(raw).hexdigest()
    doc = json.loads(raw)
    if apply_to(doc) == "applied":
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
    if apply_to(json.loads(path.read_bytes())) != "applied":
        fail(f"{path}: 回读终验未过")
    print(f"[{CAMPAIGN}] {path}: 四型背景段已底座化")
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
            try:
                states[str(p)] = apply_to(json.loads(p.read_bytes()))
            except (KeyError, ValueError) as e:
                states[str(p)] = f"锚失:{e}"
            continue
        try:
            states[str(p)] = process(p)
        except (KeyError, ValueError) as e:
            fail(f"{p}: {e}")
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
    md5s = {hashlib.md5(p.read_bytes()).hexdigest() for p in FILES}
    if len(md5s) != 1:
        fail(f"三副本 md5 不一致:{md5s}")
    print(f"[{CAMPAIGN}] 手术完成:场景/美宣/分镜剧情图/概念气氛图四型背景段底座化,"
          f"三副本一致 md5={list(md5s)[0][:10]}…;引擎热读即时生效")
    return 0


if __name__ == "__main__":
    sys.exit(main())
