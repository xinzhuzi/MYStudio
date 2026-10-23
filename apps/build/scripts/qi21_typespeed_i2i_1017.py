#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 型名信号穿界 + 「自动 · 按型」默认翻转 · i2i 件(役号 1017auto/i2i)。

背景(1017 增档令,单一真源=my_nodes/nodes/my_qi21_speed_select.py):
  - MyQi21SpeedSelect combo 增首项「自动 · 按型」(型名∈{设定卡,美宣}→原生出图,
    其余含空→Turbo),SPEED_MODES 首项=默认=全局出厂默认。
  - MyQi21DaojieBase 已回加第六出「型名」(slot 5,base 入参原值直通)。
  - i2i 工作流侧欠账:[6] 装配子图内 [4010] 的「型名」出未穿子图边界,
    [7015] 无型名信号,四面 widget 默认仍是「0 · Turbo 8步」,Note 402
    双异文(短卡 widgets_values[0] 与长文 widgets_values_named.text 不同文)
    的默认/首项/三选一句全部过期。

做法(i2i 主件+两蓝图同笔;A-E 段;幂等 fail-closed;计划定号:
  型名 idx5 / 根线 4412 / 装配 def 内线 286 / 蓝图顶层 0→286):
  A [6] 装配子图(ASM def,PE-I2I 形):[4010] 尾加第六出「型名」(slot 5)
    →新内线 286(4010:5 → -20:4)→ def.outputs 尾加「型名」(pos 8100,2460
    恒向右);def state.lastLinkId 285→286(def 无顶层 last_link_id 键,沿现形)。
    **pre 断言拒动:若 [6] 已被重写为 AI扩写形(MyQi21ApiPE 在场),本脚本
    拒动 exit 1,按 risks 重勘**(现形=TextGenerate/PE启用? 旧形可施)。
  B 宿主 outputs 镜像:主件 [6] outputs 尾加「型名」(slot 4,links=[4412]);
    蓝图壳 qi21-提示词类型优化子图-i2i.json 同款(def+root 镜像,root 顶层
    last_link_id 0→286 计划定号)。
  C 根线:主件 root links 尾加 [4412, 6, 4, 7, 5, "STRING"]([6] 型名→[7]
    型名 idx5;恒向右 [6]x3750→[7]x6500 零左向线,零组框触碰);root
    last_link_id 4411→4413。
  D [7] 加速子图(SPD def):def.inputs 尾加「型名」(pos 80,960)→新内线
    4413(-10:8 → 7015:4,STRING)→ [7015] inputs 尾加「型名」(shape 7);
    id7 宿主值翻转四面双写:host7 widgets_values[0]/widgets_values_named
    「速度档位」+ SPD def widgets[0] + [7015] wv/named mode →「自动 · 按型」;
    SPD state.lastLinkId 4409→4413。蓝图壳 qi21-道劫-加速子图-i2i.json 同款
    (内线 4409=蓝图 root 4408+1,顶层同抬)。
  E Note 402 双异文分理 R4-R7:短卡(widgets_values[0])=R4;长文
    (widgets_values_named.text)=R5/R6/R7;两字段各自替换;术后两字段内
    「0 · Turbo 8步」计数归零。

守卫:术前 md5 锚+.bak-1017auto 三份备份(仅首建,备份后验 md5)+原子写
  (.tmp-1017auto)+回读终验(盘上重解析重验全 PASS,败则回滚备份);
  任何锚失/半态=exit 1 拒动;全施态复跑=exit 3(幂等);--target 非 i2i=exit 2。
