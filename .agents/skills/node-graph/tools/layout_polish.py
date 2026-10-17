#!/usr/bin/env python3
"""
layout_polish — AlignLayout 布局/美观/连线域吸收的非手动形态(1018 v4;源码实读后方法重实现)。

源码研读=pixixai/ComfyUI-AlignLayout@main(v1.6.5)web/default/ 线(auto_layout.js/align_plugin.js/
stretch_plugin.js/fast_link.js/replace_node.js;nodes2/ 为 Vue 适配同算法)。上游**无 LICENSE
文件**(2026-10-18 三查),故零逐字拷贝,只吸收方法与判据并以本仓口径重实现;规则真源=优化集
OPTIMIZATION.md ⑩,判据复用 tools/layout_check.py(0928 立宪口径;下划线私有件跨文件复用=
同技能同族件)。est 常量复用 tools/workflow_layout.py(归因副本)。

函数面(v4,括号=上游出处):
  align_edges       六式对齐            (align: alignNodes,left/right/top/bottom/center)
  distribute_row    行内等距分布/定隙堆叠(align: Stack 指定间距+智能锚点 getAnchorNode)
  unify_widths      同构同宽,居中保持   (stretch: H-Max, cx-maxW/2)
  fit_min_size      尺寸收敛到内容适配  (stretch: Min Size,只缩不放)
  find_free_slot    防碰撞插入落位      (auto_layout: 防碰撞)
  sweep_dead_links  悬空线+孤儿 Reroute 清扫(幂等)
  strip_links       选区内外清线        (fast_link: 清除内部/外部连线语义)
  match_ports       换件端口迁移四级阶梯 (replace_node: findBestInputSlot/OutputSlot)
  column_order      列序混合排序        (auto_layout: min邻居y+平均对向槽序 10px 带)
  connection_score  端口评分梯          (fast_link: -1/1通配/2类型合/3同名,奖励制)
  visual_order      视觉列排序 0.8 阈值 (fast_link: sortNodesByVisualColumns)
  plan_fan_in/out/chain 连线创建三式    (fast_link: F/Shift+F/Alt+F 引擎,占用制+广播复用)
  materialize_links 计划落真链表条目    (fast_link: connect 的数据层形态)
  guarded_polish    美观双不增守门总闸  (本仓 0928 立宪优先级序的机器化)

分工纪律:pos/size 类纯美观变换(align/distribute/unify/fit_min_size)须过 guarded_polish;
strip_links/match_ports/plan_*/materialize 是**拓扑域手术引擎**(换件/收装/拆线/建线役用),
无守门,由手术脚本自身断言+layout_check+契约测试把门(优化集 ⑦)。生产件恒走手术脚本路线,--apply 直写
仅限非项目临时图(生产路径须 --allow-prod)。

Usage:
  from layout_polish import (sweep_dead_links, distribute_row, unify_widths,
                             fit_min_size, find_free_slot, strip_links,
                             match_ports, column_order, guarded_polish)

CLI:
  python3 layout_polish.py 图.json                                  # 只读悬空线体检
  python3 layout_polish.py 图.json --sweep --apply                  # 清扫落盘(临时图)
  python3 layout_polish.py 图.json --strip internal --ids 12,13     # 选区清线(只读报告)
  python3 layout_polish.py 图.json --free-slot 1200,300,320,200 [--scope sub:加速]
  python3 layout_polish.py --selftest
"""
import copy
import json
import os
import sys
from functools import cmp_to_key

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from layout_check import (  # noqa: E402
    CHECK_KEYS, COL_GAP_MIN, POS_MIN, ROW_GAP_MIN, SPACING_EXEMPT_TYPES,
    _est_box, _mk_node, check_workflow,
)
from workflow_layout import (  # noqa: E402  est 常量单源(归因副本)
    DEFAULT_W, IMAGE_PREVIEW_H, IMAGE_PREVIEW_TYPES, PAD_H, SLOT_H, TITLE_H,
    WIDGET_H,
)

REROUTE_TYPES = ("Reroute",)
WILD_TYPES = (None, "*", "Any")  # replace_node 阶梯③的通配排除口径
ORDER_BAND = 10.0                # auto_layout 列序:y 差超此带才分胜负,否则槽序决胜


# --- scope 遍历(可变引用版;负端点=子图边界槽 -10/-20,恒非死线) -------------------

def _iter_scopes(wf):
    """yield (name, nodes_ref, links_ref, sg_or_None);main 先,子图按文件序。"""
    yield "main", wf.setdefault("nodes", []), wf.setdefault("links", []), None
    for sg in ((wf.get("definitions") or {}).get("subgraphs")) or []:
        name = "sub:%s" % (sg.get("name") if sg.get("name") is not None else sg.get("id", "?"))
        yield name, sg.setdefault("nodes", []), sg.setdefault("links", []), sg


def _link_end_ids(entry):
    """GUI 链表条目 [id, origin_id, origin_slot, target_id, target_slot, type] 的两端 id。"""
    if not isinstance(entry, (list, tuple)) or len(entry) < 5:
        return None, None
    try:
        return int(entry[1]), int(entry[3])
    except (TypeError, ValueError):
        return None, None


def _drop_links_and_clean_refs(nodes, links, sg, dead_ids):
    """按死线 id 集摘链表条目+清节点 inputs[].link / outputs[].links / 边界槽 linkIds。"""
    links[:] = [e for e in links if not (isinstance(e, (list, tuple)) and e and e[0] in dead_ids)]
    for n in nodes:
        for i in (n.get("inputs") or []):
            if i.get("link") in dead_ids:
                i["link"] = None
        for o in (n.get("outputs") or []):
            live = [l for l in (o.get("links") or []) if l not in dead_ids]
            if len(live) != len(o.get("links") or []):
                o["links"] = live
    if sg:
        for side in ("inputs", "outputs"):
            for io in sg.get(side) or []:
                live = [l for l in (io.get("linkIds") or []) if l not in dead_ids]
                if len(live) != len(io.get("linkIds") or []):
                    io["linkIds"] = live


