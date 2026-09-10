#!/usr/bin/env python3
"""
find_orphan_nodes.py — detect orphan (dead) nodes in a ComfyUI Web-UI-format workflow.

A node is ORPHAN when nothing it produces ever reaches an output node
(Save/Preview/etc.): tracing backward from every output node through real links
never reaches it. Orphan branches waste queue time (in API export they still
execute) and clutter the canvas.

Special semantics respected (reported as INFO, never auto-pruned):
  - "Note" / "MarkdownNote"          canvas annotations
  - type contains "Everywhere" or starts with "UE"   cg-use-everywhere broadcasts (no wires)
  - type contains "SetNode"/"GetNode"                SetGet-style cross-graph references
Nodes with mode 2/4 (muted/bypassed) are listed separately, never pruned.

Usage:
  python tools/find_orphan_nodes.py workflow.json            # report only
  python tools/find_orphan_nodes.py workflow.json --prune    # also write <name>.cleaned.json
                                                              (original untouched)

Stdlib only. Run against the UI format (what the canvas saves); API-format
graphs have no orphans by construction (everything is wired explicitly).
"""

import argparse
import copy
import json
import re
import sys

# Types that count as graph terminators: their output leaves ComfyUI,
# or they are end-of-chain VIEWERS that intentionally dangle (rgthree Image
# Comparer, easy showAnything, SystemNotification ...).
OUTPUT_TYPE_HINTS = (
    "save", "preview", "output", "combine", "export",
    "comparer", "showanything", "notification", "notify",
)
# Types exempt from orphan judgement entirely.
ANNO_TYPES = {"note", "markdownnote"}
# Types with hidden (wire-less) semantics: they influence the graph without
# wires (UE broadcast, SetGet cross-graph values, rgthree group bypass/mute
# controllers, subgraph instances), so reachability by links cannot judge them.
WIRELESS_HINTS = ("everywhere", "bypasser", "muter", "setnode", "getnode")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def classify(node_type):
    t = (node_type or "").lower()
    if t in ANNO_TYPES:
        return "annotation"
    if UUID_RE.match(t or ""):
        return "wireless"  # subgraph instance node (new frontend format)
    if any(h in t for h in WIRELESS_HINTS):
        return "wireless"
    if any(h in t for h in OUTPUT_TYPE_HINTS):
        return "output"
    return "plain"


def is_output_node(node):
    cls = classify(node.get("type"))
    if cls != "output":
        # No-output-slots means terminal ONLY for plain functional nodes;
        # annotations/wireless injectors can be slotless without being terminators.
        if cls != "plain":
            return False
        return not node.get("outputs")
    return True


def analyze(wf):
    """Return (nodes, link_src) where link_src maps link_id -> source node id."""
    nodes = wf.get("nodes", [])
    links = wf.get("links", []) or []
    link_src = {}
    for entry in links:
        # UI link rows: [link_id, origin_id, origin_slot, target_id, target_slot, type?]
        if isinstance(entry, (list, tuple)) and len(entry) >= 3:
            link_src[int(entry[0])] = int(entry[1])
    return nodes, link_src


def reachable_ids(nodes, link_src):
    # Start points: real terminators plus every wireless node — wireless nodes
    # (UE injectors, SetGet, group controllers, subgraphs) influence the graph
    # without outgoing reachability, and their INPUT wires are meaningful
    # (e.g. a UNETLoader feeding an Anything Everywhere must count as alive).
    seeds = [
        n for n in nodes
        if n.get("mode") not in (2, 4) and
        (is_output_node(n) or classify(n.get("type")) in ("wireless", "setget"))
    ]
    if not any(is_output_node(n) for n in seeds):
        return None, []  # no terminators found; refuse to judge

    seen = set()
    stack = [int(n["id"]) for n in seeds]
    while stack:
        nid = stack.pop()
        if nid in seen:
            continue
        seen.add(nid)
        node = next((n for n in nodes if int(n["id"]) == nid), None)
        if not node:
            continue
        for inp in node.get("inputs") or []:
            lid = inp.get("link")
            if lid is None:
                continue
            src = link_src.get(int(lid))
            if src is not None:
                stack.append(src)
    return seen, [n for n in nodes if n.get("mode") not in (2, 4) and is_output_node(n)]


def report(wf, do_prune, path):
    nodes, link_src = analyze(wf)
    if not nodes:
        print(f"workflow: {path}\nempty graph — nothing to check")
        return 0
    seen, _ = reachable_ids(nodes, link_src)
    if seen is None:
        print("NO OUTPUT NODES FOUND — refusing to judge (wireless/broadcast graph?)")
        return 2
    outputs = [n for n in nodes if n.get("mode") not in (2, 4) and is_output_node(n)]

    orphans, infos, disabled = [], [], []
    for n in nodes:
        nid, ntype = int(n["id"]), n.get("type", "?")
        cls = classify(ntype)
        if n.get("mode") in (2, 4):
            disabled.append(n)
            continue
        if cls == "annotation":
            continue
        if cls in ("wireless", "setget"):
            if nid not in seen:
                infos.append((n, "wireless/setget semantics — not wired, verify by eye"))
            continue
        if nid not in seen:
            orphans.append(n)

    print(f"workflow: {path}")
    print(f"nodes: {len(nodes)} | output terminators: {len(outputs)} | reachable: {len(seen)}")
    if orphans:
        print(f"\nORPHAN nodes ({len(orphans)}) — produce nothing that reaches an output:")
        for n in orphans:
            print(f"  #{n['id']:<5} {n.get('type','?'):<32} {n.get('title') or ''}")
    else:
        print("\nno orphan nodes — every functional node feeds an output")
    for n, why in infos:
        print(f"  INFO #{n['id']:<5} {n.get('type','?'):<32} {why}")
    if disabled:
        print(f"disabled (muted/bypassed, not judged): {', '.join('#'+str(n['id']) for n in disabled)}")

    if do_prune and orphans:
        dead = {int(n["id"]) for n in orphans}
        keep_node_ids = {int(n["id"]) for n in nodes} - dead
        kept_links = [
            e for e in (wf.get("links") or [])
            if int(e[0]) not in link_src or int(e[1]) in keep_node_ids
        ]
        out = copy.deepcopy(wf)
        out["nodes"] = [n for n in nodes if int(n["id"]) in keep_node_ids]
        out["links"] = kept_links
        # Groups/dicts untouched on purpose: they are canvas visuals, deleting risks layout.
        dest = path.rsplit(".json", 1)[0] + ".cleaned.json"
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=2)
        print(f"\npruned {len(orphans)} nodes -> {dest} (original untouched)")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow", help="UI-format workflow .json")
    ap.add_argument("--prune", action="store_true",
                    help="write <name>.cleaned.json without orphan nodes")
    args = ap.parse_args()

    with open(args.workflow, "r", encoding="utf-8") as f:
        wf = json.load(f)
    if "nodes" not in wf or "links" not in wf:
        print("API-format graph detected: every node is wired explicitly — no orphans by construction.")
        return 0
    return report(wf, args.prune, args.workflow)


if __name__ == "__main__":
    sys.exit(main())
