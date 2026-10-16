#!/usr/bin/env python3
"""qi21-道劫-i2i 编码器出子图役(2026-10-15,用户令;做完不部署不打包候令)。

结构刀:
  [4015] 主编码/[171] 单编码 自 [6] 子图迁主画布(id 保持);子图收纯「提示词装配」:
    边界入 10→7(退役 clip/vae/透明锚——唯一消费方即两编码器;image_1/2/3 留给 [25] PE合批)
    边界出 7→3(退役 positive/negative/latent/positive_single;留 prompt/画幅W/画幅H)
  主图重接线:TE 双件直吃 [2]CLIP/[3]VAE/[16][17][18]预缩/[505]透明锚/[6].prompt;
    [4015]positive/negative/latent→[7]/[20];[171]positive→[7].positive_single
  根图死线 7 根清退(3/4/20/30/70/71/218),新线 15 根(268-282);
  子图编码线双组框(带3上/带3下)随件退役,组 4→2;
  蓝图 my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json 同刀双刷;
  [402] 三句「子图编码器」措辞随刀。
fail-closed:术前 md5 字节锚;术后 coherence+恒向右双域+组零重叠+回读;幂等 exit 3。
"""
import json, shutil, sys, hashlib
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SG_PREFIX = "[6] 文本提示词类型优化子图"
PRE_MD5 = "9d0b4f6fdbf86059a502383a54148169"

TE_OUT = {4015: [4500, 920], 171: [3760, 2610]}  # oracle 坐标下降定稿(crossings 74→51/occl 15→8)
DEL_ROOT = [3, 4, 20, 30, 70, 71, 218]
NEW_LINKS = [
    (268, 2, 0, 4015, 0, "CLIP"), (269, 2, 0, 171, 0, "CLIP"),
    (270, 3, 0, 4015, 5, "VAE"), (271, 3, 0, 171, 5, "VAE"),
    (272, 16, 0, 4015, 1, "IMAGE"), (273, 16, 0, 171, 1, "IMAGE"),
    (274, 17, 0, 4015, 2, "IMAGE"), (275, 18, 0, 4015, 3, "IMAGE"),
    (276, 505, 0, 171, 2, "IMAGE"),
    (277, 6, 0, 4015, 6, "STRING"), (278, 6, 0, 171, 6, "STRING"),
    (279, 4015, 0, 7, 1, "CONDITIONING"), (280, 4015, 1, 7, 2, "CONDITIONING"),
    (281, 4015, 2, 20, 0, "LATENT"), (282, 171, 0, 7, 3, "CONDITIONING"),
]
IN_MAP = {2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6}       # -10 origin_slot 重索引
OUT_MAP = {4: 0, 5: 1, 6: 2}                               # -20 target_slot 重索引
NOTE_SUBS = [
    ("[6] 子图编码器取 **0=不重采样**",
     "编码器([4015]/[171],1015 起居主画布)取 **0=不重采样**"),
    ("子图编码器只吃选定图。",
     "编码器([4015] 主编/[171] 单编,1015 迁主画布)只吃选定图。"),
    ("latent 取 [6] 子图编码器 latent",
     "latent 取主画布 [4015] 编码器 latent"),
    # 追批(自查补刀,1015 深夜二):
    ("positive=[6].positive 多参考官方路(1014 起 viggle 支路同源多参考/Fun-Acc 仍单参考,见下节)",
     "positive=[4015].positive 多参考官方路(1015 编码器出子图:根域直供;Fun-Acc 仍单参考,见下节)"),
    ("两段 conditioning=[6].positive_single 单参考正源",
     "两段 conditioning=[171].positive 单参考正源(1015 编码器出子图:根域直供)"),
    ("子图行4 单参考编码 [171] 单编码独挑",
     "主画布单参考编码 [171] 单编码独挑(1015 出子图)"),
    ("**透明锚非第二内容参考**(专属边界槽,不占 image_1..3 三参考槽)",
     "**透明锚非第二内容参考**(1015 起根域直连 [505]→[171].image_2,不占 image_1..3 三参考槽)"),
]


def fail(m, code=2):
    print(f"[enc] FAIL: {m}"); sys.exit(code)


def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()


def sg_of(doc):
    return next(s for s in doc["definitions"]["subgraphs"] if s["name"].startswith(SG_PREFIX))