# --- 连线清理域 --------------------------------------------------------------------

def sweep_dead_links(wf):
    """死线(引用已不存在节点)+孤儿 Reroute 清扫,幂等 fixpoint(摘 Reroute 会再造死线)。
    负端点(-10/-20 子图边界)恒保留。纯函数:返回 (deepcopy 后的 wf, report)。"""
    out = copy.deepcopy(wf)
    rep = {"dead_links": {}, "orphan_reroutes": {}, "passes": 0}

    for _ in range(8):
        changed = False
        for name, nodes, links, sg in _iter_scopes(out):
            byid = {n.get("id") for n in nodes}
            dead_ids = set()
            for e in links:
                oid, tid = _link_end_ids(e)
                if any(eid is not None and eid >= 0 and eid not in byid for eid in (oid, tid)):
                    if isinstance(e, (list, tuple)) and e:
                        dead_ids.add(e[0])
                    changed = True
            if dead_ids:
                rep["dead_links"][name] = rep["dead_links"].get(name, 0) + len(dead_ids)
                _drop_links_and_clean_refs(nodes, links, sg, dead_ids)
            # 孤儿 Reroute:再无任何活线引用
            live_refs = set()
            for e in links:
                oid, tid = _link_end_ids(e)
                live_refs.update(x for x in (oid, tid) if x is not None)
            orphans = [n["id"] for n in nodes
                       if n.get("type") in REROUTE_TYPES and n.get("id") not in live_refs]
            if orphans:
                rep["orphan_reroutes"][name] = rep["orphan_reroutes"].get(name, []) + orphans
                nodes[:] = [n for n in nodes if n.get("id") not in set(orphans)]
                changed = True
        rep["passes"] += 1
        if not changed:
            break

    rep["dead_links_total"] = sum(rep["dead_links"].values())
    rep["orphan_reroutes_total"] = sum(len(v) for v in rep["orphan_reroutes"].values())
    return out, rep


def strip_links(wf, node_ids, which):
    """选区内外清线(fast_link 语义):which="internal"=仅断**两端都在选区**的线(选区<2
    无操作);"external"=仅断**恰一端在选区**的线(单选=断该节点全部)。负端点(子图边界)
    算选区外——子图内域整体选中时,边界线即外部线。拓扑域手术引擎,无守门。"""
    ids = set(node_ids)
    out = copy.deepcopy(wf)
    rep = {"which": which, "ids": sorted(ids), "removed": {}}
    if which == "internal" and len(ids) < 2:
        rep["note"] = "internal with <2 selected: no-op (fast_link 语义)"
        return out, rep

    for name, nodes, links, sg in _iter_scopes(out):
        dead_ids = set()
        for e in links:
            oid, tid = _link_end_ids(e)
            oin, tin = oid in ids, tid in ids
            if which == "internal":
                drop = oin and tin
            elif len(ids) == 1:
                drop = oin or tin
            else:
                drop = oin != tin
            if drop and isinstance(e, (list, tuple)) and e:
                dead_ids.add(e[0])
        if dead_ids:
            rep["removed"][name] = len(dead_ids)
            _drop_links_and_clean_refs(nodes, links, sg, dead_ids)

    rep["removed_total"] = sum(rep["removed"].values())
    return out, rep


# --- 换件端口迁移(replace_node 四级阶梯,方法重实现+数据层防撞占用制) -------------

def _is_wild(t):
    return t in WILD_TYPES


def _type_set(t):
    """多类型端口(litegraph 列表形,如 ["IMAGE","MASK"])展成集合。"""
    if isinstance(t, (list, tuple)):
        return {str(x) for x in t}
    return {str(t)} if t is not None else set()


def _types_compatible(a, b):
    """ComfyUI 原生类型兼容的近似(更新日志 1.5.0:支持原生通配/多类型):任一侧通配全通;
    多类型取交集;否则串等。"""
    if _is_wild(a) or _is_wild(b):
        return True
    return bool(_type_set(a) & _type_set(b))


def match_ports(old_ports, new_ports, force=True):
    """旧节点端口→新节点端口的迁移映射。四级阶梯(replace_node findBest*Slot 同判):
    ① name+type 全等 ② 仅 name ③ 唯一类型(**双方排除通配 */Any 后恰一候选**)
    ④ 同序兜底:force=True 无条件同 index;否则仅当同位类型兼容(通配算兼容);再无→-1。
    与上游差异:①-③ 增加新槽占用制(一槽至多一映射,数据层防撞;上游靠引擎 connect 拒连);
    ④ forced 不受占用约束(如实标注 via)。old/new=[{"name","type"},…];返回按 old 序。"""
    used = set()
    res = []
    for i, op in enumerate(old_ports):
        cand, via = None, None
        for j, np in enumerate(new_ports):  # ① name+type
            if j not in used and np.get("name") == op.get("name") and np.get("type") == op.get("type"):
                cand, via = j, "name+type"
                break
        if cand is None:  # ② name only
            for j, np in enumerate(new_ports):
                if j not in used and np.get("name") == op.get("name"):
                    cand, via = j, "name"
                    break
        if cand is None and not _is_wild(op.get("type")):  # ③ unique type(双方排通配,多类型取交集)
            cands = [j for j, np in enumerate(new_ports)
                     if j not in used and not _is_wild(np.get("type"))
                     and _types_compatible(op.get("type"), np.get("type"))]
            if len(cands) == 1:
                cand, via = cands[0], "unique-type"
        if cand is None and i < len(new_ports):  # ④ 同序兜底
            if force:
                cand, via = i, "forced"
            else:
                np = new_ports[i]
                if _types_compatible(op.get("type"), np.get("type")):
                    cand, via = i, "index-compatible"
        if cand is not None:
            used.add(cand)
        res.append({"old": i, "new": cand, "via": via})
    return res