用法:python3 qi21_typespeed_i2i_1017.py [--target i2i] [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
CAMPAIGN = "1017auto"
TAG = "i2i"

AUTO = "自动 · 按型"          # my_qi21_speed_select.AUTO_MODE 逐字(含空格)
OLD = "0 · Turbo 8步"        # 1008-1016 时代默认档串

MAIN = BASE / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
ASM_BP = BASE / "my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SPD_BP = BASE / "my_nodes/subgraphs/qi21-道劫-加速子图-i2i.json"

ASM_SGID = "d47c9e21-8f36-4a5b-b0c9-2e8d4f6a8c1d"
SPD_SGID = "b3f5a1c2-9d4e-4f60-8a7b-5c6d7e8f9a0b"

# ── 新线 id(纪律:last_link_id+1 顺发;root 与子图 last id 计数器同抬;
#    根线 4412/装配内线 286=计划定号)──
ROOT_LINK = 4412     # 主件根线 [6]:4 → [7]:5(主件 root last=4411)
SPD_INNER = 4413     # 主件 SPD def 内线 -10:8 → 7015:4(与 root 同计数器)
ASM_INNER = 286      # ASM def 自有计数器(state.lastLinkId 285+1;4010:5 → -20:4)
BP_SPD_INNER = 4409  # SPD 蓝图自有 root 计数器(4408+1;-10:8 → 7015:4)

HOST6_OUT_IDX = 4    # 型名 在主件 [6] outputs 槽序(尾加)
HOST7_IN_IDX = 5     # 型名 在主件 [7] inputs 槽序(尾加=idx5,计划定号)
ASM_OUT_POS = [8100, 2460]  # ASM def 出针:negative(8100,2440) 下一位,恒向右
SPD_IN_POS = [80, 960]      # SPD def 入针:σ表(80,940) 下一位
ASM_OUT_UUID = "e8f1a2b3-1016-4c02-8f06-d47c9e21c102"
SPD_IN_UUID = "a1b2c3d4-0008-4d08-8d08-b3f5a1c2a008"

SPD_DEF_INPUTS_PRE = ["model", "positive", "negative", "positive_single",
                      "latent", "速度档位", "seed", "σ表"]
ASM_DEF_OUTPUTS_PRE = ["prompt", "画幅W", "画幅H", "negative"]
HOST7_INPUTS_PRE = ["model", "positive", "negative", "positive_single", "latent"]
SEL_INPUTS_PRE = ["latent_turbo", "latent_viggle", "latent_direct", "mode"]
BASE_OUTPUTS_PRE = ["BASE", "WIDTH", "HEIGHT", "负面词", "透明值"]

# ── Note 402 双异文分理(短卡 R4 / 长文 R5-R7;锚逐字,锚失中止)──
NOTE_SUBS_SHORT = [
    ("R4",
     "默认使用 Fix×0.5→官方 Turbo×1.0（8步）；仍可手动选择 viggle 9 步双段，"
     "失败不切慢档。",
     "默认「自动 · 按型」（型名∈{设定卡,美宣}→原生出图，其余含空→Turbo 官方 "
     "8 步直挂）；仍可手动选择 viggle 9 步双段，失败不切慢档。"),
]
NOTE_SUBS_LONG = [
    ("R5",
     "「速度档位」combo(首项=「0 · Turbo 8步」=全局出厂默认;"
     "本件默认=「0 · Turbo 8步」=1009 用户新令(推翻本件 1002 Fun-Acc 令;"
     "原生出图居二))",
     "「速度档位」combo 四选一(首项=「自动 · 按型」=全局出厂默认=本件默认,"
     "1017 增档令:按型名自动路由——[6] 装配子图「型名」出口→[7]「型名」入槽喂 "
     "[7015],型名∈{设定卡,美宣}→原生出图,其余含空→Turbo;推翻 1009/1016 "
     "Turbo 默认令;Turbo 居二/原生出图居三/viggle 居四)"),
    ("R6",
     "**Turbo 支路([7028],子图行1,combo 首项「0 · Turbo 8步」=全局出厂首项;"
     "1016turbo 换臂)**",
     "**Turbo 支路([7028],子图行1,combo 次位档(1016turbo 换臂,1017 让首位于"
     "「自动 · 按型」))**"),
    ("R7",
     "在 MyQi21SpeedSelect 三选一处汇流(选择件居汇流点右侧)后单点解码",
     "在 MyQi21SpeedSelect 四选一处汇流(选择件居汇流点右侧;「自动 · 按型」档"
     "按型名现算路由)后单点解码"),
]


class PostFail(Exception):
    """术后终验未过(探针路径不 exit,由调用方定性)。"""


def fail(msg: str) -> None:
    print(f"[{CAMPAIGN}/{TAG}] FAIL: {msg}")
    sys.exit(1)


def _md5(data: bytes) -> str:
    return hashlib.md5(data).hexdigest()


def _load(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    return json.loads(raw), raw


def _sg_of(doc: dict, sgid: str) -> dict:
    for sg in doc["definitions"]["subgraphs"]:
        if sg["id"] == sgid:
            return sg
    raise KeyError(sgid)


def _node(nodes: list, nid: int) -> dict:
    for n in nodes:
        if n["id"] == nid:
            return n
    raise KeyError(nid)


def _names(entries: list) -> list:
    return [e["name"] for e in entries]


def _widget_anchors_main(host7: dict, spd: dict, sel: dict) -> list:
    """主件四面+命名双写锚(术后应全=AUTO)。"""
    return [
        ("host7.wv[0]", host7["widgets_values"][0]),
        ("host7.named[速度档位]", host7.get("widgets_values_named", {}).get("速度档位")),
        ("spd.widgets[0]", spd.get("widgets", [None])[0]),
        ("7015.wv[0]", sel["widgets_values"][0]),
        ("7015.named[mode]", sel.get("widgets_values_named", {}).get("mode")),
    ]


def _widget_anchors_bp(root: dict, sg: dict, sel: dict) -> list:
    return [
        ("bp-root.wv[0]", root.get("widgets_values", [None])[0]),
        ("bp-root.named[速度档位]", root.get("widgets_values_named", {}).get("速度档位")),
        ("bp-def.widgets[0]", sg.get("widgets", [None])[0]),
        ("bp-7015.wv[0]", sel["widgets_values"][0]),
        ("bp-7015.named[mode]", sel.get("widgets_values_named", {}).get("mode")),
    ]


# ══════════════════════ 术前锚验(fail-closed)══════════════════════
def verify_pre_main(doc: dict) -> None:
    host6 = _node(doc["nodes"], 6)
    host7 = _node(doc["nodes"], 7)
    asm = _sg_of(doc, ASM_SGID)
    spd = _sg_of(doc, SPD_SGID)
    if host6["type"] != ASM_SGID or host6.get("properties", {}).get("subgraph") != ASM_SGID:
        fail("[6] 非装配子图宿主(术前锚失)")
    if host7["type"] != SPD_SGID or host7.get("properties", {}).get("subgraph") != SPD_SGID:
        fail("[7] 非加速子图宿主(术前锚失)")
    # pre 断言拒动:AI扩写形(MyQi21ApiPE)在场=已被重写,本脚本拒动按 risks 重勘
    if any(n["type"] == "MyQi21ApiPE" for n in asm["nodes"]):
        fail("i2i [6] 已被重写为 AI扩写形(MyQi21ApiPE 在场)——pre 断言拒动,"
             "按 risks 重勘(本脚本只施 PE-I2I 旧形)")
    if not any(n["type"] == "TextGenerate" for n in asm["nodes"]):
        fail("ASM def 非 PE-I2I 旧形(TextGenerate 不在场;术前锚失)")
    b4010 = _node(asm["nodes"], 4010)
    if b4010["type"] != "MyQi21DaojieBase":
        fail("ASM def [4010] 非 MyQi21DaojieBase(术前锚失)")
    if _names(b4010["outputs"]) != BASE_OUTPUTS_PRE:
        fail(f"ASM def [4010] 出口形非五出旧形:{_names(b4010['outputs'])}")
    if _names(asm["outputs"]) != ASM_DEF_OUTPUTS_PRE or _names(host6["outputs"]) != ASM_DEF_OUTPUTS_PRE:
        fail("ASM def / 宿主 [6] outputs 形非四出旧形(术前锚失)")
    if _names(spd["inputs"]) != SPD_DEF_INPUTS_PRE:
        fail(f"SPD def inputs 形非八入旧形:{_names(spd['inputs'])}")
    if _names(host7["inputs"]) != HOST7_INPUTS_PRE:
        fail(f"宿主 [7] inputs 形非旧形:{_names(host7['inputs'])}")
    sel = _node(spd["nodes"], 7015)
    if sel["type"] != "MyQi21SpeedSelect":
        fail("SPD def [7015] 非 MyQi21SpeedSelect(术前锚失)")
    if _names(sel["inputs"]) != SEL_INPUTS_PRE:
        fail(f"[7015] inputs 形非旧形:{_names(sel['inputs'])}")
    for label, val in _widget_anchors_main(host7, spd, sel):
        if val != OLD:
            fail(f"四面 widget 锚 {label} 非 {OLD!r},得 {val!r}(术前锚失)")
    root_ids = {l[0] for l in doc["links"]}
    asm_ids = {l["id"] for l in asm["links"]}
    spd_ids = {l["id"] for l in spd["links"]}
    for lid, pool, scope in ((ROOT_LINK, root_ids | spd_ids, "root∪spd"),
                             (SPD_INNER, root_ids | spd_ids, "root∪spd"),
                             (ASM_INNER, asm_ids, "asm")):
        if lid in pool:
            fail(f"新线 id {lid} 在 {scope} 空间已占用(id 顺发纪律破坏)")
    n402 = _node(doc["nodes"], 402)
    if n402["type"] != "MarkdownNote":
        fail("[402] 非 MarkdownNote(术前锚失)")
    wv = n402.get("widgets_values")
    named = n402.get("widgets_values_named")
    if not (isinstance(wv, list) and wv and isinstance(wv[0], str)):
        fail("[402] 短卡字段缺失(术前锚失)")
    if not (isinstance(named, dict) and isinstance(named.get("text"), str)):
        fail("[402] 长文字段缺失(术前锚失)")
    for rid, old, _n in NOTE_SUBS_SHORT:
        if old not in wv[0]:
            fail(f"Note 短卡锚 {rid} 未命中(术前锚失):{old[:40]!r}")
    for rid, old, _n in NOTE_SUBS_LONG:
        if old not in named["text"]:
            fail(f"Note 长文锚 {rid} 未命中(术前锚失):{old[:40]!r}")


def verify_pre_asm_bp(doc: dict) -> None:
    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, ASM_SGID)
    if root["type"] != ASM_SGID:
        fail("ASM 蓝图 root 节点非子图实例(术前锚失)")
    if any(n["type"] == "MyQi21ApiPE" for n in sg["nodes"]):
        fail("ASM 蓝图 def 已是 AI扩写形——pre 断言拒动,按 risks 重勘")
    b4010 = _node(sg["nodes"], 4010)
    if b4010["type"] != "MyQi21DaojieBase" or _names(b4010["outputs"]) != BASE_OUTPUTS_PRE:
        fail("ASM 蓝图 def [4010] 出口形非五出旧形(术前锚失)")
    if _names(sg["outputs"]) != ASM_DEF_OUTPUTS_PRE or _names(root["outputs"]) != ASM_DEF_OUTPUTS_PRE:
        fail("ASM 蓝图 def/root outputs 形非四出旧形(术前锚失)")
    if ASM_INNER in {l["id"] for l in sg["links"]}:
        fail(f"ASM 蓝图内线 id {ASM_INNER} 已占用")


def verify_pre_spd_bp(doc: dict) -> None:
    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, SPD_SGID)
    if root["type"] != SPD_SGID:
        fail("SPD 蓝图 root 节点非子图实例(术前锚失)")
    if _names(sg["inputs"]) != SPD_DEF_INPUTS_PRE:
        fail(f"SPD 蓝图 def inputs 形非八入旧形:{_names(sg['inputs'])}")
    sel = _node(sg["nodes"], 7015)
    if _names(sel["inputs"]) != SEL_INPUTS_PRE:
        fail(f"SPD 蓝图 [7015] inputs 形非旧形(术前锚失)")
    for label, val in _widget_anchors_bp(root, sg, sel):
        if val != OLD:
            fail(f"SPD 蓝图 widget 锚 {label} 非 {OLD!r}(术前锚失)")
    used = {l["id"] for l in sg["links"]} | {l[0] for l in doc["links"]}
    if BP_SPD_INNER in used:
        fail(f"SPD 蓝图新线 id {BP_SPD_INNER} 已占用")


