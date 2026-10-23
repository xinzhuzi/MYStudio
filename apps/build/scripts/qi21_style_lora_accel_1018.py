#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qi21 加速子图入口单挂动漫风格 LoRA [7034]×0.3(役号 1018anime)。

背景(1018 用户令「在加速子图里面添加 GPT_Image_2_Anime_Illustration_Style_LoRA
_qwen_12138 这个 LoRA,并且这个程度限制在 0.3」):
  - 三件(t2i/i2i/edit)「道劫·加速子图」的 model 边界入针都是四扇出:
      t2i : [7026] 原生Fix / [7022] 段B底模引导 / [7011] viggle LoRA / [7028] Turbo LoRA
      i2i : [7010] 原生KSampler / [7022] / [7011] / [7028]
      edit: 同 i2i
  - 「改 1 处全改」口径(1016 用户令加速子图单一真源):在入针与四扇出之间插一个
    LoraLoaderModelOnly [7034](文件=GPT_Image_2…qwen_12138,strength_model=0.3),
    四条原扇出线**保 id 改 origin**(-10:0 → 7034:0),入针新发一条线 -10:0 → 7034:0,
    三支路(Turbo/viggle 段A+段B/原生)全吃同一件风格 LoRA。
  - 蓝图壳 my_nodes/subgraphs/qi21-道劫-加速子图{,-i2i,-edit}.json 同刀(勿漏 edit)。

做法(六件同形;幂等 fail-closed):
  A 术前锚:子图恰一;[7034] 全文件零占用(id 作用域铁律);model 入针 linkIds 恰四条、
    origin 全=-10:0、目标集逐字=本形四扇出;目标节点类型逐字。
  B 新线 id=全文件(root+全部子图)link id 最大值、doc.last_link_id、sg.state.lastLinkId
    三者取大 +1(跨域零撞号);节点 id 钉 7034(sg.state.lastNodeId=7033 已越过 7032/7033)。
  C 位置:契约 1008 令「子图组框并集罩全功能件」→ t2i 入「④共用控制」、i2i 入「共享输入」;
    edit 五组皆按臂分,将「④seed 单源」改名「④共用控制(seed 单源 · 风格LoRA)」并向下扩框
    罩住 [7034](x/宽不动,与②viggle 零相交);候选位逐个试:节点零重叠+组框只许全内/全外
    +「恒向右」(入针 x < 7034 x < 四目标 x);无合法位=拒动。
  D Note(t2i [7016]/i2i [7016];edit 无 Note)尾加一行说明(双字段同笔)。
守卫:术前 md5 锚 + 备份进 apps/output/bak/qi21-style-lora-accel-1018/<原相对路径>
  (1017 铁律:bak 不进 git 可见处)+ 原子写 + 回读终验(败则回滚);全施态复跑 exit 3。
用法:python3 qi21_style_lora_accel_1018.py [--check]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BASE = REPO / "apps/backend/comfyui"
CAMPAIGN = "1018anime"
BAK_ROOT = REPO / "apps/output/bak/qi21-style-lora-accel-1018"

SG_NAME = "道劫·加速子图"
NEW_ID = 7034
LORA_FILE = "GPT_Image_2_Anime_Illustration_Style_LoRA_qwen_12138.safetensors"
STRENGTH = 0.3
TITLE = "[7034] 动漫风格LoRA·GPT-Image-2(×0.3)"
NOTE_LINE = ("[7034] 动漫风格LoRA·GPT-Image-2 ×0.3(1018 用户令:入口单挂——model 边界→[7034]"
             "→四扇出 Turbo[7028]/viggle[7011]/段B底模[7022]/原生臂,三支路共吃;"
             "civitai 2736538 Qwen 2.1 版 3360462;强度上限 0.3)")

