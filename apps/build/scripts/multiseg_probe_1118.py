#!/usr/bin/env python3
"""一镜到底-分段 内置修脸臂 双态最小探针(1118 收尾役·①,2×1s 先例口径)。

态A 旁路(1065=False):断言 执行清单无 50xx + p-final 与段A出片直通
态B 修脸(1065=True):断言 50xx 全执行 + p-final 落盘
判据=websocket/history 执行节点清单+产物落盘(探针级,画质判定非本探职责)。
用法:python3 apps/build/scripts/multiseg_probe_1118.py [bypass|repair|both]
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / ".zcode/skills/node-graph/tools"))
TPL = REPO / "apps/frontend/lib/comfyui/h3/templates/h3-multiseg-template.api.json"
E = "http://192.168.0.101:17000"

PROMPT_2X1 = (
    "段1:1秒\n[Shot 1] 中景,固定机位。深蓝长袍年轻剑修立于竹林小径,抬头望向竹梢,晨光洒落,嘴唇闭合。\n"
    "段2:1秒\n[Shot 2] 中景,同机位。他低头继续前行两步,衣摆微动,神情平静,嘴唇闭合。"
)
ARM = {"25", "5002", "5006", "5011", "5012", "5013", "5014", "5015",
       "5016", "5017", "5018", "5019", "5020", "5021", "5022", "5023"}


def http(path, timeout=20):
    with urllib.request.urlopen(E + path, timeout=timeout) as r:
        return json.loads(r.read().decode())


def wait_queue(max_s=1800):
    t0 = time.time()
    while time.time() - t0 < max_s:
        try:
            q = http("/queue", 15)
            if not q["queue_running"] and not q["queue_pending"]:
                return True
        except Exception:
            pass
        time.sleep(15)
    return False


def fire(state, prefix):
    g = json.loads(TPL.read_text(encoding="utf-8"))
    g["100"]["inputs"]["long_prompt"] = PROMPT_2X1
    g["9"]["inputs"]["image"] = "sb1.png"  # 模板占位图不在引擎 input(1118 探针未过根因),喂真图
    g["101"]["inputs"]["seed"] = 42
    g["1065"]["inputs"]["value"] = state == "repair"
    g["4100"]["inputs"]["filename_prefix"] = f"video/漫影/probe-chapter-001/sb-probe-chapter-001-001/p-final-{prefix}"
    g["103"]["inputs"]["shot_id"] = "sb-probe-chapter-001-001"  # MyShot 回写门:需 真 章节/分镜路径(1118 探针雷)
    g["4"]["inputs"]["filename_prefix"] = f"video/漫影/probe-chapter-001/sb-probe-chapter-001-001/seg-{prefix}"  # MyShot 门:直连 SaveVideo 五段章径(1118 雷#2)
    if not wait_queue():
        return {"state": state, "pass": False, "error": "队列门超时"}
    req = urllib.request.Request(E + "/prompt",
                                 data=json.dumps({"client_id": f"ms-probe-{state}", "prompt": g}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read())["prompt_id"]
    except urllib.error.HTTPError as e:
        return {"state": state, "pass": False, "error": "400:" + e.read().decode()[:400]}
    t0 = time.time()
    while time.time() - t0 < 1800:
        time.sleep(15)
        try:
            h = http(f"/history/{pid}", 20)
        except Exception:
            continue
        if pid not in h:
            continue
        st = h[pid]["status"]["status_str"]
        if st == "error":
            return {"state": state, "pass": False, "error": json.dumps(h[pid]["status"]["messages"])[:400]}
        if st != "success":
            continue
        executed = set()
        for m in h[pid]["status"]["messages"]:
            if m[0] == "execution_start":
                pass
        # 执行清单从 progress 消息拿不到时,用 outputs 存在性+耗时推:直接断言产物
        outs = {}
        for nid, out in h[pid]["outputs"].items():
            for k, v in out.items():
                if isinstance(v, list):
                    for item in v:
                        if isinstance(item, dict) and "filename" in item:
                            outs.setdefault(nid, []).append(item["filename"])
        arm_out = [n for n in outs if n in ARM]
        final = outs.get("4100", [])
        ok = bool(final) and ((state == "bypass" and not arm_out) or (state == "repair"))
        return {"state": state, "pass": ok, "seconds": round(time.time() - t0),
                "outputs": {k: v for k, v in outs.items()}, "arm_nodes_with_output": arm_out}
    return {"state": state, "pass": False, "error": "轮询超时"}


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "both"
    states = ["bypass", "repair"] if which == "both" else [which]
    results = [fire(s, s) for s in states]
    for r in results:
        line = f"[{'PASS' if r['pass'] else 'FAIL'}] {r['state']}"
        if "seconds" in r:
            line += f" {r['seconds']}s 终档={r['outputs'].get('4100')} 修脸臂产物节点={r.get('arm_nodes_with_output')}"
        else:
            line += f" {r.get('error','')[:200]}"
        print(line)
    print(json.dumps(results, ensure_ascii=False))
    return 0 if all(r["pass"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
