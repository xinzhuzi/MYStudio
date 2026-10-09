#!/usr/bin/env python3
"""LoRA 栈切主链手术(09-19 LoRA快速启停 R3;等价性门禁通过后执行)。

对 K2-文生图-道劫.json / K2-角色设定-道劫.json:
  ① 原工作流整文件另存 *-专家模式.json(不替换铁律:原 14 件 LoraLoader 链
     +[85] 按型节点 +[88] 分组旁路器一字不动,随时可切回);
  ② 主链 LoRA 链区换 [90] MyDaojieLoraStack:
     t2i:preset=跟随底座型(默认组,base←[80]槽4 复用原线),14 槽 enable 全开
         ×default_weight;[86] 生效清单改看 [90].applied;[88]/LoRA· 五组移除
         (专家模式副本保留);[66] 卡 LoRA 段重写为栈纪元。
     角色:preset=专家·全自定义(enable=细节×1+鎏金×0.4,其余关——复现现激活组
         67×1→173×0.4;76 AsianMix 现旁路=风格主权归工笔锚[v3 实证],维持关);
         [164] charsheet 独立件保留(官方挂法:栈出→[164]→ModelPatch);
         ① 组标题与 [301] 卡链序段同步。
幂等:专家副本已在/主链已是栈形态即跳过对应步;重跑产物字节级相同。
回写:ensure_ascii=False/indent=2/无尾换行(与两文件现行格式一致)。
改后必须:workflow_graph_lint 双图 + 契约 pytest + 双家 my-nodes 同步
(workflows 真源在 repo,侧栏 repo: 合并只读,无需拷贝)+ 提交。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像"
WF_T2I = WF_DIR / "1_文生图" / "K2-文生图-道劫.json"
WF_CHAR = WF_DIR / "2_图生图" / "K2-角色设定-道劫.json"
STACK_JSON = (REPO / "apps/backend/engines/comfyui/my_nodes/nodes"
              / "daojie_lora_stack.json")

STACK_ID = 90
STACK_TYPE = "MyDaojieLoraStack"

# t2i 移除集:14 件 LoraLoaderModelOnly + [85] MyDaojieLoras + [88] 分组旁路器
T2I_REMOVE = {19, 46, 47, 67, 69, 73, 76, 77, 78, 81, 82, 83, 84, 87, 85, 88}
# 角色设定移除集:8 件 LoraLoaderModelOnly([164] charsheet 独立件保留)
CHAR_REMOVE = {19, 46, 67, 69, 76, 77, 78, 173}

T2I_CARD_NEW = """## LoRA 栈([90] 单节点 14 槽·九型驱动;09-19 等价性双跑已锚:默认组=原常开链逐字节等价)
- **preset=跟随底座型(默认,勿手改)**:[80] 选型→自动点亮对应组;换型只在 [80] 一处。人物=加速×1+服从度×0.01+细节×1+亚洲面孔×0.4+鎏金×0.3;场景/概念气氛=加速+服从度+细节×1+金雾×0.6(免鎏金);道具=加速+服从度+细节×1+鎏金×0.3
- 每槽「××开」=急停开关:**关=真关**(跳过加载,比权重 0 快;压过矩阵点亮,applied 清单会披露);「××权重」=预设模式下只读参考,微调请切「专家·全自定义」
- **专家·全自定义=14 槽全手拨**(默认全开!互斥纪律:画风件同开 ≤1(+鎏金半件),三画风同开=崩源)
- 槽位/链序/按型预设真源=my_nodes/nodes/daojie_lora_stack.json(热改即时生效):**新增 LoRA 只改数据文件,工作流零改动**;链序=文件序(加速→服从度→细节→亚洲面孔→鎏金→光影→电影感→identity→暗笔刷→美学→淡彩线描→墨洗→湿画→金雾),链序敏感勿重排
- 水墨四件(淡彩线描/墨洗/湿画/金雾)与备选件(identity/暗笔刷/美学)默认全关;手开须在 [50] 主体句补各自触发词(淡彩线描:watercolor ink illustration style;暗笔刷:monochrome ink wash style)
- 质感件默认旁路,按需开:[46]光影 ×0.8/[78]电影感 ×1.0(槽内权重可调);[19] identity 编辑件恒关(跑 t2i 会支配整图)
- 原画布链(14 件 LoraLoader+[85] 按型节点+[88] 分组旁路器)整段存同目录「K2-文生图-道劫-专家模式.json」,随时可切回
"""


def slots() -> list:
    return json.loads(STACK_JSON.read_text(encoding="utf-8"))


def stack_widgets(preset: str, on: dict | None = None) -> list:
    """widgets_values=[preset, (enable,weight)×14],槽序=数据文件序(INPUT_TYPES 序)。"""
    on = on or {}
    wv = [preset]
    for s in slots():
        wv.append(bool(on.get(s["key"], preset != "专家·全自定义")))
        wv.append(float(s["default_weight"]))
    return wv


def retarget(links: list, *, src=None, dst=None, to_src=None, to_dst=None,
             to_src_slot=None, to_dst_slot=None) -> bool:
    """按 (src,dst) 定位一条线改端点;命中即真。"""
    hit = False
    for l in links:
        if l[1] == src and l[3] == dst:
            if to_src is not None:
                l[1], l[2] = to_src, (to_src_slot if to_src_slot is not None else l[2])
            if to_dst is not None:
                l[3], l[4] = to_dst, (to_dst_slot if to_dst_slot is not None else l[4])
            hit = True
    return hit


def drop_links_of(wf: dict, remove: set) -> int:
    before = len(wf["links"])
    wf["links"] = [l for l in wf["links"] if l[1] not in remove and l[3] not in remove]
    return before - len(wf["links"])


def make_stack_node(nid_inputs: list, outputs: list, widgets: list,
                    pos: list, title: str) -> dict:
    return {"id": STACK_ID, "type": STACK_TYPE, "pos": pos,
            "size": [400, 980], "flags": {}, "order": 10, "mode": 0,
            "inputs": nid_inputs, "outputs": outputs, "title": title,
            "properties": {"Node name for S&R": STACK_TYPE},
            "widgets_values": widgets}


def expert_copy(src: Path) -> Path:
    dst = src.with_name(src.stem + "-专家模式.json")
    if not dst.exists():
        shutil.copyfile(src, dst)
        print(f"[copy] 专家模式副本已存: {dst.name}")
    else:
        print(f"[copy] 副本已在,跳过: {dst.name}")
    return dst


def switch_t2i() -> None:
    wf = json.loads(WF_T2I.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    if STACK_ID in nodes:
        print("[t2i] 已是栈形态,跳过")
        return
    expert_copy(WF_T2I)
    links = wf["links"]
    # 四线改端点(link id 全保留):[21]→47 改 dst;[80]槽4→85 改 dst;
    # [85]→12 改 src;[85]出1→86 改 src
    ok = (retarget(links, src=21, dst=47, to_dst=STACK_ID, to_dst_slot=0)
          & retarget(links, src=80, dst=85, to_dst=STACK_ID, to_dst_slot=1)
          & retarget(links, src=85, dst=12, to_src=STACK_ID, to_src_slot=0)
          & retarget(links, src=85, dst=86, to_src=STACK_ID, to_src_slot=1))
    assert ok, "四条改端线定位失败(工作流形态与预期不符,不盲改)"
    dropped = drop_links_of(wf, T2I_REMOVE)
    l21 = next(l for l in links if l[1] == 21 and l[5] == "MODEL")
    l12 = next(l for l in links if l[3] == 12 and l[5] == "MODEL")
    l86 = next(l for l in links if l[3] == 86)
    lbase = next(l for l in links if l[1] == 80 and l[3] == STACK_ID
                 and l[5] == "COMBO")
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in T2I_REMOVE]
    wf["nodes"].append(make_stack_node(
        nid_inputs=[{"name": "model", "type": "MODEL", "link": l21[0]},
                    {"name": "base", "type": "COMBO", "link": lbase[0]}],
        outputs=[{"name": "model", "type": "MODEL", "links": [l12[0]],
                  "slot_index": 0},
                 {"name": "applied", "type": "STRING", "links": [l86[0]],
                  "slot_index": 1}],
        widgets=stack_widgets("跟随底座型"),
        pos=[6480, 280],
        title="[90] LoRA栈·九型驱动14槽(preset=跟随底座型;开关=真关;原链另存-专家模式.json)"))
    n86 = next(n for n in wf["nodes"] if n["id"] == 86)
    n86["pos"] = [6480, 1320]
    n86["size"] = [480, 200]
    # 分组:五组 LoRA·* 移除;② 组改栈纪元并缩界包住 [90]+[86](右带空区,
    # 左带 y80 行高仅 130 容不下 29 widget 的 980 高节点——横排行不动其他件)
    wf["groups"] = [g for g in wf.get("groups", [])
                    if not g.get("title", "").startswith("LoRA·")]
    for g in wf.get("groups", []):
        if g.get("title", "").startswith("②"):
            g["title"] = ("② LoRA 栈([90] 单节点 14 槽;preset=跟随底座型随 [80] 换型;"
                          "开关=真关;链序真源 daojie_lora_stack.json;原链整段另存"
                          "-专家模式.json)")
            g["bounding"] = [6440, 240, 560, 1360]
    # [66] 卡:LoRA 按型速配+分组开关 两段整体换栈纪元
    n66 = next(n for n in wf["nodes"] if n["id"] == 66)
    txt = n66["widgets_values"][0]
    i = txt.find("## LoRA 按型速配")
    j = txt.find("## 参数速查")
    assert i > 0 and j > i, "[66] 卡 LoRA 段定位失败"
    n66["widgets_values"][0] = txt[:i] + T2I_CARD_NEW + "\n" + txt[j:]
    wf["last_node_id"] = max(int(wf.get("last_node_id", 0)), STACK_ID)
    wf["last_link_id"] = max(l[0] for l in wf["links"])
    WF_T2I.write_text(json.dumps(wf, ensure_ascii=False, indent=2),
                      encoding="utf-8")
    print(f"[t2i] 切换完成:移除 {len(T2I_REMOVE)} 节点/弃线 {dropped},"
          f"[90] 插入,[86]/[66]/②组 已同步")


def switch_char() -> None:
    wf = json.loads(WF_CHAR.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    if STACK_ID in nodes:
        print("[char] 已是栈形态,跳过")
        return
    expert_copy(WF_CHAR)
    links = wf["links"]
    ok = (retarget(links, src=55, dst=19, to_dst=STACK_ID, to_dst_slot=0)
          & retarget(links, src=78, dst=164, to_src=STACK_ID, to_src_slot=0))
    assert ok, "[55]→19 / [78]→164 两条改端线定位失败(形态不符,不盲改)"
    dropped = drop_links_of(wf, CHAR_REMOVE)
    l55 = next(l for l in links if l[1] == 55 and l[5] == "MODEL")
    l164 = next(l for l in links if l[3] == 164 and l[5] == "MODEL")
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in CHAR_REMOVE]
    # 专家档复现现激活组:67 细节×1 + 73 鎏金×0.4(76 AsianMix 现旁路=风格
    # 主权归工笔锚[v3 实证],维持关;turbo/projector 本流从来不用,关)
    wf["nodes"].append(make_stack_node(
        nid_inputs=[{"name": "model", "type": "MODEL", "link": l55[0]}],
        outputs=[{"name": "model", "type": "MODEL", "links": [l164[0]],
                  "slot_index": 0},
                 {"name": "applied", "type": "STRING", "links": None,
                  "slot_index": 1}],
        widgets=stack_widgets("专家·全自定义", on={"detail": True, "liujin": True}),
        pos=[5100, 80],
        title="[90] LoRA栈·专家档(细节×1+鎏金×0.4=现激活组;76旁路=风格主权归工笔锚;原链另存-专家模式.json)"))
    for g in wf.get("groups", []):
        if g.get("title", "").startswith("①"):
            g["title"] = ("① 模型与道劫 LoRA 栈([90] 专家档:细节×1+鎏金×0.4,"
                          "风格主权归工笔锚[v3 实证];charsheet [164] 独立挂,"
                          "官方挂法=栈出→[164]→ModelPatch;原 8 件链副本 -专家模式.json)")
            g["bounding"] = [40, 40, 5520, 1300]
    n301 = next(n for n in wf["nodes"] if n["id"] == 301)
    txt = n301["widgets_values"][0]
    old = "+Krea2- 系列 10 枚道劫画风 LoRA(链序见 [19]→[78],开流即道劫画风)"
    new = ("+道劫画风 LoRA 栈=[90] MyDaojieLoraStack(专家档:细节×1+鎏金×0.4,"
           "槽序真源 my_nodes/nodes/daojie_lora_stack.json,开流即道劫画风;"
           "原链副本 -专家模式.json)")
    assert old in txt, "[301] 卡链序段定位失败"
    n301["widgets_values"][0] = txt.replace(old, new)
    wf["last_node_id"] = max(int(wf.get("last_node_id", 0)), STACK_ID)
    wf["last_link_id"] = max(l[0] for l in wf["links"])
    WF_CHAR.write_text(json.dumps(wf, ensure_ascii=False, indent=2),
                       encoding="utf-8")
    print(f"[char] 切换完成:移除 {len(CHAR_REMOVE)} 节点/弃线 {dropped},"
          f"[90] 插入(专家档),①组/[301]卡 已同步")


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    if which in ("t2i", "both"):
        switch_t2i()
    if which in ("char", "both"):
        switch_char()
    print("OK(改后必跑:workflow_graph_lint 双图 + 契约 pytest + 双家同步)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
