#!/usr/bin/env python3
"""[90] 子图 v12:走线治理·右对齐版(09-21,接用户「为什么子图还是这样的布局」)。

v11 教训(实测):本前端槽位不随节点高度铺开,全部堆顶(~18px/槽),
「竖长条逐行对齐」不成立 → 撤 bus/竖长路由。

v12 设计(消病灶,结构不动:9 行仍并联真实链,Route 仍只选线):
  A. 行尾右对齐:每行最右件右缘统一 2600,短行留白在行内左侧
     → 九条行尾→路由线全部短距,根治 1800px 空跑长线(用户主诉);
  B. 行组框拉满宽(32..2640):矩阵成整齐网格,短行左留白=该型预留位;
  C. 路由紧凑件(300×260)置右缘上部(槽堆 ~y74..278 落行①②带):
     九条尾线成有序小刷形(最长=row⑨ 1350px 单斜,零交叉);
  D. -10 置左上:model 槽出有序扇到九行行首(留白区穿行);
     base 走顶部边距一根干线到路由顶槽,不穿任何节点箱;
  E. -20 置路由右侧。

用法:python3 apps/build/scripts/daojie_lora_stack_subgraph_v12_0921.py
"""
import json
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
STACK = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_lora_stack.json").read_text(encoding="utf-8"))
BASES = json.loads((REPO / "apps/backend/engines/comfyui/my_nodes/nodes/daojie_bases.json").read_text(encoding="utf-8"))
NAME = "LoRA栈·九型驱动"
ACTIVE = "人物"

NINE = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
CN = "①②③④⑤⑥⑦⑧⑨"
COL_GAP, ROW_GAP = 440, 190
START_Y = 40
ROUTE_ID = 1
TAIL_RIGHT = 2600        # 每行最右件右缘(右对齐基准)
GROUP_RIGHT = 2640       # 行组框右缘
W_LOADER = 340
ROUTE_X, ROUTE_Y = 2700, 40

C_FUNC, C_FACE, C_STYLE, C_MIST = "#335577", "#336633", "#663366", "#775533"
GROUP_C = {"功能件": C_FUNC, "面孔": C_FACE, "细节": C_FACE, "画风": C_STYLE, "水墨": C_MIST}