# --- 美观动作(pos/size 类;安全性由 guarded_polish 守门) --------------------------

def _find_nodes(wf, ids):
    want = set(ids)
    got = {}
    for _name, nodes, _links, _sg in _iter_scopes(wf):
        for n in nodes:
            if n.get("id") in want:
                got[n["id"]] = n
    missing = want - set(got)
    if missing:
        raise KeyError("node id(s) not found: %s" % sorted(missing))
    return got


ALIGN_MODES = ("left", "right", "top", "bottom", "h_center", "v_center")


def _vis_wh(n):
    """绘制口径宽高:声明 size 优先(画布实画的就是它),缺省回退 est。"""
    sz = n.get("size")
    if isinstance(sz, (list, tuple)) and len(sz) >= 2:
        return float(sz[0]), float(sz[1])
    b = _est_box(n)
    return b[2] - b[0], b[3] - b[1]


def _is_start_node(n):
    """起点件=无输入槽或输入槽全空线(align_plugin 同判)。"""
    ins = n.get("inputs") or []
    return not ins or all(not i.get("link") for i in ins)


def align_edges(wf, node_ids, mode):
    """六式对齐(align_plugin.alignNodes 同数学,绘制口径盒):left/right/top/bottom=对齐
    到极值缘;h_center/v_center=对齐到**中心均值线**(各件中心的算术平均,非中位数)。"""
    if mode not in ALIGN_MODES:
        raise ValueError("mode must be one of %s" % (ALIGN_MODES,))
    nodes = _find_nodes(wf, node_ids)
    ns = list(nodes.values())
    if len(ns) < 2:
        return {"mode": mode, "moved": 0}
    boxes = [(float(n["pos"][0]), float(n["pos"][1])) + _vis_wh(n) for n in ns]
    horiz = mode in ("left", "right", "h_center")
    idx = 0 if horiz else 1
    if mode == "left":
        target = min(b[0] for b in boxes)
    elif mode == "top":
        target = min(b[1] for b in boxes)
    elif mode == "right":
        target = max(b[0] + b[2] for b in boxes)
    elif mode == "bottom":
        target = max(b[1] + b[3] for b in boxes)
    else:
        centers = [b[idx] + (b[2] if horiz else b[3]) / 2 for b in boxes]
        target = sum(centers) / len(centers)
    moved = 0
    for n, b in zip(ns, boxes):
        pos = list(n.get("pos") or [0, 0])
        ext = b[2] if horiz else b[3]
        new = target if mode in ("left", "top") else (
            target - ext if mode in ("right", "bottom") else target - ext / 2)
        if abs(new - pos[idx]) > 1e-9:
            pos[idx] = round(new)
            n["pos"] = pos
            moved += 1
    return {"mode": mode, "moved": moved}


def distribute_row(wf, node_ids, axis="x", min_gap=None, gap=None, anchor="first", align=None):
    """行内分布两档:**gap=None=等距保跨度**(净隙等距化,跌破 min_gap 取下限);
    **gap=数值=定隙紧凑堆叠**(上游 Stack 语义,总跨度=锚件+Σextents+gap×(n−1))。
    est 口径;锚点:anchor="first"=当前序首件前缘钉死;"start"=**智能锚点**
    (getAnchorNode 同判:主轴极值 5px 容差候选→副轴极值 5px→优先无入线起点件→id 最小兜底)。
    align=None 副轴不动;"start"/"center"/"end"=堆叠时副轴对齐(上游公式
    pos_cross=锚件副轴起点+(锚件副轴尺寸−本件尺寸)×factor,0/½/1)。"""
    if min_gap is None:
        min_gap = ROW_GAP_MIN if axis == "x" else COL_GAP_MIN
    nodes = _find_nodes(wf, node_ids)
    idx = 0 if axis == "x" else 1
    ordered = sorted(nodes.values(), key=lambda n: float((n.get("pos") or [0, 0])[idx]))
    anchor_id = None
    if anchor == "start" and len(ordered) >= 2:
        tol = 5.0
        lo = min(float(n["pos"][idx]) for n in ordered)
        cand = [n for n in ordered if float(n["pos"][idx]) <= lo + tol]
        sec_lo = min(float(n["pos"][1 - idx]) for n in cand)
        cand = [n for n in cand if float(n["pos"][1 - idx]) <= sec_lo + tol]
        pool = [n for n in cand if _is_start_node(n)] or cand
        anc = min(pool, key=lambda n: n["id"])
        anchor_id = anc["id"]
        ordered = [anc] + [n for n in ordered if n["id"] != anc["id"]]
    boxes = [_est_box(n) for n in ordered]
    starts = [b[idx] for b in boxes]
    extents = [(b[idx + 2] - b[idx]) for b in boxes]
    if len(ordered) < 2:
        return {"gaps": [], "min_gap": min_gap, "anchor": anchor_id}
    fixed = gap is not None
    if gap is None:
        span_gap = (starts[-1] + extents[-1] - starts[0] - sum(extents)) / (len(ordered) - 1)
        gap = max(min_gap, span_gap)
    before_gaps = [starts[i + 1] - (starts[i] + extents[i]) for i in range(len(ordered) - 1)]
    cross = 1 - idx
    anchor_cross_start = boxes[0][cross]
    anchor_cross_size = boxes[0][cross + 2] - boxes[0][cross]
    factor = {"start": 0.0, "center": 0.5, "end": 1.0}.get(align)
    cur = starts[0]
    for k, (n, ext) in enumerate(zip(ordered, extents)):
        pos = list(n.get("pos") or [0, 0])
        pos[idx] = round(cur)
        if factor is not None and k > 0:
            my_size = boxes[k][cross + 2] - boxes[k][cross]
            pos[cross] = round(anchor_cross_start + (anchor_cross_size - my_size) * factor)
        n["pos"] = pos
        cur += ext + gap
    return {"gaps_before": [round(g) for g in before_gaps],
            "gaps_after": [round(gap)] * (len(ordered) - 1), "min_gap": min_gap,
            "gap_mode": "fixed" if fixed else "equalized",
            "anchor": anchor_id}


