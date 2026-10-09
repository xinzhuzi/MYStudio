#!/usr/bin/env python3
"""i2i/edit 装配子图蓝图抽取(2026-10-01,Trellis 10-01-qi21-i2i-edit-isomorphic R3)。

打法照 t2i 蓝图构造先例(archive 10-01-qi21-assembly-blueprint S4:
「从 definitions.subgraphs[0] 提取,按 publishSubgraph 形态构造 v0.4 单节点根图
JSON,落 my_nodes/subgraphs/;info.category 归漫影」):

  源   = 术后 qi21-道劫-i2i.json / qi21-edit.json 的「[40] 提示词类型优化子图」定义
  蓝图 = v0.4 单节点根图:根节点=宿主[40]投影(id=1/pos=[0,0]/order=0,inputs/
         outputs/widgets_values/title 照抄宿主,widgets_values_named 不随行=t2i
         先例形态);definitions.subgraphs[0]=宿主定义逐字深拷贝(id 一并保留=
         t2i 抽取时先例:蓝图与宿主同 id 起步,S5 换宿主实例 uuid 后两轨分岔,
         同步脚本幂等比较除 id 归一正是为此在档);
  info = {"category": "漫影", "name": "[40] 提示词类型优化子图(i2i|edit)"}
         (引擎侧栏展示名=文件名杆 subgraph_manager._create_entry 实码,info.name
          仅为文件自述;category 漫影=任务令)。

断言(fail-closed,不过不落盘):
  A. 宿主同名定义恰 1 份、宿主节点(properties.subgraph=定义id)恰 1 件;
  B. 落盘后重读:定义(除id)canonical 与工作流侧逐字相等(抽取零损);
  C. 根节点 type/properties.subgraph == 定义 id(蓝图自引用);
  D. 幂等:重跑产出逐字节相同(抽取纯函数性);
  E. t2i 先例形态对拍:信封键序/根节点键序与 t2i 蓝图一致。

用法:
  python3 qi21_blueprint_extract_1001.py            # 抽取+断言落盘
  python3 qi21_blueprint_extract_1001.py --check    # 只验不断(文件已在则对拍)

铁律:禁手工编辑工作流 JSON(本脚本只读工作流,只写两个新蓝图件);
回滚=删两个新蓝图件,零残留。
"""

# ⛔ 退役警示(2026-10-02 大轮 qi21_biground_surgery_1002.py 落地):
# 本脚本手术对象已被 1002 大轮终态取代,重跑会把工作流打回旧态——封存勿运行。
import sys as _sys  # noqa: E402
print("⛔ 已退役(1002 大轮终态在库):本脚本会打回 10-02 手术,拒绝执行。")
_sys.exit(3)

import argparse
import copy
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
SUBGRAPHS = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像"
SG_NAME_PREFIX = "[40] 提示词类型优化子图"   # R2 同名统一口径(三件一致)

# 目标表(单点串行;i2i/edit 随 1001 同构批入列,与 qi21_blueprint_sync_1001.py 同源)
TARGETS = {
    "i2i": {"wf": WF_DIR / "2_图生图" / "qi21-道劫-i2i.json",
            "blueprint": SUBGRAPHS / "qi21-提示词类型优化子图-i2i.json"},
    "edit": {"wf": WF_DIR / "2_图生图" / "qi21-edit.json",
             "blueprint": SUBGRAPHS / "qi21-提示词类型优化子图-edit.json"},
}
T2I_BLUEPRINT = SUBGRAPHS / "qi21-提示词类型优化子图.json"   # 形态对拍真源(只读)


