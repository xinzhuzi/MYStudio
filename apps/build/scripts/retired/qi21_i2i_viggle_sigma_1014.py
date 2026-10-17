#!/usr/bin/env python3
"""qi21-道劫-i2i viggle 支路官方化手术(2026-10-14,用户令「必须解决」色彩严查终局)。

定谳链:1013 C2 实弹色彩不对 → 严查四证据卡 → 主因=①加速档单参考正源使 image_2 对
viggle 采样器不可见(色彩只能靠 PE 文字转述)+②viggle 支路缺 ViggleTurboSigmas σ表
(官方明言 simple 调度不匹配;0928「双参考+少步=纯黑」七拍即在此错误调度下得出)。
本手术=对齐 t2i 1008「官方参数化」终态:

  ① [7011] LoraLoaderModelOnly→ViggleTurboLora(官方未合并式装载,bf16 合并丢 30% 更新)
  ② [7012] KSampler(6步)→SamplerCustomAdvanced(段A 7步 turbo)
  ③ 新增官方链八件:[7017]RandomNoise/[7018]KSamplerSelect/[7019]BasicGuider(段A)/
     [7020]ViggleTurboSigmas/[7021]SplitSigmas(step=7)/[7022]BasicGuider(段B底模)/
     [7023]DisableNoise/[7024]SamplerCustomAdvanced(段B收尾2步)
  ④ 边界+宿主面板扩「σ表」槽(九点官方表=t2i 同串);面板三控件化
  ⑤ **正源回切**:viggle 段A/段B conditioning=边界 positive(多参考,色彩真源回归
     参考图继承);Fun-Acc [7013] 仍 positive_single(T8 官方单参考设计);直出不动
  ⑥ 布局/组框随 t2i 加速域整体迁位(t2i 实证零交叉排布;7026/7027 Fix 挂件不搬)
  ⑦ [402] 说明五段随刀(viggle 支路/直出铁则句/正源沿革/面板句/seed 扇出句)

蓝图不涉(加速子图无蓝图件);工作流单侧手术。fail-closed:术前指纹不符即零写入;
术后 coherence(连线-槽名-类型/边界 linkIds 对账/census)不过即退出。幂等:已官方
化形态拦停 exit 3。配套:契约测试重锚(本脚本不动测试)。
"""
import copy
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
T2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
SIGMA = "1.0, 0.9583, 0.9167, 0.875, 0.75, 0.5, 0.25, 0.16666667, 0.08333333"
NEW_NODES = (7017, 7018, 7019, 7020, 7021, 7022, 7023, 7024)
DEL_LINKS = {6, 7, 13, 15, 18}
# (id, origin, oslot, target, tslot, type)
NEW_LINKS = [
    (22, 7014, 0, 7017, 0, "INT"),
    (23, 7011, 0, 7019, 0, "MODEL"),
    (24, -10, 1, 7019, 1, "CONDITIONING"),
    (25, 7017, 0, 7012, 0, "NOISE"),
    (26, 7019, 0, 7012, 1, "GUIDER"),
    (27, 7018, 0, 7012, 2, "SAMPLER"),
    (28, -10, 4, 7020, 0, "LATENT"),
    (29, -10, 7, 7020, 1, "STRING"),
    (30, 7020, 0, 7021, 0, "SIGMAS"),
    (31, 7021, 0, 7012, 3, "SIGMAS"),
    (32, -10, 0, 7022, 0, "MODEL"),
    (33, -10, 1, 7022, 1, "CONDITIONING"),
    (34, 7023, 0, 7024, 0, "NOISE"),
    (35, 7022, 0, 7024, 1, "GUIDER"),
    (36, 7018, 0, 7024, 2, "SAMPLER"),
    (37, 7021, 1, 7024, 3, "SIGMAS"),
    (38, 7012, 0, 7024, 4, "LATENT"),
    (39, 7024, 0, 7015, 2, "LATENT"),
]
# t2i 迁位表(7013 同位不动;7026/7027 不搬)
POS_ADOPT = {7010: [400, 1900], 7011: [800, 700], 7012: [1740, 700], 7014: [80, 400],
             7015: [2760, 1150]}
