#!/usr/bin/env python3
"""win_engine_regress_1112.py — Win 引擎 0.44→0.45.2 升级回归烟雾(1112 H3-Image 役配套)。

回归件=`1_图片/MossImage/moss-道劫-t2i-api.json`(API 直投模板,纯核心节点:
装载器×3+SLG+KSampler+VAEDecode+SaveImage,零自定义节点零远程依赖)。
注入锚=5.text(正向)/8.seed;判据=/history status success+产物落袋+无 execution_error。
产物落 apps/output/h3image-smoke-1112/。
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ENGINE = "http://192.168.0.101:17000"
WF = REPO / "apps/backend/comfyui/workflows/1_图片/MossImage/moss-道劫-t2i-api.json"
OUT = REPO / "apps/output/h3image-smoke-1112"
PROMPT = "一只水墨风格的仙鹤立于松枝之上,大量留白,笔触清晰,淡彩"
SEED = 424242


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    api = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {k: v for k, v in api.items()
             if isinstance(v, dict) and "class_type" in v}
    if "5" not in nodes or "8" not in nodes:
        print(f"[FAIL] 模板锚点缺失:有 {sorted(nodes)}")
        return 2
    nodes["5"]["inputs"]["text"] = PROMPT
    nodes["8"]["inputs"]["seed"] = SEED
    # SaveImage 前缀改独立名,防与产线混淆
    for v in nodes.values():
        if v["class_type"] == "SaveImage":
            v["inputs"]["filename_prefix"] = "regress_1112/moss_t2i"

    body = json.dumps({"prompt": nodes,
                       "client_id": "regress-1112"}).encode()
    req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read().decode())["prompt_id"]
    except urllib.error.HTTPError as e:
        print(f"[FAIL] /prompt {e.code}:{e.read().decode()[:800]}")
        return 3
    print(f"prompt_id={pid}", flush=True)

    t0 = time.time()
    while time.time() - t0 < 900:
        try:
            with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=20) as r:
                h = json.loads(r.read().decode())
        except Exception:
            time.sleep(6)
            continue
        if pid in h:
            entry = h[pid]
            st = entry.get("status", {})
            for mid, m in (st.get("messages") or []):
                if mid == "execution_error":
                    print(f"[FAIL] execution_error:{json.dumps(m, ensure_ascii=False)[:600]}")
                    return 4
            if st.get("completed"):
                files = []
                for no in entry.get("outputs", {}).values():
                    for img in no.get("images", []):
                        if img.get("type") != "output":
                            continue
                        q = urllib.parse.urlencode(
                            {"filename": img["filename"],
                             "subfolder": img.get("subfolder", ""),
                             "type": "output"})
                        b = urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=60).read()
                        fp = OUT / f"regress__{img['filename']}"
                        fp.write_bytes(b)
                        files.append(fp.name)
                dt = time.time() - t0
                print(f"REGRESS PASS {dt:.0f}s files={files}")
                return 0
        time.sleep(6)
    print("[FAIL] 超时")
    return 5


if __name__ == "__main__":
    sys.exit(main())
