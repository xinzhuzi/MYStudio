#!/usr/bin/env python3
"""qi21-道劫-i2i 透明参考锚 fail-closed 手术(2026-10-15;1014 透明锚役 T2)。

架构口径(0928 铁案+1014 深夜定谳结构性保持;方案 B 专属锚路,方案 A 硬接
生产否决):透明参考不进三参考槽、不做第二内容参考——装配子图边界第 10 槽
「透明锚」(全字段 id/pos)+根域 [505] LoadImage 双槽模板(与 [12] 占位同
手法,默认 mode4 旁路,Ctrl+B 解旁路才进执行图,默认行为≡无锚)。加速两档
正源恒 positive_single 单内容参考。

十二笔(与 Trellis 计划逐条对应):
  ① [171].inputs index3 插 images.image_2(autogrow 图槽追加在 vae 后,与
    [4015] 三图件槽序同构:0 clip/1 image_1/2 vae/3 image_2/4 prompt)
  ② 线 35 target_slot 3→4([153].prompt 随 autogrow 后移)
  ③ sg link 218 = (-10,槽9)→(171,槽3) IMAGE
  ④ 边界槽 index9「透明锚」全字段(uuid c4d5e6f7-0012…/linkIds[218]/
    pos[1110,150]——沿 image 槽列 [1050,90]/[1070,110]/[1090,130] 的 +20
    节奏;1110<[171].x=6200 保横排非左向,:2048 豁免集恒空)
  ⑤ 宿主 [6].inputs 追加「透明锚」(ref5 :260-262 同式,尾插零迁移)
  ⑥ 根线 [218,505,0,6,9,"IMAGE"]
  ⑦ [505]=deepcopy [12] 模板(order=26/双 widget 槽/outputs 双槽实测):
    id=505/pos=[2500,3000]([12] 底沿 2980 下 20px 净空,零重叠)/mode=4/
    widgets_values=["transparent_ref.png","image"]/title="[505] 透明参考锚"/
    order=max+1/outputs 双槽形 MASK 禁删
  ⑧ 水位三处:wf last_link_id=max(根 218,sg 218)=218;last_node_id 保持
    7024(断言 ≥max(7024,505),禁回写小值);工作流+蓝图双侧
    sg["state"]["lastLinkId"]=max(216,218)=218
  ⑨ [402]「### RGBA 透明图句式」节后插「### 透明参考锚配方(viggle 专用)」
    (机制句引用全路径=引擎本体 comfy_extras/nodes_qwen.py:170;效果句不引
    未落盘数字,待 T7 同种子 A/B 收据 apps/output/i2i-fire-1014/anchor-probe/
    回写;沿革旧句不改写)
  ⑩ 蓝图双侧:definitions.subgraphs 同刀+顶层宿主占位 nodes[0].inputs 追加
    (surgery_blueprint_host 同式 ref5 :152-159)
  ⑪ 资产:引擎现存 1024² alpha 全 0 件(md5 5f99edae…)拷入仓库
    input_seed/ canonical+双引擎家幂等拷回(托管家家=App Support/IP 活机;
    托管家随包种子通道 seed_engine_input_samples 下次装机自动带 input_seed)
  ⑫ .bak 备份+双文件落盘回读二次 coherence(.bak 仅工作区回滚指引不入
    commit,git ls-files 实测零 .bak 入库先例)

fail-closed:术前断言不满足即 exit 2 零写入;幂等:双侧已全术后形态 exit 3
零写入,部分术后形态(单侧/半套)exit 2 拒续;术后 coherence 不过不落盘。
用法:默认对仓库真源施工;--wf/--bp 可指副本(拦停验证用,sha 期望值不变)。
"""
import argparse
import copy
import hashlib
import json
import struct
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"
SEED_DIR = REPO / "apps/backend/engines/comfyui/input_seed"
ENGINE_HOMES = (  # (标签, 家根);input 子目录=LoadImage 取图域
    ("托管家家(App Support)", Path.home() / "Library/Application Support/漫影工作室/comfyui"),
    ("活机(IP 家)", Path.home() / "Project/IP/漫影工作室/comfyui"),
)

