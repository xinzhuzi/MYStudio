# -*- coding: utf-8 -*-
"""1126 qi21-edit 提速手术 v2(六件套役 11-26-local-inpaint-campaign R5)。

四发实弹定谳(192.168.0.101:17000 漫影引擎,2026-11-26):
  V1 原样 155.5s → V2 剔 PE 150.5s(Δ5s)→ V3 +空潜动态尺寸 71.0s
  → V4 +VAE main_device/bf16 25.1s(cpu/fp32 是最大单头,−46s)。

手术内容(全部实弹验证过的三层 + 布局紧凑化):
  1. 装配子图剔 PE 死支路:节点{21,23,24,25,27,4012,4013,4019}+线
     {7,9,10,12,13,14,15,16,17,18,19,200}+IO 槽「PE启用?」+子图内「PE-I2I
     改写组」组框;幸存件悬空槽清零;宿主 inputs/widgets 收口单控件。
     (仓库画布引用的 bf16 PE TE 在 Win 盘不存在,该支路本就无法实弹。)
  2. 潜源默认空潜:新增 [54] GetImageSize(吃主图缩放 [16]),宽高接 [4]
     EmptyLatentImage;[19] 默认 True。输出画幅随主图,4015 双图编码在
     PrunaAI 档下整支 lazy 跳过。([30] 是三域退役禁号,勿用。)
  3. [3] VAELoaderKJ:cpu/fp32 → main_device/bf16。
  4. 布局紧凑化(W6① pos≥80/置顶卡/加速框罩 {7,20,29}/零重叠/组框零相交,
     全按 TestI2IEditHostLayout1003+TestCanvasNormalization0925 哨兵约束),
     组框去「道劫·」前缀(自由型件,1126 用户令);说明注记=旧文全文保留+
     追加 1126 提速段。

用法:python3 qi21_edit_accel_fix_1126.py [--dry-run]
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qi21-edit.json"

ASG_ID = "6a0e2f81-1a4b-4c2d-9e30-5b7c8d9e0f01"          # 文本提示词类型优化子图
PE_NODES = {21, 23, 24, 25, 27, 4012, 4013, 4019}
PE_LINKS = {7, 9, 10, 12, 13, 14, 15, 16, 17, 18, 19, 200}
ASG_KEPT = {4014, 4015, 4016}
NEW_GID = 54                                             # [30]=三域退役禁号

NOTE_APPEND = """

---

## 1126 提速手术(四发实弹:155.5s → 25.1s,同一台 Win 引擎)

- **剔 PE 死支路**:9B 文本增强链(TextGenerate+PE 专属 TE)整段退役——子图封装
  形态下 lazy 旁路失效,面板 pe开关=false 也每发装载 9B;画布本就恒关,退役零语义
  损失,顺带根除「bf16 PE TE 在 Win 盘不存在」的陈旧引用。实测 Δ=5s。
- **潜源默认空潜**([19] 开关,true=快档):[54] GetImageSize 让空潜尺寸随主图,
  输出画幅不再锁 1024²;双参考编码 [4015] 在 PrunaAI 档下整支 lazy 跳过(省一次
  双图视觉编码)。实测 −80s。切 false=编码潜慢档(原生 40 步臂语义不变)。
- **VAE 上 GPU**:[3] cpu/fp32 → main_device/bf16(34s 对照发证明可行)。
  实测 −46s/发,三层里最大单头。
- 加速档默认「4 · PrunaAI 6步」(1108 令)不变;布局四组一屏,组框去「道劫·」
  前缀(自由型件,命名一致性令 1120)。
