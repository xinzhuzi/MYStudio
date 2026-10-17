#!/usr/bin/env python3
"""qi21-道劫-i2i 参考图 5→3 收口手术(2026-10-10,用户令「最多也支持3张,5张太多」)。

背景:1010 晨五槽扩展(qi21_i2i_ref5_1010.py)已随 1752568e/6e693716/367b406f
「comfyui融合」三提交入 HEAD;同日用户核对 viggle 官方模型卡(Viggle/Qwen-Image-
2.1-viggle-turbo:instruction-driven editing with **1–3 reference images**;>3 张
仅示例页人工过目无基准)后裁定对齐官方口径收口三槽。历史不回改,本件=HEAD 五槽
态上的前进收口(删二对占位/缩边界/槽位回迁),走廊方案([9]/[19] 南下+[33] 指令
总线拐+[12]/[18] 第三对旁路占位)全数保留。

手术面(工作流+蓝图双侧同刀):
  根图:删 [13]/[14] LoadImage+[26]/[28] 预缩(mode4 占位对)及其四线
       (206/207/209/210);宿主 inputs 摘 image_4/image_5;指令线 217 槽 7→5;
       ②组框文案 五图→三图;[402] 说明随刀。
  子图:边界摘 image_4/image_5(11→9 槽);-10 线 ≥5 槽位回迁 -2(42/62:7→5,
       10:8→6,200:9→7,11:10→8);[4015] 摘 image_4/5 图槽(prompt 7→5);
       [25] 摘 images.image3/4;删子图线 212/213/215/216。
  发号器高水位不动(≥ 实存即可);[12]/[18] 位置与南下重定位全保留。

fail-closed:术前断言(五槽态指纹)不满足即零写入退出 2;术后 coherence 终验
(三图全联动一致性)不过即退出;幂等:已是三槽态拦停退出 3。
"""
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SG_NAME_PREFIX = "[6] 文本提示词类型优化子图"

SG5 = ["clip", "vae", "image_1", "image_2", "image_3", "image_4", "image_5",
       "指令", "型选择", "PE启用?", "RGBA透明"]
SG3 = ["clip", "vae", "image_1", "image_2", "image_3", "指令", "型选择", "PE启用?", "RGBA透明"]
GONE_NODES = (13, 14, 26, 28)          # 两对占位(LoadImage+预缩)
GONE_ROOT_LINKS = (206, 207, 209, 210)  # 其四线
GONE_SG_LINKS = (212, 213, 215, 216)    # image_4/5 的合批+主编码四线

NOTE_EDITS = [
    ("### 参考图五槽(1010 扩展;官方示例双图须先放引擎 input 目录)",
     "### 参考图三槽(1010 扩展+收口对齐 viggle 官方 1-3 张口径;官方示例双图须先放引擎 input 目录)"),
    ("- image_3/4/5 = [12]/[13]/[14] 占位空图,**默认旁路态(Ctrl+B)**——默认行为=双参考不变;要用第 N 张参考=选中对应 LoadImage+预缩对按 Ctrl+B 解旁路→选图→跑;旁路槽零进执行图,PE 合批与主编码自动只吃已解旁路的图(空文件名直跑会被 LoadImage 校验拒)。",
     "- image_3 = [12] 占位空图,**默认旁路态(Ctrl+B)**——默认行为=双参考不变;要用第三张参考=选中 [12]+[18] 按 Ctrl+B 解旁路→选图→跑;旁路槽零进执行图,PE 合批与主编码自动只吃已解旁路的图(空文件名直跑会被 LoadImage 校验拒)。"),
    ("模型契约上限 10 图(节点槽 16);本件实装五槽(1010),再多换 qwen21-multiref-edit。",
     "模型契约上限 10 图(节点槽 16);viggle 蒸馏档官方验证 1-3 张(1010 收口:本件实装三槽对齐),再多走直出40步手动加槽或换 qwen21-multiref-edit。"),
    ("合批全部输入图(经 image_1..image_5 边界,预缩后;旁路槽自动缺席)喂 [4013].image",
     "合批全部输入图(经 image_1..image_3 边界,预缩后;旁路槽自动缺席)喂 [4013].image"),
    ("直出支路 [7010].positive=宿主 positive(多参考至多五图=「1 · 直出40步」档官方路零改动,1010 五槽扩展)",
     "直出支路 [7010].positive=宿主 positive(多参考至多三图=「1 · 直出40步」档官方路零改动,1010 三槽收口=viggle 官方 1-3 张口径)"),
    ("+1010 五参考扩展(qi21_i2i_ref5_1010.py)所得",
     "+1010 三参考扩展(qi21_i2i_ref5_1010.py+qi21_i2i_ref5to3_1010.py 收口)所得"),
]
GROUP_OLD = "五图[10]-[14]+五预缩[16][17][18][21][22](后三对默认旁路)"
GROUP_NEW = "三图[10]-[12]+三预缩[16][17][18](第三对默认旁路)"