# ══════════════════════ 手术(A-E 段)══════════════════════
def surgery_main(doc: dict) -> None:
    host6 = _node(doc["nodes"], 6)
    host7 = _node(doc["nodes"], 7)
    asm = _sg_of(doc, ASM_SGID)
    spd = _sg_of(doc, SPD_SGID)
    sel = _node(spd["nodes"], 7015)
    b4010 = _node(asm["nodes"], 4010)

    # A:ASM def 型名出线穿界(PE-I2I 形零触碰其余节点)
    b4010["outputs"].append({"localized_name": "型名", "name": "型名",
                             "type": "STRING", "slot_index": 5, "links": [ASM_INNER]})
    asm["outputs"].append({"id": ASM_OUT_UUID, "name": "型名", "type": "STRING",
                           "linkIds": [ASM_INNER], "pos": list(ASM_OUT_POS)})
    asm["links"].append({"id": ASM_INNER, "origin_id": 4010, "origin_slot": 5,
                         "target_id": -20, "target_slot": len(asm["outputs"]) - 1,
                         "type": "STRING"})
    if "last_link_id" in asm:
        asm["last_link_id"] = max(asm["last_link_id"], ASM_INNER)
    asm.setdefault("state", {})["lastLinkId"] = max(
        asm["state"].get("lastLinkId") or 0, ASM_INNER)

    # B:宿主 [6] outputs 镜像
    host6["outputs"].append({"name": "型名", "type": "STRING", "links": [ROOT_LINK]})

    # C:根线(恒向右 [6]→[7];零组框触碰)
    doc["links"].append([ROOT_LINK, 6, HOST6_OUT_IDX, 7, HOST7_IN_IDX, "STRING"])
    host7["inputs"].append({"name": "型名", "type": "STRING", "link": ROOT_LINK})

    # D:SPD def 型名入槽 + id7 宿主值翻转(四面双写)
    spd_origin_slot = len(spd["inputs"])
    spd["inputs"].append({"id": SPD_IN_UUID, "name": "型名", "type": "STRING",
                          "linkIds": [SPD_INNER], "pos": list(SPD_IN_POS)})
    spd["links"].append({"id": SPD_INNER, "origin_id": -10,
                         "origin_slot": spd_origin_slot,
                         "target_id": 7015, "target_slot": 4, "type": "STRING"})
    sel["inputs"].append({"localized_name": "型名", "name": "型名",
                          "shape": 7, "type": "STRING", "link": SPD_INNER})
    for values in (host7["widgets_values"], spd["widgets"], sel["widgets_values"]):
        values[0] = AUTO
    host7.setdefault("widgets_values_named", {})["速度档位"] = AUTO
    sel.setdefault("widgets_values_named", {})["mode"] = AUTO
    spd.setdefault("state", {})["lastLinkId"] = max(
        spd["state"].get("lastLinkId") or 0, SPD_INNER)
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, ROOT_LINK, SPD_INNER)

    # E:Note 402 双异文分理 R4(短卡)/R5-R7(长文)
    n402 = _node(doc["nodes"], 402)
    for _rid, old, new in NOTE_SUBS_SHORT:
        n402["widgets_values"][0] = n402["widgets_values"][0].replace(old, new)
    for _rid, old, new in NOTE_SUBS_LONG:
        n402["widgets_values_named"]["text"] = \
            n402["widgets_values_named"]["text"].replace(old, new)