W = BASE / "workflows/1_图片/Q2-1图像"
B = BASE / "my_nodes/subgraphs"
FILES = [  # (form, path)
    ("t2i", W / "1_文生图/qi21-道劫-t2i.json"),
    ("i2i", W / "2_图生图/qi21-道劫-i2i.json"),
    ("edit", W / "2_图生图/qi21-edit.json"),
    ("t2i", B / "qi21-道劫-加速子图.json"),
    ("i2i", B / "qi21-道劫-加速子图-i2i.json"),
    ("edit", B / "qi21-道劫-加速子图-edit.json"),
]
TARGETS = {
    "t2i": {(7026, 0), (7022, 0), (7011, 0), (7028, 0)},
    "i2i": {(7010, 0), (7022, 0), (7011, 0), (7028, 0)},
    "edit": {(7010, 0), (7022, 0), (7011, 0), (7028, 0)},
}
TYPES = {7026: "LoraLoaderModelOnly", 7010: "KSampler", 7022: "BasicGuider",
         7011: "ViggleTurboLora", 7028: "LoraLoaderModelOnly"}
POS_CANDIDATES = {
    # 1008 用户令(契约 test_accel_group_boxes_cover_parallel_branches):t2i 子图组框并集
    # 必须罩住全部功能件→[7034] 入「④共用控制」组;i2i 对位入「共享输入」组;edit 组外
    "t2i": [[300, 500], [300, 700], [300, 900], [600, 500], [600, 700]],
    "i2i": [[1400, 760], [1400, 1000], [1100, 760], [1400, 1300], [1100, 1000]],
    # edit 五组皆按臂分,共用件只有 [7014] seed 在「④seed 单源」(320×230 塞不下第二件)
    # →该组改名「④共用控制(seed 单源 · 风格LoRA)」并向下扩到罩住 [7034](x 不动,
    #   与「②viggle」x 370+ 零相交=组框零重叠);落 (45,520) 在 [7014](80,400,270×90) 之下
    "edit": [[45, 520], [45, 700]],
}
EDIT_GROUP_OLD = "④seed 单源"
EDIT_GROUP_NEW = "④共用控制(seed 单源 · 风格LoRA)"
SHARED_GROUP = {"t2i": "④共用控制", "i2i": "共享输入", "edit": EDIT_GROUP_NEW}
NODE_SIZE = [270, 130]
MARGIN = 10


class PostFail(Exception):
    pass


def fail(msg: str) -> None:
    print(f"[{CAMPAIGN}] FAIL: {msg}")
    sys.exit(1)


def _md5(b: bytes) -> str:
    return hashlib.md5(b).hexdigest()


def _sg(doc: dict) -> dict:
    hits = [s for s in doc.get("definitions", {}).get("subgraphs", []) if s.get("name") == SG_NAME]
    if len(hits) != 1:
        raise PostFail(f"加速子图应恰 1 份,得 {len(hits)}")
    return hits[0]


def _node(nodes: list, nid: int) -> dict:
    for n in nodes:
        if n["id"] == nid:
            return n
    raise KeyError(nid)


def _all_link_ids(doc: dict) -> set:
    ids = {l[0] for l in doc.get("links", [])}
    for s in doc.get("definitions", {}).get("subgraphs", []):
        ids |= {l["id"] for l in s["links"]}
    return ids


def _all_node_ids(doc: dict) -> set:
    ids = {n["id"] for n in doc.get("nodes", [])}
    for s in doc.get("definitions", {}).get("subgraphs", []):
        ids |= {n["id"] for n in s["nodes"]}
    return ids


def _rect(pos, size):
    return (pos[0] - MARGIN, pos[1] - MARGIN, pos[0] + size[0] + MARGIN, pos[1] + size[1] + MARGIN)


def _overlap(a, b) -> bool:
    return not (a[2] <= b[0] or b[2] <= a[0] or a[3] <= b[1] or b[3] <= a[1])


def _inside(a, b) -> bool:
    return b[0] <= a[0] and a[2] <= b[2] and b[1] <= a[1] and a[3] <= b[3]


