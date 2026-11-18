#!/usr/bin/env python3
"""7_测试/三采-单镜-小脸修复.json 四采带布局治理(1118 美化役·第三件,坐标-only 幂等 fail-closed)。

方案=与前两件同口径(sancai_band_1118 的分层行重排,适配克隆件 18 节点带):
  主链一行 5001→5002→5011→5012→5013→5005→5006→5014→5015→[5016/5019/5017/5018 同列纵堆]→
  5020→5021→5022→5023→5024,列步进=est 宽+200(同行净距恰 200);采样四件同列 x 全等、纵距恰 80、
  行序=5020 槽序(noise/guider/sampler/sigmas→扇入零交叉);x0=7200 让开 4003 右缘。
  四采组框按先例公式自算罩全 [minX-60, minY-80, 右缘+60-minX, 底缘+120-minY]。

守门(与前两件同款):
  1) 拓扑冻结:除 18 节点 pos 与四采组框 boundingBox 外逐字节等(节点/连线/widgets/title/order 零改);
  2) layout_check 全八判据逐项不增;带内 est_spacing 清零;
  3) 契约三件套绿由外层门禁跑(pytest 双套+树审计);
  4) 幂等:复跑零字节改动。
棘轮:workflow_layout_baseline.json 增本件键(治理后现值立起点,只降不升)。
用法:
  python3 apps/build/scripts/workflow_layout_fix_clone_band_1118.py           # 施治+守门+棘轮
  python3 apps/build/scripts/workflow_layout_fix_clone_band_1118.py --verify  # 只跑守门断言
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
GROUP_TITLE = "四采·小脸修复(FaceRefine·远景脸重画)"

ROW_Y = 5900
GAP = 200
CGAP = 80
X0 = 7200
BAND = [5001, 5002, 5005, 5006, 5011, 5012, 5013, 5014, 5015,
        5016, 5017, 5018, 5019, 5020, 5021, 5022, 5023, 5024]
# est 宽(=max(250, 声明宽),与 est_size() 对账,断言守门)
ESTW = {5001: 340, 5002: 270, 5005: 640, 5006: 640, 5011: 360, 5012: 400, 5013: 330,
        5014: 330, 5015: 330, 5016: 360, 5017: 308, 5018: 370, 5019: 360,
        5020: 250, 5021: 250, 5022: 330, 5023: 270, 5024: 283}
STACK_H = {5016: 148, 5019: 112, 5017: 178, 5018: 118}  # 高度按实盘点位(5017=178/5018=118)  # 行序=5020 槽序


def build_pos() -> dict[int, list[int]]:
    x = X0
    pos: dict[int, list[int]] = {}
    for nid in (5001, 5002, 5011, 5012, 5013, 5005, 5006, 5014, 5015):
        pos[nid] = [x, ROW_Y]
        x += ESTW[nid] + GAP
    stack_x = x  # 5015 est 右缘 + GAP
    y = ROW_Y + 500
    for nid in (5016, 5019, 5017, 5018):
        pos[nid] = [stack_x, y]
        y += STACK_H[nid] + CGAP
    x = stack_x + 570
    for nid in (5020, 5021, 5022, 5023, 5024):
        pos[nid] = [x, ROW_Y]
        x += ESTW[nid] + GAP
    return pos


def check_metrics(wf: dict) -> dict:
    return check_workflow(wf)


def run() -> int:
    original_text = WF.read_text(encoding="utf-8")
    wf = json.loads(original_text)
    nodes = {n["id"]: n for n in wf["nodes"]}
    missing = [i for i in BAND if i not in nodes]
    assert not missing, f"带内节点缺失: {missing}"

    before = check_metrics(wf)

    verify_only = "--verify" in sys.argv
    pos = build_pos()
    new_wf = copy.deepcopy(wf)
    for nid in BAND:
        new_wf["nodes"][[i for i, n in enumerate(new_wf["nodes"]) if n["id"] == nid][0]]["pos"] = pos[nid]
    # est 宽对账(est_size 不低于 ESTW,防声明宽被改过)
    for nid in BAND:
        w = est_size(nodes[nid])[0]
        assert w <= ESTW[nid], f"#{nid} est 宽 {w} 超预设 {ESTW[nid]},改 ESTW 再跑"
    # 四采组框自算罩全
    band_nodes = [nodes[i] for i in BAND]
    min_x = min(pos[i][0] for i in BAND)
    min_y = min(min(pos[i][1] for i in BAND), ROW_Y) - 80
    ew, eh = {}, {}
    for n in band_nodes:
        ew[n["id"]], eh[n["id"]] = est_size(n)
    max_r = max(pos[n["id"]][0] + max(ew[n["id"]], ESTW[n["id"]]) for n in band_nodes)
    max_b = max(pos[n["id"]][1] + eh[n["id"]] for n in band_nodes)
    for g in new_wf["groups"]:
        if g.get("title") == GROUP_TITLE:
            g["boundingBox"] = {"x": min_x - 60, "y": min_y, "width": max_r + 60 - (min_x - 60),
                                "height": max_b + 120 - min_y}
    after = check_metrics(new_wf)
    # 守门 2:八判据逐项不增
    worsened = [k for k in CHECK_KEYS if after[k] > before[k]]
    assert not worsened, f"判据变差: {worsened} before={ {k: before[k] for k in worsened} } after={ {k: after[k] for k in worsened} }"

    # 守门 1:拓扑冻结(除 BAND pos 与组框 bbox 外逐字节等)
    frozen_new = copy.deepcopy(new_wf)
    frozen_old = json.loads(original_text)
    pos_key = {i: wf_pos for i, wf_pos in ((n["id"], n["pos"]) for n in frozen_old["nodes"])}
    for n in frozen_new["nodes"]:
        n["pos"] = pos_key[n["id"]]
    for gn, go in zip(frozen_new["groups"], frozen_old["groups"]):
        gn["boundingBox"] = go.get("boundingBox")
    assert json.dumps(frozen_new, ensure_ascii=False, sort_keys=True) == \
           json.dumps(frozen_old, ensure_ascii=False, sort_keys=True), "拓扑冻结失败:pos/组框外有改动"

    if verify_only:
        # 复核态:盘上件应已处于治理后(带内 pos == build_pos)
        cur = {n["id"]: n["pos"] for n in wf["nodes"] if n["id"] in BAND}
        assert all(cur[i] == pos[i] for i in BAND), "盘上位与本方案不一致,先施治再 --verify"
        print("[VERIFY-PASS] 八判据", {k: after[k] for k in CHECK_KEYS})
        return 0

    out_text = json.dumps(new_wf, ensure_ascii=False, indent=1) + "\n"
    WF.write_text(out_text, encoding="utf-8")
    # 守门 4:幂等复跑零字节改动
    wf2 = json.loads(WF.read_text(encoding="utf-8"))
    for n in wf2["nodes"]:
        if n["id"] in BAND:
            n["pos"] = pos[n["id"]]
    for g in wf2["groups"]:
        if g.get("title") == GROUP_TITLE:
            g["boundingBox"] = next(x["boundingBox"] for x in new_wf["groups"] if x.get("title") == GROUP_TITLE)
    assert json.dumps(wf2, ensure_ascii=False, indent=1) + "\n" == out_text, "幂等失败"
    # 棘轮:记治理后现值为起点
    base = json.loads(BASELINE.read_text(encoding="utf-8"))
    key = "7_测试/三采-单镜-小脸修复"
    base[key] = {k: after[k] for k in CHECK_KEYS}
    BASELINE.write_text(json.dumps(base, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print("[FIX-PASS] before→after:", {k: (before[k], after[k]) for k in CHECK_KEYS})
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
