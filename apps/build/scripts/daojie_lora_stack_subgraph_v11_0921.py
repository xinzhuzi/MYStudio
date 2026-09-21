#!/usr/bin/env python3
"""[90] 子图 v11:走线治理(09-21,回应用户「为什么子图还是这样的布局」)。

v9/v10 病灶(用户截图实锤):
  1. 九行长度参差(2~6 件),短行行尾到右侧路由之间横着 1800px+ 空跑长线;
  2. 行尾九条线从不同高度斜插汇聚到中部小路由节点=对角扇形乱线;
  3. 左侧 -10.model 单槽对九行行首=另一把扇形线。

v11 手法(结构不动,只治走线;9 行仍并联、Route 仍只选线):
  A. 左侧加「分线排」MyModelBus(1 进 9 出,竖长条,九输出槽逐行对齐):
     -10.model→bus.model 一根短线,bus.out_i→行_i 首全水平;
  B. 路由 MyDaojieRoute 拉成竖长条(十入槽逐行对齐,base 槽在顶):
     九行尾→Route 槽位全水平直入,零对角扇;
  C. 行组框拉满宽(到路由前),矩阵成整齐网格,短行右侧留白读作该型预留位;
  D. -10 置左上(model 短线下落给 bus;base 一根平直干线走顶部边距给
     Route.base),-20 置路由右侧中部。

槽位对齐系数:litegraph 槽间距按节点高度均分,解析式仅初值,
生成后必须跑浏览器实测校准(daojie_subgraph_slotcal_0921 流程)。

用法:python3 apps/build/scripts/daojie_lora_stack_subgraph_v11_0921.py
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
START_X, START_Y = 40, 40
ROUTE_ID, BUS_ID = 1, 2
ROUTE_X = 2700          # 路由左缘(最长行尾 2580 + 120 净空)
BUS_X, BUS_W = -320, 240
SLOT_PAD = 45           # litegraph 槽上下留白(初值;实测校准)

C_FUNC, C_FACE, C_STYLE, C_MIST = "#335577", "#336633", "#663366", "#775533"
GROUP_C = {"功能件": C_FUNC, "面孔": C_FACE, "细节": C_FACE, "画风": C_STYLE, "水墨": C_MIST}


def row_center(i: int) -> int:
    """行 i 的 LoRA 件中心 y(与 v9 同栅格:loaders 在 y+16,高 100)。"""
    return START_Y + i * ROW_GAP + 16 + 50


def main() -> None:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    defs = doc["definitions"]["subgraphs"]
    old = next((s for s in defs if s.get("name") == NAME), None)

    sid = str(uuid.uuid4())
    nodes, groups, links = [], [], []
    nid, lid = 100, 1
    row_tails, row_heads = {}, {}

    # ── 九行真实 LoRA 链(行首改接分线排) ──
    for row, zh in enumerate(NINE):
        y = START_Y + row * ROW_GAP
        base = next(e for e in BASES if e["zh"] == zh)
        ov = base.get("resolution_override")
        dims = f"{ov[0]}×{ov[1]}" if ov else f"{base['megapixels']}MP"
        aspect = base["aspect_ratio"].split(" (")[0]

        first = None
        for col, slot in enumerate(STACK):
            p = slot["presets"].get(zh, {})
            if not p.get("on"):
                continue
            nid += 1
            nodes.append({
                "id": nid, "type": "LoraLoaderModelOnly",
                "pos": [START_X + col * COL_GAP, y + 16], "size": [340, 100],
                "flags": {}, "order": col + 1, "mode": 0,
                "inputs": [{"name": "model", "type": "MODEL", "link": None}],
                "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0}],
                "title": f"{slot['label']} ×{p['weight']:g}",
                "properties": {"Node name for S&R": "LoraLoaderModelOnly"},
                "widgets_values": [slot["file"], p["weight"]],
                "color": GROUP_C.get(slot.get("group", ""), C_STYLE),
            })
            if first is None:
                first = nodes[-1]
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
            "title": f"{CN[row]} {zh} · {aspect} · {dims}",
            "bounding": [START_X - 8, y - 6, ROUTE_X - 60 - (START_X - 8), 162],
            "color": "#2a5a2a" if zh == ACTIVE else "#2a3a2a", "font_size": 20,
        })

    # ── 分线排(竖长条,九输出槽逐行对齐;先挂线再补 outputs) ──
    bus_out_links: dict[int, list[int]] = {}
    lid += 1
    bus_in_lid = lid
    for i, zh in enumerate(NINE):
        lid += 1
        head = next(n for n in nodes if n["id"] == row_heads[zh])
        head["inputs"][0]["link"] = lid
        bus_out_links.setdefault(i, []).append(lid)
        links.append({"id": lid, "origin_id": BUS_ID, "origin_slot": i,
                      "target_id": row_heads[zh], "target_slot": 0, "type": "MODEL"})
    H_bus = 8 * ROW_GAP + 2 * SLOT_PAD
    nodes.append({
        "id": BUS_ID, "type": "MyModelBus",
        "pos": [BUS_X, row_center(0) - SLOT_PAD], "size": [BUS_W, H_bus],
        "flags": {}, "order": 0, "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "link": bus_in_lid}],
        "outputs": [{"name": zh, "type": "MODEL", "links": bus_out_links.get(i, []), "slot_index": i}
                    for i, zh in enumerate(NINE)],
        "title": "分线排·模型干线 1→9(逐行平送)",
        "properties": {"Node name for S&R": "MyModelBus"},
        "color": "#432", "bgcolor": "#653",
    })
    links.append({"id": bus_in_lid, "origin_id": -10, "origin_slot": 0,
                  "target_id": BUS_ID, "target_slot": 0, "type": "MODEL"})

    # ── 路由(竖长条,十入槽:slot0=base 顶置,slot i+1=型 i 逐行对齐) ──
    H_route = 9 * ROW_GAP + 2 * SLOT_PAD
    route_in = [{"name": "base", "type": "COMBO", "link": None}] + \
               [{"name": zh, "type": "MODEL", "link": None} for zh in NINE]
    nodes.append({
        "id": ROUTE_ID, "type": "MyDaojieRoute",
        "pos": [ROUTE_X, row_center(0) - SLOT_PAD - ROW_GAP], "size": [300, H_route],
        "flags": {}, "order": 99, "mode": 0,
        "inputs": route_in,
        "outputs": [{"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
                    {"name": "applied", "type": "STRING", "links": [], "slot_index": 1}],
        "title": "按型选线·跟随[80](九槽逐行收线,base 在顶)",
        "properties": {"Node name for S&R": "MyDaojieRoute"},
        "widgets_values": [ACTIVE],
        "color": "#432", "bgcolor": "#653",
    })
    lid += 1
    nodes[-1]["inputs"][0]["link"] = lid
    links.append({"id": lid, "origin_id": -10, "origin_slot": 1,
                  "target_id": ROUTE_ID, "target_slot": 0, "type": "COMBO"})
    for i, zh in enumerate(NINE):
        lid += 1
        tail = row_tails[zh]
        tail["outputs"][0]["links"] = (tail["outputs"][0]["links"] or []) + [lid]
        links.append({"id": lid, "origin_id": tail["id"], "origin_slot": 0,
                      "target_id": ROUTE_ID, "target_slot": i + 1, "type": "MODEL"})
    lid += 1
    nodes[-1]["outputs"][0]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 0,
                  "target_id": -20, "target_slot": 0, "type": "MODEL"})
    lid += 1
    nodes[-1]["outputs"][1]["links"] = [lid]
    links.append({"id": lid, "origin_id": ROUTE_ID, "origin_slot": 1,
                  "target_id": -20, "target_slot": 1, "type": "STRING"})

    # ── 外框(包住分线排+矩阵+路由) ──
    groups.append({
        "id": 10,
        "title": "九型 × LoRA 线路(9条真实加载线并联;分线排逐行平送→按型选线→汇出)",
        "bounding": [BUS_X - 60, -260, (ROUTE_X + 300 + 460) - (BUS_X - 60),
                     (START_Y + 8 * ROW_GAP + 176) - (-260)],
        "color": "#335533", "font_size": 26,
    })

    defs.append({
        "id": sid, "name": NAME, "version": "0.35.0", "revision": 6,
        "config": {"defaultIOState": {}}, "state": {}, "extra": {},
        "groups": groups,
        "inputNode": {"id": -10, "bounding": [-640, -200, 150, 160]},
        "outputNode": {"id": -20, "bounding": [ROUTE_X + 340, START_Y + 3 * ROW_GAP, 150, 200]},
        "inputs": [
            {"name": "model", "type": "MODEL", "links": []},
            {"name": "base", "type": "COMBO", "type_data": [NINE], "links": [], "widget": False},
        ],
        "outputs": [
            {"name": "model", "type": "MODEL", "links": [], "slot_index": 0},
            {"name": "applied", "type": "STRING", "links": [], "slot_index": 1},
        ],
        "widgets": [ACTIVE],
        "links": links, "nodes": nodes,
    })
    if old:
        defs.remove(old)

    # 主图:[90] 指到新子图(位置/尺寸保持 v10 主图不动)
    n90 = next(n for n in doc["nodes"] if n.get("id") == 90)
    n90["type"] = sid
    n90["title"] = "[90] LoRA栈·按型分流线路(双击=9条真实加载线)"
    n90["properties"] = {"subgraph": sid}
    n90["widgets_values"] = [ACTIVE]
    n90["outputs"] = [
        {"name": "model", "type": "MODEL", "links": [54], "slot_index": 0},
        {"name": "applied", "type": "STRING", "links": [66], "slot_index": 1},
    ]
    if not any(n.get("id") == 86 for n in doc["nodes"]):
        raise SystemExit("v11:主图 [86] 缺失(应已存在,勿在此重建)")
    doc["links"] = [l for l in doc.get("links", []) if l[0] != 66]
    doc["links"].append([66, 90, 1, 86, 0, "*"])

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n_loaders = sum(1 for n in nodes if n["type"] == "LoraLoaderModelOnly")
    print(f"v11: {n_loaders} 件真实加载 9 行并联 + 分线排逐行平送 + 路由竖条逐行收线;[90]→{sid[:8]}…")


if __name__ == "__main__":
    main()
