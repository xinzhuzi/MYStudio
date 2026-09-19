#!/usr/bin/env python3
"""R3 修手流 v2 升级件 A/B:baseline(现状 FASHN 锁区重绘)vs +NAGuidance(09-19)。

背景(09-18 深夜调研定谳):K2 专用修手 LoRA=0 个;最近邻=插件路线
LanPaint/Angelo/Krea2-NAG/CropAndStitch;Krea2-NAG 已装引擎家(object_info
NAGuidance 已注册,装验落地)。本轮 A/B 第一步=NAG vs baseline。

A/B 要点:
  A baseline = K2-道劫修手.json 现状原样(seed 20260917 / denoise 0.65,
    与 09-17 实弹验收同参;cfg1 下 [16] 负向数学上不参与);
  B +NAG = 同图同种子,采样器 model 链前插 NAGuidance 节点(nag_scale 5.0
    起步,alpha/tau 官方默认),NAG 经注意力把 [17] 负向(手部强化 token)
    在 cfg1 下重新激活——这正是 turbo 负向恒无效问题的正路解法。

图改造只在 API 载荷内存态(修手流 repo 本体零触碰,只读铁律);输入图
=output/K2道劫文生图__00005_.png(糊团手原始缺陷图)经 /upload 回传
input(09-16 清理后 input 已无此件)。成图落 ~/Downloads/daojie_handsfix_ab_0919/
(临时图落 Downloads 裁定)。引擎口 17000/17001 双探,回环恒直连。
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
sys.path.insert(0, str(REPO / "apps/build/scripts"))
import daojie_handsfix_run_0917 as hf  # noqa: E402

OUT_DIR = Path.home() / "Downloads" / "daojie_handsfix_ab_0919"
CLIENT = "daojie-handsfix-nag-ab-0919"
SEED = 20260917
DENOISE = 0.65
DEFECT_SRC = "K2道劫文生图__00005_.png"   # 引擎 output 原始缺陷图
INPUT_NAME = "daojie_hands_00005.png"     # 回传 input 后的件名(与 09-17 同名)
NAG_SCALE = 5.0
TIMEOUT_S = 900


def probe_base() -> str:
    for port in (17000, 17001):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=3) as r:
                if r.status == 200:
                    return f"http://127.0.0.1:{port}"
        except Exception:
            continue
    raise RuntimeError("引擎 17000/17001 双口均无监听")


def http_json(base: str, url_path: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(base + url_path, data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def ensure_input(base: str) -> None:
    """output 的缺陷图 → input(INPUT_NAME);幂等(已有同名则跳过)。"""
    names = http_json(base, "/object_info/LoadImage")
    if INPUT_NAME in names.get("LoadImage", {}).get("input", {}).get("required", {}).get("image", [[None]])[0]:
        print(f"[ab] input 已有 {INPUT_NAME}")
        return
    q = urllib.parse.urlencode({"filename": DEFECT_SRC, "type": "output"})
    png = urllib.request.urlopen(urllib.request.Request(f"{base}/view?{q}"), timeout=60).read()
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{INPUT_NAME}"\r\n'
            f"Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(f"{base}/upload/image", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        print(f"[ab] 上传 {INPUT_NAME}: {json.loads(r.read().decode()).get('name')}")


def build_api(base: str) -> dict:
    wf = json.loads(hf.WF.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["id"] == 1:
            n["widgets_values"] = [INPUT_NAME, "image"]
            n["widgets_values_named"] = {"image": INPUT_NAME, "upload": "image"}
        if n["id"] == 18:
            n["widgets_values"] = [SEED, "fixed", 4, 1.0, "euler", "simple", DENOISE]
            n["widgets_values_named"] = {"seed": SEED, "control_after_generate": "fixed",
                                         "steps": 4, "cfg": 1.0, "sampler_name": "euler",
                                         "scheduler": "simple", "denoise": DENOISE}
    return hf.ui_to_api(wf, http_json(base, "/object_info"))


def run_variant(base: str, name: str, api: dict) -> Path:
    # 队列礼让
    t0 = time.time()
    while time.time() - t0 < 600:
        q = http_json(base, "/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            break
        time.sleep(5)
    pid = http_json(base, "/prompt", {"prompt": api, "client_id": CLIENT})["prompt_id"]
    print(f"[ab] {name} 提交 prompt_id={pid}", flush=True)
    t0 = time.time()
    while time.time() - t0 < TIMEOUT_S:
        time.sleep(5)
        h = http_json(base, f"/history/{pid}")
        if pid not in h:
            continue
        e = h[pid]
        if e.get("status", {}).get("status_str") == "error":
            errs = [m for m in e["status"].get("messages", []) if m[0] == "execution_error"]
            print(f"[ab] {name} 执行失败: {json.dumps(errs[:1], ensure_ascii=False)[:600]}")
            raise SystemExit(2)
        for node_out in (e.get("outputs") or {}).values():
            for im in node_out.get("images", []) or []:
                if im.get("type") == "output":
                    q = urllib.parse.urlencode({"filename": im["filename"],
                                                "subfolder": im.get("subfolder", ""),
                                                "type": "output"})
                    data = urllib.request.urlopen(
                        urllib.request.Request(f"{base}/view?{q}"), timeout=60).read()
                    OUT_DIR.mkdir(parents=True, exist_ok=True)
                    out = OUT_DIR / f"{name}.png"
                    out.write_bytes(data)
                    print(f"[ab] {name} 完成 wall={round(time.time()-t0,1)}s -> {out}", flush=True)
                    return out
    raise SystemExit(f"[ab] {name} 超时 {TIMEOUT_S}s")


def main() -> int:
    base = probe_base()
    print(f"[ab] 引擎 {base}")
    ensure_input(base)

    api_a = build_api(base)
    run_variant(base, "A_baseline", api_a)

    api_b = build_api(base)
    oi = http_json(base, "/object_info")
    spec = oi["NAGuidance"]["input"]
    req = {**spec.get("required", {}), **spec.get("optional", {})}
    nag_inputs = {"model": api_b["18"]["inputs"]["model"], "nag_scale": NAG_SCALE}
    for k, meta in req.items():
        if k in nag_inputs or k == "model":
            continue
        kind = meta[0] if isinstance(meta, list) else None
        info = meta[1] if isinstance(meta, list) and len(meta) > 1 and isinstance(meta[1], dict) else {}
        if isinstance(kind, list):  # COMBO
            nag_inputs[k] = info.get("default") or kind[0]
        else:
            nag_inputs[k] = info.get("default", 0)
    api_b["90"] = {"class_type": "NAGuidance", "inputs": nag_inputs}
    api_b["18"]["inputs"]["model"] = ["90", 0]
    print(f"[ab] NAG 节点: {json.dumps(nag_inputs, ensure_ascii=False)[:400]}")
    run_variant(base, "B_nag", api_b)
    print(json.dumps({"status": "done", "seed": SEED, "denoise": DENOISE,
                      "nag_scale": NAG_SCALE,
                      "outputs": [str(OUT_DIR / "A_baseline.png"), str(OUT_DIR / "B_nag.png")]},
                     ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
