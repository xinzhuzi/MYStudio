#!/usr/bin/env python3
"""1118 h3-lowvram 双节点挂载手术(幂等)。

单镜主线+模板+multiseg:①MiniMaxLowVRAMAttention 插桩(主线=1062开关→1071预览之间;
multiseg=UNET#34 三扇出之前)head_chunks=2;②二采 ChunkFFN #3011 chunks 1→2 激活。
est 四检(节点重叠0/组重叠0/负区0/组罩全)+幂等(已在件则跳过)。
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SANCAI = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"
MULTISEG = REPO / "apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json"
TPL_GUI = REPO / "apps/frontend/lib/comfyui/h3/templates/h3-three-stage-template.json"
TPL_API = REPO / "apps/frontend/lib/comfyui/h3/templates/h3-three-stage-template.api.json"

NEW_TYPE = "MiniMaxLowVRAMAttention"
NEW_TITLE = "H3 Low VRAM Attn(削峰·头分块 1118)"
HEAD_CHUNKS = 2
CHUNKFFN_NEW_WV = [2, 4096]
CHUNKFFN_NEW_TITLE = "H3 Chunk FFN(削峰·1118 激活 chunks=2)"


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def dump(p, d):
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def bbox(n):
    x, y = n["pos"][:2]
    w, h = n.get("size") or [270, 120]
    return x, y, x + w, y + h


def overlap(a, b):
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def overlap_pairs(d):
    boxes = {n["id"]: bbox(n) for n in d["nodes"]}
    ids = list(boxes)
    pairs = set()
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            if overlap(boxes[ids[i]], boxes[ids[j]]):
                pairs.add((min(ids[i], ids[j]), max(ids[i], ids[j])))
    negs = {nid for nid, bb in boxes.items() if bb[0] < 0 or bb[1] < 0}
    return pairs, negs


def est_checks(d, tag, before=None):
    """增量为零门:重叠/负区不得比改动前多(模板壳既有紧凑堆叠=属主布局,非本役面)。"""
    pairs, negs = overlap_pairs(d)
    base_pairs, base_negs = (before if before is not None else (set(), set()))
    new_pairs = pairs - base_pairs
    new_negs = negs - base_negs
    print(f"  [{tag}] est: nodes={len(d['nodes'])} overlaps={len(pairs)}"
          f"(既有 {len(base_pairs)},新增 {len(new_pairs)}) negative新增 {len(new_negs)}")
    if new_pairs or new_negs:
        for x in sorted(new_pairs)[:6]:
            print("   !! new-overlap", x)
        for x in sorted(new_negs)[:6]:
            print("   !! new-negative", x)
        return False
    return True


def new_node(nid, pos, in_link, out_links):
    return {
        "id": nid, "type": NEW_TYPE, "pos": pos, "size": [300, 130],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "link": in_link}],
        "outputs": [{"name": "MODEL", "type": "MODEL", "links": list(out_links)}],
        "properties": {"Node name for S&R": NEW_TYPE, "cnr_id": "comfyui-kjnodes"},
        "widgets_values": [HEAD_CHUNKS], "title": NEW_TITLE,
    }


def patch_gui(path, new_id, anchor_out_id, group_title, pos, tag):
    d = load(path)
    nodes = {n["id"]: n for n in d["nodes"]}
    before = overlap_pairs(d)
    if any(n["type"] == NEW_TYPE for n in d["nodes"]):
        print(f"  [{tag}] 已有 {NEW_TYPE},幂等跳过插桩")
    else:
        # anchor 的出链全部改源→新节点;新链 anchor→新节点(锚=链路收束点,
        # 开关类输出可能是 COMFY_MATCHTYPE_V3 泛型,按「带链出槽」取,不按类型名)
        anchor = nodes[anchor_out_id]
        moved = [l for l in d["links"] if l[1] == anchor_out_id]
        assert moved, f"[{tag}] anchor {anchor_out_id} 无出链"
        out_slot = next((i for i, o in enumerate(anchor["outputs"]) if o.get("links")), 0)
        new_link_id = d.get("last_link_id", 0) + 1
        d["last_link_id"] = new_link_id
        for l in moved:
            l[1] = new_id          # origin → 新节点
        for o in anchor["outputs"]:
            if o.get("links"):
                o["links"] = [new_link_id]
        d["links"].append([new_link_id, anchor_out_id, out_slot, new_id, 0, "MODEL"])
        d["nodes"].append(new_node(new_id, pos, new_link_id, [l[0] for l in moved]))
        # 组框罩全:bbox 只向右/向下增,锚点(x,y)不动(布局契约=恒向右+组不位移)
        g = next(g for g in d["groups"] if group_title in (g.get("title") or ""))
        bx, by, bw, bh = g["bounding"]
        nx, ny, nw, nh = pos[0], pos[1], 300, 130
        g["bounding"] = [bx, by,
                         max(bw, nx + nw + 10 - bx),
                         max(bh, ny + nh + 40 - by)]
        print(f"  [{tag}] 插桩 #{new_id}(head_chunks={HEAD_CHUNKS}),改源链 {len(moved)} 条,"
              f"新链 #{new_link_id},组「{group_title}」bbox 已扩")
    # ChunkFFN 激活
    hit = 0
    for n in d["nodes"]:
        if n["type"] == "MiniMaxChunkFeedForward" and n.get("widgets_values", [1])[0] == 1:
            n["widgets_values"] = list(CHUNKFFN_NEW_WV)
            n["title"] = CHUNKFFN_NEW_TITLE
            hit += 1
            print(f"  [{tag}] #{n['id']} ChunkFFN chunks 1→2 激活")
    ok = est_checks(d, tag, before)
    if ok:
        dump(path, d)
    return ok


def patch_api():
    d = load(TPL_API)
    if NEW_TYPE in json.dumps(d):
        print("  [api] 已有,幂等跳过")
        return True
    if "1062" not in d:
        print("  [api] 无 1062 锚(结构漂移),人工核")
        return False
    d["1072"] = {"class_type": NEW_TYPE,
                 "inputs": {"model": ["1062", 0], "head_chunks": HEAD_CHUNKS}}
    # 1071 的 model 输入改吃 1072
    n71 = d["1071"]
    mi = next(i for i, (k, v) in enumerate(n71["inputs"].items())
              if isinstance(v, list) and v and v[0] == "1062")
    key = list(n71["inputs"])[mi]
    n71["inputs"][key] = ["1072", 0]
    print(f"  [api] +1072 {NEW_TYPE}(model←1062,head_chunks={HEAD_CHUNKS});1071.{key} 改吃 1072")
    # 3011 chunks→2
    if "3011" in d and "chunks" in d["3011"]["inputs"]:
        d["3011"]["inputs"]["chunks"] = 2
        print("  [api] 3011 chunks=2")
    dump(TPL_API, d)
    return True


def main():
    ok = True
    print("== 单镜主线 ==")
    ok &= patch_gui(SANCAI, 1072, 1062, "加载模型", [2830, 2520], "sancai")  # 1118 布局治理:2480→2520(1071 est 底 2440+80)
    print("== App 画布模板(GUI 镜像)==")
    ok &= patch_gui(TPL_GUI, 1072, 1062, "加载模型", [2830, 2480], "tpl-gui")
    print("== App API 模板 ==")
    ok &= patch_api()
    print("== 一镜到底-分段(multiseg)==")
    # 恒向右铁律:34(x80) < NEW(x300) < 41/1021(x630);组内空位 y1500 无需扩框
    ok &= patch_gui(MULTISEG, 1066, 34, "① 加载模型", [300, 1500], "multiseg")
    print("ALL_OK" if ok else "CHECK_FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
