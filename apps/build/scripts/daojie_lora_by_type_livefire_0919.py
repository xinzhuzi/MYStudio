#!/usr/bin/env python3
"""九型驱动 LoRA 实弹取证(09-19):场景型同种子跑,[85] 应自动装 细节×1+金雾×0.6。

复用 daojie_livefire_0917.ui_to_api(SKIP_NODES={20} 放行 [61]);overrides=
seed42+[80]=场景+[50]=暮春句(与 v7/v11 同血统)。取证三件:
  ① history node_map [85].inputs(model←链尾/base←[80] 槽4);
  ② [86] 预览件 text=applied 清单(应含 金雾×0.6 与 细节滑杆×1);
  ③ 成图落 ~/Downloads/daojie_ablation_0919/v12_scene_bytype_lora.png。
跑完即停引擎(干完即停裁定)。"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_livefire_0917 as lf  # noqa: E402
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

lf.SKIP_NODES = {20}

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
OUT_PNG = Path.home() / "Downloads/daojie_ablation_0919/v12_scene_bytype_lora.png"
CLIENT = "daojie-bytype-lora-0919"
SUBJECT = ("暮春时节的黄昏,废弃的上古祭坛深藏在群山环抱的谷底,九根断裂的石柱围成半圆,"
           "坛心一泓浅潭映出残阳;谷口白雾正缓缓漫入,远山三重叠影渐次淡去。")


def probe_base() -> str:
    for port in (17000, 17001):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=3):
                return f"http://127.0.0.1:{port}"
        except Exception:
            continue
    raise RuntimeError("引擎 17000/17001 双口均无监听")


def main() -> int:
    base = probe_base()
    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    graph = ui_to_api(wf, oi, {"12.seed": 42, "50.value": SUBJECT, "80.base": "场景"})
    graph["80"]["inputs"].pop("negative", None)

    assert "85" in graph, "[85] 未进 API 图"
    n85 = graph["85"]["inputs"]
    print(f"[live] [85] node_map: base={n85.get('base')} model={n85.get('model')}")
    assert n85.get("base") == ["80", 4], f"[85].base 应为 [80] 槽4,实为 {n85.get('base')}"
    for nid in ("67", "73", "76"):
        assert nid not in graph, f"[{nid}] 应已交棒旁路不入 API 图"

    t0 = time.time()
    resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT}, timeout=60)
    assert not resp.get("node_errors"), json.dumps(resp["node_errors"], ensure_ascii=False)[:600]
    pid = resp["prompt_id"]
    print(f"[live] 提交 {pid}")
    entry = None
    while time.time() - t0 < 600:
        time.sleep(5)
        h = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in h:
            entry = h[pid]
            break
    assert entry, "超时"
    assert entry["status"]["status_str"] == "success", \
        json.dumps(entry["status"].get("messages", [])[:1], ensure_ascii=False)[:500]

    out86 = (entry.get("outputs") or {}).get("86") or {}
    applied = (out86.get("text") or [""])[0]
    print(f"[live] [86] applied = {applied!r}")
    assert "金雾" in applied and "0.6" in applied, "金雾×0.6 未生效"
    assert "细节" in applied, "细节滑杆未生效"
    out62 = (entry.get("outputs") or {}).get("62") or {}
    final = (out62.get("text") or [""])[0]
    assert final.startswith("现代修仙游戏的场景设定资产"), "最终正向底座头校验失败"

    image = None
    for out in (entry.get("outputs") or {}).values():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and x.get("filename"):
                        image = x
    assert image, "无成图"
    q = (f"filename={urllib.parse.quote(image['filename'])}"
         f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
    OUT_PNG.write_bytes(http_bytes(f"{base}/view?{q}"))
    print(json.dumps({"status": "ok", "prompt_id": pid, "applied": applied,
                      "wall_s": round(time.time() - t0, 1), "png": str(OUT_PNG)},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
