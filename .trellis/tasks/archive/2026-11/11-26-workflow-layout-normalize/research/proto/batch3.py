#!/usr/bin/env python3
"""全量试验 v3(双盒原型 opcc2):候选只算一次,三套守门策略共用。结果落 batch3.json。"""
import json
import os
import sys
import time

sys.path.insert(0, "/tmp/wflayout-research.g8dxXV")
import opcc2 as opcc
import survey
from layout_check import check_workflow

LADDER = (1.0, 1.5, 2.0, float("inf"))
BIG = 10 ** 9
POLICIES = {
    "strict": lambda before: {},
    "x3": lambda before: {"crossings": 3},
    "free": lambda before: {"crossings": BIG, "occlusion": BIG, "leftward": BIG, "est_spacing": BIG, "est_overlap": BIG},
}


def ext(nodes, groups):
    bs = [opcc.vbox(n) for n in nodes] + [(g["bounding"][0], g["bounding"][1], g["bounding"][0] + g["bounding"][2],
                                           g["bounding"][1] + g["bounding"][3]) for g in groups or []]
    if not bs:
        return (0, 0)
    return (round(max(b[2] for b in bs) - min(b[0] for b in bs)), round(max(b[3] for b in bs) - min(b[1] for b in bs)))


def metrics(doc):
    sc = [survey.survey_scope("m", doc.get("nodes") or [], doc.get("links") or [], None, doc.get("groups") or [])]
    for sg in (doc.get("definitions") or {}).get("subgraphs") or []:
        sc.append(survey.survey_scope("s", sg.get("nodes") or [], sg.get("links") or [], sg, sg.get("groups") or []))
    z = [s["fit_zoom"] for s in sc if s["n_nodes"] >= 2]
    return {"GO": sum(s["check"].get("group_overlap", 0) for s in sc), "OUT": sum(s["node_out_est"] for s in sc),
            "OUTd": sum(s["node_out_declared"] for s in sc), "TIGHT": sum(s["tight"] for s in sc),
            "hfar": sum(s["h_gap_far"] for s in sc), "vfar": sum(s["v_gap_far"] for s in sc),
            "wire": sum(s["wire_far"] for s in sc), "zmin": min(z) if z else None,
            "area": sum(s["W"] * s["H"] for s in sc),
            "cross": sum(s["check"].get("crossings", 0) for s in sc), "occl": sum(s["check"].get("occlusion", 0) for s in sc),
            "left": sum(s["check"].get("leftward", 0) for s in sc), "es": sum(s["check"].get("est_spacing", 0) for s in sc)}


def main():
    root = os.path.join(opcc.REPO, "apps/backend/comfyui/workflows")
    files = []
    for dp, dn, fn in os.walk(root):
        for f in sorted(fn):
            if f.endswith(".json"):
                files.append(os.path.join(dp, f))
    rows, t00 = [], time.time()
    for p in sorted(files):
        rel = os.path.relpath(p, root)
        doc = json.load(open(p, encoding="utf-8"))
        if not (isinstance(doc, dict) and isinstance(doc.get("nodes"), list)) or not doc["nodes"]:
            continue
        t0 = time.time()
        try:
            before = opcc.counts_of(doc)
        except Exception as e:                      # 检查器自身报错(如节点 id 混用字符串与整数)
            rows.append({"file": rel, "error": "checker: %s" % e})
            print("%3d %-46s CHECKER-ERROR %s" % (len(rows) + 1, rel[-46:], str(e)[:50]), flush=True)
            continue
        cands = opcc.candidates(doc, ladder=LADDER)
        m0 = metrics(doc)
        row = {"file": rel, "before": m0, "size0": list(ext(doc.get("nodes") or [], doc.get("groups") or []))}
        for pname, tf in POLICIES.items():
            new, rep = opcc.pick(before, cands, tf(before))
            r = {"rung": opcc.fmt_scale(rep["scale"]) if new else "fail",
                 "unsolv": [opcc.fmt_scale(t[0]) for t in rep["trail"] if t[1] == "unsolvable"]}
            if new:
                r["checks"] = {k[:14]: {c: v for c, v in d.items()} for k, d in rep["after"].items()}
                r["size1"] = list(ext(new.get("nodes") or [], new.get("groups") or []))
                if pname in ("x3", "free"):
                    r["after"] = metrics(new)
            row[pname] = r
        rows.append(row)
        print("%3d %-46s strict=%-13s x3=%-13s free=%-13s %s %.0fs" % (
            len(rows), rel[-46:], row["strict"]["rung"], row["x3"]["rung"], row["free"]["rung"],
            "UNSOLV" if row["free"]["unsolv"] and row["free"]["rung"] == "fail" else "", time.time() - t00), flush=True)
    json.dump(rows, open("/tmp/wflayout-research.g8dxXV/batch3.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("DONE", len(rows), round(time.time() - t00), "s")


if __name__ == "__main__":
    main()