def unify_widths(wf, node_ids, anchor="center"):
    """同构同宽律(stretch: H-Max):全组 size[0] 取最大统一。anchor="center" 保持水平
    中心不动(上游语义,cx-maxW/2,两侧对称扩张);"left" 保持左缘。只统宽不统高
    (高由槽位/控件数定,统一即伪 est);无 size 件跳过并报告。"""
    nodes = _find_nodes(wf, node_ids)
    sized = {i: n for i, n in nodes.items()
             if isinstance(n.get("size"), (list, tuple)) and len(n["size"]) >= 1}
    skipped = sorted(set(node_ids) - set(sized))
    if not sized:
        return {"width": None, "skipped": skipped}
    maxw = max(float(n["size"][0]) for n in sized.values())
    for n in sized.values():
        if anchor == "center":
            cx = float(n["pos"][0]) + float(n["size"][0]) / 2
            n["pos"] = [round(cx - maxw / 2), n["pos"][1]]
        n["size"] = [maxw] + list(n["size"][1:])
    return {"width": maxw, "anchor": anchor, "unified": sorted(sized), "skipped": skipped}


def _content_size(n):
    """内容物理适配尺寸(stretch: Min Size 的数据层形态):宽=DEFAULT_W 下限,高按
    est 原始公式(不与声明 size 取 max——est_size 只增不减,收缩档须用原始式)。"""
    n_in = len(n.get("inputs") or [])
    n_out = len(n.get("outputs") or [])
    n_widg = len(n.get("widgets_values") or [])
    rows = max(n_in, n_out)
    h = TITLE_H + rows * SLOT_H + n_widg * WIDGET_H + PAD_H
    if n.get("type") in IMAGE_PREVIEW_TYPES:
        h += IMAGE_PREVIEW_H
    return DEFAULT_W, h  # 宽恒取内容下限(不放大不缩破——引擎要渲染控件)


def fit_min_size(wf, node_ids):
    """尺寸收敛(stretch: Min Size,只缩不放):手拖 oversized 的序列化 size 收缩到
    内容物理适配尺寸(宽=下限,高=est 原始公式高;预览类+260)。序列化足迹与 est 制归一。
    无 size 件跳过。"""
    nodes = _find_nodes(wf, node_ids)
    changed, skipped = {}, []
    for i, n in nodes.items():
        if not (isinstance(n.get("size"), (list, tuple)) and len(n["size"]) >= 2):
            skipped.append(i)
            continue
        cw, ch = _content_size(n)
        old_w, old_h = float(n["size"][0]), float(n["size"][1])
        new_w, new_h = min(old_w, cw), min(old_h, ch)
        if (new_w, new_h) != (old_w, old_h):
            n["size"] = [new_w, new_h]
            changed[i] = {"w": [old_w, new_w], "h": [old_h, new_h]}
    return {"changed": changed, "skipped": skipped}


def find_free_slot(wf, x_hint, y_hint, w, h, scope="main",
                   max_radius=3600, step=60):
    """插入落位(auto_layout: 防碰撞):在指定 scope 的 est 盒空间找距提示点最近的空位
    ——零重叠+同行横净距>=ROW_GAP_MIN/同列纵净距>=COL_GAP_MIN(Reroute/MarkdownNote
    豁免间距不豁免重叠)+零负区(pos>=POS_MIN)。返回 {"pos":[x,y]} 或 None。"""
    boxes = []
    for name, nodes, _links, _sg in _iter_scopes(wf):
        if name == scope:
            boxes = [(n, _est_box(n)) for n in nodes]
            break

    def clear(x, y):
        if x < POS_MIN or y < POS_MIN:
            return False
        ax1, ay1, ax2, ay2 = x, y, x + w, y + h
        for n, (bx1, by1, bx2, by2) in boxes:
            if not (ax2 <= bx1 or bx2 <= ax1 or ay2 <= by1 or by2 <= ay1):
                return False  # est 重叠零容忍(豁免件亦不豁免)
            if n.get("type") in SPACING_EXEMPT_TYPES:
                continue
            y_ov = not (ay2 <= by1 or by2 <= ay1)
            x_ov = not (ax2 <= bx1 or bx2 <= ax1)
            if y_ov and min(ax2 - bx1, bx2 - ax1) < ROW_GAP_MIN:
                return False
            if x_ov and min(ay2 - by1, by2 - ay1) < COL_GAP_MIN:
                return False
        return True

    for r in range(0, max_radius + 1, step):
        for dy in range(-r, r + 1, step):
            for dx in range(-r, r + 1, step):
                if r != 0 and max(abs(dx), abs(dy)) != r:
                    continue  # 只扫当前环
                x, y = round(x_hint + dx), round(y_hint + dy)
                if clear(x, y):
                    return {"pos": [x, y], "scope": scope}
    return None


