#!/usr/bin/env python3
"""1109 F 臂(重写版):latent→TE槽2 编辑画布 + bf16/heretic + 四件套 + V1.1。
修前作 sed 链三坑:find_pid 前缀恒错/装后无探针/下载取错图。装后探针验线不过即中止。"""
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
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/4_姿势编辑/社区-VNCCS姿势-PoseStudio.json"
OUT = REPO / ".zcode/tmp/posestudio-1108"
PREFIX = "posef1109"
POSE = "Standing One Hand on Hip 2"
CHAR = "daojie_nvxiu_mounted_1108.png"
INSTR = ("replace the pose of <image 2> with the pose of <image 1>. "
         "Use the exact colors, costume, hairstyle and materials of the person in image2. "
         "image1 is a gray mannequin for pose only — ignore its gray color and material everywhere.")
SEED = 488345170723023  # 换 seed 避开一切缓存

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)
ps.WF_FILE = WF


def main() -> int:
    for _ in range(24):
        r, p = ps.queue_load()
        if r == 0 and p == 0:
            break
        time.sleep(20)
    else:
        print("POSE_F_VERDICT {\"status\":\"busy\"}")
        return 3
    wf = ps.prep_workflow(ps.resolve_pose(POSE).read_text(encoding="utf-8"),
                          CHAR, f"{PREFIX}/out", INSTR)
    te = next(n for n in wf["nodes"] if n["type"] == "TextEncodeQwenImage21")
    ks = next(n for n in wf["nodes"] if n["type"] == "KSampler")
    # 手术①:拔 lighting_prompt→TE.prompt
    dead = set()
    for i in te.get("inputs", []):
        if i.get("name") == "prompt" and i.get("link") is not None:
            dead.add(i["link"]); i["link"] = None
    wf["links"] = [l for l in wf["links"] if l[0] not in dead]
    # 手术②:KSampler.latent ← TE latent 槽2(编辑画布)
    ks_li = next(i for i in ks["inputs"] if i["name"] == "latent_image")
    old = next((l for l in wf["links"] if l[0] == ks_li.get("link")), None)
    if old:
        src = next((n for n in wf["nodes"] if n["id"] == old[1]), None)
        outs0 = (src or {}).get("outputs") or [{}]
        if old[0] in (outs0[0].get("links") or []):
            outs0[0]["links"].remove(old[0])
        wf["links"] = [l for l in wf["links"] if l[0] != old[0]]
    nid = max(l[0] for l in wf["links"]) + 1
    te_slot2 = next(idx for idx, o in enumerate(te["outputs"]) if o.get("name") == "latent")
    wf["links"].append([nid, te["id"], te_slot2, ks["id"],
                        next(idx for idx, x in enumerate(ks["inputs"]) if x["name"] == "latent_image"),
                        "LATENT"])
    ks_li["link"] = nid
    te["outputs"][te_slot2].setdefault("links", []).append(nid)
    # 手术③:bf16+heretic 装载器;LoRA V1.1;seed
    for n in wf["nodes"]:
        if n["type"] == "UNETLoader":
            n["widgets_values"][0] = "qwen_image_2.1_bf16.safetensors"
        elif n["type"] == "CLIPLoader":
            n["widgets_values"][0] = "qwen3vl_8b_bf16_heretic.safetensors"
        elif n["type"] == "LoraLoaderModelOnly":
            n["widgets_values"][0] = "VNCCS_QI2_PoseStudioV1.1.safetensors"
        elif n["type"] == "KSampler":
            n["widgets_values"][0] = SEED
    page, procs = ps.acquire_page()
    t0 = time.monotonic()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
        ps.settle(page, 2500)
        probe = page.evaluate(ps.js_call("""(wantTe) => {
            const g = window.app.graph;
            const ks = g._nodes.find(n => n.type === 'KSampler');
            const te = g._nodes.find(n => n.type === 'TextEncodeQwenImage21');
            const li = ks.inputs.find(i => i.name === 'latent_image');
            const org = li && li.link != null && g.links.get(li.link);
            return {latentFrom: org ? org.origin_id : null, wantTe,
                    teId: te.id, promptLinked: (te.inputs.find(i=>i.name==='prompt')||{}).link != null,
                    lora: (g._nodes.find(n=>n.type==='LoraLoaderModelOnly').widgets.find(w=>w.name==='lora_name')||{}).value};
        }""", te["id"]))
        print(f"[装后探针] {json.dumps(probe, ensure_ascii=False)}", flush=True)
        if probe.get("latentFrom") != probe.get("teId") or probe.get("promptLinked"):
            print('POSE_F_VERDICT {"status":"error","reason":"装后验线不过,中止不发"}')
            return 1
        page.evaluate("(() => window.app.queuePrompt())()")
        pid = ps.find_pid_by_prefix(PREFIX)
        if not pid:
            print('POSE_F_VERDICT {"status":"error","reason":"prompt_id 未发现(排队被拒?)"}')
            return 1
        res = ps.wait_history(pid, 420)
        secs = round(time.monotonic() - t0, 1)
        files = []
        if res["status_str"] == "success":
            for img in res["images"]:
                q = urllib.parse.urlencode({"filename": img["filename"],
                                            "subfolder": img.get("subfolder", ""),
                                            "type": img.get("type", "output")})
                b = urllib.request.urlopen(f"{ps.ENGINE}/view?{q}", timeout=60).read()
                fp = OUT / f"F2_{img['filename']}"
                fp.write_bytes(b)
                files.append(str(fp))
        print(f"POSE_F_VERDICT {json.dumps({'status': res['status_str'], 'seconds': secs, 'files': files, 'reason': res.get('reason', '')}, ensure_ascii=False)}")
        return 0 if res["status_str"] == "success" else 1
    finally:
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
