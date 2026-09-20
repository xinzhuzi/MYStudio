#!/usr/bin/env python3
"""服从度叠加实验(裁定22前奏):精准六格锚+seed42,四变体对比.
①proj0.15 ②proj0.2 ③质档(12步cfg5关turbo,负向禁7格通电) ④proj0.1基线."""
import json, sys, os, time
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "apps/build/scripts"))
import daojie_nineform_recipe_livefire_0919 as nf
from daojie_livefire_0917 import http_json, ui_to_api
lf = nf.lf; lf.SKIP_NODES = {20, 61, 88}
BASE = os.environ.get("DAOJIE_BASE_URL", nf.probe_base()).rstrip("/")
ZH, SEED = "三视图", 42
OUT = Path.home()/"Downloads/daojie_obedience_stack"; OUT.mkdir(parents=True, exist_ok=True)
VARIANTS = [
    ("proj015", {"weight_projector": 0.15}, {}),
    ("proj020", {"weight_projector": 0.20}, {}),
    ("quality", {}, {"steps": 12, "cfg": 5.0, "enable_turbo": False}),
    ("base010", {}, {}),
]
wf_src = json.loads(nf.WF_DAOJIE.read_text(encoding="utf-8"))
bases = {e["zh"]: e for e in json.loads(nf.BASES_JSON.read_text(encoding="utf-8"))}
slots = json.loads(nf.STACK_JSON.read_text(encoding="utf-8"))
oi = http_json(f"{BASE}/object_info", timeout=60)
oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
ov = bases[ZH].get("resolution_override"); w,h = (int(ov[0]),int(ov[1]))
import urllib.parse, urllib.request
for name, stack_ov, ks_ov in VARIANTS:
    out_png = OUT/f"sanshitu_{name}.png"
    if out_png.is_file() and out_png.stat().st_size > 100000:
        print(f"[{name}] 已有跳过", flush=True); continue
    if not nf.wait_idle(BASE): print(f"[{name}] 引擎忙"); sys.exit(1)
    ovr = {"12.seed": SEED, "53.width": w, "53.height": h, "50.value": nf.SUBJECTS[ZH], "80.base": ZH}
    graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, ovr)
    graph["80"]["inputs"].pop("negative", None)
    for k,v in stack_ov.items(): graph["90"]["inputs"][k] = v
    for k,v in ks_ov.items():
        if k == "steps": graph["12"]["inputs"]["steps"] = v
        elif k == "cfg": graph["12"]["inputs"]["cfg"] = v
        elif k == "enable_turbo": graph["90"]["inputs"]["enable_turbo"] = v
    t0=time.time()
    resp = http_json(f"{BASE}/prompt", {"prompt": graph, "client_id": nf.CLIENT_ID}, timeout=60)
    if resp.get("node_errors"): print(f"[{name}] node_errors:{json.dumps(resp['node_errors'])[:200]}"); sys.exit(1)
    entry, wall = nf.wait_done(BASE, resp["prompt_id"])
    if entry is None or entry.get("status",{}).get("status_str")!="success": print(f"[{name}] 失败"); continue
    img = nf.first_image(entry); assert img
    urllib.request.urlretrieve(f"{BASE}/view?filename={urllib.parse.quote(img['filename'])}&subfolder={urllib.parse.quote(img.get('subfolder',''))}&type={img.get('type','output')}", out_png)
    print(f"[{name}] 完成 wall={wall:.0f}s steps={graph['12']['inputs']['steps']} cfg={graph['12']['inputs']['cfg']}", flush=True)
print("四变体完毕", flush=True)