def column_order(wf, node_ids, direction="forward", band=ORDER_BAND):
    """列序混合排序(auto_layout 引擎):一组同列/同扇出消费端节点的理想纵序。
    主键=相关节点最小 y(**y 差超 band(10px)才分胜负**),次键=平均对向槽序。
    forward(消费端列):看各输入的来源节点 y 与 origin_slot;reverse(生产端列):看各输出
    的去向节点 y 与 target_slot;无相关线=自身 y+槽 0(上游同款兜底)。返回有序明细,
    手术脚本布行/槽序对齐(优化集 ⑧1)时直接取序。"""
    nodes = _find_nodes(wf, node_ids)
    keys = {}
    for name, scope_nodes, links, _sg in _iter_scopes(wf):
        byid = {n.get("id"): n for n in scope_nodes}
        for nid in [i for i in nodes if i in byid]:
            ys, slots = [], []
            for e in links:
                if not (isinstance(e, (list, tuple)) and len(e) >= 5):
                    continue
                oid, tid = _link_end_ids(e)
                try:
                    os_, ts_ = int(e[2]), int(e[4])
                except (TypeError, ValueError):
                    continue
                if direction == "forward" and tid == nid and oid in byid:
                    ys.append(float(byid[oid]["pos"][1])); slots.append(os_)
                elif direction == "reverse" and oid == nid and tid in byid:
                    ys.append(float(byid[tid]["pos"][1])); slots.append(ts_)
            if ys:
                keys[nid] = {"id": nid, "key_y": min(ys),
                             "avg_slot": sum(slots) / len(slots)}
            else:
                keys[nid] = {"id": nid, "key_y": float(byid[nid]["pos"][1]), "avg_slot": 0.0}

    def cmp(a, b):
        if abs(a["key_y"] - b["key_y"]) > band:
            return a["key_y"] - b["key_y"]
        return a["avg_slot"] - b["avg_slot"]

    return sorted(keys.values(), key=cmp_to_key(cmp))


# --- 连线创建域(fast_link F/Shift+F/Alt+F 引擎的数据层形态;1018 v4 随「连线这块」令补) ---

def visual_order(wf, node_ids, threshold=0.8):
    """视觉列排序(sortNodesByVisualColumns 同判):两件横向重叠>较窄者宽×threshold
    =竖叠(按 y,同 y 按 id 决胜),否则横排(按 x)。fast_link F/Alt+F 的排序底座。"""
    nodes = _find_nodes(wf, node_ids)
    ns = list(nodes.values())

    def cmp(a, b):
        aw, _ = _vis_wh(a)
        bw, _ = _vis_wh(b)
        aL, aR = float(a["pos"][0]), float(a["pos"][0]) + aw
        bL, bR = float(b["pos"][0]), float(b["pos"][0]) + bw
        ov = max(0.0, min(aR, bR) - max(aL, bL))
        if ov > min(aw, bw) * threshold:
            if a["pos"][1] != b["pos"][1]:
                return float(a["pos"][1]) - float(b["pos"][1])
            return (a["id"] > b["id"]) - (a["id"] < b["id"])
        return aL - bL

    return [n["id"] for n in sorted(ns, key=cmp_to_key(cmp))]


def connection_score(out_port, in_port, match_strategy="name_type"):
    """端口评分(getConnectionScore 同梯,奖励制——更新日志 1.0.8 由惩罚制改奖励制):
    -1=不兼容;1=任一侧通配/缺类型;2=类型合而名异;3=同名(**大小写不敏感**)或
    type_only 模式的类型合。多类型走 _types_compatible 交集。"""
    ot, it = out_port.get("type"), in_port.get("type")
    if not _types_compatible(ot, it):
        return -1
    if not ot or not it or _is_wild(ot) or _is_wild(it):
        return 1
    if match_strategy == "type_only":
        return 3
    return 3 if str(out_port.get("name") or "").upper() == str(in_port.get("name") or "").upper() else 2


def _best_wire(wf, source_ids, tgt_id, match_strategy, force, used_outputs, reuse_used=False):
    """对目标每个空输入槽选最优源输出:score 降序;占用制——reuse_used=False 硬排除
    已用输出(汇聚:每输出本计划用一次),True=软优先(广播:未用优先,用尽**广播复用**,
    上游 batchUsedSourceOutputs 同语义)。返回 entries+未配平槽位。"""
    nodes = _find_nodes(wf, list(source_ids) + [tgt_id])
    tgt = nodes[tgt_id]
    entries, unfilled = [], []
    for j, ip in enumerate(tgt.get("inputs") or []):
        if ip.get("link") is not None and not force:
            continue  # 非强制绝不拆旧线(fast_link 铁则)
        cands = []
        for sid in source_ids:
            if sid == tgt_id:
                continue
            for i, op in enumerate(nodes[sid].get("outputs") or []):
                s = connection_score(op, ip, match_strategy)
                if s >= 0:
                    cands.append((1 if (sid, i) in used_outputs else 0, -s, sid, i))
        if cands:
            top = min(cands)
            if top[0] == 1 and not reuse_used:
                cands = []  # 占用制硬排除:最优若已用且不允许复用,该槽弃
        if cands:
            _u, _s, sid, i = min(cands)
            used_outputs.add((sid, i))
            entries.append({"src": sid, "src_slot": i, "tgt": tgt_id,
                            "tgt_slot": j, "score": -_s})
        else:
            unfilled.append({"tgt": tgt_id, "tgt_slot": j})
    return entries, unfilled


def plan_fan_in(wf, source_ids, target_id, match_strategy="name_type", force=False):
    """汇聚(多对一,F 键)连线计划:目标各空输入槽在所有源的输出里按评分取最优;
    源输出占用制(每输出本计划用一次)。返回 {"entries":[…],"unfilled":[…]}。"""
    used = set()
    entries, unfilled = _best_wire(wf, source_ids, target_id, match_strategy, force, used)
    return {"entries": entries, "unfilled": unfilled}


def plan_fan_out(wf, source_id, target_ids, match_strategy="name_type", force=False):
    """广播(一对多,Shift+F)连线计划:跨目标**共享占用集=智能分配**(先派本次未用
    的输出,用尽再广播复用——上游 batchUsedSourceOutputs 同语义)。"""
    used = set()
    entries, unfilled = [], []
    for tid in target_ids:
        e, u = _best_wire(wf, [source_id], tid, match_strategy, force, used, reuse_used=True)
        entries += e
        unfilled += u
    return {"entries": entries, "unfilled": unfilled}