def surgery_asm_bp(doc: dict) -> None:
    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, ASM_SGID)
    b4010 = _node(sg["nodes"], 4010)
    b4010["outputs"].append({"localized_name": "型名", "name": "型名",
                             "type": "STRING", "slot_index": 5, "links": [ASM_INNER]})
    sg["outputs"].append({"id": ASM_OUT_UUID, "name": "型名", "type": "STRING",
                          "linkIds": [ASM_INNER], "pos": list(ASM_OUT_POS)})
    sg["links"].append({"id": ASM_INNER, "origin_id": 4010, "origin_slot": 5,
                        "target_id": -20, "target_slot": len(sg["outputs"]) - 1,
                        "type": "STRING"})
    if "last_link_id" in sg:
        sg["last_link_id"] = max(sg["last_link_id"], ASM_INNER)
    sg.setdefault("state", {})["lastLinkId"] = max(
        sg["state"].get("lastLinkId") or 0, ASM_INNER)
    root["outputs"].append({"name": "型名", "type": "STRING", "links": []})
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, ASM_INNER)  # 顶层 0→286


def surgery_spd_bp(doc: dict) -> None:
    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, SPD_SGID)
    sel = _node(sg["nodes"], 7015)
    spd_origin_slot = len(sg["inputs"])
    sg["inputs"].append({"id": SPD_IN_UUID, "name": "型名", "type": "STRING",
                         "linkIds": [BP_SPD_INNER], "pos": list(SPD_IN_POS)})
    sg["links"].append({"id": BP_SPD_INNER, "origin_id": -10,
                        "origin_slot": spd_origin_slot,
                        "target_id": 7015, "target_slot": 4, "type": "STRING"})
    sel["inputs"].append({"localized_name": "型名", "name": "型名",
                          "shape": 7, "type": "STRING", "link": BP_SPD_INNER})
    root["inputs"].append({"name": "型名", "type": "STRING", "link": None})
    for values in (root["widgets_values"], sg["widgets"], sel["widgets_values"]):
        values[0] = AUTO
    root.setdefault("widgets_values_named", {})["速度档位"] = AUTO
    sel.setdefault("widgets_values_named", {})["mode"] = AUTO
    sg.setdefault("state", {})["lastLinkId"] = max(
        sg["state"].get("lastLinkId") or 0, BP_SPD_INNER)
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, BP_SPD_INNER)


