#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 [4018] 画幅建议器建议路清退手术 1008(用户令「无用就清理了吧」)。

删 MyQi21WhSuggest 在 t2i 主图节点 [4018] 的死槽(wh_ratio/联动开关——
1006 API-PE 换装后 wh_ratio 出口撤销、建议路全链休眠,五树指纹扫定谳
全库唯 t2i 一处消费):
  - inputs[] 两槽删除;九型W/H 槽号前移(1/2→0/1),主图 links 212/213
    target_slot 同批改(删中间槽=槽号整体移位,连线不跟=输入入口消失);
  - widgets_values [false,0,0,false,0,0]→[0,0,0,0];widgets_values_named
    删 wh_ratio/联动开关 两键;
  - [402] 速查卡「联动开关恒关」两处提法正名(槽已整删,非恒关)。

配套同批:my_qi21_wh_suggest.py 删建议路源码(另一文件)+契约测试
test_qwen21_workflow_contract.py 重锚(wh/联动防回潮锚+212/213 槽号
0/1)+节点测试重写。蓝图零波及([4018] 恒主图,蓝图子图无此件)。

落点=数据副本 4 件(仓库/装机/构建/引擎家用户区)同 md5 家族(沿
qi21_cards_refresh_1008 家族约定)。DRY_RUN=1 只验串不写盘(默认 apply)。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_REL = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
TARGETS = [
    REPO / WF_REL,
    Path("/Applications/漫影工作室.app/Contents/Resources") / WF_REL.replace("apps/backend/", "backend/", 1),
    REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / WF_REL.replace("apps/backend/", "backend/", 1),
    Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/workflows" / WF_REL.split("workflows/", 1)[1],
]

DRY = os.environ.get("DRY_RUN", "") == "1"

# [402] 卡正名对(必须恰命中 1 次;前置=1008 卡片刷新后的现文)
CARD_PAIRS = [
    ("画幅建议器(联动开关恒关=原样直通件;MyQi21WhSuggest,1004 迁出子图)",
     "画幅建议器(原样直通件;MyQi21WhSuggest,1004 迁出子图;1008 联动开关/wh_ratio 槽清退)"),
    ("——[4018] 联动开关恒关,现役身份=AI/型宽高原样直通件。",
     "——[4018] 联动开关/wh_ratio 槽已于 1008 整体清退,现役身份=AI/型宽高原样直通件(手动宽高成对可盖)。"),
]


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def main():
    # ── 前置:四副本 md5 家族一致(沿 cards_refresh 家族约定,防覆写异版) ──
    missing = [str(p) for p in TARGETS if not p.exists()]
    if missing:
        fail(f"家族缺副本: {missing}")
    sigs = {md5(p) for p in TARGETS}
    if len(sigs) != 1:
        for p in TARGETS:
            print("  ", md5(p), p)
        fail("工作流家族副本不一致,先查明再动")
    print("[pre] 四副本 md5 一致 ✓")

    d = json.loads(TARGETS[0].read_text(encoding="utf-8"))

    # ── 1) [4018] 死槽清退 ──
    cand = [n for n in d["nodes"] if n.get("id") == 4018]
    if len(cand) != 1:
        fail("定位 4018 失败")
    wh = cand[0]
    if wh["type"] != "MyQi21WhSuggest":
        fail(f"4018 type 异: {wh['type']}")
    names = [i["name"] for i in wh["inputs"]]
    if names != ["wh_ratio", "九型WIDTH", "九型HEIGHT", "联动开关"]:
        fail(f"4018 inputs 前置不符(期望旧四槽): {names}")
    if wh["widgets_values"] != [False, 0, 0, False, 0, 0]:
        fail(f"4018 widgets_values 前置不符: {wh['widgets_values']}")
    wh["inputs"] = [i for i in wh["inputs"]
                    if i["name"] not in ("wh_ratio", "联动开关")]
    wh["widgets_values"] = [0, 0, 0, 0]
    wvn = wh.get("widgets_values_named", {})
    for k in ("wh_ratio", "联动开关"):
        wvn.pop(k, None)
    wh["widgets_values_named"] = wvn
    if [i["name"] for i in wh["inputs"]] != ["九型WIDTH", "九型HEIGHT"]:
        fail("4018 终态 inputs 异")

    # ── 2) 主图 links 212/213 target_slot 前移(删中间槽=槽号整体移位) ──
    for lid, old_slot, new_slot, near in ((212, 1, 0, "九型WIDTH"),
                                          (213, 2, 1, "九型HEIGHT")):
        links = [l for l in d["links"] if l[0] == lid]
        if len(links) != 1:
            fail(f"link{lid} 定位失败")
        l = links[0]
        if l[3] != 4018 or l[4] != old_slot:
            fail(f"link{lid} 前置不符(期望 dst=4018 槽{old_slot}={near}): {l}")
        l[4] = new_slot

    # ── 3) [402] 卡正名 ──
    cand = [n for n in d["nodes"] if n.get("id") == 402]
    if len(cand) != 1:
        fail("定位 402 失败")
    wv = cand[0]["widgets_values"]
    idx = [i for i, v in enumerate(wv) if isinstance(v, str) and len(v) > 300]
    if len(idx) != 1:
        fail("402 卡文槽定位失败")
    t = wv[idx[0]]
    for old, new in CARD_PAIRS:
        c = t.count(old)
        if c != 1:
            fail(f"[402] 配对命中 {c} 次(须1): {old[:40]!r}")
        t = t.replace(old, new)
    wv[idx[0]] = t

    if DRY:
        print(f"[dry] 验串全过:4018 槽清退+212/213 槽号前移+402 卡 {len(CARD_PAIRS)} 对(未写盘)")
        return

    # ── 4) 写仓库+同步其余三副本 ──
    TARGETS[0].write_text(
        json.dumps(d, ensure_ascii=False, indent=2, separators=(",", ": ")),
        encoding="utf-8")
    print("[write] 仓库件已落盘")
    for dst in TARGETS[1:]:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(TARGETS[0], dst)
        if md5(dst) != md5(TARGETS[0]):
            fail(f"同步校验失败: {dst}")
    print("[sync] 装机/构建/引擎家 三副本已同 md5 ✓")

    # ── 5) 终验:JSON 可解析 + 终态锚 ──
    for p in TARGETS:
        json.loads(p.read_text(encoding="utf-8"))
    d2 = json.loads(TARGETS[0].read_text(encoding="utf-8"))
    wh2 = next(n for n in d2["nodes"] if n["id"] == 4018)
    assert [i["name"] for i in wh2["inputs"]] == ["九型WIDTH", "九型HEIGHT"]
    assert wh2["widgets_values"] == [0, 0, 0, 0]
    lm = {l[0]: l for l in d2["links"]}
    assert lm[212][4] == 0 and lm[213][4] == 1
    print("[verify] 4 件 JSON 合法 + [4018] 终态锚全在 ✓")


if __name__ == "__main__":
    main()
