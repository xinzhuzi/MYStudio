#!/usr/bin/env python3
"""1109 t2i-通用 ④PrunaAI 档 2K 默认实弹验证(Mac 侧跑,CDP 复用 posestudio runner)。

判定:引擎 success + 产物 PNG 尺寸 = [4]空潜 1024² ×2 = 2048×2048(2K)。
退出码:0=成功;3=发车前引擎被占;其他=失败(如实报因)。
"""
from __future__ import annotations

import importlib.util
import json
import struct
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/t2i-通用.json"
OUT = REPO / ".zcode/tmp/t2i-2k-1109"
PROMPT = "一只橘猫蜷在洒满阳光的窗台上安睡,窗外有远山,午后暖光斜照"
PREFIX = "t2i2k1109"
DEADLINE_S = 600

spec = importlib.util.spec_from_file_location("ps_runner", RUNNER)
ps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ps)


def png_size(p: Path) -> tuple[int, int]:
    b = p.read_bytes()
    assert b[:8] == b"\x89PNG\r\n\x1a\n", "非 PNG"
    w, h = struct.unpack(">II", b[16:24])
    return w, h


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    running, pending = ps.queue_load()
    print(f"[preflight] queue running={running} pending={pending}", flush=True)
    if running or pending:
        print("ENGINE_BUSY")
        return 3

    wf = json.loads(WF.read_text(encoding="utf-8"))
    # 注入:提示词([401] TE widgets[0])+ 唯一存图前缀(找主图 SaveImage)
    for n in wf["nodes"]:
        if n.get("id") == 401 and n["type"] == "TextEncodeQwenImage21":
            n["widgets_values"][0] = PROMPT
        if n["type"] == "SaveImage" and n.get("widgets_values"):
            n["widgets_values"][0] = f"{PREFIX}/out"
    host7 = next(n for n in wf["nodes"] if n.get("id") == 7)
    print(f"[preflight] 宿主[7] widgets={host7.get('widgets_values')}(应=档4 PrunaAI+seed,σ表已下沉)", flush=True)
    empty4 = next(n for n in wf["nodes"] if n.get("id") == 4)
    print(f"[preflight] [4]空潜 widgets={empty4.get('widgets_values')}(1024²→期望出图 2048²)", flush=True)

    page, procs = ps.acquire_page()
    t0 = time.monotonic()
    try:
        page.goto(ps.ENGINE + "/", timeout=45)
        ps.wait_app(page, 90)
        page.evaluate(ps.js_call("(arg) => window.app.loadGraphData(arg)", wf))
        ps.settle(page, 3000)
        info = page.evaluate("""(() => {
            const g = window.app.graph._nodes;
            const te = g.find(n => n.type === 'TextEncodeQwenImage21');
            const sv = g.find(n => n.type === 'SaveImage');
            const host = g.find(n => n.id === 7);
            const w = (n, k) => (n && n.widgets.find(x => x.name === k)) || {};
            return {nodes: g.length, promptLen: String(w(te, 'prompt').value).length,
                    prefix: sv ? w(sv, 'filename_prefix').value : null,
                    hostMode: host ? w(host, '速度档位').value : null};
        })()""")
        print(f"[loaded] 前端实读: {json.dumps(info, ensure_ascii=False)}", flush=True)
        page.evaluate("(() => window.app.queuePrompt())()")
        pid = ps.find_pid_by_prefix(PREFIX)
        if not pid:
            print(f"VERDICT {{\"status\":\"error\",\"reason\":\"prompt_id 未发现({ps.PID_DISCOVER_S}s)\"}}")
            return 1
        print(f"[queued] prompt_id={pid}", flush=True)
        res = ps.wait_history(pid, DEADLINE_S)
        secs = round(time.monotonic() - t0, 1)
        if res["status_str"] != "success":
            print(f"VERDICT {json.dumps({'status': res['status_str'], 'seconds': secs, 'reason': res.get('reason', '')}, ensure_ascii=False)}")
            return 1
        files = ps.download_outputs(res["images"])
        dims = [png_size(ps.OUT / f) for f in files]
        ok2k = any(w == 2048 and h == 2048 for w, h in dims)
        print(f"T2I2K_VERDICT {json.dumps({'status': 'success', 'seconds': secs, 'files': files, 'dims': dims, 'is2k': ok2k}, ensure_ascii=False)}")
        return 0 if ok2k else 1
    finally:
        try:
            page.evaluate("(() => window.app.queuePrompt !== undefined)()")
        except Exception:
            pass
        for p in procs:
            try:
                p.terminate()
            except Exception:
                pass


if __name__ == "__main__":
    sys.exit(main())
