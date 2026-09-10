#!/usr/bin/env python
"""Generic UI-workflow -> API prompt converter (link-aware widget mapping).
Usage: wf2api.py <workflow.json> <out.json> '<overrides_json>'
Overrides: {"9.image": "x.png", "14.value": "...", ...}"""
import json, sys, urllib.request

wf_path, out_path = sys.argv[1], sys.argv[2]
overrides = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}

wf = json.load(open(wf_path, encoding="utf-8"))
nodes = {n["id"]: n for n in wf["nodes"]}
links = {l[0]: l for l in wf.get("links", [])}  # id -> [id, from, slot, to, toslot, type]

with urllib.request.urlopen("http://127.0.0.1:17598/object_info", timeout=30) as r:
    oi = json.load(r)

def input_order(cls):
    d = oi[cls]["input"]
    return list(d.get("required", {}).keys()) + list(d.get("optional", {}).keys())

prompt = {}
report = []
for nid, n in nodes.items():
    cls = n["type"]
    if cls in ("MarkdownNote", "Note"): continue
    if n.get("mode") == 4 and nid not in (9, 10):  # muted -> skip (但9/10图片节点按需激活)
        report.append(f"skip muted {nid} {cls}")
        continue
    if cls not in oi:
        report.append(f"!! {nid} {cls} NOT IN object_info"); continue
    link_in = {}
    for i in (n.get("inputs") or []):
        lid = i.get("link")
        if lid is None: continue
        if lid not in links: continue
        l = links[lid]
        src = l[1]
        if nodes.get(src, {}).get("mode") == 4 and src not in (9, 10):
            report.append(f"  !! {nid}.{i['name']} fed by muted {src} — 需覆盖")
            continue
        link_in[i["name"]] = [str(src), l[2]]
    widget_names = [x for x in input_order(cls) if x not in {i["name"] for i in (n.get("inputs") or []) if i.get("link") is not None}]
    wn = n.get("widgets_values_named") or {}
    wv = list(n.get("widgets_values") or [])
    inputs = dict(link_in)
    vi = 0
    for name in widget_names:
        if name in wn:
            inputs[name] = wn[name]; continue
        if vi >= len(wv): break
        v = wv[vi]; vi += 1
        if name in ("seed", "noise_seed") and vi < len(wv) and isinstance(wv[vi], str) and wv[vi] in ("fixed","increment","decrement","randomize"):
            vi += 1
        inputs[name] = v
    if vi < len(wv):
        report.append(f"  leftover {nid} {cls}: {wv[vi:]}")
    prompt[str(nid)] = {"class_type": cls, "inputs": inputs}

# 应用覆盖(node.field)
for k, v in overrides.items():
    nid, field = k.split(".", 1)
    prompt[nid]["inputs"][field] = v

json.dump({"prompt": prompt, "client_id": "zcode-asset-pipeline"}, open(out_path, "w"), ensure_ascii=False)
print("\n".join(report))
print(f"nodes in payload: {len(prompt)} -> {out_path}")
