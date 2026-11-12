#!/usr/bin/env python3
"""h3image_ui_dryrun_1112.py — MiniMax 官方 t2i 件 UI 直跑验证(1112 候打包窗口项收口)。

链路=CDP 驱动 Win 引擎 UI(192.168.0.101:17000):loadGraphData(官方新式子图件)→
画布截图(subgraph 渲染证据)→queuePrompt→history 成功+产物落袋。
唯一注入=CLIPLoader 的 TE 名官方 int8→装机定谳选型 nvfp4_awq(在役件);
其余逐字原样。复用 arekejoker CDP 助手(acquire_page/js_call/wait_history)。
产物/证据=apps/output/h3image-smoke-1112/(ui_canvas.png + ui_run__*.png)。
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/MiniMax/官方-H3图像-文生图.json"
OUT = REPO / "apps/output/h3image-smoke-1112"
TE_OFFICIAL = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
TE_LOCAL = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)


def patch_te(wf: dict) -> tuple[dict, str]:
    """官方 t2i 件 TE 名→装机在役 nvfp4;PE 开关→关(实例层真值优先于子图内层,
    1112 实锤:只改内层不生效,排队仍是旧值;内层出厂本就 false,实例 true=官方演示态)。
    全藏身处一起改:主图实例 node.widgets_values[8]/widgets_values_named+子图内层三处。"""
    prefix = "minimax_h3_image_t2i"
    # 主图实例层(真值层)
    for n in wf.get("nodes", []):
        wv = n.get("widgets_values")
        if isinstance(wv, list) and TE_OFFICIAL in wv:
            wv[wv.index(TE_OFFICIAL)] = TE_LOCAL
            wv[1] = False  # [1]=PE 开关(1112 槽位枚举定谳)
        wn = n.get("widgets_values_named") or {}
        if wn.get("clip_name") == TE_OFFICIAL:
            wn["clip_name"] = TE_LOCAL
        if n["type"] == "SaveImage" and n.get("widgets_values"):
            prefix = n["widgets_values"][0]
    # 子图内层(画布显示一致性)
    for sub in wf.get("definitions", {}).get("subgraphs", []):
        for n in sub.get("nodes", []):
            wv = n.get("widgets_values")
            if isinstance(wv, list) and TE_OFFICIAL in wv:
                wv[wv.index(TE_OFFICIAL)] = TE_LOCAL
            wn = n.get("widgets_values_named") or {}
            if wn.get("clip_name") == TE_OFFICIAL:
                wn["clip_name"] = TE_LOCAL
            props = n.get("properties") or {}
            for m in props.get("models", []) or []:
                if m.get("name") == TE_OFFICIAL:
                    m["name"] = TE_LOCAL
    return wf, prefix


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    r, p = ps.queue_load()
    if r or p:
        print(f"[FAIL] 队列非空 {r}+{p}")
        return 9
    wf, prefix = patch_te(json.loads(WF.read_text(encoding="utf-8")))
    print(f"TE 已改指在役件;SaveImage 前缀={prefix}")

    page, procs = ps.acquire_page()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
        ps.settle(page, 3500)
        # 画布证据:新式子图件在 0.45.2 UI 的渲染态
        page.screenshot(path=OUT / "ui_canvas.png")
        info = page.evaluate(ps.js_call("() => { const g = window.app.graph._nodes; return {nodes: g.length, missing: g.filter(n => String(n.type).includes('Unknown') || n.flags?.missing).length}; }", None))
        print(f"[UI] 画布节点={info.get('nodes')} 疑似缺件节点={info.get('missing')}")
        page.evaluate("(() => window.app.queuePrompt())()")
        pid = ps.find_pid_by_prefix(prefix)
        if not pid:
            print("[FAIL] pid 未发现")
            return 3
        print("prompt_id:", pid)
        res = ps.wait_history(pid, 420)
        print("status:", res.get("status_str"))
        files = []
        if res.get("status_str") == "success":
            for img in res.get("images", []):
                q = urllib.parse.urlencode({"filename": img["filename"],
                                            "subfolder": img.get("subfolder", ""),
                                            "type": img.get("type", "output")})
                b = urllib.request.urlopen(f"{ps.ENGINE}/view?{q}", timeout=60).read()
                fp = OUT / f"ui_run__{img['filename']}"
                fp.write_bytes(b)
                files.append(fp.name)
        print("UI_DRYRUN " + ("PASS " + str(files) if files else "FAIL " + str(res.get("reason", ""))[:300]))
        return 0 if files else 1
    finally:
        for pr in procs:
            try:
                pr.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