def canon(o):
    return json.dumps(o, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha16(s):
    return hashlib.sha256(s.encode()).hexdigest()[:16]


def norm_id(sg):
    return {k: v for k, v in sg.items() if k != "id"}


def extract(tag):
    """从术后工作流抽装配子图定义 → v0.4 单节点根图蓝图对象。"""
    wf_path, bp_path = TARGETS[tag]["wf"], TARGETS[tag]["blueprint"]
    d = json.loads(wf_path.read_text(encoding="utf-8"))

    # A. 定位:同名定义恰 1,宿主节点恰 1
    defs = d["definitions"]["subgraphs"]
    hits = [i for i, s in enumerate(defs) if s.get("name", "").startswith(SG_NAME_PREFIX)]
    assert len(hits) == 1, f"[{tag}] 同名子图定义命中 {len(hits)} 份(预期 1)"
    sg_def = defs[hits[0]]
    hosts = [n for n in d["nodes"] if n.get("properties", {}).get("subgraph") == sg_def["id"]]
    assert len(hosts) == 1, f"[{tag}] 宿主节点命中 {len(hosts)} 件(预期 1)"
    host = hosts[0]
    assert host["type"] == sg_def["id"], f"[{tag}] 宿主 type 与定义 id 不符"

    # 根节点=宿主投影(t2i 先例键序;pos 归零/order 归零/id 归 1;
    # inputs/outputs/size/widgets_values/title 照抄;widgets_values_named 不随行)
    root = {
        "id": 1,
        "type": sg_def["id"],
        "pos": [0, 0],
        "size": host.get("size", [560, 480]),
        "flags": {},
        "order": 0,
        "mode": 0,
        "inputs": copy.deepcopy(host.get("inputs", [])),
        "outputs": copy.deepcopy(host.get("outputs", [])),
        "properties": {"subgraph": sg_def["id"], "previewExposures": []},
        "widgets_values": copy.deepcopy(host.get("widgets_values", [])),
        "title": host.get("title", SG_NAME_PREFIX),
    }
    # 定义逐字深拷贝(id 保留=t2i 抽取先例;后续演进走同步脚本除 id 归一)
    bp = {
        "revision": 1,
        "last_node_id": 1,
        "last_link_id": 0,
        "nodes": [root],
        "links": [],
        "version": 0.4,
        "definitions": {"subgraphs": [copy.deepcopy(sg_def)]},
        "info": {"category": "漫影",
                 "name": f"[40] 提示词类型优化子图({tag})"},
    }
    return wf_path, bp_path, sg_def, bp


def conform_t2i(bp):
    """E. t2i 先例形态对拍:信封键序与根节点键序一致(值不比,只比形态)。"""
    t2i = json.loads(T2I_BLUEPRINT.read_text(encoding="utf-8"))
    assert list(bp.keys()) == list(t2i.keys()), \
        f"信封键序与 t2i 蓝图不符: {list(bp.keys())} != {list(t2i.keys())}"
    assert list(bp["nodes"][0].keys()) == list(t2i["nodes"][0].keys()), \
        f"根节点键序与 t2i 蓝图不符: {list(bp['nodes'][0].keys())}"
    assert bp["info"].keys() == t2i["info"].keys(), "info 键集与 t2i 蓝图不符"
    assert isinstance(bp["definitions"]["subgraphs"], list) and len(bp["definitions"]["subgraphs"]) == 1


def verify(tag, wf_path, bp_path, sg_def, bp):
    """B/C 断言:对已落盘蓝图与工作流真源对拍(独立函数,幂等复跑用)。"""
    on_disk = json.loads(bp_path.read_text(encoding="utf-8"))
    # B. 定义(除id)逐字相等
    assert canon(norm_id(on_disk["definitions"]["subgraphs"][0])) == canon(norm_id(sg_def)), \
        f"[{tag}] 蓝图定义与工作流侧不逐字(除id)"
    # C. 蓝图自引用
    d0 = on_disk["definitions"]["subgraphs"][0]
    assert on_disk["nodes"][0]["type"] == d0["id"] == on_disk["nodes"][0]["properties"]["subgraph"], \
        f"[{tag}] 蓝图根节点自引用断裂"
    assert canon(on_disk["nodes"][0]) == canon(bp["nodes"][0]), f"[{tag}] 根节点与构造态不符"
    return sha16(canon(norm_id(d0)))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只验不断(文件已在则对拍)")
    a = ap.parse_args()

    for tag in TARGETS:
        wf_path, bp_path, sg_def, bp = extract(tag)
        conform_t2i(bp)
        n_nodes = len(sg_def["nodes"])
        if bp_path.exists():
            s = verify(tag, wf_path, bp_path, sg_def, bp)
            print(f"[{tag}] 蓝图已在且对拍过(定义除id逐字相等,sha16={s};{n_nodes}节点)"
                  f"{'--check 零写入' if a.check else '幂等零写入'}")
            continue
        if a.check:
            print(f"[{tag}] 蓝图缺席(--check 不落盘): {bp_path.name}")
            sys.exit(2)
        bp_path.write_text(json.dumps(bp, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        s = verify(tag, wf_path, bp_path, sg_def, bp)
        # D. 幂等:重抽再比逐字节
        again = json.dumps(extract(tag)[3], ensure_ascii=False, indent=2) + "\n"
        assert again == bp_path.read_text(encoding="utf-8"), f"[{tag}] 重抽不逐字节(非纯函数)"
        print(f"[{tag}] 蓝图落盘 {bp_path.name}(定义id={sg_def['id'][:8]}… "
              f"{n_nodes}节点/入{len(sg_def['inputs'])}/出{len(sg_def['outputs'])},除id逐字 sha16={s})")
    print("done")


if __name__ == "__main__":
    main()
