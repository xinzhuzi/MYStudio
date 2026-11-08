#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-i2i.json 洗底链收装子图手术(10-22 用户令「④b 没有不像文生图做成子图呢」).

对齐 t2i 1022 收装役(qi21_t2i_wash_subgraph_1022.py 先例,SeedVR2 制跨画布
恒等契约):i2i 根图平铺洗底五件 [506]-[510] 拆除,嵌同 uuid 恒等定义
(自 t2i 画布逐字深拷贝,蓝图文件共用免双刷),宿主 [7500] 常开 mode0。

手术面:
  1. 内链七条(220-225,228)删除;外线保号改接:219 [5]:0→[7500]:0(改靶),
     226/7465 origin 509→7500(改源,目标 [8]/[503] 原槽不动)——零新线号;
  2. ④b 组框(id7)重收为宿主贴身框 [8293.6,660,322,200];
  3. 计数器 last_node_id 7403→7510(盖子图内域)/last_link_id 7469→7509;
  4. fail-closed:前置断言(计数器/七组框/三子图/平铺五件与十条线两端/
     id 空位)任一红即退出零落盘;备份 apps/output/bak/i2i-wash-1022/。
"""
import copy
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_REL = "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
T2I_REL = "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BAK = REPO / "apps/output/bak/i2i-wash-1022"

WASH_NAME = "道劫·④b·洗底·透明除渣"
HOST_ID = 7500
FLAT = {"split": 506, "pd": 507, "solid": 508, "join": 509, "th": 510}
FLAT_TYPES = {"split": "SplitImageWithAlpha", "pd": "PorterDuffImageComposite",
              "solid": "SolidMask", "join": "JoinImageWithAlpha", "th": "ThresholdMask"}
INTERNAL_LINKS = [220, 221, 222, 223, 224, 225, 228]
HOST_POS, HOST_SIZE = [8320, 700], [270, 120]
G7_BOX = [8293.6, 660.0, 322.0, 200.0]


def main() -> int:
    wf_path, t2i_path = REPO / WF_REL, REPO / T2I_REL
    wf = json.loads(wf_path.read_text(encoding="utf-8"))
    t2i = json.loads(t2i_path.read_text(encoding="utf-8"))

    # ── 前置断言(fail-closed)──
    assert wf["last_node_id"] == 7403 and wf["last_link_id"] == 7469, \
        f"计数器漂移:{wf['last_node_id']}/{wf['last_link_id']}(应 7403/7469)"
    assert [g["title"] for g in wf["groups"]] == [
        "道劫·①加载器", "道劫·②图像·装配主链", "道劫·②指令外露带", "道劫·加速区③",
        "道劫·④输出", "道劫·⑤超分尾档·2K", "道劫·④b·洗底·透明除渣"], "组框面漂移"
    assert [sg["name"] for sg in wf["definitions"]["subgraphs"]] == [
        "[6] 文本提示词类型优化子图", "道劫·加速子图", "道劫·超分·SeedVR2"], \
        "子图面漂移(应三子图基底)"
    assert not any("洗底" in sg["name"] for sg in wf["definitions"]["subgraphs"]), \
        "洗底子图已在场(手术已施?)"
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}
    for key, nid in FLAT.items():
        assert nodes[nid]["type"] == FLAT_TYPES[key], f"[{nid}] 型漂移"
    want_links = {
        219: (5, 0, 506, 0, "IMAGE"), 220: (506, 0, 507, 0, "IMAGE"),
        221: (506, 0, 507, 2, "IMAGE"), 228: (506, 1, 510, 0, "MASK"),
        222: (510, 0, 507, 1, "MASK"), 223: (508, 0, 507, 3, "MASK"),
        224: (507, 0, 509, 0, "IMAGE"), 225: (506, 1, 509, 1, "MASK"),
        226: (509, 0, 8, 0, "IMAGE"), 7465: (509, 0, 503, 0, "IMAGE")}
    for lid, ends in want_links.items():
        got = tuple(links[lid][1:6])
        assert got == ends, f"线 {lid} 漂移:{got}(应 {ends})"
    assert nodes[5]["outputs"][0]["links"] == [219], "[5] 出线面漂移"
    used = {n["id"] for n in wf["nodes"]} | {
        n["id"] for sg in wf["definitions"]["subgraphs"] for n in sg["nodes"]}
    assert not (used & {HOST_ID}), "7500 id 位已被占"

    # ── 子图定义:自 t2i 逐字深拷贝(SeedVR2 制跨画布恒等)──
    sg_def = copy.deepcopy(next(s for s in t2i["definitions"]["subgraphs"]
                                if s["name"] == WASH_NAME))

    # ── 拆平铺五件+删内链 ──
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in FLAT.values()]
    wf["links"] = [l for l in wf["links"] if l[0] not in INTERNAL_LINKS]

    # ── 外线改接(保号改端)──
    links = {l[0]: l for l in wf["links"]}
    links[219][3] = HOST_ID  # [5]:0 → [7500]:0(改靶)
    links[226][1] = HOST_ID  # [7500]:0 → [8](改源)
    links[7465][1] = HOST_ID  # [7500]:0 → [503](改源)

    # ── 宿主节点 ──
    max_order = max(n.get("order", 0) for n in wf["nodes"])
    host = {"id": HOST_ID, "type": sg_def["id"], "pos": HOST_POS, "size": HOST_SIZE,
            "flags": {}, "order": max_order + 1, "mode": 0,
            "inputs": [{"name": "image", "type": "IMAGE", "link": 219}],
            "outputs": [{"name": "image", "type": "IMAGE", "slot_index": 0,
                         "links": [226, 7465]}],
            "title": "[7500] 洗底·透明除渣",
            "properties": {"subgraph": sg_def["id"], "previewExposures": [],
                           "ue_properties": {"widget_ue_connectable": {},
                                             "version": "7.8",
                                             "input_ue_unconnectable": {}}}}
    wf["nodes"].append(host)
    wf["definitions"]["subgraphs"].append(sg_def)

    # ── ④b 组框重收 ──
    g7 = next(g for g in wf["groups"] if g.get("id") == 7)
    g7["bounding"] = G7_BOX

    # ── 计数器(盖子图内域 7510/7509)──
    wf["last_node_id"] = 7510
    wf["last_link_id"] = 7509

    # ── 后置自检 ──
    got = sorted(l[0] for l in wf["links"] if l[1] == 5)
    assert got == [219], f"[5] 出线自检红:{got}"
    got = sorted(l[0] for l in wf["links"] if l[1] == HOST_ID)
    assert got == [226, 7465], f"[7500] 出线自检红:{got}"
    for l in wf["links"]:
        assert l[1] not in FLAT.values() and l[3] not in FLAT.values(), f"残线触平铺件:{l}"
    all_types = [n["type"] for n in wf["nodes"]]
    for t in FLAT_TYPES.values():
        assert t not in all_types, f"{t} 残留主图"
    boxes = [g["bounding"] for g in wf["groups"]]
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            x0, y0, w0, h0 = boxes[i]; x1, y1, w1, h1 = boxes[j]
            assert x0 + w0 <= x1 or x1 + w1 <= x0 or y0 + h0 <= y1 or y1 + h1 <= y0, \
                f"组框重叠复发:{wf['groups'][i]['title']}/{wf['groups'][j]['title']}"
    hx, hy = host["pos"]; hw, hh = host["size"]
    assert (G7_BOX[0] <= hx and hx + hw <= G7_BOX[0] + G7_BOX[2]
            and G7_BOX[1] <= hy and hy + hh <= G7_BOX[1] + G7_BOX[3]), "宿主不在④b框内"
    g6 = next(g for g in wf["groups"] if g.get("id") == 6)["bounding"]
    assert not (g6[0] <= hx and hx + hw <= g6[0] + g6[2]
                and g6[1] <= hy and hy + hh <= g6[1] + g6[3]), "宿主误入⑤框(旁路语义)"
    assert max(n["id"] for n in wf["nodes"]) <= wf["last_node_id"]
    assert max(l[0] for l in wf["links"]) <= wf["last_link_id"]
    assert any(s["name"] == WASH_NAME for s in wf["definitions"]["subgraphs"])

    # ── 落盘(先备份)──
    BAK.mkdir(parents=True, exist_ok=True)
    shutil.copy2(wf_path, BAK / wf_path.name)
    wf_path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"落盘: {WF_REL} (last_node_id={wf['last_node_id']} last_link_id={wf['last_link_id']})")
    print(f"备份: {BAK}/{wf_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