def _group_rects(sg: dict) -> list:
    out = []
    for g in sg.get("groups", []):
        bx = g.get("bounding")
        if bx:
            out.append((g.get("title"), (bx[0], bx[1], bx[0] + bx[2], bx[1] + bx[3])))
    return out


def _placement_ok(sg: dict, form: str, pos: list, exclude_id: int | None = None) -> bool:
    """节点零重叠;组框只许全在内/全在外(禁跨边);t2i/i2i 必须全在指定共用组内。"""
    r = _rect(pos, NODE_SIZE)
    bare = (pos[0], pos[1], pos[0] + NODE_SIZE[0], pos[1] + NODE_SIZE[1])
    for n in sg["nodes"]:
        if n["id"] == exclude_id:
            continue
        if _overlap(r, _rect(n["pos"], n.get("size") or NODE_SIZE)):
            return False
    want = SHARED_GROUP[form]
    in_want = False
    for title, gr in _group_rects(sg):
        if _inside(bare, gr):
            if title == want:
                in_want = True
            elif want is not None:
                return False       # 落进别的组
        elif _overlap(bare, gr):
            return False           # 跨组边
    return in_want if want is not None else True


def _pick_pos(sg: dict, form: str) -> list:
    pin_x = sg["inputs"][0].get("pos", [0, 0])[0]
    tgt_x = min(_node(sg["nodes"], t)["pos"][0] for t, _ in TARGETS[form])
    for cand in POS_CANDIDATES[form]:
        if pin_x < cand[0] < tgt_x and _placement_ok(sg, form, cand):
            return list(cand)
    raise PostFail(f"{form}: 无合法落位(零重叠+组框规则+恒向右)候选全败")


# ══════════ 术前锚(fail-closed)══════════
def verify_pre(doc: dict, form: str) -> None:
    try:
        sg = _sg(doc)
    except PostFail as e:
        fail(str(e))
    if NEW_ID in _all_node_ids(doc):
        fail(f"{form}: 节点 id {NEW_ID} 已在文件内占用(非全施态=半态/漂移)")
    mi = sg["inputs"][0]
    if mi["name"] != "model" or mi["type"] != "MODEL":
        fail(f"{form}: 子图 inputs[0] 非 model/MODEL:{mi['name']}/{mi['type']}")
    L = {l["id"]: l for l in sg["links"]}
    lids = mi.get("linkIds") or []
    if len(lids) != 4:
        fail(f"{form}: model 入针 linkIds 应恰 4 条,得 {lids}")
    got = set()
    for lid in lids:
        l = L.get(lid)
        if not l or (l["origin_id"], l["origin_slot"]) != (-10, 0):
            fail(f"{form}: link {lid} 非 -10:0 起点:{l}")
        got.add((l["target_id"], l["target_slot"]))
    if got != TARGETS[form]:
        fail(f"{form}: model 扇出目标集应={sorted(TARGETS[form])},得 {sorted(got)}")
    for tid, _ in TARGETS[form]:
        n = _node(sg["nodes"], tid)
        if n["type"] != TYPES[tid]:
            fail(f"{form}: [{tid}] 类型应 {TYPES[tid]},得 {n['type']}")
        if n["inputs"][0]["name"] != "model" or n["inputs"][0].get("link") not in lids:
            fail(f"{form}: [{tid}].inputs[0] 非 model 或其 link 不在入针 linkIds 内")
    n7016 = next((n for n in sg["nodes"] if n["id"] == 7016), None)
    if n7016 is not None and NOTE_LINE in (n7016.get("widgets_values") or [""])[0]:
        fail(f"{form}: Note [7016] 已含 1018 行但节点未施(半态)")
    want_title = EDIT_GROUP_OLD if form == "edit" else SHARED_GROUP[form]
    hits = [g for g in sg.get("groups", []) if g.get("title") == want_title]
    if len(hits) != 1:
        fail(f"{form}: 共用组「{want_title}」应恰 1 个,得 {len(hits)}(术前锚失)")


