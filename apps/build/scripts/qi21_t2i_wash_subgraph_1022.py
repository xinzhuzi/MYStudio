#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21-道劫-t2i.json 洗底链收装子图手术(10-22 用户令「洗底链你做成子图!在
qi21-道劫-t2i.json 里面」).

背景:i2i 洗底链(1015 紫底 P1)为根图平铺五件;t2i 基准脸产线同患透明区
RGB 残留,用户令以「子图」形态收装进 t2i。手术面:
  1. 新子图定义「道劫·④b·洗底·透明除渣」(内部 7506-7510 五件,参数逐字
     迁自 i2i 1015 洗底链:阈值 0.996/SRC/[0,64,64];深拷贝保字段完备);
  2. 宿主 [7500] 常驻(mode0,恒在⑤组框外=整组旁路语义不裹挟);
  3. 尾部改线:[5] 三出线(11→[8]/206→[505]/7465→[503])原目标槽不动,
     仅改源 [5]→[7500];新线 7468 [5]:0→[7500]:0(母线串联形);
  4. 蓝图 my_nodes/subgraphs/qi21-道劫-洗底-透明除渣.json 同批落盘
     (SeedVR2 制:蓝图与宿主同 uuid;引擎侧注册进子图库);
  5. fail-closed:前置断言(横幅基底/五组框/三子图/尾部三线/计数器)任一
     红即退出零落盘;备份 apps/output/bak/t2i-wash-1022/。