NOTE_EDITS = [
    ("### 加速区·加速子图(0929 S3 收装批:三支路+出图速度选择+seed 全收进「道劫·加速子图」;宿主 [7] 双击进入,面板=「速度档位」combo+「seed」)",
     "### 加速区·加速子图(0929 S3 收装批;1014 viggle 官方化:σ表+9步满血双段+正源回切;宿主 [7] 双击进入,面板=「速度档位」combo+「seed」+「σ表」)"),
    ("**宿主面板双控件(面板值=生效值)**:「速度档位」combo(首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」=1009 用户新令(推翻本件 1002 Fun-Acc 令;直出40步居二))+「seed」number(默认 0;子图内 [7014] 单源扇出三支路,T8 seed 已输入化,一处改三支路同步)。",
     "**宿主面板三控件(面板值=生效值)**:「速度档位」combo(首项=「0 · Fun-Acc 4步」=全局出厂默认;本件默认=「2 · viggle」=1009 用户新令(推翻本件 1002 Fun-Acc 令;直出40步居二))+「seed」number(默认 0;子图内 [7014] 单源扇出三采,一处改三支路同步)+「σ表」(1014 挂 ViggleTurboSigmas:九点官方表,动态 shift 按分辨率;t2i 1008 同款)。"),
    ("positive=[6].positive 双参考官方路(0928 黑图修复铁则:直出支路双参考/两加速档单参考,见下节)。",
     "positive=[6].positive 多参考官方路(1014 起 viggle 支路同源多参考/Fun-Acc 仍单参考,见下节)。"),
    ("- **viggle 支路([7011]→[7012],子图行2,combo「2 · viggle」)**:[7011] LoraLoaderModelOnly(name 预填 **Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors**,viggle 蒸馏件已装机,strength 1.0=1002 衔接批㉔用户令「要定在 1.0 上面否则就失去了意义」(推翻 0925 探针定档 0.8=flatMAD 2.52→1.75;「目前暂时」=可视效果再调))→[7012] KSampler 6 步(viggle 6 步=1002 考据轮官方模型卡荐档(HuggingFace Viggle 官方卡:viggle-turbo v0.2.1 r256 荐 6 步/cfg 1.0/euler,官方配 BasicGuider+『Viggle Turbo Sigmas』sigma 表;本仓未挂 sigma 表沿用 simple 调度=已知偏差,画质异常先查此;旧 359 步系 TE-Speed 时代历史值);cfg 保持 1)。模型卡注 shift_terminal=0.02 伤末步,画质异常先查调度。",
     "- **viggle 支路(1014 官方化=官方9步满血双段)**:[7011] ViggleTurboLora(官方未合并式装载 W x + B A x——拒 bf16 合并丢 30% 更新;name 预填 viggle-turbo-v0.3-6step-lora-r256,strength 1.0=1002 ㉔ 令)→[7020] ViggleTurboSigmas(σ表提升宿主面板,九点官方表,动态 shift 按分辨率——官方明言 base 配置 shift_terminal=0.02 伤末步/普通 simple 调度不匹配,旧「本仓未挂 sigma 表」欠账就此清偿,0928 纯黑与 1013 色彩衰减的主因)→[7021] SplitSigmas(step=7)切段:段A [7012] SamplerCustomAdvanced 7 步 turbo→段B [7024] 底模收尾 2 步(摘 LoRA+[7023]DisableNoise 续采);两段 conditioning=[6].positive 多参考正源(1014 回切:色彩真源回归参考图继承,Fun-Acc 仍单参考)。"),
    ("### 加速档单参考正源(0928 黑图修复;viggle/Fun-Acc 两加速档专用)",
     "### 加速档正源沿革(0928 黑图修复立「加速档单参考正源」;1014 viggle 翻案回切多参考)"),
    ("40 步直出档不受影响。单参考(仅 image_1)两加速档全真——viggle 单参考 105s/Fun-Acc 单参考 120s 出真图(结构相关 r=0.872)。",
     "40 步直出档不受影响。单参考(仅 image_1)两加速档全真——viggle 单参考 105s/Fun-Acc 单参考 120s 出真图(结构相关 r=0.872)。**1014 翻案注**:该七拍判别是在未挂 σ 表的错误调度下得出的——σ表+9步双段挂上后 viggle 多参考当复验(1014 实弹收据在 apps/output/i2i-fire-1013/);Fun-Acc 仍单参考(T8 官方单参考设计)。"),
    ("直出支路 [7010].positive=宿主 positive(多参考至多三图=「1 · 直出40步」档官方路零改动,1010 三槽收口=viggle 官方 1-3 张口径)/viggle·Fun-Acc 两档 [7012]/[7013].positive=宿主 positive_single(单参考)——正源差异内聚进各支路(0929 S3 起双正源经加速子图边界槽 positive/positive_single 分线直入,语义零改动)。",
     "直出支路 [7010].positive=宿主 positive(多参考至多三图=「1 · 直出40步」档官方路零改动,1010 三槽收口=viggle 官方 1-3 张口径)/viggle 档 [7012] 段=宿主 positive(1014 回切多参考:σ表挂正后色彩真源=参考图继承)/Fun-Acc 档 [7013].positive=宿主 positive_single(单参考)——正源差异内聚进各支路(0929 S3 起正源经加速子图边界槽分线直入)。"),
    ("viggle/Fun-Acc 档选中时行4 编码亦入链(多一次视觉编码,约 +20s)。",
     "Fun-Acc 档选中时行4 单参考编码 [171] 亦入链;viggle 档 1014 起走 [4015] 主编码多参考。"),
    ("单节点扇出 [7010]/[7012]/[7013] 三采样器——经宿主面板「seed」外露,面板值=生效值;消灭旧 [7010] widget 与 [7013] seed 两处分离。",
     "单节点扇出 [7010]/[7017]/[7013] 三采(1014:viggle 支路 seed 改经 [7017] RandomNoise.noise_seed)——经宿主面板「seed」外露,面板值=生效值;消灭旧 [7010] widget 与 [7013] seed 两处分离。"),
    ("(直出40步居二,viggle 居三);直出档的双参考语义零改动。",
     "(直出40步居二,viggle 居三);直出档的双参考语义零改动→**1014 用户令(色彩严查终局):viggle 官方化(σ表+9步双段)并正源回切 positive 多参考**。"),
]
GROUPS_NEW = [
    {"id": 1, "title": "道劫·加速子图·①Fun-Acc 支路([7013] T8 一体采样 4 步,cfg1 无负槽;positive_single 单参考正源=T8 官方设计)", "bounding": [1340, 80, 560, 340], "color": "#a1309b", "flags": {}},
    {"id": 2, "title": "道劫·加速子图·②viggle 官方9步满血双段([7011]ViggleTurboLora→[7020]σ表→[7021]切分@7→段A[7012]7步turbo→段B[7024]底模2步;正源=positive 多参考=1014 回切)", "bounding": [370, 425, 2180, 1400], "color": "#3f78d3", "flags": {}},
    {"id": 3, "title": "道劫·加速子图·③直出40步支路([7010]KSampler 40步官方完整档;多参考正源)", "bounding": [40, 1850, 720, 650], "color": "#88A", "flags": {}},
    {"id": 4, "title": "道劫·加速子图·④seed 单源([7014]PrimitiveInt 面板外露,三用扇出 7010/7017/7013)", "bounding": [40, 350, 320, 230], "color": "#a1309b", "flags": {}},
    {"id": 5, "title": "道劫·加速子图·⑤档位选择([7015]MyQi21SpeedSelect 单点汇流;懒执行未选支路零加载)", "bounding": [2710, 1090, 480, 290], "color": "#3f78d3", "flags": {}},
]


