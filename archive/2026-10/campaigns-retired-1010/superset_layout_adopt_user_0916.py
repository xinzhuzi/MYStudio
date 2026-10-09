#!/usr/bin/env python3
"""超集布局采纳(09-16 晚,一次性):把用户在画布手排并保存到引擎用户区的最新布局
抄到仓库真源,语义保持 v3.1 定档(67 激活×1.0/cfg1/两档速查卡/画风件旁路)。

用户存档:<comfy-home>/ComfyUI/user/default/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json
其语义为旧画布残留(67 旁路/cfg3/旧卡/69 开),按用户令「抄布局」只取:
  - 每节点 pos/size
  - 组框 bounding(标题沿用仓库版——用户存档的②标题是旧措辞)
门:
  G1 采纳前后,除 pos/size/groups.bounding 外逐节点等价(语义零改动)
  G2 links 逐条等价
  G3 AABB 两两零相交(用户排布实测)
  G4 v3.1 语义标记仍在(67 mode0×1.0/68-70旁路/卡两档口径/50 named==pos/cfg1)
"""
import copy
import json
import sys
from pathlib import Path
import os

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json"
USER = Path(os.path.expanduser("~/Library/Application Support/漫影工作室/comfyui/ComfyUI/user/default/")
            + "workflows/1_图片/K2图像/1_文生图/MY-K2_文生图_超集.json")

failures: list[str] = []


def check(cond, msg):
    if not cond:
        failures.append(msg)


def strip_layout(doc):
    c = copy.deepcopy(doc)
    for n in c["nodes"]:
        n.pop("pos", None); n.pop("size", None)
    for g in c.get("groups", []):
        g.pop("bounding", None)
    return json.dumps(c, ensure_ascii=False, sort_keys=True)


def main() -> int:
    d = json.loads(WF.read_text(encoding="utf-8"))
    u = json.loads(USER.read_text(encoding="utf-8"))
    un = {n["id"]: n for n in u["nodes"]}
    rn = {n["id"]: n for n in d["nodes"]}
    check(set(rn) == set(un), "节点集不一致")

    before = strip_layout(d)
    for nid, n in rn.items():
        n["pos"] = un[nid]["pos"]
        if un[nid].get("size"):
            n["size"] = un[nid]["size"]

    ug = {g["title"].split("·")[0].strip()[0]: g for g in u["groups"]}  # ①..⑤ 前缀
    for g in d["groups"]:
        key = g["title"].strip()[0]
        if key in ug:
            g["bounding"] = ug[key]["bounding"]  # 标题/配色沿用仓库版

    # ---- 门禁 ----
    check(strip_layout(d) == before, "G1 失败:pos/size/组框之外的语义被改动")
    check(d["links"] == json.loads(WF.read_text(encoding="utf-8"))["links"], "G2 失败:links 变动")
    boxes = {nid: (n["pos"][0], n["pos"][1],
                   n["pos"][0] + (n.get("size") or [340, 130])[0],
                   n["pos"][1] + (n.get("size") or [340, 130])[1]) for nid, n in rn.items()}
    for a in boxes:
        for b in boxes:
            if a < b:
                A, B = boxes[a], boxes[b]
                check(not (A[0] < B[2] and B[0] < A[2] and A[1] < B[3] and B[1] < A[3]),
                      f"G3 失败:节点{a}×{b} AABB 相交")
    card = rn[66]["widgets_values"][0]
    n67 = rn[67]
    check(n67.get("mode", 0) == 0 and n67["widgets_values"][1] == 1.0, "G4 失败:67 定档态丢失")
    check(all(rn[i].get("mode") == 4 for i in (68, 69, 70)), "G4 失败:画风件应旁路")
    check("速度档=默认" in card and card.count("一次只开一枚") == 1, "G4 失败:速查卡两档口径丢失")
    check(rn[50].get("widgets_values_named", {}).get("value") == rn[50]["widgets_values"][0],
          "G4 失败:50 named/positional 分裂复发")
    check(rn[12]["widgets_values"][3] == 1.0, "G4 失败:cfg≠1(速度档)")

    if failures:
        print("结构门未过:")
        for f in failures:
            print("  ✗", f)
        return 1

    WF.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"过门: 用户布局已采纳({len(rn)} 节点 pos/size + {len(d['groups'])} 组框 bounding),"
          "语义保持 v3.1 定档(67×1.0 激活/cfg1/两档卡/画风件旁路)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
