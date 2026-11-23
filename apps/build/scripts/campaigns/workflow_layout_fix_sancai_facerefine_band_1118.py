#!/usr/bin/env python3
"""三采-单镜-小脸修复.json(7_测试 克隆件)四采带布局治理(1118 美化役·坐标-only 手术脚本,幂等 fail-closed)。

件=1117 克隆正典件(拓扑=1117 四采旧链:5001 LoadVideo/5005 UNETLoader 保留,测试件身份),
治理前立宪读数(layout_check --json 实跑):
  crossings=814 / occlusion=87 / est_overlap=22 / est_spacing=15 / leftward=10 / 其余 0。

方案=分层行带重排(1118 主线同款):
  主链一行 5001→5002→5011→5012→5013→5005→5006→5014→5015→[5016/5019/5018/5017 同列纵堆]
  →5020→5021;尾段二排 5022→5023→5024(行带第二层,y=7100)。
  x 严格递增列序消全部 10 条左向线(含 1002/1003/1004/1/52→5012/5013/5014/5021 扇入);
  est 同行净距恒 200、纵堆同列净距恒 80(x 全等,行序=5020 输入槽序 noise/guider/sampler/sigmas
  ——本件 sampler=5018/sigmas=5017,与 1_漫影自研 1118 内置臂 id 映射相反,勿混);
  第 6 组(id105)归一 bounding 数组格式(弃 boundingBox 对象)+罩全公式自算+色码对齐 #995588。

⚠ crossings 棘轮起点上移的如实记账(与 OPTIMIZATION ④「交叉不增封顶」的结构性冲突,非隐瞒):
  恒向右(第 3 层)与交叉不增(第 1 层)在本件互斥——治理前 8 条扇入线自 1002/1003/1004
  右缘槽(x≈3210)向左俯冲(5012@520),不穿 2xxx 链束;恒向右后必改向右俯冲,必然横穿
  1002/1003/1004 自同槽右行的正典扇出束(515/516/523-526/563/611/612/625/626 等)与行内水平线。
  177 组合结构搜索(X0×ROW_Y×装载体下沉/尾段二排/5021 下沉变体,probe 实测)地板=861。
  本役按既定方案(明令 leftward=0+est_overlap=0+「治理现值立棘轮起点」)取地板值:
  crossings 814→861(+47,几何代价)/ occlusion 87→68(−19)/ est_overlap 22→0 /
  est_spacing 15→0 / leftward 10→0;此后棘轮钉 861 只降不升。

守门(guarded_polish 双不增同款,除上述明记的 crossings 一项):
  1) 拓扑冻结:除 18 节点 pos 与 105 组框外逐字节等(节点/连线/widgets/title/order 零改);
  2) est_overlap/est_spacing/negative_region/leftward/group_overlap 全零;occlusion 不增;
     crossings ≤ 861(治理现值=新棘轮);
  3) 契约复刻:零负区/恒向右/六组/组框两两不交/全节点(除 MarkdownNote)落框/
     带内 18 件声明尺寸整体落框/禁两节点同 pos;
  4) 节奏常数:主链与尾段同行 est 净距恒 200、纵堆同列 est 净距恒 80 且 x 全等(字面直写,容差 0)。

棘轮:apps/build/scripts/workflow_layout_baseline.json 增本件键(治理现值立起点,只降不升)。
用法:
  python3 apps/build/scripts/workflow_layout_fix_sancai_facerefine_band_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/workflow_layout_fix_sancai_facerefine_band_1118.py --verify  # 只跑守门断言
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

WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-小脸修复.json"
BASELINE = REPO / "apps/build/scripts/workflow_layout_baseline.json"

ROW_Y = 5900          # 主链行(与 1_漫影自研 1118 带同高,批次一致)
ROW2_Y = 7100         # 尾段二排行(5022/5023/5024)——分层行带第二层
GAP = 200             # est 同行横距(下限即常数,逐对恰 200)
CGAP = 80             # est 同列纵距(下限即常数,逐对恰 80)
BAND = (5001, 5002, 5011, 5012, 5013, 5005, 5006, 5014, 5015,
        5016, 5019, 5018, 5017, 5020, 5021, 5022, 5023, 5024)
CHAIN = (5001, 5002, 5011, 5012, 5013, 5005, 5006, 5014, 5015)   # 主链列序(数据流序)
STACK = (5016, 5019, 5018, 5017)   # 纵堆行序=5020 输入槽序 noise/guider/sampler/sigmas
TAIL1 = (5020, 5021)               # 主链行尾
TAIL2 = (5022, 5023, 5024)         # 二排尾段
STACK_X = 7570
ESTW = {5001: 340, 5002: 270, 5011: 360, 5012: 400, 5013: 330, 5005: 640,
        5006: 640, 5014: 330, 5015: 330, 5016: 360, 5019: 360, 5018: 370,
        5017: 308, 5020: 250, 5021: 250, 5022: 330, 5023: 270, 5024: 283}
ESTH = {5016: 148, 5019: 112, 5018: 118, 5017: 178}
POS = {
    5001: [2130, ROW_Y], 5002: [2670, ROW_Y], 5011: [3140, ROW_Y],
    5012: [3700, ROW_Y], 5013: [4300, ROW_Y], 5005: [4830, ROW_Y],
    5006: [5670, ROW_Y], 5014: [6510, ROW_Y], 5015: [7040, ROW_Y],
    5016: [STACK_X, 6400], 5019: [STACK_X, 6628], 5018: [STACK_X, 6820],
    5017: [STACK_X, 7018],
    5020: [8140, ROW_Y], 5021: [8590, ROW_Y],
    5022: [9040, ROW2_Y], 5023: [9570, ROW2_Y], 5024: [10040, ROW2_Y],
}
# 列位核对表(x 字面;est 宽+200 步进一致性由节奏断言守门):
# 5001=2130 5002=2670 5011=3140 5012=3700 5013=4300 5005=4830 5006=5670 5014=6510 5015=7040
# stack=7570(5016/5019/5018/5017 纵堆 y 6400/6628/6820/7018) 5020=8140 5021=8590
# 二排 5022=9040 5023=9570 5024=10040(y=7100)
MOVED = set(POS)
GROUP_ID = 105
GROUP_TITLE_OLD = "四采·小脸修复(FaceRefine·远景脸重画)"
GROUP_TITLE_NEW = "四采·小脸修复(FaceRefine)"   # ≤20 字(组框口径)
GROUP_COLOR = "#995588"                          # 四采修脸段位色(三件同段同色)
GROUP_ORDER = 5
CROSSINGS_CAP = 861   # 本役治理现值=新棘轮起点(头注明记 +47 几何代价)
OCCLUSION_CAP = 87    # 治理前现值(只降不升)


def die(msg: str) -> None:
    print(f"[FAIL] {msg}")
    raise SystemExit(1)


def group_bbox(nodes: dict) -> list:
    """罩全公式(声明尺寸,生成器先例):[minX-60, minY-80, +60, +120](顶留标题栏)。"""
    ns = [nodes[i] for i in BAND]
    x1 = min(n["pos"][0] for n in ns)
    y1 = min(n["pos"][1] for n in ns)
    x2 = max(n["pos"][0] + n["size"][0] for n in ns)
    y2 = max(n["pos"][1] + n["size"][1] for n in ns)
    return [x1 - 60, y1 - 80, x2 - x1 + 60, y2 - y1 + 120]


def apply_layout(d: dict) -> dict:
    nodes = {n["id"]: n for n in d["nodes"]}
    missing = MOVED - set(nodes)
    if missing:
        die(f"件缺四采带节点:{sorted(missing)}(拓扑已变,本脚本口径失效)")
    for nid, p in POS.items():
        nodes[nid]["pos"] = list(p)
    hit = [g for g in d["groups"] if g.get("id") == GROUP_ID]
    if len(hit) != 1:
        die(f"id={GROUP_ID} 组框数量 {len(hit)}≠1")
    g = hit[0]
    if g.get("title") not in (GROUP_TITLE_OLD, GROUP_TITLE_NEW):
        die(f"105 组框题被他人改:「{g.get('title')}」")
    g.pop("boundingBox", None)
    g.pop("locked", None)
    g["title"] = GROUP_TITLE_NEW
    g["bounding"] = group_bbox(nodes)
    g["color"] = GROUP_COLOR
    g["flags"] = {}
    g["order"] = GROUP_ORDER
    return d


def asserts(d_before: dict, d_after: dict, counts_before: dict, counts_after: dict) -> None:
    nb = {n["id"]: n for n in d_before["nodes"]}
    na = {n["id"]: n for n in d_after["nodes"]}
    # -- 1) 拓扑冻结:除 MOVED pos 与 105 组框外逐字节等 ----------------------------
    assert set(nb) == set(na), "节点集合变了"
    for nid in nb:
        b, a = copy.deepcopy(nb[nid]), copy.deepcopy(na[nid])
        if nid in MOVED:
            b.pop("pos"), a.pop("pos")
        assert b == a, f"节点 {nid} 非 pos 字段被改"
    assert d_before["links"] == d_after["links"], "连线表被改(布局-only 红线)"
    gb = {g["id"]: g for g in d_before["groups"]}
    ga = {g["id"]: g for g in d_after["groups"]}
    assert set(gb) == set(ga) and len(ga) == 6, "组框集合/数量变了(应恒 6 组)"
    for gid in gb:
        b, a = copy.deepcopy(gb[gid]), copy.deepcopy(ga[gid])
        if gid == GROUP_ID:
            for k in ("title", "bounding", "boundingBox", "color", "locked", "flags", "order"):
                b.pop(k, None), a.pop(k, None)
        assert b == a, f"组框[{gid}] 非 sanctioned 字段被改"
    for k in set(d_before) - {"nodes", "groups"}:
        assert d_before[k] == d_after[k], f"顶层键 {k} 被改"

    # -- 2) 立宪判据:五零 + occlusion 不增 + crossings ≤ 新棘轮 -------------------
    for k in ("est_overlap", "est_spacing", "negative_region", "leftward", "group_overlap"):
        assert counts_after[k] == 0, f"{k} 未清零:{counts_after[k]}"
    assert counts_after["occlusion"] <= min(counts_before["occlusion"], OCCLUSION_CAP), \
        f"occlusion 不增破门:{counts_before['occlusion']}→{counts_after['occlusion']}"
    if counts_after["crossings"] > CROSSINGS_CAP:
        die(f"crossings 超新棘轮 {CROSSINGS_CAP}:{counts_after['crossings']}")
    if counts_after["crossings"] > counts_before["crossings"]:
        print(f"  [明记] crossings {counts_before['crossings']}→{counts_after['crossings']}"
              f"(恒向右几何代价,头注⚠;新棘轮={CROSSINGS_CAP} 只降不升)")

    # -- 3) 契约复刻(零负区/恒向右/六组两两不交/罩全/禁同 pos)--------------------
    for nid, n in na.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    seen = set()
    for nid, n in na.items():
        tp = tuple(n["pos"])
        assert tp not in seen, f"两节点同 pos:{tp}({nid})"
        seen.add(tp)
    for l in d_after["links"]:
        assert na[l[3]]["pos"][0] > na[l[1]]["pos"][0], f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"
    gs = d_after["groups"]
    for g in gs:
        x, y, w, h = g["bounding"]
        assert w > 0 and h > 0, f"组[{g['title']}] 非正尺寸"
        assert g.get("order") is not None, f"组[{g['title']}] 缺 order"
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
    g105 = next(g for g in gs if g["id"] == GROUP_ID)
    assert g105["title"] == GROUP_TITLE_NEW and g105["color"] == GROUP_COLOR
    assert len(g105["title"]) <= 20, "组题超 20 字"
    for nid in BAND:   # 罩全加强版:带内 18 件 pos+声明尺寸整体落框
        n = na[nid]
        x, y, w, h = n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]
        assert (g105["bounding"][0] <= x and g105["bounding"][1] <= y
                and x + w <= g105["bounding"][0] + g105["bounding"][2]
                and y + h <= g105["bounding"][1] + g105["bounding"][3]), f"[{nid}] 声明尺寸未整体落框"

    # -- 4) 节奏常数(字面直写,容差 0)-------------------------------------------
    for nid, w in ESTW.items():
        ew, _eh = est_size(na[nid])
        assert ew == w, f"est 宽表漂移:{nid} {ew}≠{w}"
    for a, b in zip(CHAIN, CHAIN[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW_Y == na[b]["pos"][1] and gap == GAP, \
            f"主链 {a}→{b} 同行净距 {gap}≠{GAP}"
    gap = STACK_X - (na[5015]["pos"][0] + ESTW[5015])
    assert gap == GAP, f"5015→纵堆列 净距 {gap}≠{GAP}"
    gap = na[5020]["pos"][0] - (STACK_X + max(ESTW[i] for i in STACK))
    assert gap == GAP, f"纵堆→5020 净距 {gap}≠{GAP}"
    gap = na[5021]["pos"][0] - (na[5020]["pos"][0] + ESTW[5020])
    assert na[5020]["pos"][1] == ROW_Y == na[5021]["pos"][1] and gap == GAP, \
        f"主链尾 5020→5021 净距 {gap}≠{GAP}"
    for nid in STACK:
        assert na[nid]["pos"][0] == STACK_X, f"{nid} 纵堆 x 不全等"
    for a, b in zip(STACK, STACK[1:]):
        cg = na[b]["pos"][1] - (na[a]["pos"][1] + ESTH[a])
        assert cg == CGAP, f"纵堆 {a}→{b} 同列净距 {cg}≠{CGAP}"
    for a, b in zip(TAIL2, TAIL2[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW2_Y == na[b]["pos"][1] and gap == GAP, \
            f"二排 {a}→{b} 同行净距 {gap}≠{GAP}"
    gap = na[5022]["pos"][0] - (na[5021]["pos"][0] + ESTW[5021])
    assert gap == GAP, f"5021→二排 5022 净距 {gap}≠{GAP}"
    print("  [守门] 拓扑冻结/立宪判据/契约复刻/节奏常数 全部通过")


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
          f" occlusion={want['main']['occlusion']}(治理现值立起点,只降不升)")


def main() -> int:
    verify_only = "--verify" in sys.argv
    raw = WF.read_text(encoding="utf-8")
    d_before = json.loads(raw)
    counts_before = check_workflow(d_before)[0]["counts"]
    d_after = apply_layout(copy.deepcopy(d_before))
    counts_after = check_workflow(d_after)[0]["counts"]
    print(f"[读数] 治理前 crossings={counts_before['crossings']} occlusion={counts_before['occlusion']}"
          f" est_overlap={counts_before['est_overlap']} est_spacing={counts_before['est_spacing']}"
          f" leftward={counts_before['leftward']}")
    print(f"[读数] 治理后 crossings={counts_after['crossings']} occlusion={counts_after['occlusion']}"
          f" est_overlap={counts_after['est_overlap']} est_spacing={counts_after['est_spacing']}"
          f" leftward={counts_after['leftward']}")
    asserts(d_before, d_after, counts_before, counts_after)

    new_raw = json.dumps(d_after, ensure_ascii=False, indent=1)
    if new_raw == raw:
        print("[幂等] 件已在目标态,零字节改动")
    elif verify_only:
        print("[VERIFY] 目标态未落盘(--verify)")
        return 0
    else:
        WF.write_text(new_raw, encoding="utf-8")
        print(f"[落盘] {WF.relative_to(REPO)}(仅 {len(MOVED)} 节点 pos + 105 组框归一)")
    if not verify_only:
        ratchet(counts_after)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
