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
  group_overlap     group bounding boxes must pairwise not intersect

Optional layout calibers (reported in a per-scope "layout" dict, separate from
counts; computed only when the caller passes layout= / --layout):
  node_out_of_group  a non-Reroute node's visual box intersects a group box
                     without sitting fully inside it (counted once per node)
  edge_tight         a non-Reroute node fully inside a group with any side
                     padding below GROUP_PAD (left 30 / top 50 / right 30 /
                     bottom 30 — the group-box formula's single source)
  spacing_far        same-row / same-column adjacent pair of non-exempt nodes
                     whose visual net gap EXCEEDS the target (equal does not
                     count; targets default FAR_H_DEFAULT 320 / FAR_V_DEFAULT
                     180, overridable via --far-h / --far-v; diagonal far pairs
                     are not counted — the caliber is a lower bound)

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
                          [--layout] [--far-h N] [--far-v N] [--only a,b,c]
  python3 layout_check.py --selftest [CASES]

--only a,b,c is the light mode (machine gate): only the listed existing calibers
are computed. With --layout and/or --only, the final-line scope entries carry
their "counts" (light mode: only the listed keys) and "layout" objects.

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
              "negative_region", "output_rightmost", "leftward", "group_overlap")

# --- optional layout calibers (computed only when the caller passes layout=) -----
# Reported in a per-scope "layout" dict, separate from counts, so existing
# consumers iterating counts see zero behavior change (design §3).
LAYOUT_KEYS = ("node_out_of_group", "edge_tight", "spacing_far")
GROUP_PAD = (30.0, 50.0, 30.0, 30.0)   # left, top, right, bottom — the group-box
                                       # formula's single source (constitution §⑤)
FAR_H_DEFAULT = 320.0                  # same-row spacing-far target (Q4 ruling)
FAR_V_DEFAULT = 180.0                  # same-column spacing-far target (Q4 ruling)


# --- geometry helpers (ported verbatim) -----------------------------------------

def _pos(n: dict) -> tuple[float, float]:
    p = n.get("pos", [0, 0])
    if isinstance(p, dict):                      # rare serialized form
        return float(p.get("0", 0)), float(p.get("1", 0))
    return float(p[0]), float(p[1])


def _size_wh(sz) -> tuple[float, float]:
    """Declared (w, h) as floats. Old frontends (<=1.51.x) serialize some node
    sizes as a string-keyed dict {"0": w, "1": h} (MarkdownNote in community
    files in the wild); anything absent/partial falls back to the default
    occlusion box, mirroring workflow_layout.est_size's tolerance."""
    if isinstance(sz, dict):
        sz = [sz.get("0"), sz.get("1")]
    try:
        return float(sz[0]), float(sz[1])
    except (TypeError, ValueError, IndexError):
        return float(DEFAULT_OCCL_SIZE[0]), float(DEFAULT_OCCL_SIZE[1])


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
        w, h = _size_wh(n.get("size"))
    x, y = _pos(n)
    return x, y, x + w, y + h


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


SEG_EPS = 1e-7  # cross-product sign epsilon: |d| <= eps counts as 0


def _seg_int(a, b, c, d) -> bool:
    """Proper segment intersection via the cross-product same-side test
    (ported verbatim, plus a sign epsilon: each of the four cross products
    passes through sign(); the two sides must have STRICTLY OPPOSITE signs.
    Collinear overlaps / endpoint-tangent pairs — cross product 0 — are not
    crossings, so whole-graph translations no longer flip pairs in and out of
    the count on float noise; the count can only go down)."""
    def _cr(o, x, y):
        return (y[0] - o[0]) * (x[1] - o[1]) - (y[1] - o[1]) * (x[0] - o[0])
    def _sgn(v):
        return 0 if -SEG_EPS <= v <= SEG_EPS else (1 if v > 0 else -1)
    d1, d2, d3, d4 = _sgn(_cr(c, d, a)), _sgn(_cr(c, d, b)), _sgn(_cr(a, b, c)), _sgn(_cr(a, b, d))
    return d1 * d2 < 0 and d3 * d4 < 0


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

