#!/usr/bin/env python3
"""qi21 viggle 9步满血双段链手术(1008;用户令「要 9 步满血」)。

官方 9-step 口径(README SIGMAS_9):前 7 步 turbo LoRA,第 7 步后摘 LoRA,
底模收尾 2 步。ComfyUI 等价表达:
  段A [7012]:ViggleTurboLora 模型 + sigmas=高段(9点表 shift 后前8值,7步)
  段B [7024]:边界 base 模型(无 LoRA) + sigmas=低段(后3值含终止0,2步)
  切分 [7021] SplitSigmas(step=7);段B 噪声 [7023] DisableNoise(零噪声=续采
  不重加噪,官方两段连跑语义);[7022] BasicGuider(底模)。
面板 σ表 默认→9点官方表;KJNodes 时代「插值」坑彻底无关(官方件无此参)。
改前副本=backups/qi21_viggle_v03_official_1008/qi21-道劫-t2i.pre_9step.json
终态补记(同日):段B euler 不另立 7025 而复用 [7018] 双扇出(0929 零真重复铁则
哨兵拦停后收敛);7018 终位 [380,1500]、7025 退役;布局=求解器(layout_check
作 oracle 暴力搜)四项零违规,余 11 跨接=双段链固有收敛几何记棘轮账。
"""
import json
import shutil
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BAK = REPO / "apps/build/scripts/backups/qi21_viggle_v03_official_1008"

SG_NAME = "道劫·加速子图"
SIG9 = "1.0, 0.9583, 0.9167, 0.875, 0.75, 0.5, 0.25, 0.16666667, 0.08333333"
UE = {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}}
NEW_IDS = {7021, 7022, 7023, 7024}
NEW_LINKS = {4312, 4313, 4314, 4315, 4316, 4317, 4319, 4320}


