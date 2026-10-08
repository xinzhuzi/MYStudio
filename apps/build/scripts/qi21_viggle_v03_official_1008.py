#!/usr/bin/env python3
"""qi21 viggle 腿官方参数化手术(1008;用户令『按官方参数调整 qi21-道劫-t2i.json』)。

官方配方(Viggle/Qwen-Image-2.1-viggle-turbo v0.3 官方 ComfyUI 工作流逐字对拍):
  6 步定制 sigmas=[1.0, 0.9375, 0.875, 0.75, 0.5, 0.25] + CFG1(BasicGuider 单正
  条件,负向不接) + euler;官方用 ViggleTurboSigmas 节点,本产线以已装 KJNodes
  CustomSigmas 等位替用(sigmas_string 同为逗号串;interpolate_to_steps=0=逐字
  不插值)。原 KSampler euler/simple 自排 sigmas 与官方表不一致,故原位换类。

手术(单件:1_文生图/qi21-道劫-t2i.json 的『道劫·加速子图』;宿主六输入槽与
输出槽零改动,subgraph inputs/outputs 声明不动):
  7012 KSampler → SamplerCustomAdvanced(id/pos 原位;输出0照旧→[7015]档2)
  +7017 RandomNoise(noise_seed←[7014] seed 单源,官方 noise 形态)
  +7018 KSamplerSelect(euler)
  +7019 BasicGuider(model←[7011] LoRA 后,positive←宿主槽1;负向不接)
  +7020 CustomSigmas("1.0, 0.9375, 0.875, 0.75, 0.5, 0.25", 插值=0)
  线改向:14→[7019].model / 107→[7019].conditioning / 112→[7012].latent_image
  (槽4) / 117→[7017].noise_seed;删 110(负向→旧7012);新 4305-4308 四链。
改前副本=apps/build/scripts/backups/qi21_viggle_v03_official_1008/。
后续:契约测试重锚 → pytest → layout_check → canvas_deploy → audit。
"""
import json
import shutil
import sys
import time
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
BAK = REPO / "apps/build/scripts/backups/qi21_viggle_v03_official_1008"

SG_NAME = "道劫·加速子图"
OFFICIAL_SIGMAS = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"
UE = {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}}


def sgp(node_type, name, localized=None):
    d = {"name": name, "type": node_type}
    if node_type not in ("NOISE", "GUIDER", "SAMPLER", "SIGMAS", "CONDITIONING", "MODEL", "LATENT", "INT"):
        d["widget"] = {"name": name}
    if localized:
        d["localized_name"] = localized
    return d


def outp(node_type, name, localized, links):
    return {"localized_name": localized, "name": name, "type": node_type, "links": links}


