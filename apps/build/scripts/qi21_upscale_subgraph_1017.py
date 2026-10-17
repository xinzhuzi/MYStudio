#!/usr/bin/env python3
"""qi21 超分四法子图战役·接线手术(1017)——D 收装 + A/B/C 宿主 + 串联母线 + ⑤组框。

唯一写点本脚本(design §5:工作流 JSON 勿手改;四蓝图=施工员产物,本脚本只读引用)。
- D 收装(工程契约 §八1):宿主沿用原汇流件 id=[503] 原位改造;原 [503] SeedVR2VideoUpscaler
  让位入子图取新 id=7401;501/502 随迁沿用旧 id(定义来自蓝图 qi21-道劫-超分-SeedVR2.json)。
- A/B/C 新宿主(t2i 506/507/508;i2i 511/512/513),定义逐字引自四蓝图
  (canonical-除-id 全等=TestUpscaleBlueprintAnchors1017 判据;嵌入沿用蓝图 uuid)。
- 母线:源([5] t2i/[509] i2i)→A→B→C→D(503)→[504](+t2i [505] 不动);
  每件 16 根新线;link202(t2i)/link227(i2i) 被母线末段替换删除。
- ⑤组框改名「道劫·⑤超分四法尾档·2K」+罩全四宿主(不新增组框,t2i 组框预算=5 已满)。
- seed_widgets={"7":1,"503":0} 零改(D 宿主 widgets=[seed,目标短边] 首位续真)。
- 同批 fire 过渡补丁(implement S2 纪律:手术+补丁同一交付批):
  t2i --upscale2k 在 root 无 501-504 展开段时→D 宿主展平(行为等价)+退役告警;
  i2i fire Flattener 加旁路宿主直通 resolve(默认尾档走 D 宿主)。

模式:--dry-run(默认,只打印计划)/ --apply(写盘)/ --check(术后形状复验)/
      --stage d-only-t2i --out PATH(探针预备:D 收装单步落临时件,零仓库写)/
      --sync-home(repo→装机 Resources→引擎家六同步)。
断言式施工(先例 §七五关):每个待替结构恰现一次,失配=中止不写。
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
SUB = REPO / "apps/backend/engines/comfyui/my_nodes/subgraphs"
T2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
I2I = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"
FIRE_T2I = REPO / "apps/build/scripts/qi21_t2i_workflow_fire.py"
FIRE_I2I = REPO / "apps/build/scripts/qi21_i2i_workflow_fire.py"

BP = {
    "A": SUB / "qi21-道劫-超分-潜空间重采样.json",
    "B": SUB / "qi21-道劫-超分-像素精修.json",
    "C": SUB / "qi21-道劫-超分-USDU平铺.json",
    "D": SUB / "qi21-道劫-超分-SeedVR2.json",
}
GROUP_TITLE_OLD = "道劫·⑤SeedVR2放大尾档·2K"
GROUP_TITLE_NEW = "道劫·⑤超分四法尾档·2K"

# 母线扇出点(design §4;host 槽序=定义 inputs 序:image0/model1/positive2/negative3/vae4)
BUS_T2I = {"src": 5, "model": 4203, "pos": 4015, "neg": 4016, "vae": 4202,
           "hosts": {"A": 506, "B": 507, "C": 508, "D": 503},
           "drop_link": 202}          # [5]→[503]:0 被母线末段([508]:0→[503]:0)替换
BUS_I2I = {"src": 509, "model": 9, "pos": 4015, "neg": 4015, "neg_slot": 1, "vae": 43,
           "hosts": {"A": 511, "B": 512, "C": 513, "D": 503},
           "drop_link": 227}          # [509]→[503]:0 同上
# D 收装要删的根线(DiT/VAE 供线随迁入子图)
INNER_LINKS_T2I = [203, 204]           # 501→503:1 / 502→503:2
INNER_LINKS_I2I = [202, 203]           # 501→503:1 / 502→503:2(i2i 线号与 t2i 互易)
# 宿主落位(⑤框内,布局零重叠;C 施工值见回执)
# 恒向右纪律(test_horizontal_layout_no_vertical_tower:每线 target.x>origin.x)
# → A→B→C→D 横向链;信号扇出点(4015/4016/4202/4203/[5]/[9]/[43])全在左侧实证
HOST_POS = {
    "t2i": {"A": (7290, 1700), "B": (7690, 1700), "C": (8090, 1700)},
    "i2i": {"A": (11100, 1850), "B": (11460, 2300), "C": (11770, 2750)},
}
# t2i D 宿主右移让链位(id 原位收装不动;pos=布局,恒向右+与 [504][505] 零重叠)
D_HOST_POS_T2I = (8520, 2280)
HOST_SIZE = {"A": [330, 420], "B": [330, 400], "C": [330, 400]}
UE_PROPS = {"widget_ue_connectable": {}, "version": "7.8", "input_ue_unconnectable": {}}


def _load(p: Path) -> dict:
    return json.loads(p.read_text(encoding="utf-8"))


def _dump(p: Path, d: dict) -> None:
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _bp_def(tag: str) -> dict:
    return copy.deepcopy(_load(BP[tag])["definitions"]["subgraphs"][0])


def _bp_mirror(tag: str) -> dict:
    return _load(BP[tag])["nodes"][0]


def _all_link_ids(wf: dict) -> set[int]:
    ids = {l[0] for l in wf["links"]}
    for sg in wf["definitions"]["subgraphs"]:
        for l in sg.get("links", []):
            ids.add(l["id"])
    return ids


def _next_link_id(wf: dict, used: set[int]) -> int:
    n = max(_all_link_ids(wf) | used) + 1
    while n in used or n in _all_link_ids(wf):
        n += 1
    return n


def _node(wf: dict, nid: int) -> dict:
    return next(n for n in wf["nodes"] if n["id"] == nid)


def _rm_link(wf: dict, lid: int) -> None:
    """删根线:links 表摘除+两端节点槽位回填清除(单向根域;def 内线不动)。"""
    l = next(x for x in wf["links"] if x[0] == lid)
    wf["links"] = [x for x in wf["links"] if x[0] != lid]
    src, sslot, dst, dslot = l[1], l[2], l[3], l[4]
    sn = next((n for n in wf["nodes"] if n["id"] == src), None)
    if sn:
        for o in sn.get("outputs", []):
            if o.get("links") and lid in o["links"]:
                o["links"] = [x for x in o["links"] if x != lid]
    dn = next((n for n in wf["nodes"] if n["id"] == dst), None)
    if dn:
        for i in dn.get("inputs", []):
            if i.get("link") == lid:
                i["link"] = None
    return None


def _add_link(wf: dict, lid: int, src: int, ss: int, dst: int, ds: int, ty: str) -> None:
    assert lid not in _all_link_ids(wf), f"link id {lid} 撞号"
    wf["links"].append([lid, src, ss, dst, ds, ty])
    sn = _node(wf, src)
    slot = sn["outputs"][ss]
    slot.setdefault("links", [])
    assert lid not in slot["links"]
    slot["links"].append(lid)
    din = _node(wf, dst)["inputs"][ds]
    assert din.get("link") is None, f"[{dst}].{din['name']} 已有线 {din.get('link')}"
    din["link"] = lid


def _make_host(tag: str, hid: int, mode: int, order: int, pos: tuple[int, int]) -> dict:
    """宿主节点=蓝图镜像换装(槽序镜像/type=uuid/widgets 逐字/title 同题)。"""
    m = copy.deepcopy(_bp_mirror(tag))
    return {
        "id": hid,
        "type": m["type"],
        "pos": list(pos),
        "size": list(HOST_SIZE[tag]),
        "flags": {},
        "order": order,
        "mode": mode,
        "inputs": copy.deepcopy(m["inputs"]),
        "outputs": copy.deepcopy(m["outputs"]),
        "title": m["title"],
        "properties": {"subgraph": m["properties"]["subgraph"], "previewExposures": [],
                       "ue_properties": copy.deepcopy(UE_PROPS)},
        "widgets_values": copy.deepcopy(m["widgets_values"]),
        "widgets_values_named": copy.deepcopy(m.get("widgets_values_named", {})),
    }


def _type_of(wf: dict, sg_ids: set[str], nid: int) -> str:
    n = _node(wf, nid)
    return "(host)" + n["type"][:8] if n["type"] in sg_ids else n["type"]


def collect_d(wf: dict, name: str, inner_links: list[int], src_link: int) -> dict:
    """D 收装:501/502/503(展开段)→ 宿主 503 + 定义(蓝图 D 逐字)。幂等:已收装即跳。"""
    sg_ids = {sg["id"] for sg in wf["definitions"]["subgraphs"]}
    n503 = _node(wf, 503)
    if n503["type"] in sg_ids:  # 已收装
        assert n503["type"] == _bp_def("D")["id"], f"{name}: [503] 已是其它宿主 {n503['type']}"
        return {"d_done": True}
    # ── 前置断言(恰现一次)──
    assert _node(wf, 501)["type"] == "SeedVR2LoadDiTModel", f"{name}: [501] 形状失配"
    assert _node(wf, 502)["type"] == "SeedVR2LoadVAEModel", f"{name}: [502] 形状失配"
    assert n503["type"] == "SeedVR2VideoUpscaler", f"{name}: [503] 形状失配"
    for lid in inner_links:
        assert any(l[0] == lid for l in wf["links"]), f"{name}: link{lid} 缺席(前态漂移)"
    sl = next(l for l in wf["links"] if l[0] == src_link)
    assert (sl[1], sl[3], sl[4]) == (BUS_T2I["src"] if name == "t2i" else BUS_I2I["src"], 503, 0), \
        f"{name}: link{src_link} 前态失配 {sl}"
    mode, pos, size, order = n503["mode"], n503["pos"], n503["size"], n503.get("order", 0)
    out_links = [l for l in n503["outputs"][0].get("links") or []]
    # ── 落刀 ──
    for lid in inner_links:
        _rm_link(wf, lid)
    m = _bp_mirror("D")
    host = {
        "id": 503, "type": m["type"], "pos": pos, "size": size, "flags": {},
        "order": order, "mode": mode,
        "inputs": copy.deepcopy(m["inputs"]),
        "outputs": [{"name": "image", "type": "IMAGE", "slot_index": 0, "links": out_links}],
        "title": m["title"],
        "properties": {"subgraph": m["properties"]["subgraph"], "previewExposures": [],
                       "ue_properties": copy.deepcopy(UE_PROPS)},
        "widgets_values": copy.deepcopy(m["widgets_values"]),
        "widgets_values_named": copy.deepcopy(m.get("widgets_values_named", {})),
    }
    host["inputs"][0]["link"] = src_link           # 入水口线沿用(母线阶段再替换)
    wf["nodes"] = [host if n["id"] == 503 else n for n in wf["nodes"]]
    wf["nodes"] = [n for n in wf["nodes"] if n["id"] not in (501, 502)]
    wf["definitions"]["subgraphs"].append(_bp_def("D"))
    return {"d_done": False, "mode": mode}


def wire_bus(wf: dict, name: str, spec: dict, order_base: int) -> list[int]:
    """A/B/C 宿主+母线 16 线(含替换 drop_link);返回新线 id 清单。幂等:已接即跳。"""
    sg_ids = {sg["id"] for sg in wf["definitions"]["subgraphs"]}
    if _bp_def("A")["id"] in sg_ids:
        return []
    for tag in ("A", "B", "C"):
        hid = spec["hosts"][tag]
        assert not any(n["id"] == hid for n in wf["nodes"]), f"{name}: [{hid}] 已被占用"
    # ── 删旧入水线([5]/[509]→503:0),A/B/C 宿主入位 ──
    _rm_link(wf, spec["drop_link"])
    used: set[int] = set()
    new_ids: list[int] = []
    prev = spec["src"]
    pos = HOST_POS[name]
    for k, tag in enumerate(("A", "B", "C")):
        hid = spec["hosts"][tag]
        host = _make_host(tag, hid, 4, order_base + k, pos[tag])
        wf["nodes"].append(host)
        wf["definitions"]["subgraphs"].append(_bp_def(tag))   # 定义随宿主同批入册
    for tag in ("A", "B", "C"):
        hid = spec["hosts"][tag]
        # 1) image:母线上游→hid:0
        lid = _next_link_id(wf, used); used.add(lid); new_ids.append(lid)
        _add_link(wf, lid, prev, 0, hid, 0, "IMAGE")
        # 2) 四信号扇出
        for slot_src, slot_host, lty in ((spec["model"], 1, "MODEL"),
                                         (spec["pos"], 2, "CONDITIONING"),
                                         (spec["neg"], 3, "CONDITIONING"),
                                         (spec["vae"], 4, "VAE")):
            neg_slot = spec.get("neg_slot", 0) if (slot_src, slot_host) == (spec["neg"], 3) else 0
            lid = _next_link_id(wf, used); used.add(lid); new_ids.append(lid)
            _add_link(wf, lid, slot_src, neg_slot, hid, slot_host, lty)
        prev = hid
    # 末段:C→D(503):0
    lid = _next_link_id(wf, used); used.add(lid); new_ids.append(lid)
    _add_link(wf, lid, prev, 0, 503, 0, "IMAGE")
    return new_ids


def fix_group(wf: dict, cover: list[int]) -> None:
    g = next(g for g in wf["groups"] if g["title"] == GROUP_TITLE_OLD)
    g["title"] = GROUP_TITLE_NEW
    xs0 = min(_node(wf, i)["pos"][0] for i in cover)
    ys0 = min(_node(wf, i)["pos"][1] for i in cover)
    xs1 = max(_node(wf, i)["pos"][0] + _node(wf, i)["size"][0] for i in cover)
    ys1 = max(_node(wf, i)["pos"][1] + _node(wf, i)["size"][1] for i in cover)
    pad = 40
    g["bounding"] = [xs0 - pad, ys0 - pad, xs1 - xs0 + 2 * pad, ys1 - ys0 + 2 * pad]


def fix_counters(wf: dict) -> None:
    wf["last_link_id"] = max(_all_link_ids(wf))
    nid = {n["id"] for n in wf["nodes"]}
    for sg in wf["definitions"]["subgraphs"]:
        nid |= {n["id"] for n in sg["nodes"]}
    wf["last_node_id"] = max(nid)


def surgery_t2i(wf: dict) -> dict:
    plan = {}
    plan["d"] = collect_d(wf, "t2i", INNER_LINKS_T2I, 202)
    if not plan["d"]["d_done"]:
        _node(wf, 503)["pos"] = list(D_HOST_POS_T2I)   # 链位右移(恒向右纪律)
    plan["bus"] = wire_bus(wf, "t2i", BUS_T2I, order_base=19)
    if plan["bus"]:
        fix_group(wf, [506, 507, 508, 503, 504, 505])
    fix_counters(wf)
    assert wf.get("seed_widgets") == {"7": 1, "503": 0}, "seed_widgets 被误改"
    return plan


def surgery_i2i(wf: dict) -> dict:
    plan = {}
    plan["d"] = collect_d(wf, "i2i", INNER_LINKS_I2I, 227)
    plan["bus"] = wire_bus(wf, "i2i", BUS_I2I, order_base=33)
    if plan["bus"]:
        fix_group(wf, [511, 512, 513, 503, 504])
    fix_counters(wf)
    assert wf.get("seed_widgets") == {"7": 1, "503": 0}, "seed_widgets 被误改"
    return plan


# ── 术后形状复验(--check;全部断言,零打印即过)──
def check_wf(wf: dict, name: str, spec: dict) -> None:
    sgs = {sg["id"]: sg for sg in wf["definitions"]["subgraphs"]}
    assert len(sgs) == 6, f"{name}: 应 6 定义,得 {len(sgs)}"
    for tag in ("A", "B", "C", "D"):
        uid = _bp_def(tag)["id"]
        assert uid in sgs, f"{name}: 缺 {tag} 定义"
    hosts = {tag: next(n for n in wf["nodes"] if n["id"] == spec["hosts"][tag])
             for tag in ("A", "B", "C", "D")}
    for tag, h in hosts.items():
        m = _bp_mirror(tag)
        assert h["type"] == m["type"] and h["properties"]["subgraph"] == m["properties"]["subgraph"]
        assert h["widgets_values"] == m["widgets_values"], f"{name}: {tag} 宿主 widgets 漂移"
        assert h["title"] == m["title"]
        assert [i["name"] for i in h["inputs"]] == [i["name"] for i in m["inputs"]]
    # 默认激活态:t2i 全旁路(零激活)/i2i 仅 D=0(design §1 母线默认态)
    for tag in ("A", "B", "C"):
        assert hosts[tag]["mode"] == 4, f"{name}: {tag} 宿主应默认 mode4"
    want_d = 4 if name == "t2i" else 0
    assert hosts["D"]["mode"] == want_d, f"{name}: D 宿主 mode 应 {want_d}"
    # 母线拓扑:src→A→B→C→D + 每件四信号
    chain = [spec["src"], spec["hosts"]["A"], spec["hosts"]["B"], spec["hosts"]["C"], 503]
    for a, b in zip(chain, chain[1:]):
        l = [x for x in wf["links"] if x[1] == a and x[2] == 0 and x[3] == b and x[4] == 0]
        assert len(l) == 1, f"{name}: 母线 {a}→{b} 断/重"
    for tag in ("A", "B", "C"):
        hid = spec["hosts"][tag]
        for slot_src, ds, lty, ss in ((spec["model"], 1, "MODEL", 0),
                                      (spec["pos"], 2, "CONDITIONING", 0),
                                      (spec["neg"], 3, "CONDITIONING", spec.get("neg_slot", 0)),
                                      (spec["vae"], 4, "VAE", 0)):
            assert any(x[1] == slot_src and x[2] == ss and x[3] == hid and x[4] == ds
                       and x[5] == lty for x in wf["links"]), f"{name}: [{hid}] 槽{ds} 信号失配"
    # 旧线出清
    for lid in ([202, 203, 204] if name == "t2i" else [202, 203, 227]):
        assert not any(x[0] == lid for x in wf["links"]), f"{name}: 旧线 link{lid} 残留"
    # [503] 出扇出与保存件
    dl = hosts["D"]["outputs"][0]["links"]
    want_dl = [205, 207] if name == "t2i" else [204]
    assert sorted(dl) == sorted(want_dl), f"{name}: D 出扇出 {dl} != {want_dl}"
    # 组框
    g = next(g for g in wf["groups"] if g["title"] == GROUP_TITLE_NEW)
    cover = [506, 507, 508, 503, 504, 505] if name == "t2i" else [511, 512, 513, 503, 504]
    gx0, gy0, gw, gh = g["bounding"]
    for i in cover:
        n = _node(wf, i)
        assert gx0 <= n["pos"][0] and n["pos"][0] + n["size"][0] <= gx0 + gw \
            and gy0 <= n["pos"][1] and n["pos"][1] + n["size"][1] <= gy0 + gh, \
            f"{name}: ⑤框未罩 [{i}]"
    assert not any(g["title"] == GROUP_TITLE_OLD for g in wf["groups"])
    assert wf["seed_widgets"] == {"7": 1, "503": 0}
    # 蓝图 canonical-除-id 全等(同 TestUpscaleBlueprintAnchors1017 判据的脚本面)
    for tag in ("A", "B", "C", "D"):
        _canon_assert(sgs[_bp_def(tag)["id"]], _bp_def(tag), f"{name}/{tag}")
    # 双向一致性(根域):每根线的两端槽位回填
    for l in wf["links"]:
        sn, dn = _node(wf, l[1]), _node(wf, l[3])
        assert l[0] in (sn["outputs"][l[2]].get("links") or []), f"{name}: link{l[0]} 源端未回填"
        assert dn["inputs"][l[4]].get("link") == l[0], f"{name}: link{l[0]} 目标端未回填"
    # 主图节点零重叠(新宿主落位纪律)
    ns = [(a, b) for a in wf["nodes"] for b in wf["nodes"]
          if a["id"] < b["id"]
          and not (a["pos"][0] >= b["pos"][0] + b["size"][0] or b["pos"][0] >= a["pos"][0] + a["size"][0]
                   or a["pos"][1] >= b["pos"][1] + b["size"][1] or b["pos"][1] >= a["pos"][1] + a["size"][1])]
    assert not ns, f"{name}: 主图节点重叠 {[(x['id'], y['id']) for x, y in ns]}"


def _canon_assert(wf_sg: dict, bp_sg: dict, tag: str) -> None:
    def canon(sg: dict) -> str:
        sg = copy.deepcopy(sg)
        sg.pop("id", None); sg.pop("state", None); sg.pop("last_link_id", None)
        sg.setdefault("category", "漫影")
        links = sorted(sg.get("links", []),
                       key=lambda l: (l["origin_id"], l["origin_slot"], l["target_id"],
                                      l["target_slot"], l["type"], l["id"]))
        lid = {l["id"]: i for i, l in enumerate(links)}
        sg["links"] = [{**l, "id": lid[l["id"]]} for l in links]
        for io in ("inputs", "outputs"):
            for s in sg.get(io, []):
                s["linkIds"] = sorted(lid.get(x, x) for x in (s.get("linkIds") or []))
        for n in sg["nodes"]:
            for i in n.get("inputs", []):
                if i.get("link") is not None:
                    i["link"] = lid.get(i["link"], i["link"])
        return json.dumps(sg, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    a, b = canon(wf_sg), canon(bp_sg)
    assert a == b, f"{tag}: 内嵌定义 ↔ 蓝图 canonical-除-id 漂移"


# ── fire 过渡补丁(同批;幂等:标记已在即跳)──
T2I_MARK = "# 1017up4 D 宿主过渡"
I2I_MARK = "# 1017up4 旁路宿主直通"


def patch_fire_t2i() -> bool:
    src = FIRE_T2I.read_text(encoding="utf-8")
    if T2I_MARK in src:
        return False
    old = '''    if args.upscale2k:
        w501 = root_nodes[501]["widgets_values"]   # [model,device,blocks_to_swap,swap_io,offload,cache,attn]
        w502 = root_nodes[502]["widgets_values"]   # [model,device,enc_tiled,enc_ts,enc_ov,dec_tiled,dec_ts,dec_ov,tile_debug,offload,cache]
        w503 = root_nodes[503]["widgets_values"]   # [seed,"fixed",res,max_res,batch,uniform,color,temporal,prepend,in_noise,lat_noise,offload,debug]
'''
    new = '''    if args.upscale2k:
        # 1017up4 D 宿主过渡:root 无 501-504 展开段(超分四法收装后)→改走 D 宿主
        # (503)内嵌定义展平,行为等价(入水仍 ["5",0];wv 全取子图现值)+退役告警。
        if not (501 in root_nodes and 502 in root_nodes
                and root_nodes[503].get("type") == "SeedVR2VideoUpscaler"):
            print("[fire] --upscale2k 已退役(1017 超分四法收装):自动映射 --upscale d"
                  "(D 宿主 SeedVR2 子图展平,行为等价)", file=sys.stderr)
            sgD = sgs[root_nodes[503]["type"]]
            dD = {n["id"]: n for n in sgD["nodes"]}
            w501 = dD[501]["widgets_values"]
            w502 = dD[502]["widgets_values"]
            w7401 = dD[7401]["widgets_values"]
            g["503:501"] = {"class_type": "SeedVR2LoadDiTModel", "inputs": {
                "model": w501[0], "device": w501[1], "blocks_to_swap": w501[2],
                "swap_io_components": w501[3], "offload_device": w501[4],
                "cache_model": w501[5], "attention_mode": w501[6]}}
            g["503:502"] = {"class_type": "SeedVR2LoadVAEModel", "inputs": {
                "model": w502[0], "device": w502[1], "encode_tiled": w502[2],
                "encode_tile_size": w502[3], "encode_tile_overlap": w502[4],
                "decode_tiled": w502[5], "decode_tile_size": w502[6],
                "decode_tile_overlap": w502[7], "tile_debug": w502[8],
                "offload_device": w502[9], "cache_model": w502[10]}}
            g["503:7402"] = {"class_type": "PrimitiveInt", "inputs": {"value": seed}}
            g["503:7401"] = {"class_type": "SeedVR2VideoUpscaler", "inputs": {
                "image": ["5", 0], "dit": ["503:501", 0], "vae": ["503:502", 0],
                "seed": ["503:7402", 0], "resolution": w7401[2], "max_resolution": w7401[3],
                "batch_size": w7401[4], "uniform_batch_size": w7401[5],
                "color_correction": w7401[6], "temporal_overlap": w7401[7],
                "prepend_frames": w7401[8], "input_noise_scale": w7401[9],
                "latent_noise_scale": w7401[10], "offload_device": w7401[11],
                "enable_debug": w7401[12]}}
            g["504"] = {"class_type": "SaveImage", "inputs": {"images": ["503:7401", 0],
                                                              "filename_prefix": root_nodes[504]["widgets_values"][0]}}
            req = urllib.request.Request(f"{ENGINE}/prompt",
                                         data=json.dumps({"prompt": g, "client_id": "t2i-workflow-fire"}).encode(),
                                         headers={"Content-Type": "application/json"})
            try:
                pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
            except urllib.error.HTTPError as e:
                sys.exit(f"400: {e.read().decode()[:600]}")
            _poll_upscale_tail(pid, seed, args)
            return
        w501 = root_nodes[501]["widgets_values"]   # [model,device,blocks_to_swap,swap_io,offload,cache,attn]
        w502 = root_nodes[502]["widgets_values"]   # [model,device,enc_tiled,enc_ts,enc_ov,dec_tiled,dec_ts,dec_ov,tile_debug,offload,cache]
        w503 = root_nodes[503]["widgets_values"]   # [seed,"fixed",res,max_res,batch,uniform,color,temporal,prepend,in_noise,lat_noise,offload,debug]
'''
    assert old in src, "t2i fire:过渡补丁锚点失配(前态漂移)"
    src = src.replace(old, new, 1)
    # 旧路径发车段抽出为 _poll_upscale_tail 复用(旧行为不动,只重排调用点)
    old_poll = '''    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": "t2i-workflow-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys.exit(f"400: {e.read().decode()[:600]}")
    print(f"queued {pid}")
    t0 = time.time()
    fn = None'''
    new_poll = '''    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": "t2i-workflow-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys.exit(f"400: {e.read().decode()[:600]}")
    print(f"queued {pid}")
    _poll_upscale_tail(pid, seed, args)
    return


def _poll_upscale_tail(pid, seed, args):
    """发车后轮询+产物取回(1017up4:过渡路径与旧路径共用;行为=原主循环)。"""
    t0 = time.time()
    fn = None'''
    assert old_poll in src, "t2i fire:轮询段锚点失配"
    src = src.replace(old_poll, new_poll, 1)
    FIRE_T2I.write_text(src, encoding="utf-8")
    return True


def patch_fire_i2i() -> bool:
    src = FIRE_I2I.read_text(encoding="utf-8")
    if I2I_MARK in src:
        return False
    old = '''        # 连线索引:宿主入线 dst_slot→src;宿主出线 src_slot→[dst]
        host_in, host_out = {}, {}
        for l in wf["links"]:
            lid, s, ss, d, ds, ty = l
            s_dead = s not in live_root
            d_dead = d not in live_root
'''
    new = '''        # 连线索引:宿主入线 dst_slot→src;宿主出线 src_slot→[dst]
        host_in, host_out = {}, {}
        for l in wf["links"]:
            lid, s, ss, d, ds, ty = l
            # 1017up4 旁路宿主直通:源=旁路宿主也入索引(resolve_root 按型直通溯链)
            s_dead = s not in live_root and not (
                s in root and root[s]["type"] in self.sgs)
            d_dead = d not in live_root
'''
    assert old in src, "i2i fire:host_in 锚点失配"
    src = src.replace(old, new, 1)
    old2 = '''            if root[nid]["type"] in self.sgs:
                sg = self.sgs[root[nid]["type"]]
                l = next(x for x in sg["links"] if x["target_id"] == -20 and x["target_slot"] == slot)
'''
    new2 = '''            if root[nid]["type"] in self.sgs:
                # 1017up4 旁路宿主直通:mode4 宿主出槽→同型入槽,递归溯链
                # (超分母线 A/B/C 默认旁路,D 宿主入水=[5]/[509] 直通——与画布
                # graphToPrompt 旁路语义同款;S1 探针在案)
                if root[nid].get("mode", 0) != 0:
                    oty = root[nid]["outputs"][slot]["type"]
                    inp = next((i for i in root[nid].get("inputs", [])
                                if i.get("type") == oty and i.get("link") is not None), None)
                    l0 = rlinks[inp["link"]]
                    return resolve_root(l0[1], l0[2])
                sg = self.sgs[root[nid]["type"]]
                l = next(x for x in sg["links"] if x["target_id"] == -20 and x["target_slot"] == slot)
'''
    assert old2 in src, "i2i fire:resolve_root 锚点失配"
    src = src.replace(old2, new2, 1)
    FIRE_I2I.write_text(src, encoding="utf-8")
    return True


# ── 分发(--sync-home;design §5:装机 Resources=真种子)──
APP_R = Path("/Applications/漫影工作室.app/Contents/Resources/backend/engines/comfyui")
EH = Path.home() / "Library/Application Support/漫影工作室/comfyui/ComfyUI"


def sync_home() -> list[str]:
    import hashlib
    import shutil
    outs = []
    pairs = [
        (T2I, APP_R / "workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"),
        (T2I, EH / "user/default/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"),
        (I2I, APP_R / "workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"),
        (I2I, EH / "user/default/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json"),
    ] + [(BP[t], APP_R / "my_nodes/subgraphs" / BP[t].name) for t in "ABCD"] \
      + [(BP[t], EH / "custom_nodes/my-nodes/subgraphs" / BP[t].name) for t in "ABCD"]
    for srcp, dst in pairs:
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(srcp, dst)
        m = lambda p: hashlib.md5(Path(p).read_bytes()).hexdigest()
        assert m(srcp) == m(dst), f"md5 不同一: {srcp} vs {dst}"
        outs.append(f"ok {dst}")
    return outs


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="写盘(repo 两工作流+fire 补丁)")
    ap.add_argument("--check", action="store_true", help="术后形状复验(断言式)")
    ap.add_argument("--stage", choices=["d-only-t2i"])
    ap.add_argument("--out", default=None, help="--stage 输出路径(临时件)")
    ap.add_argument("--sync-home", dest="sync_home", action="store_true")
    args = ap.parse_args()

    if args.sync_home:
        for line in sync_home():
            print(line)
        return
    if args.stage == "d-only-t2i":
        wf = _load(T2I)
        plan = {"d": collect_d(wf, "t2i", INNER_LINKS_T2I, 202)}
        fix_counters(wf)
        out = Path(args.out or "/tmp/qi21-t2i-d-only.json")
        _dump(out, wf)
        print(f"d-only-t2i → {out} (d_done={plan['d']['d_done']})")
        return
    if args.check:
        check_wf(_load(T2I), "t2i", BUS_T2I)
        check_wf(_load(I2I), "i2i", BUS_I2I)
        print("check: t2i/i2i 术后形状全过")
        return

    plans = {}
    for name, path, fn in (("t2i", T2I, surgery_t2i), ("i2i", I2I, surgery_i2i)):
        wf = _load(path)
        plans[name] = fn(wf)
        if args.apply:
            _dump(path, wf)
        else:
            print(f"[dry-run] {name}: d_done={plans[name]['d']['d_done']} "
                  f"new_bus_links={plans[name]['bus']}")
    if args.apply:
        t2i_patched = patch_fire_t2i()
        i2i_patched = patch_fire_i2i()
        print(f"[apply] t2i bus={plans['t2i']['bus']} i2i bus={plans['i2i']['bus']} "
              f"fire_t2i_patched={t2i_patched} fire_i2i_patched={i2i_patched}")
        check_wf(_load(T2I), "t2i", BUS_T2I)
        check_wf(_load(I2I), "i2i", BUS_I2I)
        print("[apply] 术后 check 全过")
    else:
        print("[dry-run] 未写盘(--apply 落刀)")


if __name__ == "__main__":
    main()
