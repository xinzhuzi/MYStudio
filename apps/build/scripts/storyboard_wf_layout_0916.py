#!/usr/bin/env python3
"""MY-分镜工作流 画布排布优化(09-16,一次性幂等脚本)。

问题(拓扑定谳):真实管线为 1剧本→2导演→**7衍生资产**→3分镜表→4面板→5单镜→6工作台,
但 7 号环节卡挂在 2 的下方(y=860),致 7→3 连线向下绕行再向上折返(S 形逆行),
违反布局铁律「连线从左向右、从上向下,数据源在上/左」;另有间距不均(4→5 为 140,其余 100)。

手术(仅 pos 与 groups.bounding,其余零改动):
  1. 七环节按真实管线序单行排布:y=100,x=80/940/1800/2660/3560/4420/5280,等距 100。
  2. 组框重算(等宽包住各自环节,边距 L40/T80/R40/B40 与阶段一现状一致):
     阶段一=1(不变);阶段二=2+7;阶段三=3+4;阶段四=5+6,全部单行高 800。
门(不过即退出码 1 不落盘):
  G1 除 pos/groups.bounding 外逐字节等价(nodes 内容/links/extra/config/templates)
  G2 AABB 两两零相交
  G3 相邻管线环节水平间距恒 100,y 全等 100,坐标 20px 网格对齐
  G4 组框恰包住其环节(含边距)且互不相交;IP 词零命中
幂等:v2 态重跑零改动(位置/组框无条件赋值)。
"""

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/0_分镜/MY-分镜工作流.json"

# 管线序(真实 links 拓扑:1→2→7→3→4→5→6)与 x 坐标(等距 100,y=100)
FLOW_POS = {1: 80, 2: 940, 7: 1800, 3: 2660, 4: 3520, 5: 4380, 6: 5240}
Y = 100
NODE_W, NODE_H = 760, 680
# 组框: 标题前缀 → (环节 id 列表, bounding)
GROUPS_SPEC = {
    "阶段一": ((1,), [40, 20, 840, 800]),
    "阶段二": ((2, 7), [900, 20, 1700, 800]),
    "阶段三": ((3, 4), [2620, 20, 1700, 800]),
    "阶段四": ((5, 6), [4340, 20, 1700, 800]),
}
IP_WORDS = ("道劫", "daojie", "凡人")

failures: list[str] = []


def check(cond: bool, msg: str) -> None:
    if not cond:
        failures.append(msg)


def strip_layout(d: dict) -> str:
    """剔除 pos 与 groups.bounding 后的规范化串(用于 G1 等价校验)。"""
    import copy
    c = copy.deepcopy(d)
    for n in c["nodes"]:
        n.pop("pos", None)
    for g in c.get("groups", []):
        g.pop("bounding", None)
    return json.dumps(c, ensure_ascii=False, sort_keys=True)


def main() -> int:
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)
    before_sig = strip_layout(d)

    nodes = {n["id"]: n for n in d["nodes"]}
    for nid, x in FLOW_POS.items():
        nodes[nid]["pos"] = [x, Y]  # int 保持原表示,零格式噪声

    gs = {g["title"].split("·")[0].strip(): g for g in d["groups"]}
    for key, (ids, bbox) in GROUPS_SPEC.items():
        g = next((x for x in d["groups"] if key in x["title"]), None)
        if g is not None:
            g["bounding"] = bbox

    # ---- 门禁 ----
    after_sig = strip_layout(d)
    check(before_sig == after_sig, "G1 失败:pos/组框之外的任何字段被改动")
    boxes = {nid: (nodes[nid]["pos"][0], nodes[nid]["pos"][1],
                  nodes[nid]["pos"][0] + NODE_W, nodes[nid]["pos"][1] + NODE_H)
             for nid in FLOW_POS}
    for a in boxes:
        for b in boxes:
            if a < b:
                A, B = boxes[a], boxes[b]
                check(not (A[0] < B[2] and B[0] < A[2] and A[1] < B[3] and B[1] < A[3]),
                      f"G2 失败:环节{a}×{b} AABB 相交")
    order = [1, 2, 7, 3, 4, 5, 6]
    for a, b in zip(order, order[1:]):
        check(boxes[b][0] - boxes[a][2] == 100, f"G3 失败:{a}→{b} 间距≠100")
    for nid in FLOW_POS:
        check(nodes[nid]["pos"][1] == Y, f"G3 失败:环节{nid} y≠{Y}")
        check(nodes[nid]["pos"][0] % 20 == 0 and nodes[nid]["pos"][1] % 20 == 0,
              f"G3 失败:环节{nid} 未 20px 网格对齐")
    gboxes = []
    for key, (ids, bbox) in GROUPS_SPEC.items():
        bx, by, bw, bh = bbox
        gboxes.append((key, bx, by, bx + bw, by + bh))
        for nid in ids:
            A = boxes[nid]
            check(bx < A[0] and A[2] < bx + bw and by < A[1] and A[3] < by + bh,
                  f"G4 失败:组框{key} 未包住环节{nid}")
    for i, (k1, *a) in enumerate(gboxes):
        for k2, *b in gboxes[i + 1:]:
            check(not (a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]),
                  f"G4 失败:组框{k1}×{k2} 相交")
    text = json.dumps(d, ensure_ascii=False)
    for w in IP_WORDS:
        check(w not in text.lower(), f"G4 失败:IP 词「{w}」命中")

    if failures:
        print("结构门未过:")
        for f in failures:
            print("  ✗", f)
        return 1

    WF.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")  # 原文件无尾换行
    print(f"过门: 7 环节管线序单行(1→2→7→3→4→5→6,等距100,y=100) "
          f"4 组框重算(二=2+7/三=3+4/四=5+6) AABB零相交 IP零命中")
    return 0


if __name__ == "__main__":
    sys.exit(main())
