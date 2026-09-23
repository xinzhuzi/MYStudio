#!/usr/bin/env python3
"""qi21-道劫-t2i 布局交叉审计(09-24,任务一)。

口径=workflow_layout.py 的 est_size 尺寸估计 + 槽位锚定线段(出线=右缘槽 y,入线=左缘槽 y,
TITLE_H=36/SLOT_H=24);-10/-20 IO 槽按其 pos 造点端点;共端点边豁免(同 inspect)。
输出:主图+子图交叉计数与逐条明细(link 对/节点对),供生成器整治迭代。

用法:python3 apps/build/scripts/qi21_layout_audit_0924.py [workflow.json]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

_REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(_REPO / ".agents/skills/comfyui"))
from workflow_layout import est_size, TITLE_H, SLOT_H  # noqa: E402

DEFAULT = _REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"


def _slot_point_out(node: dict, slot: int) -> tuple[float, float]:
    x, y = float(node["pos"][0]), float(node["pos"][1])
    w, h = est_size(node)
    sy = min(y + TITLE_H + slot * SLOT_H, y + h - 6)
    return (x + w, sy)


def _slot_point_in(node: dict, slot: int) -> tuple[float, float]:
    x, y = float(node["pos"][0]), float(node["pos"][1])
    _, h = est_size(node)
    sy = min(y + TITLE_H + slot * SLOT_H, y + h - 6)
    return (x, sy)


def _ccw(p, q, r):
    return (r[1] - p[1]) * (q[0] - p[0]) > (q[1] - p[1]) * (r[0] - p[0])


def _cross(s1, s2):
    a, b = s1
    c, d = s2
    return _ccw(a, c, d) != _ccw(b, c, d) and _ccw(a, b, c) != _ccw(a, b, d)


def _kind(key, nmap, io_in, io_out):
    if isinstance(key, tuple):
        io = (io_in if key[0] == -10 else io_out)[key[1]]
        return f"{'in' if key[0] == -10 else 'out'}IO[{key[1]}:{io['name']}]"
    n = nmap[key]
    return f"[{key}]{n['type']}"


def audit_scope(name: str, nodes: list[dict], links: list, io_in: list, io_out: list):
    nmap = {n["id"]: n for n in nodes}

    def out_endpoint(l):
        if isinstance(l, dict):
            oid, slot = l["origin_id"], l["origin_slot"]
            if oid == -10:
                p = io_in[slot]["pos"]
                return (float(p[0]), float(p[1])), f"inIO[{slot}:{io_in[slot]['name']}]", -10
        else:
            oid, slot = l[1], l[2]
        return _slot_point_out(nmap[oid], slot), f"[{oid}]{nmap[oid]['type']}", oid

    def in_endpoint(l):
        if isinstance(l, dict):
            tid, slot = l["target_id"], l["target_slot"]
            if tid == -20:
                p = io_out[slot]["pos"]
                return (float(p[0]), float(p[1])), f"outIO[{slot}:{io_out[slot]['name']}]", -20
        else:
            tid, slot = l[3], l[4]
        return _slot_point_in(nmap[tid], slot), f"[{tid}]{nmap[tid]['type']}", tid

    edges = []
    for l in links:
        try:
            (sp, sl, sn), (tp, tl, tn) = out_endpoint(l), in_endpoint(l)
        except (KeyError, IndexError):
            continue
        lid = l["id"] if isinstance(l, dict) else l[0]
        edges.append((lid, sp, tp, sl, tl, sn, tn))
    hits = []
    for i in range(len(edges)):
        for j in range(i + 1, len(edges)):
            la, sa, ta, sla, tla, sna, tna = edges[i]
            lb, sb, tb, slb, tlb, snb, tnb = edges[j]
            if {sna, tna} & {snb, tnb}:
                continue  # 共节点豁免(与 workflow_layout.inspect 同规:同节点线不入交叉账)
            if _cross((sa, ta), (sb, tb)):
                hits.append((la, lb, f"{sla}→{tla}", f"{slb}→{tlb}"))
    print(f"== {name}: nodes={len(nodes)} links={len(edges)} 交叉={len(hits)}")
    for la, lb, ea, eb in hits:
        print(f"  link{la} {ea}  ×  link{lb} {eb}")
    return len(hits)


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT
    wf = json.loads(path.read_text(encoding="utf-8"))
    n_main = audit_scope("主图", wf["nodes"], wf["links"], [], [])
    n_sg = 0
    for sg in wf.get("definitions", {}).get("subgraphs", []):
        n_sg += audit_scope(f"子图[{sg.get('name', '?')[:20]}]", sg["nodes"], sg["links"],
                            sg.get("inputs", []), sg.get("outputs", []))
    print(f"TOTAL: 主图={n_main} 子图={n_sg} 合计={n_main + n_sg}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