# ══════════════════════ 术后终验(内存态+回读终验共用;全 PASS 才算数)═══════════
def verify_post_main(doc: dict) -> list[str]:
    ok: list[str] = []

    def chk(cond: bool, label: str) -> None:
        if cond:
            ok.append(label)
        else:
            raise PostFail(label)

    host6 = _node(doc["nodes"], 6)
    host7 = _node(doc["nodes"], 7)
    asm = _sg_of(doc, ASM_SGID)
    spd = _sg_of(doc, SPD_SGID)
    sel = _node(spd["nodes"], 7015)
    b4010 = _node(asm["nodes"], 4010)
    chk(_names(b4010["outputs"]) == BASE_OUTPUTS_PRE + ["型名"]
        and b4010["outputs"][5]["links"] == [ASM_INNER],
        "A: [4010] 第六出「型名」slot5→内线286")
    chk(_names(asm["outputs"]) == ASM_DEF_OUTPUTS_PRE + ["型名"]
        and asm["outputs"][4]["linkIds"] == [ASM_INNER]
        and asm["outputs"][4]["id"] == ASM_OUT_UUID,
        "A: ASM def outputs 镜像「型名」(pin 恒向右)")
    asm_link = next((l for l in asm["links"] if l["id"] == ASM_INNER), None)
    chk(asm_link == {"id": ASM_INNER, "origin_id": 4010, "origin_slot": 5,
                     "target_id": -20, "target_slot": 4, "type": "STRING"},
        "A: 内线286 = 4010:5 → -20:4")
    chk("last_link_id" not in asm
        and (asm.get("state", {}).get("lastLinkId") or 0) >= ASM_INNER,
        "A: ASM def state.lastLinkId 285→286(沿无顶层键现形)")
    chk(_names(host6["outputs"]) == ASM_DEF_OUTPUTS_PRE + ["型名"]
        and host6["outputs"][HOST6_OUT_IDX]["links"] == [ROOT_LINK],
        "B: 宿主 [6] outputs 镜像「型名」")
    chk([ROOT_LINK, 6, HOST6_OUT_IDX, 7, HOST7_IN_IDX, "STRING"] in doc["links"]
        and doc["last_link_id"] == SPD_INNER,
        "C: 根线4412 [6]:4→[7]:5 STRING;root 计数器→4413")
    chk(_names(host7["inputs"]) == HOST7_INPUTS_PRE + ["型名"]
        and host7["inputs"][HOST7_IN_IDX]["link"] == ROOT_LINK,
        "D: 宿主 [7] 新输入槽「型名」(idx5)接根线")
    spd_link = next((l for l in spd["links"] if l["id"] == SPD_INNER), None)
    chk(_names(spd["inputs"]) == SPD_DEF_INPUTS_PRE + ["型名"]
        and spd["inputs"][-1]["linkIds"] == [SPD_INNER]
        and spd["inputs"][-1]["id"] == SPD_IN_UUID
        and spd_link == {"id": SPD_INNER, "origin_id": -10,
                         "origin_slot": len(SPD_DEF_INPUTS_PRE),
                         "target_id": 7015, "target_slot": 4, "type": "STRING"},
        "D: SPD def 入槽「型名」+内线4413 -10:8→7015:4")
    chk(_names(sel["inputs"]) == SEL_INPUTS_PRE + ["型名"]
        and sel["inputs"][4]["link"] == SPD_INNER
        and (spd.get("state", {}).get("lastLinkId") or 0) >= SPD_INNER,
        "D: [7015]「型名」入槽(尾加,shape7)")
    chk(all(val == AUTO for _l, val in _widget_anchors_main(host7, spd, sel)),
        "D: id7 宿主值翻转四面双写=「自动 · 按型」")
    n402 = _node(doc["nodes"], 402)
    wv0 = n402["widgets_values"][0]
    text = n402["widgets_values_named"]["text"]
    chk(all(old not in wv0 for _r, old, _n in NOTE_SUBS_SHORT)
        and all(new in wv0 for _r, _o, new in NOTE_SUBS_SHORT)
        and all(old not in text for _r, old, _n in NOTE_SUBS_LONG)
        and all(new in text for _r, _o, new in NOTE_SUBS_LONG),
        "E: Note 402 双异文分理 R4(短卡)/R5-R7(长文)施毕")
    chk(OLD not in wv0 and OLD not in text,
        "E: Note 双字段旧档串「0 · Turbo 8步」计数=0")
    for line in _dangling_checks(doc, asm, spd):
        ok.append(line)
    if len(ok) != 15:
        raise PostFail(f"主件术后终验缺项({len(ok)}/15)")
    return ok


