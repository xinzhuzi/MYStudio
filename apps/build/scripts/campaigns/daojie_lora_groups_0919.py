#!/usr/bin/env python3
"""道劫 LoRA 区按用途分组重排 + rgthree 快速分组旁路器 0919(阶段1 零代码过渡态)。

任务:.trellis/tasks/09-19-daojie-lora-quick-toggle R1(PRD)/design 阶段1/
research 九型LoRA启停设计.md §五降级路径2(rgthree 分组开关=过渡态交付)。

与任务书差异,如实记录(装机实物为准,不猜):
- 任务书画水墨组含 [85](写时金雾规划为 85);21:08 a8ca8f7 已把 id 85/86 占给
  MyDaojieLoras/生效清单,6c4278d 依「不删不改既有节点」把金雾顺延为 [87]。
  本脚本按装机实况:画风水墨=[82][83][84][87](金雾),[85] 九型驱动件(勿手改)
  不入任何 LoRA· 组。14 件 = 画布全部 LoraLoaderModelOnly,与任务书 14 件口径一致。
- rgthree 实物核验(装机家源码+引擎 object_info 2026-09-19):节点类名
  「Fast Groups Bypasser (rgthree)」(constants addRgthree 加后缀);纯前端虚拟
  节点(object_info 24 条 rgthree 无它;isVirtualNode=true,零连线不进 prompt,
  同图 MarkdownNote 同类先例);过滤属性是 matchTitle(JS 正则,忽略大小写,
  非文档口语的 matchPrefix)——前缀匹配写 "^LoRA·";serialize_widgets=false,
  载入只读组态(fast_groups_muter.ts refreshWidgets 同步 widget.toggled ←
  group.rgthree_hasAnyActiveNode),改 mode 仅发生在用户点击 → 插入节点本身
  不 bypass 不 mute 任何组,满足「初始态不改任何组现状」。
- 组成员判定=节点中心点落在组框内(rgthree fast_groups_service.ts
  recomputeInsideNodesForGroup)→ 分组必须物理连续,故重排节点 x 位;links 一概
  不动(链序敏感:叠加序 47→81→67→46→78→73→76→19→69→77→82→83→84→87→85)。

五组(画布 group title,左→右按链序排布最小化跨线):
  LoRA·功能件=[47][81](默认开) LoRA·人物三件=[67][73][76](默认旁路)
  LoRA·质感=[46][78](默认旁路) LoRA·画风其他=[19][69][77](默认旁路)
  LoRA·画风水墨=[82][83][84][87](默认旁路)
横排铁律:每链一行 y=80(等距 490,组间 +100),禁纵塔;[85]/[86] 顺移到链尾下方。
幂等:目标态是链结构的纯函数,重跑产出字节级相同;[88] 已在场则原位重建。
回写:ensure_ascii=False/indent=2/无尾换行(与文件现行格式一致)。
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"

# 装机家(与 manifest.py storage_root 同源逻辑:显式覆写 > 开发兜底)
_INSTALLED = Path.home() / "Library/Application Support/漫影工作室/comfyui"
ENGINE_HOME = Path(os.environ.get("MYSTUDIO_COMFYUI_HOME") or _INSTALLED)
RGTHREE_JS = ENGINE_HOME / "ComfyUI/custom_nodes/rgthree-comfy/web/comfyui/fast_groups_bypasser.js"

BYPASSER_TYPE = "Fast Groups Bypasser (rgthree)"   # 源码核验(constants.ts addRgthree)
BYPASSER_ID = 88
BYPASSER_TITLE = "[88] LoRA 分组开关(自动收集「LoRA·」前缀组;点行=整组旁路/恢复)"
MATCH_TITLE = "^LoRA·"                             # 正则前缀匹配,rgthree matchTitle

# 五组定义:标题 / 成员(组内显示序=链序)/ 组框色 / 组 id
GROUPS = [
    ("LoRA·功能件",   [47, 81],          "#3f789e", 5),
    ("LoRA·人物三件", [67, 73, 76],      "#8a5fb0", 6),
    ("LoRA·质感",     [46, 78],          "#4d9e6a", 7),
    ("LoRA·画风其他", [19, 69, 77],      "#c27a3d", 8),
    ("LoRA·画风水墨", [82, 83, 84, 87],  "#647c91", 9),
]
GROUP_PREFIX = "LoRA·"

EXPECTED_CHAIN = [21, 47, 81, 67, 46, 78, 73, 76, 19, 69, 77, 82, 83, 84, 87, 12]

Y, W, H = 80, 460, 130        # 横排一行惯例(先例=goldenmist/tancai 脚本)
PITCH, GROUP_GAP = 490, 100   # 组内节点间距 / 组间额外空隙
BOX_Y, BOX_H, BOX_PAD = 40, 190, 40   # 组框 y/高/左右内边距(现行 ② 形制)
X0 = 1300

TITLE2 = ("② LoRA 链(14 件五组:功能件/人物三件/质感/画风其他/画风水墨;"
          "叠加链序以连线为准 47→81→67→46→78→73→76→19→69→77→82→83→84→87→85;"
          "水墨四件默认旁路;画风件一次一枚;整组启停=[88] 分组开关)")

CARD_OLD_HEAD = "## LoRA 按型速配(09-19 裁定;当前保存态=人物配置,[47][67][73][76][81] 开)"
CARD_NEW_HEAD = ("## LoRA 按型速配(09-19 裁定;按型生效=[85] 自动装组(daojie_loras.json 单源),"
                 "画布保存态=仅 [47][81] 常开、其余 12 件旁路待命)")

CARD_SECTION = """## 分组开关([88] rgthree·Fast Groups Bypasser;自动收集「LoRA·」前缀五组)
- LoRA·功能件=[47]加速+[81]服从度|默认**开**(全局基建)|日常勿动;[47] 关=定稿档 8 步慢跑
- LoRA·人物三件=[67]细节+[73]鎏金+[76]亚洲面孔|默认旁路|手工叠加人物件时整组点开(按型自动装组走 [85],通常无需手开)
- LoRA·质感=[46]光影+[78]电影感|默认旁路|摄影/影视向质感再开
- LoRA·画风其他=[19]identity+[69]暗笔刷+[77]美学|默认旁路|[19] 恒旁路(编辑系件);[69]/[77] 按需单开
- LoRA·画风水墨=[82]淡彩线描+[83]墨洗+[84]湿画+[87]金雾|默认旁路|一次最多一枚,启用须在 [50] 补触发词
- 机制:点 [88] 上组行=整组旁路/恢复(mode 4/0,真跳过加载);画布静态操作,切组重跑生效;不随 [80] 型联动(按型自动启停=[85] 职责,本开关=降级路径2/过渡态)"""


def check_rgthree_installed() -> None:
    """装机实物为准:rgthree 前端件在装机家在场且注册链产出目标类名。
    (built JS 里旁路器类引用 NodeTypesString.FAST_GROUPS_BYPASSER,字面量
    在 constants.js 的 addRgthree("Fast Groups Bypasser")——两处齐验。)"""
    constants = RGTHREE_JS.parent / "constants.js"
    for p in (RGTHREE_JS, constants):
        if not p.is_file():
            raise RuntimeError(f"rgthree 前端件缺位: {p}")
    ctext = constants.read_text(encoding="utf-8", errors="replace")
    if 'addRgthree("Fast Groups Bypasser")' not in ctext:
        raise RuntimeError(f"装机 rgthree constants 未注册 Fast Groups Bypasser: {constants}")
    btext = RGTHREE_JS.read_text(encoding="utf-8", errors="replace")
    if "FAST_GROUPS_BYPASSER" not in btext:
        raise RuntimeError(f"装机 rgthree 旁路器件异常: {RGTHREE_JS}")
    print(f"RGTHREE 装机在场(constants 注册 addRgthree(\"Fast Groups Bypasser\")"
          f" + 旁路器件;家={ENGINE_HOME.name})")


def model_chain(d: dict) -> list[int]:
    """[21] 沿 MODEL 走到 [12](goldenmist 同款走法;MyDaojieLoras 非
    LoraLoader/KSampler 不入链,链尾 87→85→12 由 85 的后继兜断)。"""
    nodes = {n["id"]: n for n in d["nodes"]}
    chain, cur = [21], 21
    while True:
        nxt = None
        for l in d["links"]:
            if l[1] == cur and nodes.get(l[3], {}).get("type") in (
                    "LoraLoaderModelOnly", "KSampler"):
                nxt = l[3]
                break
        if nxt is None or nxt == 12:
            chain.append(12)
            return chain
        if nxt in chain:
            raise RuntimeError(f"模型链成环: {chain + [nxt]}")
        chain.append(nxt)
        cur = nxt


def center(node: dict) -> tuple[float, float]:
    x, y = node["pos"][0], node["pos"][1]
    w, h = node.get("size", [0, 0])
    return (x + w / 2, y + h / 2)


def inside(cx: float, cy: float, box: list) -> bool:
    bx, by, bw, bh = box
    return bx <= cx < bx + bw and by <= cy < by + bh


def boxes_for(layout: dict[int, tuple[float, float]]) -> dict[str, list]:
    """由布局算五组组框(左右各让 BOX_PAD)。"""
    out = {}
    for title, members, _color, _gid in GROUPS:
        xs = [layout[m][0] for m in members]
        out[title] = [min(xs) - BOX_PAD, BOX_Y,
                      max(xs) + W - min(xs) + 2 * BOX_PAD, BOX_H]
    return out


def relayout(d: dict) -> dict[int, tuple[float, float]]:
    """五组左→右横排重定位 14 件;返回 id→pos 映射。不动 links/mode/widgets。"""
    layout, x = {}, X0
    for _title, members, _color, _gid in GROUPS:
        for i, nid in enumerate(members):
            layout[nid] = (x + i * PITCH, Y)
        x = x + (len(members) - 1) * PITCH + W + GROUP_GAP
    nodes = {n["id"]: n for n in d["nodes"]}
    chain = model_chain(d)
    for nid, (px, py) in layout.items():
        n = nodes[nid]
        n["pos"] = [px, py]
        n["size"] = [W, H]
        n["order"] = 9 + chain.index(nid)     # order 跟链序(=改前原值 10..23;[88]=24 不撞)
    # [85]/[86] 顺移链尾下方(等 [87] 对齐;中心不入任何组框)
    nodes[85]["pos"] = [layout[87][0], 280]
    nodes[86]["pos"] = [layout[87][0], 420]
    print(f"LAYOUT 五组横排 y={Y};链尾 x 至 {layout[87][0] + W};[85]/[86] 顺移链尾下方")
    return layout


def rebuild_groups(d: dict, layout: dict[int, tuple[float, float]]) -> None:
    """删旧 LoRA· 组、按固定 id 5..9 重建;② 扩界改题;1/3/4 不动。"""
    boxes = boxes_for(layout)
    kept, dropped = [], []
    for g in d.get("groups", []):
        (dropped if str(g.get("title", "")).startswith(GROUP_PREFIX) else kept).append(g)
    if dropped:
        print(f"GROUPS 摘除旧 LoRA· 组 {len(dropped)} 个(幂等重建)")
    held = {g["id"] for g in kept}
    for title, _members, _color, gid in GROUPS:
        if gid in held:
            raise RuntimeError(f"组 id {gid} 被非 LoRA· 组占用(不猜,人工裁决): "
                               f"{[g for g in kept if g['id'] == gid]}")
    for (title, members, color, gid), (_t2, box) in zip(GROUPS, boxes.items()):
        kept.append({"id": gid, "title": title, "bounding": box,
                     "color": color, "flags": {}})
    assert [t for t, _ in boxes.items()] == [g[0] for g in GROUPS]
    for g in kept:
        if str(g.get("title", "")).startswith("②"):
            g["title"] = TITLE2
            g["bounding"] = [1220, BOX_Y,
                             max(b[0] + b[2] for b in boxes.values()) + 10 - 1220,
                             BOX_H]
    d["groups"] = kept
    print(f"GROUPS 五组建框(id 5..9)+ ② 扩界至 x≤"
          f"{max(b[0] + b[2] for b in boxes.values()) + 10}")


def insert_bypasser(d: dict) -> None:
    """插入/原位重建 [88](纯前端件,零连线;载入只读组态,不改任何组现状)。"""
    foreign = [n for n in d["nodes"]
               if n["id"] == BYPASSER_ID and n.get("type") != BYPASSER_TYPE]
    if foreign:
        raise RuntimeError(
            "id %d 被他类节点占用(不猜): %s" % (BYPASSER_ID, foreign[0].get("type")))
    others = [n for n in d["nodes"]
              if n.get("type") == BYPASSER_TYPE and n["id"] != BYPASSER_ID]
    if others:
        print(f"WARN 画布另有用户自加旁路器 id={[n['id'] for n in others]},不动")
    d["nodes"] = [n for n in d["nodes"] if n["id"] != BYPASSER_ID]
    d["nodes"].append({
        "id": BYPASSER_ID,
        "type": BYPASSER_TYPE,
        "pos": [6480, 280],
        "size": [330, 160],
        "flags": {"collapsed": False},
        "order": 24,
        "mode": 0,
        "inputs": [],
        "outputs": [{"name": "OPT_CONNECTION", "type": "*", "links": None}],
        "title": BYPASSER_TITLE,
        "properties": {
            "matchColors": "",
            "matchTitle": MATCH_TITLE,
            "showNav": True,
            "showAllGraphs": True,
            "sort": "position",
            "customSortAlphabet": "",
            "toggleRestriction": "default",
        },
    })
    d["last_node_id"] = max(int(d.get("last_node_id", 0)), BYPASSER_ID)
    print(f"BYPASSER [{BYPASSER_ID}] {BYPASSER_TYPE} 落位(pos 6480,280;"
          f"matchTitle={MATCH_TITLE!r};无连线无 widget 态)")


def update_card(d: dict) -> None:
    """[66] 速查卡:修过期保存态口径 + 增/换「分组开关」段(幂等)。"""
    card = next(n for n in d["nodes"] if n["id"] == 66)
    md = card["widgets_values"][0]
    orig = md
    if CARD_OLD_HEAD in md:
        md = md.replace(CARD_OLD_HEAD, CARD_NEW_HEAD, 1)
    elif CARD_NEW_HEAD not in md:
        raise RuntimeError("速查卡按型速配段头与预期不符(卡实况变过,人工对表)")
    # 分组开关段:在场则整段替换,不在场则插到「## 参数速查」前
    lines = md.split("\n")
    start = next((i for i, s in enumerate(lines) if s.startswith("## 分组开关")), None)
    if start is not None:
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")),
                   len(lines))
        pad = [""] if end > start and lines[end - 1] == "" else []
        lines[start:end] = CARD_SECTION.split("\n") + pad
        md = "\n".join(lines)
    elif "\n## 参数速查" in md:
        md = md.replace("\n## 参数速查", "\n" + CARD_SECTION + "\n\n## 参数速查", 1)
    else:
        raise RuntimeError("速查卡缺「## 参数速查」锚点,无法插分组开关段")
    if md != orig:
        card["widgets_values"][0] = md
        if "markdown" in card.get("widgets_values_named", {}):
            card["widgets_values_named"]["markdown"] = md
        if "text" in card.get("widgets_values_named", {}):
            card["widgets_values_named"]["text"] = md
        print("CARD [66] 按型速配段头改正(保存态实况)+ 分组开关段落位")
    else:
        print("CARD [66] 无变化(幂等)")


def validate(d: dict, modes0: dict[int, int], links0: list) -> dict[int, tuple[float, float]]:
    ids = {n["id"] for n in d["nodes"]}
    assert len(d["nodes"]) == len(ids), "节点 id 重复"
    chain = model_chain(d)
    assert chain == EXPECTED_CHAIN, f"链序漂移: {chain}"
    nodes = {n["id"]: n for n in d["nodes"]}
    # links 与 mode 零变化 = 行为零变化(链序敏感铁律)
    assert d["links"] == links0, "links 被改动(严禁)"
    modes1 = {n["id"]: n.get("mode", 0) for n in d["nodes"]}
    drift = {k: (v, modes1.get(k)) for k, v in modes0.items() if modes1.get(k) != v}
    assert not drift, f"mode 被改动: {drift}"
    # 分组划分:每件中心恰落本组框,不落他组框/②外件不入组
    layout = {n["id"]: center(nodes[n["id"]]) for n in d["nodes"]
              if n["id"] in {m for _t, ms, _c, _g in GROUPS for m in ms}}
    boxes = {g["title"]: g["bounding"] for g in d["groups"]
             if str(g["title"]).startswith(GROUP_PREFIX)}
    assert set(boxes) == {t for t, _m, _c, _g in GROUPS}, boxes
    for title, members, _c, _g in GROUPS:
        for m in members:
            cx, cy = layout[m]
            hits = [t for t, b in boxes.items() if inside(cx, cy, b)]
            assert hits == [title], f"[{m}] 中心落在 {hits} ≠ [{title}]"
    # 85/86/88 不入任何 LoRA· 组(九型驱动件与展示件不受组开关牵连)
    for nid in (85, 86, 88):
        cx, cy = center(nodes[nid])
        hits = [t for t, b in boxes.items() if inside(cx, cy, b)]
        assert not hits, f"[{nid}] 误入组 {hits}"
    # 旁路器形制
    bp = nodes[BYPASSER_ID]
    assert bp["type"] == BYPASSER_TYPE and bp["properties"]["matchTitle"] == MATCH_TITLE
    assert bp.get("inputs") == [] and not any(
        l[1] == BYPASSER_ID or l[3] == BYPASSER_ID for l in d["links"]), "旁路器须零连线"
    assert "widgets_values" not in bp, "虚拟件不存 widget 态(serialize_widgets=false)"
    # 组 id 无冲突、② 在场
    gids = [g["id"] for g in d["groups"]]
    assert len(gids) == len(set(gids)), f"组 id 重复: {gids}"
    assert any(str(g.get("title", "")).startswith("②") for g in d["groups"])
    # 非豁免类节点 AABB 两两不相交(与 workflow_graph_lint 同判;卡类豁免)
    EXEMPT = {"MarkdownNote", "Label", "easy label", "Note (rgthree)"}
    solid = [n for n in d["nodes"] if n["type"] not in EXEMPT]
    for i in range(len(solid)):
        for j in range(i + 1, len(solid)):
            a, b = solid[i], solid[j]
            ax, ay = a["pos"][0], a["pos"][1]
            aw, ah = a.get("size", [0, 0])
            bx, by = b["pos"][0], b["pos"][1]
            bw, bh = b.get("size", [0, 0])
            assert not (ax < bx + bw and bx < ax + aw and ay < by + bh and by < ay + ah), \
                f"AABB 相交: [{a['id']}]×[{b['id']}]"
    print(f"VALIDATE 节点={len(d['nodes'])} links={len(d['links'])}(零改动) "
          f"组={len(d['groups'])} 链={'→'.join(map(str, chain))}")
    return {n["id"]: (n["pos"][0], n["pos"][1]) for n in d["nodes"]}


def main() -> int:
    check_rgthree_installed()
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)
    modes0 = {n["id"]: n.get("mode", 0) for n in d["nodes"]}
    links0 = json.loads(json.dumps(d["links"]))   # 深快照
    assert model_chain(d) == EXPECTED_CHAIN, "前置链序与预期不符,停手"
    layout = relayout(d)
    rebuild_groups(d, layout)
    insert_bypasser(d)
    update_card(d)
    validate(d, modes0, links0)
    out = json.dumps(d, ensure_ascii=False, indent=2)
    WF.write_text(out, encoding="utf-8")
    check = json.loads(WF.read_text(encoding="utf-8"))
    validate(check, modes0, links0)
    print("OK 分组重排+旁路器+速查卡落位(重跑字节级相同)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
