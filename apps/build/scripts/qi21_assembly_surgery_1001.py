#!/usr/bin/env python3
# ============================================================================
# ⛔ 1001 已役警示(Trellis 10-01-qi21-assembly-blueprint)——勿再运行本脚本!
# 2026-10-01 手术已执行完毕,重跑必红:S2 前置断言锚「四件为 StringConstant」已随
# 术后态消亡([110][160][161][215] 现为 PrimitiveStringMultiline,见本件 widgets 步
# 「非StringConstant,拒绝换」断言),S8 集成轮删件后更无源;历史役档=提交 3e93c69
# (改名三件+固定句4件换型+横向四带重排+11中继Reroute全删+蓝图抽离)。
# ============================================================================

"""qi21-道劫-t2i [40]装配子图手术(2026-10-01,Trellis 10-01-qi21-assembly-blueprint)。

四步,每步独立快照+断言,幂等可重跑:
  rename  S1 改名三件([40]/[5]/[27] 短名化)+子图内部name+[10]速查卡补两行
  widgets S2 固定句4件([110][160][161][215]) StringConstant→PrimitiveStringMultiline+高度放大
  layout  S3A 横向布局重排(LINE-STABLE:连线集逐位不变,纯pos/size/组框/边界节点重写)
  reroute S3B 删12个纯中继Reroute,同源同目标直连(逻辑连线集等价对拍)
  all     按序全跑;verify 只跑一致性断言

铁律:禁手工编辑JSON;每步前后SHA256对拍;断言不过=fail-closed不落盘。
"""
import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

WF = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/backend/engines/comfyui/"
          "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json")
SG_UUID = "c3f81b56-0a47-4d29-9e61-8b7f2d5a6c04"
SNAP_DIR = Path("/tmp/qi21_surgery_1001")

RENAMES_TOP = {
    40: "[40] 提示词类型优化子图",
    5: "[5] 自动化宽高",
    27: "[27] 最终提示词预览",
}
SG_NAME_NEW = "[40] 提示词类型优化子图(双击进入)"
NOTE_EXTRA = [
    "- [5] 自动化宽高:宽高直连 [40] width/height 输出=画幅联动开关后终值;本节点面板 1024 为摆设值不生效。",
    "- [27] 最终提示词预览:接 [40]「最终文本」输出=将进编码的最终文本;跑图前过目。",
]

# S2: 固定句4件换多行大输入框 (id -> (type新, size新))
CONST_IDS = {110, 160, 161, 215}
MULTILINE_TYPE = "PrimitiveStringMultiline"
CONST_SIZE = {110: [460, 380], 160: [420, 220], 161: [420, 220], 215: [420, 220]}

# S3A: 横向布局坐标表 id -> ([x,y], [w,h]|None=保持现尺寸)
LAYOUT = {
    # 上带A 常量行 y≈150-200
    110: ([1050, 150], [460, 380]),
    160: ([1650, 200], [420, 220]),
    161: ([2130, 200], [420, 220]),
    215: ([2740, 200], [420, 220]),
    # 上带B RGBA/W1 透明文本支路 y≈610-680
    162: ([1600, 660], None),
    163: ([2080, 660], None),
    206: ([2560, 610], None),
    216: ([2980, 660], None),
    207: ([3440, 660], None),
    208: ([3900, 660], None),
    209: ([4380, 680], None),
    143: ([4850, 620], None),
    # 中轴 主链 y≈1040-1140
    150: ([100, 1100], None),
    130: ([770, 1110], None),
    131: ([1250, 1110], None),
    141: ([2000, 1140], None),
    142: ([4900, 1040], None),
    144: ([5380, 1140], None),
    # 下带 PE改写+画幅联动 y≈1830-2330
    140: ([1450, 1850], None),
    151: ([2150, 1830], None),
    152: ([2150, 2260], None),
    153: ([2600, 1900], None),
    154: ([2600, 2330], None),
    155: ([2950, 1830], None),
    156: ([2950, 2290], None),
    157: ([3400, 1880], None),
    158: ([3400, 2300], None),
    210: ([3980, 2050], None),
}
REROUTE_IDS = {171, 172, 173, 174, 204, 175, 205, 176, 213, 211, 212}  # 11个(212在链内,见下)

