# -*- coding: utf-8 -*-
"""1126 qi21-局部重绘 构建器(无风格版局部重绘,役 11-26-local-inpaint-campaign R3)。

基座=手术后 qi21-edit.json(同日 qi21_edit_accel_fix_1126.py 产物:PE 链退役/
空潜动态画幅/VAE 上 GPU/紧凑布局)。差异三件:
  1. 掩膜支路(MaskEditor 手绘):LoadImage[10].MASK → GrowMaskWithBlur[60]
     (expand12/blur8 软缝)→ SetLatentNoiseMask[61](只重绘掩膜区)→ 采样;
     解码后 ImageCompositeMasked[62](destination=[16] 缩放后原图/source=[5]
     解码结果)掩膜外像素零损回贴。掩膜尺寸语义=comfy composite()/采样器
     prepare_mask 双侧 bilinear 自动对齐,零缩放节点(nodes_mask.py:29 实读)。
  2. 去风格:加速子图内 mikkoani[7034]/High quality[7100] 两风格 LoRA 拆除,
     底模直喂各臂(speed/fix 类 LoRA 全保留=detail-fix/turbo/viggle/p_q 非风格)。
  3. SaveImage 前缀 QI21局部重绘_;加速子图更名「加速子图」(自由型件)。

用法:python3 qi21_local_inpaint_build_1126.py [--dry-run]
幂等:重跑恒同(确定性变换)。
"""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json"
OUT = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-局部重绘.json"

XSG_UUID = "7b1f3a92-2b5c-4d3e-8f41-6c8d9e0f1a02"        # 加速子图
STYLE_NODES = {7100, 7034}                               # High quality / mikkoani
MASK_NODES_META = {
    60: ("GrowMaskWithBlur", "掩膜柔化·GrowMaskWithBlur",
         [12, 0.0, True, False, 8.0, 1.0, 1.0, False],
         {"expand": 12, "incremental_expandrate": 0.0, "tapered_corners": True,
          "flip_input": False, "blur_radius": 8.0, "lerp_alpha": 1.0,
          "decay_factor": 1.0, "fill_holes": False}),
    61: ("SetLatentNoiseMask", "掩膜限噪·SetLatentNoiseMask", None, None),
    62: ("ImageCompositeMasked", "掩膜回贴·ImageCompositeMasked",
         [0, 0, False], {"x": 0, "y": 0, "resize_source": False}),
}
NOTE_APPEND = """

---

## 局部重绘用法(1126 役,无风格版)

- **主图 [10] 右键 →「Open in MaskEditor」涂抹要重绘的区域**;[60] expand12/blur8
  软化掩膜边缘(防硬缝);掩膜外像素经 [62] 逐位回贴,不参与重绘。
- 指令只写「改什么」(肯定式,单图自然指称);风格不锁定——mikkoani/High quality
  两风格 LoRA 已拆,仅留 speed/fix 类加速 LoRA(p_q 六步/detail-fix/turbo/viggle)。
- 提速三件套同 qi21-edit(1126 实弹 155.5s→25.1s):空潜快档+VAE GPU+零 PE。
"""


def _require(cond, msg):
    if not cond:
        raise SystemExit(f"[qi21_local_inpaint_build_1126] {msg}")


