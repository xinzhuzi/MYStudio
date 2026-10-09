#!/usr/bin/env python3
"""道劫修手工作流实弹验证器(09-17,Trellis 09-17-daojie-k2-hands-pose R3)。

对 K2-道劫修手.json 做一次端到端实弹:UI→API 官方流转换(object_info
对齐 named widgets,非启发式)→ 提交 App 托管引擎(17001)→ 轮询 /history →
经 /view 取回成图 → 校验链路关键点。用法:

  python3 daojie_handsfix_run_0917.py [--input 名字.png] [--seed 20260917] [--denoise 0.65]

退出码 0=成图且链路校验通过。FASHN 解析器首次运行可能下载模型(走代理)。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path.home() / "Project/Github/MYStudio"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/3_改图/K2-道劫修手.json"
BASE = "http://127.0.0.1:17001"
OUT_COPY = REPO / "output/daojie_handsfix_0917.png"
CLIENT = "daojie-handsfix-0917"
TIMEOUT_S = 1500


def http_json(url: str, payload=None):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        raise RuntimeError(f"HTTP {e.code} {url}: {body[:2000]}") from e


def object_info() -> dict:
    return http_json(f"{BASE}/object_info")


def ui_to_api(wf: dict, oi: dict) -> dict:
    """官方流转换:节点 inputs 数组下标=link 槽位(含 widget 项);widget 取值
    named 优先、位置回退,顺序=object_info required+optional 中非连接型参数。"""
    nodes = {n["id"]: n for n in wf["nodes"]}
    # UI-only 注记节点不进 API 图(MarkdownNote/Note/Rerote 无 object_info 项);
    # 其余未知类型仍报错,防节点类型笔误静默吞掉
    ui_only = {"MarkdownNote", "Note", "Reroute"}
    skipped = [n["id"] for n in wf["nodes"] if n["type"] in ui_only]
    # (to_node, to_slot) -> (from_node, from_slot)
    edges = {(l[3], l[4]): (l[1], l[2]) for l in wf["links"]}
    out = {}
    for nid, n in nodes.items():
        if n["type"] in ui_only:
            continue
        spec = oi.get(n["type"])
        if spec is None:
            raise RuntimeError(f"object_info 无节点类型 {n['type']}")
        inputs_spec = {**spec["input"].get("required", {}), **spec["input"].get("optional", {})}
        slot_name = {}
        for idx, ent in enumerate(n.get("inputs", [])):
            slot_name[idx] = ent.get("name")
        named = n.get("widgets_values_named") or {}
        positional = list(n.get("widgets_values") or [])
        api_inputs = {}
        wpos = 0
        for name, meta in inputs_spec.items():
            kind = meta[0]
            is_link_type = isinstance(kind, str) and kind in {
                "MODEL", "CLIP", "VAE", "CONDITIONING", "LATENT", "IMAGE", "MASK",
                "STRING", "INT", "FLOAT", "COMBO", "BOOLEAN",
            } and not isinstance(meta, dict)
            # 连接槽:在节点 inputs 数组里按名找下标,再查 edges
            idx = next((i for i, nm in slot_name.items() if nm == name), None)
            linked = None
            if idx is not None:
                linked = edges.get((nid, idx))
            if linked is not None:
                api_inputs[name] = [str(linked[0]), linked[1]]
                continue
            # widget 型参数(named 优先,位置回退)
            if name in named:
                api_inputs[name] = named[name]
            elif wpos < len(positional):
                api_inputs[name] = positional[wpos]
                wpos += 1
        out[str(nid)] = {"class_type": n["type"], "inputs": api_inputs, "_meta": {"title": n.get("title", "")}}
    # 去掉 _meta 里的非 API 字段外壳(保留 title 便于日志)
    return {k: v for k, v in out.items()}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="daojie_hands_00005.png")
    ap.add_argument("--seed", type=int, default=20260917)
    ap.add_argument("--denoise", type=float, default=0.65)
    args = ap.parse_args()

    wf = json.loads(WF.read_text(encoding="utf-8"))
    # 覆盖:输入图/种子/denoise
    for n in wf["nodes"]:
        if n["id"] == 1:
            n["widgets_values"] = [args.input, "image"]
            n["widgets_values_named"] = {"image": args.input, "upload": "image"}
        if n["id"] == 18:
            n["widgets_values"] = [args.seed, "fixed", 4, 1.0, "euler", "simple", args.denoise]
            n["widgets_values_named"] = {"seed": args.seed, "control_after_generate": "fixed", "steps": 4, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": args.denoise}

    oi = object_info()
    api = ui_to_api(wf, oi)
    # 链路自检:关键节点在,装配正确
    n14 = api.get("14", {}).get("inputs", {})
    assert n14.get("string_a") == ["12", 0] and n14.get("string_b") == ["13", 0], f"装配链错误: {n14}"
    n23 = api.get("23", {}).get("inputs", {})
    assert n23.get("mask") == ["4", 0] and n23.get("destination") == ["5", 0], f"合成链错误: {n23}"
    n8 = api.get("8", {}).get("inputs", {})
    assert n8.get("mask") == ["4", 0], f"锁区链错误: {n8}"
    print(f"[handsfix] API 图 {len(api)} 节点,链路自检通过")

    # 队列礼让:等引擎空闲
    t0 = time.time()
    while time.time() - t0 < 600:
        q = http_json(f"{BASE}/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            break
        time.sleep(5)
    pid = http_json(f"{BASE}/prompt", {"prompt": api, "client_id": CLIENT})["prompt_id"]
    print(f"[handsfix] 提交 prompt_id={pid} seed={args.seed} denoise={args.denoise} input={args.input}")

    t0 = time.time()
    image = None
    while time.time() - t0 < TIMEOUT_S:
        time.sleep(5)
        h = http_json(f"{BASE}/history/{pid}")
        if pid not in h:
            continue
        e = h[pid]
        if e.get("status", {}).get("status_str") == "error":
            print("[handsfix] 引擎执行错误:", json.dumps(e["status"], ensure_ascii=False)[:800])
            return 1
        for node_out in (e.get("outputs") or {}).values():
            for im in node_out.get("images", []) or []:
                if im.get("type") == "output":
                    image = im
                    break
        if image:
            break
    if not image:
        print(f"[handsfix] 超时 {TIMEOUT_S}s 无成图")
        return 1

    q = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": "output"})
    req = urllib.request.Request(f"{BASE}/view?{q}")
    data = urllib.request.urlopen(req, timeout=60).read()
    OUT_COPY.parent.mkdir(parents=True, exist_ok=True)
    OUT_COPY.write_bytes(data)
    wall = time.time() - t0
    print(json.dumps({
        "status": "ok", "prompt_id": pid, "engine_image": image["filename"],
        "copy": str(OUT_COPY), "bytes": len(data), "wall_s": round(wall, 1),
        "seed": args.seed, "denoise": args.denoise,
    }, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
