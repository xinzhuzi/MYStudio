#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人物型云雾句空气化·单刀(役号 1018typeair;1018 用户令「你觉得哪个好,就用哪个吧」)。

采纳 1018sgzs 空气句 A/B/C 多轮对照实验 B 臂判决,落位=人物型**单型**:
- 实验实证(apps/output/qi21-sgzs-air-ab-1018/):人物型 A=零空气(型文把云雾
  压平),B=氤氲稳定复现(r2 换种子全特征在位)+turbo 七成存活零泥糊;C 负向
  松绑踩 CG 门槛封顶不采;场景型主体句自带空气语言增量冗余不动;透明五型
  零环境词不碰——故只动人物型一处。
- 手法:型文背景段云雾压平句 → 罩染渐淡空气句(实验原文机制:罩染层层推开/
  渐次转淡叠出深远/雾气流动/边界仍清晰);其余逐字不动(最小 diff 纪律)。
- 落点:三副本(仓库真源/引擎 daojie-data 热读/装机 Resources)同刀,md5 三方
  一致;守卫=锚段在该型 positive_text 恰一次+原子写+回读+备份
  apps/output/bak/qi21-typeair-1018/;幂等 exit 3。
用法:python3 qi21_typeair_1018.py [--check]
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
BAK_ROOT = REPO / "apps/output/bak/qi21-typeair-1018"
CAMPAIGN = "1018typeair"
TYPE_ZH = "人物"
OLD = "云雾亦画为成片平整色面；"
NEW = ("云雾烟霭以淡色罩染层层推开、渐次转淡叠出深远，"
       "通幅有雾气流动，而色面边界仍清晰分明；")


def fail(msg):
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def apply_to(doc) -> str:
    entries = [t for t in doc.get("types", []) if t.get("zh") == TYPE_ZH]
    if len(entries) != 1:
        fail(f"types[] 中「{TYPE_ZH}」条目数={len(entries)}(应恰 1)")
    pt = entries[0]["positive_text"]
    n = pt.count(OLD)
    if n == 0:
        if NEW in pt:
            return "already"
        fail(f"「{TYPE_ZH}」positive_text 锚段零命中且新句不在=文本非预期,先核对现状")
    if n > 1:
        fail(f"锚段出现 {n} 次(应恰 1),拒绝盲替")
    entries[0]["positive_text"] = pt.replace(OLD, NEW, 1)
    return "done"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只验不写")
    args = ap.parse_args()

    BAK_ROOT.mkdir(parents=True, exist_ok=True)
    states, docs = [], []
    for p in FILES:
        if not p.is_file():
            fail(f"副本缺失: {p}")
        raw = p.read_bytes()
        doc = json.loads(raw.decode("utf-8"))
        st = apply_to(doc) if not args.check else (
            "would-done" if OLD in json.dumps(
                [t for t in doc["types"] if t.get("zh") == TYPE_ZH][0],
                ensure_ascii=False) else ("already" if NEW in json.dumps(
                [t for t in doc["types"] if t.get("zh") == TYPE_ZH][0],
                ensure_ascii=False) else "anchor-miss"))
        states.append(st)
        docs.append(doc)
        print(f"[{CAMPAIGN}] {p.name}@{p.parent.parent.name if p.parent.name == 'json' else '…'}: {st}")

    if args.check:
        print(f"[{CAMPAIGN}] CHECK 毕:{dict(zip(['repo', 'engine', 'app'], states))}")
        return 0
    if all(s == "already" for s in states):
        print(f"[{CAMPAIGN}] 幂等:三副本均已施术,exit 3")
        sys.exit(3)
    if len(set(states)) != 1:
        fail(f"三副本状态不一致:{states}(先对齐再施术)")

    for p, doc in zip(FILES, docs):
        bak = BAK_ROOT / f"{p.parent.parent.name if p.parent.name != 'daojie-data' else 'daojie-data'}.qi21_bases.json"
        if not bak.exists():
            shutil.copy2(p, bak)
        tmp = p.with_suffix(".json.tmp-typeair")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        # 回读校验:重解析+新句在位+旧句绝迹(该型内)
        reread = json.loads(tmp.read_text(encoding="utf-8"))
        rpt = [t for t in reread["types"] if t.get("zh") == TYPE_ZH][0]["positive_text"]
        if NEW not in rpt or OLD in rpt:
            tmp.unlink(missing_ok=True)
            fail(f"回读校验失败: {p}")
        tmp.replace(p)  # 原子替换

    m = {p.parent.parent.name if p.parent.name != "json" else "repo":
         hashlib.md5(p.read_bytes()).hexdigest() for p in FILES}
    if len(set(m.values())) != 1:
        fail(f"三方 md5 不一致:{m}")
    print(f"[{CAMPAIGN}] DONE 三副本同刀 md5={next(iter(m.values()))} 备份={BAK_ROOT}")
    print(f"[{CAMPAIGN}] 换文:人物型「{OLD[:12]}…」→「{NEW[:24]}…」")


if __name__ == "__main__":
    main()