def check_scope(name, nodes, links, sg, max_crossings=0, allow_leftward=frozenset(),
                groups=None, layout=None, checks=None):
    """Run the calibers on one scope. Returns {"name", "counts", "violations"};
    with layout= (dict) the report additionally carries a "layout" dict with the
    optional layout calibers (LAYOUT_KEYS). checks= (tuple of CHECK_KEYS names)
    is the light mode: only the listed existing calibers are computed — the rest
    are neither counted nor present in counts (and produce no violations). The
    layout calibers are governed solely by layout=, independently of checks=."""
    byid = {n["id"]: n for n in nodes}
    counts = {k: 0 for k in (CHECK_KEYS if checks is None else tuple(checks))}
    viol = []

    def _v(check, message, **extra):
        entry = {"scope": name, "check": check, "message": message}
        entry.update(extra)
        viol.append(entry)

    # group boxes with a bounding — shared by group_overlap and the optional
    # layout calibers; main-scope groups come from check_workflow, subgraph
    # groups from sg.
    _gs = [g for g in (groups if groups is not None else (sg or {}).get("groups") or [])
           if g.get("bounding")]

    # group_overlap(1007 用户令「组与组之间不能重叠」):任意两组框 bounding
    # 两两零交集;无 bounding 的组跳过;主图组由 check_workflow 传入,子图组取 sg.groups。
    if "group_overlap" in counts:
        for gi in range(len(_gs)):
            for gj in range(gi + 1, len(_gs)):
                a, b = _gs[gi]["bounding"], _gs[gj]["bounding"]
                if len(a) == 4 and len(b) == 4 and \
                   a[0] < b[0] + b[2] and a[0] + a[2] > b[0] and \
                   a[1] < b[1] + b[3] and a[1] + a[3] > b[1]:
                    counts["group_overlap"] += 1
                    _v("group_overlap", "groups overlap: [%s] x [%s]" % (
                        str(_gs[gi].get("title") or "?")[:28],
                        str(_gs[gj].get("title") or "?")[:28]),
                       a=[round(v) for v in a], b=[round(v) for v in b])

    # crossings: 24-point polylines, pairwise intersection, each pair max 1;
    # boundary links (endpoint not a node) skipped — ported counting loop.
    # Speed (count-neutral): a wire polyline's bounding box contains all its
    # segments, so two wires with a positive-gap bbox pair cannot have any
    # intersecting segment pair — skip the O(samples²) segment sweep for them.
    # Touching boxes are still swept (conservative), so the count is identical.
    if "crossings" in counts:
        wires = []
        for lid, oid, os_, tid, ts_ in links:
            o, t = byid.get(oid), byid.get(tid)
            if not o or not t:
                continue
            w = _wire(_slot_pt(o, os_, "out"), _slot_pt(t, ts_, "in"), CROSS_SAMPLES)
            xs = [p[0] for p in w]
            ys = [p[1] for p in w]
            wires.append((lid, w, (min(xs), min(ys), max(xs), max(ys))))
        pairs = []
        for i in range(len(wires)):
            li, a, ab = wires[i]
            for j in range(i + 1, len(wires)):
                lj, b, bb = wires[j]
                if ab[2] < bb[0] or bb[2] < ab[0] or ab[3] < bb[1] or bb[3] < ab[1]:
                    continue                    # positive-gap bboxes: cannot cross
                hit = False
                for k in range(len(a) - 1):
                    for m in range(len(b) - 1):
                        if _seg_int(a[k], a[k + 1], b[m], b[m + 1]):
                            hit = True
                            break
                    if hit:
                        break
                if hit:
                    pairs.append([li, lj])
        counts["crossings"] = len(pairs)
        if len(pairs) > max_crossings:
            _v("crossings", "%d crossing pair(s) exceed cap %d (target 0)" % (len(pairs), max_crossings),
               count=len(pairs), cap=max_crossings, pairs=pairs)

    # occlusion: 41 samples, non-endpoint node boxes +/-2, endpoints exempt.
    # Speed (count-neutral): node occlusion boxes are hoisted out of the sample
    # loop, and a node whose expanded box has a positive-gap bbox against the
    # wire polyline's bbox cannot contain any sample — skipped without the
    # 41-point sweep. Touching boxes are still swept, so the hit set is identical.
    if "occlusion" in counts:
        nboxes = [(nid, _occl_box(n)) for nid, n in byid.items()]
        for lid, oid, os_, tid, ts_ in links:
            o, t = byid.get(oid), byid.get(tid)
            if not o or not t:
                continue
            p0 = _slot_pt(o, os_, "out")
            p3 = _slot_pt(t, ts_, "in")
            w = _wire(p0, p3, OCCL_SAMPLES)
            wx0 = min(p[0] for p in w)
            wx1 = max(p[0] for p in w)
            wy0 = min(p[1] for p in w)
            wy1 = max(p[1] for p in w)
            hit = set()
            for nid, bx in nboxes:
                if nid in (oid, tid):
                    continue                        # endpoint exemption
                if bx[0] - OCCL_TOL > wx1 or wx0 > bx[2] + OCCL_TOL \
                        or bx[1] - OCCL_TOL > wy1 or wy0 > bx[3] + OCCL_TOL:
                    continue                        # wire bbox cannot reach the box
                for x, y in w:
                    if bx[0] - OCCL_TOL <= x <= bx[2] + OCCL_TOL \
                            and bx[1] - OCCL_TOL <= y <= bx[3] + OCCL_TOL:
                        hit.add(nid)
                        break
            if hit:
                counts["occlusion"] += 1
                hit_sorted = sorted(hit, key=str)  # mixed int/str node ids must not crash
                _v("occlusion", "link %d [%s]->[%s] passes through node(s) %s" % (lid, oid, tid, hit_sorted),
                   link=lid, **{"from": oid, "to": tid}, nodes=hit_sorted)

    # est overlap: ALL nodes pairwise, strict-inequality overlap — no exemptions.
    if "est_overlap" in counts:
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
    if "est_spacing" in counts:
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
    if "negative_region" in counts:
        for n in nodes:
            x, y = _pos(n)
            if x < POS_MIN or y < POS_MIN:
                counts["negative_region"] += 1
                _v("negative_region", "node %s pos [%s, %s] violates pos >= %d" % (n["id"], x, y, POS_MIN),
                   node=n["id"], pos=[x, y])

    # output rightmost: subgraph scopes only; skipped when no subgraphs exist.
    if "output_rightmost" in counts and sg is not None and nodes:
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
    if "leftward" in counts:
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

    # optional layout calibers — computed ONLY when the caller passes layout=;
    # reported under a separate per-scope "layout" key so existing consumers
    # iterating counts see zero behavior change (design §3).
    lay = None
    if layout is not None:
        ht = float(layout.get("ht", FAR_H_DEFAULT))
        vt = float(layout.get("vt", FAR_V_DEFAULT))
        lay = {"node_out_of_group": 0, "edge_tight": 0, "spacing_far": 0}
        # node_out_of_group: a non-Reroute node whose visual box (_occl_box:
        # declared size, Reroute fixed 60x30, default [220,120]) intersects a
        # group box without sitting fully inside it — counted once per node
        # however many groups it pokes out of; details list node id + titles.
        gboxes = []
        for g in _gs:
            b = g["bounding"]
            if len(b) == 4:
                gboxes.append((str(g.get("title") or "?")[:28],
                               float(b[0]), float(b[1]),
                               float(b[0]) + float(b[2]), float(b[1]) + float(b[3])))
        for n in nodes:
            if n.get("type") == "Reroute":
                continue
            nx0, ny0, nx1, ny1 = _occl_box(n)
            titles = []
            for title, gx0, gy0, gx1, gy1 in gboxes:
                if nx0 < gx1 and gx0 < nx1 and ny0 < gy1 and gy0 < ny1 and not (
                        nx0 >= gx0 and ny0 >= gy0 and nx1 <= gx1 and ny1 <= gy1):
                    titles.append(title)
            if titles:
                lay["node_out_of_group"] += 1
                _v("node_out_of_group",
                   "node %s intersects group(s) %s without sitting fully inside" % (n["id"], titles),
                   node=n["id"], groups=titles)
        # edge_tight: a non-Reroute node fully inside a group box with any side
        # padding below GROUP_PAD (left 30 / top 50 / right 30 / bottom 30) —
        # counted once per node however many groups it sits in.
        for n in nodes:
            if n.get("type") == "Reroute":
                continue
            nx0, ny0, nx1, ny1 = _occl_box(n)
            titles = []
            for title, gx0, gy0, gx1, gy1 in gboxes:
                if nx0 >= gx0 and ny0 >= gy0 and nx1 <= gx1 and ny1 <= gy1:
                    if (nx0 - gx0 < GROUP_PAD[0] or ny0 - gy0 < GROUP_PAD[1]
                            or gx1 - nx1 < GROUP_PAD[2] or gy1 - ny1 < GROUP_PAD[3]):
                        titles.append(title)
            if titles:
                lay["edge_tight"] += 1
                _v("edge_tight",
                   "node %s sits in group(s) %s with padding below GROUP_PAD %s" % (n["id"], titles, GROUP_PAD),
                   node=n["id"], groups=titles)
        # spacing_far: same-row adjacent pair = vertical projections overlap and
        # B is A's nearest non-exempt node to the right; same-column mirrored for
        # the node below. Visual net gap (visual boxes) above the target counts;
        # equal to the target does not. Diagonal far pairs are not counted — the
        # caliber is a lower bound (design §3). Exemptions mirror est_spacing
        # (SPACING_EXEMPT_TYPES).
        cand = [(n["id"], _occl_box(n)) for n in nodes
                if n.get("type") not in SPACING_EXEMPT_TYPES]
        for aid, (ax0, ay0, ax1, ay1) in cand:
            right = below = None                       # (edge, id) of the nearest
            for bid, (bx0, by0, bx1, by1) in cand:
                if bid == aid:
                    continue
                if min(ay1, by1) - max(ay0, by0) > 0 and bx0 > ax0 \
                        and (right is None or bx0 < right[0]):
                    right = (bx0, bid)
                if min(ax1, bx1) - max(ax0, bx0) > 0 and by0 > ay0 \
                        and (below is None or by0 < below[0]):
                    below = (by0, bid)
            if right is not None and right[0] - ax1 > ht:
                lay["spacing_far"] += 1
                _v("spacing_far",
                   "node %s and its nearest right neighbour %s visual gap %d > target %d"
                   % (aid, right[1], round(right[0] - ax1), round(ht)),
                   nodes=[aid, right[1]], axis="row")
            if below is not None and below[0] - ay1 > vt:
                lay["spacing_far"] += 1
                _v("spacing_far",
                   "node %s and its nearest below neighbour %s visual gap %d > target %d"
                   % (aid, below[1], round(below[0] - ay1), round(vt)),
                   nodes=[aid, below[1]], axis="col")

    report = {"name": name, "counts": counts, "violations": viol}
    if lay is not None:
        report["layout"] = lay
    return report


