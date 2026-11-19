#!/usr/bin/env python3
"""单镜.json 四采带布局治理(1118 美化役·坐标-only 手术脚本,幂等 fail-closed)。

方案=既定美化方案(四采带 ⑧ 分层行重排):
  主链一行 5002→5011→5012→5013→5006→5014→5015→[5016/5019/5017/5018 同列纵堆]→5020→5021→5022→
  5023→5100→4100,列步进=est 宽+200(同行 est 净距恰 200);采样四件同列 x 全等、纵距恰 80、
  行序=5020 输入槽序(noise/guider/sampler/sigmas,⑧1 槽序对齐→扇入零交叉);
  25 寄生 5011 深箱正下方(右缘与 5012 左缘齐平→竖向线零遮挡);1065 寄生 5100 左下(组框 A 内,
  短线上行,躲开 5023→5100 横线);1072 下移 40 补同列净距(1071 est 底 2440+80);
  x0=7200 使 4002→5002 连线让开 4003 右缘(6843)。
  三只组框(四采修脸组/终档组/加载模型)按生成器先例公式自算罩全:
  [minX-60, minY-80, (maxX+声明宽)-minX+60, (maxY+声明高)-minY+120]。

守门(guarded_polish 双不增同款,layout_check 全八判据):
  1) 拓扑冻结:除 20 节点 pos 与 3 组框 bounding 外逐字节等(节点/连线/widgets/title/order 零改);
  2) 八判据逐项不增,且 est_spacing 17→0(全量清零,含 1071/1072);
  3) 契约复刻:test_groups_three_bands_non_overlap + test_no_negative_zone_and_no_leftward
     两条断言逻辑逐条在本件上重跑(七组/罩全/两两不交/零负区/恒向右);
  4) 节奏常数:主链同行净距恒 200/纵堆同列净距恒 80(方差 0,字面直写容差 0)/纵堆 x 全等。

棘轮:apps/build/scripts/workflow_layout_baseline.json 增本件键(现值立起点,只降不升)。
用法:
  python3 apps/build/scripts/workflow_layout_fix_sancai_band_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/workflow_layout_fix_sancai_band_1118.py --verify  # 只跑守门断言
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
from layout_check import CHECK_KEYS, check_workflow  # noqa: E402
from workflow_layout import est_size  # noqa: E402

WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"
BASELINE = REPO / "apps/build/scripts/workflow_layout_baseline.json"

ROW_Y = 5900
GAP = 200          # est 同行横距(下限即常数,逐对恰 200)
CGAP = 80          # est 同列纵距(下限即常数,逐对恰 80)
# 主链列位:x0 + Σ(est 宽 + GAP);est 宽=max(250, 声明宽) 与 est_size() 对账(断言)
X0 = 7200          # > 4003 右缘 6843 → 4002→5002 连线不再斜穿 4003
ESTW = {5002: 270, 5011: 360, 5012: 400, 5013: 330, 5006: 400, 5014: 330, 5015: 330,
        5016: 360, 5017: 370, 5018: 315, 5019: 360, 5020: 250, 5021: 250, 5022: 330,
        5023: 270, 5100: 270, 4100: 283, 25: 430, 1065: 300}
ESTH = {5016: 148, 5019: 112, 5017: 118, 5018: 178}   # 纵堆行序=5020 槽序(noise/guider/sampler/sigmas)
STACK_X = X0 + (270 + 360 + 400 + 330 + 400 + 330 + 330) + 7 * GAP   # 5015 est 右缘 + GAP
POS = {
    5002: [X0, ROW_Y], 5011: [X0 + 470, ROW_Y], 5012: [X0 + 1030, ROW_Y],
    5013: [X0 + 1630, ROW_Y], 5006: [X0 + 2160, ROW_Y], 5014: [X0 + 2760, ROW_Y],
    5015: [X0 + 3290, ROW_Y],
    5016: [STACK_X, ROW_Y + 500], 5019: [STACK_X, ROW_Y + 728],
    5017: [STACK_X, ROW_Y + 920], 5018: [STACK_X, ROW_Y + 1118],
    5020: [STACK_X + 570, ROW_Y], 5021: [STACK_X + 1020, ROW_Y], 5022: [STACK_X + 1470, ROW_Y],
    5023: [STACK_X + 2000, ROW_Y], 5100: [STACK_X + 2470, ROW_Y], 4100: [STACK_X + 2940, ROW_Y],
    25: [X0 + 600, ROW_Y + 1002],        # 5011 est 箱(高 922)底+80;右缘=5012 左缘→竖向线
    1065: [STACK_X + 1940, ROW_Y + 370],  # 5100.x-530;y 让开 5022 est 箱(高 370)底
    1072: [2830, 2520],                   # 1071 est 底 2440+80(同列净距补足)
}
# 主链列位核对表(x 字面,与 est 宽+200 步进一致性由节奏断言守门):
# 5002=7200 5011=7670 5012=8230 5013=8830 5006=9360 5014=9960 5015=10490
# stack=11020 5020=11590 5021=12040 5022=12490 5023=13020 5100=13490 4100=13960
# 25=[7800,6902] 1065=[12960,6270] 1072=[2830,2520]
MOVED = set(POS)
GROUP_A_TITLE = "四采修脸组(5000 段·默认旁路·1118)"
GROUP_B_TITLE = "终档组(p-final·四采开关)"
GROUP_A_IDS = {25, 1065, 5002, 5011, 5012, 5013, 5006, 5014, 5015,
               5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023}
G100_MEMBERS = {1001, 1002, 1003, 1004, 1011, 1012, 1021, 1031, 1032, 1033, 1034, 1035,
                1041, 1042, 1051, 1061, 1062, 1071, 1072}


def die(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def group_bbox(nodes: dict, ids: set) -> list:
    """生成器先例公式(声明尺寸):[minX-60, minY-80, +60, +120](顶留标题栏)。"""
    ns = [nodes[i] for i in ids]
    x1 = min(n["pos"][0] for n in ns)
    y1 = min(n["pos"][1] for n in ns)
    x2 = max(n["pos"][0] + n["size"][0] for n in ns)
    y2 = max(n["pos"][1] + n["size"][1] for n in ns)
    return [x1 - 60, y1 - 80, x2 - x1 + 60, y2 - y1 + 120]


def apply_layout(d: dict) -> dict:
    nodes = {n["id"]: n for n in d["nodes"]}
    for nid, p in POS.items():
        nodes[nid]["pos"] = list(p)
    for g in d["groups"]:
        if g["title"] == GROUP_A_TITLE:
            g["bounding"] = group_bbox(nodes, GROUP_A_IDS)
        elif g["title"] == GROUP_B_TITLE:
            g["bounding"] = group_bbox(nodes, {5100, 4100})
        elif g["title"] == "加载模型":
            g["bounding"] = group_bbox(nodes, G100_MEMBERS)
    return d


def asserts(d_before: dict, d_after: dict, counts_before: dict, counts_after: dict) -> None:
    nb = {n["id"]: n for n in d_before["nodes"]}
    na = {n["id"]: n for n in d_after["nodes"]}
    # -- 1) 拓扑冻结:除 MOVED pos 与三组框 bounding 外逐字节等 -----------------------
    assert set(nb) == set(na), "节点集合变了"
    for nid in nb:
        b, a = copy.deepcopy(nb[nid]), copy.deepcopy(na[nid])
        if nid in MOVED:
            b.pop("pos"), a.pop("pos")
        assert b == a, f"节点 {nid} 非 pos 字段被改"
    assert d_before["links"] == d_after["links"], "连线表被改(布局-only 红线)"
    gb = {g["title"]: g for g in d_before["groups"]}
    ga = {g["title"]: g for g in d_after["groups"]}
    assert set(gb) == set(ga) and len(ga) == 7, "组框集合/数量变了"
    for t in gb:
        b, a = copy.deepcopy(gb[t]), copy.deepcopy(ga[t])
        if t in (GROUP_A_TITLE, GROUP_B_TITLE, "加载模型"):
            b.pop("bounding"), a.pop("bounding")
        assert b == a, f"组框[{t}] 非 bounding 字段被改"
    for k in set(d_before) - {"nodes", "groups"}:
        assert d_before[k] == d_after[k], f"顶层键 {k} 被改"

    # -- 2) layout_check 双不增 + est_spacing 清零 ---------------------------------
    for k in CHECK_KEYS:
        assert counts_after[k] <= counts_before[k], \
            f"双不增破门:{k} {counts_before[k]}→{counts_after[k]}"
    assert counts_after["est_spacing"] == 0, "est_spacing 未清零"
    assert all(counts_after[k] == 0 for k in
               ("est_overlap", "negative_region", "output_rightmost", "leftward", "group_overlap"))

    # -- 3) 契约复刻(test_groups_three_bands_non_overlap + test_no_negative_zone_and_no_leftward)
    for nid, n in na.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    for l in d_after["links"]:
        assert na[l[3]]["pos"][0] > na[l[1]]["pos"][0], f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"
    gs = d_after["groups"]
    assert len(gs) == 7, "七组"
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 非正尺寸"
    for nid, n in na.items():
        if n["type"] == "MarkdownNote":
            continue
        nx, ny = n["pos"]
        cov = any(g["bounding"][0] <= nx and g["bounding"][1] <= ny
                  and nx < g["bounding"][0] + g["bounding"][2]
                  and ny < g["bounding"][1] + g["bounding"][3] for g in gs)
        assert cov, f"[{nid}] 不在任何组框内"
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    # 罩全加强版:带内 20 件 + 1072 的 pos+声明尺寸整体落框
    for n in d_after["nodes"]:
        if n["id"] in GROUP_A_IDS or n["id"] in {5100, 4100, 1072}:
            x, y, w, h = n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]
            ok = any(g["bounding"][0] <= x and g["bounding"][1] <= y
                     and x + w <= g["bounding"][0] + g["bounding"][2]
                     and y + h <= g["bounding"][1] + g["bounding"][3] for g in gs)
            assert ok, f"[{n['id']}] 声明尺寸未整体落框"

    # -- 4) 节奏常数(字面直写,容差 0)----------------------------------------------
    for nid, w in ESTW.items():
        ew, _eh = est_size(na[nid])
        assert ew == w, f"est 宽表漂移:{nid} {ew}≠{w}"
    chain = [5002, 5011, 5012, 5013, 5006, 5014, 5015]
    tail = [5020, 5021, 5022, 5023, 5100, 4100]
    for a, b in zip(chain, chain[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW_Y == na[b]["pos"][1] and gap == GAP, \
            f"主链 {a}→{b} 同行净距 {gap}≠{GAP}"
    gap = STACK_X - (na[5015]["pos"][0] + ESTW[5015])
    assert gap == GAP, f"5015→纵堆列 净距 {gap}≠{GAP}"
    gap = na[5020]["pos"][0] - (STACK_X + max(ESTW[i] for i in ESTH))
    assert gap == GAP, f"纵堆→5020 净距 {gap}≠{GAP}"
    for a, b in zip(tail, tail[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW_Y == na[b]["pos"][1] and gap == GAP, \
            f"主链 {a}→{b} 同行净距 {gap}≠{GAP}"
    stack = [5016, 5019, 5017, 5018]           # 行序=5020 槽序 noise/guider/sampler/sigmas
    for nid in stack:
        assert na[nid]["pos"][0] == STACK_X, f"{nid} 纵堆 x 不全等"
    for a, b in zip(stack, stack[1:]):
        cg = na[b]["pos"][1] - (na[a]["pos"][1] + ESTH[a])
        assert cg == CGAP, f"纵堆 {a}→{b} 同列净距 {cg}≠{CGAP}"
    assert na[25]["pos"][0] + ESTW[25] == na[5012]["pos"][0], "25 右缘应与 5012 左缘齐平"
    assert na[1065]["pos"][0] < na[5100]["pos"][0], "1065 须在 5100 左侧(恒向右)"
    print("  [守门] 拓扑冻结/双不增/契约复刻/节奏常数 全部通过")


def ratchet(counts_after: dict) -> None:
    b = json.loads(BASELINE.read_text(encoding="utf-8"))
    key = str(WF.relative_to(REPO))
    want = {"main": {"crossings": counts_after["crossings"], "occlusion": counts_after["occlusion"]}}
    cur = b["files"].get(key, {}).get("scopes")
    if cur is None:
        b["files"][key] = {"scopes": want}
    else:
        for sc, v in want.items():        # 棘轮只降不升
            old = cur.get(sc) or {"crossings": 1 << 30, "occlusion": 1 << 30}
            cur[sc] = {"crossings": min(old["crossings"], v["crossings"]),
                       "occlusion": min(old["occlusion"], v["occlusion"])}
    BASELINE.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [棘轮] baseline 键已钉:{key} main crossings={want['main']['crossings']}"
          f" occlusion={want['main']['occlusion']}(只降不升)")


def main() -> int:
    verify_only = "--verify" in sys.argv
    raw = WF.read_text(encoding="utf-8")
    d_before = json.loads(raw)
    counts_before = check_workflow(d_before)[0]["counts"]
    d_after = apply_layout(copy.deepcopy(d_before))
    counts_after = check_workflow(d_after)[0]["counts"]
    print(f"[读数] 治理前 crossings={counts_before['crossings']} occlusion={counts_before['occlusion']}"
          f" est_spacing={counts_before['est_spacing']}")
    print(f"[读数] 治理后 crossings={counts_after['crossings']} occlusion={counts_after['occlusion']}"
          f" est_spacing={counts_after['est_spacing']}")
    asserts(d_before, d_after, counts_before, counts_after)

    new_raw = json.dumps(d_after, ensure_ascii=False, indent=2) + "\n"
    if new_raw == raw:
        print("[幂等] 件已在目标态,零字节改动")
    elif verify_only:
        print("[VERIFY] 目标态未落盘(--verify)")
        return 0
    else:
        WF.write_text(new_raw, encoding="utf-8")
        print(f"[落盘] {WF.relative_to(REPO)}(仅 {len(MOVED)} 节点 pos + 3 组框 bounding)")
    if not verify_only:
        ratchet(counts_after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