SG_NAME_PREFIX = "[6] 文本提示词类型优化子图"
SG_UUID_TAG = "d47c9e21"          # 子图定义 uuid 段(spec 口径,现算不写死全值)
SHA_WF = "d7a35f3bb3d0394f"       # 术前字节锚(本会话实锚;副本拦停验证同值)
SHA_BP = "2dafd1ecae58fda1"

ANCHOR_LINK = 218                 # 根/子图两命名空间各一条 218(双侧独立发号)
ANCHOR_UUID = "c4d5e6f7-0012-4a12-9e12-d47c9e21a012"
ANCHOR_POS = [1110, 150]          # image 槽列 +20 节奏续排;x=1110<6200 非左向
TE1_ID = 171
LOAD505_ID = 505                  # 根域透明锚模板 id(避子图域 21/23/24/25/27 契约)
ANCHOR_POS_X_LIMIT = 6200         # = sg[171].pos[0](横排右向界)

PRE_SG_INPUTS = ["clip", "vae", "image_1", "image_2", "image_3",
                 "指令", "型选择", "PE启用?", "RGBA透明"]
POST_SG_INPUTS = PRE_SG_INPUTS + ["透明锚"]
PRE_TE1_INPUTS = ["clip", "images.image_1", "vae", "prompt"]
POST_TE1_INPUTS = ["clip", "images.image_1", "vae", "images.image_2", "prompt"]

NOTE_ANCHOR = "### RGBA 透明图句式"
NOTE_SECTION = """### 透明参考锚配方(viggle 专用;1014)

- **适用**:透明四型(道具/多视图/高清人脸/表情差分)×「2 · viggle」档;「1 · 原生出图」档与直出无需锚。
- **操作**:选中 [505] 透明参考锚 按 Ctrl+B 解旁路(同 [12]/[18] 占位惯例;默认旁路=零进执行图,默认行为与无锚时完全一致)。
- **锚规格**:固定 1024² 全透明 PNG(引擎 input 目录 transparent_ref.png;仓库真源 input_seed/)。机制依据=引擎本体 comfy_extras/nodes_qwen.py:170「the vision tower sees alpha over white, the vae keeps all four」(注意:同名 comfy_api_nodes/nodes_qwen.py 为另一内容,引用须带目录防索骥错件)。
- **效果**:增益待 T7 同种子 A/B 配对复验收据(apps/output/i2i-fire-1014/anchor-probe/)定稿回写,当前不引未落盘数字。
- **黑屏处置**:概率性塌缩,seed 面板改数重跑即愈(1014 用户令:不自动降档)。
- **口径显式**:加速两档正源=positive_single 单内容参考,**透明锚非第二内容参考**(专属边界槽,不占 image_1..3 三参考槽);勿据沿革旧句回切多参考(0928 铁案:多参考进编码在少步档有黑屏风险)。
"""

ASSET_NAME = "transparent_ref.png"
ASSET_MD5_PREFIX = "5f99edae"


def fail(msg, code=2):
    print(f"[anchor1014] FAIL: {msg}")
    sys.exit(code)


def load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"{p.name} 非 JSON(字节损坏?):{e}")