def main() -> None:
    # 静默门(内容指纹式):本件 17:24 的最后写手=本会话 v0.3 换名手术
    # (时间门会被自家相邻手术误拦);若并行会话回写旧态,此断言当场红。
    cur = WF.read_text(encoding="utf-8")
    assert "v0.3-6step-lora-r256" in cur and "v0.2.1-6step-lora-r256" not in cur, \
        "[静默门] 现态不是本会话 v0.3 换名手术的产物(疑似并行回写),拦停"

    doc = json.loads(WF.read_text(encoding="utf-8"))
    sgs = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME]
    assert len(sgs) == 1, f"加速子图应恰 1 个,得 {len(sgs)}"
    sg = sgs[0]
    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}

    # ---- 前置断言(现态逐项对拍) ----
    assert nodes[7012]["type"] == "KSampler", "7012 应仍为 KSampler(重复手术?)"
    assert nodes[7011]["widgets_values"][0].endswith("v0.3-6step-lora-r256.safetensors"), "7011 应已 v0.3"
    assert links[14]["target_id"] == 7012 and links[107]["target_id"] == 7012
    assert links[112]["target_slot"] == 3 and links[117]["target_id"] == 7012
    assert links[110]["target_id"] == 7012 and links[110]["target_slot"] == 2
    neg_slot = next(i for i in sg["inputs"] if i["name"] == "negative")
    assert neg_slot["linkIds"] == [109, 110], f"negative 槽 linkIds 应 [109,110],得 {neg_slot['linkIds']}"
    new_ids = {7017, 7018, 7019, 7020}
    assert not (new_ids & set(nodes)), "新 id 撞已有节点"
    assert not ({4305, 4306, 4307, 4308} & set(links)), "新线 id 撞已有线"

    # ---- 备份 ----
    BAK.mkdir(parents=True, exist_ok=True)
    shutil.copy2(WF, BAK / WF.name)

    # ---- 7012 原位换类 ----
    n12 = nodes[7012]
    n12["type"] = "SamplerCustomAdvanced"
    n12["title"] = "[7012] viggle官方6σ·SamplerCustom"
    n12["size"] = [330, 200]
    n12["inputs"] = [
        {**sgp("NOISE", "noise", "噪声"), "link": 4305},
        {**sgp("GUIDER", "guider", "引导"), "link": 4306},
        {**sgp("SAMPLER", "sampler", "采样器"), "link": 4307},
        {**sgp("SIGMAS", "sigmas", "Sigmas"), "link": 4308},
        {**sgp("LATENT", "latent_image", "Latent图像"), "link": 112},
    ]
    n12["outputs"] = [
        outp("LATENT", "output", "输出", [120]),
        outp("LATENT", "denoised_output", "去噪输出", []),
    ]
    n12["properties"]["Node name for S&R"] = "SamplerCustomAdvanced"
    n12["widgets_values"] = []
    n12["widgets_values_named"] = {}

    # ---- 新四件 ----
    def base_node(nid, cls, pos, size, order, title):
        return {"id": nid, "type": cls, "pos": pos, "size": size, "flags": {},
                "order": order, "mode": 0, "inputs": [], "outputs": [],
                "title": title, "properties": {"Node name for S&R": cls,
                                               "cnr_id": "comfy-core", "ue_properties": dict(UE)}}

    n17 = base_node(7017, "RandomNoise", [870, 1150], [270, 90], 6, "[7017] viggle噪声·RandomNoise")
    n17["inputs"] = [sgp("INT", "noise_seed", "随机种子")]
    n17["inputs"][0]["widget"] = {"name": "noise_seed"}
    n17["inputs"][0]["link"] = 117
    n17["outputs"] = [outp("NOISE", "NOISE", "噪声", [4305])]
    n17["widgets_values"] = [0, "fixed"]
    n17["widgets_values_named"] = {"noise_seed": 0, "control_after_generate": "fixed"}

    n18 = base_node(7018, "KSamplerSelect", [870, 1380], [270, 60], 7, "[7018] euler·KSamplerSelect")
    n18["outputs"] = [outp("SAMPLER", "SAMPLER", "采样器", [4307])]
    n18["widgets_values"] = ["euler"]
    n18["widgets_values_named"] = {"sampler_name": "euler"}

    n19 = base_node(7019, "BasicGuider", [1100, 700], [270, 110], 8, "[7019] cfg1引导·BasicGuider")
    n19["inputs"] = [sgp("MODEL", "model", "模型"), sgp("CONDITIONING", "conditioning", "条件")]
    n19["inputs"][0]["link"] = 14
    n19["inputs"][1]["link"] = 107
    n19["outputs"] = [outp("GUIDER", "GUIDER", "引导", [4306])]
    n19["widgets_values"] = []
    n19["widgets_values_named"] = {}

    n20 = base_node(7020, "CustomSigmas", [810, 1640], [330, 160], 9, "[7020] 官方6σ·CustomSigmas")
    n20["properties"] = {"Node name for S&R": "CustomSigmas", "ue_properties": dict(UE)}
    n20["outputs"] = [outp("SIGMAS", "SIGMAS", "Sigmas", [4308])]
    # interpolate_to_steps=KJNodes 语义 N=σ个数-1(6σ→5;1008 事故:0=插值成1点=零步采样)
    n20["widgets_values"] = [OFFICIAL_SIGMAS, 5]
    n20["widgets_values_named"] = {"sigmas_string": OFFICIAL_SIGMAS, "interpolate_to_steps": 5}

    # 1008 布局终版:7014 seed 单源上移让出 116 线垂带(立宪 est 间距/负区口径过 layout_check)
    nodes[7014]["pos"] = [80, 1150]
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in new_ids] + [n17, n18, n19, n20]

    # ---- 连线改向 ----
    links[14]["target_id"] = 7019
    links[107]["target_id"] = 7019
    links[117]["target_id"] = 7017
    links[117]["target_slot"] = 0  # 旧 KSampler.seed=槽4 → RandomNoise.noise_seed=槽0
    links[112]["target_slot"] = 4
    del links[110]
    neg_slot["linkIds"] = [109]
    for lid, (oid, oslot, tid, tslot, typ) in {
        4305: (7017, 0, 7012, 0, "NOISE"),
        4306: (7019, 0, 7012, 1, "GUIDER"),
        4307: (7018, 0, 7012, 2, "SAMPLER"),
        4308: (7020, 0, 7012, 3, "SIGMAS"),
    }.items():
        links[lid] = {"id": lid, "origin_id": oid, "origin_slot": oslot,
                      "target_id": tid, "target_slot": tslot, "type": typ}
    sg["links"] = [links[k] for k in sorted(links)]

    # ---- Note 随令(档2 语义仍准,补官方σ事实) ----
    note = nodes[7016]
    old_note = note["widgets_values"][0]
    assert "档2 viggle 蒸馏件 cfg恒1 负向无效" in old_note
    if "官方6σ" not in old_note:
        note["widgets_values"][0] = old_note + ";档2 v0.3=官方6σ [7020]→[7012] SamplerCustom+BasicGuider(cfg1 负向不接)"
        note["widgets_values_named"] = {"text": note["widgets_values"][0]}

    # ---- id 计数器随迁 ----
    doc["last_node_id"] = max(doc.get("last_node_id", 0), 7020)
    doc["last_link_id"] = max(doc.get("last_link_id", 0), 4308)

    # ---- 后验(全图一致性) ----
    sg2 = [s for s in doc["definitions"]["subgraphs"] if s.get("name") == SG_NAME][0]
    nds = {n["id"]: n for n in sg2["nodes"]}
    lks = {l["id"]: l for l in sg2["links"]}
    assert nds[7012]["type"] == "SamplerCustomAdvanced"
    # 7012 五槽 link 字段双向登记(链接表↔节点 inputs 互指)
    assert [i.get("link") for i in nds[7012]["inputs"]] == [4305, 4306, 4307, 4308, 112], \
        "7012 inputs link 注册应 [4305,4306,4307,4308,112]"
    assert [(lks[l]["target_id"], lks[l]["target_slot"]) for l in (4305, 4306, 4307, 4308, 112)] == \
           [(7012, 0), (7012, 1), (7012, 2), (7012, 3), (7012, 4)]
    assert (lks[14]["target_id"], lks[14]["target_slot"]) == (7019, 0)
    assert (lks[107]["target_id"], lks[107]["target_slot"]) == (7019, 1)
    assert (lks[117]["target_id"], lks[117]["target_slot"]) == (7017, 0)
    assert 110 not in lks and neg_slot["linkIds"] == [109]
    # 槽位登记守恒:每个 node input 的 link 与 links 表互指一致
    for n in sg2["nodes"]:
        for i in n.get("inputs", []):
            if i.get("link") is not None:
                l = lks[i["link"]]
                assert (l["target_id"], l["target_slot"]) == (n["id"], next(
                    idx for idx, ii in enumerate(n["inputs"]) if ii is i)), f"[{n['id']}] 槽序错指 {i['name']}"
    for n in sg2["nodes"]:
        for oi, o in enumerate(n.get("outputs", [])):
            for lid in o.get("links", []):
                assert lks[lid]["origin_id"] == n["id"] and lks[lid]["origin_slot"] == oi, \
                    f"[{n['id']}] 输出槽注册错 {lid}"

    WF.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[OK] 手术毕:7012→SamplerCustomAdvanced + 7017/7018/7019/7020 四件,8 线改向,副本={BAK}")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        import traceback
        traceback.print_exc()
        print(f"FAIL: {e}", file=sys.stderr)
        sys.exit(1)