def verify_post_asm_bp(doc: dict) -> list[str]:
    ok: list[str] = []

    def chk(cond: bool, label: str) -> None:
        if cond:
            ok.append(label)
        else:
            raise PostFail(label)

    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, ASM_SGID)
    b4010 = _node(sg["nodes"], 4010)
    chk(_names(b4010["outputs"]) == BASE_OUTPUTS_PRE + ["型名"]
        and b4010["outputs"][5]["links"] == [ASM_INNER],
        "A: 蓝图 def [4010] 第六出「型名」")
    chk(_names(sg["outputs"]) == ASM_DEF_OUTPUTS_PRE + ["型名"]
        and sg["outputs"][4]["linkIds"] == [ASM_INNER]
        and sg["outputs"][4]["id"] == ASM_OUT_UUID,
        "A: 蓝图 def outputs「型名」")
    link = next((l for l in sg["links"] if l["id"] == ASM_INNER), None)
    chk(link == {"id": ASM_INNER, "origin_id": 4010, "origin_slot": 5,
                 "target_id": -20, "target_slot": 4, "type": "STRING"},
        "A: 蓝图内线286 端点逐字")
    chk(_names(root["outputs"]) == ASM_DEF_OUTPUTS_PRE + ["型名"]
        and root["outputs"][4]["links"] == []
        and doc["last_link_id"] == ASM_INNER
        and (sg.get("state", {}).get("lastLinkId") or 0) >= ASM_INNER,
        "B: 蓝图壳 root 镜像+顶层计数器 0→286(计划定号)")
    for line in _dangling_checks(doc, sg, None):
        ok.append(line)
    if len(ok) != 6:
        raise PostFail(f"ASM 蓝图术后终验缺项({len(ok)}/6)")
    return ok