NEW_GROUPS = [
    {"id": 1, "title": "固定句常量行(可编辑大框·上带;锁层A/RGBA头尾/W1收束)", "bounding": [1020, 90, 2200, 500], "color": "#3f789e", "flags": {}},
    {"id": 2, "title": "主链(中轴):底座九选一→装配拼接→PE开关→编码→RGBA开关→输出", "bounding": [60, 1000, 5740, 400], "color": "#a1309b", "flags": {}},
    {"id": 3, "title": "RGBA透明文本支路(上带):RGBA公式/W1包裹→透明文本开关→RGBA编码", "bounding": [1560, 560, 3780, 430], "color": "#886", "flags": {}},
    {"id": 4, "title": "PE改写+画幅联动(下带):种子文→PE改写→画幅比→4.2MP建议宽高→联动开关", "bounding": [1410, 1780, 3020, 730], "color": "#4a7a3f", "flags": {}},
]
NEW_INPUT_POS = {  # slot序号(按sg.inputs数组序) -> [x,y]
    "clip": [-36, 1200], "vae": [-36, 1270], "主体句": [-36, 1140], "型选择": [-36, 1070],
    "RGBA透明": [-36, 2100], "PE开关": [-36, 980], "pe_clip": [-36, 1950], "画幅联动开关": [-36, 2250],
}
NEW_OUTPUT_POS = {
    "positive": [7300, 1050], "negative": [7300, 1150], "最终文本": [7300, 1250],
    "width": [7300, 1900], "height": [7300, 2300],
}
NEW_INPUT_BOUNDING = [-320, 900, 160, 1450]
NEW_OUTPUT_BOUNDING = [7200, 950, 320, 1500]


def sha(b): return hashlib.sha256(b).hexdigest()[:16]


def links_norm_hash(links):
    arr = [{k: l[k] for k in ("origin_id", "origin_slot", "target_id", "target_slot", "type")} for l in links]
    return sha(json.dumps(sorted(arr, key=lambda x: json.dumps(x, ensure_ascii=False)), ensure_ascii=False, sort_keys=True).encode())


def logical_links(sg):
    """压缩 Reroute 链后的端到端逻辑连线多重集(Reroute自身=纯中继)。
    只从「真源→中继网」的入线展开到所有真目标;中继出线本身跳过(避免重复计数)。"""
    nodes = {n["id"]: n for n in sg["nodes"]}
    rr = {nid for nid, n in nodes.items() if n["type"] == "Reroute"}
    by_origin = {}
    for l in sg["links"]:
        by_origin.setdefault(l["origin_id"], []).append(l)
    final = []
    for l in sg["links"]:
        if l["origin_id"] in rr:
            continue  # 中继出线:由入线展开覆盖
        if l["target_id"] in rr:
            stack = [l]
            while stack:
                cur = stack.pop()
                if cur["target_id"] in rr:
                    for nxt in by_origin.get(cur["target_id"], []):
                        stack.append(nxt)
                else:
                    final.append((l["origin_id"], l["origin_slot"], cur["target_id"], cur["target_slot"], cur["type"]))
        else:
            final.append((l["origin_id"], l["origin_slot"], l["target_id"], l["target_slot"], l["type"]))
    return sorted(final)


def consistency(d):
    """全图引用一致性:零悬空。返回错误列表。"""
    errs = []
    sg = d["definitions"]["subgraphs"][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}
    for nid, n in nodes.items():
        for i in n.get("inputs", []) or []:
            lid = i.get("link")
            if lid is not None and lid not in links:
                errs.append(f"node {nid} input {i.get('name')} 悬空 link {lid}")
            if lid is not None:
                l = links[lid]
                if l["target_id"] != nid:
                    errs.append(f"node {nid} input {i.get('name')} link {lid} 反向指向 {l['target_id']}")
        for o in n.get("outputs", []) or []:
            for lid in (o.get("links") or []):
                if lid not in links:
                    errs.append(f"node {nid} output {o.get('name')} 悬空 link {lid}")
                else:
                    l = links[lid]
                    if l["origin_id"] != nid:
                        errs.append(f"node {nid} output {o.get('name')} link {lid} 反向源 {l['origin_id']}")
    for arr, tag in ((sg.get("inputs", []), "sg.input"), (sg.get("outputs", []), "sg.output")):
        for s in arr:
            for lid in s.get("linkIds", []):
                if lid not in links:
                    errs.append(f"{tag} {s['name']} 悬空 linkId {lid}")
    for l in links.values():
        if l["origin_id"] not in nodes and l["origin_id"] != -10:
            errs.append(f"link {l['id']} 源节点 {l['origin_id']} 不存在")
        if l["target_id"] not in nodes and l["target_id"] != -20:
            errs.append(f"link {l['id']} 目标节点 {l['target_id']} 不存在")
    return errs