# ══════════ 施术 ══════════
def surgery(doc: dict, form: str) -> None:
    sg = _sg(doc)
    mi = sg["inputs"][0]
    L = {l["id"]: l for l in sg["links"]}
    old_ids = list(mi["linkIds"])
    new_link = max(_all_link_ids(doc) | {doc.get("last_link_id") or 0,
                                         (sg.get("state") or {}).get("lastLinkId") or 0}) + 1
    tmpl = _node(sg["nodes"], 7028)
    if form == "edit":   # 扩组+改名(只增不减;x/宽不动)
        g = next(g for g in sg["groups"] if g.get("title") == EDIT_GROUP_OLD)
        g["title"] = EDIT_GROUP_NEW
        cand_y = POS_CANDIDATES["edit"][0][1]
        need_h = (cand_y + NODE_SIZE[1] + 20) - g["bounding"][1]
        g["bounding"][3] = max(g["bounding"][3], need_h)
    pos = _pick_pos(sg, form)
    node = {
        "id": NEW_ID, "type": "LoraLoaderModelOnly", "pos": pos, "size": list(NODE_SIZE),
        "flags": {}, "order": tmpl.get("order", 0), "mode": 0,
        "inputs": [{"name": "model", "type": "MODEL", "localized_name": "模型", "link": new_link}],
        "outputs": [{"localized_name": "模型", "name": "MODEL", "type": "MODEL", "links": old_ids}],
        "properties": json.loads(json.dumps(tmpl.get("properties", {}), ensure_ascii=False)),
        "widgets_values": [LORA_FILE, STRENGTH],
        "widgets_values_named": {"lora_name": LORA_FILE, "strength_model": STRENGTH},
        "title": TITLE,
    }
    for lid in old_ids:        # 保 id 改 origin
        L[lid]["origin_id"] = NEW_ID
        L[lid]["origin_slot"] = 0
    sg["links"].append({"id": new_link, "origin_id": -10, "origin_slot": 0,
                        "target_id": NEW_ID, "target_slot": 0, "type": "MODEL"})
    mi["linkIds"] = [new_link]
    sg["nodes"].append(node)
    st = sg.setdefault("state", {})
    st["lastNodeId"] = max(st.get("lastNodeId") or 0, NEW_ID)
    st["lastLinkId"] = max(st.get("lastLinkId") or 0, new_link)
    doc["last_node_id"] = max(doc.get("last_node_id") or 0, NEW_ID)
    doc["last_link_id"] = max(doc.get("last_link_id") or 0, new_link)
    n7016 = next((n for n in sg["nodes"] if n["id"] == 7016), None)
    if n7016 is not None and isinstance((n7016.get("widgets_values") or [None])[0], str):
        n7016["widgets_values"][0] = n7016["widgets_values"][0].rstrip("\n") + "\n" + NOTE_LINE
        named = n7016.get("widgets_values_named")
        if isinstance(named, dict) and isinstance(named.get("text"), str):
            named["text"] = named["text"].rstrip("\n") + "\n" + NOTE_LINE