def main() -> None:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups, links = [], [], []
    nid, lid = 100, 1
    row_tails, row_heads = {}, {}

    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        base = next(e for e in BASES if e["zh"] == zh)
        ov = base.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{base['megapixels']}MP"
        aspect = base["aspect_ratio"].split(" (")[0]

        items = [(col, slot, slot["presets"][zh])
                 for col, slot in enumerate(STACK) if slot["presets"].get(zh, {}).get("on")]
        L = len(items)
        assert L >= 1, zh
        first = None
        for j, (col, slot, p) in enumerate(items):
            nid += 1
            # 右对齐:链序保持 STACK 序(左→右),最右件右缘 = TAIL_RIGHT
            x = TAIL_RIGHT - W_LOADER - (L - 1 - j) * COL_GAP
            nodes.append({
                "id": nid, "type": "LoraLoaderModelOnly",
                "pos": [x, y + 16], "size": [W_LOADER, 100],
                "flags": {}, "order": j + 1, "mode": 0,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": f"{slot['label']} ×{p['weight']:g}",
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
                "widgets_values": [slot["file"], p["weight"]],
                "color": GROUP_C.get(slot.get("group", ""), C_STYLE),
            })
            if first is None:
                first = nodes[-1]
                lid += 1
                first["inputs"][0]["link"] = lid
                links.append({"id": lid, "origin_id": -10, "origin_slot": 0,
                              "target_id": first["id"], "target_slot": 0, "type": "MODEL"})
            else:
                prev = nodes[-2]
                lid += 1
                prev["outputs"][0]["links"] = [lid]
                nodes[-1]["inputs"][0]["link"] = lid
                links.append({"id": lid, "origin_id": prev["id"], "origin_slot": 0,
                              "target_id": nid, "target_slot": 0, "type": "MODEL"})
        row_heads[zh] = first["id"]
        row_tails[zh] = nodes[-1]
        groups.append({
            "id": row + 1,
            "title": f"{CN[row]} {zh} · {aspect} · {dims}(右对齐;左留白=该型预留位)",
            "bounding": [32, y - 6, GROUP_RIGHT - 32, 162],
            "color": "#2a5a2a" if zh == ACTIVE else "#2a3a2a", "font_size": 20,
        })

    # 路由:槽序必须写「装载稳定序」=九型在前、base 末位(09-21 铁证:前端装载
    # 会把 MyDaojieRoute 槽重排成 widget 输入在末,连线按槽位序号落座——文件若
    # base 在首位,装载瞬间整排错一位:base 收 MODEL、人物收 COMBO,服务端
    # 拒「Return type mismatch」。服务端按名字收单与顺序无关,故随前端稳定序写)
    route_in = [{"name": zh, "type": "MODEL", "link": None} for zh in NINE] + \
               [{"name": "base", "type": "COMBO", "link": None}]
    nodes.append({
        "id": ROUTE_ID, "type": "MyDaojieRoute",
        "pos": [ROUTE_X, ROUTE_Y], "size": [300, 260],
        "flags": {}, "order": 99, "mode": 0,
        "inputs": route_in,
        "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
                    {"name": "applied", "type": "STRING", "links": [], "slot_index": 1}],
        "title": "按型选线·跟随[80](base 在末=装载稳定序)",
        "properties": {"Node name for S&R": "MyDaojieRoute"},
        "widgets_values": [ACTIVE],
        "color": "#432", "bgcolor": "#653",
    })
    for i, zh in enumerate(NINE):  # 行尾→对应型槽(槽0..8)
        lid += 1
        tail = row_tails[zh]
        tail["outputs"][0]["links"] = (tail["outputs"][0]["links"] or []) + [lid]
        links.append({"id": lid, "origin_id": tail["id"], "origin_slot": 0,
                      "target_id": ROUTE_ID, "target_slot": i, "type": "MODEL"})
    lid += 1  # base←入口 base 口(槽9)
    nodes[-1]["inputs"][9]["link"] = lid
    links.append({"id": lid, "origin_id": -10, "origin_slot": 1,
                  "target_id": ROUTE_ID, "target_slot": 9, "type": "COMBO"})
    lid += 1
    nodes[-1]["outputs"][0]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 0,
                  "target_id": -20, "target_slot": 0, "type": "MODEL"})
    lid += 1
    nodes[-1]["outputs"][1]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 1,
                  "target_id": -20, "target_slot": 1, "type": "STRING"})

    groups.append({
        "id": 10,
        "title": "九型 × LoRA 线路(9条真实加载线并联;行尾右对齐→按型选线→汇出)",
        "bounding": [-300, -230, (ROUTE_X + 300 + 380) + 300, (START_Y + 8 * ROW_GAP + 176) + 230],
        "color": "#335533", "font_size": 26,
    })

    # 09-21 根修:前端 1.53 子图边界线在图引擎里的登记依据=inputs/outputs[].linkIds
    # (装载时读取;只写 sg.links 的 -10/-20 线不登记 → 圆点无线+graphToPrompt
    # 拿不到子图输出 → [12].model 缺连接报错。勿回退成旧式 "links":[])。
    in_model = [l["id"] for l in links if l["origin_id"] == -10 and l["origin_slot"] == 0]
    in_base = [l["id"] for l in links if l["origin_id"] == -10 and l["origin_slot"] == 1]
    out_model = [l["id"] for l in links if l["target_id"] == -20 and l["target_slot"] == 0]
    out_applied = [l["id"] for l in links if l["target_id"] == -20 and l["target_slot"] == 1]
    assert len(in_model) == 9 and len(in_base) == 1 and len(out_model) == 1 and len(out_applied) == 1
    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 7,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        # 锚贴行区近旁(入口在第1行左,出口在路由右),边界短线可见
        "inputNode": {"id": -10, "bounding": [-360, START_Y - 10, 128, 88]},
        "outputNode": {"id": -20, "bounding": [ROUTE_X + 430, START_Y - 10, 128, 88]},
        "inputs": [
            {"name": "model", "type": "MODEL", "linkIds": sorted(in_model), "pos": [-232, START_Y + 18]},
            {"name": "base", "type": "COMBO", "type_data": [NINE], "linkIds": sorted(in_base), "pos": [-232, START_Y + 38], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "linkIds": sorted(out_model), "pos": [ROUTE_X + 430, START_Y + 18], "slot_index": 0},
            {"name": "applied", "type": "STRING", "linkIds": sorted(out_applied), "pos": [ROUTE_X + 430, START_Y + 38], "slot_index": 1},
        ],
        "widgets": [ACTIVE],
        "links": links, "nodes": nodes,
    })
    if old:
        defs.remove(old)

    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·按型分流线路(双击=9条真实加载线)"
    n90["properties"] = {"subgraph": sid}
    n90["widgets_values"] = [ACTIVE]
    n90["outputs"] = [
        {"name": "model", "type": "MODEL", "links": [54], "slot_index": 0},
        {"name": "applied", "type": "STRING", "links": [66], "slot_index": 1},
    ]
    doc["links"] = [l for l in doc.get("links", []) if l[0] != 66]
    doc["links"].append([66, 90, 1, 86, 0, "*"])

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_loaders = sum(1 for n in nodes if n["type"] == "LoraLoaderModelOnly")
    print(f"v12: {n_loaders} 件右对齐 9 行并联 + 紧凑路由右置 + base 顶边距干线;[90]→{sid[:8]}…")


if __name__ == "__main__":
    main()
