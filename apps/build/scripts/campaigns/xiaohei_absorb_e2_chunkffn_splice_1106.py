#!/usr/bin/env python3
"""E2｜MiniMaxChunkFeedForward 削峰旁路件落三段链真源(Trellis 11-06-xiaohei-h3ltx-absorb E2)。

落位口径(prd C5/C10 消解 + 1106 执行期两处冲突已解):
  插在 ②段 MODEL 行 [202]LoraLoaderModelOnly(taomate) → [203]MiniMaxH3SigmaShift 之间。
  出厂 `chunks=1` = 源码实测恒等旁路(comfyui-kjnodes/nodes/minimax_nodes.py:69-71
  `if chunks == 1: return io.NodeOutput(model)`——原对象返回,零 clone 零 object patch),
  故不需要 mode 旁路位(C10 的「先实测 mode=4 是否直通 MODEL」就此化解);
  `seq_threshold=4096` 留节点默认(即便被误开成 chunks≥2,低于阈值的档每次 forward 仍走
  minimax_mlp_chunked_forward:30 的未分批表达式,与 comfy/ldm/minimax/model.py:211 逐字同)。
  开启条件写死 = ≥2MP×192f 档(1106 裁定;实测削峰收益归 11-06-xiaohei-absorb-duipai)。

执行期冲突一(prd C5 的 x∈(5703,6563) 放不下):
  实测改前 MODEL 行 [202] 右缘 6343、[203] 左缘 6563 → 走廊仅 220 px,而 layout_check
  同排行间距下限 ROW_GAP_MIN=200/侧(件宽 300 需 700 px)。解法=**下游显式让位**:
  新件落 [6543,80],二采段 MODEL/视频主线件 TAIL_IDS 一律 x+SHIFT(600),二采组框宽同步
  +SHIFT(右缘 10493→11093,与一采/③组框仍两两不交),另 [207] y+25 消一处列距违规。
  让位集**必须按件号显式列**(1106 实测):x 区间判据会误吞 y 318/288 行的 [206]/[207],
  它们与新件同列相邻、一动就把 205→206/205→207/208→210 三根曲线外扩,crossings 反升
  590→592 破棘轮;显式集 + nudge 实测 crossings 590→589(-1)且结构判据全清。
  新件 size 高取 90、`inputs` 只留 model 口(widget 不进 inputs 数组,与该件 [203] 同款
  风格):est_size 按 `TITLE_H + max(in,out)*SLOT_H + widgets*WIDGET_H + PAD_H` 估高,widget
  口一旦进 inputs 就把估高从 148 抬到 196,同排行距被判违规。声明高 90 与本件既有风格一致
  ([202] 1 口+2 widget = [640,90]、[203] = [265.5,82]);真实间距余量由 est 判据(148)把关。

双机 `ver` 口径(1106 实探):
  `ver` 取 **Win 产线引擎** kjnodes HEAD `ab72eda7…`(三段链实弹跑在 Win 17000);Mac 引擎
  kjnodes HEAD=`37ca7aff…`,二者 `MiniMaxChunkFeedForward` schema 逐字同(chunks default 2
  /min 1/max 64,seq_threshold default 4096,1 入 1 出)→ 双机都能加载,ver 不匹配只落 UI
  版本角标,不改语义。引擎侧注册性以 Win `/object_info` 为准,同步役复验。

执行期冲突二(件号段约定):
  契约 test_stage3_tessera_params_v4 钉「id≥300 恒 mode=2(③组默认旁路)」;本件属②段却
  mode=0 → 若取 3xx 会破契约。解法=件号取 ②段空位 **223**(2xx 未被占用的下一位),
  不动契约断言(键图:①=4..147/②=202..223/③=300+)。

幂等:已插则校验出厂口径与让位量,不符报红;锚点拓扑不符则报错不动件。
用法: python3 xiaohei_absorb_e2_chunkffn_splice_1106.py [--check]
"""
from __future__ import annotations

import json
import pathlib
import sys

