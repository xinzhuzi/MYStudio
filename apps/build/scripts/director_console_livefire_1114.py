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
    """SaveVideo 真名={prefix}_{counter:05}_.mp4(尾下划线,源码钉式);
    多轮发车计数进位 → 探 1..12 号取最大命中。"""
    best = (False, 0)
    for k in range(1, 13):
        ok, size = view_ok(f"{prefix}_{k:05}_.mp4", 100_000)
        if ok and size > best[1]:
            best = (ok, size)
    return best


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
    ap.add_argument("--round", required=True, choices=("1", "2", "3", "all", "chapter3", "cache"))
    a = ap.parse_args()
    rounds = ("1", "2", "3") if a.round == "all" else (a.round,)
    for rd in rounds:
        {"1": round1, "2": round2, "3": round3, "chapter3": round_chapter3, "cache": round_cache}[rd]()
    print("三遍实弹全绿" if len(rounds) == 3 else f"round{'/'.join(rounds)} 绿")
    return 0




# ── 三镜整章实弹(1114 用户令「实际测试」)────────────────────────────
CH3 = "chapter-live3"
SEGS3 = [
    {"id": "sb-301", "prompt": "2D Chinese ink-wash guofeng animation. Miners wade through fog. 5 seconds.",
     "images": ["sb001_scene.jpg"]},
    {"id": "sb-302", "prompt": "2D Chinese ink-wash guofeng animation. Overseer with whip arcs over kneeling laborer. 4 seconds.",
     "images": ["sb007_scene.jpg"]},
    {"id": "sb-303", "prompt": "2D guofeng animation. A broken sword hums above an ancient altar, mist swirling. 5 seconds.",
     "images": []},
]


def graph3(stages: dict) -> dict:
    segs = []
    for s in SEGS3:
        segs.append({"id": s["id"], "mode": "r2v", "seconds": 5 if s["id"] != "sb-302" else 4,
                     "frames": 124 if s["id"] != "sb-302" else 90, "seed": None,
                     "rerun": False,
                     "prompt": {"summary": s["prompt"], "retention": "", "description": "", "soundscape": ""},
                     "images": s["images"]})
    timeline = json.dumps({
        "version": 1, "chapter": CH3, "stages": stages, "color_fix": "none",
        "common_images": ["canon-jc.png"],
        "common_params": {"enabled": True, "seconds": 5, "seed": 42, "match": "match"},
        "advanced": {"first_steps": 8, "second_steps": 3, "sampler": "lcm", "scheduler": "simple", "cfg": 1.0},
        "segments": segs,
    }, ensure_ascii=False)
    g = graph(stages)
    g["5"]["inputs"]["timeline_data"] = timeline
    return g


def fire3(stages: dict, tag: str, timeout_s: int = 2400) -> dict:
    q = http("GET", "/queue")
    while q["queue_running"] or q["queue_pending"]:
        time.sleep(10)
        q = http("GET", "/queue")
    pid = http("POST", "/prompt", {"prompt": graph3(stages),
                                   "client_id": "daoyan-livefire-1114"})["prompt_id"]
    print(f"[{tag}] 已入队 {pid} …")
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        h = http("GET", f"/history/{pid}")
        if pid in h:
            rec = h[pid]
            status = rec.get("status", {})
            if status.get("status_str") == "error":
                msgs = [m for m in status.get("messages", []) if "execution_error" in str(m[0])]
                raise RuntimeError(f"{tag} 执行错:{json.dumps(msgs)[:500]}")
            if status.get("completed"):
                return {"secs": round(time.time() - t0, 1)}
        time.sleep(8)
    raise RuntimeError(f"{tag} 超时 {timeout_s}s")


def round_chapter3() -> None:
    r = fire3({"yicai": True, "ercai": True, "sancai": True}, "三镜整章全链")
    ok = {}
    for s in SEGS3:
        for name in ("p1-draft", "p2-final", "p3-recavsr"):
            hit, size = view_ok_best(f"{OUT_ROOT}/{CH3}/{s['id']}/{name}")
            ok[f"{s['id']}.{name}"] = (hit, size)
    draft_ok, draft_sz = view_ok(f"{OUT_ROOT}/{CH3}/章草片.mp4", 200_000)
    final_ok, final_sz = view_ok(f"{OUT_ROOT}/{CH3}/章终片.mp4", 500_000)
    log = http("GET", f"/my_daoyan/logs?chapter={CH3}&limit=500")
    lines = log.get("lines") or []
    print(f"[整章] {r['secs']}s")
    for k, (hit, size) in ok.items():
        print(f"  {k}: {'✓' if hit else '✗'} {size:,}B")
    print(f"  章草片 {'✓' if draft_ok else '✗'} {draft_sz:,}B | 章终片 {'✓' if final_ok else '✗'} {final_sz:,}B")
    print(f"  run-log 行数:{len(lines)}(含耗时行:{sum(1 for l in lines if '耗时' in l)})")
    assert all(v[0] for v in ok.values()) and draft_ok and final_ok, "整章产物链未闭环"
    assert len(lines) >= 20 and any("耗时" in l for l in lines), "运行日志未落"


def round_cache() -> None:
    """☑2 单独复跑:latent 缓存命中=零采样(对 284s 重采样基线的加速实证)。"""
    segs = [dict(s) for s in SEGS3[:1]]
    g = graph3({"yicai": False, "ercai": True, "sancai": False})
    timeline = json.loads(g["5"]["inputs"]["timeline_data"])
    timeline["segments"] = timeline["segments"][:1]
    timeline["segments"][0]["rerun"] = True  # 强制重掷该镜二采(产物覆盖,latent 缓存仍命中)
    g["5"]["inputs"]["timeline_data"] = json.dumps(timeline, ensure_ascii=False)
    q = http("GET", "/queue")
    while q["queue_running"] or q["queue_pending"]:
        time.sleep(10)
        q = http("GET", "/queue")
    pid = http("POST", "/prompt", {"prompt": g, "client_id": "daoyan-livefire-1114"})["prompt_id"]
    print("[缓存实证] 已入队 …")
    t0 = time.time()
    while time.time() - t0 < 900:
        h = http("GET", f"/history/{pid}")
        if pid in h and h[pid].get("status", {}).get("completed"):
            secs = round(time.time() - t0, 1)
            log = http("GET", f"/my_daoyan/logs?chapter={CH3}&limit=80")
            lines = log.get("lines") or []
            hit_lines = [l for l in lines if "缓存命中" in l]
            print(f"[缓存实证] {secs}s(基线 284s=重采样+二采) 缓存命中行:{len(hit_lines)}")
            for l in hit_lines[:2]:
                print("  ", l[:90])
            assert hit_lines, "latent 缓存未命中(加速未生效)"
            assert secs < 200, "时长未显著降(缓存命中但没省采样?)"
            return
        if pid in h and h[pid].get("status", {}).get("status_str") == "error":
            raise RuntimeError("缓存实证执行错:" + json.dumps(h[pid]["status"])[:300])
        time.sleep(6)
    raise RuntimeError("缓存实证超时")


if __name__ == "__main__":
    sys.exit(main())
