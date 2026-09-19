#!/usr/bin/env python3
"""道劫 T2I 底座改造 09-19:服从度 ProjectorScale 入链 + 质感双件常开 + 横排重排。

对象:apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json
(改动前快照:/tmp/daojie_pre_projector.json 兄弟步骤更早状态;本脚本自校验前置态)

用户明示授权的改动(一次完成):
  1) 新增 [81] LoraLoaderModelOnly = Krea2-功能/Krea2-服从度ProjectorScale.safetensors
     ×0.01(权重口径特殊:0.01=+1x),mode=0;
  2) [46] 激活(mode 4→0,强度 0.8 不动)+ 去「默认旁路」题;[78] 激活(mode 4→0,
     ×1)+ 题改「质感·电影感」;
  3) LoRA 横排重排:激活块在前 [47][81][67][46][78][73][76],停用块在后
     [19][68][69][70][77];链 21→47→81→67→46→78→73→76→19→68→69→70→77→12,
     y=80,x=1240 起、宽 460+60 步进;link id 复用(src/dst 双侧+双向登记同步),
     尾入 KSampler 的 54 保持 54,新线 59 补 70→77;
  4) 组② 重算 bounding + 题改 12 件新文案;
  5) [66] 速查卡:补 [81] 档案行 + 纪律行 09-19 修订。

不做:pytest(脚本统一跑)、其他任何节点/文案改动。幂等:81 已在场即拒绝再跑。
"""
from __future__ import annotations

import json
import pathlib
import sys

WF = pathlib.Path(__file__).resolve().parents[2] / "backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"

LORA_FILE_81 = "Krea2-功能/Krea2-服从度ProjectorScale.safetensors"

# 目标横排链(x=1240 起,步进=宽 460+间 60=520;y 恒 80)
CHAIN = [21, 47, 81, 67, 46, 78, 73, 76, 19, 68, 69, 70, 77, 12]
ROW_X0, ROW_STEP, ROW_Y = 1240, 520, 80

# 链边→link id:12 条旧 id 按链位复用,尾锚 54(入 KSampler[0])与头锚 58(出
# UNETLoader[0])保持不变;新增 59 补链位 70→77
EDGE_LINKS = {
    (21, 47): 58, (47, 81): 17, (81, 67): 36, (67, 46): 38,
    (46, 78): 39, (78, 73): 40, (73, 76): 41, (76, 19): 48,
    (19, 68): 50, (68, 69): 51, (69, 70): 52, (70, 77): 59, (77, 12): 54,
}
NEW_LINK_ID = 59

# order 槽位:LoRA 链按链序取 [7,10,14,17..25];12/11/4 顺移 26/27/28;其余不动
LORA_ORDER_SLOTS = [7, 10, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25]
ORDER_SHIFT = {12: 26, 11: 27, 4: 28}

GROUP2_TITLE = "② LoRA 链(12 件,链序自左向右;46+78 质感双件常开;画风件一次一枚)"

CARD_78_ROW = "- [78] 画风·电影感CinematicShot | Krea2-画风/Krea2-电影感CinematicShot_K2.safetensors | ×1.0 | 电影感(摄影逻辑,道劫水墨慎用)\n"
CARD_81_ROW = "- [81] 服从度·ProjectorScale | " + LORA_FILE_81 + " | ×0.01 | 提示词服从度增益,权重口径 0.01=+1x/0.1=+10x 特殊勿按常规拉\n"
CARD_DISCIPLINE_OLD = "- 纪律重申:同时激活越多越崩;画风件(68/69/70/73/76/77/78)一次一枚"
CARD_DISCIPLINE_NEW = "- 纪律(09-19 修订):质感双件(46光影+78电影感)常开=用户09-19裁定;功能件 47+67+81=3 枚满编;画风件(68/69/70/73/77)仍一次一枚"


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(2)


