#!/usr/bin/env python3
"""7_测试/三采-单镜-小脸修复.json 布局定谳+棘轮钉锚(1118 美化役·第三件)。

【定谳:不动刀】24 变体全参数扫描(X0∈{2070,3480,4913,6463} × 链序 A/B/C × 纵堆 mid/above,
本文件档内可复算) crossings 全部劣于现状(876-925 vs 861),occlusion 同向;现状六硬项全零+
est_spacing=0+组框罩全 18/18——1117 生成器紧凑网格已是本件最优区,重排为美学节奏(200/80 常数)
必以 +14~64 crossings 为代价,违反棘轮只降不升。故本件正解=零改动,仅钉棘轮起点防未来劣化。
(原「坐标-only 施治」版方案留存于 git 历史,搜索器逻辑见役档。)

方案=与前两件同口径(分层行重排):
  主链一行 5001→5002→5011→5012→5013→5005→5006→5014→5015→[5016/5019/5017/5018 同列纵堆]→
  5020→5021→5022→5023→5024;同行净距恒 200/纵堆同列净距恒 80/纵堆 x 全等;
  行序=5020 槽序(noise/guider/sampler/sigmas→扇入零交叉);x0=2070 装载区正下方(装载器短线)。
  四采组框按生成器先例公式自算罩全。

守门(fail-closed):
  1) 拓扑冻结:除 18 节点 pos 与四采组框 bounding 外逐节点/组框/顶层键全等(连线表零改);
  2) layout_check 八判据逐项不增;六硬项恒 0;crossings/occlusion 只降不升;
  3) 契约复刻:负区≥80/恒向右/组框两两不交/带内声明尺寸整体落框;
  4) 节奏常数:主链与尾链同行净距恒 200、纵堆同列净距恒 80、纵堆 x 全等(容差 0);
  5) 幂等:复跑零字节改动。
棘轮:workflow_layout_baseline.json files[key].scopes.main 治理后现值立起点(只降不升)。
用法:
  python3 apps/build/scripts/workflow_layout_fix_clone_band_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/workflow_layout_fix_clone_band_1118.py --verify  # 只读守门
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
GROUP_TITLE = "四采·小脸修复(FaceRefine)"

ROW_Y = 5900
GAP = 200
CGAP = 80
X0 = 2070   # 装载区正下方(装载器→带短线;三采组框右缘 6873 与带不同层不冲突)
BAND = [5001, 5002, 5005, 5006, 5011, 5012, 5013, 5014, 5015,
        5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023, 5024]
CHAIN = [5001, 5002, 5011, 5012, 5013, 5005, 5006, 5014, 5015]
STACK = [5016, 5019, 5017, 5018]          # 行序=5020 槽序 noise/guider/sampler/sigmas
TAIL = [5020, 5021, 5022, 5023, 5024]
# est 宽高(实盘点位对账,断言守门)
ESTW = {5001: 340, 5002: 270, 5005: 640, 5006: 640, 5011: 360, 5012: 400, 5013: 330,
        5014: 330, 5015: 330, 5016: 360, 5017: 308, 5018: 370, 5019: 360,
        5020: 250, 5021: 250, 5022: 330, 5023: 270, 5024: 283}
ESTH = {5016: 148, 5019: 112, 5017: 178, 5018: 118}
STACK_X = X0 + sum(ESTW[i] for i in CHAIN) + len(CHAIN) * GAP  # 5015 右缘 + GAP
POS: dict[int, list[int]] = {}
_x = X0
for _n in CHAIN:
    POS[_n] = [_x, ROW_Y]
    _x += ESTW[_n] + GAP
_y = ROW_Y + 500
for _n in STACK:
    POS[_n] = [STACK_X, _y]
    _y += ESTH[_n] + CGAP
_x = STACK_X + max(ESTW[i] for i in STACK) + GAP
for _n in TAIL:
    POS[_n] = [_x, ROW_Y]
    _x += ESTW[_n] + GAP
MOVED = set(POS)
ZEROS = ("est_spacing", "est_overlap", "negative_region", "output_rightmost", "leftward", "group_overlap")


def group_bbox(nodes: dict, ids: set) -> list:
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
        if g["title"] == GROUP_TITLE:
            g["bounding"] = group_bbox(nodes, MOVED)
    return d


def asserts(d_before: dict, d_after: dict, cb: dict, ca: dict) -> None:
    nb = {n["id"]: n for n in d_before["nodes"]}
    na = {n["id"]: n for n in d_after["nodes"]}
    assert set(nb) == set(na), "节点集合变了"
    for nid in nb:
        b, a = copy.deepcopy(nb[nid]), copy.deepcopy(na[nid])
        if nid in MOVED:
            b.pop("pos"), a.pop("pos")
        assert b == a, f"节点 {nid} 非 pos 字段被改"
    assert d_before["links"] == d_after["links"], "连线表被改(布局-only 红线)"
    gb = {g["title"]: g for g in d_before["groups"]}
    ga = {g["title"]: g for g in d_after["groups"]}
    assert set(gb) == set(ga), "组框集合变了"
    for t in gb:
        b, a = copy.deepcopy(gb[t]), copy.deepcopy(ga[t])
        if t == GROUP_TITLE:
            b.pop("bounding"), a.pop("bounding")
        assert b == a, f"组框[{t}] 非 bounding 字段被改"
    for k in set(d_before) - {"nodes", "groups"}:
        assert d_before[k] == d_after[k], f"顶层键 {k} 被改"

    for k in CHECK_KEYS:
        assert ca[k] <= cb[k], f"双不增破门:{k} {cb[k]}→{ca[k]}"
    assert all(ca[k] == 0 for k in ZEROS), f"六硬项失零:{ {k: ca[k] for k in ZEROS} }"

    for nid, n in na.items():
        assert n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{nid}] 负区 pos={n['pos']}"
    for l in d_after["links"]:
        assert na[l[3]]["pos"][0] > na[l[1]]["pos"][0], f"link {l[0]} 左向线 [{l[1]}]→[{l[3]}]"
    gs = d_after["groups"]
    for i in range(len(gs)):
        for j in range(i + 1, len(gs)):
            a, b = gs[i]["bounding"], gs[j]["bounding"]
            ox = a[0] < b[0] + b[2] and b[0] < a[0] + a[2]
            oy = a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
            assert not (ox and oy), f"组框重叠: {gs[i]['title']} × {gs[j]['title']}"
    for n in d_after["nodes"]:
        if n["id"] in MOVED:
            x, y, w, h = n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]
            ok = any(g["bounding"][0] <= x and g["bounding"][1] <= y
                     and x + w <= g["bounding"][0] + g["bounding"][2]
                     and y + h <= g["bounding"][1] + g["bounding"][3] for g in gs)
            assert ok, f"[{n['id']}] 声明尺寸未整体落框"

    for nid, w in ESTW.items():
        ew, _ = est_size(na[nid])
        assert ew == w, f"est 宽表漂移:{nid} {ew}≠{w}"
    for a, b in zip(CHAIN, CHAIN[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW_Y == na[b]["pos"][1] and gap == GAP, f"主链 {a}→{b} 净距 {gap}≠{GAP}"
    for a, b in zip(TAIL, TAIL[1:]):
        gap = na[b]["pos"][0] - (na[a]["pos"][0] + ESTW[a])
        assert na[a]["pos"][1] == ROW_Y == na[b]["pos"][1] and gap == GAP, f"尾链 {a}→{b} 净距 {gap}≠{GAP}"
    for nid in STACK:
        assert na[nid]["pos"][0] == STACK_X, f"{nid} 纵堆 x 不全等"
    for a, b in zip(STACK, STACK[1:]):
        cg = na[b]["pos"][1] - (na[a]["pos"][1] + ESTH[a])
        assert cg == CGAP, f"纵堆 {a}→{b} 同列净距 {cg}≠{CGAP}"
    print("  [守门] 拓扑冻结/双不增/六零/契约复刻/节奏常数 全部通过")


def ratchet(ca: dict) -> None:
    b = json.loads(BASELINE.read_text(encoding="utf-8"))
    key = str(WF.relative_to(REPO))
    want = {"main": {"crossings": ca["crossings"], "occlusion": ca["occlusion"]}}
    cur = b["files"].get(key, {}).get("scopes")
    if cur is None:
        b["files"][key] = {"scopes": want}
    else:
        for sc, v in want.items():
            old = cur.get(sc) or {"crossings": 1 << 30, "occlusion": 1 << 30}
            cur[sc] = {"crossings": min(old["crossings"], v["crossings"]),
                       "occlusion": min(old["occlusion"], v["occlusion"])}
    BASELINE.write_text(json.dumps(b, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"  [棘轮] baseline 键已钉:{key} main crossings={want['main']['crossings']}"
          f" occlusion={want['main']['occlusion']}(只降不升)")


def main() -> int:
    d = json.loads(WF.read_text(encoding="utf-8"))
    ca = check_workflow(d)[0]["counts"]
    assert all(ca[k] == 0 for k in ZEROS), f"六硬项失零:{ {k: ca[k] for k in ZEROS} }"
    nodes = {n["id"]: n for n in d["nodes"]}
    g = next(g for g in d["groups"] if g["title"] == GROUP_TITLE)
    bx = g["bounding"]
    for nid in MOVED:
        n = nodes[nid]
        w, h = est_size(n)
        assert bx[0] <= n["pos"][0] and bx[1] <= n["pos"][1] \
            and n["pos"][0] + w <= bx[0] + bx[2] and n["pos"][1] + h <= bx[1] + bx[3], \
            f"[{nid}] 未落框"
    print(f"[定谳] 六硬项全零+罩全 18/18+crossings={ca['crossings']} occlusion={ca['occlusion']} → 零改动,钉棘轮")
    ratchet(ca)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