"""


def _require(cond, msg):
    if not cond:
        raise SystemExit(f"[qi21_edit_accel_fix_1126] {msg}")


def by_id(nodes, nid):
    return next(n for n in nodes if n["id"] == nid)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    doc = json.loads(WF.read_text(encoding="utf-8"))
    nodes = doc["nodes"]
    links = doc["links"]

    # ── 0. 前置断言(手术只认预期形态)──────────────────────────────────
    ids = {n["id"] for n in nodes}
    _require(ids == {1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 19, 20, 28, 29, 400, 402},
             f"主图节点集漂移:{sorted(ids)}")
    _require(NEW_GID not in ids, f"[{NEW_GID}] 已被占用,脚本需改号")
    sg = next(s for s in doc["definitions"]["subgraphs"] if s["id"] == ASG_ID)
    sg_ids = {n["id"] for n in sg["nodes"]}
    _require(sg_ids in (ASG_KEPT | PE_NODES, ASG_KEPT),
             f"装配子图成员漂移:{sorted(sg_ids)}")

    # ── 1. 子图剔 PE 死支路(幂等:已剔则跳过)─────────────────────────
    if sg_ids != ASG_KEPT:
        sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in PE_NODES]
        sg["links"] = [l for l in sg["links"] if l["id"] not in PE_LINKS]
        kept_links = {l["id"] for l in sg["links"]}
        for n in sg["nodes"]:
            for slot in n.get("inputs", []):
                if slot.get("link") is not None and slot["link"] not in kept_links:
                    slot["link"] = None
        # IO 槽「PE启用?」退役(inputs 末位)
        names = [io["name"] for io in sg["inputs"]]
        _require(names[-1] == "PE启用?", f"IO 末槽应=PE启用?,实得 {names}")
        sg["inputs"].pop()
        for io in sg["inputs"]:
            io["linkIds"] = [l for l in io.get("linkIds", []) if l in kept_links]
        # 子图内「PE-I2I 改写组」组框退役(罩的全是已删件)
        sg["groups"] = [g for g in sg.get("groups", [])
                        if "PE-I2I 改写组" not in g.get("title", "")]
        # 宿主收口
        host6 = by_id(nodes, 6)
        _require(host6["type"] == ASG_ID, "宿主 6 类型漂移")
        host6["inputs"] = [i for i in host6["inputs"] if i["name"] != "PE启用?"]
        host6["widgets_values"] = host6["widgets_values"][:1]
        host6.get("widgets_values_named", {}).pop("PE启用?", None)
        sel = by_id(sg["nodes"], 4014)
        pe_sw = next((s for s in sel.get("inputs", []) if s["name"] == "pe开关"), None)
        _require(pe_sw is not None and pe_sw.get("link") is None,
                 "4014.pe开关 应已断线(widget False 兜底)")

    # ── 2. 潜源默认空潜 + GetImageSize[54] ────────────────────────────
    bool19 = by_id(nodes, 19)
    _require(bool19["type"] == "PrimitiveBoolean", "[19] 类型漂移")
    bool19["widgets_values"] = [True]
    bool19["title"] = "[19] 潜源开关·空潜快档默认"
    empty4 = by_id(nodes, 4)
    _require(empty4["type"] == "EmptyLatentImage", "[4] 类型漂移")
    resize16 = by_id(nodes, 16)
    _require(resize16["type"] == "ImageScaleToTotalPixels", "[16] 类型漂移")
    if NEW_GID not in ids:
        nodes.append({"id": NEW_GID, "type": "GetImageSize", "flags": {}, "order": 0,
                      "mode": 0,
                      "inputs": [{"name": "image", "type": "IMAGE", "link": None}],
                      "outputs": [{"name": "width", "type": "INT", "slot_index": 0, "links": []},
                                  {"name": "height", "type": "INT", "slot_index": 1, "links": []}],
                      "title": f"[{NEW_GID}] 画幅尺寸·GetImageSize",
                      "properties": {"Node name for S&R": "GetImageSize"},
                      "widgets_values": None})
        ids.add(NEW_GID)
        doc["last_node_id"] = max(doc.get("last_node_id", 0), NEW_GID)
    gid = by_id(nodes, NEW_GID)

    def wired(src, sslot, dst) -> bool:
        return any(l[1] == src and l[2] == sslot and l[3] == dst for l in links)

    def wire(src, sslot, dst, dst_name, ltype):
        dn = by_id(nodes, dst)
        slot = next((k for k, x in enumerate(dn.get("inputs", [])) if x["name"] == dst_name), None)
        if slot is None:
            dn.setdefault("inputs", []).append(
                {"name": dst_name, "type": ltype, "link": None,
                 "widget": {"name": dst_name}})
            slot = len(dn["inputs"]) - 1
        entry = dn["inputs"][slot]
        _require(entry.get("link") is None, f"[{dst}].{dst_name} 已接线")
        lid = max(l[0] for l in links) + 1
        links.append([lid, src, sslot, dst, slot, ltype])
        entry["link"] = lid
        out_slot = by_id(nodes, src)["outputs"][sslot]
        out_slot["links"] = (out_slot.get("links") or []) + [lid]

    if not wired(16, 0, NEW_GID):
        wire(16, 0, NEW_GID, "image", "IMAGE")
    if not wired(NEW_GID, 0, 4):
        wire(NEW_GID, 0, 4, "width", "INT")
    if not wired(NEW_GID, 1, 4):
        wire(NEW_GID, 1, 4, "height", "INT")
    sw = by_id(nodes, 20)
    names = [s["name"] for s in sw["inputs"]]
    _require(names == ["on_false", "on_true", "switch"], f"[20] 槽序漂移:{names}")

    # ── 3. VAE 上 GPU ────────────────────────────────────────────────
    vae = by_id(nodes, 3)
    named = vae.get("widgets_values_named") or {}
    if named:
        named["device"] = "main_device"
        named["weight_dtype"] = "bf16"
        vae["widgets_values"] = list(named.values())
    else:
        vae["widgets_values"] = [vae["widgets_values"][0], "main_device", "bf16"]

    # ── 4. 布局紧凑化(W6①≥80/置顶卡/加速框罩{7,20,29}/零重叠/组框零相交;
    #      同列竖喂线={10→16,11→17,400→6}=TestCanvasDiscipline 豁免集锚)────
    layout = {
        402: ([80, 120], [620, 420]),
        1: ([80, 700], [300, 84]), 2: ([80, 830], [300, 130]), 3: ([80, 1000], [300, 130]),
        9: ([430, 700], [320, 120]),
        10: ([810, 700], [300, 400]), 16: ([810, 1140], [300, 140]),
        11: ([1150, 700], [300, 400]), 17: ([1150, 1140], [300, 140]),
        19: ([810, 1320], [280, 90]), NEW_GID: ([1150, 1320], [300, 110]),
        400: ([1510, 700], [340, 180]), 6: ([1510, 920], [400, 260]),
        4: ([2060, 700], [300, 130]), 20: ([2410, 700], [280, 110]),
        7: ([2740, 700], [420, 340]),
        28: ([2740, 1080], [75, 26]), 29: ([2840, 1080], [75, 26]),
        5: ([2960, 1080], [240, 50]), 8: ([3230, 700], [380, 330]),
    }
    for nid, (pos, size) in layout.items():
        n = by_id(nodes, nid)
        n["pos"], n["size"] = list(pos), list(size)
    old_note = by_id(nodes, 402)["widgets_values"][0]
    if "1126 提速手术" not in old_note:
        by_id(nodes, 402)["widgets_values"] = [old_note + NOTE_APPEND]
    doc["groups"] = [
        {"id": 1, "title": "qi21·① 加载器", "bounding": [40, 600, 380, 580],
         "color": "#3f789e", "flags": {}},
        {"id": 2, "title": "qi21·② 图像·输入(主图+参考图)", "bounding": [780, 600, 690, 870],
         "color": "#88A", "flags": {}},
        {"id": 3, "title": "qi21·③ 指令·潜源(空潜快档)", "bounding": [1490, 600, 460, 620],
         "color": "#a33", "flags": {}},
        {"id": 4, "title": "qi21·④ 加速·输出", "bounding": [2040, 600, 1620, 980],
         "color": "#4a7", "flags": {}},
    ]

    # ── 5. 出口校验 ──────────────────────────────────────────────────
    def validate(d):
        json.loads(json.dumps(d))
        lids = {l[0] for l in d["links"]}
        for n in d["nodes"]:
            for s in n.get("inputs", []):
                lk = s.get("link")
                _require(lk is None or lk in lids, f"[{n['id']}].{s['name']} 悬空线 {lk}")
            _require(n["pos"][0] >= 80 and n["pos"][1] >= 80,
                     f"[{n['id']}] 违反 W6① pos≥80:{n['pos']}")
        boxes = [g["bounding"] for g in d["groups"]]
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                _require(a[0] + a[2] <= b[0] or b[0] + b[2] <= a[0]
                         or a[1] + a[3] <= b[1] or b[1] + b[3] <= a[1],
                         f"组框 {i} 与 {j} 重叠")
        ns = d["nodes"]
        for i in range(len(ns)):
            for j in range(i + 1, len(ns)):
                a, b = ns[i], ns[j]
                _require(not (a["pos"][0] < b["pos"][0] + b["size"][0]
                              and b["pos"][0] < a["pos"][0] + a["size"][0]
                              and a["pos"][1] < b["pos"][1] + b["size"][1]
                              and b["pos"][1] < a["pos"][1] + a["size"][1]),
                         f"[{a['id']}] 与 [{b['id']}] 矩形重叠")
        # 加速框罩 {7,20,29}
        accel = next(g for g in d["groups"] if g["title"].startswith("qi21·④ 加速"))
        gx0, gy0 = accel["bounding"][0], accel["bounding"][1]
        gx1, gy1 = gx0 + accel["bounding"][2], gy0 + accel["bounding"][3]
        for nid in (7, 20, 29):
            n = by_id(d["nodes"], nid)
            _require(gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                     and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1,
                     f"加速框未罩 [{nid}]")

    validate(doc)
    if not args.dry_run:
        WF.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print(f"OK 已写 {WF}")
    print(f"OK 手术完成:子图成员={sorted(n['id'] for n in sg['nodes'])},"
          f"主图 {len(doc['nodes'])} 件,线 {len(doc['links'])} 条")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