def plan_chain(wf, node_ids, match_strategy="name_type"):
    """链式(Alt+F):视觉序 1→2→3 逐件相连;**上一环配平成功才推进**(上游同判,
    断环不空转)。"""
    order = visual_order(wf, node_ids)
    entries, cur = [], order[0]
    for nid in order[1:]:
        e, _u = _best_wire(wf, [cur], nid, match_strategy, False, set())
        if e:
            entries += e
            cur = nid
    return {"entries": entries, "chain_head": cur}


def materialize_links(wf, entries, scope="main", start_id=None):
    """把 plan 落成真链表条目 [id, src, src_slot, tgt, tgt_slot, type](type=源输出口
    类型,列表形取首元素);同步 tgt.inputs[].link 与 src.outputs[].links;id 自
    start_id(缺省=该 scope 现有最大链 id+1)递增。手术域引擎,无守门。"""
    nodes = links = sg = None
    for name, ns, ls, s in _iter_scopes(wf):
        if name == scope:
            nodes, links, sg = ns, ls, s
            break
    if nodes is None:
        raise KeyError("scope not found: %s" % scope)
    byid = {n["id"]: n for n in nodes}
    nxt = start_id
    if nxt is None:
        nxt = max((e[0] for e in links if isinstance(e, (list, tuple)) and e
                   and isinstance(e[0], int)), default=0) + 1
    added = []
    for ent in entries:
        src, ss = byid[ent["src"]], ent["src_slot"]
        tgt, ts = byid[ent["tgt"]], ent["tgt_slot"]
        outs = src.get("outputs") or []
        ot = outs[ss].get("type") if ss < len(outs) else None
        ltype = "*" if ot is None else (str(ot[0]) if isinstance(ot, (list, tuple)) else str(ot))
        links.append([nxt, ent["src"], ss, ent["tgt"], ts, ltype])
        tins = tgt.setdefault("inputs", [])
        if ts < len(tins):
            tins[ts]["link"] = nxt
        sout = src.setdefault("outputs", [])
        if ss < len(sout):
            sout[ss].setdefault("links", []).append(nxt)
        added.append(nxt)
        nxt += 1
    return {"added_ids": added, "count": len(added)}


# --- 美观双不增守门 ----------------------------------------------------------------

def guarded_polish(wf, transform, allow_leftward=frozenset()):
    """守门闸:transform 施于副本,layout_check 各 scope counts 对照,任一项变差即弃。
    返回 (wf_or_candidate, {"applied": bool, ...})。scope 集变化(动了拓扑)=拒绝。"""
    before = {s["name"]: dict(s["counts"]) for s in check_workflow(wf, allow_leftward=allow_leftward)}
    cand = copy.deepcopy(wf)
    transform(cand)
    after = {s["name"]: dict(s["counts"]) for s in check_workflow(cand, allow_leftward=allow_leftward)}
    if set(before) != set(after):
        return wf, {"applied": False, "reason": "scope set changed (structural, not polish)"}
    worse = {}
    for name in before:
        delta = {k: after[name][k] - before[name][k] for k in CHECK_KEYS
                 if after[name][k] > before[name][k]}
        if delta:
            worse[name] = delta
    if worse:
        return wf, {"applied": False, "reason": "polish worsens layout counts", "worse": worse}
    return cand, {"applied": True, "before": before, "after": after}


# --- selftest(合成最小 GUI JSON,全内存) ------------------------------------------

