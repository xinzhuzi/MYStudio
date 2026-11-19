#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""三采-单镜-修脸.json 幂等生成器(fusion 1118)。

依据方案: apps/output/h3-face-refine-survey-1118/fusion/fusion-plan.md
  - §1 新节点 10 个(id 5101-5110)/ 新链 17 条(876-892)
  - §2 断链 859/860/871 + 既有 7 节点 link 引用更新(白名单)
  - §3 保留面(正典 87 节点除白名单 link 字段外逐位一致)
  - §4 契约断言 A-H 全项内建(含评审修法:断言 E 对 5107 的作者件
    widgets_values 读取须归一——作者件 242 无该键,归一为 [])
  - §9 生成器规格:幂等(重复 --apply 产物字节一致)、fail-closed、
    只读 canon+author 两份 JSON、不得改动正典件与作者件

用法:
  python3 apps/build/scripts/campaigns/h3_face_refine_fusion_1118.py --check   # 干跑只验不写
  python3 apps/build/scripts/campaigns/h3_face_refine_fusion_1118.py --apply   # 写后即验

任一断言失败 → 打印失败项 + exit 1。门禁过不了修生成器,禁改规格迁就。

**1119b 退役(PRD 11-19-dualmode-facerefine-rename §四/grill C4)**:双档段已并入正典
单镜.json(远景/高清双档,出口复制案),本生成器入口短路 exit 0 不再施工——融合件
7_测试/三采-单镜-修脸.json 留档归档不随役维护;双档段唯一真源=正典件+
sancai_inline_facerefine_build_1118.py(重放走它)。AUTHOR 产物在 apps/output 可清。
"""

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
CANON = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"  # 1119 改名自 三采-单镜(本件已退役,仅存档)
AUTHOR = REPO / "apps/output/h3-face-refine-survey-1118/author_workflow.json"
OUT = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/7_测试/三采-单镜-修脸.json"

# ---------------------------------------------------------------------------
# 规格常量(全部硬编码自 fusion-plan.md §1/§2/§3;禁手调,改规格先改方案)
# ---------------------------------------------------------------------------

NEW_NODE_IDS = [5101, 5102, 5103, 5104, 5105, 5106, 5107, 5109, 5110]  # 1119b: 5108 差分已移除(低dn体制反噬,cmp_1120 实证)
NEW_NODE_SET = set(NEW_NODE_IDS)

# 新节点 → 作者件参数真源节点(fusion-plan §4)
AUTHOR_MAP = {
    5101: 233, 5102: 234, 5103: 235, 5104: 236, 5105: 240,
    5106: 241, 5107: 242, 5109: 188, 5110: 187,
}

CUT_LINK_IDS = {859, 871}

# 17 条新链元组 [link_id, src_id, src_slot, dst_id, dst_slot, type](§1.x)
NEW_LINK_TUPLES = [
    (876, 5101, 0, 5103, 1, "MODEL"),
    (877, 5101, 1, 5102, 0, "CLIP"),
    (878, 5102, 0, 5103, 3, "CONDITIONING"),
    (879, 5011, 0, 5103, 0, "IMAGE"),
    (880, 5103, 0, 5104, 0, "SAM3_TRACK_DATA"),
    (881, 5104, 0, 5105, 0, "MASK"),
    (882, 5104, 0, 5022, 3, "MASK"),
    (883, 5105, 0, 5106, 0, "MASK"),
    (884, 1003, 0, 5106, 1, "VAE"),
    (885, 5106, 0, 5107, 1, "MASK"),
    (886, 5013, 0, 5107, 0, "LATENT"),
    (887, 5107, 0, 5014, 1, "LATENT"),
    (890, 5109, 0, 5110, 0, "VOSR2_MODEL"),
    (891, 5021, 0, 5110, 1, "IMAGE"),
    (892, 5110, 0, 5022, 1, "IMAGE"),
]
NEW_LINK_IDS = {t[0] for t in NEW_LINK_TUPLES}

# 新节点规格:pos/size/order/title(§1 表;order 10024-10033 顺 id 序)
NODE_SPECS = {
    5101: {"type": "CheckpointLoaderSimple", "pos": [7200, 7340], "size": [400, 100], "order": 10024,
           "title": "融合·SAM3 检查点"},
    5102: {"type": "CLIPTextEncode", "pos": [7200, 7480], "size": [400, 170], "order": 10025,
           "title": "融合·SAM3 文本提示"},
    5103: {"type": "SAM3_VideoTrack", "pos": [7660, 7340], "size": [400, 266], "order": 10026,
           "title": "融合·SAM3 视频追踪"},
    5104: {"type": "SAM3_TrackToMask", "pos": [7660, 7646], "size": [320, 80], "order": 10027,
           "title": "融合·SAM3 轨迹转遮罩"},
    5105: {"type": "MVEx_MaskCleanup", "pos": [8100, 7340], "size": [340, 200], "order": 10028,
           "title": "融合·MVEx 遮罩清洗"},
    5106: {"type": "MVEx_MaskToLatentSpace", "pos": [8100, 7580], "size": [360, 220], "order": 10029,
           "title": "融合·MVEx 遮罩入潜空间"},
    5107: {"type": "SetLatentNoiseMask", "pos": [8500, 7340], "size": [270, 80], "order": 10030,
           "title": "融合·潜空间噪声遮罩(5013→5014 之间)"},
    5109: {"type": "VOSR2ModelLoader", "pos": [9140, 7340], "size": [320, 82], "order": 10032,
           "title": "融合·VOSR2 加载器"},
    5110: {"type": "VOSR2Upscale", "pos": [9140, 7462], "size": [360, 250], "order": 10033,
           "title": "融合·VOSR2 满血补频(5021→5022 之间)"},
}

# 新节点入口重接线:input name → 新链 id(§1 各节点 inputs 行;
# 作者件原有 link 的口必须恰好被本表覆盖,其余口保持不接)
NODE_IN_LINKS = {
    5101: {},
    5102: {"clip": 877},
    5103: {"images": 879, "model": 876, "conditioning": 878},
    5104: {"track_data": 880},
    5105: {"masks": 881},
    5106: {"masks": 883, "vae": 884},
    5107: {"samples": 886, "mask": 885},
    5109: {},
    5110: {"model": 890, "image": 891},
}

# 新节点出口重接线:output name → 新链 id 列表(§1 各节点 outputs 行)
NODE_OUT_LINKS = {
    5101: {"MODEL": [876], "CLIP": [877], "VAE": []},
    5102: {"CONDITIONING": [878]},
    5103: {"track_data": [880]},
    5104: {"masks": [881, 882]},
    5105: {"masks": [883]},
    5106: {"mask": [885]},
    5107: {"LATENT": [887]},
    5109: {"model": [890]},
    5110: {"IMAGE": [892]},
}

# §4 E 的 W 表(新节点 widgets_values 期望值;与作者件抽取双锁)
EXPECTED_WIDGETS = {
    5101: ["sam3.1_multiplex_fp16.safetensors"],
    5102: ["face"],
    5103: [0.5, 1, 1],
    5104: ["0"],
    5105: [0.3, "shrink_grow", 12, 4, 16],
    5106: ["auto", "max", "max", 36, 1, "both"],
    5107: [],
    5109: ["VOSR2", "default"],
    5110: [1, 300831622214023, "fixed", "wavelet", 512, 32, 1024, 32],
}

# 5110 VOSR2Upscale 唯一参数偏离:control "randomize"→"fixed"(任务约束 B③)
DEVIATION_5110_INDEX = 2
DEVIATION_5110_FROM = "randomize"
DEVIATION_5110_TO = "fixed"

# 既有节点 link 引用更新(§2.2;前置校验原值,防正典漂移)
# (node_id, path, 原值, 新值)  path 为 ('outputs', 0, 'links') 等
NODE_LINK_PATCHES = [
    (5011, ("outputs", 0, "links"), [844], [844, 879]),
    (5013, ("outputs", 0, "links"), [859], [886]),
    (5014, ("inputs", 1, "link"), 859, 887),
    (5021, ("outputs", 0, "links"), [871], [891]),
    (5022, ("inputs", 1, "link"), 871, 892),
]
LINK_DELTA_WHITELIST = {5011, 5013, 5014, 5021, 5022, 1003}

# 5022.masks 原为悬空 shape 7(无 link 键)→ 加挂 882(§2.2 末行)
MASKS_PORT_PATCH = (5022, ("inputs", 3), 882)

# 1003 VAELoader 出口追加 884(§2.2)
VAE_OUT_ORIGINAL = [515, 525, 563, 611, 625, 850, 851, 852]
VAE_OUT_NEW = VAE_OUT_ORIGINAL + [884]

# G107 新组(§3.3)
G107 = {
    "id": 107,
    "title": "四采·融合段(SAM3遮罩+VOSR2·1119b)",
    "bounding": [7140, 7260, 2420, 600],
    "color": "#7766aa",
    "flags": {},
    "order": 7,
}

LAST_LINK_ID_NEW = 892
LAST_NODE_ID_EXPECT = 9999

SWITCH_LINK_IDS = (873, 874, 837, 875)  # §4 F 5100 出口/入口链


# ---------------------------------------------------------------------------
# 工具
# ---------------------------------------------------------------------------

def md5_file(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()


def serialize(doc) -> bytes:
    """确定性序列化:与正典件风格逐位一致(indent=1, ensure_ascii=False, 尾行换行)。"""
    return (json.dumps(doc, indent=1, ensure_ascii=False) + "\n").encode("utf-8")


def author_widgets(author_node) -> list:
    """评审修法:作者件节点无 widget 节点不写该键 → 归一为 []。"""
    aw = author_node.get("widgets_values")
    return aw if isinstance(aw, list) else []


class Fail(Exception):
    pass


class Checker:
    def __init__(self):
        self.passed = []
        self.failed = []

    def ok(self, name):
        self.passed.append(name)

    def expect(self, cond, name, detail=""):
        if cond:
            self.passed.append(name)
        else:
            self.failed.append((name, detail))


# ---------------------------------------------------------------------------
# 构建(纯函数:canon + author → fused)
# ---------------------------------------------------------------------------

def get_patch_target(node, path):
    obj = node
    for key in path[:-1]:
        obj = obj[key]
    return obj, path[-1]


def build_fused(canon: dict, author: dict, ck: Checker) -> dict:
    fused = copy.deepcopy(canon)
    nodes_by_id = {n["id"]: n for n in fused["nodes"]}

    # --- 前置:正典规模与形态(防底座漂移) ---
    ck.expect(len(canon["nodes"]) == 87, "pre.canon-nodes-87", str(len(canon["nodes"])))
    ck.expect(len(canon["links"]) == 143, "pre.canon-links-143", str(len(canon["links"])))
    ck.expect(len(canon["groups"]) == 7, "pre.canon-groups-7", str(len(canon["groups"])))
    ck.expect(canon["last_node_id"] == LAST_NODE_ID_EXPECT, "pre.canon-last-node-id",
              str(canon["last_node_id"]))
    ck.expect(canon["last_link_id"] == 875, "pre.canon-last-link-id", str(canon["last_link_id"]))
    canon_link_ids = {l[0] for l in canon["links"]}
    ck.expect(CUT_LINK_IDS <= canon_link_ids, "pre.cut-links-exist",
              str(sorted(CUT_LINK_IDS - canon_link_ids)))
    ck.expect(not (NEW_NODE_SET & set(nodes_by_id)), "pre.new-node-ids-free", "")
    ck.expect(not (NEW_LINK_IDS & canon_link_ids), "pre.new-link-ids-free", "")
    canon_orders = [n["order"] for n in canon["nodes"]]
    ck.expect(max(canon_orders) < 10024, "pre.order-space-free", str(max(canon_orders)))
    if ck.failed:
        raise Fail("正典前置断言未过 %d 项,底座已漂移,拒绝施工" % len(ck.failed))

    # --- 1) 链:断 3 + 新 17 + last_link_id ---
    fused["links"] = [l for l in fused["links"] if l[0] not in CUT_LINK_IDS] + \
                     [list(t) for t in NEW_LINK_TUPLES]
    fused["last_link_id"] = LAST_LINK_ID_NEW

    # --- 2) 既有 7 节点 link 引用更新(逐 patch 前置校验原值) ---
    for nid, path, original, new in NODE_LINK_PATCHES:
        obj, key = get_patch_target(nodes_by_id[nid], path)
        if obj[key] != original:
            raise Fail("前置不符: node %s %s 原值 %r != 方案期望 %r" % (nid, ".".join(map(str, path)), obj[key], original))
        obj[key] = copy.deepcopy(new)
    # 5022.masks 悬空口加挂 882(shape 7 保留)
    m_port = nodes_by_id[MASKS_PORT_PATCH[0]]["inputs"][MASKS_PORT_PATCH[1][1]]
    if "link" in m_port or m_port.get("shape") != 7:
        raise Fail("前置不符: 5022.inputs[3] 应为无 link 的 shape 7 悬空口, 实为 %r" % (m_port,))
    m_port["link"] = MASKS_PORT_PATCH[2]
    # 1003 出口追加 884
    v_out = nodes_by_id[1003]["outputs"][0]
    if v_out.get("links") != VAE_OUT_ORIGINAL:
        raise Fail("前置不符: 1003.outputs[0].links %r != %r" % (v_out.get("links"), VAE_OUT_ORIGINAL))
    v_out["links"] = list(VAE_OUT_NEW)

    # --- 3) 新节点 10 个(参数嫁接作者件,拓扑按 §1 重接) ---
    author_by_id = {n["id"]: n for n in author["nodes"]}
    for nid in NEW_NODE_IDS:
        spec = NODE_SPECS[nid]
        src = author_by_id.get(AUTHOR_MAP[nid])
        if src is None:
            raise Fail("作者件缺节点 %d (AUTHOR_MAP[%d])" % (AUTHOR_MAP[nid], nid))
        if src.get("type") != spec["type"]:
            raise Fail("作者件 %d 类型 %r != 方案 %r" % (AUTHOR_MAP[nid], src.get("type"), spec["type"]))

        inputs = copy.deepcopy(src.get("inputs") or [])
        out_map = NODE_OUT_LINKS[nid]
        in_map = NODE_IN_LINKS[nid]
        # 入口:作者件已接 link 的口必须恰被 in_map 覆盖
        src_linked = {p["name"] for p in inputs if p.get("link") is not None}
        if src_linked != set(in_map):
            raise Fail("node %d 入口覆盖不符: 作者已接 %r vs 方案 %r" % (nid, sorted(src_linked), sorted(in_map)))
        for p in inputs:
            if p["name"] in in_map:
                p["link"] = in_map[p["name"]]
        outputs = copy.deepcopy(src.get("outputs") or [])
        if {p["name"] for p in outputs} != set(out_map):
            raise Fail("node %d 出口覆盖不符: 作者 %r vs 方案 %r"
                       % (nid, sorted(p["name"] for p in outputs), sorted(out_map)))
        for p in outputs:
            p["links"] = list(out_map[p["name"]])

        wv = list(author_widgets(src))
        if nid == 5110:
            if wv[DEVIATION_5110_INDEX] != DEVIATION_5110_FROM:
                raise Fail("5110 作者件 control 位 %r != %r" % (wv[DEVIATION_5110_INDEX], DEVIATION_5110_FROM))
            wv[DEVIATION_5110_INDEX] = DEVIATION_5110_TO

        node = {
            "id": nid,
            "type": spec["type"],
            "pos": list(spec["pos"]),
            "size": list(spec["size"]),
            "flags": {},
            "order": spec["order"],
            "mode": 0,
            "inputs": inputs,
            "outputs": outputs,
            "properties": {"Node name for S&R": spec["type"]},
            "widgets_values": wv,
            "title": spec["title"],
        }
        fused["nodes"].append(node)
        nodes_by_id[nid] = node

    # --- 4) G107 组 ---
    fused["groups"].append(copy.deepcopy(G107))

    return fused


# ---------------------------------------------------------------------------
# 契约断言(§4 A-H 全项 + 序列化/幂等/元数据;对"落盘产物"验)
# ---------------------------------------------------------------------------

def strip_link_fields(obj):
    """inputs 去 link 键 / outputs 去 links 键的深拷贝(白名单节点结构对比用)。"""
    obj = copy.deepcopy(obj)
    if isinstance(obj, dict):
        for port in obj.get("inputs") or []:
            port.pop("link", None)
        for port in obj.get("outputs") or []:
            port.pop("links", None)
    return obj


def verify(canon: dict, author: dict, fused: dict, ck: Checker) -> None:
    c_nodes = {n["id"]: n for n in canon["nodes"]}
    f_nodes = {n["id"]: n for n in fused["nodes"]}
    a_nodes = {n["id"]: n for n in author["nodes"]}
    c_links = {l[0]: tuple(l) for l in canon["links"]}
    f_links = {l[0]: tuple(l) for l in fused["links"]}

    # --- A. 规模 ---
    ck.expect(len(fused["nodes"]) == 96 == len(canon["nodes"]) + len(NEW_NODE_IDS),
              "A.nodes-97", str(len(fused["nodes"])))
    ck.expect(len(fused["links"]) == 156 == len(canon["links"]) - len(CUT_LINK_IDS) + len(NEW_LINK_TUPLES),
              "A.links-156", str(len(fused["links"])))
    ck.expect(set(f_nodes) == set(c_nodes) | NEW_NODE_SET, "A.id-set",
              str(sorted((set(c_nodes) | NEW_NODE_SET) ^ set(f_nodes))))
    ck.expect(fused["last_node_id"] == LAST_NODE_ID_EXPECT, "A.last-node-id-9999",
              str(fused["last_node_id"]))
    ck.expect(fused["last_link_id"] == LAST_LINK_ID_NEW, "A.last-link-id-892",
              str(fused["last_link_id"]))

    # --- B. 连线守恒 + 17 条新链元组逐位 ---
    ck.expect(set(f_links) == (set(c_links) - CUT_LINK_IDS) | NEW_LINK_IDS,
              "B.link-set-conserved",
              "多:%r 少:%r" % (sorted(set(f_links) - ((set(c_links) - CUT_LINK_IDS) | NEW_LINK_IDS)),
                               sorted(((set(c_links) - CUT_LINK_IDS) | NEW_LINK_IDS) - set(f_links))))
    keep_ok = [lid for lid in set(c_links) - CUT_LINK_IDS if f_links.get(lid) == c_links[lid]]
    keep_bad = [lid for lid in set(c_links) - CUT_LINK_IDS if f_links.get(lid) != c_links[lid]]
    ck.expect(not keep_bad, "B.kept-links-bitwise", "漂移链:%r" % (keep_bad,))
    ck.expect(len(keep_ok) == len(canon["links"]) - len(CUT_LINK_IDS), "B.kept-count", str(len(keep_ok)))
    for t in NEW_LINK_TUPLES:
        ck.expect(f_links.get(t[0]) == t, "B.new-link-%d" % t[0],
                  "%r != %r" % (f_links.get(t[0]), t))

    # --- C. 零悬空 + 槽位不越界 + 双向一致 ---
    ids = set(f_nodes)
    dangling, oob = [], []
    for lid, s, ss, d, ds, t in fused["links"]:
        if s not in ids or d not in ids:
            dangling.append(lid)
            continue
        if ss >= len(f_nodes[s].get("outputs") or []) or ds >= len(f_nodes[d].get("inputs") or []):
            oob.append(lid)
    ck.expect(not dangling, "C.link-endpoints-exist", str(dangling))
    ck.expect(not oob, "C.slots-in-range", str(oob))
    bad_refs = []
    for n in fused["nodes"]:
        for i in n.get("inputs") or []:
            if i.get("link") is not None and i["link"] not in f_links:
                bad_refs.append((n["id"], "in", i.get("name"), i.get("link")))
        for o in n.get("outputs") or []:
            for lid in o.get("links") or []:
                if lid not in f_links:
                    bad_refs.append((n["id"], "out", o.get("name"), lid))
    ck.expect(not bad_refs, "C.no-dangling-port-refs", str(bad_refs[:8]))
    bidi_bad = []
    for lid, s, ss, d, ds, t in fused["links"]:
        if lid not in (f_nodes[s]["outputs"][ss].get("links") or []):
            bidi_bad.append(("src", lid))
        if f_nodes[d]["inputs"][ds].get("link") != lid:
            bidi_bad.append(("dst", lid))
    ck.expect(not bidi_bad, "C.bidirectional-wiring", str(bidi_bad[:8]))
    # 反向抽查:7 个被触节点的 link 引用精确值(§4 C 尾)
    ck.expect(f_nodes[5011]["outputs"][0]["links"] == [844, 879], "C.5011-out",
              repr(f_nodes[5011]["outputs"][0]["links"]))
    ck.expect(f_nodes[5013]["outputs"][0]["links"] == [886], "C.5013-out",
              repr(f_nodes[5013]["outputs"][0]["links"]))
    ck.expect(f_nodes[5014]["inputs"][1]["link"] == 887 and f_nodes[5014]["outputs"][0]["links"] == [860],
              "C.5014-in/out", "%r/%r" % (f_nodes[5014]["inputs"][1]["link"], f_nodes[5014]["outputs"][0]["links"]))
    ck.expect(f_nodes[5015]["inputs"][0]["link"] == 860, "C.5015-in",
              repr(f_nodes[5015]["inputs"][0]["link"]))
    ck.expect(f_nodes[5021]["outputs"][0]["links"] == [891], "C.5021-out",
              repr(f_nodes[5021]["outputs"][0]["links"]))
    ck.expect(f_nodes[5022]["inputs"][1]["link"] == 892 and f_nodes[5022]["inputs"][3]["link"] == 882,
              "C.5022-in", "%r/%r" % (f_nodes[5022]["inputs"][1]["link"], f_nodes[5022]["inputs"][3]["link"]))
    ck.expect(f_nodes[5022]["inputs"][3].get("shape") == 7, "C.5022-masks-shape7",
              repr(f_nodes[5022]["inputs"][3]))
    ck.expect(f_nodes[1003]["outputs"][0]["links"] == [515, 525, 563, 611, 625, 850, 851, 852, 884],
              "C.1003-out-9", repr(f_nodes[1003]["outputs"][0]["links"]))

    # --- D. 保留面:87 正典节点逐位一致(白名单=link 字段差) ---
    field_bad, deep_bad, wl_bad = [], [], []
    for cn in canon["nodes"]:
        fn = f_nodes.get(cn["id"])
        if fn is None:
            deep_bad.append((cn["id"], "missing"))
            continue
        a = (fn.get("type"), fn.get("mode"), fn.get("pos"), fn.get("size"), fn.get("order"),
             fn.get("title"), fn.get("widgets_values"))
        b = (cn.get("type"), cn.get("mode"), cn.get("pos"), cn.get("size"), cn.get("order"),
             cn.get("title"), cn.get("widgets_values"))
        if a != b:
            field_bad.append(cn["id"])
        if cn["id"] not in LINK_DELTA_WHITELIST:
            if fn != cn:
                deep_bad.append((cn["id"], "diff"))
        else:
            if strip_link_fields(fn) != strip_link_fields(cn):
                wl_bad.append(cn["id"])
    ck.expect(not field_bad, "D.87-scalar-fields-identical", str(field_bad))
    ck.expect(not deep_bad, "D.non-whitelist-bitwise", str(deep_bad))
    ck.expect(not wl_bad, "D.whitelist-structure-identical", str(wl_bad))

    # --- E. 新节点参数 = 作者件逐位(5107 归一;5110 control 位唯一偏离) ---
    for nid in NEW_NODE_IDS:
        src = a_nodes[AUTHOR_MAP[nid]]
        aw = author_widgets(src)  # 评审修法:无 widget 节点归一为 []
        fw = f_nodes[nid].get("widgets_values")
        if nid == 5110:
            ck.expect(fw[:2] == aw[:2] and fw[3:] == aw[3:], "E.5110-author-bitwise-except-control",
                      "%r vs %r" % (fw, aw))
            ck.expect(fw[2] == DEVIATION_5110_TO and aw[2] == DEVIATION_5110_FROM,
                      "E.5110-control-fixed-sole-deviation",
                      "fw=%r aw=%r" % (fw[2], aw[2]))
        else:
            ck.expect(fw == aw, "E.%d-author-bitwise" % nid, "%r vs %r" % (fw, aw))
        ck.expect(fw == EXPECTED_WIDGETS[nid], "E.%d-plan-W-table" % nid,
                  "%r != %r" % (fw, EXPECTED_WIDGETS[nid]))

    # --- F. 5100 出口链与开关 widgets 不变 ---
    for lid in SWITCH_LINK_IDS:
        ck.expect(f_links.get(lid) == c_links.get(lid), "F.switch-link-%d" % lid,
                  "%r != %r" % (f_links.get(lid), c_links.get(lid)))
    ck.expect(f_nodes[5100].get("widgets_values") == [False], "F.5100-widgets-false",
              repr(f_nodes[5100].get("widgets_values")))
    ck.expect(f_nodes[1065].get("widgets_values") == [False], "F.1065-widgets-false",
              repr(f_nodes[1065].get("widgets_values")))

    # --- G. 组框 ---
    ck.expect(fused["groups"][:7] == canon["groups"], "G.first7-groups-bitwise", "")
    g107 = fused["groups"][7] if len(fused["groups"]) > 7 else None
    ck.expect(g107 == G107, "G.G107-dict", repr(g107))
    if g107:
        bx = g107["bounding"]
        cover_bad = []
        for nid in NEW_NODE_IDS:
            n = f_nodes[nid]
            x, y = n["pos"]
            w, h = n["size"]
            if not (bx[0] <= x and bx[1] <= y and x + w <= bx[0] + bx[2] and y + h <= bx[1] + bx[3]):
                cover_bad.append(nid)
        ck.expect(not cover_bad, "G.G107-covers-9-new-nodes", str(cover_bad))
        g105 = fused["groups"][5]
        ck.expect(g105["bounding"] == [7140, 5820, 6150, 1416], "G.G105-bbox-untouched",
                  repr(g105["bounding"]))

    # --- H. 全节点两两无 AABB 重叠 ---
    def box(n):
        x, y = n["pos"]
        w, h = n["size"]
        return (x, y, x + w, y + h)

    ns = fused["nodes"]
    overlaps = []
    for i in range(len(ns)):
        for j in range(i + 1, len(ns)):
            a, b = box(ns[i]), box(ns[j])
            if a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]:
                overlaps.append((ns[i]["id"], ns[j]["id"]))
    ck.expect(not overlaps, "H.no-aabb-overlap-96", str(overlaps[:12]))

    # --- 元. 顶层元数据:除 last_link_id 外零改 ---
    meta = {k: v for k, v in fused.items() if k not in ("nodes", "links", "groups", "last_link_id")}
    meta_c = {k: v for k, v in canon.items() if k not in ("nodes", "links", "groups", "last_link_id")}
    ck.expect(meta == meta_c, "meta.top-level-untouched", "%r vs %r" % (meta, meta_c))

    # --- 序. 序列化往返字节等价(确定性) ---
    raw = serialize(fused)
    ck.expect(serialize(json.loads(raw.decode("utf-8"))) == raw, "ser.roundtrip-byte-equal", "")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description="三采-单镜-修脸.json 幂等生成器(fusion 1118;1119b 退役)")
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="干跑:只验不写")
    mode.add_argument("--apply", action="store_true", help="写盘后即验")
    args = ap.parse_args()

    # 1119b 退役短路(grill C4):双档段已并入正典(出口复制案),底座 87 节点口径已演进,
    # 本件不再施工——防改名后 CANON 旧名 FileNotFoundError 栈崩与双依赖死路,恒 exit 0。
    print("[RETIRED] 1119b 起由双档正典 单镜.json 取代(远景/高清双档·出口复制案);")
    print("[RETIRED] 双档段唯一生成器=apps/build/scripts/sancai_inline_facerefine_build_1118.py,重放走它;")
    print("[RETIRED] 融合件 7_测试/三采-单镜-修脸.json 留档归档不随役维护。本件 no-op 退出。")
    return 0

    canon_md5_before = md5_file(CANON)
    canon_doc = json.loads(CANON.read_text(encoding="utf-8"))
    author_doc = json.loads(AUTHOR.read_text(encoding="utf-8"))

    ck = Checker()
    fused = None
    try:
        fused = build_fused(canon_doc, author_doc, ck)
    except Fail as e:
        ck.failed.append(("build-fused", str(e)))

    if fused is not None and not ck.failed:
        verify(canon_doc, author_doc, fused, ck)

    product = serialize(fused) if fused is not None else None

    if ck.failed:
        for name, detail in ck.failed:
            print("FAIL %s %s" % (name, detail))
        print("\n门禁失败 %d 项(生成器或底座问题,禁改规格迁就)。" % len(ck.failed))
        return 1

    if args.check:
        if OUT.exists():
            disk = OUT.read_bytes()
            if disk == product:
                print("CHECK 落盘件与期望产物字节一致(%d bytes)" % len(disk))
            else:
                print("FAIL 落盘件与期望产物不一致: %s(现) vs 期望 %d bytes" % (OUT, len(product)))
                return 1
        else:
            print("CHECK 产物未落盘(干跑通过,期望 %d bytes): %s" % (len(product), OUT))
        for name in ck.passed:
            print("PASS %s" % name)
        print("\nCHECK 全绿: %d 项断言通过。" % len(ck.passed))
        return 0

    # --apply:幂等写(字节一致则 no-op)+ 写后即验
    wrote = False
    if OUT.exists() and OUT.read_bytes() == product:
        print("NO-OP 落盘件已与期望产物字节一致(%d bytes)" % len(product))
    else:
        OUT.write_bytes(product)
        wrote = True
        print("WRITE %s(%d bytes)" % (OUT, len(product)))

    # 写后即验:从盘重读,重跑全套断言
    disk_doc = json.loads(OUT.read_text(encoding="utf-8"))
    ck2 = Checker()
    verify(canon_doc, author_doc, disk_doc, ck2)
    ck2.expect(serialize(disk_doc) == product, "ser.disk-bytes-equal", "")

    canon_md5_after = md5_file(CANON)
    ck2.expect(canon_md5_after == canon_md5_before, "meta.canon-untouched",
               "%s -> %s" % (canon_md5_before, canon_md5_after))

    if ck2.failed:
        for name, detail in ck2.failed:
            print("FAIL %s %s" % (name, detail))
        print("\n写后验证失败 %d 项。" % len(ck2.failed))
        return 1

    for name in ck2.passed:
        print("PASS %s" % name)
    print("\nAPPLY 全绿: %d 项断言通过%s;正典件 md5 前后一致 %s" %
          (len(ck2.passed), "(本次写盘)" if wrote else "(no-op)", canon_md5_after))
    return 0


if __name__ == "__main__":
    sys.exit(main())
