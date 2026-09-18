#!/usr/bin/env python3
"""漫影工作流图 lint(09-18 道劫底座节点化配套;通用零引擎依赖)。

用法:
    python3 apps/build/scripts/workflow_graph_lint.py <工作流.json 路径>...

检查项(问题非零退出;每文件列全问题后汇总):
  1. JSON 可解析 + 顶层 nodes/links 数组在场;
  2. 节点 AABB 两两不相交——说明卡/横幅类豁免(MarkdownNote/Label/
     easy label/Note (rgthree):说明件常叠放/不承连线,不参与遮挡判定);
  3. 链端点存在 + 槽位不越界 + 双向登记一致(links[i] ↔ 源节点
     outputs[].links ↔ 目标节点 inputs[].link,任一侧缺登记即报);
  4. 节点侧反向登记(输出引用悬空线 / 输入引用悬空线);
  5. 必填槽启发式:inputs 无 widget 键(widget 化=值由 widget 提供)、
     link 为 null(未接线)、shape≠7(7=litegraph 可选槽位形态,先例=
     MyStylesLibrary/MyDaojieBase 的 forceInput optional 槽)→ 疑似
     未接线的必填输入槽(只读序列化无法区分 required/optional,宁报
     不漏,由人裁决)。

退出码:全部干净=0;任一文件有问题=1;参数/IO 错误=2。
注意:仅适用 UI 格式(litegraph schema:顶层 nodes/links 数组);API 格式
(prompt 导出,如桥模板 krea2-daojie-t2i.json)会报「缺 nodes/links
数组」并以 1 退出——属格式不匹配的如实报告,不是文件缺陷。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 说明卡/横幅类:不承连线、常与内容重叠摆放,豁免 AABB 判定
EXEMPT_OCCLUSION_TYPES = frozenset({
    "MarkdownNote", "Label", "easy label", "Note (rgthree)",
})

_OPTIONAL_SHAPE = 7  # litegraph 可选槽位形态(forceInput optional 槽先例)

# widget 型类型:未连线时值由 widgets_values 位置式兜底(旧格式「可连接
# widget」inputs 无 widget 键,先例=K2-文生图.json [70]/[71] LoRA),
# 不作必填槽报告;纯连接型(MODEL/CLIP/LATENT/IMAGE/STRING-forceInput…)
# 未接线才是真必填缺失
_WIDGET_VALUE_TYPES = frozenset({"COMBO", "FLOAT", "INT", "NUMBER", "BOOLEAN"})


def lint_workflow(path: Path) -> list[str]:
    """对单个工作流 JSON 跑全部检查,返回问题清单(空=干净)。"""
    problems: list[str] = []
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        return [f"读取失败:{exc}"]
    except ValueError as exc:
        return [f"JSON 不可解析:{exc}"]

    if not isinstance(doc, dict):
        return [f"顶层应为对象,实为 {type(doc).__name__}"]
    nodes_raw, links_raw = doc.get("nodes"), doc.get("links")
    if not isinstance(nodes_raw, list) or not isinstance(links_raw, list):
        problems.append(f"缺 nodes/links 数组(nodes={type(nodes_raw).__name__},"
                        f"links={type(links_raw).__name__})")
        return problems

    nodes: dict = {}
    for n in nodes_raw:
        if not isinstance(n, dict) or "id" not in n:
            problems.append("存在无 id 的节点条目")
            continue
        if n["id"] in nodes:
            problems.append(f"节点 id 重复:{n['id']}")
        nodes[n["id"]] = n

    # ── 1. AABB 两两不相交(豁免说明卡/横幅)────────────────────
    rects = []
    for nid, n in nodes.items():
        if n.get("type") in EXEMPT_OCCLUSION_TYPES:
            continue
        pos, size = n.get("pos"), n.get("size")
        if not pos or not size:
            problems.append(f"节点 {nid}({n.get('type')}) 缺 pos/size")
            continue
        rects.append((nid, pos[0], pos[1], pos[0] + size[0], pos[1] + size[1]))
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            if a[1] < b[3] and b[1] < a[3] and a[2] < b[4] and b[2] < a[4]:
                problems.append(f"节点 {a[0]} 与 {b[0]} 矩形相交(AABB 遮挡)")

    # ── 2. 链端点/槽位/双向登记 ────────────────────────────────
    link_ids: set = set()
    for l in links_raw:
        if not isinstance(l, list) or len(l) < 5:
            problems.append(f"畸形 link 条目:{l!r}")
            continue
        lid, src, s_slot, dst, d_slot = l[0], l[1], l[2], l[3], l[4]
        if lid in link_ids:
            problems.append(f"link id 重复:{lid}")
        link_ids.add(lid)
        if src not in nodes or dst not in nodes:
            problems.append(f"线 {lid} 端点节点缺失({src}→{dst})")
            continue
        outs = nodes[src].get("outputs") or []
        ins = nodes[dst].get("inputs") or []
        if not (isinstance(s_slot, int) and s_slot < len(outs)):
            problems.append(f"线 {lid} src 槽位越界(节点 {src} 槽 {s_slot})")
            continue
        if not (isinstance(d_slot, int) and d_slot < len(ins)):
            problems.append(f"线 {lid} dst 槽位越界(节点 {dst} 槽 {d_slot})")
            continue
        if lid not in (outs[s_slot].get("links") or []):
            problems.append(f"线 {lid} 源端单向:节点 {src} 输出槽 {s_slot} 未登记")
        if ins[d_slot].get("link") != lid:
            problems.append(f"线 {lid} 目标端单向:节点 {dst} 输入槽 {d_slot} 登记为 "
                            f"{ins[d_slot].get('link')!r}")

    # ── 3. 节点侧反向登记(悬空引用)────────────────────────────
    for nid, n in nodes.items():
        for o in n.get("outputs") or []:
            for ref in o.get("links") or []:
                if ref not in link_ids:
                    problems.append(f"节点 {nid} 输出引用悬空线 {ref}")
        for ip in n.get("inputs") or []:
            ref = ip.get("link")
            if ref is not None and ref not in link_ids:
                problems.append(f"节点 {nid} 输入「{ip.get('name')}」引用悬空线 {ref}")

    # ── 4. 必填槽启发(无 widget 来源/未接线/非可选形态)─────────
    for nid, n in nodes.items():
        for ip in n.get("inputs") or []:
            if ip.get("widget"):
                continue  # widget 化输入:值由 widget 提供
            if ip.get("link") is not None:
                continue  # 已接线
            if ip.get("shape") == _OPTIONAL_SHAPE:
                continue  # 可选槽形态(forceInput optional)
            if ip.get("type") in _WIDGET_VALUE_TYPES:
                continue  # widget 型:widgets_values 位置式值兜底(旧格式)
            problems.append(f"节点 {nid}({n.get('type')}) 输入「{ip.get('name')}」"
                            "疑似未接线的必填槽(无 widget 值、无连线)")

    return problems


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("-")]
    if not args:
        print(__doc__)
        return 2
    total = 0
    for raw in args:
        path = Path(raw)
        problems = lint_workflow(path)
        if problems:
            total += len(problems)
            print(f"✗ {path}({len(problems)} 问题)")
            for p in problems:
                print(f"  - {p}")
        else:
            print(f"✓ {path}")
    if total:
        print(f"共 {total} 个问题")
        return 1
    print("全部干净")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
