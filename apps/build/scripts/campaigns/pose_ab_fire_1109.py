#!/usr/bin/env python3
"""1109 姿势复现 A/B 定谳:官方路线③指令提示词 × LoRA V1/V1.1 双臂。

判据:目检员逐部位对照人偶叉腰姿势;脚本层只报执行事实+落图。
A 臂=V1(件内现值);B 臂=V1.1(Fisher 产线立威件)。同一角色图同一姿势同一 seed。
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/4_姿势编辑/社区-VNCCS姿势-PoseStudio.json"
OUT = REPO / ".zcode/tmp/pose-ab-1109"
POSE = "Standing One Hand on Hip 2"
CHAR = "daojie_nvxiu_mounted_1108.png"
INSTR = "replace the pose of <image 2> with the pose of <image 1>. keep the character of <image 2>"
SEED = 488345170733023

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)
ps.WF_FILE = WF  # runner 内建路径已旧(归位前名),指到现址


def wait_idle(deadline_s: float = 480) -> bool:
    t0 = time.time()
    while time.time() - t0 < deadline_s:
        r, p = ps.queue_load()
        if r == 0 and p == 0:
            return True
        time.sleep(20)
    return False


def arm(page, tag: str, lora: str) -> dict:
    wf = ps.prep_workflow(ps.resolve_pose(POSE).read_text(encoding="utf-8"), CHAR, f"poseab1109/{tag}", INSTR)
    for n in wf["nodes"]:
        if n["type"] == "LoraLoaderModelOnly":
            n["widgets_values"][0] = lora
            if isinstance(n.get("widgets_values_named"), dict):
                n["widgets_values_named"]["lora_name"] = lora
        if n["type"] == "KSampler":
            n["widgets_values"][0] = SEED
    page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
    ps.settle(page, 2500)
    api = page.evaluate("(() => JSON.stringify(window.app.graphToPrompt()))()")
    (OUT / f"{tag}_api.json").write_text(api, encoding="utf-8")
    page.evaluate("(() => window.app.queuePrompt())()")
    pid = ps.find_pid_by_prefix(f"poseab1109/{tag}")
    if not pid:
        return {"tag": tag, "status": "error", "reason": "prompt_id 未发现"}
    res = ps.wait_history(pid, 420)
    files = ps.download_outputs(res["images"]) if res["status_str"] == "success" else []
    return {"tag": tag, "lora": lora, "status": res["status_str"], "files": files,
            "reason": res.get("reason", "")}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if not wait_idle():
        print("POSE_AB_VERDICT {\"status\":\"busy\"}")
        return 3
    page, procs = ps.acquire_page()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        results = [arm(page, "A-v1", "VNCCS_QI2_PoseStudioV1.safetensors"),
                   arm(page, "B-v11", "VNCCS_QI2_PoseStudioV1.1.safetensors")]
        print("POSE_AB_VERDICT " + json.dumps(results, ensure_ascii=False))
        return 0 if all(r["status"] == "success" for r in results) else 1
    finally:
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