"""
import copy
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_REL = "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
I2I_REL = "apps/backend/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP_REL = "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-洗底-透明除渣.json"
SVR2_BP_REL = "apps/backend/comfyui/my_nodes/subgraphs/qi21-道劫-超分-SeedVR2.json"
BAK = REPO / "apps/output/bak/t2i-wash-1022"

WASH_NAME = "道劫·④b·洗底·透明除渣"
WASH_UUID = "b7da105a-0610-4b8e-9a2c-3d4f5e6a7b81"
HOST_ID, LINK_IN = 7500, 7468
NODES = {"split": 7506, "th": 7507, "solid": 7508, "pd": 7509, "join": 7510}
L = dict(in_=7501, rgb_src=7502, rgb_dst=7503, alpha=7504, th=7505,
         solid=7506, pd_out=7507, join_a=7508, out=7509)
HOST_POS, HOST_SIZE = [5850, 1980], [270, 120]


def main() -> int:
    wf_path, i2i_path = REPO / WF_REL, REPO / I2I_REL
    wf = json.loads(wf_path.read_text(encoding="utf-8"))
    i2i = json.loads(i2i_path.read_text(encoding="utf-8"))

    # ── 前置断言(fail-closed)──
    assert wf["last_node_id"] == 7402 and wf["last_link_id"] == 7467, \
        f"计数器漂移:{wf['last_node_id']}/{wf['last_link_id']}(应 7402/7467 横幅基底)"
    assert [g["title"] for g in wf["groups"]] == [
        "道劫·①加载器", "道劫·②提示词·装配", "道劫·加速区③",
        "道劫·④输出", "道劫·⑤超分尾档·2K"], "组框面漂移(非横幅绿态基底)"
    assert [sg["name"] for sg in wf["definitions"]["subgraphs"]] == [
        "[6] 文本提示词类型优化子图", "道劫·加速子图", "道劫·超分·SeedVR2"], \
        "子图面漂移(非三子图基底)"
    sg6 = wf["definitions"]["subgraphs"][0]
    b4100 = [n for n in sg6["nodes"] if n["id"] == 4100][0]
    assert b4100["pos"] == [80, 80] and b4100["size"] == [2660, 440], \
        "横幅 [4100] 非置顶态(基底疑被覆写)"
    all_types = [n["type"] for n in wf["nodes"]] + [
        n["type"] for sg in wf["definitions"]["subgraphs"] for n in sg["nodes"]]
    assert "SplitImageWithAlpha" not in all_types, "洗底件已在场(手术已施?)"
    nodes = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}
    n5 = nodes[5]
    assert n5["outputs"][0]["links"] == [11, 206, 7465], \
        f"[5] 出线面漂移:{n5['outputs'][0]['links']}"
    for lid, tgt in ((11, 8), (206, 505), (7465, 503)):
        assert links[lid][1] == 5 and links[lid][2] == 0 and links[lid][3] == tgt, \
            f"尾部线 {lid} 非 [5]:0→[{tgt}] 基线"
    used = {n["id"] for n in wf["nodes"]} | {
        n["id"] for sg in wf["definitions"]["subgraphs"] for n in sg["nodes"]}
    assert not (used & {HOST_ID, *NODES.values()}), "7500/7506-7510 id 位已被占"

    # ── 子图定义(内部五件=深拷贝 i2i 1015 洗底件,只换 id/pos/order/title/线)──
    i2i_n = {n["id"]: n for n in i2i["nodes"]}
    SRC = {"split": 506, "th": 510, "solid": 508, "pd": 507, "join": 509}
    # 列距恒 ≥200(立宪同排间距);join 下沉让 α 直通线走 PD 盒下方净空车道
    POS = {"split": [300, 380], "th": [790, 600], "solid": [790, 180],
           "pd": [1330, 380], "join": [1880, 800]}
    TITLES = {"split": "洗底·拆Alpha", "th": "洗底·阈值门", "solid": "洗底·实心黑",
              "pd": "洗底·除渣合成", "join": "洗底·回拼"}
    IN_LINKS = {"split": [("image", L["in_"])],
                "th": [("mask", L["alpha"])],
                "solid": [],
                "pd": [("source", L["rgb_src"]), ("source_alpha", L["th"]),
                       ("destination", L["rgb_dst"]), ("destination_alpha", L["solid"])],
                "join": [("image", L["pd_out"]), ("alpha", L["join_a"])]}
    OUT_LINKS = {"split": [("IMAGE", "IMAGE", [L["rgb_src"], L["rgb_dst"]]),
                           ("MASK", "MASK", [L["alpha"], L["join_a"]])],
                 "th": [("MASK", "MASK", [L["th"]])],
                 "solid": [("MASK", "MASK", [L["solid"]])],
                 "pd": [("IMAGE", "IMAGE", [L["pd_out"]]), ("MASK", "MASK", [])],
                 "join": [("IMAGE", "IMAGE", [L["out"]])]}
    sg_nodes = []
    for order, key in enumerate(("split", "solid", "th", "pd", "join"), start=1):
        src = copy.deepcopy(i2i_n[SRC[key]])
        src.update(id=NODES[key], pos=POS[key], order=order, mode=0,
                   title=f"[{NODES[key]}] {TITLES[key]}")
        src["inputs"] = [{"name": nm, "type": "IMAGE" if key == "split" and nm == "image"
                          else ("MASK" if nm in ("mask", "alpha", "source_alpha",
                                                 "destination_alpha") else "IMAGE"),
                          "link": lk} for nm, lk in IN_LINKS[key]]
        if key == "pd":
            for i, nm in enumerate(("source", "source_alpha", "destination",
                                    "destination_alpha")):
                src["inputs"][i]["name"] = nm
        src["outputs"] = [{"name": nm, "type": tp, "links": lks}
                          for nm, tp, lks in OUT_LINKS[key]]
        sg_nodes.append(src)
    sg_def = {
        "id": WASH_UUID, "name": WASH_NAME, "category": "漫影",
        "config": {"defaultIOState": {}},
        "extra": {"ue_links": [], "links_added_by_ue": []},
        "inputNode": {"id": -10, "bounding": [80, 400, 128, 88]},
        "outputNode": {"id": -20, "bounding": [2560, 776, 128, 68]},
        "inputs": [{"id": f"{WASH_UUID[:8]}-0001-4b8e-9a2c-3d4f5e6a7b81",
                    "name": "image", "type": "IMAGE", "linkIds": [L["in_"]],
                    "pos": [104, 424]}],
        "outputs": [{"id": f"{WASH_UUID[:8]}-1001-4b8e-9a2c-3d4f5e6a7b81",
                     "name": "image", "type": "IMAGE", "linkIds": [L["out"]],
                     "pos": [2400, 800]}],
        "nodes": sg_nodes, "links": [], "groups": [], "widgets": [],
        "revision": 1, "version": 1,
        "state": {"lastGroupId": 0, "lastNodeId": NODES["join"],
                  "lastLinkId": L["out"], "lastRerouteId": 0},
    }
    sg_def["links"] = [
        {"id": L["in_"], "origin_id": -10, "origin_slot": 0,
         "target_id": NODES["split"], "target_slot": 0, "type": "IMAGE"},
        {"id": L["rgb_src"], "origin_id": NODES["split"], "origin_slot": 0,
         "target_id": NODES["pd"], "target_slot": 0, "type": "IMAGE"},
        {"id": L["rgb_dst"], "origin_id": NODES["split"], "origin_slot": 0,
         "target_id": NODES["pd"], "target_slot": 2, "type": "IMAGE"},
        {"id": L["alpha"], "origin_id": NODES["split"], "origin_slot": 1,
         "target_id": NODES["th"], "target_slot": 0, "type": "MASK"},
        {"id": L["th"], "origin_id": NODES["th"], "origin_slot": 0,
         "target_id": NODES["pd"], "target_slot": 1, "type": "MASK"},
        {"id": L["solid"], "origin_id": NODES["solid"], "origin_slot": 0,
         "target_id": NODES["pd"], "target_slot": 3, "type": "MASK"},
        {"id": L["pd_out"], "origin_id": NODES["pd"], "origin_slot": 0,
         "target_id": NODES["join"], "target_slot": 0, "type": "IMAGE"},
        {"id": L["join_a"], "origin_id": NODES["split"], "origin_slot": 1,
         "target_id": NODES["join"], "target_slot": 1, "type": "MASK"},
        {"id": L["out"], "origin_id": NODES["join"], "origin_slot": 0,
         "target_id": -20, "target_slot": 0, "type": "IMAGE"},
    ]

    # ── 宿主节点 + 尾部改线 ──
    max_order = max(n.get("order", 0) for n in wf["nodes"])
    host = {"id": HOST_ID, "type": WASH_UUID, "pos": HOST_POS, "size": HOST_SIZE,
            "flags": {}, "order": max_order + 1, "mode": 0,
            "inputs": [{"name": "image", "type": "IMAGE", "link": LINK_IN}],
            "outputs": [{"name": "image", "type": "IMAGE", "slot_index": 0,
                         "links": [11, 206, 7465]}],
            "title": "[7500] 洗底·透明除渣",
            "properties": {"subgraph": WASH_UUID, "previewExposures": [],
                           "ue_properties": {"widget_ue_connectable": {},
                                             "version": "7.8",
                                             "input_ue_unconnectable": {}}}}
    wf["nodes"].append(host)
    for lid in (11, 206, 7465):
        links[lid][1] = HOST_ID
    n5["outputs"][0]["links"] = [LINK_IN]
    wf["links"].append([LINK_IN, 5, 0, HOST_ID, 0, "IMAGE"])
    wf["definitions"]["subgraphs"].append(sg_def)
    wf["last_node_id"] = NODES["join"]  # 7510(全局计数器须盖子图内域)
    wf["last_link_id"] = max(LINK_IN, L["out"])

    # ── 后置自检(双向一致/扇出/计数器)──
    for nid, lks in ((5, [LINK_IN]), (HOST_ID, [11, 206, 7465])):
        got = sorted(l[0] for l in wf["links"] if l[1] == nid)
        assert got == sorted(lks), f"[{nid}] 出线自检红:{got}"
    host_node = next(n for n in wf["nodes"] if n["id"] == HOST_ID)
    assert host_node["outputs"][0]["links"] == [11, 206, 7465]
    for n in sg_def["nodes"]:
        for i in n["inputs"]:
            if i.get("link") is not None:
                assert any(lk["id"] == i["link"] and lk["target_id"] == n["id"] for lk in sg_def["links"])
        for o in n["outputs"]:
            for lk in o["links"]:
                assert any(x["id"] == lk and x["origin_id"] == n["id"] for x in sg_def["links"])
    assert max(n["id"] for n in wf["nodes"]) <= wf["last_node_id"]
    assert max(l[0] for l in wf["links"]) <= wf["last_link_id"]

    # ── 蓝图(SeedVR2 制:同 uuid;壳结构镜像)──
    svr2_bp = json.loads((REPO / SVR2_BP_REL).read_text(encoding="utf-8"))
    bp = copy.deepcopy(svr2_bp)
    bp["definitions"]["subgraphs"] = [copy.deepcopy(sg_def)]
    # 壳根节点=本子图宿主形(1022晚修:勿照抄源壳根节点——壳根 type/properties.
    # subgraph 必须挂本子图 uuid,槽序镜像定义;挂错=装载器报
    # "Loaded subgraph blueprint does not contain valid subgraph")
    bp["nodes"] = [{
        "id": 1, "type": WASH_UUID, "pos": [0, 0], "size": HOST_SIZE,
        "flags": {}, "order": 0, "mode": 0,
        "properties": {"subgraph": WASH_UUID, "previewExposures": []},
        "inputs": [{"name": "image", "type": "IMAGE", "link": None}],
        "outputs": [{"name": "image", "type": "IMAGE", "links": []}],
        "title": "[7500] 洗底·透明除渣"}]
    bp["info"] = {"category": "漫影", "name": WASH_NAME}
    bp["links"] = []
    bp["last_node_id"] = 1 if bp["nodes"] else 0
    bp["last_link_id"] = 0
    bp["revision"] = 1

    # ── 落盘(先备份)──
    BAK.mkdir(parents=True, exist_ok=True)
    shutil.copy2(wf_path, BAK / wf_path.name)
    wf_path.write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    bp_path = REPO / BP_REL
    assert not bp_path.exists(), "蓝图已在场(手术已施?)"
    bp_path.write_text(json.dumps(bp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"落盘: {WF_REL} (last_node_id={wf['last_node_id']} last_link_id={wf['last_link_id']})")
    print(f"落盘: {BP_REL}")
    print(f"备份: {BAK}/{wf_path.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
