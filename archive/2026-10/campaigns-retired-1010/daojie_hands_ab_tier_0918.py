#!/usr/bin/env python3
"""道劫手部 A/B:速度档(4步/cfg1+蒸馏) vs 质量档(12步/cfg5 无蒸馏)。

同主体句(露手最难姿势)同种子,只变档位,回答「是不是 4 步 turbo 导致手崩」。
模型链一律收敛为 21→[47]→67→12(A)/21→67→12(B):画风件 68/69/70/73 与
破限件 19/44/45/46 全部置为孤岛(API 图保留但输出不可达=不执行)。
产物:output/daojie_hands_ab_speed.png 与 output/daojie_hands_ab_quality.png
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_handsfix_run_0917 import BASE, CLIENT, http_json, ui_to_api  # noqa: E402

REPO = Path.home() / "Project/Github/MYStudio"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
SEED = 20250915
SUBJECT = ("一位青年女修士，金丹期，气质清冷出尘，肤色温润透亮，五官清隽；"
           "墨黑长发垂落腰际，发丝逐层分明；身着素色道袍长裙，米白纯色，素布质感，衣纹线条流畅；"
           "立于画面中部，面朝前方，双手交拢于身前，十指自然收拢清晰可见，神色沉静；"
           "背景淡墨云雾，大面积留白。")
VARIANTS = {
    "speed":   {"steps": 4, "cfg": 1.0, "use_distill": True,  "out": "output/daojie_hands_ab_speed.png"},
    "quality": {"steps": 12, "cfg": 5.0, "use_distill": False, "out": "output/daojie_hands_ab_quality.png"},
}
ORPHAN_LORAS = {"19", "44", "45", "46", "68", "69", "70", "73", "74", "75", "76", "77", "78", "79"}


def build_api(variant: dict) -> dict:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["id"] == 50:
            n["widgets_values"] = [SUBJECT]
            n["widgets_values_named"]["value"] = SUBJECT
        if n["id"] == 20:
            n["widgets_values"] = [SEED, "", "", "okay"]
            n["widgets_values_named"]["seed"] = SEED
        if n["id"] == 12:
            n["widgets_values"] = [SEED, "fixed", variant["steps"], variant["cfg"], "euler", "simple", 1]
            n["widgets_values_named"].update({"seed": SEED, "control_after_generate": "fixed",
                                              "steps": variant["steps"], "cfg": variant["cfg"]})
    api = ui_to_api(wf, http_json(f"{BASE}/object_info"))
    # 模型链收敛:孤岛化一切非功能 LoRA;速度档 21→47→67→12,质量档 21→67→12
    for nid in ORPHAN_LORAS:
        api.get(nid, {}).get("inputs", {}).pop("model", None)
    api["67"]["inputs"]["model"] = ["47", 0] if variant["use_distill"] else ["21", 0]
    api["47"]["inputs"]["model"] = ["21", 0]
    api["12"]["inputs"]["model"] = ["67", 0]
    return api


def run_variant(name: str, variant: dict) -> int:
    api = build_api(variant)
    # 队列礼让
    t0 = time.time()
    while time.time() - t0 < 600:
        q = http_json(f"{BASE}/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            break
        time.sleep(5)
    pid = http_json(f"{BASE}/prompt", {"prompt": api, "client_id": CLIENT})["prompt_id"]
    print(f"[{name}] 提交 {name} prompt_id={pid} steps={variant['steps']} cfg={variant['cfg']} 蒸馏={variant['use_distill']}", flush=True)
    t0 = time.time()
    while time.time() - t0 < 1500:
        time.sleep(8)
        h = http_json(f"{BASE}/history/{pid}")
        if pid not in h:
            continue
        e = h[pid]
        if e.get("status", {}).get("status_str") == "error":
            print(f"[{name}] 引擎错误:", json.dumps(e["status"], ensure_ascii=False)[:600], flush=True)
            return 1
        for node_out in (e.get("outputs") or {}).values():
            for im in node_out.get("images", []) or []:
                if im.get("type") == "output":
                    q = urllib.parse.urlencode({"filename": im["filename"], "subfolder": im.get("subfolder", ""), "type": "output"})
                    data = urllib.request.urlopen(urllib.request.Request(f"{BASE}/view?{q}"), timeout=60).read()
                    dest = REPO / variant["out"]
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(data)
                    print(json.dumps({"variant": name, "status": "ok", "engine": im["filename"], "dest": str(dest),
                                      "bytes": len(data), "wall_s": round(time.time() - t0, 1)}, ensure_ascii=False), flush=True)
                    return 0
    print(f"[{name}] 超时无成图", flush=True)
    return 1


if __name__ == "__main__":
    rc = 0
    for name in ("speed", "quality"):
        rc |= run_variant(name, VARIANTS[name])
    sys.exit(rc)