def main() -> int:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in doc["nodes"]}
    by_title = {n["id"]: n.get("title", "") for n in doc["nodes"]}

    # ── 前置断言(防并发/防错文件)─────────────────────────────
    if 81 in nodes:
        die("幂等护栏:[81] 已在场,勿重复改造")
    if len(doc["nodes"]) != 28:
        die(f"前置不符:期望 28 节点,实为 {len(doc['nodes'])}")
    for nid in CHAIN:
        if nid not in nodes and nid != 81:
            die(f"前置不符:链节点 {nid} 缺席")
    expect_mode = {47: 0, 67: 0, 73: 0, 76: 0, 46: 4, 78: 4, 19: 4,
                   68: 4, 69: 4, 70: 4, 77: 4}
    for nid, m in expect_mode.items():
        if nodes[nid]["mode"] != m:
            die(f"前置不符:节点 {nid} mode 期望 {m} 实为 {nodes[nid]['mode']}")
    if nodes[46]["widgets_values"][1] != 0.8 or nodes[78]["widgets_values"][1] != 1:
        die("前置不符:46/78 强度非 0.8/1")

    # ── 1. 新节点 [81](结构复刻 [47]:同 properties/flags 双 widgets 面)──
    tpl = json.loads(json.dumps(nodes[47]))  # 深拷贝模板
    node81 = tpl
    node81["id"] = 81
    node81["pos"] = [ROW_X0 + ROW_STEP, ROW_Y]
    node81["order"] = LORA_ORDER_SLOTS[1]
    node81["mode"] = 0
    node81["title"] = "[81] 服从度·ProjectorScale ×0.01"
    node81["widgets_values"] = [LORA_FILE_81, 0.01]
    node81["widgets_values_named"] = {"lora_name": LORA_FILE_81, "strength_model": 0.01}
    node81["inputs"][0]["link"] = EDGE_LINKS[(47, 81)]
    node81["outputs"][0]["links"] = [EDGE_LINKS[(81, 67)]]
    idx47 = next(i for i, n in enumerate(doc["nodes"]) if n["id"] == 47)
    doc["nodes"].insert(idx47 + 1, node81)
    nodes[81] = node81

    # ── 2. 46/78 激活 + 改题 ──────────────────────────────────
    nodes[46]["mode"] = 0
    nodes[46]["title"] = "[46] 光影·Afterlight ×0.8"
    nodes[78]["mode"] = 0
    nodes[78]["title"] = "[78] 质感·电影感 ×1"

    # ── 3. 横排重排 + 链重接(link id 复用,双侧登记同步)───────
    lora_chain = CHAIN[1:-1]  # 12 件
    for i, nid in enumerate(lora_chain):
        nodes[nid]["pos"] = [ROW_X0 + i * ROW_STEP, ROW_Y]
    for i, nid in enumerate(lora_chain):
        nodes[nid]["order"] = LORA_ORDER_SLOTS[i]
    for nid, order in ORDER_SHIFT.items():
        nodes[nid]["order"] = order

    # links 数组:按 id 命中改 src/dst;新线 59 追加
    links_by_id = {l[0]: l for l in doc["links"]}
    for (src, dst), lid in EDGE_LINKS.items():
        if lid == NEW_LINK_ID:
            continue
        l = links_by_id[lid]
        l[1], l[2], l[3], l[4], l[5] = src, 0, dst, 0, "MODEL"
    if NEW_LINK_ID not in links_by_id:
        doc["links"].append([NEW_LINK_ID, 70, 0, 77, 0, "MODEL"])
        links_by_id[NEW_LINK_ID] = doc["links"][-1]
    doc["last_link_id"] = max(doc["last_link_id"], NEW_LINK_ID)
    doc["last_node_id"] = max(doc["last_node_id"], 81)

    # 双向登记:链上每个节点的 model 入线/MODEL 出线按新表重写
    for nid in lora_chain:
        nodes[nid]["inputs"][0]["link"] = None
        nodes[nid]["outputs"][0]["links"] = []
    for (src, dst), lid in EDGE_LINKS.items():
        nodes[dst]["inputs"][0]["link"] = lid
        outs = nodes[src]["outputs"][0]["links"]
        if lid not in outs:
            outs.append(lid)

    # ── 4. 组② 标题 + bounding(行尾 77@x=6960+460=7420,右缘+20)──
    g2 = next(g for g in doc["groups"] if g.get("id") == 2)
    g2["title"] = GROUP2_TITLE
    g2["bounding"] = [ROW_X0 - 20, 40, (ROW_X0 + 11 * ROW_STEP + 460 + 20) - (ROW_X0 - 20), 190]

    # ── 5. [66] 速查卡两处 ────────────────────────────────────
    card = nodes[66]["widgets_values"][0]
    if card.count(CARD_78_ROW) != 1:
        die("66 卡锚缺失:[78] 档案行不唯一")
    if card.count(CARD_DISCIPLINE_OLD) != 1:
        die("66 卡锚缺失:纪律行不唯一")
    card = card.replace(CARD_78_ROW, CARD_78_ROW + CARD_81_ROW)
    card = card.replace(CARD_DISCIPLINE_OLD, CARD_DISCIPLINE_NEW)
    nodes[66]["widgets_values"][0] = card

    # ── 写回(2 空格缩进/非 ASCII 原样/无尾换行,与库内格式一致)──
    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── 自校验:重读,链序/登记/坐标/激活集/组框/卡逐项断言 ─────
    chk = json.loads(WF.read_text(encoding="utf-8"))
    cn = {n["id"]: n for n in chk["nodes"]}
    lk = {l[0]: l for l in chk["links"]}
    for (src, dst), lid in EDGE_LINKS.items():
        e = lk[lid]
        assert (e[1], e[3]) == (src, dst), f"线 {lid} 端点错:{e}"
        assert lid in cn[src]["outputs"][0]["links"], f"线 {lid} 源端未登记"
        assert cn[dst]["inputs"][0]["link"] == lid, f"线 {lid} 目标端未登记"
    # 链从 21 沿 MODEL 出线走到底应恰为 CHAIN 序
    walk, cur = [21], 21
    while cur != 12:
        nxt = lk[cn[cur]["outputs"][0]["links"][0]][3]
        walk.append(nxt)
        cur = nxt
    assert walk == CHAIN, f"链走序错:{walk}"
    active = [n for n in (47, 81, 67, 46, 78, 73, 76) if cn[n]["mode"] == 0]
    assert active == [47, 81, 67, 46, 78, 73, 76], f"激活集错:{active}"
    for i, nid in enumerate(lora_chain):
        assert cn[nid]["pos"] == [ROW_X0 + i * ROW_STEP, ROW_Y], f"{nid} 坐标错"
    assert cn[81]["widgets_values"] == [LORA_FILE_81, 0.01]
    assert cn[46]["widgets_values"][1] == 0.8 and cn[46]["mode"] == 0
    assert cn[78]["widgets_values"][1] == 1 and cn[78]["mode"] == 0
    g2c = next(g for g in chk["groups"] if g.get("id") == 2)
    assert g2c["title"] == GROUP2_TITLE and g2c["bounding"] == [1220, 40, 6220, 190], g2c
    orders = sorted(n["order"] for n in chk["nodes"])
    assert orders == list(range(len(chk["nodes"]))), "order 非连续唯一"
    assert CARD_81_ROW in cn[66]["widgets_values"][0]
    assert CARD_DISCIPLINE_NEW in cn[66]["widgets_values"][0]
    print(f"✓ 改造完成并自校验通过:{WF}")
    print(f"  节点 {len(chk['nodes'])} | 链 {'→'.join(map(str, CHAIN))}")
    print(f"  激活集 {active} | 组② bounding {g2c['bounding']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
