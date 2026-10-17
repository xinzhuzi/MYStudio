#!/usr/bin/env python3
"""qi21-道劫-i2i 参考图 2→5 扩展手术(2026-10-10,用户令「扩展到5张吧」)。

设计裁定(术前已核):
  1. 边界扩五槽:子图 [6] 边界 image_3/4/5 插在 image_2 之后(索引 4/5/6),
     指令/型选择/PE启用?/RGBA透明 四槽整体后移 4→7/5→8/6→9/7→10——
     1008 判例纪律:插条目必迁移连线槽号(root link18 指令线 4→7;子图
     -10 线 42/62(指令)/10(型选择)/200(PE启用?)/11(RGBA透明)各 +3)。
  2. 主编码 [4015] images.image_3/4/5 插在 image_2 后(prompt 4→7,线 20 迁槽);
     PE 合批 [25] 追加 images.image2/3/4(尾部追加零迁移)。
  3. 根图三对 LoadImage[12/13/14]+预缩[18/21/22] **默认旁路态(mode 4)**:
     旁路=前端执行图移除+连线剪断+可选输入省略(仓库先例=t2i SeedVR2 尾档
     整组旁路+H3 社区件旁路 LoadImage)——默认行为≡现行双参考图;要用第 N 张
     参考=Ctrl+B 解旁路+选图。占位空文件名(mode 0 直跑会被 LoadImage 校验拒)。
  4. 两加速档(viggle/Fun-Acc)仍走 positive_single 单参考(0928 黑图修复
     裁定不动);五参考全效只在「1·直出40步」档与 PE 看图改写([25] 合批)。
  5. 蓝图同批:子图定义改动=工作流+蓝图(my_nodes/subgraphs/)双侧同刀,
     否则 qi21_blueprint_sync_1001.py --check 判漂移/反向打回。
  6. [402] 用法说明与②组框文案随刀更新;PE 模板头([21])按任意 N 图书写
     (Image Reference Rules 通配 <image1>..<imageN>)零改动。

fail-closed:术前断言不满足即退出零写入;术后 coherence 终验(连线-槽名-类型
一致性/边界 linkIds 对账/宿主镜像)不过即退出并留 .bak 回滚指引。
幂等性:重复运行时术前断言(image_3 不在边界)即拦,零写入退出 3。
"""
import copy
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SG_NAME_PREFIX = "[6] 文本提示词类型优化子图"

OLD_SG_INPUTS = ["clip", "vae", "image_1", "image_2", "指令", "型选择", "PE启用?", "RGBA透明"]
NEW_SG_INPUTS = ["clip", "vae", "image_1", "image_2", "image_3", "image_4", "image_5",
                 "指令", "型选择", "PE启用?", "RGBA透明"]

# 新根图件(id/坐标沿②带图像输入列纵向续排;480 纵距=北区净空走廊节奏)
# 布局裁定(v2):任何南区→宿主图槽的线必横穿 MODEL 总线([9]→[7])与布尔线
# ([19]→[20])走廊=几何死结;故 [9]/[19] 南下让出 y2500-4000 北区,三对新件
# 住 [11] 与总线之间,预缩→宿主线走总线弧上方的净空走廊(棘轮 19 交叉不升)。
# 预缩 id 避子图域:21/23/24/25/27 归 [6] 子图 PE 链(主图∩子图=∅ 契约),
# 故预缩取 18/26/28(LoadImage 12/13/14 三域皆净)
NEW_REFS = [  # (load_id, scale_id, y_load, y_scale, title_suffix)
    (12, 18, 2560, 2620, "3"),
    (13, 26, 3040, 3100, "4"),
    (14, 28, 3520, 3580, "5"),
]
# 南下让走廊(v4 数值定稿:主域交叉 16<基线19 棘轮收紧/遮挡 8 持平/零盒重叠):
# [9]/[19] 移列尾;[20]/[4] 上移让 MODEL 总线弧下净空;[400] 保持原位(1003 甲案
# 不变量=指令居 [6] 上方行,下移被 test_400_directive_home_in_band2 否决);
# 指令线改经 [33] 总线拐自下东侧绕进 slot7(消 18×208/209/210 三交叉,总线拐
# 体质同 [42]/[43]/[44])
RELOCATE = {9: (2500, 4600), 19: (2500, 4820), 20: (6150, 2250), 4: (4300, 2900)}
DIRECTIVE_REROUTE_ID = 33   # 指令总线拐(Reroute;root 三域无占用)
DIRECTIVE_LINK = 217        # 拐→宿主 指令槽
ROOT_LINK_BASE = 205           # 205-207: LoadImage→预缩;208-210: 预缩→宿主 image_3/4/5
SG_LINK_BASE = 211             # 211-213: -10→[25] 合批;214-216: -10→[4015] 主编码
UUID_BASE = "c4d5e6f7-00{n:02d}-4a{n:02d}-9e{n:02d}-d47c9e21a0{n:02d}"  # n=11/12/13

