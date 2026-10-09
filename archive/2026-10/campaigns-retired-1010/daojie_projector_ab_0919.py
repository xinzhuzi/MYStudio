#!/usr/bin/env python3
"""道劫文生图 [81] 服从度·ProjectorScale 同种子 A/B 实弹(09-19)。

对 apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json:
  跑A = 新组合原样([81] strength_model=0.01 保持工作流现值);
  跑B = 同 payload 但 [81] strength_model=0.0(等效关闭,纯对照服从度件的作用)。
两跑共同:seed=42 内联进 [12](绕开 [20] rgthree 种子件);分辨率 1024x1024 内联进
[53](绕开 [61] ResolutionSelector UI 件);步数用工作流原值([12].steps=4)。

转换复用 daojie_livefire_0917.ui_to_api(object_info+named 对齐、mode=4 旁路穿透、
MarkdownNote/Note 跳过、[20]/[61] UI 件跳过)。纪律:提交前查 /queue,pending>0 如实
跳过不抢跑;单跑 /history 轮询上限 6 分钟;成图经 /view 下载后 cp 到 ~/Downloads/
(文件名带 A/B 标记)。任何失败如实报 ran=false,不硬修。

用法:python3 apps/build/scripts/daojie_projector_ab_0919.py [--base-url http://127.0.0.1:17000]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import time
import urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_livefire_0917 import http_bytes, http_json, ui_to_api  # noqa: E402

WF_DAOJIE = (REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图"
             / "K2-文生图-道劫.json")
DOWNLOADS = Path.home() / "Downloads"
CLIENT_ID = "daojie-projector-ab-0919"
SEED = 42
WIDTH = HEIGHT = 1024
EXEC_TIMEOUT_S = 360  # 单跑上限 6 分钟
POLL_S = 5

RUNS = [
    ("A", "daojie_projector_A_seed42_x001.png", {}),
    ("B", "daojie_projector_B_seed42_str0.png", {"81.strength_model": 0.0}),
]
COMMON_OVERRIDES = {
    "12.seed": SEED,        # 内联字面量(绕开 rgthree 种子件)
    "53.width": WIDTH,      # 分辨率压 1024x1024(绕开 ResolutionSelector UI 件)
    "53.height": HEIGHT,
}


def queue_busy(base: str) -> dict | None:
    """pending>0 → 返回队列快照(忙);空/仅 running 由后续轮询消化,返回 None。"""
    q = http_json(f"{base}/queue", timeout=10)
    if q.get("queue_pending"):
        return q
    return None


def wait_done(base: str, pid: str) -> tuple[dict | None, float]:
    t0 = time.time()
    while time.time() - t0 < EXEC_TIMEOUT_S:
        hist = http_json(f"{base}/history/{pid}", timeout=20)
        if pid in hist:
            return hist[pid], round(time.time() - t0, 1)
        time.sleep(POLL_S)
    return None, round(time.time() - t0, 1)


def first_image(entry: dict) -> dict | None:
    for _nid, out in (entry.get("outputs") or {}).items():
        for imgs in (out or {}).values():
            if isinstance(imgs, list):
                for x in imgs:
                    if isinstance(x, dict) and "filename" in x:
                        return x
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description="道劫 [81] 服从度件同种子 A/B 实弹")
    ap.add_argument("--base-url", default="http://127.0.0.1:17000")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    # 提交前队列门:pending>0 → 两跑都如实跳过(不与用户任务抢跑)
    busy = queue_busy(base)
    if busy:
        print(json.dumps({"status": "engine_busy", "queue": busy,
                          "note": "pending>0,两跑均跳过"}, ensure_ascii=False))
        return 2

    wf = json.loads(WF_DAOJIE.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)

    results = []
    for tag, fname, extra in RUNS:
        overrides = dict(COMMON_OVERRIDES)
        overrides.update(extra)
        graph = ui_to_api(wf, oi, overrides)
        # 转换保真修正:[80].negative 是 forceInput 可选槽,UI 工作流未连线
        # (widget 恒单条=base 下拉);0917 转换器位置回退会把 widgets_values[0]
        # (=「人物」,base 的值)误填进 negative → 负向凭空多「人物」token,
        # 偏离 UI 真跑语义(未连线=缺席)。弹出该键=忠实还原画布行为,两臂同构。
        graph["80"]["inputs"].pop("negative", None)
        # 落档关键输入,便于核对(seed/steps/尺寸/[81] 强度)
        key_inputs = {
            "12.seed": graph["12"]["inputs"]["seed"],
            "12.steps": graph["12"]["inputs"]["steps"],
            "12.cfg": graph["12"]["inputs"]["cfg"],
            "53.width": graph["53"]["inputs"]["width"],
            "53.height": graph["53"]["inputs"]["height"],
            "81.strength_model": graph["81"]["inputs"]["strength_model"],
            "81.lora_name": graph["81"]["inputs"]["lora_name"],
        }
        # 跑前再查一次队列(上一跑完成后可能有用户任务插进来)
        busy = queue_busy(base)
        if busy:
            results.append({"tag": tag, "ran": False, "skip_reason": f"引擎忙 pending={len(busy['queue_pending'])}"})
            continue

        t0 = time.time()
        resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": CLIENT_ID}, timeout=60)
        if resp.get("node_errors"):
            results.append({"tag": tag, "ran": False, "skip_reason": "node_errors",
                            "detail": resp["node_errors"]})
            continue
        pid = resp["prompt_id"]
        entry, wall = wait_done(base, pid)
        if entry is None:
            results.append({"tag": tag, "ran": False, "skip_reason": f"超时(>{EXEC_TIMEOUT_S}s)",
                            "prompt_id": pid, "wall_s": wall})
            continue
        status = entry.get("status", {})
        if status.get("status_str") != "success":
            errs = [m for m in status.get("messages", []) if m[0] == "execution_error"]
            results.append({"tag": tag, "ran": False, "skip_reason": "execution_failed",
                            "detail": errs[:1], "prompt_id": pid, "wall_s": wall})
            continue

        image = first_image(entry)
        if image is None:
            results.append({"tag": tag, "ran": False, "skip_reason": "history 无图片输出",
                            "prompt_id": pid, "wall_s": wall})
            continue
        q = (f"filename={urllib.parse.quote(image['filename'])}"
             f"&subfolder={urllib.parse.quote(image.get('subfolder', ''))}&type=output")
        png = http_bytes(f"{base}/view?{q}")
        out = DOWNLOADS / fname
        out.write_bytes(png)
        results.append({"tag": tag, "ran": True, "prompt_id": pid, "wall_s": wall,
                        "bytes": len(png), "output": str(out),
                        "engine_image": image["filename"], "key_inputs": key_inputs})
        print(f"[AB] 跑{tag} 完成 wall={wall}s -> {out}", flush=True)

    print(json.dumps({"status": "done", "results": results}, ensure_ascii=False, indent=1))
    return 0 if all(r.get("ran") for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