def fail(msg, code=2):
    print(f"[ref5to3] FAIL: {msg}")
    sys.exit(code)


def load(p):
    return json.loads(p.read_text(encoding="utf-8"))


def find_sg(doc):
    hits = [s for s in doc.get("definitions", {}).get("subgraphs", [])
            if s.get("name", "").startswith(SG_NAME_PREFIX)]
    if len(hits) != 1:
        fail(f"{p.name} 同名子图定义命中 {len(hits)} 份(预期 1)")
    return hits[0]


def surgery_subgraph(sg, label):
    if [i["name"] for i in sg["inputs"]] == SG3:
        return False  # 已三槽
    if [i["name"] for i in sg["inputs"]] != SG5:
        fail(f"[{label}] 术前边界槽序非五槽态:{[i['name'] for i in sg['inputs']]}")
    nodes = {n["id"]: n for n in sg["nodes"]}
    te, batch = nodes[4015], nodes[25]

    # ① 先删 image_4/5 四线(212/213/215/216,亦 -10 出身——先删后迁防污染迁移集)
    sg["links"] = [l for l in sg["links"] if l["id"] not in GONE_SG_LINKS]

    # ② -10 线槽位回迁:≥5 全部 -2(42/62:7→5;10:8→6;200:9→7;11:10→8;
    #    211/214(image_3@槽4)不动)
    migrated = []
    for l in sg["links"]:
        if l["origin_id"] == -10 and l["origin_slot"] >= 5:
            migrated.append((l["id"], l["origin_slot"], l["origin_slot"] - 2))
            l["origin_slot"] -= 2
    if sorted(m[0] for m in migrated) != [10, 11, 42, 62, 200]:
        fail(f"[{label}] -10 回迁线集合不符:{migrated}")

    # ② [4015]:摘 image_4/5 图槽;prompt 线(20)槽 7→5
    l20 = next(l for l in sg["links"] if l["id"] == 20)
    if not (l20["origin_id"] == 153 and l20["target_id"] == 4015 and l20["target_slot"] == 7):
        fail(f"[{label}] 线 20 术前形态不符:{l20}")
    l20["target_slot"] = 5
    te["inputs"] = [i for i in te["inputs"] if i["name"] not in ("images.image_4", "images.image_5")]

    # ③ [25]:摘 images.image3/4
    batch["inputs"] = [i for i in batch["inputs"] if i["name"] not in ("images.image3", "images.image4")]

    # ④ 边界摘 image_4/5(线已于①删)
    sg["inputs"] = [e for e in sg["inputs"] if e["name"] not in ("image_4", "image_5")]
    return True


def coherence(doc, label, host_expected=True):
    nodes = {n["id"]: n for n in doc["nodes"]}
    for l in doc["links"] if host_expected else []:
        lid, o, os_, t, ts, ty = l[0], l[1], l[2], l[3], l[4], l[5]
        if o not in nodes or t not in nodes:
            fail(f"[{label}] 根线 {lid} 端点缺失")
        outs, ins = nodes[o].get("outputs", []), nodes[t].get("inputs", [])
        if os_ >= len(outs) or ts >= len(ins):
            fail(f"[{label}] 根线 {lid} 槽号越界")
        if ty != "*" and outs[os_]["type"] not in (ty, "*"):
            fail(f"[{label}] 根线 {lid} 源槽类型失配")
        if ins[ts]["type"] not in (ty, "*"):
            fail(f"[{label}] 根线 {lid} 目标槽类型失配")
        if ins[ts].get("link") != lid or lid not in (outs[os_].get("links") or []):
            fail(f"[{label}] 根线 {lid} 三处挂接失配")
    sg = find_sg(doc)
    if host_expected:
        host = nodes[6]
        if [i["name"] for i in host["inputs"]] != [i["name"] for i in sg["inputs"]] \
                or [i["type"] for i in host["inputs"]] != [i["type"] for i in sg["inputs"]]:
            fail(f"[{label}] 宿主/子图 inputs 镜像失配")
        for nid in GONE_NODES:
            if nid in nodes:
                fail(f"[{label}] 节点 {nid} 未删净")
        if any(l[0] in GONE_ROOT_LINKS for l in doc["links"]):
            fail(f"[{label}] 根线未删净")
        l217 = next(l for l in doc["links"] if l[0] == 217)
        if not (l217[1] == 33 and l217[3] == 6 and l217[4] == 5 and l217[5] == "STRING"):
            fail(f"[{label}] 指令总线拐线 217 应 33→宿主槽5:{l217}")
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    sg_links = {l["id"]: l for l in sg["links"]}
    for l in sg["links"]:
        if l["origin_id"] == -10:
            if sg["inputs"][l["origin_slot"]]["type"] != l["type"]:
                fail(f"[{label}] 子图线 {l['id']} -10 类型失配")
        elif l["origin_id"] not in sg_nodes:
            fail(f"[{label}] 子图线 {l['id']} 源节点缺失")
        elif l["target_id"] == -20:
            if sg["outputs"][l["target_slot"]]["type"] != l["type"]:
                fail(f"[{label}] 子图线 {l['id']} -20 类型失配")
            continue
        tgt = sg_nodes.get(l["target_id"])
        if tgt is None or l["target_slot"] >= len(tgt.get("inputs", [])):
            fail(f"[{label}] 子图线 {l['id']} 目标槽越界")
        elif tgt["inputs"][l["target_slot"]].get("link") != l["id"]:
            fail(f"[{label}] 子图线 {l['id']} 目标槽 link 未回挂")
    for k, io in enumerate(sg["inputs"]):
        want = sorted(l["id"] for l in sg["links"] if l["origin_id"] == -10 and l["origin_slot"] == k)
        if sorted(io.get("linkIds") or []) != want:
            fail(f"[{label}] 边界槽 {io['name']} linkIds 对账失配")
    te_imgs = [i for i in sg_nodes[4015]["inputs"] if i["name"].startswith("images.")]
    if [i["name"] for i in te_imgs] != ["images.image_1", "images.image_2", "images.image_3"] \
            or not all(i.get("link") for i in te_imgs):
        fail(f"[{label}] [4015] 图槽应恰三且全接")
    if [i["name"] for i in sg_nodes[25]["inputs"]] != ["images.image0", "images.image1", "images.image2"] \
            or not all(i.get("link") for i in sg_nodes[25]["inputs"]):
        fail(f"[{label}] [25] 合批槽应恰三且全接")