REPO = pathlib.Path(__file__).resolve().parents[3]  # scripts/ → build/ → apps/ → 仓库根
WF = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/0_单镜视频/pika-单镜视频-三段链.json"

UP_ID, DOWN_ID = 202, 203
NEW_ID, NEW_LINK = 223, 755
NEW_TYPE = "MiniMaxChunkFeedForward"
NEW_TITLE = "H3 Chunk FFN(削峰·出厂 chunks=1 恒等)"
NEW_POS = [6543, 80]
NEW_SIZE = [300, 90]
WIDGETS = [1, 4096]  # chunks=1 恒等旁路 / seq_threshold 出厂默认
VER = "ab72eda7ffad6280422d71ab7d54d3fb87c0ba18"  # Win 产线引擎 comfyui-kjnodes HEAD(1106 实探)

TAIL_X_MIN = 6563
SHIFT = 600
GROUP_TITLE_PREFIX = "二采放大"

# 让位集:新件下游、同受 x 挤压的二采主线件(显式件号,1106 实测唯一不破棘轮的组合)。
# x 不动的 [205][206][208](与新件不同行,一 x+ 就外扩 205→206 / 205→207 / 208→210 三根
# 曲线,crossings 590→592 破棘轮);[207] 只做 y 微调。
TAIL_IDS = [203, 215, 210, 211, 212, 214, 4, 100, 213]
# 让位后仍需的微调:[207] 与新件列距 60<80(est 违规),向下 25 px 让开。
NUDGE = {207: (0, 25)}

# HEAD(=三段链 revision 1105 口径)实测位;改前用来验拓扑未漂,改后用来回检让位量。
HEAD_POS = {
    203: [6563, 80], 215: [7070, 80], 210: [7590, 80], 211: [8170, 80], 212: [8640, 80],
    214: [9110, 80], 4: [9600, 80], 100: [10103, 80], 213: [8640, 282], 207: [7070, 288],
}


def build_node(up_stream_link_id: int) -> dict:
    return {
        "id": NEW_ID,
        "type": NEW_TYPE,
        "pos": list(NEW_POS),
        "size": list(NEW_SIZE),
        "flags": {},
        "order": DOWN_ID,
        "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "link": up_stream_link_id}],
        "outputs": [{"name": "model", "type": "MODEL", "links": [NEW_LINK]}],
        "properties": {
            "Node name for S&R": NEW_TYPE,
            "ue_properties": {"widget_ue_connectable": {}, "input_ue_unconnectable": {}, "version": "7.8"},
            "cnr_id": "comfyui-kjnodes",
            "ver": VER,
        },
        "widgets_values": list(WIDGETS),
        "title": NEW_TITLE,
    }