def main() -> None:
    doc = json.loads(WF.read_text(encoding="utf-8"))
    sg = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME][0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}
    host = [n for n in doc["nodes"] if n.get("properties", {}).get("subgraph") == sg["id"]][0]

    # ── 前置断言(现态=官方满血单段) ──
    assert nodes[7011]["type"] == "ViggleTurboLora" and nodes[7020]["type"] == "ViggleTurboSigmas"
    assert nodes[7012]["type"] == "SamplerCustomAdvanced"
    assert not (NEW_IDS & set(nodes)) and not (NEW_LINKS & set(links)), "id/线撞号"
    assert links[4308]["target_id"] == 7012 and links[4308]["target_slot"] == 3, "4308 现态漂移"
    assert links[120]["origin_id"] == 7012, "120 现态漂移"
    assert host["widgets_values"][2] == "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"

    shutil.copy2(WF, BAK / "qi21-道劫-t2i.pre_9step.json")

    def inp(t, name, loc, link=None, widget=False):
        d = {"localized_name": loc, "name": name, "type": t}
        if widget:
            d["widget"] = {"name": name}
        if link is not None:
            d["link"] = link
        return d

    def out(t, name, loc, links_):
        return {"localized_name": loc, "name": name, "type": t, "links": links_}

    def base(nid, cls, pos, size, order, title):
        return {"id": nid, "type": cls, "pos": pos, "size": size, "flags": {},
                "order": order, "mode": 0, "inputs": [], "outputs": [],
                "title": title, "properties": {"Node name for S&R": cls,
                                               "cnr_id": "comfy-core", "ue_properties": dict(UE)}}

    # ── 新四件 ──
    n21 = base(7021, "SplitSigmas", [1250, 1150], [270, 110], 10, "[7021] σ切分·SplitSigmas(9步=7+2)")
    n21["inputs"] = [inp("SIGMAS", "sigmas", "Sigmas", 4308), inp("INT", "step", "步", widget=True)]
    n21["outputs"] = [out("SIGMAS", "SIGMAS", "high_sigmas", [4312]),
                      out("SIGMAS", "SIGMAS", "low_sigmas", [4320])]
    n21["widgets_values"] = [7]
    n21["widgets_values_named"] = {"step": 7}

    n22 = base(7022, "BasicGuider", [1650, 1500], [270, 110], 11, "[7022] 底模引导·BasicGuider(段2无LoRA)")
    n22["inputs"] = [inp("MODEL", "model", "模型", 4313), inp("CONDITIONING", "conditioning", "条件", 4314)]
    n22["outputs"] = [out("GUIDER", "GUIDER", "引导", [4317])]
    n22["widgets_values"] = []
    n22["widgets_values_named"] = {}

    n23 = base(7023, "DisableNoise", [1250, 1500], [270, 90], 12, "[7023] 零噪声·DisableNoise(段2续采)")
    n23["outputs"] = [out("NOISE", "NOISE", "噪声", [4316])]
    n23["widgets_values"] = []
    n23["widgets_values_named"] = {}

    n24 = base(7024, "SamplerCustomAdvanced", [2250, 700], [330, 200], 13, "[7024] 段2采样·SamplerCustom(底模收尾2步)")
    n24["inputs"] = [inp("NOISE", "noise", "噪声", 4316), inp("GUIDER", "guider", "引导", 4317),
                     inp("SAMPLER", "sampler", "采样器", 4315), inp("SIGMAS", "sigmas", "Sigmas", 4320),
                     inp("LATENT", "latent_image", "Latent图像", 4319)]
    n24["outputs"] = [out("LATENT", "output", "输出", [120]),
                      out("LATENT", "denoised_output", "去噪输出", [])]
    n24["widgets_values"] = []
    n24["widgets_values_named"] = {}

    sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in NEW_IDS] + [n21, n22, n23, n24]

    # ── 连线改向+新增 ──
    links[4308]["target_id"] = 7021          # 7020.SIGMAS → 切分件
    links[4308]["target_slot"] = 0
    links[4312] = {"id": 4312, "origin_id": 7021, "origin_slot": 0, "target_id": 7012, "target_slot": 3, "type": "SIGMAS"}
    links[4313] = {"id": 4313, "origin_id": -10, "origin_slot": 0, "target_id": 7022, "target_slot": 0, "type": "MODEL"}
    links[4314] = {"id": 4314, "origin_id": -10, "origin_slot": 1, "target_id": 7022, "target_slot": 1, "type": "CONDITIONING"}
    links[4315] = {"id": 4315, "origin_id": 7018, "origin_slot": 0, "target_id": 7024, "target_slot": 2, "type": "SAMPLER"}
    links[4316] = {"id": 4316, "origin_id": 7023, "origin_slot": 0, "target_id": 7024, "target_slot": 0, "type": "NOISE"}
    links[4317] = {"id": 4317, "origin_id": 7022, "origin_slot": 0, "target_id": 7024, "target_slot": 1, "type": "GUIDER"}
    links[4319] = {"id": 4319, "origin_id": 7012, "origin_slot": 0, "target_id": 7024, "target_slot": 4, "type": "LATENT"}
    links[4320] = {"id": 4320, "origin_id": 7021, "origin_slot": 1, "target_id": 7024, "target_slot": 3, "type": "SIGMAS"}
    # 7012.sigmas 输入改吃高段;输出改喂段2;120 汇流源改段2
    n12in = {i["name"]: i for i in nodes[7012]["inputs"]}
    n12in["sigmas"]["link"] = 4312
    nodes[7012]["outputs"][0]["links"] = [4319]
    links[120]["origin_id"] = 7024
    links[120]["origin_slot"] = 0
    # 7018 euler 双扇出
    nodes[7018]["outputs"][0]["links"] = [4307, 4315]
    # 7020 latent 口既有 4311;边界槽 linkIds 登记(补 4311 遗漏+新两线)
    bslots = {i["name"]: i for i in sg["inputs"]}
    for nm, lid in (("model", 4313), ("positive", 4314), ("latent", 4311)):
        if lid not in bslots[nm]["linkIds"]:
            bslots[nm]["linkIds"].append(lid)
    sg["links"] = [links[k] for k in sorted(links)]

    # ── 面板 σ表 默认→9点官方表 ──
    host["widgets_values"][2] = SIG9
    sg["widgets"][2] = SIG9
    host["widgets_values_named"]["σ表"] = SIG9

    # ── 7015 右移让位 + 组框罩新件 ──
    nodes[7015]["pos"] = [2700, 900]
    for g in sg["groups"]:
        if g["id"] == 92:
            g["bounding"] = [760, 430, 1870, 1230]
            g["title"] = ("道劫·加速子图·②viggle v0.3 官方9步满血双段([7011]ViggleTurboLora 未合并→[7019]BasicGuider cfg1"
                          "→[7012]段A采样(7步turbo)→[7024]段B采样(2步底模摘LoRA);[7021]SplitSigmas 7+2 切分"
                          "/[7020]ViggleTurboSigmas 动态shift/[7017]noise/[7018]euler/[7023]零噪声续采;cfg恒1 负向无效)")
        if g["id"] == 95:
            g["bounding"] = [2650, 840, 480, 250]

    # ── 7016 说明随令 ──
    n16 = nodes[7016]
    n16["widgets_values"][0] = ("道劫·加速子图=三支路并行加速档+seed 单源+档位选择单点汇流"
 "(宿主面板=速度档位/seed/σ表;未选支路懒执行零加载)。\n"
 "三支路:①档0 FunAcc 无负槽=[7013] T8 一体采样 4 步;"
 "②档1 直出40步 cfg4=[7010] KSampler,负向仅档1(直出40步 cfg4)生效;"
 "③档2 viggle v0.3 官方9步满血=前7步 [7011 ViggleTurboLora 未合并]+[7012]段A,"
 "后2步 [7022]底模引导+[7024]段B(摘LoRA 底模收尾);[7021]按 step=7 切 [7020] 的"
 "9点动态shift σ表;蒸馏件 cfg恒1 负向无效。\n"
 "[7014] seed 单源三用;三支路汇 [7015] 单点出 LATENT。\n"
 "σ表面板贴表即换步数(9步=1.0, 0.9583, 0.9167, 0.875, 0.75, 0.5, 0.25, 0.16666667, 0.08333333"
 " 需配 [7021] step=7;6步单段=1.0, 0.9375, 0.875, 0.75, 0.5, 0.25 且 [7021] step=5)。")
    if isinstance(n16.get("widgets_values_named"), dict):
        n16["widgets_values_named"]["text"] = n16["widgets_values"][0]

    doc["last_node_id"] = max(doc.get("last_node_id", 0), 7024)
    doc["last_link_id"] = max(doc.get("last_link_id", 0), 4320)

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    # ── 后验(盘上读回) ──
    sg2 = [s for s in json.loads(WF.read_text(encoding="utf-8"))["definitions"]["subgraphs"]
           if s.get("name") == SG_NAME][0]
    nd = {n["id"]: n for n in sg2["nodes"]}
    lk = {l["id"]: l for l in sg2["links"]}
    assert nd[7021]["type"] == "SplitSigmas" and nd[7021]["widgets_values"] == [7]
    assert nd[7022]["type"] == "BasicGuider" and nd[7023]["type"] == "DisableNoise"
    assert nd[7024]["type"] == "SamplerCustomAdvanced"
    assert (lk[4308]["target_id"], lk[4308]["target_slot"]) == (7021, 0)
    assert (lk[4312]["origin_id"], lk[4312]["target_id"], lk[4312]["target_slot"]) == (7021, 7012, 3)
    assert (lk[4319]["origin_id"], lk[4319]["target_id"], lk[4319]["target_slot"]) == (7012, 7024, 4)
    assert (lk[120]["origin_id"], lk[120]["target_id"]) == (7024, 7015)
    assert lk[4313]["origin_id"] == -10 and lk[4313]["target_id"] == 7022, "段B 模型=边界 base(摘 LoRA)"
    assert 7018 in {l["origin_id"] for l in lk.values()} and lk[4315]["target_id"] == 7024
    # 双向登记全图扫
    for n in sg2["nodes"]:
        for i in n.get("inputs", []):
            if i.get("link") is not None:
                l = lk[i["link"]]
                assert (l["target_id"], l["target_slot"]) == (n["id"], next(
                    k for k, ii in enumerate(n["inputs"]) if ii is i)), f"[{n['id']}] {i['name']} 槽序错指"
    for n in sg2["nodes"]:
        for oi, o in enumerate(n.get("outputs", [])):
            for lid in o.get("links", []):
                assert lk[lid]["origin_id"] == n["id"] and lk[lid]["origin_slot"] == oi
    print("[OK] 9步满血双段链落位(段A 7步turbo+段B 2步底模,全图双向登记验证过)")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