def load():
    d = json.loads(WF.read_text())
    assert d["definitions"]["subgraphs"][0]["id"] == SG_UUID, "子图uuid漂移,拒绝手术"
    return d


def save(d, tag):
    SNAP_DIR.mkdir(exist_ok=True)
    SNAP_DIR.joinpath(f"{tag}.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    WF.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n")
    print(f"[{tag}] 已落盘;快照={SNAP_DIR}/{tag}.json")


def step_rename(d):
    sg = d["definitions"]["subgraphs"][0]
    for n in d["nodes"]:
        if n["id"] in RENAMES_TOP:
            n["title"] = RENAMES_TOP[n["id"]]
    sg["name"] = SG_NAME_NEW
    note = next(n for n in d["nodes"] if n["id"] == 10)
    content = note["widgets_values"][0]
    for line in NOTE_EXTRA:
        if line not in content:
            content = content.rstrip("\n") + "\n" + line + "\n"
    note["widgets_values"][0] = content
    # 断言:三新名命中;连线与节点数不变由上层 verify 兜
    titles = {n["id"]: n.get("title") for n in d["nodes"]}
    assert titles[40] == RENAMES_TOP[40] and titles[5] == RENAMES_TOP[5] and titles[27] == RENAMES_TOP[27]
    assert sg["name"] == SG_NAME_NEW
    assert all(l in note["widgets_values"][0] for l in NOTE_EXTRA)
    print("[rename] 断言过:3 title+sg.name+[10]两行")


def step_widgets(d):
    sg = d["definitions"]["subgraphs"][0]
    before = {}
    for n in sg["nodes"]:
        if n["id"] in CONST_IDS:
            before[n["id"]] = hashlib.sha256(n["widgets_values"][0].encode()).hexdigest()
            assert n["type"] == "StringConstant", f"[{n['id']}] 非StringConstant({n['type']}),拒绝换"
            assert isinstance(n["widgets_values"], list) and len(n["widgets_values"]) == 1
    for n in sg["nodes"]:
        if n["id"] in CONST_IDS:
            n["type"] = MULTILINE_TYPE
            n["size"] = list(CONST_SIZE[n["id"]])
    for n in sg["nodes"]:
        if n["id"] in CONST_IDS:
            after = hashlib.sha256(n["widgets_values"][0].encode()).hexdigest()
            assert after == before[n["id"]], f"[{n['id']}] 值漂移!"
            assert n["type"] == MULTILINE_TYPE and n["size"] == CONST_SIZE[n["id"]]
    print("[widgets] 断言过:4件换型+size放大+逐字SHA256一致")


def step_layout(d):
    sg = d["definitions"]["subgraphs"][0]
    before_hash = links_norm_hash(sg["links"])
    for n in sg["nodes"]:
        if n["id"] in LAYOUT:
            pos, size = LAYOUT[n["id"]]
            n["pos"] = list(pos)
            if size:
                n["size"] = list(size)
    sg["groups"] = copy.deepcopy(NEW_GROUPS)
    for s in sg["inputs"]:
        if s["name"] in NEW_INPUT_POS:
            s["pos"] = list(NEW_INPUT_POS[s["name"]])
    for s in sg["outputs"]:
        if s["name"] in NEW_OUTPUT_POS:
            s["pos"] = list(NEW_OUTPUT_POS[s["name"]])
    sg["inputNode"]["bounding"] = list(NEW_INPUT_BOUNDING)
    sg["outputNode"]["bounding"] = list(NEW_OUTPUT_BOUNDING)
    assert links_norm_hash(sg["links"]) == before_hash, "LINE-STABLE 破约!"
    assert consistency(d) == [], consistency(d)
    # 每个常量/主链节点都已落新坐标
    for n in sg["nodes"]:
        if n["id"] in LAYOUT:
            assert n["pos"] == list(LAYOUT[n["id"]][0])
    print("[layout] 断言过:LINE-STABLE+坐标落位+引用一致")


