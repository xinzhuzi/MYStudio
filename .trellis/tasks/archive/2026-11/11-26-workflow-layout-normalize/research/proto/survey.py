#!/usr/bin/env python3
"""只读度量:全部 GUI 格式工作流 × 各作用域 的 分组互遮 / 节点出组框 / 间距 三类度量。
调研用临时脚本(仓库外);判据复用 .agents/skills/node-graph/tools/layout_check.py。"""
import json
import os
import statistics
import sys

REPO = "/Users/zhengbingjin/Project/Github/MYStudio"
ROOT = os.path.join(REPO, "apps/backend/comfyui/workflows")
sys.path.insert(0, os.path.join(REPO, ".agents/skills/node-graph/tools"))
from layout_check import check_workflow, _est_box, _pos, _size_wh, _iter_links  # noqa: E402

VIEW_W, VIEW_H = 1600, 900          # 参考视口(逻辑像素);fit_zoom=整图可见所需缩放
H_FAR, V_FAR = 400, 240             # 「过远」探针阈值(同一行横净隙 / 同一列纵净隙)
WIRE_FAR = 1200                     # 直连两节点的横向净距上限探针
PAD = (20, 40, 20, 20)              # 组内贴边探针:左/上/右/下 最小留白


def rect(n):
    x, y = _pos(n)
    w, h = _size_wh(n.get("size"))
    return x, y, x + w, y + h


