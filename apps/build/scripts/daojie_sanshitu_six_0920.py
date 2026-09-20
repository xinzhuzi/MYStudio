#!/usr/bin/env python3
"""六形态定界出图循环(裁定21):种子递进,像素带检测恰6格即停。"""
import json, sys, time, subprocess
from pathlib import Path
REPO = Path(__file__).resolve().parents[3] if "__file__" in dir() else Path(".")
sys.path.insert(0, str(REPO / "apps/build/scripts"))
import daojie_nineform_recipe_livefire_0919 as nf
from daojie_livefire_0917 import http_json, ui_to_api
from PIL import Image
lf = nf.lf; lf.SKIP_NODES = {20, 61, 88}
import os
BASE = os.environ.get("DAOJIE_BASE_URL", nf.probe_base()).rstrip("/")
ZH = "三视图"

def panel_count(png_path):
    img = Image.open(png_path).convert("L"); w,h = img.size; px = img.load()
    col_min = [min(px[x,y] for y in range(0,h,4)) for x in range(w)]
    TH = 235; bands, in_b, s = [], False, 0
    for x,v in enumerate(col_min):
        if v < TH and not in_b: in_b, s = True, x
        elif v >= TH and in_b:
            in_b = False
            if x-s > 30: bands.append(1)
    if in_b: bands.append(1)
    return len(bands)

wf_src = json.loads(nf.WF_DAOJIE.read_text(encoding="utf-8"))
bases = {e["zh"]: e for e in json.loads(nf.BASES_JSON.read_text(encoding="utf-8"))}
slots = json.loads(nf.STACK_JSON.read_text(encoding="utf-8"))
oi = http_json(f"{BASE}/object_info", timeout=60)
oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
ov = bases[ZH].get("resolution_override"); w,h = (int(ov[0]),int(ov[1])) if isinstance(ov,list) else nf.native_px(bases[ZH]["aspect_ratio"], bases[ZH]["megapixels"])
want = nf.expected_applied(ZH, slots); head = bases[ZH]["positive"]
import urllib.parse, urllib.request
for seed in [42, 44, 45, 46, 47]:
    out_png = Path.home()/f"Downloads/daojie_six_loop/sanshitu_s{seed}.png"
    out_png.parent.mkdir(parents=True, exist_ok=True)
    if not (out_png.is_file() and out_png.stat().st_size > 100_000):
        if not nf.wait_idle(BASE): print(f"[s{seed}] 引擎忙"); sys.exit(1)
        ovr = {"12.seed": seed, "53.width": w, "53.height": h, "50.value": nf.SUBJECTS[ZH], "80.base": ZH}
        graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, ovr)
        graph["80"]["inputs"].pop("negative", None)
        resp = http_json(f"{BASE}/prompt", {"prompt": graph, "client_id": nf.CLIENT_ID}, timeout=60)
        if resp.get("node_errors"): print(f"[s{seed}] node_errors"); sys.exit(1)
        entry, wall = nf.wait_done(BASE, resp["prompt_id"])
        if entry is None or entry.get("status",{}).get("status_str") != "success": print(f"[s{seed}] 失败"); continue
        final = nf.node_output_text(entry, "62")
        assert final and final.startswith(head), f"[s{seed}] 正向头校验失败"
        img = nf.first_image(entry); assert img
        urllib.request.urlretrieve(f"{BASE}/view?filename={urllib.parse.quote(img['filename'])}&subfolder={urllib.parse.quote(img.get('subfolder',''))}&type={img.get('type','output')}", out_png)
        print(f"[s{seed}] 完成 wall={wall:.0f}s", flush=True)
    n = panel_count(out_png)
    print(f"[s{seed}] 像素检测: {n} 格", flush=True)
    if n == 6:
        print(f"WINNER seed={seed} 恰六格", flush=True)
        subprocess.run(["cp", str(out_png), str(Path.home()/"Downloads/daojie_nineform_recipe_0919/三视图.png")])
        sys.exit(0)
print("五种子无一恰六格", flush=True)
sys.exit(2)