NOTE_EDITS = [
    ("### 官方示例双图(须先放引擎 input 目录)\n\n- image_1 = portrait_model_denim.png(编辑画布/人物)\n- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)\n- **参考图语法**",
     "### 参考图五槽(1010 扩展;官方示例双图须先放引擎 input 目录)\n\n- image_1 = portrait_model_denim.png(编辑画布/人物)\n- image_2 = clothing_light_blue_denim_shirt.png(参考/衬衫)\n- image_3/4/5 = [12]/[13]/[14] 占位空图,**默认旁路态(Ctrl+B)**——默认行为=双参考不变;要用第 N 张参考=选中对应 LoadImage+预缩对按 Ctrl+B 解旁路→选图→跑;旁路槽零进执行图,PE 合批与主编码自动只吃已解旁路的图(空文件名直跑会被 LoadImage 校验拒)。\n- **参考图语法**"),
    ("模型契约上限 10 图(节点槽 16)。",
     "模型契约上限 10 图(节点槽 16);本件实装五槽(1010),再多换 qwen21-multiref-edit。"),
    ("合批全部输入图(经 image_1/image_2 边界,预缩后)喂 [4013].image",
     "合批全部输入图(经 image_1..image_5 边界,预缩后;旁路槽自动缺席)喂 [4013].image"),
    ("直出支路 [7010].positive=宿主 positive(双参考=「1 · 直出40步」档官方路零改动)",
     "直出支路 [7010].positive=宿主 positive(多参考至多五图=「1 · 直出40步」档官方路零改动,1010 五槽扩展)"),
    ("+1005/1007 文本役逐轮手术所得,重跑生成器会把上述轮次全部打回旧结构。",
     "+1005/1007 文本役逐轮手术+1010 五参考扩展(qi21_i2i_ref5_1010.py)所得,重跑生成器会把上述轮次全部打回旧结构。"),
]
GROUP2_OLD = "双图[10][11]+双预缩[16][17]"
GROUP2_NEW = "五图[10]-[14]+五预缩[16][17][18][21][22](后三对默认旁路)"


