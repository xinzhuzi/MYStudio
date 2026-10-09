#!/usr/bin/env python3
"""三视图 ProjectorScale 剂量扫描(09-20 裁定17:让模型听话的正途=服从度LoRA调教)。

背景:单图直出四轮格数失控(6人);用户裁定弃拼板(太浪费时间),正途=LoRA服从度。
现状 ProjectorScale×0.01 是 09-19「0.01 vs 0」保守值,高剂量从未扫过。
扫描:同 seed=42,三视图裁定15口径,剂量 {0.05, 0.1, 0.25};逐张落盘待视觉清点。
实现:复用 livefire 转换,payload 内联改 [90].weight_projector(按型栈预设的槽权重)。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_nineform_recipe_livefire_0919 as nf  # noqa: E402
from daojie_livefire_0917 import http_json, ui_to_api  # noqa: E402

lf = nf.lf
lf.SKIP_NODES = {20, 61, 88}

DOSES = [0.05, 0.1, 0.25]
ZH = "三视图"
OUT_DIR = Path.home() / "Downloads/daojie_projector_sweep_0920"


def main() -> int:
    import os
    base = os.environ.get("DAOJIE_BASE_URL", nf.probe_base()).rstrip("/")
    print(f"engine={base}", flush=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wf_src = json.loads(nf.WF_DAOJIE.read_text(encoding="utf-8"))
    bases = {e["zh"]: e for e in json.loads(nf.BASES_JSON.read_text(encoding="utf-8"))}
    slots = json.loads(nf.STACK_JSON.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    ov = bases[ZH].get("resolution_override")
    w, h = (int(ov[0]), int(ov[1])) if isinstance(ov, list) and len(ov) == 2 else nf.native_px(bases[ZH]["aspect_ratio"], bases[ZH]["megapixels"])
    want = nf.expected_applied(ZH, slots)

    for dose in DOSES:
        out_png = OUT_DIR / f"sanshitu_proj{dose:g}.png"
        if out_png.is_file() and out_png.stat().st_size > 100_000:
            print(f"[{dose}] 已有,跳过", flush=True)
            continue
        if not nf.wait_idle(base):
            print(f"[{dose}] SKIP 引擎忙", flush=True)
            return 1
        ovr = {"12.seed": nf.SEED, "53.width": w, "53.height": h,
               "50.value": nf.SUBJECTS[ZH], "80.base": ZH}
        graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, ovr)
        graph["80"]["inputs"].pop("negative", None)
        graph["90"]["inputs"]["weight_projector"] = dose  # 剂量内联
        t0 = time.time()
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": nf.CLIENT_ID}, timeout=60)
        if resp.get("node_errors"):
            print(f"[{dose}] node_errors:{json.dumps(resp['node_errors'])[:300]}", flush=True)
            return 1
        entry, wall = nf.wait_done(base, resp["prompt_id"])
        if entry is None or entry.get("status", {}).get("status_str") != "success":
            print(f"[{dose}] 执行失败", flush=True)
            return 1
        final = nf.node_output_text(entry, "62")
        assert final and final.startswith(bases[ZH]["positive"]), f"[{dose}] 正向头校验失败"
        img = nf.first_image(entry)
        assert img, f"[{dose}] 无图"
        import urllib.parse
        import urllib.request
        urllib.request.urlretrieve(
            f"{base}/view?filename={urllib.parse.quote(img['filename'])}&subfolder={urllib.parse.quote(img.get('subfolder',''))}&type={img.get('type','output')}",
            out_png)
        print(f"[{dose}] 完成 wall={wall:.0f}s -> {out_png.name}", flush=True)
    print("扫描完毕,待视觉清点格数", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