def verify_post_spd_bp(doc: dict) -> list[str]:
    ok: list[str] = []

    def chk(cond: bool, label: str) -> None:
        if cond:
            ok.append(label)
        else:
            raise PostFail(label)

    root = _node(doc["nodes"], 1)
    sg = _sg_of(doc, SPD_SGID)
    sel = _node(sg["nodes"], 7015)
    link = next((l for l in sg["links"] if l["id"] == BP_SPD_INNER), None)
    chk(_names(sg["inputs"]) == SPD_DEF_INPUTS_PRE + ["型名"]
        and sg["inputs"][-1]["linkIds"] == [BP_SPD_INNER]
        and sg["inputs"][-1]["id"] == SPD_IN_UUID
        and link == {"id": BP_SPD_INNER, "origin_id": -10,
                     "origin_slot": len(SPD_DEF_INPUTS_PRE),
                     "target_id": 7015, "target_slot": 4, "type": "STRING"},
        "D: 蓝图 def 入槽「型名」+内线4409 -10:8→7015:4")
    chk(_names(sel["inputs"]) == SEL_INPUTS_PRE + ["型名"]
        and sel["inputs"][4]["link"] == BP_SPD_INNER,
        "D: 蓝图 [7015]「型名」入槽")
    chk(_names(root["inputs"]) == SPD_DEF_INPUTS_PRE + ["型名"]
        and root["inputs"][-1]["link"] is None
        and doc["last_link_id"] == BP_SPD_INNER
        and (sg.get("state", {}).get("lastLinkId") or 0) >= BP_SPD_INNER,
        "D: 蓝图壳 root 输入镜像+顶层计数器 4408→4409 同抬")
    chk(all(val == AUTO for _l, val in _widget_anchors_bp(root, sg, sel)),
        "D: 蓝图四面双写=「自动 · 按型」")
    for line in _dangling_checks(doc, sg, None):
        ok.append(line)
    if len(ok) != 6:
        raise PostFail(f"SPD 蓝图术后终验缺项({len(ok)}/6)")
    return ok


def _dangling_checks(doc: dict, asm: dict, spd: dict | None) -> list[str]:
    """无悬空线:所有被引用的线 id 存在;所有线端点节点存在(-10/-20 除外)。"""
    out: list[str] = []
    root_ids = {n["id"] for n in doc["nodes"]}
    root_link_ids = {l[0] for l in doc["links"]}
    bad = []
    for n in doc["nodes"]:
        for i in n.get("inputs", []):
            if isinstance(i.get("link"), int) and i["link"] not in root_link_ids:
                bad.append(("root-in", n["id"], i["link"]))
        for o in n.get("outputs", []):
            for lid in (o.get("links") or []):
                if lid not in root_link_ids:
                    bad.append(("root-out", n["id"], lid))
    for l in doc["links"]:
        if l[1] not in root_ids or l[3] not in root_ids:
            bad.append(("root-endpoint", l[0]))
    out.append(f"V: 主层{'无悬空线' if not bad else f'悬空线 {bad[:3]}'}")
    for tag, sg in (("asm", asm), ("spd", spd)):
        if sg is None:
            continue
        sids = {l["id"] for l in sg["links"]}
        nids = {n["id"] for n in sg["nodes"]} | {-10, -20}
        bad = []
        for n in sg["nodes"]:
            for i in n.get("inputs", []):
                if isinstance(i.get("link"), int) and i["link"] not in sids:
                    bad.append((tag, n["id"], i["link"]))
            for o in n.get("outputs", []):
                for lid in (o.get("links") or []):
                    if lid not in sids:
                        bad.append((tag, n["id"], lid))
        for io in sg.get("inputs", []) + sg.get("outputs", []):
            for lid in io.get("linkIds", []):
                if lid not in sids:
                    bad.append((tag, io["name"], lid))
        for l in sg["links"]:
            if l["origin_id"] not in nids or l["target_id"] not in nids:
                bad.append((tag, "endpoint", l["id"]))
        out.append(f"V: {'装配' if tag == 'asm' else '加速'}子图 def "
                   f"{'无悬空线' if not bad else f'悬空线 {bad[:3]}'}")
    return out


def old_counts(doc: dict, kind: str) -> dict:
    """分文件档位旧串计数(术后应全 0)。"""
    out: dict = {}
    if kind == "main":
        host7 = _node(doc["nodes"], 7)
        spd = _sg_of(doc, SPD_SGID)
        sel = _node(spd["nodes"], 7015)
        anchors = _widget_anchors_main(host7, spd, sel)
        n402 = _node(doc["nodes"], 402)
        fields = [n402["widgets_values"][0], n402["widgets_values_named"]["text"]]
        out["Note旧串"] = sum(f.count(OLD) for f in fields)
        for rid, old, _n in NOTE_SUBS_SHORT + NOTE_SUBS_LONG:
            out[f"Note{rid}旧句"] = sum(f.count(old) for f in fields)
    else:
        anchors = []
        if kind == "spd_bp":
            root = _node(doc["nodes"], 1)
            sg = _sg_of(doc, SPD_SGID)
            sel = _node(sg["nodes"], 7015)
            anchors = _widget_anchors_bp(root, sg, sel)
    out["widget旧默认"] = sum(1 for _l, v in anchors if v == OLD)
    return out


# ══════════════════════ 主流程 ═══════════════════════
POST_FN = {"main": verify_post_main, "asm_bp": verify_post_asm_bp,
           "spd_bp": verify_post_spd_bp}