def _selftest():
    mk = _mk_node
    wf = {"nodes": [], "links": [], "definitions": {"subgraphs": []}}
    wf["nodes"] = [
        mk(1, (100, 100), (300, 140), n_out=1),          # 源
        mk(2, (700, 100), (300, 140), n_in=1, n_out=1),
        mk(3, (1400, 100), (300, 140), n_in=1),
        mk(4, (2000, 100), (300, 140), n_in=1),           # 终点
        mk(5, (300, 900), (300, 140), n_in=1),            # unify 居中用(宽 300)
        mk(6, (900, 900), (400, 140), n_in=1),            # unify 居中用(宽 400)
        mk(8, (3000, 100), (600, 500), n_in=1),           # fit_min_size 用(oversized)
        mk(7, (100, 400), (60, 30), ntype="Reroute"),     # 孤儿 Reroute
        mk(9, (1300, 700), (300, 140)),                    # 守门用远件
    ]
    wf["links"] = [
        [1, 1, 0, 2, 0, "*"],
        [2, 2, 0, 3, 0, "*"],
        [3, 1, 0, 4, 0, "*"],                             # 长线(穿 2/3 身上,基线 occlusion=1)
        [4, 3, 0, 5, 0, "*"],
        [5, 5, 0, 6, 0, "*"],
        [99, 42, 0, 4, 0, "*"],                           # 死线(42 不存在)
    ]

    wf2, rep = sweep_dead_links(wf)
    assert len(wf2["links"]) == 5 and rep["dead_links_total"] == 1, rep
    assert 7 not in {n["id"] for n in wf2["nodes"]} and rep["orphan_reroutes_total"] == 1, rep
    print("sweep ok:", json.dumps({k: rep[k] for k in ("dead_links", "orphan_reroutes")}, ensure_ascii=False))

    # strip:拓扑 1→2, 2→3, 1→4, 3→5, 5→6;选区={2,3}: internal 断 2→3;
    # external 断 1→2 与 3→5(1→4 两端皆外,保留);单选 {2} 断其全部
    wf3, rep = strip_links(wf2, [2, 3], "internal")
    live = {(e[1], e[3]) for e in wf3["links"]}
    assert (2, 3) not in live and (1, 2) in live and (3, 5) in live, (rep, live)
    wf3, rep = strip_links(wf2, [2, 3], "external")
    live = {(e[1], e[3]) for e in wf3["links"]}
    assert (1, 2) not in live and (3, 5) not in live and (2, 3) in live and (1, 4) in live, (rep, live)
    wf3, rep = strip_links(wf2, [2], "external")
    assert not any(2 in (e[1], e[3]) for e in wf3["links"]), rep
    print("strip ok: internal/external/single 各语义对")

    rep = distribute_row(wf2, [1, 2, 3])
    xs = [n["pos"][0] for n in wf2["nodes"] if n["id"] in (1, 2, 3)]
    gaps = [xs[i + 1] - xs[i] - 300 for i in range(2)]
    assert gaps[0] == gaps[1] and gaps[0] >= ROW_GAP_MIN, (xs, gaps)
    print("distribute ok: gaps", gaps)

    # unify 居中保持:组 {5(300),6(400)} → maxw=400;5 中心 450 → 新 x=250;6 中心 1100 → 900 不动
    rep = unify_widths(wf2, [5, 6])
    pos = {n["id"]: n["pos"][0] for n in wf2["nodes"] if n["id"] in (5, 6)}
    ws = {n["id"]: n["size"][0] for n in wf2["nodes"] if n["id"] in (5, 6)}
    assert ws == {5: 400.0, 6: 400.0} and pos == {5: 250, 6: 900}, (ws, pos)
    print("unify ok: center-anchored", ws, pos)

    # fit_min_size:8 号 (600,500) 1 输入 → 内容 (250,88) 只缩
    rep = fit_min_size(wf2, [8])
    n8 = next(n for n in wf2["nodes"] if n["id"] == 8)
    assert n8["size"][:2] == [250, 88], (n8["size"], rep)
    print("fit_min_size ok:", rep["changed"])

    # match_ports 四级阶梯
    r = match_ports([{"name": "model", "type": "MODEL"}, {"name": "clip", "type": "CLIP"}],
                    [{"name": "model", "type": "MODEL"}, {"name": "clip2", "type": "CLIP"}])
    assert r[0]["via"] == "name+type" and r[1]["via"] == "unique-type", r
    r = match_ports([{"name": "x", "type": "INT"}], [{"name": "y", "type": "FLOAT"}, {"name": "z", "type": "FLOAT"}])
    assert r[0]["via"] == "forced" and r[0]["new"] == 0, r
    r = match_ports([{"name": "x", "type": "INT"}], [{"name": "y", "type": "FLOAT"}], force=False)
    assert r[0]["new"] is None, r
    r = match_ports([{"name": "x", "type": "IMAGE"}], [{"name": "a", "type": "*"}, {"name": "b", "type": "IMAGE"}])
    assert r[0]["via"] == "unique-type" and r[0]["new"] == 1, r  # 通配不参与唯一计数
    print("match_ports ok: 四级+通配排除+force 开关")

    # column_order:forward 的 key=来源节点 y+origin_slot。同源(带内 y 平)→槽序决胜;
    # 异源(y 差>10)→y 决胜翻转
    wf4 = {"nodes": [mk(1, (100, 100), (300, 100), n_out=2),
                     mk(4, (100, 900), (300, 100), n_out=1),
                     mk(2, (700, 900), (300, 100), n_in=1),
                     mk(3, (700, 150), (300, 100), n_in=1)],
           "links": [[1, 1, 1, 2, 0, "*"], [2, 1, 0, 3, 0, "*"]]}  # 同源:slot1→2 / slot0→3
    order = column_order(wf4, [2, 3])
    assert [o["id"] for o in order] == [3, 2] and order[0]["avg_slot"] == 0, order
    wf4["links"] = [[1, 1, 1, 2, 0, "*"], [2, 4, 0, 3, 0, "*"]]  # 异源:2←源y100 / 3←源y900
    order = column_order(wf4, [2, 3])
    assert [o["id"] for o in order] == [2, 3] and order[0]["key_y"] == 100.0, order
    print("column_order ok: 带内槽序决胜/超带 y 决胜")

    # align_edges:h_center=中心均值线(450/1100→775);left=齐最左缘
    next(n for n in wf2["nodes"] if n["id"] == 6)["pos"] = [900, 900]
    align_edges(wf2, [5, 6], "h_center")
    xs = {n["id"]: n["pos"][0] for n in wf2["nodes"] if n["id"] in (5, 6)}
    assert xs == {5: 575, 6: 575}, xs
    next(n for n in wf2["nodes"] if n["id"] == 6)["pos"] = [900, 900]
    next(n for n in wf2["nodes"] if n["id"] == 5)["pos"] = [250, 900]
    align_edges(wf2, [5, 6], "left")
    xs = {n["id"]: n["pos"][0] for n in wf2["nodes"] if n["id"] in (5, 6)}
    assert xs == {5: 250, 6: 250}, xs
    print("align_edges ok: h_center 均值线 / left 极值缘")

    # 定隙堆叠+智能锚点:5 挂入线后,锚点让位给起点件 6(6 钉死,5 堆其后)
    next(n for n in wf2["nodes"] if n["id"] == 5)["inputs"][0]["link"] = 4
    rep = distribute_row(wf2, [5, 6], gap=100, anchor="start")
    xs = {n["id"]: n["pos"][0] for n in wf2["nodes"] if n["id"] in (5, 6)}
    assert xs == {6: 250, 5: 750} and rep["anchor"] == 6 and rep["gap_mode"] == "fixed", (rep, xs)
    print("distribute v3 ok: 定隙堆叠+智能锚点")

    # 连线创建域:评分梯/汇聚/广播智能分配+复用/链式/物化/视觉序
    def mkp(nid, pos, ins, outs):
        return {"id": nid, "type": "TestNode", "pos": list(pos), "size": [300, 140],
                "inputs": [{"name": n, "type": t} for n, t in ins],
                "outputs": [{"name": n, "type": t} for n, t in outs],
                "widgets_values": []}

    wf5 = {"nodes": [
        mkp(1, (100, 100), [], [("MODEL", "MODEL"), ("CLIP", "CLIP")]),
        mkp(2, (700, 100), [("model", "MODEL"), ("clip", "CLIP")], []),
        mkp(3, (700, 400), [("model", "MODEL")], []),
        mkp(4, (700, 700), [("clip", "CLIP")], []),
    ], "links": []}
    assert connection_score({"name": "MODEL", "type": "MODEL"}, {"name": "model", "type": "MODEL"}) == 3
    assert connection_score({"name": "A", "type": "MODEL"}, {"name": "b", "type": "MODEL"}) == 2
    assert connection_score({"name": "A", "type": "*"}, {"name": "b", "type": "MODEL"}) == 1
    assert connection_score({"name": "A", "type": "INT"}, {"name": "b", "type": "FLOAT"}) == -1
    assert connection_score({"name": "A", "type": "MODEL"}, {"name": "b", "type": "MODEL"}, "type_only") == 3
    plan = plan_fan_in(wf5, [1], 2)
    got = {e["tgt_slot"]: e for e in plan["entries"]}
    assert got[0]["src_slot"] == 0 and got[0]["score"] == 3 and got[1]["src_slot"] == 1, plan
    plan = plan_fan_out(wf5, 1, [3, 4])  # 智能分配:3 吃 MODEL(槽0),4 吃 CLIP(槽1)
    assert {(e["tgt"], e["src_slot"]) for e in plan["entries"]} == {(3, 0), (4, 1)}, plan
    wf5b = {"nodes": [wf5["nodes"][0], mkp(9, (700, 900), [("model", "MODEL")], []),
                      mkp(10, (700, 1100), [("model", "MODEL")], [])], "links": []}
    plan = plan_fan_out(wf5b, 1, [9, 10])
    # 广播复用:第二个 MODEL 目标复用已派的槽0(上游「用尽再复用」)
    assert {(e["tgt"], e["src_slot"]) for e in plan["entries"]} == {(9, 0), (10, 0)}, plan
    wf6 = {"nodes": [mkp(1, (100, 100), [], [("out", "IMAGE")]),
                     mkp(2, (700, 100), [("in", "IMAGE")], [("out", "IMAGE")]),
                     mkp(3, (1400, 100), [("in", "IMAGE")], [])],
           "links": []}
    plan = plan_chain(wf6, [1, 2, 3])
    assert {(e["src"], e["tgt"]) for e in plan["entries"]} == {(1, 2), (2, 3)}, plan
    rep = materialize_links(wf6, plan["entries"])
    assert rep["count"] == 2 and len(wf6["links"]) == 2
    assert wf6["links"][0][:5] == [1, 1, 0, 2, 0] and wf6["links"][1][5] == "IMAGE"
    n2 = next(n for n in wf6["nodes"] if n["id"] == 2)
    n1 = next(n for n in wf6["nodes"] if n["id"] == 1)
    assert n2["inputs"][0]["link"] == 1 and n1["outputs"][0]["links"] == [1]
    assert visual_order(wf5, [1, 2, 3]) == [1, 2, 3]
    print("wire-create ok: 评分梯/汇聚/智能分配+复用/链式/物化/视觉序")

    # 守门拒绝:把 9 挪到 2->3 短线走线上且贴 2 不足横距(occlusion+est_spacing 双红)
    _wf, rep = guarded_polish(wf2, lambda w: _find_nodes(w, [9])[9].__setitem__("pos", [1100, 80]))
    assert rep["applied"] is False and "occlusion" in rep["worse"]["main"], rep
    _wf, rep = guarded_polish(wf2, lambda w: _find_nodes(w, [9])[9].__setitem__("pos", [1300, 2000]))
    assert rep["applied"] is True, rep
    print("guard ok: reject/apply 两态")

    slot = find_free_slot(wf2, 1500, 100, 300, 140)
    assert slot and slot["pos"][0] >= POS_MIN and slot["pos"][1] >= POS_MIN
    print("free-slot ok:", slot["pos"])
    return 0