def sha16(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def md5_of(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def find_sg(doc):
    hits = [s for s in doc.get("definitions", {}).get("subgraphs", [])
            if s.get("name", "").startswith(SG_NAME_PREFIX)]
    if len(hits) != 1:
        fail(f"装配子图定义命中 {len(hits)} 份(预期 1)")
    sg = hits[0]
    if SG_UUID_TAG not in sg.get("id", ""):
        fail(f"子图 uuid 段不符(应含 {SG_UUID_TAG}):{sg.get('id')}")
    return sg


def png_dims(p: Path):
    b = p.read_bytes()
    if b[:8] != b"\x89PNG\r\n\x1a\n":
        fail(f"资产非 PNG:{p}")
    w, h = struct.unpack(">II", b[16:24])
    return w, h


# ── 术前断言 ──────────────────────────────────────────────────────────
def pre_assert(wf_path: Path, bp_path: Path, wf_doc: dict, bp_doc: dict,
               sg: dict, bp_sg: dict):
    for p, want in ((wf_path, SHA_WF), (bp_path, SHA_BP)):
        got = sha16(p)
        if got != want:
            fail(f"{p.name} 术前字节锚不符:sha256[:16]={got} 预期 {want}"
                 f"(现场漂移或已被他役改写,禁为过门放宽)")
    if (json.dumps(sg, sort_keys=True, ensure_ascii=False)
            != json.dumps(bp_sg, sort_keys=True, ensure_ascii=False)):
        fail("术前定义即不等(wf sg vs bp sg canonical),结构漂移")

    names = [i["name"] for i in sg["inputs"]]
    if names != PRE_SG_INPUTS:
        fail(f"术前边界槽序不符:{names}")
    if sg["inputs"][3].get("linkIds") != [6, 47]:
        fail(f"边界 image_2.linkIds 应恒 [6,47],得 {sg['inputs'][3].get('linkIds')}")

    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    te1 = sg_nodes.get(TE1_ID)
    if te1 is None:
        fail(f"子图缺 [{TE1_ID}]")
    te1_in = [i["name"] for i in te1["inputs"]]
    if te1_in != PRE_TE1_INPUTS:
        fail(f"[{TE1_ID}] 术前槽序不符(幂等/部分术后拦停):{te1_in}")
    l35 = next(l for l in sg["links"] if l["id"] == 35)
    if not (l35["origin_id"] == 153 and l35["target_id"] == TE1_ID
            and l35["target_slot"] == 3 and l35["type"] == "STRING"):
        fail(f"线 35 术前形态不符:{l35}")

    sg_link_ids = [l["id"] for l in sg["links"]]
    if max(sg_link_ids) != 214:
        fail(f"子图线最大 id 应 214,得 {max(sg_link_ids)}")
    if sg["state"]["lastLinkId"] != 216:
        fail(f"子图 lastLinkId 应 216,得 {sg['state']['lastLinkId']}")

    root = {n["id"]: n for n in wf_doc["nodes"]}
    if wf_doc["last_link_id"] != 217:
        fail(f"根 last_link_id 应 217,得 {wf_doc['last_link_id']}")
    if wf_doc["last_node_id"] != 7024:
        fail(f"根 last_node_id 应 7024,得 {wf_doc['last_node_id']}")
    if max(l[0] for l in wf_doc["links"]) != 217:
        fail(f"根线最大 id 应 217,得 {max(l[0] for l in wf_doc['links'])}")
    if LOAD505_ID in root:
        fail(f"根图节点 id {LOAD505_ID} 已被占用")
    if any(n["type"] == "LoadImage"
           and (n.get("widgets_values") or [""])[0] == ASSET_NAME
           for n in wf_doc["nodes"]):
        fail(f"根域已存在 {ASSET_NAME} LoadImage(部分术后拦停)")

    used = {i.get("id") for i in sg["inputs"]} | {i.get("id") for i in sg["outputs"]}
    if ANCHOR_UUID in used:
        fail(f"uuid {ANCHOR_UUID} 已被占用")

    host = root[6]
    if [i["name"] for i in host["inputs"]] != PRE_SG_INPUTS:
        fail(f"宿主 [6] 术前 inputs 镜像不符:{[i['name'] for i in host['inputs']]}")
    bp_host = bp_doc["nodes"][0]
    if [i["name"] for i in bp_host["inputs"]] != PRE_SG_INPUTS:
        fail(f"蓝图宿主占位术前 inputs 镜像不符:{[i['name'] for i in bp_host['inputs']]}")

    tpl = root[12]
    if (tpl["type"] != "LoadImage" or tpl["mode"] != 4
            or [o["name"] for o in tpl["outputs"]] != ["IMAGE", "MASK"]
            or len(tpl["inputs"]) != 2):
        fail(f"[12] 模板形不符(order/双槽/双 widget 实锚漂移):{tpl.get('outputs')}")

    note = next(n for n in wf_doc["nodes"] if n["type"] == "MarkdownNote")
    if note["id"] != 402:
        fail(f"首 MarkdownNote 应 [402],得 [{note['id']}](契约 _by_type[0] 对齐)")
    txt = note["widgets_values"][0]
    if NOTE_ANCHOR not in txt:
        fail("[402] 缺插入锚节「### RGBA 透明图句式」")
    if "透明参考锚" in txt or ASSET_NAME in txt:
        fail("[402] 已含透明锚 token(部分术后拦停)")
    return sg, bp_sg


# ── 幂等判别:全术后=exit 3;部分术后=fail ─────────────────────────────
def idempotent_or_partial(wf_doc: dict, bp_doc: dict):
    sg = find_sg(wf_doc)
    if "透明锚" not in [i["name"] for i in sg["inputs"]]:
        return False
    ok = []
    bp_sg = find_sg(bp_doc)
    ok.append([i["name"] for i in bp_sg["inputs"]] == POST_SG_INPUTS)
    ok.append(sg["state"]["lastLinkId"] == ANCHOR_LINK
              and bp_sg["state"]["lastLinkId"] == ANCHOR_LINK)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    te1_in = [i["name"] for i in sg_nodes[TE1_ID]["inputs"]]
    ok.append(te1_in == POST_TE1_INPUTS)
    ok.append(next(l for l in sg["links"] if l["id"] == 35)["target_slot"] == 4)
    root = {n["id"]: n for n in wf_doc["nodes"]}
    li = root.get(LOAD505_ID)
    ok.append(li is not None and li["type"] == "LoadImage" and li["mode"] == 4
              and [o["name"] for o in li["outputs"]] == ["IMAGE", "MASK"])
    ok.append(wf_doc["last_link_id"] >= ANCHOR_LINK)
    if all(ok):
        print("[anchor1014] 双侧已全术后形态,幂等拦停(零写入)")
        sys.exit(3)
    fail(f"部分术后形态(单侧/半套,手术中断禁续):{ok}")


# ── 资产 ⑪:canonical+双家幂等 ─────────────────────────────────────────
def ensure_asset():
    cands = [SEED_DIR / ASSET_NAME] + [h / "input" / ASSET_NAME for _, h in ENGINE_HOMES]
    src = next((p for p in cands if p.is_file()
                and md5_of(p).startswith(ASSET_MD5_PREFIX)), None)
    if src is None:
        fail(f"引擎家/仓库均无 md5 {ASSET_MD5_PREFIX}… 的 {ASSET_NAME}(资产缺位)")
    w, h = png_dims(src)
    if (w, h) != (1024, 1024):
        fail(f"资产尺寸应 1024²,得 {w}×{h}")
    print(f"[anchor1014] 资产源:{src}(md5 {md5_of(src)[:16]}…,{w}×{h})")
    for label, dst in [("仓库 input_seed canonical", SEED_DIR / ASSET_NAME)] + [
            (f"引擎家 {lbl}", hm / "input" / ASSET_NAME) for lbl, hm in ENGINE_HOMES]:
        if dst.exists():
            if md5_of(dst) == md5_of(src):
                print(f"[anchor1014] 资产已同字节,幂等跳过:{label}")
                continue
            fail(f"{label} 现存 {ASSET_NAME} 字节不符(md5 {md5_of(dst)[:16]}…),拒覆盖")
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(src.read_bytes())
        if md5_of(dst) != md5_of(src):
            fail(f"{label} 拷贝后校验失败")
        print(f"[anchor1014] 资产落位:{label} → {dst}")


# ── 子图单侧手术(工作流+蓝图同刀,变更后仍定义相等)─────────────────
def surgery_subgraph(sg, label):
    links = {l["id"]: l for l in sg["links"]}
    nodes = {n["id"]: n for n in sg["nodes"]}
    te1 = nodes[TE1_ID]
    if [i["name"] for i in te1["inputs"]] != PRE_TE1_INPUTS:
        fail(f"[{label}] [{TE1_ID}] 槽序不符:{[i['name'] for i in te1['inputs']]}")
    l35 = links[35]
    if not (l35["origin_id"] == 153 and l35["target_id"] == TE1_ID
            and l35["target_slot"] == 3):
        fail(f"[{label}] 线 35 术前形态不符:{l35}")
    # ② 线 35 prompt 迁槽 3→4   ① [171] index3 插 images.image_2
    l35["target_slot"] = 4
    te1["inputs"].insert(3, {"name": "images.image_2", "type": "IMAGE",
                             "shape": 7, "link": ANCHOR_LINK})
    # ③ 新内部线 ④ 边界第 10 槽  ⑧ 水位
    sg["links"].append({"id": ANCHOR_LINK, "origin_id": -10, "origin_slot": 9,
                        "target_id": TE1_ID, "target_slot": 3, "type": "IMAGE"})
    sg["inputs"].append({"id": ANCHOR_UUID, "name": "透明锚", "type": "IMAGE",
                         "linkIds": [ANCHOR_LINK], "pos": list(ANCHOR_POS)})
    sg["state"]["lastLinkId"] = max(sg["state"].get("lastLinkId") or 0, ANCHOR_LINK)


# ── 术后 coherence(ref5 :162-221 基础+本役新增)──────────────────────
def coherence(doc, label, host_expected=True):
    nodes = {n["id"]: n for n in doc["nodes"]}
    sg = find_sg(doc)
    sg_nodes = {n["id"]: n for n in sg["nodes"]}
    sg_links = {l["id"]: l for l in sg["links"]}
    if host_expected:
        for l in doc["links"]:
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
        host = nodes[6]
        if [i["name"] for i in host["inputs"]] != [i["name"] for i in sg["inputs"]]:
            fail(f"[{label}] 宿主/子图 inputs 镜像失配")
        if [i["type"] for i in host["inputs"]] != [i["type"] for i in sg["inputs"]]:
            fail(f"[{label}] 宿主/子图 inputs 类型失配")
        if host["inputs"][9].get("link") != ANCHOR_LINK:
            fail(f"[{label}] 宿主透明锚槽 link 应 {ANCHOR_LINK}")
        li = nodes.get(LOAD505_ID)
        if li is None or li["type"] != "LoadImage":
            fail(f"[{label}] 根域缺 [{LOAD505_ID}] LoadImage")
        if li["mode"] != 4 or li["widgets_values"][0] != ASSET_NAME:
            fail(f"[{label}] [{LOAD505_ID}] 应 mode4+{ASSET_NAME}")
        if li.get("title") != f"[{LOAD505_ID}] 透明参考锚":
            fail(f"[{label}] [{LOAD505_ID}] title 带号不符:{li.get('title')!r}")
        if [(o["name"], o["type"], o.get("links")) for o in li["outputs"]] != \
                [("IMAGE", "IMAGE", [ANCHOR_LINK]), ("MASK", "MASK", None)]:
            fail(f"[{label}] [{LOAD505_ID}] outputs 双槽形不符(MASK 禁删)")
        if [l for l in doc["links"] if l[0] == ANCHOR_LINK] != \
                [[ANCHOR_LINK, LOAD505_ID, 0, 6, 9, "IMAGE"]]:
            fail(f"[{label}] 根线 {ANCHOR_LINK} 形态不符")
        note = next(n for n in doc["nodes"] if n["type"] == "MarkdownNote")
        txt = note["widgets_values"][0]
        for tok in ("透明参考锚", ASSET_NAME, "anchor-probe"):
            if tok not in txt:
                fail(f"[{label}] [402] 缺 token:{tok!r}")
    else:
        ph = doc["nodes"][0]
        if [i["name"] for i in ph["inputs"]] != [i["name"] for i in sg["inputs"]]:
            fail(f"[{label}] 蓝图宿主占位镜像 10 槽失配")
        if ph["inputs"][9].get("link") is not None:
            fail(f"[{label}] 蓝图宿主占位透明锚槽 link 应 null")

    # 子图线通用一致性(ref5 同式)
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
            fail(f"[{label}] 边界槽 {io['name']} linkIds 对账失配:"
                 f"{io.get('linkIds')} vs {want}")
    ids = [l["id"] for l in sg["links"]]
    if len(ids) != len(set(ids)):
        fail(f"[{label}] 子图线 id 重复")

    # ── 本役新增:透明锚域术后断言 ──
    if [i["name"] for i in sg["inputs"]] != POST_SG_INPUTS:
        fail(f"[{label}] 术后边界槽序不符:{[i['name'] for i in sg['inputs']]}")
    a = sg["inputs"][9]
    if a.get("id") != ANCHOR_UUID or a["type"] != "IMAGE" or a.get("linkIds") != [ANCHOR_LINK]:
        fail(f"[{label}] 透明锚边界槽全字段不符:{a}")
    if not (isinstance(a.get("pos"), list) and len(a["pos"]) == 2
            and a["pos"][0] < ANCHOR_POS_X_LIMIT):
        fail(f"[{label}] 透明锚 pos 应带且 x<{ANCHOR_POS_X_LIMIT},得 {a.get('pos')}")
    l218 = sg_links.get(ANCHOR_LINK)
    if l218 is None or (l218["origin_id"], l218["origin_slot"], l218["target_id"],
                        l218["target_slot"], l218["type"]) != (-10, 9, TE1_ID, 3, "IMAGE"):
        fail(f"[{label}] 子图线 {ANCHOR_LINK} 形态不符:{l218}")
    ox = a["pos"][0]
    tx = sg_nodes[TE1_ID]["pos"][0]
    if tx <= ox:
        fail(f"[{label}] 透明锚线非右向({ox}→{tx}),横排单向流破约")
    l35 = sg_links[35]
    if l35["target_id"] != TE1_ID or l35["target_slot"] != 4:
        fail(f"[{label}] 线 35 应迁槽 4:{l35}")
    te1_in = sg_nodes[TE1_ID]["inputs"]
    if [i["name"] for i in te1_in] != POST_TE1_INPUTS:
        fail(f"[{label}] [{TE1_ID}] 术后槽序不符:{[i['name'] for i in te1_in]}")
    if te1_in[3].get("link") != ANCHOR_LINK:
        fail(f"[{label}] [{TE1_ID}].images.image_2 link 应 {ANCHOR_LINK}")
    if sg["state"]["lastLinkId"] != ANCHOR_LINK:
        fail(f"[{label}] sg.lastLinkId 应 {ANCHOR_LINK},得 {sg['state']['lastLinkId']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wf", type=Path, default=WF, help="工作流路径(副本拦停验证用)")
    ap.add_argument("--bp", type=Path, default=BP, help="蓝图路径(副本拦停验证用)")
    ap.add_argument("--skip-asset", action="store_true",
                    help="副本拦停验证时不落资产(真源施工恒落)")
    args = ap.parse_args()
    wf_path, bp_path = args.wf.resolve(), args.bp.resolve()
    print(f"[anchor1014] 目标:wf={wf_path} bp={bp_path}")

    wf_doc, bp_doc = load(wf_path), load(bp_path)
    sg, bp_sg = find_sg(wf_doc), find_sg(bp_doc)
    if sg["id"] != bp_sg["id"]:
        fail("工作流/蓝图子图 id 不一致")
    # 序:幂等判别先于 sha/结构术前断言——复跑时文件已术后态,字节必变,
    # sha 先行会把幂等拦停误杀成 exit 2;先认全术后形态(exit 3)再严检术前。
    idempotent_or_partial(wf_doc, bp_doc)
    pre_assert(wf_path, bp_path, wf_doc, bp_doc, sg, bp_sg)
    print("[anchor1014] 术前断言全绿(sha/槽序/线形/水位/uuid/模板/镜像/定义相等)")

    if not args.skip_asset:
        ensure_asset()

    # ── 根图手术(工作流侧)──
    root = {n["id"]: n for n in wf_doc["nodes"]}
    host = root[6]
    tpl = root[12]
    # ⑤ 宿主插槽 ⑥ 根线 ⑦ [505] 模板件
    host["inputs"].append({"name": "透明锚", "type": "IMAGE", "link": ANCHOR_LINK})
    li = copy.deepcopy(tpl)
    li.update(id=LOAD505_ID, pos=[2500, 3000], mode=4,
              widgets_values=[ASSET_NAME, "image"], title="[505] 透明参考锚",
              order=max(n.get("order", 0) for n in wf_doc["nodes"]) + 1)
    li["inputs"] = copy.deepcopy(tpl["inputs"])   # 双 widget 槽沿模板
    li["outputs"] = [{"name": "IMAGE", "type": "IMAGE", "links": [ANCHOR_LINK]},
                     {"name": "MASK", "type": "MASK", "links": None}]
    wf_doc["nodes"].append(li)
    wf_doc["links"].append([ANCHOR_LINK, LOAD505_ID, 0, 6, 9, "IMAGE"])
    # ⑧ 水位:根线号;last_node_id 保持 7024(禁回写小值)
    wf_doc["last_link_id"] = max(ANCHOR_LINK, max(l[0] for l in wf_doc["links"]))
    if wf_doc["last_node_id"] < max(7024, LOAD505_ID):
        fail(f"根 last_node_id {wf_doc['last_node_id']} < max(7024,505),禁回写小值")
    # ⑨ [402] 小节插入(RGBA 句式节后、下一节头前)
    note = next(n for n in wf_doc["nodes"] if n["type"] == "MarkdownNote")
    txt = note["widgets_values"][0]
    i0 = txt.find(NOTE_ANCHOR)
    i1 = txt.find("\n### ", i0)
    if i1 < 0:
        fail("[402] 句式节后未找到下一节头,插入点不明")
    note["widgets_values"][0] = txt[:i1 + 1] + NOTE_SECTION + txt[i1 + 1:]

    # ── 子图手术(工作流+蓝图同刀 ⑩)──
    surgery_subgraph(sg, "工作流")
    surgery_subgraph(bp_sg, "蓝图")
    bp_doc["nodes"][0]["inputs"].append({"name": "透明锚", "type": "IMAGE", "link": None})

    # ── 内存终验 ──
    coherence(wf_doc, "工作流")
    coherence(bp_doc, "蓝图", host_expected=False)
    if (json.dumps(sg, sort_keys=True, ensure_ascii=False)
            != json.dumps(bp_sg, sort_keys=True, ensure_ascii=False)):
        fail("术后定义不等(wf sg vs bp sg canonical)")

    # ── 落盘+.bak+回读二次 coherence(⑫)──
    for p, doc, is_wf in ((wf_path, wf_doc, True), (bp_path, bp_doc, False)):
        bak = p.with_suffix(p.suffix + ".bak-1014")
        bak.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
        p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        reread = load(p)
        coherence(reread, f"回读:{p.name}", host_expected=is_wf)
        print(f"[anchor1014] 落盘+回读终验绿:{p.name}(备份 {bak.name})")
    print("[anchor1014] 手术完成:透明锚边界第 10 槽/[171].images.image_2/线 35 迁槽/"
          "根域 [505] 双槽模板 mode4/水位 218×3/[402] 配方小节/蓝图双侧同刀,全部落盘。")


if __name__ == "__main__":
    main()
