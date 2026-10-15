#!/usr/bin/env python3
"""qi21-道劫-i2i 紫底 P1 洗底链 fail-closed 手术(2026-10-15;1015 役任务②)。

病灶(1014 T7 收据):VAEDecode 出图 alpha=0 区 RGB 非零(紫底)——alpha 通道
本身正确,透明区底色 RGB 未洗。手术=[5] 解码图过洗底链后再进 [8]/[503] 双消费口:

  [5]VAEDecode → [506]SplitImageWithAlpha(RGB + 1=透明 mask)
              ├─ mask →[510]ThresholdMask(0.998)→[507].source_alpha(洗底判定)
              ├─ mask ──────────────────────────→[509].alpha(原 α 直通,零改动)
              └─ RGB →[507]PorterDuffImageComposite(mode=显式 SRC × [508]SolidMask 0)
                   →[509]JoinImageWithAlpha → [8]SaveImage + [503]SeedVR2 双喂

- SRC 数学(comfy_extras/nodes_compositing.py porter_duff_composite):
  premultiply(src×α) 后按 out_alpha 回除——首版手术(纯 Split→SRC→Join)实测
  失效:VAE 解码 alpha 噪声底 ~1e-3(uint8 取整 0 域 float α∈[0,0.002))≫ 引擎
  回除门 1e-5,α>1e-5 像素 RGB 被原样重建=紫底保留(实弹 874511 像素仅 0.254%
  被洗;引擎直调复现 α=0.001 紫底原样)。
- **[510] 阈值门(1015 修订,core comfy_extras/nodes_mask.py ThresholdMask)**:
  mask>value→1——value=0.996 ⇔ α<0.004 判透明参与洗底:SaveImage 落盘
  astype(np.uint8) 截断(nodes.py :1707-1708)⇒ PNG α=0 域=α∈[0,1/255≈
  0.00392),0.996 全盖该域(0.998 首版只盖半域=实弹二轮仅洗 4% 的教训),
  实体区与半透边缘带逐位不变、Join 走原 α 通道零二值化;
- mode 缺省 DST=输出 destination(未洗图)静默无效——显式锁 "SRC";
- [508] SolidMask 64² 恒 0:引擎侧尺寸对齐(dst_alpha→dst_image 形状,双三次
  放大约)对常量 0 无污染,小尺寸省显存;[507].MASK 出线弃用(阈值化 α 禁入
  Join,原 α 由 [506] 直供);
- 三件 mask 语义原生一致(1=透明):Split 出=1-alpha、Threshold 保序、Join 入=
  1-alpha,免 InvertMask;
- [8] 右移 [9900,3300](⑤组框下方空带,[8].right=10280<[503].left=10400 契约
  保持),洗底件恒在⑤组框 bounding 外(⑤=Ctrl+B 整组旁路语义载体);
- 纯根图手术:definitions.subgraphs canonical 前后不变(蓝图双刷=校验态),
  蓝图文件全程零写入(md5 前后一致断言)。

fail-closed:术前断言不满足即 exit 2 零写入;幂等:已全术后形态 exit 3 零写入,
部分术后形态(半套)exit 2 拒续;术后 coherence 不过不落盘。
用法:python3 qi21_i2i_alpha_wash_1015.py [--wf 副本路径(拦停验证用)]
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
BP = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs/qi21-提示词类型优化子图-i2i.json"

SHA_WF = "df1925799db96bbd"   # 术前字节锚(本会话实锚;漂移即拦停禁为过门放宽)
SHA_BP = "07d2806fd2713337"   # 蓝图只读锚(全程零写入,术后 md5 对账)

SPLIT, PD, MASK, JOIN, TH = 506, 507, 508, 509, 510   # 根段空带(现根 max=505)
L_5_SPLIT = 219               # [5].IMAGE → [506].image([5] 唯一出线)
L_PD_SRC, L_PD_DST, L_PD_SRCA = 220, 221, 222
L_SPLIT_TH, L_MASK_DSTA = 228, 223
L_PD_JOIN_IMG, L_PD_JOIN_ALPHA = 224, 225     # 225=[506]原mask→[509].alpha
L_JOIN_8, L_JOIN_503 = 226, 227
OLD_L_8, OLD_L_503 = 38, 201  # 旧 [5] 直连双喂线(退役)
NEW_LINKS = (L_5_SPLIT, L_PD_SRC, L_PD_DST, L_PD_SRCA, L_SPLIT_TH, L_MASK_DSTA,
             L_PD_JOIN_IMG, L_PD_JOIN_ALPHA, L_JOIN_8, L_JOIN_503)
# 阈值(α<0.004 判透明洗底):SaveImage 落盘 astype(np.uint8) 是截断(nodes.py
# :1707-1708 实锚)⇒ PNG α=0 域=α∈[0,1/255≈0.00392),0.998(α<0.002)首版只盖
# 半域(实弹二轮 87 万像素仅洗 4%=0.998 档实测);0.996 全盖 PNG-0 域并留 ulp
# 余量,附带代价=α∈[0.00392,0.004) 的 PNG-1 像素(≤0.4% 不透明度,不可见)。
TH_VALUE = 0.996              # α<0.002 判透明洗底(噪声域/真实半透数学空隙)

POS_SPLIT, POS_TH, POS_PD, POS_MASK, POS_JOIN = [8560, 3300], [8860, 3300], [9210, 3300], [8860, 3520], [9580, 3300]
POS_8 = [9900, 3300]          # [8] 右移(旧 [8680,1900];Join→[8] 保恒向右)
SZ_8 = [380, 330]             # [8] 原尺寸原样
GROUP5_TITLE_PREFIX = "道劫·⑤SeedVR2放大尾档"

WASH_TYPES = {"SplitImageWithAlpha", "PorterDuffImageComposite",
              "JoinImageWithAlpha", "SolidMask", "ThresholdMask"}


def fail(msg, code=2):
    print(f"[wash1015] FAIL: {msg}")
    sys.exit(code)


def load(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        fail(f"{p.name} 非 JSON(字节损坏?):{e}")


def sha16(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()[:16]


def canon_sg(doc: dict) -> str:
    return json.dumps(doc.get("definitions", {}).get("subgraphs", []),
                      sort_keys=True, ensure_ascii=False)


def group5(wf_doc: dict):
    grp = next((g for g in wf_doc["groups"]
                if g.get("title", "").startswith(GROUP5_TITLE_PREFIX)), None)
    if grp is None:
        fail(f"缺⑤组框(锚={GROUP5_TITLE_PREFIX!r}…)")
    x, y, w, h = grp["bounding"]
    return x, y, x + w, y + h


def _inlink(root, nid, iname):
    return next((i.get("link") for i in root[nid]["inputs"] if i["name"] == iname), None)


# ── 幂等判别:全术后形态清单 ────────────────────────────────────────────
def full_form_ok(wf_doc: dict) -> bool:
    root = {n["id"]: n for n in wf_doc["nodes"]}
    if not all(i in root for i in (SPLIT, PD, MASK, JOIN, TH)):
        return False
    types = {SPLIT: "SplitImageWithAlpha", PD: "PorterDuffImageComposite",
             MASK: "SolidMask", JOIN: "JoinImageWithAlpha", TH: "ThresholdMask"}
    if any(root[i]["type"] != t for i, t in types.items()):
        return False
    links = {l[0]: l for l in wf_doc["links"]}
    return (_inlink(root, 8, "images") == L_JOIN_8
            and _inlink(root, 503, "image") == L_JOIN_503
            and OLD_L_8 not in links and OLD_L_503 not in links
            and root[PD]["widgets_values"] == ["SRC"]
            and root[MASK]["widgets_values"][0] == 0
            and root[TH]["widgets_values"] == [TH_VALUE]
            and (root[5]["outputs"][0].get("links") or []) == [L_5_SPLIT])


# ── 术前断言(fresh 路径)──────────────────────────────────────────────
def pre_assert(wf_path: Path, wf_doc: dict):
    got = sha16(wf_path)
    if got != SHA_WF:
        fail(f"术前字节锚不符:sha256[:16]={got} 预期 {SHA_WF}"
             f"(现场漂移或已被他役改写,禁为过门放宽)")
    root = {n["id"]: n for n in wf_doc["nodes"]}
    link_ids = [l[0] for l in wf_doc["links"]]
    if wf_doc["last_link_id"] != 218 or max(link_ids) != 218:
        fail(f"根线水位应 218(1014 T2 后态),得 last_link_id={wf_doc['last_link_id']}"
             f"/max={max(link_ids)}")
    if wf_doc["last_node_id"] != 7024:
        fail(f"根 last_node_id 应 7024,得 {wf_doc['last_node_id']}")
    for i in (SPLIT, PD, MASK, JOIN, TH):
        if i in root:
            fail(f"根图节点 id {i} 已被占用(部分术后拦停)")
    for i in NEW_LINKS:
        if i in link_ids:
            fail(f"根线 id {i} 已被占用(部分术后拦停)")
    n5 = root[5]
    if n5["type"] != "VAEDecode" or (n5["outputs"][0].get("links") or []) != [OLD_L_8, OLD_L_503]:
        fail(f"[5] 术前扇出形不符(应 links=[{OLD_L_8},{OLD_L_503}]):"
             f"{n5['type']} {n5['outputs'][0].get('links')}")
    by_id = {l[0]: l for l in wf_doc["links"]}
    l38, l201 = by_id[OLD_L_8], by_id[OLD_L_503]
    if l38[1:6] != [5, 0, 8, 0, "IMAGE"]:
        fail(f"线 {OLD_L_8} 形态不符:{l38}")
    if l201[1:6] != [5, 0, 503, 0, "IMAGE"]:
        fail(f"线 {OLD_L_503} 形态不符:{l201}")
    n8 = root[8]
    if n8["type"] != "SaveImage" or n8["inputs"][0]["name"] != "images" \
            or n8["inputs"][0]["link"] != OLD_L_8 or n8["pos"] != [8680, 1900]:
        fail(f"[8] 术前形不符(type/inputs/pos):{n8['type']} {n8['inputs'][0]} {n8['pos']}")
    if n8["widgets_values"] != ["QI21道劫图生图_"]:
        fail(f"[8] 前缀漂移:{n8['widgets_values']}")
    n503 = root[503]
    if n503["type"] != "SeedVR2VideoUpscaler" or n503["inputs"][0]["name"] != "image" \
            or n503["inputs"][0]["link"] != OLD_L_503:
        fail(f"[503] 术前形不符:{n503['type']} {n503['inputs'][0]}")
    if any(n["type"] in WASH_TYPES for n in wf_doc["nodes"]):
        fail("根图已存在洗底件型(部分术后拦停)")
    group5(wf_doc)


# ── 手术(内存态)─────────────────────────────────────────────────────
def surgery(wf_doc: dict):
    root = {n["id"]: n for n in wf_doc["nodes"]}
    order_max = max(n.get("order", 0) for n in wf_doc["nodes"])

    def mk(nid, typ, pos, size, order, inputs, outputs, wv, title):
        return {"id": nid, "type": typ, "pos": pos, "size": size, "flags": {},
                "order": order, "mode": 0, "inputs": inputs, "outputs": outputs,
                "properties": {"Node name for S&R": typ},
                "widgets_values": wv, "title": title}

    wf_doc["nodes"].append(mk(
        SPLIT, "SplitImageWithAlpha", POS_SPLIT, [270, 86], order_max + 1,
        [{"name": "image", "type": "IMAGE", "link": L_5_SPLIT}],
        [{"name": "IMAGE", "type": "IMAGE", "links": [L_PD_SRC, L_PD_DST]},
         {"name": "MASK", "type": "MASK", "links": [L_SPLIT_TH, L_PD_JOIN_ALPHA]}],
        [], "[506] 洗底·拆Alpha"))
    wf_doc["nodes"].append(mk(
        TH, "ThresholdMask", POS_TH, [315, 106], order_max + 2,
        [{"name": "mask", "type": "MASK", "link": L_SPLIT_TH}],
        [{"name": "MASK", "type": "MASK", "links": [L_PD_SRCA]}],
        [TH_VALUE], "[510] 洗底·阈值门(α<0.004)"))
    wf_doc["nodes"].append(mk(
        PD, "PorterDuffImageComposite", POS_PD, [337, 246], order_max + 3,
        [{"name": "source", "type": "IMAGE", "link": L_PD_SRC},
         {"name": "source_alpha", "type": "MASK", "link": L_PD_SRCA},
         {"name": "destination", "type": "IMAGE", "link": L_PD_DST},
         {"name": "destination_alpha", "type": "MASK", "link": L_MASK_DSTA}],
        [{"name": "IMAGE", "type": "IMAGE", "links": [L_PD_JOIN_IMG]},
         {"name": "MASK", "type": "MASK", "links": []}],   # 阈值化 α 禁入 Join
        ["SRC"], "[507] 洗底·SRC紫底归零"))
    wf_doc["nodes"].append(mk(
        MASK, "SolidMask", POS_MASK, [315, 166], order_max + 4,
        [], [{"name": "MASK", "type": "MASK", "links": [L_MASK_DSTA]}],
        [0.0, 64, 64], "[508] 洗底·黑底0"))
    wf_doc["nodes"].append(mk(
        JOIN, "JoinImageWithAlpha", POS_JOIN, [270, 106], order_max + 5,
        [{"name": "image", "type": "IMAGE", "link": L_PD_JOIN_IMG},
         {"name": "alpha", "type": "MASK", "link": L_PD_JOIN_ALPHA}],
        [{"name": "IMAGE", "type": "IMAGE", "links": [L_JOIN_8, L_JOIN_503]}],
        [], "[509] 洗底·Alpha回拼"))

    # 接线改道:[5] 只喂 Split;旧双喂线退役;[8]/[503] 改吃 Join
    root[5]["outputs"][0]["links"] = [L_5_SPLIT]
    wf_doc["links"] = [l for l in wf_doc["links"] if l[0] not in (OLD_L_8, OLD_L_503)]
    wf_doc["links"] += [
        [L_5_SPLIT, 5, 0, SPLIT, 0, "IMAGE"],
        [L_PD_SRC, SPLIT, 0, PD, 0, "IMAGE"],
        [L_PD_DST, SPLIT, 0, PD, 2, "IMAGE"],
        [L_SPLIT_TH, SPLIT, 1, TH, 0, "MASK"],
        [L_PD_SRCA, TH, 0, PD, 1, "MASK"],
        [L_MASK_DSTA, MASK, 0, PD, 3, "MASK"],
        [L_PD_JOIN_IMG, PD, 0, JOIN, 0, "IMAGE"],
        [L_PD_JOIN_ALPHA, SPLIT, 1, JOIN, 1, "MASK"],   # 原 α 直通(零二值化)
        [L_JOIN_8, JOIN, 0, 8, 0, "IMAGE"],
        [L_JOIN_503, JOIN, 0, 503, 0, "IMAGE"],
    ]
    root[8]["inputs"][0]["link"] = L_JOIN_8
    root[503]["inputs"][0]["link"] = L_JOIN_503
    root[8]["pos"] = list(POS_8)
    # 水位:根线号;last_node_id 保持 7024(禁回写小值)
    wf_doc["last_link_id"] = max(NEW_LINKS)
    if wf_doc["last_node_id"] < max(7024, TH):
        fail(f"根 last_node_id {wf_doc['last_node_id']} < max(7024,510),禁回写小值")


# ── 术后 coherence(内存+回读共用)────────────────────────────────────
def coherence(wf_doc: dict, sg_canon_before: str, label: str):
    root = {n["id"]: n for n in wf_doc["nodes"]}
    links = {l[0]: l for l in wf_doc["links"]}
    # 1. 全根线端点/回挂对账
    for lid, l in links.items():
        _, s, ss, d, ds, ty = l
        if s not in root or d not in root:
            fail(f"[{label}] 根线 {lid} 端点缺失")
        outs, ins = root[s].get("outputs", []), root[d]["inputs"]
        if ss >= len(outs) or ds >= len(ins):
            fail(f"[{label}] 根线 {lid} 槽号越界")
        if ty != "*" and outs[ss]["type"] not in (ty, "*"):
            fail(f"[{label}] 根线 {lid} 源槽类型失配")
        if ins[ds]["type"] not in (ty, "*"):
            fail(f"[{label}] 根线 {lid} 目标槽类型失配")
        if ins[ds].get("link") != lid:
            fail(f"[{label}] 根线 {lid} 目标槽 link 未回挂")
        if lid not in (outs[ss].get("links") or []):
            fail(f"[{label}] 根线 {lid} 源槽 links 未登记")
    # 2. 旧线退役+新链形
    if OLD_L_8 in links or OLD_L_503 in links:
        fail(f"[{label}] 旧直连线 {OLD_L_8}/{OLD_L_503} 应退役")
    if (root[5]["outputs"][0].get("links") or []) != [L_5_SPLIT]:
        fail(f"[{label}] [5] 应只喂洗底链首件")
    want_wiring = {
        (SPLIT, "image"): 5, (TH, "mask"): SPLIT, (PD, "source"): SPLIT,
        (PD, "source_alpha"): TH, (PD, "destination"): SPLIT,
        (PD, "destination_alpha"): MASK, (JOIN, "image"): PD,
        (JOIN, "alpha"): SPLIT,                     # 原 α 直通
        (8, "images"): JOIN, (503, "image"): JOIN,
    }
    for (nid, iname), src in want_wiring.items():
        inp = next(i for i in root[nid]["inputs"] if i["name"] == iname)
        got = links[inp["link"]][1]
        if got != src:
            fail(f"[{label}] [{nid}].{iname} 应接 [{src}],得 [{got}]")
    if root[PD]["outputs"][1].get("links"):
        fail(f"[{label}] [507].MASK 出线应弃用(阈值化 α 禁入 Join)")
    if root[PD]["widgets_values"] != ["SRC"]:
        fail(f"[{label}] 洗底合成 mode 应显式 SRC,得 {root[PD]['widgets_values']}")
    if root[MASK]["widgets_values"][0] != 0:
        fail(f"[{label}] SolidMask 应 value=0")
    if root[TH]["widgets_values"] != [TH_VALUE]:
        fail(f"[{label}] ThresholdMask 应 value={TH_VALUE}")
    for i, t in ((SPLIT, "SplitImageWithAlpha"), (TH, "ThresholdMask"),
                 (PD, "PorterDuffImageComposite"), (MASK, "SolidMask"),
                 (JOIN, "JoinImageWithAlpha")):
        if root[i]["type"] != t:
            fail(f"[{label}] [{i}] 型应 {t},得 {root[i]['type']}")
    # 3. 布局:恒向右(全根线)/零重叠(本役触点集)/零负区/⑤框外/[8]→[503] 顺位
    for lid, l in links.items():
        if root[l[3]]["pos"][0] <= root[l[1]]["pos"][0]:
            fail(f"[{label}] 线 {lid} 非右向([{l[1]}]→[{l[3]}]),横排单向流破约")
    touch = [5, 8, 503, SPLIT, TH, PD, MASK, JOIN]
    for a in range(len(touch)):
        for b in range(a + 1, len(touch)):
            na, nb = root[touch[a]], root[touch[b]]
            if (na["pos"][0] < nb["pos"][0] + nb["size"][0]
                    and nb["pos"][0] < na["pos"][0] + na["size"][0]
                    and na["pos"][1] < nb["pos"][1] + nb["size"][1]
                    and nb["pos"][1] < na["pos"][1] + na["size"][1]):
                fail(f"[{label}] 节点重叠:[{touch[a]}]×[{touch[b]}]")
    gx0, gy0, gx1, gy1 = group5(wf_doc)
    for i in (SPLIT, TH, PD, MASK, JOIN, 8):
        n = root[i]
        if n["pos"][0] < 80 or n["pos"][1] < 80:
            fail(f"[{label}] [{i}] 落零负区:{n['pos']}")
        if (gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx1
                and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy1):
            fail(f"[{label}] [{i}] 落入⑤组框(Ctrl+B 整组旁路会破洗底恒在)")
    if root[8]["pos"][0] + root[8]["size"][0] >= root[503]["pos"][0]:
        fail(f"[{label}] [8].right 应<[503].left(契约 :4105 区)")
    if root[8]["widgets_values"] != ["QI21道劫图生图_"] or root[503]["widgets_values"][2] != 2048:
        fail(f"[{label}] [8]/[503] widgets 漂移")
    # 4. 水位+蓝图校验态
    if wf_doc["last_link_id"] != max(NEW_LINKS):
        fail(f"[{label}] last_link_id 应 {max(NEW_LINKS)}")
    if wf_doc["last_node_id"] < 7024:
        fail(f"[{label}] last_node_id 禁回写小值")
    if canon_sg(wf_doc) != sg_canon_before:
        fail(f"[{label}] definitions.subgraphs 被脏写(应 canonical 不变)")


def write_and_verify(p: Path, doc: dict, sg_canon_before: str):
    bak = p.with_suffix(p.suffix + ".bak-1015")
    bak.write_text(p.read_text(encoding="utf-8"), encoding="utf-8")
    p.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    reread = load(p)
    coherence(reread, sg_canon_before, f"回读:{p.name}")
    print(f"[wash1015] 落盘+回读终验绿:{p.name}(备份 {bak.name})")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--wf", type=Path, default=WF, help="工作流路径(副本拦停验证用)")
    args = ap.parse_args()
    wf_path = args.wf.resolve()
    print(f"[wash1015] 目标:wf={wf_path}(蓝图={BP.name} 只读校验态)")

    bp_sha = sha16(BP) if wf_path == WF.resolve() else None
    wf_doc = load(wf_path)
    sg_canon = canon_sg(wf_doc)

    if full_form_ok(wf_doc):
        coherence(wf_doc, sg_canon, "幂等复核")
        print("[wash1015] 已全术后形态,幂等拦停(零写入)")
        sys.exit(3)
    partial = [i for i in (SPLIT, PD, MASK, JOIN, TH)
               if any(n["id"] == i for n in wf_doc["nodes"])]
    if partial or any(n["type"] in WASH_TYPES for n in wf_doc["nodes"]):
        fail(f"部分术后形态(手术中断禁续):在途 id={partial}")
    pre_assert(wf_path, wf_doc)
    print("[wash1015] 术前断言全绿(sha/水位/扇出形/旧线形/[8][503]形/id 空带/⑤框)")

    surgery(wf_doc)
    coherence(wf_doc, sg_canon, "内存")
    write_and_verify(wf_path, wf_doc, sg_canon)
    if bp_sha is not None and sha16(BP) != bp_sha:
        fail("蓝图文件被意外改写(md5 前后不一致)")
    print(f"[wash1015] 手术完成:[5]→[506]拆α→[510]阈值门(α<0.004)→[507]SRC×[508]0"
          f"→[509]回拼(原α直通)→[8]/[503] 双喂,[8]→{POS_8},根线 {OLD_L_8}/{OLD_L_503}"
          f" 退役→{L_5_SPLIT}..{max(NEW_LINKS)},蓝图只读校验态绿({BP.name} sha16={SHA_BP})。")


if __name__ == "__main__":
    main()
