#!/usr/bin/env python3
# 出处:2026-09-21 战役产物(二采版生成器,重基重跑);2026-09-22 带日期文件名清整提升为常驻件,幂等可重跑。
"""道劫 K2 文生图「二采版」工作流生成器(0921;Trellis 09-21-daojie-k2-dual-sample I1)。

母版 = v3 基线 K2-文生图-道劫.json(sha256 硬锁,任一前置断言失败=中止不写盘)。
本脚本深拷贝母版,按 design.md §2-§5 增量「二采组」五节点+11 链+1 组框,产出
K2-文生图-道劫-二采版.json。所有改动走本脚本(禁手改 JSON,重跑可复现)。

数据流(design §1):
  [11]VAEDecode① ─┬→ [4]SaveImage①(零改动)
                  ├→ 新[Preview] 一采预览(构图烂在此毙)
                  └→ 新[Enc]VAEEncode 像素回炉(vae=[10]) → 新[KS2]KSampler②
                       (dn0.35/6步/cfg1/euler/simple/seed=[20];model=[90] 第二线、
                        正/负向=[63]/[65] 复用) → 新[Dec2]VAEDecode②(vae=[10])
                       → 新[Save2]SaveImage②

规矩:
· 新 id 一律从探测 max+1 起(design §2:v3 被前端重存过,last_node_id=158/last_link_id=116,
  不可假设 96/105 可用)——节点 5 连号、链 11 连号、组=外层 groups max+1;写死即错;
· 节点 JSON 形状=克隆母版同型/镜像节点改字段(禁手写形状):KS2←[12]、Dec2←[11]、
  Save2←[4]、Enc(VAEEncode)←[11] 镜像、Preview(PreviewImage)←[4] 骨架;
· 布局(design §5):新列 X = [4].pos.x+[4].size.w+360;列内自 [4] 顶对齐向下排,
  间距 = [12] 节点高+80;写盘前零重叠自检(新节点矩形 vs 全部节点矩形);
· 写盘前自检另含:[90] model 出度=2、[11] IMAGE 出度=3、[10] VAE 三消费、
  链 id 唯一且新段连续、inputs/outputs 双向登记一致、widgets_values 长度与母版同型
  一致、母版 19 节点/22 链/4 组/子图/配置零变化(仅 6 节点 outputs[].links 追加);
· 幂等:产物已存在且字节一致=skip(零写盘,exit 0,收口报告与写盘路径同款输出);
  不一致=报差异退出 1(--force 才覆盖)。

用法:python3 apps/build/scripts/daojie_dual_sample_build.py [--force]

09-21 主控裁定(并行冲突处置):母版字节改从 `git show HEAD:<母版>` 取回——并行会话
正在工作区改母版做道具白底/抠图实验(未提交、mtime 活动中),本任务既不回滚其现场,
也不把基线基到流沙上;sha 断言与深拷贝源均为 HEAD 母版,工作区母版一个字节都不碰
(终验腿 b 另行盯工作区母版 sha 恒等于观测值,证明全程未染指)。
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import subprocess
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF_DIR = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
MASTER = WF_DIR / "K2-文生图-道劫.json"
MASTER_REL = "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
TARGET = WF_DIR / "K2-文生图-道劫-二采版.json"
MASTER_SHA256 = "e02e8e8d5dd16f7ac666b033261034708c7f1e58cf6d01ba0b5867654697d80f"  # v5=0922 换装+正名(Engineer-V1 TE/HDR VAE/点名标题;v4=0774532b,v3=f581b8ec)

# design §3/§4 固定字段(与 id 无关)
GROUP_COLOR = "#3a5a4a"
GROUP_TITLE = "二采组(整组旁路=单采;禁单旁路[12])"
KS2_WIDGETS = [1, "randomize", 6, 1, "euler", "simple", 0.35]
KS2_NAMED = {
    "seed": 1,
    "control_after_generate": "randomize",
    "steps": 6,
    "cfg": 1,
    "sampler_name": "euler",
    "scheduler": "simple",
    "denoise": 0.35,
}
SAVE2_PREFIX = "K2道劫文生图二采_"
# 0922 v2 吸收(黑鹤极清流同款,用户裁定不用超分、吸收 latent 放大):
# 回炉后二采前 LatentUpscaleBy ×1.5(nearest-exact 保守档;1.0=退回 v1 原档)
LU_WIDGETS = ["nearest-exact", 1.5]
LU_NAMED = {"upscale_method": "nearest-exact", "scale_by": 1.5}


def die(msg: str) -> None:
    print(f"[abort] {msg}", file=sys.stderr)
    sys.exit(1)


def sha256_file(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


# ---------- 1) 前置断言 ----------

def load_master() -> dict:
    """母版字节取自 git HEAD(09-21 主控裁定;工作区母版零接触)。

    并行会话正在工作区改母版(道具白底/抠图实验,未提交)——sha 断言对象改为
    HEAD blob:HEAD 漂移=真基线变动(该中止);工作区漂移=并行现场(与本任务无关,
    由终验腿 b 盯守恒等,不由本脚本读写)。
    """
    proc = subprocess.run(["git", "show", f"HEAD:{MASTER_REL}"],
                          capture_output=True, cwd=str(REPO))
    if proc.returncode != 0:
        die(f"git show HEAD:{MASTER_REL} 失败: "
            f"{proc.stderr.decode('utf-8', 'replace')[:200]}")
    data = proc.stdout
    got = hashlib.sha256(data).hexdigest()
    if got != MASTER_SHA256:
        die(f"HEAD 母版 sha256 漂移: {got} != {MASTER_SHA256}(基线锁定,中止)")
    try:
        wf = json.loads(data.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        die(f"HEAD 母版 JSON 解析失败: {e}")
    outer = wf.get("nodes", [])
    if len(outer) != 19:
        die(f"母版外层节点数 {len(outer)} != 19(v3 基线口径)")
    sgs = wf.get("definitions", {}).get("subgraphs", [])
    if len(sgs) != 1:
        die(f"母版子图数 {len(sgs)} != 1")
    route_types = {n["type"] for n in sgs[0].get("nodes", [])}
    if "MyDaojieRoute" not in route_types:
        die("子图内无 MyDaojieRoute 路由节点(按型线路路由不在位)")
    by_id = {n["id"]: n for n in outer}
    for nid, want in ((90, None), (11, "VAEDecode"), (12, "KSampler"), (4, "SaveImage"),
                      (10, "VAELoader"), (63, None), (65, None), (20, None)):
        if nid not in by_id:
            die(f"母版缺节点 [{nid}](手术锚点)")
        if want and by_id[nid]["type"] != want:
            die(f"母版 [{nid}] type={by_id[nid]['type']} != {want}")
    if not any(o.get("type") == "MODEL" for o in by_id[90].get("outputs", [])):
        die("母版 [90] 无 MODEL 输出(路由模型锚点)")
    print(f"[pre] 母版 sha256 校验通过({MASTER_SHA256[:12]}…);19 节点/1 子图/路由在位")
    return wf


def probe_ids(master: dict) -> dict:
    """探测外层+子图全量 id 空间(design §2:须先探测,新 id 从 max+1 起)。"""
    node_ids = [n["id"] for n in master["nodes"]]
    link_ids = [l[0] for l in master["links"]]
    group_ids = [g["id"] for g in master.get("groups", [])]
    for sg in master.get("definitions", {}).get("subgraphs", []):
        node_ids += [n["id"] for n in sg.get("nodes", [])]
        link_ids += [l["id"] for l in sg.get("links", [])]
        st = sg.get("state", {})
        node_ids.append(st.get("lastNodeId", 0))
        link_ids.append(st.get("lastLinkId", 0))
    node_ids.append(master.get("last_node_id", 0))
    link_ids.append(master.get("last_link_id", 0))
    return {
        "max_node": max(node_ids),
        "max_link": max(link_ids),
        "max_group": max(group_ids) if group_ids else 0,
        "used_nodes": set(node_ids),
        "used_links": set(link_ids),
        "used_groups": set(group_ids),
    }


# ---------- 2) 手术 ----------

def build(master: dict) -> tuple[dict, dict]:
    wf = copy.deepcopy(master)
    by_id = {n["id"]: n for n in wf["nodes"]}
    probe = probe_ids(master)

    # 新 id 段 = 探测 max+1 起(节点 6 连号/链 12 连号/组 max+1),先断言零冲突
    nid_prev, nid_enc, nid_lu, nid_ks, nid_dec, nid_save = range(probe["max_node"] + 1,
                                                                  probe["max_node"] + 7)
    new_link_ids = list(range(probe["max_link"] + 1, probe["max_link"] + 13))
    nid_group = probe["max_group"] + 1
    clash_n = [i for i in (nid_prev, nid_enc, nid_lu, nid_ks, nid_dec, nid_save)
               if i in probe["used_nodes"]]
    clash_l = [i for i in new_link_ids if i in probe["used_links"]]
    if clash_n or clash_l or nid_group in probe["used_groups"]:
        die(f"新 id 段冲突: nodes={clash_n} links={clash_l} group={nid_group}")
    (l_prev, l_enc_in, l_enc_vae, l_lu_in, l_lu_out, l_ks_model, l_ks_pos, l_ks_neg,
     l_ks_seed, l_dec_latent, l_dec_vae, l_save_img) = new_link_ids
    print(f"[probe] max_node={probe['max_node']} max_link={probe['max_link']} "
          f"max_group={probe['max_group']} -> 新节点 {nid_prev}-{nid_save}、"
          f"新链 {new_link_ids[0]}-{new_link_ids[-1]}、新组 {nid_group}")

    # 布局(design §5):新列 X=[4].x+[4].w+360;Y 自 [4] 顶对齐,间距=[12]高+80
    n4, n11, n12 = by_id[4], by_id[11], by_id[12]
    col_x = round(n4["pos"][0] + n4["size"][0] + 360, 2)
    pitch = round(n12["size"][1] + 80, 2)
    y0 = round(n4["pos"][1], 2)
    ys = [round(y0 + i * pitch, 2) for i in range(6)]
    next_order = max(n.get("order", 0) for n in wf["nodes"]) + 1

    def clone_of(src_id: int) -> dict:
        return copy.deepcopy(by_id[src_id])

    # [Preview] PreviewImage ← 克隆 [4](SaveImage 骨架:同款 images 输入/flags/配色)
    prev = clone_of(4)
    prev["id"] = nid_prev
    prev["type"] = "PreviewImage"
    prev["pos"] = [col_x, ys[0]]
    prev["size"] = [340, 220]
    prev["order"] = next_order
    prev["mode"] = 0
    prev["inputs"] = [dict(n4["inputs"][0], link=l_prev)]  # images: IMAGE
    prev["outputs"] = []  # PreviewImage 无输出槽(母版 [66] 同款空数组形状)
    prev["title"] = f"[{nid_prev}] 一采预览(构图烂在此毙)"
    prev["properties"] = copy.deepcopy(n4["properties"])
    prev["properties"]["Node name for S&R"] = "PreviewImage"
    prev["properties"]["ue_properties"]["widget_ue_connectable"] = {}
    prev.pop("widgets_values", None)  # PreviewImage 零 widget
    prev.pop("widgets_values_named", None)

    # [Enc] VAEEncode ← 克隆 [11](VAEDecode 镜像:像素入/latent 出)
    enc = clone_of(11)
    enc["id"] = nid_enc
    enc["type"] = "VAEEncode"
    enc["pos"] = [col_x, ys[1]]
    enc["order"] = next_order + 1
    enc["mode"] = 0
    enc["inputs"] = [
        {"name": "pixels", "type": "IMAGE", "link": l_enc_in},
        {"name": "vae", "type": "VAE", "link": l_enc_vae},
    ]
    enc["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": [l_lu_in]}]
    enc["title"] = f"[{nid_enc}] 像素回炉(重铸latent)"
    enc["properties"] = copy.deepcopy(n11["properties"])
    enc["properties"]["Node name for S&R"] = "VAEEncode"

    # [LU] LatentUpscaleBy ← 回炉后二采前 ×1.5(0922 v2 吸收黑鹤极清流;母版无同型,按
    # /object_info schema 手形:widgets=[upscale_method, scale_by],仅 samples 输入)
    lu = clone_of(11)  # 借 VAEDecode 的壳改字段(同 LATENT 域节点骨架)
    lu["id"] = nid_lu
    lu["type"] = "LatentUpscaleBy"
    lu["pos"] = [col_x, ys[2]]
    lu["order"] = next_order + 2
    lu["mode"] = 0
    lu["size"] = [340, 120]
    lu["inputs"] = [{"name": "samples", "type": "LATENT", "link": l_lu_in}]
    lu["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": [l_lu_out],
                      "slot_index": 0}]
    lu["widgets_values"] = list(LU_WIDGETS)
    lu["widgets_values_named"] = dict(LU_NAMED)
    lu["title"] = f"[{nid_lu}] 回炉放大×1.5(极清档;1.0=原档)"
    lu["properties"] = copy.deepcopy(n11["properties"])
    lu["properties"]["Node name for S&R"] = "LatentUpscaleBy"

    # [KS2] KSampler ← 克隆 [12](同型;widgets 位置序=房样 7 槽)
    ks = clone_of(12)
    ks["id"] = nid_ks
    ks["pos"] = [col_x, ys[3]]
    ks["order"] = next_order + 3
    ks["mode"] = 0
    for slot, lid in ((0, l_ks_model), (1, l_ks_pos), (2, l_ks_neg),
                      (3, l_lu_out), (4, l_ks_seed)):
        ks["inputs"][slot]["link"] = lid
    ks["outputs"] = [{"name": "LATENT", "type": "LATENT", "links": [l_dec_latent]}]
    ks["widgets_values"] = list(KS2_WIDGETS)
    ks["widgets_values_named"] = dict(KS2_NAMED)
    ks["title"] = f"[{nid_ks}] 二采·精修(dn0.35;旁路组=退单采)"

    # [Dec2] VAEDecode ← 克隆 [11](同型)
    dec = clone_of(11)
    dec["id"] = nid_dec
    dec["pos"] = [col_x, ys[4]]
    dec["order"] = next_order + 4
    dec["mode"] = 0
    dec["inputs"] = [
        {"name": "samples", "type": "LATENT", "link": l_dec_latent},
        {"name": "vae", "type": "VAE", "link": l_dec_vae},
    ]
    dec["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": [l_save_img]}]
    dec["title"] = f"[{nid_dec}] 二采解码"

    # [Save2] SaveImage ← 克隆 [4](同型;列尾节点,高度不挤下一件)
    save = clone_of(4)
    save["id"] = nid_save
    save["pos"] = [col_x, ys[5]]
    save["order"] = next_order + 5
    save["mode"] = 0
    save["inputs"] = [dict(n4["inputs"][0], link=l_save_img)]  # images: IMAGE
    save["outputs"] = [{"name": "images", "type": "IMAGE", "links": None}]
    save["widgets_values"] = [SAVE2_PREFIX]
    save["widgets_values_named"] = {"filename_prefix": SAVE2_PREFIX}
    save["title"] = f"[{nid_save}] 二采保存"

    new_nodes = [prev, enc, lu, ks, dec, save]
    wf["nodes"] += new_nodes

    # 新链 12 根(design §2 表+0922 v2 LU 两段;type 串与母版同型链一致,种子线=INT)
    new_links = [
        [l_prev, 11, 0, nid_prev, 0, "IMAGE"],        # 一采预览
        [l_enc_in, 11, 0, nid_enc, 0, "IMAGE"],       # 回炉编码输入
        [l_enc_vae, 10, 0, nid_enc, 1, "VAE"],        # VAE 复用(第三消费)
        [l_lu_in, nid_enc, 0, nid_lu, 0, "LATENT"],   # 回炉 latent → 放大
        [l_lu_out, nid_lu, 0, nid_ks, 3, "LATENT"],   # 放大后 latent → 二采
        [l_ks_model, 90, 0, nid_ks, 0, "MODEL"],      # 路由模型第二线
        [l_ks_pos, 63, 0, nid_ks, 1, "CONDITIONING"],  # 正向复用
        [l_ks_neg, 65, 0, nid_ks, 2, "CONDITIONING"],  # 负向复用
        [l_ks_seed, 20, 0, nid_ks, 4, "INT"],         # 种子复用(同 seed 同 randomize)
        [l_dec_latent, nid_ks, 0, nid_dec, 0, "LATENT"],  # 二采解码
        [l_dec_vae, 10, 0, nid_dec, 1, "VAE"],
        [l_save_img, nid_dec, 0, nid_save, 0, "IMAGE"],  # 二采保存
    ]
    wf["links"] += new_links

    # 母版节点 outputs[].links 双向登记(追加式,不动既有次序)
    gain = {
        11: [l_prev, l_enc_in],        # [11] IMAGE → 3 消费
        10: [l_enc_vae, l_dec_vae],    # [10] VAE → 3 消费
        90: [l_ks_model],              # [90] model → 一出两线
        63: [l_ks_pos],
        65: [l_ks_neg],
        20: [l_ks_seed],
    }
    for nid, lids in gain.items():
        outs = by_id[nid]["outputs"]
        outs[0]["links"] = list(outs[0].get("links") or []) + lids

    # 组框(design §4):id=外层 groups max+1;bounding 覆盖五节点+标题栏余量
    xs = [n["pos"][0] for n in new_nodes]
    x2s = [n["pos"][0] + n["size"][0] for n in new_nodes]
    y2s = [n["pos"][1] + n["size"][1] for n in new_nodes]
    group = copy.deepcopy(master["groups"][0])
    group["id"] = nid_group
    group["title"] = GROUP_TITLE
    group["color"] = GROUP_COLOR
    group["bounding"] = [
        round(min(xs) - 40, 2), round(min(ys) - 60, 2),
        round(max(x2s) - min(xs) + 80, 2), round(max(y2s) - min(ys) + 100, 2),
    ]
    group["flags"] = {}
    wf["groups"].append(group)

    # 计数器与身份:新 id 段收口;workflow id 派生新 uuid5(确定性,区别母版)
    wf["last_node_id"] = nid_save
    wf["last_link_id"] = new_link_ids[-1]
    wf["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL,
                              f"{master['id']}|daojie-dual-sample|0921"))

    meta = {
        "ids": {"prev": nid_prev, "enc": nid_enc, "lu": nid_lu, "ks": nid_ks,
                "dec": nid_dec, "save": nid_save, "group": nid_group,
                "links": new_link_ids},
        "gain": gain, "col_x": col_x, "pitch": pitch, "ys": ys,
        "probe": probe,
    }
    return wf, meta


# ---------- 3) 写盘前自检(任一失败=中止不写) ----------

def rect(n: dict) -> tuple[float, float, float, float]:
    x, y = n["pos"]
    w, h = n["size"]
    return (x, y, x + w, y + h)


def disjoint(a: tuple, b: tuple) -> bool:
    return a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1]


def selfcheck(wf: dict, master: dict, meta: dict) -> None:
    ids = meta["ids"]
    new_ids = [ids["prev"], ids["enc"], ids["lu"], ids["ks"], ids["dec"], ids["save"]]
    by_id = {n["id"]: n for n in wf["nodes"]}
    problems: list[str] = []

    # 计数
    if len(wf["nodes"]) != len(master["nodes"]) + 6:
        problems.append(f"节点数 {len(wf['nodes'])} != {len(master['nodes']) + 6}")
    if len(wf["links"]) != len(master["links"]) + 12:
        problems.append(f"链数 {len(wf['links'])} != {len(master['links']) + 12}")
    if len(wf["groups"]) != len(master["groups"]) + 1:
        problems.append(f"组数 {len(wf['groups'])} != {len(master['groups']) + 1}")

    # 零重叠:五新节点 vs 全部节点(含新新);母版既有互相重叠仅披露不判(基线锁定)
    for nid in new_ids:
        for n in wf["nodes"]:
            if n["id"] == nid:
                continue
            if not disjoint(rect(by_id[nid]), rect(n)):
                problems.append(f"重叠: 新[{nid}] vs [{n['id']}]")
    mm = sum(1 for i, a in enumerate(master["nodes"])
             for b in master["nodes"][i + 1:]
             if not disjoint(rect(a), rect(b)))
    if mm:
        print(f"[info] 母版自身既有重叠对 {mm} 处(基线锁定,不属本手术判定范围)")

    # 出度/消费断言([90] slot1 另有 applied→[86] 出线,出度断言限定 slot0=MODEL)
    if sorted(by_id[90]["outputs"][0]["links"]) != sorted(
            l[0] for l in wf["links"] if l[1] == 90 and l[2] == 0):
        problems.append("[90] model(slot0) 出度登记与 links 表不一致")
    if len(by_id[90]["outputs"][0]["links"]) != 2:
        problems.append(f"[90] model 出度 {len(by_id[90]['outputs'][0]['links'])} != 2")
    if len(by_id[11]["outputs"][0]["links"]) != 3:
        problems.append(f"[11] IMAGE 出度 {len(by_id[11]['outputs'][0]['links'])} != 3")
    vae_consumers = [l for l in wf["links"] if l[1] == 10 and l[5] == "VAE"]
    if len(vae_consumers) != 3:
        problems.append(f"[10] VAE 消费 {len(vae_consumers)} != 3([11]/Enc/Dec2)")

    # 链 id 唯一 + 新段连续 + 双向登记一致(全外层图)
    lids = [l[0] for l in wf["links"]]
    if len(set(lids)) != len(lids):
        problems.append("外层链 id 有重复")
    if sorted(set(lids) - {l[0] for l in master["links"]}) != ids["links"]:
        problems.append("新链 id 段不连续/不等于分配段")
    for l in wf["links"]:
        lid, src, _ss, dst, ds, _typ = l
        if by_id[dst]["inputs"][ds].get("link") != lid:
            problems.append(f"链 {lid}: dst[{dst}].inputs[{ds}].link 双向不一致")
        src_links = by_id[src]["outputs"][_ss].get("links") or []
        if lid not in src_links:
            problems.append(f"链 {lid}: src[{src}].outputs[{_ss}].links 未登记")

    # widgets 长度与母版同型一致(KS2 vs [12]=7;Save2 vs [4]=1;LU=2;Enc/Dec/Preview 零 widget)
    if len(by_id[ids["ks"]]["widgets_values"]) != len(by_id[12]["widgets_values"]):
        problems.append("KS2 widgets 长度与母版 [12] 不一致")
    if by_id[ids["ks"]]["widgets_values"] != KS2_WIDGETS:
        problems.append("KS2 widgets 值 != design §3 规格")
    if by_id[ids["lu"]]["widgets_values"] != LU_WIDGETS:
        problems.append("LU widgets 值 != 0922 v2 规格(nearest-exact/1.5)")
    if len(by_id[ids["save"]]["widgets_values"]) != len(by_id[4]["widgets_values"]):
        problems.append("Save2 widgets 长度与母版 [4] 不一致")
    for nid, t in ((ids["enc"], "VAEEncode"), (ids["dec"], "VAEDecode"),
                   (ids["prev"], "PreviewImage")):
        if by_id[nid].get("widgets_values") is not None:
            problems.append(f"[{nid}] {t} 不应带 widgets_values")

    # v2 链路断言:回炉→LU→二采 两段接线(0922 吸收放大)
    if by_id[ids["enc"]]["outputs"][0]["links"] != [ids["links"][3]]:
        problems.append("Enc 输出未指向 LU(回炉→放大断链)")
    if by_id[ids["lu"]]["outputs"][0]["links"] != [ids["links"][4]]:
        problems.append("LU 输出未指向 KS2(放大→二采断链)")
    if by_id[ids["ks"]]["inputs"][3]["link"] != ids["links"][4]:
        problems.append("KS2 latent 输入未接 LU 输出")

    # 母版零变化:19 节点逐件深比(仅允许 gain 表内 outputs[0].links 追加);
    # 前 22 链/前 4 组/子图/其余顶层键全等
    for mn in master["nodes"]:
        expect = copy.deepcopy(mn)
        extra = meta["gain"].get(mn["id"], [])
        if extra:
            o0 = expect["outputs"][0]
            o0["links"] = list(o0.get("links") or []) + extra
        if by_id[mn["id"]] != expect:
            problems.append(f"母版节点 [{mn['id']}] 出现 gain 之外的改动")
    if wf["links"][: len(master["links"])] != master["links"]:
        problems.append("母版 22 链前缀被改动")
    if wf["groups"][: len(master["groups"])] != master["groups"]:
        problems.append("母版 4 组前缀被改动")
    if wf["definitions"] != master["definitions"]:
        problems.append("子图 definitions 被改动")
    for k in ("config", "extra", "version", "revision"):
        if wf[k] != master[k]:
            problems.append(f"顶层键 {k} 被改动")

    if problems:
        print("[selfcheck FAIL]", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        sys.exit(1)
    print("[selfcheck] 全绿: 零重叠/[90]出度2/[11]出度3/[10]三消费/链双向一致/"
          "widgets 同长/母版+子图零变化")


# ---------- 4) 幂等写盘 ----------

def main() -> int:
    ap = argparse.ArgumentParser(description="道劫 t2i 二采版工作流生成器(0921)")
    ap.add_argument("--force", action="store_true",
                    help="目标文件与本次产物不一致时强制覆盖(默认报差异退出)")
    args = ap.parse_args()

    master = load_master()
    wf, meta = build(master)
    selfcheck(wf, master, meta)

    data = json.dumps(wf, ensure_ascii=False, indent=2).encode("utf-8")
    json.loads(data.decode("utf-8"))  # 序列化字节可回读(确定性保证)

    ids = meta["ids"]
    wrote = True
    if TARGET.exists():
        cur = TARGET.read_bytes()
        if cur == data:
            wrote = False  # 幂等命中: 零写盘,但报告与写盘路径同款(计数不因 skip 缺失)
            print(f"[skip] 产物已存在且字节一致(零写盘): {TARGET.relative_to(REPO)}")
        else:
            diffs = []
            try:
                old = json.loads(cur.decode("utf-8"))
                diffs.append(f"节点 {len(old.get('nodes', []))}->{len(wf['nodes'])}")
                diffs.append(f"链 {len(old.get('links', []))}->{len(wf['links'])}")
                diffs.append(f"组 {len(old.get('groups', []))}->{len(wf['groups'])}")
            except Exception as e:  # noqa: BLE001
                diffs.append(f"旧文件不可解析({e})")
            print(f"[diff] 目标已存在且与本次产物不一致: {'; '.join(diffs)}", file=sys.stderr)
            if not args.force:
                print("[abort] 不一致默认不覆盖;确认后加 --force 重跑", file=sys.stderr)
                return 1
            print("[force] 覆盖写盘")

    if wrote:
        TARGET.write_bytes(data)
        # 写后复读验证
        reread = json.loads(TARGET.read_text(encoding="utf-8"))
        assert len(reread["nodes"]) == 25 and len(reread["links"]) == 34
        assert reread["last_node_id"] == ids["save"] and reread["last_link_id"] == ids["links"][-1]

    # 统一收口报告: 写盘与幂等 skip 两路同款输出(path/sha256/nodes/links/groups/
    # 探测基线/widgets 逐行),门禁按行解析计数不因 skip 空转(0921 第2轮 build=0 修复)
    print(f"== 生成完成{'' if wrote else '(幂等skip·零写盘)'}")
    print(f"path: {TARGET.relative_to(REPO)}")
    print(f"sha256: {hashlib.sha256(data).hexdigest()}")
    print(f"nodes: {len(master['nodes'])}->{len(wf['nodes'])} "
          f"(新增 {ids['prev']} 一采预览/{ids['enc']} 回炉/{ids['lu']} 放大×1.5/"
          f"{ids['ks']} KSampler②/{ids['dec']} 解码②/{ids['save']} 保存②)")
    print(f"links: {len(master['links'])}->{len(wf['links'])} "
          f"(新增 {ids['links'][0]}-{ids['links'][-1]})")
    print(f"groups: {len(master['groups'])}->{len(wf['groups'])} "
          f"(新增 {ids['group']} 二采组 @{GROUP_COLOR})")
    print(f"探测基线: last_node_id={meta['probe']['max_node']} "
          f"last_link_id={meta['probe']['max_link']} groups_max={meta['probe']['max_group']}")
    print(f"KSampler② widgets: {KS2_WIDGETS}(dn0.35 起点,画布可调)")
    print(f"LatentUpscaleBy widgets: {LU_WIDGETS}(×1.5=极清档;改1.0=退回原档)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
