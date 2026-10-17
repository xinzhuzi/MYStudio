#!/usr/bin/env python3
"""qi21-道劫-i2i ④输出收编+⑤让位+宿主标题复原(2026-10-15,用户令)。

基准=用户手工重排后覆盖的真源(md5 a35a5497;新前端序列化格式,
widget 型宿主槽剥离 inputs[]、面板值全存 widgets_values,经核零值丢失)。
三刀:
  1. [6] 宿主 title 复原(UI 保存丢 title;[7] 未丢=非前端通病,恢复稳定短名)。
  2. ④输出收编:[506]-[510] 洗底五件+[8] 保存 全入④框——④ bbox 扩为
     [8200,1620,2130,2146](罩 [5]+洗底+保存,用户现位零挪);
  3. ⑤SeedVR2 让位:④ 右缘 10330 > ⑤ 左缘 9600 必重叠 ⇒ ⑤ 整组+1400 右移
     (组框 [11000,1820];[501][502]→x11100/[503]→x11800/[504]→x12500,
     y 全不动;组框零重叠铁律的必然代价)。
契约锚随迁(测试侧另行随批):洗底五件「⑤框外」→「④框内」;[8].right<
[503].left 仍成立(10280<11800)。

fail-closed:术前 md5+拓扑锚不符零写入;术后 coherence+组零重叠+左向豁免集
(用户布局已使 229/230 右向化=恒空)+回读双终验;幂等 exit 3。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/"
               "comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")

PRE_MD5 = "a35a549786d5895467b29ab02b27e02d"
TITLE6 = "[6] 文本提示词类型优化子图"
G4_OLD, G4_NEW = [8200, 1620, 950, 680], [8200, 1620, 2130, 2146]
G5_OLD, G5_NEW = [9600, 1820, 2000, 1400], [11000, 1820, 2000, 1400]
SHIFT_X = 1400
IN_G4 = [5, 506, 507, 508, 509, 510, 8]
IN_G5 = [501, 502, 503, 504]


def fail(m, code=2):
    print(f"[out4] FAIL: {m}")
    sys.exit(code)


def md5(p: Path) -> str:
    import hashlib
    return hashlib.md5(p.read_bytes()).hexdigest()


def box(n):
    x, y = n["pos"]
    w, h = n.get("size") or [0, 0]
    return x, y, x + w, y + h


def inside(b4, n):
    x1, y1, x2, y2 = box(n)
    gx, gy, gw, gh = b4
    return gx <= x1 and x2 <= gx + gw and gy <= y1 and y2 <= gy + gh


def overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def main():
    if not WF.exists():
        fail("真源缺失")
    if md5(WF) != PRE_MD5:
        try:
            d = json.loads(WF.read_text(encoding="utf-8"))
            g5 = next(g for g in d["groups"] if g["title"].startswith("道劫·⑤"))
            if g5["bounding"] == G5_NEW:
                print("[out4] 已术后形态,幂等拦停")
                sys.exit(3)
        except Exception:
            pass
        fail(f"术前 md5 字节锚不符(期望 {PRE_MD5},得 {md5(WF)})")

    wf = json.loads(WF.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    n_nodes, n_links = len(wf["nodes"]), len(wf["links"])

    # ── 术前锚 ──
    if root[6].get("title") is not None:
        fail("[6] title 术前应已丢(UI 保存态)")
    g4 = next((g for g in wf["groups"] if g["title"].startswith("道劫·④")), None)
    g5 = next((g for g in wf["groups"] if g["title"].startswith("道劫·⑤")), None)
    if g4 is None or g4["bounding"] != G4_OLD:
        fail("④框术前锚不符")
    if g5 is None or g5["bounding"] != G5_OLD:
        fail("⑤框术前锚不符")
    for i in IN_G5:
        if abs(root[i]["pos"][0] - (9700 if i in (501, 502) else
                                    10400 if i == 503 else 11100)) > 1:
            fail(f"[{i}] 术前 x 锚不符:{root[i]['pos']}")
    # 洗底+[8] 术前应在④框外
    if any(inside(G4_OLD, root[i]) for i in [506, 507, 508, 509, 510, 8]):
        fail("洗底五件/[8] 术前应在④框外")

    # ── 备份 ──
    bak = WF.with_suffix(".json.bak-1015out")
    shutil.copy2(WF, bak)
    print(f"[out4] 备份 → {bak.name}")

    # ── 刀1:标题复原 ──
    root[6]["title"] = TITLE6

    # ── 刀2:④扩框收编(节点零挪,用户现位即终位) ──
    g4["bounding"] = G4_NEW

    # ── 刀3:⑤整组右移让位 ──
    g5["bounding"] = G5_NEW
    for i in IN_G5:
        root[i]["pos"] = [root[i]["pos"][0] + SHIFT_X, root[i]["pos"][1]]

    # ── 术后终验 ──
    if len(wf["nodes"]) != n_nodes or len(wf["links"]) != n_links:
        fail("拓扑被误伤")
    for i in IN_G4:
        if not inside(g4["bounding"], root[i]):
            fail(f"[{i}] 未入④框")
    for i in IN_G5:
        if not inside(g5["bounding"], root[i]):
            fail(f"[{i}] 未入⑤框")
    groups_all = [("主图", wf["groups"])] + [
        (s["name"][:10], s["groups"]) for s in wf["definitions"]["subgraphs"] if s.get("groups")]
    for label, gs in groups_all:
        for i in range(len(gs)):
            for j in range(i + 1, len(gs)):
                if overlap(gs[i]["bounding"], gs[j]["bounding"]):
                    fail(f"[{label}] 组框重叠:{gs[i]['title'][:10]}×{gs[j]['title'][:10]}")
    leftward = {l[0] for l in wf["links"]
                if root[l[3]]["pos"][0] <= root[l[1]]["pos"][0]}
    if leftward:
        fail(f"主图左向线非空:{sorted(leftward)}(用户布局已右向化,豁免集恒空)")
    if root[8]["pos"][0] + root[8]["size"][0] >= root[503]["pos"][0]:
        fail("[8].right 应 < [503].left")
    # coherence:回挂+悬空
    ids = [l[0] for l in wf["links"]]
    if len(ids) != len(set(ids)):
        fail("线 id 重复")
    for l in wf["links"]:
        if l[1] not in root or l[3] not in root:
            fail(f"线{l[0]} 端点失踪")
        if root[l[3]]["inputs"][l[4]].get("link") != l[0]:
            fail(f"线{l[0]} 目标槽未回挂(注意:新序列化槽序,{l})")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    rr = {n["id"]: n for n in r["nodes"]}
    if rr[6].get("title") != TITLE6 or len(r["nodes"]) != n_nodes:
        fail("回读不符")
    print(f"[out4] 完成:[6]title 复原;④框收编七件([5]+洗底五+[8],节点零挪);"
          f"⑤右移+1400 让位;组框全域零重叠;md5 {md5(WF)}")

    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF):
            fail("装机 md5 对账失败")
        print("[out4] 装机副本同步 md5 同")


if __name__ == "__main__":
    main()