# ══════════ 术后终验(内存态+回读共用)══════════
def verify_post(doc: dict, form: str) -> list[str]:
    ok: list[str] = []

    def chk(cond: bool, label: str) -> None:
        if not cond:
            raise PostFail(label)
        ok.append(label)

    sg = _sg(doc)
    nodes = {n["id"]: n for n in sg["nodes"]}
    L = {l["id"]: l for l in sg["links"]}
    chk(NEW_ID in nodes, "A: [7034] 在册")
    n = nodes[NEW_ID]
    chk(n["type"] == "LoraLoaderModelOnly" and n["mode"] == 0 and n["title"] == TITLE,
        "A: [7034] 类型/激活/标题")
    chk(n["widgets_values"] == [LORA_FILE, STRENGTH]
        and n["widgets_values_named"] == {"lora_name": LORA_FILE, "strength_model": STRENGTH},
        "A: [7034] wv=[GPT_Image_2…, 0.3] 双写")
    mi = sg["inputs"][0]
    chk(mi["name"] == "model" and len(mi["linkIds"]) == 1, "B: model 入针 linkIds 恰一条")
    nl = L.get(mi["linkIds"][0])
    chk(nl is not None and nl["origin_id"] == -10 and nl["origin_slot"] == 0
        and nl["target_id"] == NEW_ID and nl["target_slot"] == 0 and nl["type"] == "MODEL"
        and n["inputs"][0]["link"] == nl["id"],
        "B: 入针线 -10:0 → 7034:0 且节点 input.link 回指")
    outs = n["outputs"][0]["links"]
    chk(len(outs) == 4 and len(set(outs)) == 4, "C: [7034] 扇出恰四线")
    got = set()
    for lid in outs:
        l = L.get(lid)
        chk(l is not None and (l["origin_id"], l["origin_slot"]) == (NEW_ID, 0) and l["type"] == "MODEL",
            f"C: 扇出线 {lid} 起点=7034:0")
        got.add((l["target_id"], l["target_slot"]))
        chk(nodes[l["target_id"]]["inputs"][l["target_slot"]].get("link") == lid,
            f"C: 目标 [{l['target_id']}] input.link 回指 {lid}")
    chk(got == TARGETS[form], f"C: 扇出目标集逐字={sorted(TARGETS[form])}")
    chk(not any((l["origin_id"], l["origin_slot"]) == (-10, 0) and l["target_id"] != NEW_ID
                for l in sg["links"]), "C: 边界 model 槽再无旁路直连(四臂全经 7034)")
    pin_x = mi.get("pos", [0, 0])[0]
    chk(pin_x < n["pos"][0] < min(nodes[t]["pos"][0] for t, _ in TARGETS[form]), "D: 恒向右")
    chk(_placement_ok(sg, form, n["pos"], exclude_id=NEW_ID),
        f"D: 落位合规(节点零重叠+组框全内/全外+{'入「' + SHARED_GROUP[form] + '」组' if SHARED_GROUP[form] else '组外'})")
    grs = _group_rects(sg)
    chk(not any(_overlap(a[1], b[1]) for i, a in enumerate(grs) for b in grs[i + 1:]),
        "D: 组框两两零重叠")
    if form == "edit":
        chk(sum(1 for g in sg.get("groups", []) if g.get("title") == EDIT_GROUP_NEW) == 1
            and not any(g.get("title") == EDIT_GROUP_OLD for g in sg.get("groups", [])),
            "D: edit 共用组已改名(旧名零残留)")
    st = sg.get("state") or {}
    chk((st.get("lastNodeId") or 0) >= NEW_ID and (st.get("lastLinkId") or 0) >= nl["id"]
        and (doc.get("last_node_id") or 0) >= NEW_ID and (doc.get("last_link_id") or 0) >= nl["id"],
        "E: 子图 state 与顶层计数器同抬")
    ids = _all_link_ids(doc)
    chk(len([1 for s in doc["definitions"]["subgraphs"] for l in s["links"] if l["id"] == nl["id"]]) == 1
        and sum(1 for l in doc.get("links", []) if l[0] == nl["id"]) == 0, "E: 新线 id 全文件唯一")
    n7016 = nodes.get(7016)
    if n7016 is not None:
        wv0 = (n7016.get("widgets_values") or [""])[0]
        named = (n7016.get("widgets_values_named") or {}).get("text")
        chk(wv0.count(NOTE_LINE) == 1 and (named is None or named.count(NOTE_LINE) == 1),
            "F: Note [7016] 1018 行恰一次(双字段)")
    # 悬空线
    sids = set(L)
    nids = set(nodes) | {-10, -20}
    bad = []
    for m in sg["nodes"]:
        for i in m.get("inputs", []):
            if isinstance(i.get("link"), int) and i["link"] not in sids:
                bad.append(("in", m["id"], i["link"]))
        for o in m.get("outputs", []):
            for lid in (o.get("links") or []):
                if lid not in sids:
                    bad.append(("out", m["id"], lid))
    for io in sg.get("inputs", []) + sg.get("outputs", []):
        for lid in io.get("linkIds", []):
            if lid not in sids:
                bad.append(("io", io["name"], lid))
    for l in sg["links"]:
        if l["origin_id"] not in nids or l["target_id"] not in nids:
            bad.append(("endpoint", l["id"]))
    chk(not bad, f"V: 子图无悬空线 {bad[:3]}")
    return ok


