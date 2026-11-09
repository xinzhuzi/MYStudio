#!/usr/bin/env python3
"""1109 无审查三机制各出一发(A/B/C 三臂连发)。

A=①纯参数破限(er_sde/beta/CFG2.5,LoRA 旁路 strength=0)
B=①+②参数+LoRA(femaledVaginus L22-31 @1.0)——与社区-无审查直出-t2i 等效
C=③redqw21 换底(UNET→Qwen2.1_redqw_UNLOCKEDV2_bf16+同 LoRA+同参数)
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/3_社区模板/社区-无审查直出-t2i.json"
OUT = REPO / ".zcode/tmp/posestudio-1108"
PROMPT = ("A hyper-realistic photograph of a young woman (25 years old) with long dark wavy hair, "
          "wearing an elegant one-piece swimsuit, reclining on a sun lounger by a poolside at golden "
          "hour, one knee bent, propped on one elbow looking back over her shoulder, warm sunlight, "
          "wet skin, shallow depth of field")
ARMS = [
    {"tag": "A-param-only", "lora_strength": 0.0, "unet": None},
    {"tag": "B-param+lora", "lora_strength": 1.0, "unet": None},
    {"tag": "C-redqw21",   "lora_strength": 1.0, "unet": "Qwen2.1_redqw_UNLOCKEDV2_bf16.safetensors"},
]

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)


def wait_idle(deadline_s=480):
    t0 = time.time()
    while time.time() - t0 < deadline_s:
        r, p = ps.queue_load()
        if r == 0 and p == 0:
            return True
        time.sleep(20)
    return False


def fire(page, arm):
    wf = json.loads(WF.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["type"] == "SaveImage" and n.get("widgets_values"):
            n["widgets_values"][0] = f"mech3/{arm['tag']}"
        if n["type"] == "TextEncodeQwenImage21" and n.get("widgets_values"):
            n["widgets_values"][0] = PROMPT
        if n["type"] == "LoraLoaderModelOnly" and n.get("widgets_values"):
            n["widgets_values"][1] = arm["lora_strength"]
        if n["type"] == "UNETLoader" and arm["unet"] and n.get("widgets_values"):
            n["widgets_values"][0] = arm["unet"]
    page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
    ps.settle(page, 2500)
    info = page.evaluate(ps.js_call("""(arm) => {
        const g = window.app.graph._nodes;
        const lora = g.find(n => n.type === 'LoraLoaderModelOnly');
        const unet = g.find(n => n.type === 'UNETLoader');
        const w = (n,k) => (n && n.widgets.find(x => x.name === k)) || {};
        return {lora: lora ? w(lora,'lora_name').value : null,
                strength: lora ? w(lora,'strength_model').value : null,
                unet: unet ? w(unet,'unet_name').value : null};
    }""", arm))
    print(f"  [loaded] {json.dumps(info, ensure_ascii=False)}", flush=True)
    page.evaluate("(() => window.app.queuePrompt())()")
    pid = ps.find_pid_by_prefix(f"mech3/{arm['tag']}")
    if not pid:
        return {"tag": arm["tag"], "status": "error", "reason": "pid 未发现"}
    res = ps.wait_history(pid, 420)
    files = []
    if res["status_str"] == "success":
        for img in res["images"]:
            q = urllib.parse.urlencode({"filename": img["filename"],
                                        "subfolder": img.get("subfolder", ""),
                                        "type": img.get("type", "output")})
            b = urllib.request.urlopen(f"{ps.ENGINE}/view?{q}", timeout=60).read()
            fp = OUT / f"mech3_{arm['tag']}_{img['filename']}"
            fp.write_bytes(b)
            files.append(str(fp))
    return {"tag": arm["tag"], "status": res["status_str"], "files": files, "reason": res.get("reason", "")}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    page, procs = ps.acquire_page()
    results = []
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        for arm in ARMS:
            if not wait_idle():
                results.append({"tag": arm["tag"], "status": "busy"})
                continue
            t0 = time.time()
            r = fire(page, arm)
            r["seconds"] = round(time.time() - t0, 1)
            results.append(r)
            print(f"  [{arm['tag']}] {r['status']} {r.get('seconds','?')}s", flush=True)
    finally:
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass
    print("MECH3_VERDICT " + json.dumps(results, ensure_ascii=False))
    return 0 if all(r["status"] == "success" for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
