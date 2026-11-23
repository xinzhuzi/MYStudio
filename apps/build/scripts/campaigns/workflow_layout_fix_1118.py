#!/usr/bin/env python3
"""1118 画布布局补检:两件冷门自研工作流的立宪坐标修正(断言幂等,禁裸手改)。

依据:0928 画布立宪 est 间距判据(同行横距 ≥200 / 同列纵距 ≥80 / 零负区 pos ≥80 /
线不遮节点),tools/layout_check.py 为可跑实现。两件均为自研件(非导入模板),
修改仅动 pos 与主图 groups[].bounding,不动拓扑/连线/widget 值。

修前(layout_check 实测,1118):
  0_分镜/分镜工作流.json     est_spacing 6(七张 760 宽环节卡整齐 100px 排布)
  2_视频/H3视频/1_漫影自研/导演台.json
      occlusion 3(2/3/4/5 → 6 的入线各自穿过下一张加载器,行距仅 30px)
      est_spacing 6(加载器行距 30/90/60)
      negative_region 2(node1/2 pos=60)

修法:
  分镜工作流 = 环节卡步距 960(760 宽 + 200 缝),四组框按 −40/+40 惯例重钉;
  导演台     = 四个加载器改纵排(UNET→VAE→VAE→CLIP 纵序=6 号输入槽序,入线零交叉),
              6/7/8 横排间距 ≥200,左上说明卡 pos 抬到 80。

用法:
  python3 apps/build/scripts/workflow_layout_fix_1118.py --check   # 只读核对
  python3 apps/build/scripts/workflow_layout_fix_1118.py --apply   # 落盘
退出码:0 已是目标态或已落盘;1 前置态断言失败(未落盘);2 用法错误。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
WF = ROOT / "apps/backend/comfyui/workflows"

TARGETS = [
    {
        "path": WF / "0_分镜/分镜工作流.json",
        "indent": 1,
        "trailing_nl": False,
        "pos_old": {1: [80, 100], 2: [940, 100], 7: [1800, 100], 3: [2660, 100],
                    4: [3520, 100], 5: [4380, 100], 6: [5240, 100]},
        "pos_new": {1: [80, 100], 2: [1040, 100], 7: [2000, 100], 3: [2960, 100],
                    4: [3920, 100], 5: [4880, 100], 6: [5840, 100]},
        "groups_old": [[40, 20, 840, 800], [900, 20, 1700, 800],
                       [2620, 20, 1700, 800], [4340, 20, 1700, 800]],
        "groups_new": [[40, 20, 840, 800], [1000, 20, 1800, 800],
                       [2920, 20, 1800, 800], [4840, 20, 1800, 800]],
    },
    {
        "path": WF / "2_视频/H3视频/1_漫影自研/导演台.json",
        "indent": 2,
        "trailing_nl": True,
        "pos_old": {1: [60, 60], 2: [60, 300], 3: [420, 300], 4: [780, 300],
                    5: [1140, 300], 6: [1560, 120], 7: [2660, 300], 8: [3020, 260]},
        "pos_new": {1: [80, 80], 2: [80, 380], 3: [80, 608], 4: [80, 806],
                    5: [80, 1004], 6: [640, 340], 7: [1880, 560], 8: [2400, 540]},
        "groups_old": None,
        "groups_new": None,
    },
]


class PreStateError(RuntimeError):
    pass


def _load(t):
    raw = t["path"].read_text(encoding="utf-8")
    wf = json.loads(raw)
    exact = json.dumps(wf, ensure_ascii=False, indent=t["indent"]) + ("\n" if t["trailing_nl"] else "")
    if exact != raw:
        raise PreStateError("%s 序列化格式与预期不符(改前须先固化格式),拒绝落盘" % t["path"].name)
    return wf, raw


def _pos_map(wf):
    return {n["id"]: [int(n["pos"][0]), int(n["pos"][1])] for n in wf["nodes"]}


def _groups_bounds(wf):
    return [[int(v) for v in g["bounding"]] for g in (wf.get("groups") or [])]


def plan(t):
    wf, raw = _load(t)
    cur = _pos_map(wf)
    missing = [nid for nid in t["pos_new"] if nid not in cur]
    if missing:
        raise PreStateError("%s 缺节点 %s" % (t["path"].name, missing))
    ids = set(t["pos_new"])
    sub = {k: cur[k] for k in ids}
    state = "new"
    if sub == t["pos_old"]:
        state = "old"
    elif sub != t["pos_new"]:
        raise PreStateError("%s 节点坐标既非修前态也非修后态,拒绝猜测: %s" % (t["path"].name, sub))
    if t["groups_new"] is not None:
        gb = _groups_bounds(wf)
        if state == "old" and gb != t["groups_old"]:
            raise PreStateError("%s 组框既非修前态也非修后态: %s" % (t["path"].name, gb))
        if state == "new" and gb != t["groups_new"]:
            raise PreStateError("%s 组框未随坐标同批更新: %s" % (t["path"].name, gb))
    return wf, raw, state


def apply(t):
    wf, raw, state = plan(t)
    if state == "new":
        return False
    for n in wf["nodes"]:
        if n["id"] in t["pos_new"]:
            n["pos"] = list(t["pos_new"][n["id"]])
    if t["groups_new"] is not None:
        for g, b in zip(wf["groups"], t["groups_new"]):
            g["bounding"] = list(b)
    out = json.dumps(wf, ensure_ascii=False, indent=t["indent"]) + ("\n" if t["trailing_nl"] else "")
    t["path"].write_text(out, encoding="utf-8")
    return True


def main(argv):
    mode = argv[1] if len(argv) > 1 else "--check"
    if mode not in ("--check", "--apply"):
        print(__doc__)
        return 2
    rc = 0
    for t in TARGETS:
        try:
            wf, raw, state = plan(t)
        except PreStateError as e:
            print("FAIL %s" % e)
            rc = 1
            continue
        if mode == "--check":
            print("OK   %-22s state=%s" % (t["path"].name, state))
        else:
            changed = apply(t)
            print("%-5s %-22s state=%s -> %s" % ("WRITE" if changed else "SKIP",
                                                t["path"].name, state,
                                                "new" if changed else "already-new"))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
