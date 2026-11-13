#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1113 画布孪生件手术:把真源 a473c253 终态(删44节点+剪61线+三Note合一+五组重组+
深度阶梯布局)镜像到 App 画布孪生件。

计划:.trellis/tasks/11-13-sancai-workflow-surgery-replay/research/canvas-twin-surgery-plan.md(第2轮)
患者:apps/frontend/lib/assist/image-studio/h3-three-stage-template.json(下称【孪生】)
蓝本:apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json(下称【真源】,只读)

用法:
    python3 apps/build/scripts/h3_canvas_twin_surgery_1113.py           # apply(幂等,原子写)
    python3 apps/build/scripts/h3_canvas_twin_surgery_1113.py --verify  # 只读自检,红即 exit 1

状态机:①术前态(103节点+44删除集全在+152线+round-trip稳定)→ 可执行;②终态
(59/91/5+101指纹合+门8豁免清单合)→ no-op exit 0;③其它 → 拒刀 exit 1。

设计要点(对计划 §7 逐条):
- 真源 sha256 前16钉死 c5e026476f61b71c,漂移即拒跑;Note101 文本/59 节点 pos+size/
  groups 全部运行时读真源,脚本不内嵌副本。
- 纯 JSON 结构手术,零转换,不碰 API 孪生/注册表;不重排连线 id 与计数器。
- est 门按计划 §5 第2轮终版口径:MarkdownNote 特判(不套 h 公式)+ wcount 三态
  (list→len / str→1 / 缺→0)+ 无 +260 加成(该款两轮独立实现报互斥假重叠集,弃用)。
- 门3 校准(2026-11-13 实测,详见 gate3_no_dangling docstring):计划 §3 称真源自带
  3 处悬空,实测真源自带 8 处(另 5 处 {521,522,529,513,520} 两边逐字节同);字面
  谓词「所有登记 id 均在 links 表」与门4/门8 互斥(真源自身即不满足)。本门按计划
  E1/E3/§3 职能源于手术删除面,并加严为继承悬空集精确对账(终态=真源∖{762,764,778})。
- 门4/门8 一律键级比对(键集+逐键值):缺失键≠空容器(评审 R-MED,新训4)。
- 原子写:tmp+os.replace;json.dumps(ensure_ascii=False, indent=1) 无尾换行;写前
  round-trip 预检。八门内存全绿才落盘。