def fail(msg, code=2):
    print(f"[σmig] FAIL: {msg}")
    sys.exit(code)


def sg_of(doc, needle="加速"):
    hits = [s for s in doc["definitions"]["subgraphs"] if needle in s["name"]]
    if len(hits) != 1:
        fail(f"子图定位失败:{needle}")
    return hits[0]


def main():
    wf = json.loads(WF.read_text(encoding="utf-8"))
    t2 = json.loads(T2I.read_text(encoding="utf-8"))
    sg = sg_of(wf)
    tsg = sg_of(t2)
    if any(n["id"] == 7024 for n in sg["nodes"]):
        print("[σmig] 已官方化形态,幂等拦停(零写入)")
        sys.exit(3)
    # ── 术前指纹 ──
    census = {n["id"]: n["type"] for n in sg["nodes"]}
    if census != {7010: "KSampler", 7011: "LoraLoaderModelOnly", 7012: "KSampler",
                  7013: "T8QwenImage21FunAccPDD4Step", 7014: "PrimitiveInt",
                  7015: "MyQi21SpeedSelect"}:
        fail(f"加速子图 census 术前不符:{census}")
    names = [i["name"] for i in sg["inputs"]]
    if names != ["model", "positive", "negative", "positive_single", "latent", "速度档位", "seed"]:
        fail(f"边界槽序术前不符:{names}")
    host7 = next(n for n in wf["nodes"] if n["id"] == 7)
    if host7["widgets_values"] != ["2 · viggle", 0]:
        fail(f"宿主面板术前不符:{host7['widgets_values']}")

    nodes = {n["id"]: n for n in sg["nodes"]}
    links = {l["id"]: l for l in sg["links"]}

    # ── ① 节点族:改 7011/7012,新增官方链八件(自 t2i 深拷贝)──
    for nid in (7011, 7012):
        tpl = next(n for n in tsg["nodes"] if n["id"] == nid)
        new = copy.deepcopy(tpl)
        new["pos"] = POS_ADOPT[nid]
        for i in new.get("inputs", []):
            i["link"] = None
        for o in new.get("outputs", []):
            o["links"] = []
        idx = next(i for i, n in enumerate(sg["nodes"]) if n["id"] == nid)
        sg["nodes"][idx] = new
        nodes[nid] = new
    for nid in NEW_NODES:
        tpl = next(n for n in tsg["nodes"] if n["id"] == nid)
        new = copy.deepcopy(tpl)
        for i in new.get("inputs", []):
            i["link"] = None
        for o in new.get("outputs", []):
            o["links"] = []
        sg["nodes"].append(new)
        nodes[nid] = new
    for nid, pos in POS_ADOPT.items():
        if nid in (7011, 7012):
            continue
        nodes[nid]["pos"] = list(pos)

    # ── ② 连线:删/留/增 ──
    sg["links"] = [l for l in sg["links"] if l["id"] not in DEL_LINKS]
    l10 = next(l for l in sg["links"] if l["id"] == 10)
    l10["target_slot"] = 4          # 7012 latent_image:KSampler槽3→SCA槽4
    for lid, o, os_, t, ts, ty in NEW_LINKS:
        sg["links"].append({"id": lid, "origin_id": o, "origin_slot": os_,
                            "target_id": t, "target_slot": ts, "type": ty})

    # 三处挂接回填
    def wire(nid, slot, lid):
        for i in nodes[nid]["inputs"]:
            if i["name"] == {7017: "noise_seed", 7015: "latent_viggle"}.get(nid) or \
               (nid, i["name"]) in ((7019, "model"), (7019, "conditioning"), (7012, "noise"),
                                    (7012, "guider"), (7012, "sampler"), (7012, "sigmas"),
                                    (7012, "latent_image"), (7020, "latent"), (7020, "nodes"),
                                    (7022, "model"), (7022, "conditioning"), (7024, "noise"),
                                    (7024, "guider"), (7024, "sampler"), (7024, "sigmas"),
                                    (7024, "latent_image"), (7013, "seed"), (7014, "value")):
                i["link"] = lid
                return
        fail(f"节点 {nid} 找不到待接线槽")

    for lid, o, os_, t, ts, ty in NEW_LINKS:
        # 目标槽挂接(按名)
        want = {22: "noise_seed", 23: "model", 24: "conditioning", 25: "noise", 26: "guider",
                27: "sampler", 28: "latent", 29: "nodes", 30: "sigmas", 31: "sigmas",
                32: "model", 33: "conditioning", 34: "noise", 35: "guider", 36: "sampler",
                37: "sigmas", 38: "latent_image", 39: "latent_viggle"}[lid]
        for i in nodes[t]["inputs"]:
            if i["name"] == want:
                i["link"] = lid
                break
        else:
            fail(f"连线 {lid} 目标槽 {t}.{want} 不存在")
        # 源槽登记
        src = nodes[o] if o != -10 else None
        if src is not None:
            src["outputs"][os_]["links"] = sorted(
                set((src["outputs"][os_].get("links") or []) + [lid]))
    # 保留线的源槽登记补(7014→7013/7010 原样;链接10/-10 边界线无源节点登记)

    # ── ③ 边界 σ表 槽 + 轨口坐标随 t2i 采列(i2i 旧轨口散布全图,新布局下轨线全穿)──
    sg["inputs"].append({"id": "b7a8c9d0-1014-4e01-8f01-i2isigma7a01", "name": "σ表",
                         "type": "STRING", "linkIds": [29], "pos": [-86, 544]})
    for k, io in enumerate(sg["inputs"]):
        io["pos"] = [-86, 404 + 20 * k]
    want_ids = {}
    for l in sg["links"]:
        if l["origin_id"] == -10:
            want_ids.setdefault(l["origin_slot"], []).append(l["id"])
    for k, io in enumerate(sg["inputs"]):
        io["linkIds"] = sorted(want_ids.get(k, []))
    for k, io in enumerate(sg["inputs"]):
        if not io["linkIds"]:
            fail(f"边界槽 {io['name']} linkIds 空(契约铁律)")

    # ── ④ 宿主面板三控件 ──
    host7["inputs"].append({"name": "σ表", "type": "STRING",
                            "widget": {"name": "σ表"}, "link": None})
    host7["widgets_values"] = ["2 · viggle", 0, SIGMA]
    host7["widgets_values_named"] = {"速度档位": "2 · viggle", "seed": 0, "σ表": SIGMA}
    sg["widgets"] = ["2 · viggle", 0, SIGMA]

    # ── ⑤ 组框随迁 ──
    sg["groups"] = GROUPS_NEW
    sg["state"]["lastNodeId"] = 7024
    sg["state"]["lastLinkId"] = 39

    # ── ⑥ [402] 说明五段随刀 ──
    note = next(n for n in wf["nodes"] if n["id"] == 402)["widgets_values"]
    for old, new in NOTE_EDITS:
        if old not in note[0]:
            fail(f"[402] 锚缺失:{old[:50]}…")
        note[0] = note[0].replace(old, new)

    # ── 术后清创(实弹教训回填:保留线目标槽回挂/死挂线清理/水位)──
    ns = {n["id"]: n for n in sg["nodes"]}
    live = {l["id"] for l in sg["links"]}
    for l in sg["links"]:
        if l["target_id"] in ns and l["target_id"] != -20:
            ns[l["target_id"]]["inputs"][l["target_slot"]]["link"] = l["id"]
    for n in ns.values():
        for o in n.get("outputs", []):
            o["links"] = [x for x in (o.get("links") or []) if x in live]
        for i in n.get("inputs", []):
            if i.get("link") is not None and i["link"] not in live:
                i["link"] = None
    wf["last_node_id"] = max(wf.get("last_node_id", 0), 7024)

    # ── 术后 coherence ──
    def check(doc, label):
        s = sg_of(doc)
        ns = {n["id"]: n for n in s["nodes"]}
        ls = {l["id"]: l for l in s["links"]}
        for l in s["links"]:
            if l["origin_id"] == -10:
                if s["inputs"][l["origin_slot"]]["type"] != l["type"]:
                    fail(f"[{label}] 线{l['id']} -10 类型失配")
            elif l["origin_id"] not in ns:
                fail(f"[{label}] 线{l['id']} 源缺失")
            elif l["target_id"] == -20:
                continue
            else:
                if l["target_id"] not in ns:
                    fail(f"[{label}] 线{l['id']} 目标缺失")
                tgt = ns[l["target_id"]]
                if l["target_slot"] >= len(tgt.get("inputs", [])):
                    fail(f"[{label}] 线{l['id']} 目标槽越界")
                elif tgt["inputs"][l["target_slot"]].get("link") != l["id"]:
                    fail(f"[{label}] 线{l['id']} 目标槽未回挂")
        for nid in (7019, 7022):
            g = ns[nid]
            cl = ls[next(i["link"] for i in g["inputs"] if i["name"] == "conditioning")]
            if not (cl["origin_id"] == -10 and cl["origin_slot"] == 1):
                fail(f"[{label}] [{nid}] conditioning 应=边界 positive 槽(1014 正源回切)")
        t8p = ls[next(i["link"] for i in ns[7013]["inputs"] if i["name"] == "positive")]
        if not (t8p["origin_id"] == -10 and t8p["origin_slot"] == 3):
            fail(f"[{label}] T8 positive 应仍=positive_single 槽")
        ids = [l["id"] for l in s["links"]]
        if len(ids) != len(set(ids)):
            fail(f"[{label}] 线 id 重复")
    check(wf, "内存")
    WF.write_text(json.dumps(wf, ensure_ascii=False, indent=2), encoding="utf-8")
    check(json.loads(WF.read_text(encoding="utf-8")), "回读")
    got = {n["id"]: n["type"] for n in sg_of(json.loads(WF.read_text(encoding="utf-8")))["nodes"]}
    print(f"[σmig] 完成:census={len(got)}件(6→14);viggle=官方9步双段+σ表;正源:段A/B=positive/T8=positive_single;面板三控件。")


if __name__ == "__main__":
    main()
