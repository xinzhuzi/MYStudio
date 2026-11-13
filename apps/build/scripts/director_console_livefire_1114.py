# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台·阶段3 三遍实弹驱动(1114;Trellis 11-13-director-console-remake)。

对新形态一条链(生成器 director_console_v2_generate_1114.py 的 8 节点)
做 API 直投实弹,验证 MyDirectorConsole.execute 真执行链(勾啥跑啥三遍):
  round1 勾1:1 镜 r2v 一采→p1-draft+章草片(三臂/采样/落盘/外拼/事件)
  round2 勾2单独:吃盘上 p1→二采 p2-final(检查点跳过/确定性重采样/潜放大)
  round3 勾3单独:文件化交接吃 p2→ReCaVSR p3-recavsr+章终片(/free/LoadVideo)
产物核验:/view HEAD 200 + 体积门槛(真片>100KB;占位 1×1≈2KB)。
用法:python3 director_console_livefire_1114.py --round 1|2|3|all
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request

ENGINE = "http://192.168.0.101:17000"
CHAPTER = "chapter-live1114"
SEG_ID = "sb-live1"
PROMPT = ("2D Chinese ink-wash guofeng animation. Miners wade through fog. "
          "5 seconds.")
OUT_ROOT = "video/导演台"

R = {  # 配方钉值(与 DIRECTOR_RECIPE/生成器同源)
    "unet": "Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors",
    "clip": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
    "vae_v": "minimax_h3_video_vae_int8_convrot.safetensors",
    "vae_a": "minimax_h3_audio_vae_fp32.safetensors",
}


def http(method: str, path: str, payload=None, timeout: int = 60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(ENGINE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")


def graph(stages: dict, seg_extra: dict | None = None) -> dict:
    seg = {
        "id": SEG_ID, "mode": "r2v", "seconds": 5, "frames": 124, "seed": None,
        "rerun": False,
        "prompt": {"summary": PROMPT, "retention": "", "description": "",
                   "soundscape": ""},
        "images": ["sb001_scene.jpg"],
    }
    seg.update(seg_extra or {})
    timeline = json.dumps({
        "version": 1, "chapter": CHAPTER, "stages": stages, "color_fix": "none",
        "common_images": ["canon-jc.png"],
        "common_params": {"enabled": True, "seconds": 5, "seed": 42,
                          "match": "match"},
        "advanced": {"first_steps": 8, "second_steps": 3, "sampler": "lcm",
                     "scheduler": "simple", "cfg": 1.0},
        "segments": [seg],
    }, ensure_ascii=False)
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": R["unet"], "weight_dtype": "default"}},
        "2": {"class_type": "VAELoader", "inputs": {"vae_name": R["vae_v"]}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": R["vae_a"]}},
        "4": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": R["clip"], "type": "minimax",
                         "device": "default"}},
        "5": {"class_type": "MyDirectorConsole",
              "inputs": {"model": ["1", 0], "video_vae": ["2", 0],
                         "audio_vae": ["3", 0], "clip": ["4", 0],
                         "timeline_data": timeline, "unique_id": 5}},
        "6": {"class_type": "CreateVideo",
              "inputs": {"images": ["5", 0], "fps": 24, "bit_depth": "auto",
                         "color_space": "sRGB",
                         "chroma_subsampling": "auto", "codec": "none"}},
        "7": {"class_type": "SaveVideo",
              "inputs": {"video": ["6", 0],
                         "filename_prefix": f"{OUT_ROOT}/_passthrough",
                         "format": "auto", "codec": "auto"}},
    }


def fire(stages: dict, tag: str, seg_extra: dict | None = None,
         timeout_s: int = 1200) -> dict:
    q = http("GET", "/queue")
    while q["queue_running"] or q["queue_pending"]:
        time.sleep(10)
        q = http("GET", "/queue")
    pid = http("POST", "/prompt",
               {"prompt": graph(stages, seg_extra),
                "client_id": "daoyan-livefire-1114"})["prompt_id"]
    print(f"[{tag}] 已入队 {pid} …")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        h = http("GET", f"/history/{pid}")
        if pid in h:
            rec = h[pid]
            status = rec.get("status", {})
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", [])
                        if m and "execution_error" in str(m[0])]
                raise RuntimeError(f"{tag} 执行错:{json.dumps(msgs)[:600]}")
            if status.get("completed"):
                return {"secs": round(time.time() - t0, 1), "pid": pid,
                        "outputs": rec.get("outputs", {})}
        time.sleep(6)
    raise RuntimeError(f"{tag} 超时 {timeout_s}s")


def view_ok(rel: str, min_bytes: int) -> tuple[bool, int]:
    sub, _, name = rel.rpartition("/")
    url = (f"{ENGINE}/view?filename={urllib.request.quote(name)}"
           f"&subfolder={urllib.request.quote(sub)}&type=output")
    try:
        with urllib.request.urlopen(
                urllib.request.Request(url, method="HEAD"), timeout=30) as r:
            size = int(r.headers.get("Content-Length") or 0)
            return r.status == 200 and size >= min_bytes, size
    except Exception:
        return False, 0


def round1() -> None:
    r = fire({"yicai": True, "ercai": False, "sancai": False}, "R1勾1")
    p1 = f"{OUT_ROOT}/{CHAPTER}/{SEG_ID}/p1-draft"
    ok, size = view_ok_best(p1)
    draft = f"{OUT_ROOT}/{CHAPTER}/章草片.mp4"
    okd, sized = view_ok(draft, 100_000)
    print(f"[R1] {r['secs']}s p1={'✓' if ok else '✗'}({size}B) "
          f"章草片={'✓' if okd else '✗'}({sized}B)")
    assert ok and okd, "R1 产物链未闭环"


def view_ok_best(prefix: str) -> tuple[bool, int]:
    """SaveVideo 自增计数:取 /view 对 prefix_00001.mp4 的探测(首号)。"""
    return view_ok(f"{prefix}_00001.mp4", 100_000)


def round2() -> None:
    r = fire({"yicai": False, "ercai": True, "sancai": False}, "R2勾2单独")
    ok, size = view_ok_best(f"{OUT_ROOT}/{CHAPTER}/{SEG_ID}/p2-final")
    print(f"[R2] {r['secs']}s p2={'✓' if ok else '✗'}({size}B)")
    assert ok, "R2 二采未闭环"


def round3() -> None:
    r = fire({"yicai": False, "ercai": False, "sancai": True}, "R3勾3单独")
    ok, size = view_ok_best(f"{OUT_ROOT}/{CHAPTER}/{SEG_ID}/p3-recavsr")
    okf, sizef = view_ok(f"{OUT_ROOT}/{CHAPTER}/章终片.mp4", 100_000)
    print(f"[R3] {r['secs']}s p3={'✓' if ok else '✗'}({size}B) "
          f"章终片={'✓' if okf else '✗'}({sizef}B)")
    assert ok and okf, "R3 三采未闭环"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--round", required=True, choices=("1", "2", "3", "all"))
    a = ap.parse_args()
    rounds = ("1", "2", "3") if a.round == "all" else (a.round,)
    for rd in rounds:
        {"1": round1, "2": round2, "3": round3}[rd]()
    print("三遍实弹全绿" if len(rounds) == 3 else f"round{'/'.join(rounds)} 绿")
    return 0


if __name__ == "__main__":
    sys.exit(main())