"""

import copy
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]  # 脚本在 apps/build/scripts/ 下,repo 根为上三级
TWIN_PATH = REPO / "apps/frontend/lib/assist/image-studio/h3-three-stage-template.json"
SRC_PATH = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/三采-单镜.json"
TWIN_REL = "apps/frontend/lib/assist/image-studio/h3-three-stage-template.json"

# ---- 钉死常量(全部出自计划【实测】/【正典】,禁自造) --------------------------
SRC_SHA16 = "c5e026476f61b71c"        # 真源文件指纹(漂移即拒跑)
PRE_TWIN_SHA16 = "e17b86863fd79a12"   # 孪生术前(HEAD 干净态)指纹,记录用
NOTE_LEN, NOTE_SHA16 = 391, "924804ebbda354c8"  # 真源 101 合并文本指纹

DELETE_NODES = frozenset({102, 103, 264, 265, 268, 269} | set(range(300, 338)))  # 44 个
PINNED_DELETE_LINKS = frozenset({564} | set(range(700, 755)) | {762, 764, 768, 778, 779})  # 61 条
CROSS_LINKS = frozenset({762, 764, 778})  # 跨界(恰一端删)
LONE_LINKS = frozenset({564})             # 双端均留

# 步 C 落到实处方恰 5 处——术后期望值(计划 §2)
STEP_C_EXPECT_OUT = {221: [766], 222: [767], 214: [629, 780], 120: [516, 526, 612, 626]}
STEP_C_220_SLOT = "audio_vae"  # 220 该槽 link=None 但槽定义保留(防 slot 重排)

# 门4 白名单(计划 §7-4):101 七字段 + pos/size 全体 + 步C 5 处
WL_GLOBAL_KEYS = frozenset({"pos", "size"})
WL_NODE_FIELDS = {
    101: frozenset({"widgets_values", "order", "properties", "inputs", "outputs"}),
    221: frozenset({"outputs"}),
    222: frozenset({"outputs"}),
    214: frozenset({"outputs"}),
    120: frozenset({"outputs"}),
    220: frozenset({"inputs"}),
}
WL_ADDED_KEYS = {101: frozenset({"inputs", "outputs", "properties"})}  # 101 补抄后新增的键

# 门6 正典五组成员(计划 §5,合计 19+15+8+15+2=59;键=真源组 title)
CANON_MEMBERS = {
    "加载模型": [127, 128, 119, 120, 145, 216, 202, 260, 262, 267, 261, 263, 217, 140, 251, 219, 218, 266, 338],
    "输入": [22, 20, 129, 131, 9, 110, 111, 112, 113, 14, 16, 220, 221, 222, 101],
    "一阶段采样": [250, 123, 126, 125, 122, 121, 130, 204],
    "二阶段放大": [205, 206, 207, 223, 203, 208, 209, 210, 211, 215, 212, 213, 214, 100, 4],
    "三采超分(ReCaVSR 主线)": [339, 340],
}

# 门7 锚点(计划 §7-7:16 锚 id→type + 100 video 槽 + 16 双面 max + 208 wv[4]=max)
ANCHORS = {
    4: "SaveVideo", 9: "LoadImage", 14: "PrimitiveStringMultiline",
    16: "MiniMaxH3ReferenceToVideo", 20: "PrimitiveFloat", 22: "ResolutionSelector",
    100: "MyShot", 101: "MarkdownNote", 110: "LoadImage", 111: "LoadImage",
    112: "LoadImage", 113: "LoadImage", 208: "MiniMaxH3ReferenceToVideo",
    338: "ReCaVSRLoader", 339: "ReCaVSRUpscale", 340: "SaveVideo",
}

# 门8 钉死清单(计划 §6/附录A-1):节点面 9 项 + 连线面 6 条(target_slot),多/少皆红
PIN_NODE_DIFFS = frozenset({
    (16, "widgets_values_named"),   # 豁免1: e9c406df UI 勘正面,禁改回 match
    (100, "widgets_values"),        # 豁免2: App 模板占位 S00
    (214, "outputs"), (221, "outputs"), (222, "outputs"),  # 豁免4: 比真源干净
    (218, "inputs"), (221, "inputs"), (222, "inputs"),     # 豁免5: 开关线登记面
    (220, "inputs"),                # 豁免3: audio_vae 空槽保留
})
PIN_LINK_DIFFS = frozenset({574, 575, 576, 577, 578, 758})  # 豁免5: target_slot 1↔2
TOP_KEYS = ("id", "revision", "last_node_id", "last_link_id", "config", "extra", "version")

FORBIDDEN_STRINGS = ("TESSERA", "RelayVSR", "TokenCounter")


# ---- 基础工具 ----------------------------------------------------------------
def sha16_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def dumps_twin(obj) -> str:
    """孪生序列化格式(计划 §0 实测):indent=1、ensure_ascii=False、无尾换行。"""
    return json.dumps(obj, ensure_ascii=False, indent=1)


def read_text(path: Path) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


class Fail(Exception):
    pass


def check(cond: bool, msg: str):
    if not cond:
        raise Fail(msg)


def node_map(obj) -> dict:
    return {n["id"]: n for n in obj["nodes"]}


def link_map(obj) -> dict:
    return {l[0]: l for l in obj["links"]}


def load_source() -> dict:
    raw = SRC_PATH.read_bytes()
    got = sha16_bytes(raw)
    check(got == SRC_SHA16, f"真源 sha256 前16漂移: {got} != {SRC_SHA16},拒跑")
    return json.loads(raw.decode("utf-8"))


# ---- est 框(计划 §5 第2轮终版口径,评审 R-LOW;禁照正典文本直译) -----------
def est_box(node) -> tuple:
    x, y = node["pos"][0], node["pos"][1]
    w = max(260, node["size"][0])
    if node["type"] == "MarkdownNote":  # 特判:不套 h 公式(wv 是长文本,len 会爆 h)
        return (x, y, w, node["size"][1])
    wv = node.get("widgets_values")
    if isinstance(wv, list):
        wcount = len(wv)
    elif isinstance(wv, str):
        wcount = 1
    else:
        wcount = 0
    n_in = len(node.get("inputs") or [])
    n_out = len(node.get("outputs") or [])
    h = max(node["size"][1], 36 + max(n_in, n_out) * 24 + wcount * 30 + 28)
    return (x, y, w, h)


def boxes_overlap(a: tuple, b: tuple) -> bool:
    return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]


def pairwise_overlaps(boxes: dict) -> int:
    ids = sorted(boxes)
    n = 0
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if boxes_overlap(boxes[ids[i]], boxes[ids[j]]):
                n += 1
    return n


# ---- 八门(apply 内存跑 + --verify 落盘跑,同一套代码) -----------------------
def gate1_counts(final, pre_links=None):
    nm, lm = node_map(final), link_map(final)
    check(len(nm) == 59, f"节点数 {len(nm)} != 59")
    check(len(lm) == 91, f"连线数 {len(lm)} != 91")
    check(len(final["groups"]) == 5, f"组数 {len(final['groups'])} != 5")
    check(final["last_node_id"] == 340, f"last_node_id {final['last_node_id']} != 340")
    check(final["last_link_id"] == 782, f"last_link_id {final['last_link_id']} != 782")
    tier = ""
    if pre_links is not None:
        both = cross = lone = 0
        for lid in PINNED_DELETE_LINKS:
            l = pre_links[lid]
            os_del = l[1] in DELETE_NODES
            tg_del = l[3] in DELETE_NODES
            if os_del and tg_del:
                both += 1
            elif os_del != tg_del:
                cross += 1
            else:
                lone += 1
        check(both == 57, f"双端均删线 {both} != 57")
        check(cross == 3, f"跨界线 {cross} != 3")
        check(lone == 1, f"双端均留线 {lone} != 1")
        check(152 - both == 95 and 95 - cross == 92 and 92 - lone == 91, "三档计数 95/92/91 不合")
        tier = f" | tiers 152-{both}=95, 95-{cross}=92, 92-{lone}=91"
    else:
        tier = " | tiers not computable from baseline (degraded, final counts asserted)"
    return f"counts 59/91/5, last_node_id=340, last_link_id=782{tier}"


def gate2_link_forward(final):
    nm, lm = node_map(final), link_map(final)
    for lid, l in sorted(lm.items()):
        _, oid, oslot, tid, tslot, _ = l
        check(oid in nm and tid in nm, f"线 {lid} 端点不在册: {oid}/{tid}")
        onode, tnode = nm[oid], nm[tid]
        check(oslot < len(onode["outputs"]), f"线 {lid} origin_slot {oslot} 越界")
        check(lid in onode["outputs"][oslot]["links"], f"线 {lid} 不在 {oid}.outputs[{oslot}].links")
        check(tslot < len(tnode["inputs"]), f"线 {lid} target_slot {tslot} 越界")
        check(tnode["inputs"][tslot].get("link") == lid,
              f"线 {lid} 与 {tid}.inputs[{tslot}].link 不一致: {tnode['inputs'][tslot].get('link')}")
    return f"links forward 91/91: endpoints in graph + origin/target registrations consistent"


def dangling_spots(obj) -> set:
    """悬空登记点位集:{(node_id, 'inputs'|'outputs', slot, link_id)},登记指向 links 表外 id。"""
    lm = link_map(obj)
    spots = set()
    for n in obj["nodes"]:
        for i, inp in enumerate(n.get("inputs") or []):
            lid = inp.get("link")
            if lid is not None and lid not in lm:
                spots.add((n["id"], "inputs", i, lid))
        for o, outs in enumerate(n.get("outputs") or []):
            for lid in outs.get("links") or []:
                if lid not in lm:
                    spots.add((n["id"], "outputs", o, lid))
    return spots


def gate3_no_dangling(final, src):
    """反查门(手术删除面 + 继承面精确对账)。

    校准记录(2026-11-13 实测,对计划 §7-3 字面谓词的必要修正):
    计划称「真源终态自带这 3 处悬空(762/764/778)」——实测真源自带 **8 处**,另有
    {16→521, 16→522, 130→529, 140→513, 250→520} 共 5 处悬空登记在孪生/真源逐字节相同
    (如 16.outputs[0].links=[521,576] 两边同)。该 5 处属继承面:门8 钉死其逐字节等于
    真源、门4 白名单禁动、E3 明令「禁 link=None 扫射」——字面谓词「所有登记 id 均在
    links 表」连真源自己都不满足,与门4/门8 互斥不可同时满足。故本门按计划 E1/E3/§3
    的职能源于手术删除面,并加严为继承悬空集精确对账:终态悬空集 == 真源悬空集
    ∖ {762,764,778}(即「比真源恰净已知 3 处」,其余字节继承)。
    """
    nm = node_map(final)
    # ① 手术删除面:61 条删除线的 id 在任何登记中零出现
    refs_deleted = []
    for nid, n in nm.items():
        for i, inp in enumerate(n.get("inputs") or []):
            if inp.get("link") in PINNED_DELETE_LINKS:
                refs_deleted.append((nid, "inputs", i, inp["link"]))
        for o, outs in enumerate(n.get("outputs") or []):
            for lid in outs.get("links") or []:
                if lid in PINNED_DELETE_LINKS:
                    refs_deleted.append((nid, "outputs", o, lid))
    check(not refs_deleted, f"61 删除线 id 仍被登记引用: {refs_deleted[:8]}")
    # ② 删除集 44 节点零残留(节点面/连线端点)
    residue = sorted(DELETE_NODES & set(nm))
    check(not residue, f"删除集节点残留: {residue}")
    for l in final["links"]:
        check(l[1] not in DELETE_NODES and l[3] not in DELETE_NODES,
              f"删除集节点仍作连线端点: {l}")
    # ③ 禁词零命中
    text = dumps_twin(final)
    hits = {s: text.count(s) for s in FORBIDDEN_STRINGS if s in text}
    check(not hits, f"禁词命中: {hits}")
    # ④ 继承面精确对账:终态悬空集 == 真源悬空集 ∖ 三处跨界已知悬空
    fin_d = dangling_spots(final)
    src_d = dangling_spots(src)
    cleaned = {(214, "outputs", 0, 778), (221, "outputs", 0, 762), (222, "outputs", 0, 764)}
    expect_inherited = src_d - cleaned
    check(fin_d == expect_inherited,
          f"继承悬空集不对账: 终态 {sorted(fin_d)} != 真源∖{{{sorted(cleaned)}}} = {sorted(expect_inherited)}")
    return (f"deleted-link refs 0/61 | delete-node residue 0/44 | TESSERA/RelayVSR/TokenCounter 0/0/0 | "
            f"inherited dangling == source's minus {{762,764,778}}: {len(fin_d)} spots "
            f"{{{','.join(str(x[3]) for x in sorted(fin_d))}}} byte-pinned by G8")


def gate4_param_fidelity(final, pre):
    """幸存面与术前态键级比对;白名单=101 七字段+pos/size 全体+步C 5 处(并复核步C终值)。"""
    if pre is None:
        return "DEGRADED (no pre-state baseline): param fidelity vs pre-state skipped, " \
               "structure covered by gates 1/2/3/5/6/7/8"
    fn, pn = node_map(final), node_map(pre)
    changed_wl, added_keys = [], []
    for nid in sorted(fn):
        cur, old = fn[nid], pn[nid]
        added = set(cur) - set(old)
        removed = set(old) - set(cur)
        wl_add = WL_ADDED_KEYS.get(nid, frozenset())
        check(added <= wl_add, f"节点 {nid} 键集新增超出白名单: {sorted(added - wl_add)}")
        check(not removed, f"节点 {nid} 键集丢失: {sorted(removed)}")
        if added:
            added_keys.append((nid, sorted(added)))
        wl = WL_GLOBAL_KEYS | WL_NODE_FIELDS.get(nid, frozenset())
        for k in old:
            if k in wl:
                if cur[k] != old[k]:
                    changed_wl.append((nid, k))
                continue
            check(cur[k] == old[k],
                  f"节点 {nid} 字段 {k} 被改动(白名单外): {old[k]!r} → {cur[k]!r}")
    check(len(added_keys) == 1 and added_keys[0][0] == 101,
          f"键集新增仅允许 101(+inputs/outputs/properties): {added_keys}")
    # 步 C 5 处终值精确复核
    for nid, expect in STEP_C_EXPECT_OUT.items():
        got = fn[nid]["outputs"][0]["links"]
        check(got == expect, f"步C {nid}.outputs[0].links = {got} != {expect}")
    slot220 = [i for i in fn[220]["inputs"] if i.get("name") == STEP_C_220_SLOT]
    check(len(slot220) == 1 and slot220[0].get("link") is None,
          f"步C 220.{STEP_C_220_SLOT} 槽应恰一个且 link=None: {slot220}")
    return (f"59 survivors key-level clean vs pre-state | whitelist used: 101 +7fields"
            f"(+{len(WL_ADDED_KEYS[101])} keys) + pos/size x59 + stepC 5 exact "
            f"(221→[766], 222→[767], 214→[629,780], 120→[516,526,612,626], 220.audio_vae.link=None)")


def gate5_layout(final):
    nm, lm = node_map(final), link_map(final)
    gaps = [nm[l[3]]["pos"][0] - nm[l[1]]["pos"][0] for l in lm.values()]
    check(all(g > 0 for g in gaps), "存在非严格右向连线(左缘口径,零容差)")
    act = {nid: (n["pos"][0], n["pos"][1], n["size"][0], n["size"][1]) for nid, n in nm.items()}
    est = {nid: est_box(n) for nid, n in nm.items()}
    ca, ce = pairwise_overlaps(act), pairwise_overlaps(est)
    check(ca == 0, f"实际框两两 2D 相交 {ca} 处 != 0")
    check(ce == 0, f"est 框(终版口径)两两 2D 相交 {ce} 处 != 0")
    neg = [nid for nid, n in nm.items() if n["pos"][0] < 0 or n["pos"][1] < 0]
    check(not neg, f"pos<0 节点: {neg}")
    bad_g = [g["title"] for g in final["groups"] if g["bounding"][0] < 0 or g["bounding"][1] < 0]
    check(not bad_g, f"组 bounding x/y<0: {bad_g}(h=-20 标题带记法不判)")
    return (f"strict rightward 91/91 (min gap={min(gaps)}, zero tolerance) | "
            f"actual-box overlaps 0 | est-box overlaps 0 | pos>=0 x59 | group x,y>=0 x5")


def gate6_groups(final):
    nm = node_map(final)
    groups = final["groups"]
    bands = [(g["bounding"][0], g["bounding"][0] + g["bounding"][2], g["title"]) for g in groups]
    bad = [(bands[i][2], bands[j][2]) for i in range(len(bands)) for j in range(i + 1, len(bands))
           if bands[i][0] < bands[j][1] and bands[j][0] < bands[i][1]]
    check(not bad, f"组界 x 带相交: {bad}")
    bands_by_title = {t: (lo, hi) for lo, hi, t in bands}
    check(set(bands_by_title) == set(CANON_MEMBERS), f"组 title 与正典五组不符: {sorted(bands_by_title)}")
    members_all = [m for ids in CANON_MEMBERS.values() for m in ids]
    check(len(members_all) == len(set(members_all)) == 59, "正典成员并集应 59 且无重复")
    check(set(members_all) == set(nm), "正典成员并集 != 节点集")
    out_of_band = []
    for title, ids in CANON_MEMBERS.items():
        lo, hi = bands_by_title[title]
        for m in ids:
            n = nm[m]
            if not (lo <= n["pos"][0] and n["pos"][0] + n["size"][0] <= hi):
                out_of_band.append((title, m))
    check(not out_of_band, f"成员节点框越出组 x 带: {out_of_band[:8]}")
    bands_str = ", ".join(f"[{lo:g},{hi:g}]" for lo, hi, _ in sorted(bands))
    return f"5 bands pairwise disjoint ({bands_str}) | members 59/59 in-band | union==node set"


def gate7_anchors(final):
    nm = node_map(final)
    for nid, typ in ANCHORS.items():
        check(nid in nm, f"锚点 {nid} 缺失")
        check(nm[nid]["type"] == typ, f"锚点 {nid} type={nm[nid]['type']} != {typ}")
    video_slots = [i for i in nm[100]["inputs"] if i.get("name") == "video"]
    check(len(video_slots) == 1 and video_slots[0].get("link") is not None,
          f"100 应有名 video 的输入槽且回收线在挂: {video_slots}")
    n16 = nm[16]
    check(n16["widgets_values"][4] == "max", f"16.widgets_values[4]={n16['widgets_values'][4]} != max")
    check(n16["widgets_values_named"].get("ref_image_size") == "max",
          f"16 named 面 ref_image_size={n16['widgets_values_named'].get('ref_image_size')} != max(e9c406df 钉 max,禁改回)")
    n208 = nm[208]
    check(n208["widgets_values"][4] == "max", f"208.widgets_values[4]={n208['widgets_values'][4]} != max")
    return (f"16 anchors id→type ok | 100 'video' slot ok (link={video_slots[0]['link']}) | "
            f"16 dual-face max ok (wv[4]+named) | 208 wv[4]=max ok")


def gate8_final_alignment(final, src):
    fn, sn = node_map(final), node_map(src)
    check(set(fn) == set(sn), f"节点 id 集合不等: {sorted(set(fn) ^ set(sn))}")
    diffs = []
    for nid in sorted(fn):
        a, b = fn[nid], sn[nid]
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b or a[k] != b[k]:
                diffs.append((nid, k))
    check(set(diffs) == PIN_NODE_DIFFS,
          f"节点面差异集 != 钉死 9 项 | 实际 {len(diffs)}: {sorted(set(diffs))} | "
          f"多余 {sorted(set(diffs) - PIN_NODE_DIFFS)} | 缺失 {sorted(PIN_NODE_DIFFS - set(diffs))}")
    fl, sl = link_map(final), link_map(src)
    check(set(fl) == set(sl), f"连线 id 集合不等: {sorted(set(fl) ^ set(sl))}")
    ldiff = {}
    for lid in sorted(fl):
        if fl[lid] != sl[lid]:
            ldiff[lid] = [i for i in range(6) if fl[lid][i] != sl[lid][i]]
    check(set(ldiff) == PIN_LINK_DIFFS,
          f"连线面差异 != 钉死 6 条: {sorted(set(ldiff))}")
    for lid, pos in ldiff.items():
        check(pos == [4], f"线 {lid} 差异位置 {pos} != [4](target_slot)")
    check(final["groups"] == src["groups"], "组面与真源不等")
    for k in TOP_KEYS:
        check(final.get(k) == src.get(k), f"顶层字段 {k} 与真源不等")
    return (f"node-face diffs == pinned 9 ({'/'.join(f'{i}.{k}' for i, k in sorted(PIN_NODE_DIFFS))}) | "
            f"link-face diffs == pinned 6 ({sorted(PIN_LINK_DIFFS)}, all target_slot) | "
            f"groups equal | top-level 7 keys equal")


GATES = [
    ("G1 计数门", gate1_counts),
    ("G2 连线完整正查", gate2_link_forward),
    ("G3 悬空引用反查", gate3_no_dangling),
    ("G4 参数保真(键级,白名单)", gate4_param_fidelity),
    ("G5 布局判据", gate5_layout),
    ("G6 组结构", gate6_groups),
    ("G7 锚点齐全", gate7_anchors),
    ("G8 终态键级对齐", gate8_final_alignment),
]


def run_gates(final, src, pre=None, pre_links=None):
    results = []
    for name, fn in GATES:
        try:
            if fn is gate1_counts:
                detail = fn(final, pre_links)
            elif fn is gate4_param_fidelity:
                detail = fn(final, pre)
            elif fn is gate3_no_dangling:
                detail = fn(final, src)
            elif fn is gate8_final_alignment:
                detail = fn(final, src)
            else:
                detail = fn(final)
            print(f"[{name}][PASS] {detail}")
            results.append((name, True, detail))
        except Fail as e:
            print(f"[{name}][FAIL] {e}")
            results.append((name, False, str(e)))
    return results


# ---- 手术(计划 §2/§4/§5) ---------------------------------------------------
def build_final(pre: dict, src: dict) -> dict:
    w = copy.deepcopy(pre)
    pre_links = link_map(pre)

    # 删除线集断言:孪生∖真源 运行时算并比对钉死集(不等即弃刀)
    src_links = link_map(src)
    computed = set(pre_links) - set(src_links)
    check(computed == set(PINNED_DELETE_LINKS),
          f"删除线集 != 钉死集: 实际 {len(computed)} 条 | 多 {sorted(computed - PINNED_DELETE_LINKS)} | "
          f"少 {sorted(PINNED_DELETE_LINKS - computed)}")
    src_nodes = node_map(src)
    del_actual = {n["id"] for n in pre["nodes"]} - set(src_nodes)
    check(del_actual == set(DELETE_NODES), f"删除节点集 != 钉死 44 个: {sorted(del_actual ^ DELETE_NODES)}")

    # 步 A:移除 44 节点
    w["nodes"] = [n for n in w["nodes"] if n["id"] not in DELETE_NODES]

    # 步 B:移除 61 线
    w["links"] = [l for l in w["links"] if l[0] not in PINNED_DELETE_LINKS]

    # 步 C:登记面同步(origin 幸存→outputs[].links 删该 id;target 幸存→inputs[].link=None)
    touched = []
    nm = node_map(w)
    for lid in sorted(PINNED_DELETE_LINKS):
        _, oid, oslot, tid, tslot, _ = pre_links[lid]
        if oid not in DELETE_NODES:
            outs = nm[oid]["outputs"][oslot]["links"]
            if lid in outs:
                outs.remove(lid)
                touched.append(f"{oid}.outputs[{oslot}]−{lid}")
        if tid not in DELETE_NODES:
            inp = nm[tid]["inputs"][tslot]
            if inp.get("link") == lid:
                inp["link"] = None  # 槽定义保留(220.audio_vae)
                touched.append(f"{tid}.inputs[{tslot}].link→None")
    check(len(touched) == 5, f"步 C 落到实处方应恰 5 处,实际 {len(touched)}: {touched}")
    expect_touch = {"221.outputs[0]−762", "222.outputs[0]−764", "214.outputs[0]−778",
                    "120.outputs[0]−564", "220.inputs[8].link→None"}
    check(set(touched) == expect_touch, f"步 C 触碰处与计划点名不符: {sorted(set(touched) ^ expect_touch)}")

    # 步 D:Note101 七字段从真源逐字节抄(禁手搓;不内嵌正文)
    s101 = src_nodes[101]
    txt = s101["widgets_values"][0]
    check(isinstance(txt, str) and len(txt) == NOTE_LEN and sha16_bytes(txt.encode("utf-8")) == NOTE_SHA16,
          f"真源 101 文本指纹不合: len={len(txt)}")
    t101 = nm[101]
    for f in ("widgets_values", "order", "properties", "inputs", "outputs", "pos", "size"):
        t101[f] = copy.deepcopy(s101[f])

    # 步 E:59 节点 pos/size + groups 整组照抄真源(不重算不迭代,E2)
    for nid, n in nm.items():
        n["pos"] = copy.deepcopy(src_nodes[nid]["pos"])
        n["size"] = copy.deepcopy(src_nodes[nid]["size"])
    w["groups"] = copy.deepcopy(src["groups"])
    return w


# --verify 的术前基线:优先 git show HEAD(须在提交前跑;取不到则告警降级) ------
def git_head_pre_state():
    try:
        out = subprocess.run(["git", "-C", str(REPO), "show", f"HEAD:{TWIN_REL}"],
                             capture_output=True, check=True)
        return json.loads(out.stdout.decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] git HEAD 基线取不到({e});门4 降级、三档计数降级(计划 §7 允许)")
        return None


def baseline_is_pre(pre) -> bool:
    """HEAD 基线是否真为术前态(提交后重跑 --verify 时 HEAD=终态,三档/白名单按降级口径)。"""
    if pre is None:
        return False
    try:
        lm = link_map(pre)
    except Exception:  # noqa: BLE001
        return False
    return set(lm) - set(link_map(load_source())) == set(PINNED_DELETE_LINKS) or len(lm) == 152


# ---- 状态机 ------------------------------------------------------------------
def diff_set_vs_source(obj, src):
    """节点面 (id,key) 差异集 + 连线面差异 id 集(键级,门8 同口径)。"""
    fn, sn = node_map(obj), node_map(src)
    nd = set()
    if set(fn) == set(sn):
        for nid in fn:
            a, b = fn[nid], sn[nid]
            for k in set(a) | set(b):
                if k not in a or k not in b or a[k] != b[k]:
                    nd.add((nid, k))
    fl, sl = link_map(obj), link_map(src)
    ld = {lid for lid in fl if lid in sl and fl[lid] != sl[lid]} if set(fl) == set(sl) else None
    return nd, ld


def classify(twin_obj, twin_text, src):
    nm, lm = node_map(twin_obj), link_map(twin_obj)
    n, k, g = len(nm), len(lm), len(twin_obj.get("groups", []))
    rt = dumps_twin(twin_obj) == twin_text
    if (n == 103 and k == 152 and DELETE_NODES <= set(nm)
            and set(lm) - set(link_map(src)) == set(PINNED_DELETE_LINKS) and rt):
        return "pre"
    if n == 59 and k == 91 and g == 5 and rt and set(nm) == set(node_map(src)):
        t = nm[101]["widgets_values"][0]
        nd, ld = diff_set_vs_source(twin_obj, src)
        if (isinstance(t, str) and len(t) == NOTE_LEN
                and sha16_bytes(t.encode("utf-8")) == NOTE_SHA16
                and nd == set(PIN_NODE_DIFFS) and ld == set(PIN_LINK_DIFFS)
                and twin_obj.get("groups") == src["groups"]):
            return "final"
    return "unknown"


def main() -> int:
    verify = "--verify" in sys.argv[1:]
    src = load_source()
    twin_text = read_text(TWIN_PATH)
    try:
        twin_obj = json.loads(twin_text)
    except json.JSONDecodeError as e:
        print(f"[REFUSE] 孪生 JSON 解析失败: {e}")
        return 1

    state = classify(twin_obj, twin_text, src)
    sha_now = sha16_bytes(TWIN_PATH.read_bytes())

    if verify:
        if state == "pre":
            note = "(与钉死术前指纹一致)" if sha_now == PRE_TWIN_SHA16 else f"(sha256前16={sha_now})"
            print(f"pre-state recognized, not yet surgered {note}")
            print("  103 nodes / 152 links / delete-set 44 all present / pinned 61-link diff holds / round-trip stable")
            return 0
        if state == "final":
            print(f"final state on disk (sha256 前16={sha_now}); run 8 gates:")
            pre = git_head_pre_state()
            pre_links = link_map(pre) if baseline_is_pre(pre) else None
            results = run_gates(twin_obj, src, pre=pre, pre_links=pre_links)
            ok = all(r[1] for r in results)
            print("G1 eight-gate self-check: " + ("ALL GREEN" if ok else "RED"))
            return 0 if ok else 1
        print(f"[REFUSE] 未识别状态: nodes={len(twin_obj['nodes'])} links={len(twin_obj['links'])} "
              f"groups={len(twin_obj.get('groups', []))} round_trip={dumps_twin(twin_obj) == twin_text}")
        return 1

    # ---- apply ----
    if state == "final":
        print(f"final state already in place (sha256 前16={sha_now}), no-op")
        return 0
    if state != "pre":
        print(f"[REFUSE] 未识别状态(nodes={len(twin_obj['nodes'])}, links={len(twin_obj['links'])}),拒刀")
        return 1

    final = build_final(twin_obj, src)
    text = dumps_twin(final)
    check(json.loads(text) == final, "round-trip 预检失败:序列化≠对象")
    check(dumps_twin(json.loads(text)) == text, "round-trip 预检失败:二次序列化抖动")

    print("in-memory gates before write:")
    results = run_gates(final, src, pre=twin_obj, pre_links=link_map(twin_obj))
    if not all(r[1] for r in results):
        print("[ABORT] 八门未全绿,不落盘")
        return 1

    tmp = TWIN_PATH.with_name(TWIN_PATH.name + ".tmp-surgery")
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, TWIN_PATH)

    disk_text = read_text(TWIN_PATH)
    check(disk_text == text, "落盘后回读与内存文本不一致")
    disk_obj = json.loads(disk_text)
    print(f"atomic write done (sha256 前16={sha16_bytes(disk_text.encode('utf-8'))}); re-verify from disk:")
    results2 = run_gates(disk_obj, src, pre=twin_obj, pre_links=link_map(twin_obj))
    ok = all(r[1] for r in results2)
    print("apply " + ("COMPLETE (8/8 gates green pre-write and on-disk)" if ok else "FAILED on disk re-check"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