def do_subgraph(sg, te_nodes):
    """子图三刀:裁边界/删死线/重索引;返回迁移件列表。"""
    tes = [n for n in sg["nodes"] if n["id"] in TE_OUT]
    if len(tes) != 2:
        fail(f"术前应恰两编码器在子图,得 {len(tes)}")
    sg["nodes"] = [n for n in sg["nodes"] if n["id"] not in TE_OUT]
    keep_in = ["image_1", "image_2", "image_3", "指令", "型选择", "PE启用?", "RGBA透明"]
    keep_out = ["prompt", "画幅W", "画幅H"]
    if [i["name"] for i in sg["inputs"]] != ["clip", "vae", "image_1", "image_2", "image_3",
                                              "指令", "型选择", "PE启用?", "RGBA透明", "透明锚"]:
        fail("子图输入槽序术前锚不符")
    sg["inputs"] = [i for i in sg["inputs"] if i["name"] in keep_in]
    sg["outputs"] = [o for o in sg["outputs"] if o["name"] in keep_out]
    kept, dropped = [], 0
    for l in sg["links"]:
        if l["origin_id"] == -10 and l["origin_slot"] in (0, 1, 9):
            dropped += 1; continue
        if l["target_id"] == -20 and l["target_slot"] in (0, 1, 2, 3):
            dropped += 1; continue
        if l["origin_id"] in TE_OUT or l["target_id"] in TE_OUT:
            dropped += 1; continue
        if l["origin_id"] == -10:
            l["origin_slot"] = IN_MAP[l["origin_slot"]]
        if l["target_id"] == -20:
            l["target_slot"] = OUT_MAP[l["target_slot"]]
        kept.append(l)
    sg["links"] = kept
    sg["groups"] = [g for g in sg["groups"]
                    if not g["title"].startswith(("双图编码线", "单图编码线"))]
    sg["state"]["lastLinkId"] = 282
    kept_ids = {l["id"] for l in sg["links"]}
    for n in sg["nodes"]:                        # 节点侧出线回挂清死线
        for o in n.get("outputs", []):
            if o.get("links"):
                o["links"] = [i for i in o["links"] if i in kept_ids]
    for i, slot in enumerate(sg["inputs"]):      # 钉槽 linkIds 重算=幸存子图线
        slot["linkIds"] = [l["id"] for l in sg["links"]
                           if l["origin_id"] == -10 and l["origin_slot"] == i]
    for i, slot in enumerate(sg["outputs"]):
        slot["linkIds"] = [l["id"] for l in sg["links"]
                           if l["target_id"] == -20 and l["target_slot"] == i]
    return tes, dropped