def by_id(nodes, nid):
    return next(n for n in nodes if n["id"] == nid)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    doc = copy.deepcopy(json.loads(BASE.read_text(encoding="utf-8")))
    nodes, links = doc["nodes"], doc["links"]
    ids = {n["id"] for n in nodes}
    _require(60 not in ids and 61 not in ids and 62 not in ids, "60/61/62 号被占")
    save = by_id(nodes, 8)
    _require(save["type"] == "SaveImage", "[8] 类型漂移")

    # ── 1. 掩膜支路三件 ──────────────────────────────────────────────
    slot_wv = {"60": None, "61": None, "62": [0, 0, False]}
    for nid, (ntype, title, wv, named) in MASK_NODES_META.items():
        node = {"id": nid, "type": ntype, "flags": {}, "order": 0, "mode": 0,
                "inputs": [], "outputs": [],
                "title": title, "properties": {"Node name for S&R": ntype}}
        if wv is not None:
            node["widgets_values"] = list(wv)
        if named is not None:
            node["widgets_values_named"] = dict(named)
        nodes.append(node)
        ids.add(nid)
    doc["last_node_id"] = max(doc.get("last_node_id", 0), 62)

    def wire(src, sslot, dst, dst_name, ltype):
        dn = by_id(nodes, dst)
        slot = next((k for k, x in enumerate(dn.get("inputs", [])) if x["name"] == dst_name), None)
        if slot is None:
            dn.setdefault("inputs", []).append({"name": dst_name, "type": ltype, "link": None})
            slot = len(dn["inputs"]) - 1
        entry = dn["inputs"][slot]
        _require(entry.get("link") is None, f"[{dst}].{dst_name} 已接线")
        lid = max(l[0] for l in links) + 1
        links.append([lid, src, sslot, dst, slot, ltype])
        entry["link"] = lid
        out_slot = by_id(nodes, src)["outputs"][sslot]
        out_slot["links"] = (out_slot.get("links") or []) + [lid]

    # GrowMaskWithBlur 槽面(照换脸先例件形态)
    g60 = by_id(nodes, 60)
    g60["inputs"] = [{"name": "mask", "type": "MASK", "link": None}]
    g60["outputs"] = [{"name": "mask", "type": "MASK", "slot_index": 0, "links": []}]
    s61 = by_id(nodes, 61)
    s61["inputs"] = [{"name": "samples", "type": "LATENT", "link": None},
                     {"name": "mask", "type": "MASK", "link": None}]
    s61["outputs"] = [{"name": "LATENT", "type": "LATENT", "slot_index": 0, "links": []}]
    c62 = by_id(nodes, 62)
    c62["inputs"] = [{"name": "destination", "type": "IMAGE", "link": None},
                     {"name": "source", "type": "IMAGE", "link": None},
                     {"name": "x", "type": "INT", "link": None},
                     {"name": "y", "type": "INT", "link": None},
                     {"name": "resize_source", "type": "BOOLEAN", "link": None},
                     {"name": "mask", "type": "MASK", "link": None}]
    c62["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "slot_index": 0, "links": []}]

    wire(10, 1, 60, "mask", "MASK")            # LoadImage.MASK(手绘掩膜)
    wire(20, 0, 61, "samples", "LATENT")       # 潜源开关出 → 限噪
    wire(60, 0, 61, "mask", "MASK")
    wire(16, 0, 62, "destination", "IMAGE")    # 缩放后原图=回贴底
    wire(5, 0, 62, "source", "IMAGE")          # 解码结果
    wire(60, 0, 62, "mask", "MASK")
    # 解码→保存改道:5→62→8;并断开旧 5→8 直连线
    old = next(l for l in links if l[1] == 5 and l[3] == 8)
    links.remove(old)
    d5 = by_id(nodes, 5)
    d5["outputs"][0]["links"] = [l for l in d5["outputs"][0]["links"] if l != old[0]]
    i8 = by_id(nodes, 8)
    dead = next(i for i in i8["inputs"] if i["name"] == "images")
    dead["link"] = None
    wire(62, 0, 8, "images", "IMAGE")
    # 掩膜限噪潜进加速宿主(替换 20→宿主.slot4 原线)
    old2 = next(l for l in links if l[1] == 20 and l[3] == 7)
    links.remove(old2)
    w20 = by_id(nodes, 20)
    src_slot = w20["outputs"][old2[2]]
    src_slot["links"] = [l for l in (src_slot.get("links") or []) if l != old2[0]]
    h7 = by_id(nodes, 7)
    dead = h7["inputs"][4]
    _require(dead["name"] == "latent", f"宿主 slot4 应=latent,得 {dead['name']}")
    dead["link"] = None
    h7["outputs"][0]["links"] = h7["outputs"][0].get("links") or []
    wire(61, 0, 7, "latent", "LATENT")

    # ── 2. 去风格:加速子图拆 mikkoani[7034]/High quality[7100],底模直喂 ──
    xsg = next(s for s in doc["definitions"]["subgraphs"] if s["id"] == XSG_UUID)
    x_ids = {n["id"] for n in xsg["nodes"]}
    _require(STYLE_NODES <= x_ids, f"加速子图缺风格件 {sorted(STYLE_NODES - x_ids)}")
    # model 边界槽号=IO 定义面按名取(勿从连线反推——首条 -10 线未必是 model)
    model_io = next(i for i, io in enumerate(xsg["inputs"]) if io["name"] == "model")
    _require(xsg["inputs"][model_io]["type"] == "MODEL", "model IO 槽类型漂移")
    rewired = 0
    for l in xsg["links"]:
        if l["origin_id"] in STYLE_NODES:
            l["origin_id"], l["origin_slot"] = -10, model_io
            rewired += 1
    _require(rewired >= 3, f"风格件下游改接数异常:{rewired}(应 ≥3)")
    xsg["nodes"] = [n for n in xsg["nodes"] if n["id"] not in STYLE_NODES]
    xsg["links"] = [l for l in xsg["links"] if l["origin_id"] not in STYLE_NODES
                    and l["target_id"] not in STYLE_NODES]
    xsg["inputs"][model_io]["linkIds"] = [
        link["id"] for link in xsg["links"]
        if link["origin_id"] == -10 and link["origin_slot"] == model_io
    ]
    xsg["name"] = "加速子图"

    # ── 3. 前缀/注记/布局 ────────────────────────────────────────────
    named = save.get("widgets_values_named") or {}
    if named:
        named["filename_prefix"] = "QI21局部重绘_"
        save["widgets_values"] = list(named.values())
    else:
        save["widgets_values"] = ["QI21局部重绘_"]
    note = by_id(nodes, 402)
    if "局部重绘用法" not in note["widgets_values"][0]:
        note["widgets_values"] = [note["widgets_values"][0] + NOTE_APPEND]
    for nid, pos, size in ((60, [2060, 900], [300, 140]), (61, [2410, 900], [280, 110]),
                           (62, [3040, 1160], [320, 240])):
        n = by_id(nodes, nid)
        n["pos"], n["size"] = list(pos), list(size)
    for g in doc["groups"]:
        if g["title"].startswith("qi21·④"):
            g["title"] = "qi21·④ 加速·输出·掩膜"
            g["bounding"] = [2040, 600, 1620, 1060]

    # ── 4. 出口校验 ──────────────────────────────────────────────────
    json.loads(json.dumps(doc))
    lids = {l[0] for l in links}
    for n in nodes:
        for s in n.get("inputs", []):
            lk = s.get("link")
            _require(lk is None or lk in lids, f"[{n['id']}].{s['name']} 悬空线")
        for s in n.get("outputs", []) or []:
            for lk in (s.get("links") or []):
                _require(lk in lids, f"[{n['id']}].{s.get('name')} 输出悬空线 {lk}")
        _require(n["pos"][0] >= 80 and n["pos"][1] >= 80, f"[{n['id']}] 违 W6①")
    for sg2 in doc["definitions"]["subgraphs"]:
        for l in sg2["links"]:
            if l["origin_id"] >= 0:
                _require(l["origin_id"] in {n["id"] for n in sg2["nodes"]},
                         f"子图线 {l['id']} 源节点不在册")

    if not args.dry_run:
        OUT.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"OK 已写 {OUT}")
    print(f"OK qi21-局部重绘 构建完成:主图 {len(nodes)} 件,线 {len(links)} 条,"
          f"去风格改线 {rewired} 处")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
