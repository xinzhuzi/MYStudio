#!/usr/bin/env python3
"""九型驱动 LoRA 接线手术(09-19 用户令「九型让不同的 lora 生效」)。

在道劫文生图插 [85] MyDaojieLoras(漫影 道劫按型LoRA):
  [84/链尾]out0 ──新线──→ [85].model;[80].base(新增第5槽)──新线──→ [85].base;
  原 [链尾]→[12] 线改源为 [85].out0([12].model 线号不变);
  [67]/[73]/[76] 转旁路(交棒 [85],节点保留作手动件,手动开=与 [85] 叠加);
  [66] 卡 LoRA 段整段重写(九型驱动版;顺带清并行会话带回的 [68] 幽灵文案)。

幂等:[85] 已在图或链尾形态不符即明确报错退出,不盲改。
改前 re-diff 由调用方负责;改后必须 workflow_graph_lint + 契约 + 实弹 + 立刻提交。
回写格式=ensure_ascii=False + indent=2 + 无尾换行。
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"

NODE_ID = 85
HANDOVER_IDS = (67, 73, 76)   # 交棒 [85] 的原人物三件

CARD_SECTION_NEW = """## LoRA 按型速配(09-19 九型驱动版;保存态=[47][81] 常开+[85] 按型,[67][73][76] 交棒转旁路)
- 常开功能件(与型无关):[47]加速·4步蒸馏 ×1.0(定稿档旁路);[81]服从度·ProjectorScale ×0.01(权重口径特殊:0.01=+1×特殊,勿按常规拉)
- **[85] 按型LoRA·九型驱动(自动)**:[80] 选型→自动生效对应组;真源=my_nodes/nodes/daojie_loras.json(热改即时生效,勿改图)——人物系(人物/美宣/三视图/表情差分/高清人脸/分镜剧情图)=[67]细节×1+[76]亚洲面孔×0.4+[73]鎏金×0.3;场景系(场景/概念气氛图)=[67]细节×1+金雾仙侠×0.6(淡彩向,与73方向相反,按型自动二选一=共存非替换);道具=[67]细节×1+[73]鎏金×0.3(静物无面孔)
- 手动画风件(链位在 [85] 之前,可叠加;默认旁路,启用须在 [50] 补触发词,一次一枚):[82]淡彩线描插画 ×1.0(触发词:watercolor ink illustration style)/[83]墨洗SumiWash ×1.0(无触发词)/[84]水彩湿画wash ×1.0(写意向更松,备选)/[69]暗笔刷darkbrush(触发词:monochrome ink wash style)/[77]美学Masterpiece ×1.0
- 质感件默认旁路,按需开:[46]光影·Afterlight ×0.8(摄影向暖金逆光)/[78]电影感·CinematicShot ×1.0
- [19] identity 编辑件恒旁路(编辑系件跑 t2i 会支配整图,勿开);[67]/[73]/[76] 已交棒 [85](转旁路保留,手动开=与 [85] 同件叠加,记得算总权重)
"""


def main() -> int:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    if NODE_ID not in nodes:
        r = wire_main_chain(wf, nodes)
        if r:
            return r
    # 阶段二(幂等):[85].applied 悬空则补 [86] easy showAnything 预览件
    # (照 [62] 先例:悬空 STRING 出线 history 不记值,接显示件=画布可见+可取证)
    n85 = next(n for n in wf["nodes"] if n["id"] == NODE_ID)
    if not n85["outputs"][1].get("links"):
        prev_id = 86
        if prev_id not in nodes:
            prev_link = wf["last_link_id"] + 1
            n85["outputs"][1]["links"] = [prev_link]
            wf["nodes"].append({
                "id": prev_id, "type": "easy showAnything",
                "pos": [n85["pos"][0], n85["pos"][1] + 140], "size": [480, 200],
                "flags": {}, "order": 0, "mode": 0,
                "inputs": [{"label": "输入任何", "name": "anything", "shape": 7,
                            "type": "*", "link": prev_link}],
                "outputs": [{"name": "output", "type": "*", "links": None}],
                "title": "[86] 按型LoRA生效清单",
                "properties": {"Node name for S&R": "easy showAnything"},
                "widgets_values": ["(待运行)"]})
            wf["links"].append([prev_link, NODE_ID, 1, prev_id, 0, "STRING"])
            wf["last_link_id"] = prev_link
            wf["last_node_id"] = prev_id
            print(f"[wire] [86] 预览件已插(link {prev_link})")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[wire] 写回完成")
    return 0


def wire_main_chain(wf: dict, nodes: dict) -> int:
    n12_model = next(i for i in nodes[12]["inputs"] if i["name"] == "model")
    links = {l[0]: l for l in wf["links"]}
    tail_lid = n12_model["link"]
    tail = links[tail_lid]                    # 现链尾 → [12].model
    tail_id = tail[1]
    print(f"[wire] 现链尾=[{tail_id}]{nodes[tail_id].get('type')} -link{tail_lid}-> [12].model")
    if nodes[tail_id].get("type") != "LoraLoaderModelOnly":
        print("[wire] ✗ 链尾形态与预期不符(应为 LoRA 件),不盲改")
        return 1

    new_link = wf["last_link_id"] + 1         # [链尾]→[85].model
    base_link = new_link + 1                  # [80].base→[85].base
    # ① [80] 追加第 5 槽 base(COMBO 型直通)
    n80 = nodes[80]
    n80["outputs"].append({"label": "型", "name": "base", "type": "COMBO",
                           "slot_index": 4, "links": [base_link]})
    # ② 原 [链尾]→[12] 线改源为 [85];链尾出线侧登记换新线
    tail[1], tail[2] = NODE_ID, 0
    nodes[tail_id]["outputs"][0]["links"] = [
        new_link if x == tail_lid else x
        for x in (nodes[tail_id]["outputs"][0].get("links") or [])]
    # ③ 新节点 [85](位置=链尾右侧同横带;越界 [12] 则下移一行)
    tx, ty = nodes[tail_id]["pos"]
    tw = nodes[tail_id].get("size", [400, 100])[0]
    px = tx + tw + 80
    if px + 340 > nodes[12]["pos"][0]:
        px = tx
        ty = ty + 200
    n85 = {"id": NODE_ID, "type": "MyDaojieLoras", "pos": [px, ty], "size": [320, 100],
           "flags": {}, "order": 0, "mode": 0,
           "inputs": [{"name": "model", "type": "MODEL", "link": new_link},
                      {"name": "base", "type": "COMBO", "link": base_link}],
           "outputs": [{"name": "model", "type": "MODEL", "links": [tail_lid], "slot_index": 0},
                       {"name": "applied", "type": "STRING", "links": None, "slot_index": 1}],
           "title": "[85] 按型LoRA·九型驱动(勿手改)",
           "properties": dict(nodes[80].get("properties", {})),
           "widgets_values": []}
    wf["nodes"].append(n85)
    wf["links"].append([new_link, tail_id, 0, NODE_ID, 0, "MODEL"])
    wf["links"].append([base_link, 80, 4, NODE_ID, 1, "COMBO"])
    wf["last_link_id"] = base_link
    wf["last_node_id"] = NODE_ID
    # ④ [67]/[73]/[76] 交棒转旁路
    for nid in HANDOVER_IDS:
        if nid in nodes and nodes[nid].get("mode") != 4:
            nodes[nid]["mode"] = 4
            print(f"[wire] [{nid}] 已转旁路(交棒 [85])")
    # ⑤ [66] 卡 LoRA 段整段重写
    n66 = next(n for n in wf["nodes"] if n.get("id") == 66)
    txt = n66["widgets_values"][0]
    i = txt.find("## LoRA 按型速配")
    j = txt.find("## 参数速查")
    assert i > 0 and j > i, "卡片 LoRA 段定位失败"
    n66["widgets_values"][0] = txt[:i] + CARD_SECTION_NEW + "\n" + txt[j:]
    print("[wire] [66] 卡 LoRA 段已重写(九型驱动版,[68] 幽灵文案已清)")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[wire] 完成:[85] 插入 pos={n85['pos']},新线 {new_link}/{base_link},"
          f"[{tail_id}]→[85]→[12]")
    return 0


if __name__ == "__main__":
    sys.exit(main())