def fail(msg, code=2):
    print(f"[ref5] FAIL: {msg}")
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
    """子图定义单侧手术:边界插槽+连线迁移+主编码/合批补槽+新线+linkIds。"""
    names = [i["name"] for i in sg["inputs"]]
    if names != OLD_SG_INPUTS:
        fail(f"[{label}] 术前边界槽序不符预期(幂等拦停或结构漂移):{names}")
    links = {l["id"]: l for l in sg["links"]}
    nodes = {n["id"]: n for n in sg["nodes"]}

    te = nodes[4015]
    te_in = [i["name"] for i in te["inputs"]]
    if te_in != ["clip", "images.image_1", "vae", "images.image_2", "prompt"]:
        fail(f"[{label}] [4015] 术前槽序不符:{te_in}")
    batch = nodes[25]
    if [i["name"] for i in batch["inputs"]] != ["images.image0", "images.image1"]:
        fail(f"[{label}] [25] 术前槽序不符")

    # ① -10 连线槽号迁移(指令/型选择/PE启用?/RGBA透明 4..7 → 7..10)
    migrated = []
    for l in sg["links"]:
        if l["origin_id"] == -10 and l["origin_slot"] >= 4:
            migrated.append((l["id"], l["origin_slot"], l["origin_slot"] + 3))
            l["origin_slot"] += 3
    if sorted(m[0] for m in migrated) != [10, 11, 42, 62, 200]:
        fail(f"[{label}] -10 迁移线集合不符预期:{migrated}")

    # ② [4015] prompt 线(20)迁槽 4→7,插图槽 4/5/6
    l20 = links[20]
    if not (l20["origin_id"] == 153 and l20["target_id"] == 4015 and l20["target_slot"] == 4):
        fail(f"[{label}] 线 20 术前形态不符:{l20}")
    l20["target_slot"] = 7
    for k, (nm, lid) in enumerate((("images.image_3", 214), ("images.image_4", 215), ("images.image_5", 216))):
        te["inputs"].insert(4 + k, {"name": nm, "type": "IMAGE", "shape": 7, "link": lid})

    # ③ [25] 追加合批槽(尾插零迁移)
    for nm, lid in (("images.image2", 211), ("images.image3", 212), ("images.image4", 213)):
        batch["inputs"].append({"name": nm, "type": "IMAGE", "shape": 7, "link": lid})

    # ④ 边界插槽(索引 4/5/6;pos 沿 image_1/2 的 +20/+20 节奏)
    for k, nm in enumerate(("image_3", "image_4", "image_5")):
        sg["inputs"].insert(4 + k, {
            "id": UUID_BASE.format(n=11 + k), "name": nm, "type": "IMAGE",
            "linkIds": [SG_LINK_BASE + k, SG_LINK_BASE + 3 + k],
            "pos": [1090 + 20 * k, 130 + 20 * k],
        })

    # ⑤ 新内部线:-10[4/5/6]→[25][2/3/4] 与 →[4015][4/5/6]
    for k in range(3):
        sg["links"].append({"id": SG_LINK_BASE + k, "origin_id": -10, "origin_slot": 4 + k,
                            "target_id": 25, "target_slot": 2 + k, "type": "IMAGE"})
        sg["links"].append({"id": SG_LINK_BASE + 3 + k, "origin_id": -10, "origin_slot": 4 + k,
                            "target_id": 4015, "target_slot": 4 + k, "type": "IMAGE"})

    # ⑥ 发号器水位
    sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId") or 0, SG_LINK_BASE + 5)


def surgery_blueprint_host(bp_doc):
    """蓝图顶层宿主占位节点 inputs 镜像补齐(卫生位,非 sync 比较域)。"""
    host = bp_doc["nodes"][0]
    names = [i["name"] for i in host["inputs"]]
    if names != OLD_SG_INPUTS:
        fail(f"蓝图宿主占位 inputs 术前不符:{names}")
    for k, nm in enumerate(("image_3", "image_4", "image_5")):
        host["inputs"].insert(4 + k, {"name": nm, "type": "IMAGE", "link": None})