def main():
    wf_doc, bp_doc = load(WF), load(BP)
    sg, bp_sg = find_sg(wf_doc), find_sg(bp_doc)
    if sg["id"] != bp_sg["id"]:
        fail("工作流/蓝图子图 id 不一致(术前)")
    names = [i["name"] for i in sg["inputs"]]
    if names == SG3:
        print("[ref5to3] 已是三槽态,幂等拦停(零写入)")
        sys.exit(3)

    nodes = {n["id"]: n for n in wf_doc["nodes"]}
    host = nodes[6]
    if names != SG5 or [i["name"] for i in host["inputs"]] != SG5:
        fail(f"术前非五槽态(边界/宿主不符):{names}")
    for nid in GONE_NODES:
        if nid not in nodes or nodes[nid].get("mode") != 4:
            fail(f"术前节点 {nid} 应为旁路占位对成员")

    # ── 根图手术 ──
    wf_doc["nodes"] = [n for n in wf_doc["nodes"] if n["id"] not in GONE_NODES]
    wf_doc["links"] = [l for l in wf_doc["links"] if l[0] not in GONE_ROOT_LINKS]
    host["inputs"] = [i for i in host["inputs"] if i["name"] not in ("image_4", "image_5")]
    l217 = next(l for l in wf_doc["links"] if l[0] == 217)
    l217[4] = 5  # 指令总线拐→宿主 槽 7→5
    # ②组框文案 五图→三图
    g2 = next(g for g in wf_doc["groups"] if g["title"].startswith("道劫·②图像"))
    if GROUP_OLD not in g2["title"]:
        fail("②组框五图文案锚缺失")
    g2["title"] = g2["title"].replace(GROUP_OLD, GROUP_NEW)
    # [402] 说明随刀
    note = nodes[402]["widgets_values"]
    for old, new in NOTE_EDITS:
        if old not in note[0]:
            fail(f"[402] 说明锚缺失:{old[:40]}…")
        note[0] = note[0].replace(old, new)

    # ── 子图手术(工作流+蓝图同刀)+蓝图宿主占位镜像 ──
    if not surgery_subgraph(sg, "工作流"):
        fail("工作流侧手术未生效")
    if not surgery_subgraph(bp_sg, "蓝图"):
        fail("蓝图侧手术未生效")
    bp_host = bp_doc["nodes"][0]
    bp_host["inputs"] = [i for i in bp_host["inputs"] if i["name"] not in ("image_4", "image_5")]

    # ── 术后终验+落盘 ──
    coherence(wf_doc, "工作流")
    for p, doc, is_wf in ((WF, wf_doc, True), (BP, bp_doc, False)):
        p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        coherence(load(p), f"回读:{p.name}", host_expected=is_wf)
        print(f"[ref5to3] 落盘+回读终验绿:{p.name}")
    got = [i["name"] for i in find_sg(load(WF))["inputs"]]
    if got != SG3:
        fail(f"回读边界槽序不符:{got}")
    print("[ref5to3] 收口完成:三图边界/主编码三槽/合批三槽/单对旁路占位([12]+[18]),走廊方案保留。")


if __name__ == "__main__":
    main()