def process(path: Path, form: str) -> str:
    label = path.name
    raw = path.read_bytes()
    doc = json.loads(raw)
    digest0 = _md5(raw)
    try:
        for line in verify_post(doc, form):
            print(f"[{CAMPAIGN}] {label}: PASS {line}")
        return "applied"
    except PostFail:
        pass
    verify_pre(doc, form)
    mtime0 = path.stat().st_mtime
    surgery(doc, form)
    try:
        verify_post(doc, form)
    except PostFail as exc:
        fail(f"{label}: 内存态术后验未过({exc}),不落盘")
    blob = (json.dumps(doc, ensure_ascii=False, indent=2)
            + ("\n" if raw.endswith(b"\n") else "")).encode("utf-8")
    json.loads(blob)
    bak = BAK_ROOT / path.relative_to(REPO)
    bak.parent.mkdir(parents=True, exist_ok=True)
    if not bak.exists():
        shutil.copy2(path, bak)
    if _md5(bak.read_bytes()) != digest0:
        fail(f"{label}: 备份 md5 与术前锚不符,中止")
    if path.stat().st_mtime != mtime0:
        fail(f"{label}: mtime 守卫触发(读→写窗口被并行改动),中止")
    tmp = path.with_name(path.name + f".tmp-{CAMPAIGN}")
    tmp.write_bytes(blob)
    tmp.replace(path)
    reread = json.loads(path.read_bytes())
    try:
        for line in verify_post(reread, form):
            print(f"[{CAMPAIGN}] {label}: PASS {line}")
    except PostFail as exc:
        shutil.copy2(bak, path)
        fail(f"{label}: 回读终验未过({exc}),已回滚 {bak}")
    print(f"[{CAMPAIGN}] {label}: 术前md5={digest0} 备份={bak.relative_to(REPO)}")
    return "done"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="只读清点,不改")
    args = ap.parse_args()
    for _f, p in FILES:
        if not p.exists():
            fail(f"缺目标文件:{p}")
    if args.check:
        state = {}
        for form, p in FILES:
            try:
                verify_post(json.loads(p.read_bytes()), form)
                state[p.name] = "已施"
            except PostFail:
                state[p.name] = "未施"
        print(f"[{CAMPAIGN}] --check: {state}")
        vals = set(state.values())
        if len(vals) == 1:
            return 3 if "已施" in vals else 0
        fail(f"--check: 六件状态不一致(半批) {state}")
    results = [process(p, form) for form, p in FILES]
    if "applied" in results and "done" in results:
        fail(f"六件施术态不一致(半批):{dict(zip([p.name for _f, p in FILES], results))}")
    if all(r == "applied" for r in results):
        print(f"[{CAMPAIGN}] 幂等复跑:六件均处已施态,自验全 PASS,exit 3")
        return 3
    print(f"[{CAMPAIGN}] 手术完成:三主件+三蓝图(备份 {BAK_ROOT.relative_to(REPO)}/,回读终验全 PASS);"
          f"本步后契约预期过渡红,须随刀改 _assert_accel_subgraph(style_lora=7034)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