def coherence(doc, label, host_expected=True):
    """术后终验:连线-槽名-类型一致性+边界 linkIds 对账+宿主镜像。
    蓝图件传 host_expected=False(根层仅占位宿主,跳过根线/宿主镜像域)。"""
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
        if ins[ts].get("link") != lid:
            fail(f"[{label}] 根线 {lid} 目标槽 link 未回挂")
        if lid not in (outs[os_].get("links") or []):
            fail(f"[{label}] 根线 {lid} 源槽 links 未登记")
    sg = find_sg(doc)
    if host_expected:
        host = nodes[6]
        if [i["name"] for i in host["inputs"]] != [i["name"] for i in sg["inputs"]]:
            fail(f"[{label}] 宿主/子图 inputs 镜像失配")
        if [i["type"] for i in host["inputs"]] != [i["type"] for i in sg["inputs"]]:
            fail(f"[{label}] 宿主/子图 inputs 类型失配")
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    sg_links = {l["id"]: l for l in sg["links"]}
    for l in sg["links"]:
        if l["origin_id"] == -10:
            if l["origin_slot"] >= len(sg["inputs"]):
                fail(f"[{label}] 子图线 {l['id']} -10 槽号越界")
            if sg["inputs"][l["origin_slot"]]["type"] != l["type"]:
                fail(f"[{label}] 子图线 {l['id']} -10 类型失配")
        elif l["origin_id"] not in sg_nodes:
            fail(f"[{label}] 子图线 {l['id']} 源节点缺失")
        elif l["target_id"] == -20:
            if l["target_slot"] >= len(sg["outputs"]):
                fail(f"[{label}] 子图线 {l['id']} -20 槽号越界")
            if sg["outputs"][l["target_slot"]]["type"] != l["type"]:
                fail(f"[{label}] 子图线 {l['id']} -20 类型失配")
            continue
        tgt = sg_nodes.get(l["target_id"])
        if tgt is None or l["target_slot"] >= len(tgt.get("inputs", [])):
            fail(f"[{label}] 子图线 {l['id']} 目标槽越界")
        elif tgt["inputs"][l["target_slot"]].get("link") != l["id"]:
            fail(f"[{label}] 子图线 {l['id']} 目标槽 link 未回挂")
    for k, io in enumerate(sg["inputs"]):
        want = sorted(l["id"] for l in sg["links"]
                      if l["origin_id"] == -10 and l["origin_slot"] == k)
        if sorted(io.get("linkIds") or []) != want:
            fail(f"[{label}] 边界槽 {io['name']} linkIds 对账失配:{io.get('linkIds')} vs {want}")
    te_imgs = [i for i in sg_nodes[4015]["inputs"] if i["name"].startswith("images.")]
    if len(te_imgs) != 5 or not all(i.get("link") for i in te_imgs):
        fail(f"[{label}] [4015] 图槽应 5 且全接")
    if len(sg_nodes[25]["inputs"]) != 5 or not all(i.get("link") for i in sg_nodes[25]["inputs"]):
        fail(f"[{label}] [25] 合批槽应 5 且全接")
    ids = [l["id"] for l in sg["links"]]
    if len(ids) != len(set(ids)):
        fail(f"[{label}] 子图线 id 重复")