def apply_shift(d: dict) -> tuple[int, int]:
    """下游让位 + [207] 微调 + 组框同步加宽;返回 (被移件数, 被微调件数)。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    for nid in list(TAIL_IDS) + list(NUDGE):
        if nid not in nodes:
            raise SystemExit(f"FAIL 让位件 [{nid}] 不在件表,拓扑已漂移,停手待对账")
        if nodes[nid]["pos"] != HEAD_POS[nid]:
            raise SystemExit(f"FAIL [{nid}] pos={nodes[nid]['pos']} 非 HEAD 口径 {HEAD_POS[nid]},"
                             f"布局已被他人改动,停手待对账")
    moved = 0
    for nid in TAIL_IDS:
        nodes[nid]["pos"][0] += SHIFT
        moved += 1
    nudged = 0
    for nid, (dx, dy) in NUDGE.items():
        nodes[nid]["pos"][0] += dx
        nodes[nid]["pos"][1] += dy
        nudged += 1
    for g in d.get("groups", []):
        if g["title"].startswith(GROUP_TITLE_PREFIX):
            g["bounding"][2] += SHIFT
    return moved, nudged


def main() -> int:
    check_only = "--check" in sys.argv
    d = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in d["nodes"]}
    links = {l[0]: l for l in d["links"]}

    if NEW_ID in nodes:
        n = nodes[NEW_ID]
        want = {nid: [HEAD_POS[nid][0] + SHIFT, HEAD_POS[nid][1]] for nid in TAIL_IDS}
        for nid, (dx, dy) in NUDGE.items():
            want[nid] = [HEAD_POS[nid][0] + dx, HEAD_POS[nid][1] + dy]
        off = {nid: nodes[nid]["pos"] for nid in want if nodes[nid]["pos"] != want[nid]}
        ok = (
            n["type"] == NEW_TYPE
            and n["size"] == NEW_SIZE
            and n["widgets_values"] == WIDGETS
            and n["pos"] == NEW_POS
            and [i["name"] for i in n["inputs"]] == ["model"]
            and not off
        )
        print(f"SKIP 已落位: [{NEW_ID}] {NEW_TYPE} size={n['size']} widgets={n['widgets_values']} pos={n['pos']} "
              f"| 让位 {len(TAIL_IDS)} 件 +{SHIFT},微调 {list(NUDGE)}")
        if off:
            print(f"⚠️ 让位量不符(实测≠脚本口径):{off}")
        if not ok:
            print("⚠️ 与出厂口径/让位量不符——产物≠脚本口径,按语义铁律只报红不覆写,请人工对账")
        return 0 if ok else 1

    up, down = nodes[UP_ID], nodes[DOWN_ID]
    if [i["name"] for i in down["inputs"]] != ["model"]:
        print(f"FAIL [{DOWN_ID}] 预期只有 model 口,实际 {down['inputs']}")
        return 1
    if down["pos"][0] != TAIL_X_MIN:
        print(f"FAIL [{DOWN_ID}] x0={down['pos'][0]} 非让位前口径 {TAIL_X_MIN},拓扑/布局已漂移,停手待对账")
        return 1
    out_links = up["outputs"][0].get("links") or []
    if len(out_links) != 1:
        print(f"FAIL [{UP_ID}].MODEL 扇出 {len(out_links)} 条,预期 1 条(改本脚本前先核 C2)")
        return 1
    lid = out_links[0]
    if links[lid][1:4] != [UP_ID, 0, DOWN_ID]:
        print(f"FAIL 链 {lid} 不是 {UP_ID}→{DOWN_ID}:{links[lid]}")
        return 1

    if check_only:
        print(f"READY 链 {lid} 可切;让位 {len(TAIL_IDS)} 件 x+{SHIFT}(HEAD 位已核),"
              f"微调 {list(NUDGE)},组框「{GROUP_TITLE_PREFIX}」宽 +{SHIFT},"
              f"新件 [{NEW_ID}] @ {NEW_POS} size {NEW_SIZE}")
        return 0

    moved, nudged = apply_shift(d)
    links[lid][3] = NEW_ID  # 上游改指新件
    d["links"].append([NEW_LINK, NEW_ID, 0, DOWN_ID, 0, "MODEL"])
    down["inputs"][0]["link"] = NEW_LINK
    d["nodes"].append(build_node(lid))  # 既有件表非 id 序(1106 实测),只追加不重排
    d["last_node_id"] = max(d["last_node_id"] or 0, NEW_ID)
    d["last_link_id"] = max(d["last_link_id"] or 0, NEW_LINK)

    # 序列化口径与该件真源逐字节一致:ensure_ascii=False + indent=2 + 无尾换行(1106 实测回填)
    WF.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"OK 插入 [{NEW_ID}] {NEW_TYPE} chunks={WIDGETS[0]}(恒等) seq_threshold={WIDGETS[1]} @ {NEW_POS}")
    print(f"   让位 {moved} 件 x+{SHIFT}px,微调 {nudged} 件 {NUDGE},二采组框同宽 +{SHIFT}px")
    print(f"   链:{lid} {UP_ID}→{NEW_ID} | {NEW_LINK} {NEW_ID}→{DOWN_ID}")
    print(f"   节点数 {len(nodes)}→{len(d['nodes'])},链数 {len(links)}→{len(d['links'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
