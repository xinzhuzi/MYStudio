#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 i2i/edit 结构债清偿 1008(用户令「做」,深度审核余账 ①②):

① i2i [4010] 实例补五出(负面词@槽3/透明值@槽4)+rgba_hint 连线#55 迁槽4
   ——STRING→BOOLEAN 失配解除,提交期 return_type_mismatch 拒单风险消除;
② i2i/edit PromptSelect 实例([4014]/[153])对齐类九槽形:inputs 补
   「负面词直写」「PE负面」条目、widgets_values 旧七值按类声明序重排为九值
   (pe开关/透明模式/头尾W1 各归位)、outputs 补类双口第二出(slot0 更名
   「进编码正向文本」保原 links,附「进编码负向文本」空出);
③ i2i [402] 卡「⚠ 已知结构债」注改「✅ 已清」注(卡实同步,防再造漂移)。

落点(五树普查 1008:实例仅此四数据文件):i2i 工作流×3(仓库/装机/构建)、
i2i 库件×4(+引擎家 custom_nodes/my-nodes)、edit 工作流×3、edit 库件×4;
wf 内嵌子图与库件两成员目标节点术前逐字节互验。
DRY_RUN=1 只验不写。幂等:已五出则跳过该文件。
"""
import hashlib
import json
import os
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF_I2I = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
WF_EDIT = "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-edit.json"
LIB_I2I = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
LIB_EDIT = "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-edit.json"

def deployed(rel, lib):
    sub = rel.replace("apps/backend/", "backend/", 1)
    base = [
        (REPO / rel),
        Path("/Applications/漫影工作室.app/Contents/Resources") / sub,
        REPO / "apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources" / sub,
    ]
    if lib:
        base.append(Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes/subgraphs" / Path(rel).name)
    return base

FAMILIES = [
    ("i2i 工作流", deployed(WF_I2I, False)),
    ("i2i 库件", deployed(LIB_I2I, True)),
    ("edit 工作流", deployed(WF_EDIT, False)),
    ("edit 库件", deployed(LIB_EDIT, True)),
]
DRY = os.environ.get("DRY_RUN", "") == "1"

CARD_OLD = "- ⚠ 已知结构债(1005 复核在册债2 同族,本役审计坐实):本件 [4010] 实例仍是四出无「负面词」出槽,而节点源码 1007 起为五出(负面词=槽3/透明值=槽4);rgba_hint 连线(#55,origin_slot=3)是 STRING→BOOLEAN 类型失配(引擎 execution.py validate_inputs 按 origin 节点类 RETURN_TYPES 现解析校验,两件均无 VALIDATE_INPUTS 豁免):前端保线=提交期 return_type_mismatch 拒单(整单被拒,比旧注「恒真」更重),前端掉线=rgba_hint 恒 False=透明恒关(与旧注相反)——「恒真」分支不存在;修法=实例补五出+连线迁槽4(随 1005 案B i2i 推广役同批,实弹定谳)。"
CARD_NEW = "- ✅ 结构债已清(1008 主会话「做」令):[4010] 实例补五出(负面词@槽3/透明值@槽4)+rgba_hint 连线#55 迁槽4(origin_slot 3→4)——STRING→BOOLEAN 失配解除,提交期拒单风险消除,透明自动恢复有效;[4014]/[153] widgets 同批对齐类九槽(负面词直写/PE负面 补位,pe开关/透明模式/头尾W1 各归位,类双口补第二出)。史注:曾为四出+槽3 失配(引擎按类校验=拒单或掉线,「恒真」不存在);实弹复验候下次 i2i 出图。"


def fail(msg):
    print("ABORT:", msg)
    sys.exit(1)


def subgraph_of(d):
    hits = [s for s in d["definitions"]["subgraphs"] if "文本提示词" in (s.get("name") or "")]
    if len(hits) != 1:
        fail(f"子图定位失败: {[s.get('name') for s in d['definitions']['subgraphs']]}")
    return hits[0]


def fix_base(nd):
    outs = nd["outputs"]
    if [o["name"] for o in outs] == ["BASE", "WIDTH", "HEIGHT", "负面词", "透明值"]:
        return "已五出,跳过"
    if [o["name"] for o in outs] != ["BASE", "WIDTH", "HEIGHT", "透明值"]:
        fail(f"[4010] 出口名册意外: {[o['name'] for o in outs]}")
    nd["outputs"] = [
        outs[0], outs[1], outs[2],
        {"name": "负面词", "type": "STRING", "links": [], "slot_index": 3},
        {**outs[3], "slot_index": 4},
    ]
    return "四出→五出"


def fix_link55(sg):
    for l in sg["links"]:
        if l["id"] == 55:
            if l["origin_slot"] == 4:
                return "link55 已在槽4"
            if not (l["origin_id"] == 4010 and l["origin_slot"] == 3 and l["type"] == "BOOLEAN"):
                fail(f"link55 形状意外: {l}")
            l["origin_slot"] = 4
            return "link55 槽3→槽4"
    fail("link55 未找到")


def fix_select(nd):
    ins = nd["inputs"]
    names = [i["name"] for i in ins]
    wv = nd["widgets_values"]
    outs = nd["outputs"]
    if "负面词直写" in names:
        return "已九槽,跳过"
    if names != ["装配全文", "PE出文", "pe开关", "透明模式", "RGBA官方头句", "RGBA官方尾句", "W1收束句"]:
        fail(f"[{nd['id']}] inputs 名册意外: {names}")
    if not (isinstance(wv, list) and len(wv) == 7):
        fail(f"[{nd['id']}] wv 形状意外: {wv!r:.80}")
    _, _, pe, tr, head, tail, w1 = wv
    nd["widgets_values"] = ["", "", "", "", bool(pe), bool(tr), head, tail, w1]
    ent = lambda n, t: {"name": n, "type": t, "widget": {"name": n}, "link": None}
    ins.insert(names.index("装配全文") + 1, ent("负面词直写", "STRING"))
    ins.insert(names.index("PE出文") + 2, ent("PE负面", "STRING"))
    if not (len(outs) == 1 and outs[0]["name"] == "进编码文本"):
        fail(f"[{nd['id']}] outputs 形状意外: {outs}")
    outs[0]["name"] = "进编码正向文本"
    outs.append({"name": "进编码负向文本", "type": "STRING", "links": [], "slot_index": 1})
    return f"[{nd['id']}] 七槽→九槽+双口"


def transform(path, is_i2i):
    d = json.loads(Path(path).read_text(encoding="utf-8"))
    sg = subgraph_of(d)
    log = []
    for nd in sg["nodes"]:
        if nd["type"] == "MyQi21DaojieBase":
            log.append(f"[{nd['id']}]{fix_base(nd)}")
    if is_i2i:
        log.append(fix_link55(sg))
    for nd in sg["nodes"]:
        if nd["type"] == "MyQi21PromptSelect":
            log.append(fix_select(nd))
    if is_i2i:
        note = next((n for n in d.get("nodes", []) if n["id"] == 402), None)
        if note is None:
            log.append("无根图 [402] 卡(库件),跳过卡债注")
        else:
            wv = note["widgets_values"]
            if CARD_NEW[:30] in wv[0]:
                log.append("卡债注已清,跳过")
            elif wv[0].count(CARD_OLD) != 1:
                fail("i2i 卡债注原串命中 !=1")
            else:
                wv[0] = wv[0].replace(CARD_OLD, CARD_NEW)
                log.append("卡债注→已清")
    return d, log


def main():
    # 术前:四家族 md5 各自一致(wf 与 lib 分属两家族,内容互验在节点层做)
    for name, fam in FAMILIES:
        sigs = {hashlib.md5(p.read_bytes()).hexdigest() for p in fam if p.exists()}
        miss = [str(p) for p in fam if not p.exists()]
        if miss or len(sigs) != 1:
            fail(f"{name} 家族副本不一致/缺失: {miss or sigs}")
    print("[pre] 四家族 md5 各自一致 ✓")

    # wf 内嵌 vs 库件:目标节点术前逐字节互验
    wf_i2i_d = json.loads((REPO / WF_I2I).read_text(encoding="utf-8"))
    lib_i2i_d = json.loads((REPO / LIB_I2I).read_text(encoding="utf-8"))
    edit_wf_d = json.loads((REPO / WF_EDIT).read_text(encoding="utf-8"))
    edit_lib_d = json.loads((REPO / LIB_EDIT).read_text(encoding="utf-8"))
    for a, b, tag in ((wf_i2i_d, lib_i2i_d, "i2i"), (edit_wf_d, edit_lib_d, "edit")):
        na = {n["id"]: n for n in subgraph_of(a)["nodes"] if n["type"] in ("MyQi21DaojieBase", "MyQi21PromptSelect")}
        nb = {n["id"]: n for n in subgraph_of(b)["nodes"] if n["type"] in ("MyQi21DaojieBase", "MyQi21PromptSelect")}
        if json.dumps(na, sort_keys=True, ensure_ascii=False) != json.dumps(nb, sort_keys=True, ensure_ascii=False):
            fail(f"{tag}: wf 内嵌与库件目标节点术前不一致")
    print("[pre] wf/库件目标节点术前互验一致 ✓")

    results = {}
    for path, is_i2i in ((REPO / WF_I2I, True), (REPO / LIB_I2I, True), (REPO / WF_EDIT, False), (REPO / LIB_EDIT, False)):
        d, lg = transform(path, is_i2i)
        results[path] = d
        print(f"  [{path.name}] " + "; ".join(lg))

    if DRY:
        print("[dry] 验串全过,未写盘")
        return

    for (name, fam), repo_path in zip(FAMILIES, [REPO / WF_I2I, REPO / LIB_I2I, REPO / WF_EDIT, REPO / LIB_EDIT]):
        repo_path.write_text(json.dumps(results[repo_path], ensure_ascii=False, indent=2, separators=(",", ": ")), encoding="utf-8")
        for dst in fam[1:]:
            shutil.copy2(repo_path, dst)
        for p in fam:
            json.loads(p.read_text(encoding="utf-8"))
            assert hashlib.md5(p.read_bytes()).hexdigest() == hashlib.md5(repo_path.read_bytes()).hexdigest(), p
        print(f"[sync] {name} {len(fam)} 副本同 md5 ✓")

    # 术后结构自证(i2i 库件)
    sg = subgraph_of(json.loads((REPO / LIB_I2I).read_text(encoding="utf-8")))
    base = next(n for n in sg["nodes"] if n["type"] == "MyQi21DaojieBase")
    assert [o["name"] for o in base["outputs"]] == ["BASE", "WIDTH", "HEIGHT", "负面词", "透明值"]
    assert base["outputs"][4]["links"] == [55] and base["outputs"][4]["type"] == "BOOLEAN"
    l55 = next(l for l in sg["links"] if l["id"] == 55)
    assert l55["origin_slot"] == 4 and l55["type"] == "BOOLEAN"
    for nd in sg["nodes"]:
        if nd["type"] == "MyQi21PromptSelect":
            assert len(nd["widgets_values"]) == 9 and len(nd["inputs"]) == 9
            assert [o["name"] for o in nd["outputs"]] == ["进编码正向文本", "进编码负向文本"]
    print("[verify] 术后结构自证 ✓")


if __name__ == "__main__":
    main()