# --- CLI ---------------------------------------------------------------------------

def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--selftest" in argv:
        return _selftest()
    if not argv or not argv[0].endswith(".json"):
        print(__doc__)
        return 2
    path = argv[0]
    with open(path, encoding="utf-8") as f:
        wf = json.load(f)

    if "--free-slot" in argv:
        x, y, w, h = (float(v) for v in argv[argv.index("--free-slot") + 1].split(","))
        scope = argv[argv.index("--scope") + 1] if "--scope" in argv else "main"
        res = find_free_slot(wf, x, y, w, h, scope=scope)
        print("LAYOUT_POLISH_JSON: " + json.dumps({"free_slot": res}, separators=(",", ":")))
        return 0
    if "--strip" in argv:
        which = argv[argv.index("--strip") + 1]
        ids = [int(v) for v in argv[argv.index("--ids") + 1].split(",")]
        _wf, rep = strip_links(wf, ids, which)
        print("LAYOUT_POLISH_JSON: " + json.dumps(rep, separators=(",", ":"), ensure_ascii=False))
        if "--apply" in argv:
            if "engines/comfyui/workflows" in path and "--allow-prod" not in argv:
                print("refusing production path without --allow-prod (生产件恒走手术脚本路线,优化集 ⑦)")
                return 3
            with open(path, "w", encoding="utf-8") as f:
                json.dump(_wf, f, ensure_ascii=False, indent=2)
            print("written:", path)
        return 0

    _wf, rep = sweep_dead_links(wf)
    print("sweep report:", json.dumps(rep, ensure_ascii=False))
    if "--apply" in argv:
        if "engines/comfyui/workflows" in path and "--allow-prod" not in argv:
            print("refusing production path without --allow-prod (生产件恒走手术脚本路线,优化集 ⑦)")
            return 3
        with open(path, "w", encoding="utf-8") as f:
            json.dump(_wf, f, ensure_ascii=False, indent=2)
        print("written:", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