PRE_FN = {"main": verify_pre_main, "asm_bp": verify_pre_asm_bp,
          "spd_bp": verify_pre_spd_bp}
SURGERY = {"main": surgery_main, "asm_bp": surgery_asm_bp,
           "spd_bp": surgery_spd_bp}


def process(path: Path, kind: str) -> str:
    """returns 'applied'(已施态)or 'done'(本轮回写)。"""
    label = path.name
    doc, raw = _load(path)
    digest0 = _md5(raw)
    try:
        for line in POST_FN[kind](doc):
            print(f"[{CAMPAIGN}/{TAG}] {label}: PASS {line}")
        counts = old_counts(doc, kind)
        leftover = {k: v for k, v in counts.items() if v}
        if leftover:
            fail(f"{label}: 已施态但旧串计数非零 {leftover}")
        for k, v in counts.items():
            print(f"[{CAMPAIGN}/{TAG}] {label}: 旧串计数 {k}={v}(应全 0)")
        return "applied"
    except PostFail:
        pass  # 未施态 → 走术前验+施术
    try:
        PRE_FN[kind](doc)
    except SystemExit:
        fail(f"{label}: 术前锚失且非全施态(半态/漂移),拒动 fail-closed")

    mtime0 = path.stat().st_mtime
    SURGERY[kind](doc)
    try:
        POST_FN[kind](doc)  # 内存态先验,败则不落盘
    except PostFail as exc:
        fail(f"{label}: 内存态术后验未过({exc}),不落盘")
    counts = old_counts(doc, kind)
    leftover = {k: v for k, v in counts.items() if v}
    if leftover:
        fail(f"{label}: 术后旧串计数非零 {leftover}")
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode("utf-8")
    json.loads(blob)  # 往返断言
    bak = path.with_name(path.name + f".bak-{CAMPAIGN}")
    if not bak.exists():
        shutil.copy2(path, bak)
    if _md5(bak.read_bytes()) != digest0:
        fail(f"{label}: 备份 md5 与术前锚不符(备份损坏),中止")
    if path.stat().st_mtime != mtime0:
        fail(f"{label}: mtime 守卫触发(读→写窗口被并行役改动),中止")
    tmp = path.with_name(path.name + f".tmp-{CAMPAIGN}")
    tmp.write_bytes(blob)
    tmp.replace(path)
    # 回读终验:盘上重解析重验,败则回滚
    reread = json.loads(path.read_bytes())
    try:
        for line in POST_FN[kind](reread):
            print(f"[{CAMPAIGN}/{TAG}] {label}: PASS {line}")
    except PostFail as exc:
        shutil.copy2(bak, path)
        fail(f"{label}: 回读终验未过({exc}),已回滚备份 {bak.name}")
    for k, v in counts.items():
        print(f"[{CAMPAIGN}/{TAG}] {label}: 旧串计数 {k}={v}(应全 0)")
    print(f"[{CAMPAIGN}/{TAG}] {label}: 术前md5锚={digest0} 备份={bak.name}")
    return "done"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", default=TAG, help=f"施术目标(本脚本仅 {TAG})")
    ap.add_argument("--check", action="store_true", help="只读清点,不改")
    args = ap.parse_args()
    if args.target != TAG:
        print(f"[{CAMPAIGN}/{TAG}] 目标不符:--target {args.target}(本脚本仅 {TAG})")
        return 2
    for path in (MAIN, ASM_BP, SPD_BP):
        if not path.exists():
            fail(f"缺目标文件:{path}")
    if args.check:
        state = {}
        for path, kind in ((MAIN, "main"), (ASM_BP, "asm_bp"), (SPD_BP, "spd_bp")):
            doc, _ = _load(path)
            try:
                POST_FN[kind](doc)
                state[path.name] = "已施"
            except PostFail:
                state[path.name] = "未施"
        print(f"[{CAMPAIGN}/{TAG}] --check: {state}")
        vals = set(state.values())
        if len(vals) == 1:
            return 3 if "已施" in vals else 0
        fail(f"--check: 三件状态不一致(半批) {state}")
    results = [process(MAIN, "main"), process(ASM_BP, "asm_bp"),
               process(SPD_BP, "spd_bp")]
    names = [MAIN.name, ASM_BP.name, SPD_BP.name]
    if "applied" in results and "done" in results:
        fail(f"三件施术态不一致(半批):{dict(zip(names, results))}")
    if all(r == "applied" for r in results):
        print(f"[{CAMPAIGN}/{TAG}] 幂等复跑:三件均处已施态,自验全 PASS,exit 3")
        return 3
    print(f"[{CAMPAIGN}/{TAG}] 手术完成:主件+两蓝图三份(.bak-{CAMPAIGN} 三份备份,"
          f"回读终验全 PASS,旧串计数全 0;本步后契约预期过渡红)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
