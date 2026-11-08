#!/usr/bin/env python3
"""1109 社区-无审查直出-t2i Win 实弹(良性默认提示词,验链路:LoRA/EasyCache/er_sde/二段精炼)。"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/3_社区模板/社区-无审查直出-t2i.json"
PREFIX = "nsfwt2i1109"
DEADLINE_S = 600

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)


def main() -> int:
    override_prompt = sys.argv[1] if len(sys.argv) > 1 else None
    running, pending = ps.queue_load()
    print(f"[preflight] queue running={running} pending={pending}", flush=True)
    if running or pending:
        print("ENGINE_BUSY")
        return 3
    wf = json.loads(WF.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["type"] == "SaveImage" and n.get("widgets_values"):
            n["widgets_values"][0] = f"{PREFIX}/out"
        if override_prompt and n["type"] == "TextEncodeQwenImage21" and n.get("widgets_values"):
            n["widgets_values"][0] = override_prompt
    page, procs = ps.acquire_page()
    t0 = time.monotonic()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
        ps.settle(page, 3000)
        info = page.evaluate("""(() => {
            const g = window.app.graph._nodes;
            const lora = g.find(n => n.type === 'LoraLoaderModelOnly');
            const kss = g.filter(n => n.type === 'KSampler');
            const w = (n, k) => (n && n.widgets.find(x => x.name === k)) || {};
            return {nodes: g.length, lora: lora ? w(lora, 'lora_name').value : null,
                    ks: kss.map(k => [k.id, w(k, 'sampler_name').value, w(k, 'cfg').value,
                                      w(k, 'steps').value, w(k, 'denoise').value])};
        })()""")
        print(f"[loaded] 前端实读: {json.dumps(info, ensure_ascii=False)}", flush=True)
        page.evaluate("(() => window.app.queuePrompt())()")
        pid = ps.find_pid_by_prefix(PREFIX)
        if not pid:
            print('VERDICT {"status":"error","reason":"prompt_id 未发现"}')
            return 1
        print(f"[queued] prompt_id={pid}", flush=True)
        res = ps.wait_history(pid, DEADLINE_S)
        secs = round(time.monotonic() - t0, 1)
        files = ps.download_outputs(res["images"]) if res["status_str"] == "success" else []
        print(f"NSFW_T2I_VERDICT {json.dumps({'status': res['status_str'], 'seconds': secs, 'files': files, 'reason': res.get('reason', '')}, ensure_ascii=False)}")
        return 0 if res["status_str"] == "success" else 1
    finally:
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
