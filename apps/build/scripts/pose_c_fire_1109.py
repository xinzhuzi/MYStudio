#!/usr/bin/env python3
"""1109 姿势复现 C 臂(根因验证):D 臂:拔 lighting_prompt(Fisher 四件套锚句)→TE.prompt 线,
官方路线③指令经 widget 真正进模型;LoRA=V1.1。成功=叉腰姿势出现。"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/4_姿势编辑/社区-VNCCS姿势-PoseStudio.json"
POSE = "Standing One Hand on Hip 2"
CHAR = "daojie_nvxiu_mounted_1108.png"
INSTR = ("replace the pose of <image 2> with the pose of <image 1>. "
         "Use the exact colors, costume, hairstyle and materials of the person in image2. "
         "image1 is a gray mannequin for pose only — ignore its gray color and material everywhere.")
SEED = 488345170733023

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
                          CHAR, "posef1109/out", INSTR)
    # 根因手术:D 臂:拔 lighting_prompt(Fisher 四件套锚句)→TE.prompt 线(widget 注入方能生效)
    dead = set()
    for n in wf["nodes"]:
        if n["type"] == "TextEncodeQwenImage21":
            for i in n.get("inputs", []):
                if i.get("name") == "prompt" and i.get("link") is not None:
                    dead.add(i["link"])
                    i["link"] = None
        if n["type"] == "UNETLoader":
            n["widgets_values"][0] = "qwen_image_2.1_bf16.safetensors"
        if n["type"] == "CLIPLoader":
            n["widgets_values"][0] = "qwen3vl_8b_bf16_heretic.safetensors"
        if n["type"] == "LoraLoaderModelOnly":
            n["widgets_values"][0] = "VNCCS_QI2_PoseStudioV1.1.safetensors"
            if isinstance(n.get("widgets_values_named"), dict):
                n["widgets_values_named"]["lora_name"] = "VNCCS_QI2_PoseStudioV1.1.safetensors"
        if n["type"] == "KSampler":
            n["widgets_values"][0] = SEED
    # F 臂核心手术:KSampler.latent 改接 TE latent 槽2(编辑画布=角色图)
    te = next(n for n in wf["nodes"] if n["type"] == "TextEncodeQwenImage21")
    ks = next(n for n in wf["nodes"] if n["type"] == "KSampler")
    old_li = next(i["link"] for i in ks["inputs"] if i["name"] == "latent_image")
    old = next(l for l in wf["links"] if l[0] == old_li)
    src479 = next((n for n in wf["nodes"] if n["id"] == old[1]), None)
    if src479 and old[0] in (src479.get("outputs") or [{}])[0].get("links", []):
        src479["outputs"][0]["links"].remove(old[0])
    wf["links"] = [l for l in wf["links"] if l[0] != old[0]]
    nid = max(l[0] for l in wf["links"]) + 1
    wf["links"].append([nid, te["id"], 2, ks["id"],
                        next(i2 for i2, x in enumerate(ks["inputs"]) if x["name"] == "latent_image"), "LATENT"])
    next(i for i in ks["inputs"] if i["name"] == "latent_image")["link"] = nid
    te.setdefault("outputs", [{}])[2].setdefault("links", []).append(nid)
    before = len(wf["links"])
    wf["links"] = [l for l in wf["links"] if l[0] not in dead]
    print(f"[手术] 拔线 {sorted(dead)}({before}→{len(wf['links'])} 链),LoRA=V1.1,指令=官方路线③", flush=True)
    page, procs = ps.acquire_page()
    t0 = time.monotonic()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
        ps.settle(page, 2500)
        page.evaluate("(() => window.app.queuePrompt())()")
        pid = ps.find_pid_by_prefix("posec1109")
        if not pid:
            print('POSE_F_VERDICT {"status":"error","reason":"prompt_id 未发现"}')
            return 1
        res = ps.wait_history(pid, 420)
        secs = round(time.monotonic() - t0, 1)
        files = ps.download_outputs(res["images"]) if res["status_str"] == "success" else []
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
