#!/usr/bin/env python3
"""
layout_check.py — generic layout checker for GUI-format (litegraph) workflow JSON.

Constitution caliber (0928, lines-first). Per scope — the top level is scope
"main"; each definitions.subgraphs[] entry is its own scope "sub:<name>":

  crossings         line-line crossings: cubic-bezier wires sampled at 24 points
                    (i/23), pairwise proper-segment intersection, each pair of
                    links counted at most once
  occlusion         line-over-node: 41-point sampling (i/40); any sample inside
                    a non-endpoint node box (+/-2 tolerance) marks the link
  est_overlap       est footprint boxes must not overlap — Reroute / MarkdownNote
                    are NOT exempt here
  est_spacing       same-row horizontal est gap >= 200 / same-column vertical est
                    gap >= 80; Reroute and MarkdownNote are exempt
  negative_region   every node pos >= 80 (zero negative region)
  output_rightmost  per subgraph: every output IO slot x >= max node x - 50;
                    skipped entirely when the workflow has no subgraphs
  leftward          every link must flow target.x > origin.x, judged per link
                    (Reroute segments included, they are ordinary nodes); subgraph
                    boundary links use the IO slot pos as the endpoint x;
                    exemptions via --allow-leftward <link-ids>

Links whose endpoint is a subgraph boundary pseudo-id (-10 input side / -20
output side, which have no node box) are skipped by the crossing and occlusion
calibers, exactly like the production verifier.

Math provenance: ported formula-by-formula from the production generators'
self-check sections (t2i generator self_check 3/3c-3g; corroborated against the
i2i generator self_check, same formulas). Normative text: the canvas-layout
constitution doc, section 2 (判定口径). Est boxes come from workflow_layout.est_size
in this directory — the single est source shared with the auto-arranger; it is a
superset of the generator-side inline est formula (it also adds the
image-preview height for preview-type nodes and rounds to int).

Ratchet policy: NO baselines are built into this tool. The production ratchet
(per-scope historical crossing caps, tighten-only, single-direction) stays in
the generators' self-check where it belongs. Here --max-crossings defaults to 0
(the constitutional target) and an explicitly passed cap is honored per scope.

CLI:
  python3 layout_check.py <wf.json> [--json] [--max-crossings N] [--allow-leftward id1,id2]
  python3 layout_check.py --selftest

Exit codes: 0 clean, 1 layout violations, 2 usage / input error.
The LAST output line is ALWAYS the machine contract (hard contract for the
cross-validation harness — it parses this line):
  LAYOUT_CHECK_JSON: {"scopes":[{"name":"main","crossings":N},...]}
With --json each scope entry additionally carries a "counts" object with the
per-check violation breakdown.

This file contains no project codenames; everything project-specific arrives
through the CLI arguments and the workflow JSON itself.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from workflow_layout import est_size  # noqa: E402  (local sibling module)

# --- ported constants (generator self-check; do not retune here) ----------------
BOUNDARY_IN_ID = -10     # subgraph input pseudo-id (link origin without a node)
BOUNDARY_OUT_ID = -20    # subgraph output pseudo-id (link target without a node)
CROSS_SAMPLES = 24       # crossing polyline: _bez(..., i/23) for i in range(24)
OCCL_SAMPLES = 41        # occlusion sampling: _bez(..., i/40) for i in range(41)
OCCL_TOL = 2             # node-box tolerance for the occlusion test
SLOT_DY = 25             # slot y = node top + 25 + slot * 20
SLOT_STEP = 20
K_MIN, K_MAX = 40, 200   # bezier handle length = clamp(|dx| / 2, 40, 200)
REROUTE_OCCL_W, REROUTE_OCCL_H = 60, 30      # occlusion box for Reroute nodes
DEFAULT_OCCL_SIZE = (220, 120)               # occlusion box when size is absent
ROW_GAP_MIN = 200        # same-row horizontal est gap
COL_GAP_MIN = 80         # same-column vertical est gap
POS_MIN = 80             # zero-negative-region threshold
RIGHTMOST_SLACK = 50     # output IO x >= max node x - 50
SPACING_EXEMPT_TYPES = ("Reroute", "MarkdownNote")  # spacing-only exemption

CHECK_KEYS = ("crossings", "occlusion", "est_overlap", "est_spacing",
              "negative_region", "output_rightmost", "leftward")


# --- geometry helpers (ported verbatim) -----------------------------------------

def _pos(n: dict) -> tuple[float, float]:
    p = n.get("pos", [0, 0])
    if isinstance(p, dict):                      # rare serialized form
        return float(p.get("0", 0)), float(p.get("1", 0))
    return float(p[0]), float(p[1])


def _iter_links(links):
    """Yield (link_id, origin_id, origin_slot, target_id, target_slot) from either
    the array form [..., type] (top level) or the object form (subgraphs)."""
    for l in links or []:
        if isinstance(l, dict):
            yield int(l["id"]), l.get("origin_id"), l.get("origin_slot", 0), \
                l.get("target_id"), l.get("target_slot", 0)
        else:
            yield int(l[0]), l[1], l[2], l[3], l[4]


def _occl_box(n: dict):
    """Occlusion box: declared size; Reroute is fixed 60x30; default [220,120]."""
    if n.get("type") == "Reroute":
        w, h = REROUTE_OCCL_W, REROUTE_OCCL_H
    else:
        w, h = (n.get("size") or list(DEFAULT_OCCL_SIZE))[:2]
    x, y = _pos(n)
    return x, y, x + float(w), y + float(h)


def _slot_pt(n: dict, slot: int, side: str) -> tuple[float, float]:
    """Wire endpoint: output slot = right edge, input slot = left edge;
    y = top + 25 + slot * 20 (ported slot formula)."""
    x, y, x2, _ = _occl_box(n)
    sy = y + SLOT_DY + (slot or 0) * SLOT_STEP
    return (x2, sy) if side == "out" else (x, sy)


def _bez(p0, p1, p2, p3, t):
    """Cubic bezier point (ported verbatim)."""
    mt = 1 - t
    return (mt ** 3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t ** 3 * p3[0],
            mt ** 3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t ** 3 * p3[1])


def _wire(p0, p3, samples):
    """Bezier polyline with the generator handle math: P1=(P0.x+k,P0.y),
    P2=(P3.x-k,P3.y), k=clamp(|dx|/2, 40, 200); sampled at i/(samples-1)."""
    k = max(K_MIN, min(K_MAX, abs(p3[0] - p0[0]) * 0.5))
    p1, p2 = (p0[0] + k, p0[1]), (p3[0] - k, p3[1])
    return [_bez(p0, p1, p2, p3, i / (samples - 1)) for i in range(samples)]


def _seg_int(a, b, c, d) -> bool:
    """Proper segment intersection via the cross-product same-side test
    (ported verbatim)."""
    def _cr(o, x, y):
        return (y[0] - o[0]) * (x[1] - o[1]) - (y[1] - o[1]) * (x[0] - o[0])
    d1, d2, d3, d4 = _cr(c, d, a), _cr(c, d, b), _cr(a, b, c), _cr(a, b, d)
    return ((d1 > 0) != (d2 > 0)) and ((d3 > 0) != (d4 > 0))


def _est_box(n: dict):
    """Est footprint box from workflow_layout.est_size (mandated single source;
    superset of the generator-side inline est formula)."""
    x, y = _pos(n)
    w, h = est_size(n)
    return x, y, x + float(w), y + float(h)


# --- scope model ----------------------------------------------------------------

def _scopes(wf: dict):
    """(name, nodes, links, subgraph-dict-or-None); main first, then subgraphs in
    file order."""
    yield "main", list(wf.get("nodes") or []), list(_iter_links(wf.get("links"))), None
    for sg in ((wf.get("definitions") or {}).get("subgraphs")) or []:
        name = "sub:%s" % (sg.get("name") if sg.get("name") is not None else sg.get("id", "?"))
        yield name, list(sg.get("nodes") or []), list(_iter_links(sg.get("links"))), sg


def _boundary_io_x(sg, slot: int, side: str):
    """IO-slot pos x for a boundary endpoint (-10 -> inputs, -20 -> outputs);
    None when unknown (link then skipped by the leftward caliber)."""
    if sg is None:
        return None
    ios = sg.get("inputs" if side == "in" else "outputs") or []
    if 0 <= (slot or 0) < len(ios) and ios[slot].get("pos"):
        return float(ios[slot]["pos"][0])
    return None


# --- per-scope checks ------------------------------------------------------------

def check_scope(name, nodes, links, sg, max_crossings=0, allow_leftward=frozenset()):
    """Run all calibers on one scope. Returns {"name", "counts", "violations"}."""
    byid = {n["id"]: n for n in nodes}
    counts = {k: 0 for k in CHECK_KEYS}
    viol = []

    def _v(check, message, **extra):
        entry = {"scope": name, "check": check, "message": message}
        entry.update(extra)
        viol.append(entry)

    # crossings: 24-point polylines, pairwise intersection, each pair max 1;
    # boundary links (endpoint not a node) skipped — ported counting loop.
    wires = []
    for lid, oid, os_, tid, ts_ in links:
        o, t = byid.get(oid), byid.get(tid)
        if not o or not t:
            continue
        wires.append((lid, _wire(_slot_pt(o, os_, "out"), _slot_pt(t, ts_, "in"), CROSS_SAMPLES)))
    pairs = []
    for i in range(len(wires)):
        a = wires[i][1]
        for j in range(i + 1, len(wires)):
            b = wires[j][1]
            hit = False
            for k in range(len(a) - 1):
                for m in range(len(b) - 1):
                    if _seg_int(a[k], a[k + 1], b[m], b[m + 1]):
                        hit = True
                        break
                if hit:
                    break
            if hit:
                pairs.append([wires[i][0], wires[j][0]])
    counts["crossings"] = len(pairs)
    if len(pairs) > max_crossings:
        _v("crossings", "%d crossing pair(s) exceed cap %d (target 0)" % (len(pairs), max_crossings),
           count=len(pairs), cap=max_crossings, pairs=pairs)

    # occlusion: 41 samples, non-endpoint node boxes +/-2, endpoints exempt.
    for lid, oid, os_, tid, ts_ in links:
        o, t = byid.get(oid), byid.get(tid)
        if not o or not t:
            continue
        p0 = _slot_pt(o, os_, "out")
        p3 = _slot_pt(t, ts_, "in")
        hit = set()
        for x, y in _wire(p0, p3, OCCL_SAMPLES):
            for nid, n in byid.items():
                if nid in (oid, tid):
                    continue                        # endpoint exemption
                bx = _occl_box(n)
                if bx[0] - OCCL_TOL <= x <= bx[2] + OCCL_TOL \
                        and bx[1] - OCCL_TOL <= y <= bx[3] + OCCL_TOL:
                    hit.add(nid)
        if hit:
            counts["occlusion"] += 1
            _v("occlusion", "link %d [%s]->[%s] passes through node(s) %s" % (lid, oid, tid, sorted(hit)),
               link=lid, **{"from": oid, "to": tid}, nodes=sorted(hit))

    # est overlap: ALL nodes pairwise, strict-inequality overlap — no exemptions.
    boxes = [(n["id"], _est_box(n)) for n in nodes]
    for i in range(len(boxes)):
        ida, (ax0, ay0, ax1, ay1) = boxes[i]
        for j in range(i + 1, len(boxes)):
            idb, (bx0, by0, bx1, by1) = boxes[j]
            if ax0 < bx1 and bx0 < ax1 and ay0 < by1 and by0 < ay1:
                counts["est_overlap"] += 1
                _v("est_overlap", "node %s and node %s est footprints overlap" % (ida, idb),
                   nodes=[ida, idb])

    # est spacing: only non-exempt nodes; same-row gap >= 200 / same-col >= 80.
    real = [(n["id"], _est_box(n)) for n in nodes if n.get("type") not in SPACING_EXEMPT_TYPES]
    for i in range(len(real)):
        ida, (ax0, ay0, ax1, ay1) = real[i]
        for j in range(i + 1, len(real)):
            idb, (bx0, by0, bx1, by1) = real[j]
            yov = min(ay1, by1) - max(ay0, by0)
            xov = min(ax1, bx1) - max(ax0, bx0)
            if yov > 0 and xov <= 0 and -(xov) < ROW_GAP_MIN:
                counts["est_spacing"] += 1
                _v("est_spacing", "node %s and node %s same-row gap %d < %d" % (ida, idb, -(xov), ROW_GAP_MIN),
                   nodes=[ida, idb], axis="row", gap=round(-(xov)))
            elif xov > 0 and yov <= 0 and -(yov) < COL_GAP_MIN:
                counts["est_spacing"] += 1
                _v("est_spacing", "node %s and node %s same-column gap %d < %d" % (ida, idb, -(yov), COL_GAP_MIN),
                   nodes=[ida, idb], axis="col", gap=round(-(yov)))

    # negative region: every node pos >= 80 (IO slots are not nodes, exempt).
    for n in nodes:
        x, y = _pos(n)
        if x < POS_MIN or y < POS_MIN:
            counts["negative_region"] += 1
            _v("negative_region", "node %s pos [%s, %s] violates pos >= %d" % (n["id"], x, y, POS_MIN),
               node=n["id"], pos=[x, y])

    # output rightmost: subgraph scopes only; skipped when no subgraphs exist.
    if sg is not None and nodes:
        max_nx = max(_pos(n)[0] for n in nodes)
        for idx, io in enumerate(sg.get("outputs") or []):
            p = io.get("pos")
            if not p:
                continue
            if float(p[0]) < max_nx - RIGHTMOST_SLACK:
                counts["output_rightmost"] += 1
                _v("output_rightmost",
                   "output '%s' x=%s < max node x %s - %d" % (io.get("name", idx), p[0], max_nx, RIGHTMOST_SLACK),
                   output=io.get("name", idx), x=float(p[0]), max_node_x=max_nx)

    # leftward: per link, target.x must be > origin.x; boundary endpoints use the
    # IO slot pos; Reroute segments are ordinary links (generator caliber).
    for lid, oid, os_, tid, ts_ in links:
        if oid == BOUNDARY_IN_ID:
            ox = _boundary_io_x(sg, os_, "in")
        else:
            o = byid.get(oid)
            ox = _pos(o)[0] if o else None
        if tid == BOUNDARY_OUT_ID:
            tx = _boundary_io_x(sg, ts_, "out")
        else:
            t = byid.get(tid)
            tx = _pos(t)[0] if t else None
        if ox is None or tx is None:
            continue
        if tx > ox or lid in allow_leftward:
            continue
        counts["leftward"] += 1
        _v("leftward", "link %d [%s]->[%s] flows leftward (target.x <= origin.x)" % (lid, oid, tid),
           link=lid, **{"from": oid, "to": tid})

    return {"name": name, "counts": counts, "violations": viol}


def check_workflow(wf: dict, max_crossings=0, allow_leftward=frozenset()):
    """Check every scope of a GUI-format workflow; returns the scope report list."""
    return [check_scope(name, nodes, links, sg,
                        max_crossings=max_crossings, allow_leftward=allow_leftward)
            for name, nodes, links, sg in _scopes(wf)]


def _final_line(scopes, detailed: bool) -> str:
    """The hard-contract machine line; always compact JSON after the prefix."""
    entries = []
    for s in scopes:
        e = {"name": s["name"], "crossings": s["counts"]["crossings"]}
        if detailed:
            e["counts"] = {k: s["counts"][k] for k in CHECK_KEYS}
        entries.append(e)
    return "LAYOUT_CHECK_JSON: " + json.dumps({"scopes": entries}, separators=(",", ":"))


# --- selftest (synthetic minimal GUI JSON, in-memory) ----------------------------

def _mk_node(nid, pos, size, n_in=0, n_out=0, ntype="TestNode"):
    return {"id": nid, "type": ntype, "pos": list(pos), "size": list(size),
            "inputs": [{"name": "in%d" % i, "type": "*"} for i in range(n_in)],
            "outputs": [{"name": "out%d" % i, "type": "*"} for i in range(n_out)],
            "widgets_values": []}


def _selftest() -> int:
    failures = []

    def expect(cond, label):
        print(("PASS" if cond else "FAIL"), "-", label)
        if not cond:
            failures.append(label)

    def counts_of(report, scope_name):
        s = next(x for x in report if x["name"] == scope_name)
        return s["counts"]

    def all_violations(report):
        return [v for s in report for v in s["violations"]]

    # C1: exactly one crossing pair, nothing else (wires cross at the midpoint).
    c1 = {"nodes": [_mk_node(1, [100, 100], [200, 100], n_out=1),
                    _mk_node(2, [600, 100], [200, 100], n_in=1),
                    _mk_node(3, [100, 400], [200, 100], n_out=1),
                    _mk_node(4, [600, 400], [200, 100], n_in=1)],
          "links": [[1, 1, 0, 4, 0, "*"], [2, 3, 0, 2, 0, "*"]]}
    r = check_workflow(c1)
    c = counts_of(r, "main")
    expect(c["crossings"] == 1, "C1 crossings == 1 (got %d)" % c["crossings"])
    expect(all(c[k] == 0 for k in CHECK_KEYS if k != "crossings"),
           "C1 all other checks clean (got %s)" % c)
    expect(len(all_violations(r)) == 1 and all_violations(r)[0]["check"] == "crossings",
           "C1 exactly one violation, of check 'crossings'")

    # C2: exactly one occluded link (straight wire through a third node box).
    c2 = {"nodes": [_mk_node(1, [100, 100], [200, 100], n_out=1),
                    _mk_node(5, [550, 100], [80, 60]),
                    _mk_node(2, [1000, 100], [200, 100], n_in=1)],
          "links": [[3, 1, 0, 2, 0, "*"]]}
    r = check_workflow(c2)
    c = counts_of(r, "main")
    expect(c["occlusion"] == 1, "C2 occlusion == 1 (got %d)" % c["occlusion"])
    expect(all(c[k] == 0 for k in CHECK_KEYS if k != "occlusion"),
           "C2 all other checks clean (got %s)" % c)

    # C3: single node in the negative region.
    c3 = {"nodes": [_mk_node(9, [40, 100], [200, 100])], "links": []}
    r = check_workflow(c3)
    c = counts_of(r, "main")
    expect(c["negative_region"] == 1, "C3 negative_region == 1 (got %d)" % c["negative_region"])
    expect(all(c[k] == 0 for k in CHECK_KEYS if k != "negative_region"),
           "C3 all other checks clean (got %s)" % c)

    # C4: one leftward link; exempt when allow-listed.
    c4 = {"nodes": [_mk_node(1, [100, 100], [200, 100], n_in=1),
                    _mk_node(2, [600, 100], [200, 100], n_out=1)],
          "links": [[9, 2, 0, 1, 0, "*"]]}
    r = check_workflow(c4)
    c = counts_of(r, "main")
    expect(c["leftward"] == 1, "C4 leftward == 1 (got %d)" % c["leftward"])
    expect(all(c[k] == 0 for k in CHECK_KEYS if k != "leftward"),
           "C4 all other checks clean (got %s)" % c)
    r = check_workflow(c4, allow_leftward=frozenset({9}))
    expect(not all_violations(r), "C4 --allow-leftward 9 clears the report")

    # C5: subgraph scope — boundary link skipped by crossing/occlusion, judged by
    # leftward via the IO slot pos; output IO not pinned rightmost.
    c5 = {"nodes": [], "links": [],
          "definitions": {"subgraphs": [{
              "id": 77, "name": "sg1",
              "nodes": [_mk_node(1, [500, 100], [200, 100], n_out=1)],
              "links": [{"id": 5, "origin_id": 1, "origin_slot": 0,
                         "target_id": -20, "target_slot": 0, "type": "*"}],
              "inputs": [],
              "outputs": [{"name": "OUT", "type": "*", "pos": [400, 100], "linkIds": [5]}]}]}}
    r = check_workflow(c5)
    expect([s["name"] for s in r] == ["main", "sub:sg1"], "C5 scopes == [main, sub:sg1]")
    c = counts_of(r, "sub:sg1")
    expect(c["output_rightmost"] == 1, "C5 sub output_rightmost == 1 (got %d)" % c["output_rightmost"])
    expect(c["leftward"] == 1, "C5 sub boundary leftward == 1 via IO slot pos (got %d)" % c["leftward"])
    expect(c["crossings"] == 0 and c["occlusion"] == 0,
           "C5 boundary link skipped by crossing/occlusion calibers")
    expect(all(counts_of(r, "main")[k] == 0 for k in CHECK_KEYS), "C5 main clean")

    # C6: clean graph — Reroute in the flow (leftward judged per segment, spacing
    # exempt) and a far-right MarkdownNote (spacing exempt).
    c6 = {"nodes": [_mk_node(1, [100, 100], [200, 100], n_out=1),
                    _mk_node(2, [600, 100], [200, 100], n_in=1),
                    _mk_node(3, [100, 400], [200, 100], n_out=1),
                    _mk_node(4, [600, 400], [200, 100], n_in=1),
                    _mk_node(5, [420, 300], [75, 26], n_in=1, n_out=1, ntype="Reroute"),
                    _mk_node(6, [1200, 100], [300, 100], ntype="MarkdownNote")],
          "links": [[1, 1, 0, 5, 0, "*"], [2, 5, 0, 2, 0, "*"], [3, 3, 0, 4, 0, "*"]]}
    r = check_workflow(c6)
    c = counts_of(r, "main")
    expect(all(c[k] == 0 for k in CHECK_KEYS), "C6 clean graph, all checks 0 (got %s)" % c)
    expect(not all_violations(r), "C6 no violations")
    line = _final_line(r, detailed=False)
    expect(line.startswith("LAYOUT_CHECK_JSON: "), "C6 final line prefix")
    payload = json.loads(line.split(":", 1)[1])
    expect(set(payload) == {"scopes"} and payload["scopes"][0]["name"] == "main"
           and payload["scopes"][0]["crossings"] == 0,
           "C6 final line parses, minimal shape {name, crossings}")
    payload2 = json.loads(_final_line(r, detailed=True).split(":", 1)[1])
    expect("counts" in payload2["scopes"][0], "C6 --json detail carries per-check counts")

    # C7: Reroute est overlap is NOT exempt (spacing-only exemption).
    c7 = {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                    _mk_node(2, [300, 110], [75, 26], n_in=1, n_out=1, ntype="Reroute")],
          "links": []}
    r = check_workflow(c7)
    c = counts_of(r, "main")
    expect(c["est_overlap"] == 1, "C7 Reroute est overlap counted (got %d)" % c["est_overlap"])
    expect(c["est_spacing"] == 0, "C7 Reroute spacing exempt")

    print("selftest: %d failure(s)" % len(failures))
    return 1 if failures else 0


# --- CLI --------------------------------------------------------------------------

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        prog="layout_check.py",
        description="Generic GUI-format workflow layout checker (lines-first caliber).")
    ap.add_argument("workflow", nargs="?", help="path to a GUI-format workflow JSON")
    ap.add_argument("--json", action="store_true",
                    help="machine-readable violation list + per-check counts in the final line")
    ap.add_argument("--max-crossings", type=int, default=0, metavar="N",
                    help="per-scope crossing cap (default 0; ratchets live in the generators)")
    ap.add_argument("--allow-leftward", default="", metavar="id1,id2",
                    help="comma-separated link ids exempt from the leftward check")
    ap.add_argument("--selftest", action="store_true", help="run the embedded synthetic self-test")
    args = ap.parse_args(argv)

    if args.selftest:
        return _selftest()
    if not args.workflow:
        print("error: a workflow JSON path is required (or use --selftest)", file=sys.stderr)
        return 2

    try:
        with open(args.workflow, encoding="utf-8") as f:
            wf = json.load(f)
    except (OSError, json.JSONDecodeError) as e:
        print("error: cannot read workflow: %s" % e, file=sys.stderr)
        return 2

    allow = set()
    if args.allow_leftward:
        try:
            allow = {int(p.strip()) for p in args.allow_leftward.split(",") if p.strip()}
        except ValueError:
            print("error: --allow-leftward expects comma-separated integer link ids", file=sys.stderr)
            return 2
    if args.max_crossings < 0:
        print("error: --max-crossings must be >= 0", file=sys.stderr)
        return 2

    try:
        scopes = check_workflow(wf, max_crossings=args.max_crossings, allow_leftward=allow)
    except Exception as e:  # malformed graph must not masquerade as layout violations
        print("error: malformed workflow structure: %s" % e, file=sys.stderr)
        return 2

    all_v = [v for s in scopes for v in s["violations"]]
    if args.json:
        print(json.dumps({"violations": all_v}, ensure_ascii=False, indent=2))
    else:
        for v in all_v:
            print("[%s] %s: %s" % (v["scope"], v["check"], v["message"]))
        if not all_v:
            print("layout clean (%d scope(s), crossings cap %d)" % (len(scopes), args.max_crossings))
    print(_final_line(scopes, detailed=args.json))
    return 1 if all_v else 0


if __name__ == "__main__":
    sys.exit(main())
