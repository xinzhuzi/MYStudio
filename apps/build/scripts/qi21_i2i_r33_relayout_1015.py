#!/usr/bin/env python3
"""qi21-道劫-i2i [33] 退役+组框零重叠手术(2026-10-15,用户令)。

内容(三刀合一):
  1. [33] Reroute(指令总线拐,1010 生)退役:[400] 指令 → [6].指令 改直连
     (link217 origin 重指 [400] 槽0,link18 退役;恒向右成立=pos.x 4260<4460,
     溯源过拐分支在契约测试同步消灭)。
  2. 主图组框零重叠:「②指令外露带」([400]+组框)上移出「②图像·装配主链」
     bbox(带内上缘净空带 y640-960,画布顶部仅 [402] Note x≤1140 零冲突);
     ②组框 title 随迁(「[400]指令归位本带」句退役)。
  3. 子图[6]组框收实:PE 链组框自陈年失真 bbox(罩着装配主链左上角)收为
     双排实身 bbox(x50-2840/y60-1750,[4012][4019][4013][27] 下排归位入组);
     装配主链组框扩为实身(罩 [4014][4011][153]+[4010][4018][180] 两排),
     title 陈旧 id 勘正([150]→[4010]/[141]→[4011])。
  规则依据:组与组不重叠=1007 用户令(判据已入 layout_check group_overlap;
  生产棘轮基线只记 crossings/occlusion 两键=本役回潮根因,组重叠随本役归零)。

fail-closed:术前 md5 字节锚+拓扑锚不符即零写入;术后 coherence+组框零重叠
+恒向右豁免集={229,230}+回读双终验;幂等拦停 exit 3。
契约锚随迁:test_qwen21_workflow_contract.py :4245 区溯源分支(另行随批)。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
INSTALL = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/"
               "comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json")
SG_PREFIX = "[6] 文本提示词类型优化子图"

PRE_MD5 = "4c95581ee68eb665d83afed4ffaaf0c6"
OLD_TITLE_SEG = ";[400]指令归位本带→[6]装配子图"
NEW_TITLE_SEG = ";[6]装配子图"
BAND_TAIL_OLD = "1003甲案归位②带不再掉底"
BAND_TAIL_NEW = "1015R33役上移②带上缘净空带"

# 主图
P400_NEW = [4260, 710]
BAND_OLD, BAND_NEW = [4180, 1430, 500, 320], [4180, 640, 500, 320]
# 子图[6]
PE_OLD, PE_NEW = [50, 60, 3260, 1010], [50, 60, 2790, 1690]
ASM_OLD, ASM_NEW = [2550, 880, 2430, 950], [2850, 600, 2430, 1660]
PE_TITLE_OLD_BIT = "[26]TextGen"
PE_TITLE_NEW = ("PE看图改写链(带0/1):[21]system+[23]后缀→[24]三段拼装+[25]看图合批;"
                "[4012]PE启用?+[4019]PE专属TE→[4013]看图改写→[27]抽取(下排)")
ASM_TITLE_OLD_BIT = "[150]底座+[180]三态→[141]装配全文件"
ASM_TITLE_NEW_BIT = "[4010]底座+[180]三态→[4011]装配全文件"


def fail(m, code=2):
    print(f"[r33] FAIL: {m}")
    sys.exit(code)


def md5(p: Path) -> str:
    import hashlib
    return hashlib.md5(p.read_bytes()).hexdigest()


def groups_overlap(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    return ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah


def assert_no_group_overlap(groups, label):
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            if groups_overlap(groups[i]["bounding"], groups[j]["bounding"]):
                fail(f"[{label}] 组框仍重叠:「{groups[i]['title'][:20]}」×"
                     f"「{groups[j]['title'][:20]}」")


def coherence(wf, label):
    root = {n["id"]: n for n in wf["nodes"]}
    ids = [l[0] for l in wf["links"]]
    if len(ids) != len(set(ids)):
        fail(f"[{label}] 根图线 id 重复")
    for l in wf["links"]:
        if l[1] not in root or l[3] not in root:
            fail(f"[{label}] 线{l[0]} 端点节点失踪")
        if root[l[3]]["inputs"][l[4]].get("link") != l[0]:
            fail(f"[{label}] 线{l[0]} 目标槽未回挂")
    for n in wf["nodes"]:
        for o in n.get("outputs", []):
            for lid in o.get("links") or []:
                if not any(l[0] == lid and l[1] == n["id"] for l in wf["links"]):
                    fail(f"[{label}] 节点{n['id']} 出线 {lid} 悬空")
    for sg in wf["definitions"]["subgraphs"]:
        ns = {n["id"]: n for n in sg["nodes"]}
        sids = [l["id"] for l in sg["links"]]
        if len(sids) != len(set(sids)):
            fail(f"[{label}] 子图线 id 重复")
        for l in sg["links"]:
            if l["origin_id"] >= 0 and l["origin_id"] not in ns:
                fail(f"[{label}] 子图线{l['id']} origin 失踪")
            if l["target_id"] >= 0 and l["target_id"] not in ns:
                fail(f"[{label}] 子图线{l['id']} target 失踪")
    for n in wf["nodes"]:
        if n["pos"][0] < 80 or n["pos"][1] < 80:
            fail(f"[{label}] 节点{n['id']} 负区(pos<80):{n['pos']}")


def main():
    if not WF.exists():
        fail("工作流真源缺失")
    if md5(WF) != PRE_MD5:
        # 幂等:已术后?
        try:
            d = json.loads(WF.read_text(encoding="utf-8"))
            done = (not any(n["id"] == 33 for n in d["nodes"])
                    and any(l[0] == 217 and l[1] == 400 for l in d["links"]))
            if done:
                print("[r33] 已术后形态,幂等拦停")
                sys.exit(3)
        except Exception:
            pass
        fail(f"术前 md5 字节锚不符(期望 {PRE_MD5},得 {md5(WF)})")

    wf = json.loads(WF.read_text(encoding="utf-8"))
    root = {n["id"]: n for n in wf["nodes"]}
    links = {l[0]: l for l in wf["links"]}
    sg = next(s for s in wf["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))

    # ── 术前拓扑锚 ──
    n33 = root.get(33)
    if not n33 or n33["type"] != "Reroute":
        fail("[33] 术前形态不符(应 Reroute)")
    if links.get(18) != [18, 400, 0, 33, 0, "STRING"]:
        fail(f"link18 术前锚不符:{links.get(18)}")
    if links.get(217) != [217, 33, 0, 6, 5, "STRING"]:
        fail(f"link217 术前锚不符:{links.get(217)}")
    if root[400]["outputs"][0].get("links") != [18]:
        fail("[400] 出线术前锚不符")
    if root[400]["pos"] != [4260, 1500]:
        fail(f"[400] pos 术前锚不符:{root[400]['pos']}")
    if root[6]["inputs"][5]["name"] != "指令" or root[6]["inputs"][5]["link"] != 217:
        fail("[6].inputs[5] 术前锚不符")

    band = next((g for g in wf["groups"] if g["title"].startswith("道劫·②指令外露带")), None)
    zhuangpei = next((g for g in wf["groups"] if g["title"].startswith("道劫·②图像·装配主链")), None)
    if band is None or band["bounding"] != BAND_OLD:
        fail(f"指令外露带组框术前锚不符:{band and band['bounding']}")
    if zhuangpei is None or zhuangpei["bounding"] != [2400, 1420, 3400, 3520] \
            or OLD_TITLE_SEG not in zhuangpei["title"]:
        fail("②装配主链组框术前锚不符")
    sg_pe = next((g for g in sg["groups"] if "PE看图改写链" in g["title"]), None)
    sg_asm = next((g for g in sg["groups"] if "装配主链" in g["title"]), None)
    if sg_pe is None or sg_pe["bounding"] != PE_OLD or PE_TITLE_OLD_BIT not in sg_pe["title"]:
        fail("子图[6] PE 链组框术前锚不符")
    if sg_asm is None or sg_asm["bounding"] != ASM_OLD or ASM_TITLE_OLD_BIT not in sg_asm["title"]:
        fail("子图[6] 装配主链组框术前锚不符")

    # ── 备份 ──
    bak = WF.with_suffix(".json.bak-1015r33")
    shutil.copy2(WF, bak)
    print(f"[r33] 备份 → {bak.name}")

    # ── 刀1:[33] 退役直连 ──
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] != 33]
    wf["links"] = [l for l in wf["links"] if l[0] != 18]
    for l in wf["links"]:
        if l[0] == 217:
            l[1], l[2] = 400, 0
    root[400]["outputs"][0]["links"] = [217]
    root[6]["inputs"][5]["link"] = 217  # 原值即 217,显式钉死
    # last_node_id/last_link_id 禁回写(7024/234 沿用 a8f20070 口径)

    # ── 刀2:主图组框分离 ──
    root[400]["pos"] = P400_NEW
    band["bounding"] = BAND_NEW
    band["title"] = band["title"].replace(BAND_TAIL_OLD, BAND_TAIL_NEW)
    zhuangpei["title"] = zhuangpei["title"].replace(OLD_TITLE_SEG, NEW_TITLE_SEG)

    # ── 刀3:子图[6]组框收实 ──
    sg_pe["bounding"] = PE_NEW
    sg_pe["title"] = PE_TITLE_NEW
    sg_asm["bounding"] = ASM_NEW
    sg_asm["title"] = sg_asm["title"].replace(ASM_TITLE_OLD_BIT, ASM_TITLE_NEW_BIT)

    # ── 术后终验 ──
    coherence(wf, "内存")
    assert_no_group_overlap(wf["groups"], "主图")
    for s in wf["definitions"]["subgraphs"]:
        if s.get("groups"):
            assert_no_group_overlap(s["groups"], f"子图{s['name'][:10]}")
    # 恒向右豁免集 {229,230}(pos.x 口径,同契约测试)
    leftward = {l[0] for l in wf["links"] if root[l[3]]["pos"][0] <= root[l[1]]["pos"][0]}
    if leftward != {229, 230}:
        fail(f"主图左向线集 {sorted(leftward)} ≠ 豁免集 [229, 230]")
    if len(wf["nodes"]) != 33 or len(wf["links"]) != 40:
        fail(f"件数不符:节点 {len(wf['nodes'])}/连线 {len(wf['links'])}(应 33/40)")
    if any(n["id"] == 33 for n in wf["nodes"]) or any(l[0] == 18 for l in wf["links"]):
        fail("[33]/link18 残留")

    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    r = json.loads(WF.read_text(encoding="utf-8"))
    coherence(r, "回读")
    assert_no_group_overlap(r["groups"], "回读主图")
    rl = {l[0]: l for l in r["links"]}
    if rl[217] != [217, 400, 0, 6, 5, "STRING"]:
        fail(f"回读 link217 不符:{rl[217]}")
    rr = {n["id"]: n for n in r["nodes"]}
    if rr[400]["pos"] != P400_NEW:
        fail("回读 [400] pos 不符")
    print(f"[r33] 完成:[33] 退役直连(link217=[400]→[6].指令);主图+子图[6] 组框零重叠;"
          f"节点 34→33/连线 41→40;md5 {md5(WF)}")

    # ── 部署:装机副本同步(md5 对账) ──
    if INSTALL.exists():
        shutil.copy2(WF, INSTALL)
        if md5(INSTALL) != md5(WF):
            fail("装机副本 md5 对账失败")
        print(f"[r33] 装机副本同步 md5 同:{INSTALL}")


if __name__ == "__main__":
    main()