def check_workflow(wf: dict, max_crossings=0, allow_leftward=frozenset(), layout=None,
                   checks=None):
    """Check every scope of a GUI-format workflow; returns the scope report list.
    layout= (dict, e.g. {"ht": 320, "vt": 180}) enables the optional layout
    calibers (LAYOUT_KEYS) in every scope report; checks= (tuple of CHECK_KEYS
    names) restricts the existing calibers computed (light mode)."""
    return [check_scope(name, nodes, links, sg,
                        max_crossings=max_crossings, allow_leftward=allow_leftward,
                        groups=(wf.get("groups") if sg is None else None),
                        layout=layout, checks=checks)
            for name, nodes, links, sg in _scopes(wf)]


def _final_line(scopes, detailed: bool) -> str:
    """The hard-contract machine line; always compact JSON after the prefix.
    Entries carry a "counts" object when detailed (--json forces it, and so do
    the --layout / --only modes so downstream parsers can see the mode shape)
    and a "layout" object for scopes checked with layout=."""
    entries = []
    for s in scopes:
        e = {"name": s["name"]}
        if "crossings" in s["counts"]:
            e["crossings"] = s["counts"]["crossings"]
        if detailed:
            e["counts"] = {k: s["counts"][k] for k in CHECK_KEYS if k in s["counts"]}
        if "layout" in s:
            e["layout"] = s["layout"]
        entries.append(e)
    return "LAYOUT_CHECK_JSON: " + json.dumps({"scopes": entries}, separators=(",", ":"))