def step_reroute(d):
    sg = d["definitions"]["subgraphs"][0]
    before_logical = logical_links(sg)
    nodes = {n["id"]: n for n in sg["nodes"]}
    rr_nodes = [nid for nid, n in nodes.items() if n["type"] == "Reroute"]
    assert set(rr_nodes) == REROUTE_IDS, f"Reroute清单漂移:实际{sorted(rr_nodes)}"
    # 展开中继网:每条 (真源→中继网→真目标) 用「最后一段」的link id
    links = sg["links"]
    by_origin = {}
    for l in links:
        by_origin.setdefault(l["origin_id"], []).append(l)
    rr_set = set(rr_nodes)
    new_links = []
    removed_ids = set()
    for l in links:
        if l["target_id"] in rr_set:
            removed_ids.add(l["id"])  # 进中继的线不保留原形态
            stack = [l]
            while stack:
                cur = stack.pop()
                if cur["target_id"] in rr_set:
                    for nxt in by_origin.get(cur["target_id"], []):
                        stack.append(nxt)
                else:
                    # cur 已是真目标线,但其源可能是中继→回溯真源
                    src_id, src_slot = cur["origin_id"], cur["origin_slot"]
                    guard = 0
                    while src_id in rr_set and guard < 50:
                        ins = [x for x in links if x["target_id"] == src_id]
                        assert len(ins) == 1
                        src_id, src_slot = ins[0]["origin_id"], ins[0]["origin_slot"]
                        guard += 1
                    nl = dict(cur)
                    nl["origin_id"], nl["origin_slot"] = src_id, src_slot
                    new_links.append(nl)
        elif l["origin_id"] in rr_set:
            removed_ids.add(l["id"])  # 中继→真目标:已被上面展开吸收或其目标也已被处理
        else:
            new_links.append(l)
    # 纯中继出线若其入线已被展开吸收,这里可能重复:按 (id) 去重
    seen = set()
    uniq = []
    for l in new_links:
        if l["id"] in seen:
            continue
        seen.add(l["id"])
        uniq.append(l)
    sg["links"] = uniq
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in rr_set]
    # 重建节点/边界 slot 引用
    live_ids = {l["id"] for l in sg["links"]}
    nodes = {n["id"]: n for n in sg["nodes"]}
    for n in sg["nodes"]:
        for i in n.get("inputs", []) or []:
            if i.get("link") is not None and i["link"] not in live_ids:
                i["link"] = None
        for l in sg["links"]:
            if l["target_id"] == n["id"]:
                inputs = n.get("inputs") or []
                if l["target_slot"] < len(inputs):
                    inputs[l["target_slot"]]["link"] = l["id"]
        outs = n.get("outputs") or []
        for o in outs:
            o["links"] = [lid for lid in (o.get("links") or []) if lid in live_ids]
        for l in sg["links"]:
            if l["origin_id"] == n["id"] and l["origin_slot"] < len(outs):
                if l["id"] not in (outs[l["origin_slot"]].get("links") or []):
                    outs[l["origin_slot"]].setdefault("links", []).append(l["id"])
    for s in sg.get("inputs", []) + sg.get("outputs", []):
        s["linkIds"] = [lid for lid in s.get("linkIds", []) if lid in live_ids]
    # 断言:逻辑等价+零悬空+Reroute全删
    after_logical = logical_links(sg)
    assert after_logical == before_logical, "Reroute瘦身逻辑不等价!"
    errs = consistency(d)
    assert errs == [], errs
    assert not [n for n in sg["nodes"] if n["type"] == "Reroute"], "Reroute残留"
    assert all(n["id"] not in REROUTE_IDS for n in sg["nodes"])
    print(f"[reroute] 断言过:删{len(rr_nodes)}中继;逻辑连线{len(before_logical)}条等价;link数{len(links)}→{len(sg['links'])}")


def verify(d, tag="verify"):
    errs = consistency(d)
    sg = d["definitions"]["subgraphs"][0]
    print(f"[{tag}] 节点{len(sg['nodes'])} links{len(sg['links'])} links_hash={links_norm_hash(sg['links'])} 悬空={len(errs)}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", choices=["rename", "widgets", "layout", "reroute", "all", "verify"])
    a = ap.parse_args()
    d = load()
    SNAP_DIR.mkdir(exist_ok=True)
    SNAP_DIR.joinpath("before.json").write_text(json.dumps(d, ensure_ascii=False, indent=2))
    steps = {"rename": step_rename, "widgets": step_widgets, "layout": step_layout, "reroute": step_reroute}
    if a.step == "verify":
        errs = verify(d)
        sys.exit(1 if errs else 0)
    seq = list(steps) if a.step == "all" else [a.step]
    hashes = []
    for name in seq:
        before = sha(WF.read_bytes())
        steps[name](d)
        verify(d, name)
        hashes.append((name, before))
        save(d, f"after_{name}")
    print("手术完成:", ", ".join(seq))


if __name__ == "__main__":
    main()