def inter(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    return w, h


def survey_scope(name, nodes, links, sg, groups):
    r = {"scope": name, "n_nodes": len(nodes), "n_groups": len(groups),
         "n_links": len(list(_iter_links(links)))}
    est = {n["id"]: _est_box(n) for n in nodes}
    dec = {n["id"]: rect(n) for n in nodes}
    gboxes = [g["bounding"] for g in groups if g.get("bounding") and len(g["bounding"]) == 4]
    grects = [(b[0], b[1], b[0] + b[2], b[1] + b[3]) for b in gboxes]
    allr = list(est.values()) + grects
    if allr:
        x0 = min(a[0] for a in allr); y0 = min(a[1] for a in allr)
        x1 = max(a[2] for a in allr); y1 = max(a[3] for a in allr)
        r["W"] = round(x1 - x0); r["H"] = round(y1 - y0)
        r["fit_zoom"] = round(min(VIEW_W / max(r["W"], 1), VIEW_H / max(r["H"], 1)), 3)
        area = sum(max(0, a[2] - a[0]) * max(0, a[3] - a[1]) for a in est.values())
        r["density"] = round(area / max(1, r["W"] * r["H"]), 3)
    # 节点出组框
    out_est = out_dec = tight = ungrouped = 0
    out_examples = []
    if grects:
        for n in nodes:
            nid = n["id"]
            e = est[nid]; ea = max(1, (e[2] - e[0]) * (e[3] - e[1]))
            ratios = []
            for gi, g in enumerate(grects):
                w, h = inter(e, g)
                if w > 0 and h > 0:
                    ratios.append((w * h) / ea)
                else:
                    ratios.append(0.0)
            best = max(ratios)
            if best >= 0.999:
                g = grects[ratios.index(best)]
                m = (e[0] - g[0], e[1] - g[1], g[2] - e[2], g[3] - e[3])
                if any(m[i] < PAD[i] for i in range(4)):
                    tight += 1
            elif best > 0:
                out_est += 1
                if len(out_examples) < 4:
                    out_examples.append([nid, n.get("type"), round(best, 2), ratios.index(best)])
            else:
                ungrouped += 1
            d = dec[nid]; da = max(1, (d[2] - d[0]) * (d[3] - d[1]))
            if 0 < max([(max(0, w) * max(0, h)) / da for w, h in (inter(d, g) for g in grects)] or [0]) < 0.999:
                out_dec += 1
    r.update(node_out_est=out_est, node_out_declared=out_dec, tight=tight, ungrouped=ungrouped,
             out_examples=out_examples)
    # 间距
    ids = list(est)
    hg, vg, nn = [], [], []
    for i in range(len(ids)):
        a = est[ids[i]]
        for j in range(i + 1, len(ids)):
            b = est[ids[j]]
            yov = min(a[3], b[3]) - max(a[1], b[1])
            xov = min(a[2], b[2]) - max(a[0], b[0])
            if yov > 0 and xov <= 0:
                hg.append(-xov)
            elif xov > 0 and yov <= 0:
                vg.append(-yov)
        cx, cy = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
        nn.append(min((((est[o][0] + est[o][2]) / 2 - cx) ** 2 + ((est[o][1] + est[o][3]) / 2 - cy) ** 2) ** 0.5
                      for o in ids if o != ids[i]) if len(ids) > 1 else 0)
    hadj, vadj = [], []
    for i in range(len(ids)):
        a = est[ids[i]]
        hr = [est[o][0] - a[2] for k, o in enumerate(ids) if k != i
              and min(a[3], est[o][3]) - max(a[1], est[o][1]) > 0 and est[o][0] >= a[2]]
        vd = [est[o][1] - a[3] for k, o in enumerate(ids) if k != i
              and min(a[2], est[o][2]) - max(a[0], est[o][0]) > 0 and est[o][1] >= a[3]]
        if hr:
            hadj.append(min(hr))
        if vd:
            vadj.append(min(vd))
    r["h_adj"] = hadj
    r["v_adj"] = vadj
    r["h_gap_far"] = sum(1 for g in hg if g > H_FAR)
    r["v_gap_far"] = sum(1 for g in vg if g > V_FAR)
    r["h_gap_max"] = round(max(hg)) if hg else 0
    r["v_gap_max"] = round(max(vg)) if vg else 0
    r["h_gap_med"] = round(statistics.median(hg)) if hg else None
    r["v_gap_med"] = round(statistics.median(vg)) if vg else None
    r["nn_p90"] = round(sorted(nn)[int(0.9 * (len(nn) - 1))]) if nn else 0
    byid = {n["id"]: n for n in nodes}
    wires = []
    for lid, oid, os_, tid, ts_ in _iter_links(links):
        if oid in est and tid in est:
            wires.append(est[tid][0] - est[oid][2])
    r["wire_far"] = sum(1 for w in wires if w >= WIRE_FAR)
    r["wire_max"] = round(max(wires)) if wires else None
    r["wire_med"] = round(statistics.median(wires)) if wires else None
    # 立宪八判据现值
    try:
        rep = check_workflow({"nodes": nodes, "links": links, "groups": groups,
                              "definitions": {"subgraphs": [sg] if sg else []}})
        scope = rep[1] if sg else rep[0]
        r["check"] = scope["counts"]
    except Exception as e:  # 度量不因单件坏结构中断
        r["check"] = {"error": str(e)[:120]}
    return r


def main():
    files = []
    for dp, dn, fn in os.walk(ROOT):
        for f in sorted(fn):
            if f.endswith(".json"):
                files.append(os.path.join(dp, f))
    files.sort()
    out = []
    for p in files:
        rel = os.path.relpath(p, ROOT)
        try:
            wf = json.load(open(p, encoding="utf-8"))
        except Exception as e:
            out.append({"file": rel, "error": str(e)[:100]})
            continue
        if not (isinstance(wf, dict) and isinstance(wf.get("nodes"), list)):
            out.append({"file": rel, "format": "api", "scopes": []})
            continue
        scopes = [survey_scope("main", wf.get("nodes") or [], wf.get("links") or [], None,
                               wf.get("groups") or [])]
        for sg in (wf.get("definitions") or {}).get("subgraphs") or []:
            scopes.append(survey_scope("sub:%s" % (sg.get("name") or sg.get("id")), sg.get("nodes") or [],
                                       sg.get("links") or [], sg, sg.get("groups") or []))
        import re as _re
        cat = "upstream" if (_re.search(r"官方|社区|原件|模板|paralaif", rel) or os.path.basename(rel).startswith("image_")) else "project"
        if "/7_测试/" in rel or rel.startswith("7_测试/"):
            cat += "-test"
        out.append({"file": rel, "format": "gui", "cat": cat, "scopes": scopes})
    json.dump(out, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    gui = [o for o in out if o.get("format") == "gui"]
    api = [o for o in out if o.get("format") == "api"]
    print("总件数 %d = GUI %d + API %d;GUI 作用域数 %d" % (
        len(out), len(gui), len(api), sum(len(o["scopes"]) for o in gui)))
    def q(v, p):
        v = sorted(v); return v[int(p * (len(v) - 1))] if v else None
    for cat in ("project", "project-test", "upstream", "upstream-test"):
        fs = [o for o in gui if o["cat"] == cat]
        if not fs:
            continue
        sc = [s for o in fs for s in o["scopes"]]
        go = sum(1 for o in fs if any(s["check"].get("group_overlap", 0) > 0 for s in o["scopes"]))
        no = sum(1 for o in fs if any(s["node_out_est"] > 0 for s in o["scopes"]))
        nod = sum(1 for o in fs if any(s["node_out_declared"] > 0 for s in o["scopes"]))
        tight = sum(s["tight"] for s in sc)
        nout = sum(s["node_out_est"] for s in sc); noutd = sum(s["node_out_declared"] for s in sc)
        gop = sum(s["check"].get("group_overlap", 0) for s in sc)
        ha = [g for s in sc for g in s["h_adj"]]; va = [g for s in sc for g in s["v_adj"]]
        wf = [s for s in sc if s["wire_far"] > 0]
        zoom = [s["fit_zoom"] for s in sc if s["n_nodes"] >= 2]
        ck = {}
        for s in sc:
            for k, v in s["check"].items():
                if isinstance(v, int): ck[k] = ck.get(k, 0) + v
        print("\n[%s] 件 %d / 作用域 %d" % (cat, len(fs), len(sc)))
        print("  ① 分组互遮: 件 %d / 重叠对 %d" % (go, gop))
        print("  ② 节点出组框: 件 %d(est 口径节点 %d;声明口径件 %d/节点 %d);贴边 %d" % (no, nout, nod, noutd, tight))
        print("  ③ 相邻间距: 横 p50=%s p90=%s max=%s(过远>%d 的 %d/%d);纵 p50=%s p90=%s max=%s(过远>%d 的 %d/%d);长直连(>=%d) %d 条/涉及作用域 %d" % (
            q(ha, .5), q(ha, .9), max(ha) if ha else None, H_FAR, sum(1 for g in ha if g > H_FAR), len(ha),
            q(va, .5), q(va, .9), max(va) if va else None, V_FAR, sum(1 for g in va if g > V_FAR), len(va),
            WIRE_FAR, sum(s["wire_far"] for s in sc), len(wf)))
        print("     整图缩放 fit_zoom: p10=%s p50=%s p90=%s" % (q(zoom, .1), q(zoom, .5), q(zoom, .9)))
        print("  立宪八判据合计: %s;全 0 的件 %d" % (json.dumps(ck, ensure_ascii=False),
              sum(1 for o in fs if all(all(v == 0 for v in s["check"].values()) for s in o["scopes"]))))


if __name__ == "__main__":
    main()