# --- selftest (synthetic minimal GUI JSON, in-memory) ----------------------------

def _mk_node(nid, pos, size, n_in=0, n_out=0, ntype="TestNode"):
    return {"id": nid, "type": ntype, "pos": list(pos), "size": list(size),
            "inputs": [{"name": "in%d" % i, "type": "*"} for i in range(n_in)],
            "outputs": [{"name": "out%d" % i, "type": "*"} for i in range(n_out)],
            "widgets_values": []}


def _selftest(cases=None) -> int:
    """Synthetic self-test. `cases` (comma-separated names, e.g. "C11,C12")
    runs only the listed cases; None runs all."""
    failures = []
    selected = None
    if cases:
        selected = {p.strip().upper() for p in cases.split(",") if p.strip()}

    def expect(cond, label):
        print(("PASS" if cond else "FAIL"), "-", label)
        if not cond:
            failures.append(label)

    def counts_of(report, scope_name):
        s = next(x for x in report if x["name"] == scope_name)
        return s["counts"]

    def layout_of(report, scope_name):
        s = next(x for x in report if x["name"] == scope_name)
        return s["layout"]

    def all_violations(report):
        return [v for s in report for v in s["violations"]]

    def c1():
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

    def c2():
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

    def c3():
        # C3: single node in the negative region.
        c3 = {"nodes": [_mk_node(9, [40, 100], [200, 100])], "links": []}
        r = check_workflow(c3)
        c = counts_of(r, "main")
        expect(c["negative_region"] == 1, "C3 negative_region == 1 (got %d)" % c["negative_region"])
        expect(all(c[k] == 0 for k in CHECK_KEYS if k != "negative_region"),
               "C3 all other checks clean (got %s)" % c)

    def c4():
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

    def c5():
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

    def c6():
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

    def c7():
        # C7: Reroute est overlap is NOT exempt (spacing-only exemption).
        c7 = {"nodes": [_mk_node(1, [100, 100], [200, 100]),
                        _mk_node(2, [300, 110], [75, 26], n_in=1, n_out=1, ntype="Reroute")],
              "links": []}
        r = check_workflow(c7)
        c = counts_of(r, "main")
        expect(c["est_overlap"] == 1, "C7 Reroute est overlap counted (got %d)" % c["est_overlap"])
        expect(c["est_spacing"] == 0, "C7 Reroute spacing exempt")

    def c8():
        # C8: group_overlap — 组框 bounding 相交报 1,分离报 0(1007 用户令:组与组不重叠)。
        c8 = {"nodes": [_mk_node(1, [100, 100], [200, 100])],
              "links": [],
              "groups": [{"title": "A", "bounding": [50, 50, 400, 300]},
                         {"title": "B", "bounding": [300, 200, 400, 300]}]}
        r = check_workflow(c8)
        c = counts_of(r, "main")
        expect(c["group_overlap"] == 1, "C8 overlapping groups == 1 (got %d)" % c["group_overlap"])
        expect(all_violations(r)[0]["check"] == "group_overlap", "C8 violation check name")
        c8["groups"][1]["bounding"] = [600, 50, 400, 300]
        r = check_workflow(c8)
        c = counts_of(r, "main")
        expect(c["group_overlap"] == 0, "C8 separated groups == 0 (got %d)" % c["group_overlap"])

    def c9():
        # C9: old-frontend dict-form size {"0":w,"1":h} must not kill the run and the
        # declared w/h must be honored (community files in the wild, frontend <=1.51.x;
        # this form used to abort the whole file with rc=2).
        box = _occl_box({"id": 9, "type": "MarkdownNote", "pos": [100, 100],
                         "size": {"0": 460, "1": 200}})
        expect(box == (100, 100, 560.0, 300.0),
               "C9 dict-form size honored: box == (100,100,560,300) (got %s)" % (box,))
        box = _occl_box({"id": 10, "type": "Note", "pos": [0, 0]})
        expect(box == (0, 0, 220.0, 120.0), "C9 absent size -> default box (got %s)" % (box,))
        box = _occl_box({"id": 11, "type": "Note", "pos": [0, 0], "size": {"0": 460}})
        expect(box == (0, 0, 220.0, 120.0),
               "C9 partial dict size -> default box (got %s)" % (box,))
        c9 = {"nodes": [dict(_mk_node(9, [100, 100], [200, 100]),
                             type="MarkdownNote", size={"0": 460, "1": 200})],
              "links": []}
        r = check_workflow(c9)
        c = counts_of(r, "main")
        expect(all(c[k] == 0 for k in CHECK_KEYS), "C9 dict-size workflow checks clean (got %s)" % c)

    def c10():
        # C10: crossing count is translation-invariant — shifting the whole graph
        # down by dy = 0..4 px must give the same crossings (colinear / endpoint-
        # tangent wire pairs must not flip in and out of "crossing" on float noise;
        # 1126 实测现状为 [0, 3, 0, 3, 3]).
        base = {"nodes": [_mk_node(1, [0, 1920], [840, 130], n_out=1),
                          _mk_node(2, [850, 1920], [10, 30], n_in=1, n_out=1),
                          _mk_node(3, [2510, 2000], [300, 200], n_in=1, n_out=1),
                          _mk_node(4, [1740, 2460], [300, 200], n_in=1, n_out=1),
                          _mk_node(5, [1740, 4260], [300, 200], n_in=1)],
                "links": [[1, 1, 0, 2, 0, "*"], [2, 1, 0, 3, 0, "*"],
                          [3, 1, 0, 4, 0, "*"], [4, 1, 0, 5, 0, "*"]]}
        vals = []
        for dy in (0, 1, 2, 3, 4):
            wf = {"nodes": [dict(n, pos=[n["pos"][0], n["pos"][1] + dy]) for n in base["nodes"]],
                  "links": [list(l) for l in base["links"]]}
            vals.append(check_workflow(wf)[0]["counts"]["crossings"])
        expect(len(set(vals)) == 1,
               "C10 crossings translation-invariant for dy 0..4 (got %s)" % vals)

    def c11():
        # C11: mixed node-id types (int and str, community files in the wild)
        # must not crash the occlusion caliber with
        # TypeError: '<' not supported between 'str' and 'int'.
        # Note: implement.md 1.3 writes "occlusion == 2" — that 2 is the HIT-NODE
        # count; the occlusion caliber's counting unit is the flagged LINK
        # (design.md §3 freezes existing calibers), so the single link counts 1
        # while its violation lists both hit nodes.
        c11 = {"nodes": [_mk_node(1, [0, 0], [200, 100], n_out=1),
                         _mk_node(3, [300, 0], [200, 100]),
                         _mk_node("a", [600, 0], [200, 100]),
                         _mk_node(2, [900, 0], [200, 100], n_in=1)],
               "links": [[1, 1, 0, 2, 0, "*"]]}
        r = check_workflow(c11)
        c = counts_of(r, "main")
        vs = [v for v in all_violations(r) if v["check"] == "occlusion"]
        expect(c["occlusion"] == 1 and len(vs) == 1 and vs[0]["nodes"] == [3, "a"],
               "C11 mixed-id: 1 link flagged, both hit nodes [3, 'a'] listed "
               "(got count %s, nodes %s)" % (c["occlusion"], vs[0]["nodes"] if vs else None))

    def c12():
        # C12: node pokes out of its group — right edge (580) beyond the group box
        # right (450); the optional caliber node_out_of_group counts the node once.
        c12 = {"nodes": [_mk_node(1, [380, 100], [200, 100])],
               "links": [],
               "groups": [{"title": "G", "bounding": [50, 50, 400, 300]}]}
        r = check_workflow(c12, layout={"ht": 400})
        lay = layout_of(r, "main")
        expect(lay["node_out_of_group"] == 1,
               "C12 node_out_of_group == 1 (got %s)" % lay)

    def c13():
        # C13: node fully inside its group but tighter than GROUP_PAD on one side
        # (left padding 20 < 30) — edge_tight counts it, node_out_of_group stays 0.
        c13 = {"nodes": [_mk_node(1, [70, 100], [200, 100])],
               "links": [],
               "groups": [{"title": "G", "bounding": [50, 50, 400, 300]}]}
        r = check_workflow(c13, layout={"ht": 400})
        lay = layout_of(r, "main")
        expect(lay["edge_tight"] == 1 and lay["node_out_of_group"] == 0,
               "C13 edge_tight == 1, node_out_of_group == 0 (got %s)" % lay)

    def c14():
        # C14: same-row adjacent pair with visual net gap 400 — counted against
        # the ht target only when the gap EXCEEDS it (equal does not count).
        c14 = {"nodes": [_mk_node(1, [100, 100], [200, 100], n_out=1),
                         _mk_node(2, [700, 100], [200, 100], n_in=1)],
               "links": []}
        r = check_workflow(c14, layout={"ht": 320})
        lay = layout_of(r, "main")
        expect(lay["spacing_far"] == 1,
               "C14 spacing_far == 1 at ht=320 (got %s)" % lay)
        r = check_workflow(c14, layout={"ht": 400})
        lay = layout_of(r, "main")
        expect(lay["spacing_far"] == 0,
               "C14 spacing_far == 0 at ht=400 (got %s)" % lay)

    def c15():
        # C15: light mode — checks=(names,) computes only the listed existing
        # calibers (others neither counted nor present in counts), while the
        # three layout keys still compute when layout= is passed; without
        # checks= the counts key set is exactly CHECK_KEYS.
        c15 = {"nodes": [_mk_node(1, [100, 100], [200, 100])],
               "links": [],
               "groups": [{"title": "A", "bounding": [50, 50, 400, 300]},
                          {"title": "B", "bounding": [300, 200, 400, 300]}]}
        r = check_workflow(c15, checks=("group_overlap",))
        c = counts_of(r, "main")
        expect(sorted(c) == ["group_overlap"] and c["group_overlap"] == 1,
               "C15 checks=(group_overlap,) -> counts keys == ['group_overlap'] (got %s)" % sorted(c))
        r = check_workflow(c15, layout={}, checks=("group_overlap",))
        c = counts_of(r, "main")
        expect(sorted(c) == ["group_overlap"] and sorted(layout_of(r, "main")) == sorted(LAYOUT_KEYS),
               "C15 light mode keeps the three layout keys (got counts %s, layout %s)"
               % (sorted(c), sorted(layout_of(r, "main"))))
        r = check_workflow(c15)
        expect(sorted(counts_of(r, "main")) == sorted(CHECK_KEYS),
               "C15 no checks= -> counts keys == CHECK_KEYS")

    for fn in (c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11, c12, c13, c14, c15):
        name = fn.__name__.upper()
        if selected is not None and name not in selected:
            continue
        try:
            fn()
        except Exception as e:  # a crashing case is a failing case, not a crashed run
            print("FAIL - %s (%s: %s)" % (name, type(e).__name__, e))
            failures.append(name)

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
    ap.add_argument("--layout", action="store_true",
                    help="also compute the three optional layout calibers "
                         "(node_out_of_group / edge_tight / spacing_far)")
    ap.add_argument("--far-h", type=float, default=None, metavar="N",
                    help="same-row spacing-far target (default %g)" % FAR_H_DEFAULT)
    ap.add_argument("--far-v", type=float, default=None, metavar="N",
                    help="same-column spacing-far target (default %g)" % FAR_V_DEFAULT)
    ap.add_argument("--only", default="", metavar="a,b,c",
                    help="light mode: comma-separated calibers to compute (subset of: %s)"
                         % ",".join(CHECK_KEYS))
    ap.add_argument("--selftest", nargs="?", const=True, default=None, metavar="CASES",
                    help="run the embedded synthetic self-test; optional comma-separated "
                         "case names (e.g. --selftest C11,C12) run only those cases")
    args = ap.parse_args(argv)

    if args.selftest:
        return _selftest(None if args.selftest is True else args.selftest)
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

    layout = None
    if args.layout:
        layout = {}
        if args.far_h is not None:
            layout["ht"] = args.far_h
        if args.far_v is not None:
            layout["vt"] = args.far_v
    checks = None
    if args.only:
        names = tuple(p.strip() for p in args.only.split(",") if p.strip())
        unknown = [p for p in names if p not in CHECK_KEYS]
        if unknown:
            print("error: --only expects calibers from %s; unknown: %s"
                  % (",".join(CHECK_KEYS), ",".join(unknown)), file=sys.stderr)
            return 2
        checks = names

    try:
        scopes = check_workflow(wf, max_crossings=args.max_crossings, allow_leftward=allow,
                                layout=layout, checks=checks)
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
    print(_final_line(scopes, detailed=bool(args.json or layout is not None or checks is not None)))
    return 1 if all_v else 0


if __name__ == "__main__":
    sys.exit(main())
