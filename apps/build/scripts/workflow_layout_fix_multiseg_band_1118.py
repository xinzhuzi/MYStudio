#!/usr/bin/env python3
"""一镜到底-分段.json 四采带布局治理(1118 美化役·坐标-only 手术脚本,幂等 fail-closed)。

方案=既定美化方案(四采横排带收成分层行带,同三采-单镜手法移植):
  R1 y1000  主链头+终档行:5002→5011→5012→5013(列步进=est 宽+200,同行净距恰 200);
            终档 5100→4100 同道右置(5023→5100 留 GAP 200=组间通道,组隙 140 同三采;
            终档留浅廊=3053→5100 长线贴 y700-1045 滑过带顶,不下钻穿带,实测 -20 交叉);
  R2 y1760  主链中+尾行(PITCH 760):5006(贴 5014 左,同列净距恰 200;1066→5006 长线
            走 y1525-1785 走廊避穿带)→5014(wrap 70 落行)→5015→5020→5021→5022→5023
            (GAP 200 链);
  R3 y2520  纵堆(PITCH 760):5016/5019/5017/5018 同列(行序=5020 输入槽序 noise/guider/
            sampler/sigmas,x 全等,同列净距恰 80);
  寄生:25 右缘齐 5012 左缘(竖向线零遮挡,y=5011 est 底+80)、1065=5100 左 530/
            y=5013 est 底+80(短线上行,躲 5023→5100 通道线)。
  两只组框(四采修脸组/终档组)按生成器先例公式自算罩全:
  [minX-60, minY-80, (maxX+声明宽)-minX+60, (maxY+声明高)-minY+120](顶留标题栏)。

⚠ 方案「带宽 ~5300 收 ~3000 档」几何不可达,如实记账:主链 14 列 x 严格单调
(恒向右契约)Σest 宽=3643 已 >3000,加 est 净距≥200/纵堆约束,任何合规矩形的带宽
下限≈5200;本役实收=组A x11240..16400(宽 5160)+组B 至 17353(总带宽 6113,原 5603,
+510=est 间距合规+终档组间通道的必然代价),换得 est_spacing 14→0、crossings 201→179、
occlusion 20→16、[1066]→[5006] 线内节点 7→2(走廊化)、[7]/[13]/[21] 总线目标左移缩短。

守门(guarded_polish 双不增同款,layout_check 全八判据):
  1) 拓扑冻结:除 19 节点 pos 与 2 组框 bounding 外逐字节等(节点/连线/widgets/title/order 零改);
  2) 八判据逐项不增,且 est_spacing 14→0,est_overlap/negative_region/output_rightmost/
     leftward/group_overlap 恒 0;
  3) 契约复刻(test_groups_five_bands + test_no_negative_no_leftward +
     test_facerefine_group_inline_bypass):八组/x 严格升序/两两不交/罩全(pos 口径+
     OWN 声明尺寸整体落框)/零负区/恒向右;
  4) 节奏常数(字面直写,容差 0):同行净距恒 200(含 5023→5100 通道步)、wrap 恒 70、
     纵堆同列净距恒 80/x 全等、PITCH 恒 760、25/1065 寄生公式位。

棘轮:apps/build/scripts/workflow_layout_baseline.json 增本件键(现值立起点,只降不升)。
用法:
  python3 apps/build/scripts/workflow_layout_fix_multiseg_band_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/workflow_layout_fix_multiseg_band_1118.py --verify  # 只跑守门断言
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

WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json"
BASELINE = REPO / "apps/build/scripts/workflow_layout_baseline.json"

R1_Y, R2_Y, R3_Y = 1000, 1760, 2520   # 行锚;R2-R1=R3-R2=PITCH 760(标准档)
PITCH = 760
GAP = 200          # est 同行横距(下限即常数,逐对恰 200)
CGAP = 80          # est 同列纵距(纵堆逐对恰 80)
WRAP = 70          # 跨行落位列步进(前行 est 右缘+70,线恒前进不回摆)
X0 = 11300         # 5002 不动(方案钉位;组⑤ 右缘 11060 外,est 距 4003 右缘 270≥200)
# est 宽表(=workflow_layout.est_size 对账,断言防漂移)
ESTW = {5002: 270, 5011: 360, 5012: 400, 5013: 330, 5006: 400, 5014: 330, 5015: 330,
        5016: 360, 5017: 370, 5018: 315, 5019: 360, 5020: 250, 5021: 250, 5022: 330,
        5023: 270, 5100: 270, 4100: 283, 25: 430, 1065: 300}
ESTH = {5011: 922, 5013: 136, 5016: 148, 5019: 112, 5017: 118, 5018: 178, 5022: 370}
STACK_X = 13860 + ESTW[5015] + WRAP                     # 5015 est 右缘+70 = 14260
POS = {
    # R1 主链头 + 终档(同道右置,浅廊)
    5002: [X0, R1_Y], 5011: [X0 + 470, R1_Y],
    5012: [X0 + 1030, R1_Y], 5013: [X0 + 1630, R1_Y],
    5100: [16130 + ESTW[5023] + GAP, R1_Y],             # 16600:5023 est 右缘+200=组间通道
    4100: [16600 + ESTW[5100] + GAP, R1_Y],             # 17070
    # R2 主链中+尾(5006 贴 5014 入列;5014 wrap 落行;tail GAP 链)
    5006: [12330 + ESTW[5012], R2_Y],                   # 12730(5012 est 右缘齐位,xov=0 免检)
    5014: [X0 + 1630 + ESTW[5013] + WRAP, R2_Y],        # 12930+330+70 = 13330
    5015: [13330 + ESTW[5014] + GAP, R2_Y],             # 13860
    5020: [STACK_X + max(ESTW[i] for i in (5016, 5017, 5018, 5019)) + WRAP, R2_Y],  # 14700
    5021: [14700 + ESTW[5020] + GAP, R2_Y],             # 15150
    5022: [15150 + ESTW[5021] + GAP, R2_Y],             # 15600
    5023: [15600 + ESTW[5022] + GAP, R2_Y],             # 16130
    # R3 纵堆(行序=5020 槽序 noise/guider/sampler/sigmas)
    5016: [STACK_X, R3_Y],
    5019: [STACK_X, R3_Y + ESTH[5016] + CGAP],          # 2748
    5017: [STACK_X, 2748 + ESTH[5019] + CGAP],          # 2940
    5018: [STACK_X, 2940 + ESTH[5017] + CGAP],          # 3138
    # 寄生
    25: [12330 - ESTW[25], R1_Y + ESTH[5011] + CGAP],   # [11900,2002] 右缘齐 5012 左缘
    1065: [16600 - 530, R1_Y + ESTH[5013] + CGAP],      # [16070,1216] 5100 左 530/y=5013 est 底+80
}
MOVED = set(POS)
GROUP_A_TITLE = "四采修脸组(5000 段·默认旁路·1118 multiseg)"
GROUP_B_TITLE = "终档组(p-final·四采开关·1118 multiseg)"
GROUP_A_IDS = {25, 1065, 5002, 5006, 5011, 5012, 5013, 5014, 5015,
               5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023}
OWN = GROUP_A_IDS | {5100, 4100}


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
    return d


def asserts(d_before: dict, d_after: dict, counts_before: dict, counts_after: dict) -> None:
    nb = {n["id"]: n for n in d_before["nodes"]}
    na = {n["id"]: n for n in d_after["nodes"]}
    # -- 1) 拓扑冻结:除 MOVED pos 与两组框 bounding 外逐字节等 -----------------------
    assert set(nb) == set(na), "节点集合变了"
    for nid in nb:
        b, a = copy.deepcopy(nb[nid]), copy.deepcopy(na[nid])
        if nid in MOVED:
            b.pop("pos"), a.pop("pos")
        assert b == a, f"节点 {nid} 非 pos 字段被改"
    assert d_before["links"] == d_after["links"], "连线表被改(布局-only 红线)"
    gb = {g["title"]: g for g in d_before["groups"]}
    ga = {g["title"]: g for g in d_after["groups"]}
    assert set(gb) == set(ga) and len(ga) == 8, "组框集合/数量变了"
    for t in gb:
        b, a = copy.deepcopy(gb[t]), copy.deepcopy(ga[t])
        if t in (GROUP_A_TITLE, GROUP_B_TITLE):
            b.pop("bounding"), a.pop("bounding")
        assert b == a, f"组框[{t}] 非 bounding 字段被改"
    for k in set(d_before) - {"nodes", "groups"}:
        assert d_before[k] == d_after[k], f"顶层键 {k} 被改"

    # -- 2) layout_check 双不增 + est_spacing 清零 -----------------------------------
    for k in CHECK_KEYS:
        assert counts_after[k] <= counts_before[k], \
            f"双不增破门:{k} {counts_before[k]}→{counts_after[k]}"
    assert counts_after["est_spacing"] == 0, "est_spacing 未清零"
    assert all(counts_after[k] == 0 for k in
               ("est_overlap", "negative_region", "output_rightmost", "leftward", "group_overlap"))

    # -- 3) 契约复刻(test_groups_five_bands + test_no_negative_no_leftward ----------
    #        + test_facerefine_group_inline_bypass 罩全锚)
    for nid, n in na.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    for l in d_after["links"]:
        assert na[l[3]]["pos"][0] > na[l[1]]["pos"][0], f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"
    gs = d_after["groups"]
    assert len(gs) == 8, "八组"
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 非正尺寸"
    xs = [g["bounding"][0] for g in gs]
    assert xs == sorted(xs), f"组框数组应 x 严格升序,现 x 序 {xs}"
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    for nid, n in na.items():
        if n["type"] == "MarkdownNote":
            continue
        nx, ny = n["pos"]
        cov = any(g["bounding"][0] <= nx and g["bounding"][1] <= ny
                  and nx < g["bounding"][0] + g["bounding"][2]
                  and ny < g["bounding"][1] + g["bounding"][3] for g in gs)
        assert cov, f"[{nid}] 不在任何组框内"
    # 罩全加强版:19 件 pos+声明尺寸整体落框(修脸组契约口径)
    for n in d_after["nodes"]:
        if n["id"] in OWN:
            x, y, w, h = n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]
            ok = any(g["bounding"][0] <= x and g["bounding"][1] <= y
                     and x + w <= g["bounding"][0] + g["bounding"][2]
                     and y + h <= g["bounding"][1] + g["bounding"][3] for g in gs)
            assert ok, f"[{n['id']}] 声明尺寸未整体落框"

    # -- 4) 节奏常数(字面直写,容差 0)----------------------------------------------
    for nid, w in ESTW.items():
        ew, _eh = est_size(na[nid])
        assert ew == w, f"est 宽表漂移:{nid} {ew}≠{w}"
    rows = {R1_Y: [5002, 5011, 5012, 5013, 5100, 4100],
            R2_Y: [5006, 5014, 5015, 5020, 5021, 5022, 5023]}
    for ry, ids in rows.items():
        for nid in ids:
            assert na[nid]["pos"][1] == ry, f"{nid} 行锚应为 y{ry}"
    for ry, chain in ((R1_Y, [5002, 5011, 5012, 5013]),
                      (R1_Y, [5100, 4100]),
                      (R2_Y, [5006, 5014, 5015]), (R2_Y, [5020, 5021, 5022, 5023])):
        for a, b in zip(chain, chain[1:]):
            gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
            assert gap == GAP, f"同行 {a}→{b} 净距 {gap}≠{GAP}"
    # 5023→5100 通道步=est 右缘+GAP 200(终档组间通道,组隙 140 同三采先例)
    assert na[5100]["pos"][0] - (na[5023]["pos"][0] + ESTW[5023]) == GAP, "5023→5100 通道步应=GAP"
    wraps = [((na[5013]["pos"][0] + ESTW[5013]), na[5014]["pos"][0], "5013→5014"),
             ((na[5015]["pos"][0] + ESTW[5015]), STACK_X, "5015→纵堆列"),
             ((STACK_X + ESTW[5017]), na[5020]["pos"][0], "纵堆(最宽件5017)→5020")]
    for base, x, label in wraps:
        assert x - base == WRAP, f"wrap {label} 步进 {x - base}≠{WRAP}"
    stack = [5016, 5019, 5017, 5018]           # 行序=5020 槽序 noise/guider/sampler/sigmas
    for nid in stack:
        assert na[nid]["pos"][0] == STACK_X, f"{nid} 纵堆 x 不全等"
    for a, b in zip(stack, stack[1:]):
        cg = na[b]["pos"][1] - (na[a]["pos"][1] + ESTH[a])
        assert cg == CGAP, f"纵堆 {a}→{b} 同列净距 {cg}≠{CGAP}"
    assert R2_Y - R1_Y == PITCH and R3_Y - R2_Y == PITCH, "行距 PITCH 760 被破"
    assert na[25]["pos"][0] + ESTW[25] == na[5012]["pos"][0], "25 右缘应与 5012 左缘齐平"
    assert na[25]["pos"][1] - (na[5011]["pos"][1] + ESTH[5011]) == CGAP, "25 y 应=5011 est 底+80"
    assert na[5100]["pos"][0] - na[1065]["pos"][0] == 530, "1065 应在 5100 左 530"
    assert na[1065]["pos"][1] == R1_Y + ESTH[5013] + CGAP, "1065 y 应=5013 est 底+80"
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
        print(f"[落盘] {WF.relative_to(REPO)}(仅 {len(MOVED)} 节点 pos + 2 组框 bounding)")
    if not verify_only:
        ratchet(counts_after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