def main():
    wf_doc, bp_doc = load(WF), load(BP)
    sg = find_sg(wf_doc)
    bp_sg = find_sg(bp_doc)
    if sg["id"] != bp_sg["id"]:
        fail("工作流/蓝图子图 id 不一致(术前)")
    if [i["name"] for i in sg["inputs"]] != OLD_SG_INPUTS:
        print("[ref5] 边界已是五槽形态,幂等拦停(零写入)")
        sys.exit(3)

    nodes = {n["id"]: n for n in wf_doc["nodes"]}
    for i in (*[n for pair in NEW_REFS for n in pair[:2]], DIRECTIVE_REROUTE_ID):
        if i in nodes:
            fail(f"根图节点 id {i} 已被占用")
    if any(l[0] >= ROOT_LINK_BASE for l in wf_doc["links"]):
        fail(f"根线发号区 ≥{ROOT_LINK_BASE} 已被占用")
    if sorted(l["id"] for l in sg["links"])[-1] != 200:
        fail("子图线发号水位不符预期(>200)")

    # ── 根图手术 ──
    li_tpl, sc_tpl = copy.deepcopy(nodes[11]), copy.deepcopy(nodes[17])
    host = nodes[6]
    # ① 指令线(18):宿主槽 4→7 后改经 [33] 总线拐(消与三图槽进线的末段交叉)
    l18 = next(l for l in wf_doc["links"] if l[0] == 18)
    if not (l18[1] == 400 and l18[3] == 6 and l18[4] == 4):
        fail(f"根线 18 术前形态不符:{l18}")
    l18[3], l18[4] = DIRECTIVE_REROUTE_ID, 0
    rer = copy.deepcopy(nodes[42])
    rer.update(id=DIRECTIVE_REROUTE_ID, pos=[4400, 2330], order=22,
               title=f"[{DIRECTIVE_REROUTE_ID}] Reroute",
               inputs=[{"name": "", "type": "*", "link": 18}],
               # Reroute 输出槽型采纳线型(家规同 [42]MODEL/[43]VAE;输入恒 *)
               outputs=[{"name": "", "type": "STRING", "links": [DIRECTIVE_LINK]}])
    wf_doc["nodes"].append(rer)
    wf_doc["links"].append([DIRECTIVE_LINK, DIRECTIVE_REROUTE_ID, 0, 6, 7, "STRING"])
    # ② 宿主插槽(4/5/6);指令槽(7)挂线改 217(经总线拐)
    for k in range(3):
        host["inputs"].insert(4 + k, {"name": f"image_{3 + k}", "type": "IMAGE",
                                      "link": ROOT_LINK_BASE + 3 + k})
    host["inputs"][7]["link"] = DIRECTIVE_LINK
    # ③ 三对 LoadImage+预缩(旁路态占位)
    order = max(n.get("order", 0) for n in wf_doc["nodes"]) + 1
    for k, (lid, sid, y_l, y_s, suffix) in enumerate(NEW_REFS):
        li = copy.deepcopy(li_tpl)
        li.update(id=lid, pos=[2500, y_l], order=order + 2 * k, mode=4,
                  widgets_values=["", "image"], title=f"[{lid}] 参考图{suffix}·LoadImage",
                  inputs=copy.deepcopy(li_tpl["inputs"]),
                  outputs=[{"name": "IMAGE", "type": "IMAGE", "links": [ROOT_LINK_BASE + k]},
                           {"name": "MASK", "type": "MASK", "links": None}])
        sc = copy.deepcopy(sc_tpl)
        sc.update(id=sid, pos=[2960, y_s], order=order + 2 * k + 1, mode=4,
                  widgets_values=["lanczos", 1.0, 32], title=f"[{sid}] 参考预缩{suffix}·Scale",
                  outputs=[{"name": "IMAGE", "type": "IMAGE", "links": [ROOT_LINK_BASE + 3 + k]}])
        sc["inputs"][0]["link"] = ROOT_LINK_BASE + k
        wf_doc["nodes"] += [li, sc]
        wf_doc["links"] += [
            [ROOT_LINK_BASE + k, lid, 0, sid, 0, "IMAGE"],
            [ROOT_LINK_BASE + 3 + k, sid, 0, 6, 4 + k, "IMAGE"],
        ]
    # 契约 test_id_counters:根 last_link_id 须 ≥ 全域(根+子图)最大线 id
    wf_doc["last_link_id"] = max(ROOT_LINK_BASE + 5, SG_LINK_BASE + 5, DIRECTIVE_LINK)
    # ④ ②组框:文案+扩界(新底缘=4840,高 3520)
    g2 = next(g for g in wf_doc["groups"] if g["title"].startswith("道劫·②图像"))
    if GROUP2_OLD not in g2["title"]:
        fail("②组框文案锚缺失")
    g2["title"] = g2["title"].replace(GROUP2_OLD, GROUP2_NEW)
    g2["bounding"][3] = 3520
    # ⑤ 南下让走廊(v4):[9]/[19]/[20]/[4] 重定位([400] 原位不动,见 RELOCATE 注)
    for nid, (x, y) in RELOCATE.items():
        nodes[nid]["pos"] = [x, y]
    # ⑤ [402] 说明随刀
    note = nodes[402]["widgets_values"]
    for old, new in NOTE_EDITS:
        if old not in note[0]:
            fail(f"[402] 说明锚缺失:{old[:40]}…")
        note[0] = note[0].replace(old, new)

    # ── 子图手术(工作流+蓝图同刀)──
    surgery_subgraph(sg, "工作流")
    surgery_subgraph(bp_sg, "蓝图")
    surgery_blueprint_host(bp_doc)

    # ── 术后终验+落盘 ──
    coherence(wf_doc, "工作流")
    for p, doc, is_wf in ((WF, wf_doc, True), (BP, bp_doc, False)):
        bak = p.with_suffix(p.suffix + ".bak-1010")
        bak.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        reread = load(p)
        coherence(reread, f"回读:{p.name}", host_expected=is_wf)
        print(f"[ref5] 落盘+回读终验绿:{p.name}(备份 {bak.name})")

    got = [i["name"] for i in find_sg(load(WF))["inputs"]]
    if got != NEW_SG_INPUTS:
        fail(f"回读边界槽序不符:{got}")
    print("[ref5] 手术完成:边界五图槽/主编码五槽/合批五槽/三对旁路占位/[402]+②组框文案,全部落盘。")


if __name__ == "__main__":
    main()