def main():
    if not WF.exists(): fail("真源缺失")
    cur = md5(WF)
    if cur != PRE_MD5:
        d0 = json.loads(WF.read_text(encoding="utf-8"))
        try:
            sg0 = sg_of(d0)
            if not any(n["id"] in TE_OUT for n in sg0["nodes"]) and \
               any(n["id"] == 4015 for n in d0["nodes"]):
                print("[enc] 已术后形态,幂等拦停"); sys.exit(3)
        except Exception:
            pass
        fail(f"术前 md5 锚不符:{cur}")

    wf = json.loads(WF.read_text(encoding="utf-8"))
    sg = sg_of(wf)
    root = {n["id"]: n for n in wf["nodes"]}
    n0, l0 = len(wf["nodes"]), len(wf["links"])

    # ── 刀1:子图 ──
    tes, dropped = do_subgraph(sg, TE_OUT)
    # ── 刀2:两编码器落主画布 ──
    for te in tes:
        te["pos"] = TE_OUT[te["id"]]
        te["order"] = 33 if te["id"] == 4015 else 34
        for i in te["inputs"]:
            i["link"] = None
        for o in te["outputs"]:
            o["links"] = []
        wf["nodes"].append(te)
    # ── 刀3:根图接线 ──
    wf["links"] = [l for l in wf["links"] if l[0] not in DEL_ROOT] + [list(nl) for nl in NEW_LINKS]
    wf["last_link_id"] = 282
    host = root[6]
    host["inputs"] = [i for i in host["inputs"] if i["name"] in ("image_1", "image_2", "image_3", "指令")]
    for lid, new_slot in ((5, 0), (6, 1), (208, 2), (217, 3)):   # 幸存宿主入线槽号随裁重映射
        next(l for l in wf["links"] if l[0] == lid)[4] = new_slot
    for lid, new_oslot in ((21, 0), (229, 1), (230, 2)):         # 幸存宿主出线源槽随裁重映射
        next(l for l in wf["links"] if l[0] == lid)[2] = new_oslot
    ho = {o["name"]: o for o in host["outputs"]}
    host["outputs"] = [
        {"name": "prompt", "type": "STRING", "links": [21, 277, 278]},
        {"name": "画幅W", "type": "INT", "links": [229]},
        {"name": "画幅H", "type": "INT", "links": [230]},
    ]
    root[2]["outputs"][0]["links"] = [268, 269]
    root[3]["outputs"][0]["links"] = [35, 270, 271]
    root[16]["outputs"][0]["links"] = [5, 272, 273]
    root[17]["outputs"][0]["links"] = [6, 274]
    root[18]["outputs"][0]["links"] = [208, 275]
    root[505]["outputs"][0]["links"] = [276]
    root[401]["inputs"][0]["link"] = 21
    root[20]["inputs"][0]["link"] = 281
    root[7]["inputs"][1]["link"] = 279
    root[7]["inputs"][2]["link"] = 280
    root[7]["inputs"][3]["link"] = 282
    te15 = next(n for n in wf["nodes"] if n["id"] == 4015)
    te71 = next(n for n in wf["nodes"] if n["id"] == 171)
    for slot, lid in ((0, 268), (1, 272), (2, 274), (3, 275), (5, 270), (6, 277)):
        te15["inputs"][slot]["link"] = lid
    te15["outputs"][0]["links"] = [279]; te15["outputs"][1]["links"] = [280]; te15["outputs"][2]["links"] = [281]
    for slot, lid in ((0, 269), (1, 273), (2, 276), (5, 271), (6, 278)):
        te71["inputs"][slot]["link"] = lid
    te71["outputs"][0]["links"] = [282]
    # ── 刀4:[402] 三句随刀 ──
    note = root[402]["widgets_values"]
    for old, new in NOTE_SUBS:
        if old not in note[0]: fail(f"[402] 锚句缺失:{old[:24]}")
        note[0] = note[0].replace(old, new)

    # ── 术后终验 ──
    if len(wf["nodes"]) != n0 + 2 or len(wf["links"]) != l0 - len(DEL_ROOT) + len(NEW_LINKS):
        fail(f"件数不符:节点 {n0}→{len(wf['nodes'])} 连线 {l0}→{len(wf['links'])}")
    ids = [l[0] for l in wf["links"]]
    if len(ids) != len(set(ids)): fail("根线 id 重复")
    nn2 = {n["id"]: n for n in wf["nodes"]}
    for l in wf["links"]:
        if l[1] not in nn2 or l[3] not in nn2: fail(f"根线{l[0]}端点失踪")
        if nn2[l[3]]["inputs"][l[4]].get("link") != l[0]: fail(f"根线{l[0]}未回挂{l}")
        if nn2[l[3]]["pos"][0] <= nn2[l[1]]["pos"][0]: fail(f"根左向线{l[0]}")
    def chk_sg(s):
        ns = {n["id"]: n for n in s["nodes"]}
        for l in s["links"]:
            ox = s["inputs"][l["origin_slot"]]["pos"][0] if l["origin_id"] == -10 else ns[l["origin_id"]]["pos"][0]
            tx = s["outputs"][l["target_slot"]]["pos"][0] if l["target_id"] == -20 else ns[l["target_id"]]["pos"][0]
            if tx <= ox: fail(f"子图左向线 link{l['id']}")
    chk_sg(sg)
    def ov(a, b): ax,ay,aw,ah=a; bx,by,bw,bh=b
    def ov(a,b):
        ax,ay,aw,ah=a; bx,by,bw,bh=b
        return ax<bx+bw and bx<ax+aw and ay<by+bh and by<ay+ah
    for scope,gs in [("主图",wf["groups"])]+[(s["name"][:8],s["groups"]) for s in wf["definitions"]["subgraphs"]]:
        for i in range(len(gs)):
            for j in range(i+1,len(gs)):
                if ov(gs[i]["bounding"],gs[j]["bounding"]): fail(f"{scope} 组重叠")
    if dropped != 15: fail(f"子图死线应删 15,得 {dropped}")

    bak = WF.with_suffix(".json.bak-1015enc")
    shutil.copy2(WF, bak)
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[enc] 真源落盘(备份 {bak.name})")

    # ── 蓝图双刷:同刀施加于蓝图子图 ──
    bp = json.loads(BP.read_text(encoding="utf-8"))
    bpsg = sg_of(bp)
    tes2, dropped2 = do_subgraph(bpsg, TE_OUT)
    if dropped2 != 15: fail(f"蓝图死线数不符:{dropped2}")
    BP.write_text(json.dumps(bp, ensure_ascii=False, indent=2), encoding="utf-8")
    print("[enc] 蓝图双刷落盘")

    r = json.loads(WF.read_text(encoding="utf-8"))
    if len(r["nodes"]) != n0 + 2: fail("回读不符")
    print(f"[enc] 完成:TE 双件出子图落主画布([4015]@{TE_OUT[4015]}/[171]@{TE_OUT[171]});"
          f"边界 10→7 入/7→3 出;根线 {l0}→{len(r['links'])};md5 {md5(WF)}")


if __name__ == "__main__":
    main()
