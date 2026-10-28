#!/opt/homebrew/bin python3
# -*- coding: utf-8 -*-
"""upscale_shootout_1028.py — FastH3 480p 超分全方案横评驱动脚本(D1,计划 §八)。

本版实现 = Mac 先行段(§四 M1 SeedVR2)全链:
  预检(object_info 键序/组合值校验)→ POST /prompt → RSS 全程采样 →
  轮询 /history(Mac 单时钟计时,计划 §三.2③)→ 产物即拉 →
  ffmpeg 统一终版(§三.4:libx264/crf18/aac128k/-shortest)+ -c:a copy 变体单测 →
  ffprobe 六项判据 → metadata.json 落盘。

Windows 段(P9 隧道/引擎复位 V5 串/nvidia-smi 采样/scp 即拉)由后续段扩展,
本版未含——Mac 段只打 Mac。

用法:
  python3 upscale_shootout_1028.py --validate seedvr2-mac   # 预检,不烧轮次
  python3 upscale_shootout_1028.py --run seedvr2-mac        # 实弹全链
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
CAMPAIGN = REPO / "apps/output/fasth3-upscale-shootout-1028"
SOURCE_VIDEO = REPO / "apps/output/fasth3-livefire-1027/t2v-480p_00001_.mp4"
ENGINE = "http://127.0.0.1:17001"
FFMPEG = "/opt/homebrew/bin/ffmpeg"
FFPROBE = "/opt/homebrew/bin/ffprobe"
# 引擎家 input/output(实体路径,manifest inputDir/outputDir 直配)
ENGINE_INPUT = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/input")
ENGINE_OUTPUT = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/output")

RUNS = {
    "seedvr2-mac": {
        "dir": CAMPAIGN / "seedvr2-mac",
        "workflow": CAMPAIGN / "seedvr2-mac/workflow-api.json",
        "input_file": "t2v-480p_00001_.mp4",
        "prefix": "seedvr2-mac-2x",
        "tier": "2x",
        "tier_group": "native-2x",
        "target_res": (1216, 704),
        "solution": "seedvr2",
        "side": "mac",
    },
}


def http_json(url: str, payload: dict | None = None, timeout: float = 30.0):
    """GET/POST JSON;返回 (status_code, parsed_body_or_text)。"""
    if payload is None:
        req = urllib.request.Request(url)
    else:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=body, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            return exc.code, json.loads(raw)
        except json.JSONDecodeError:
            return exc.code, raw


def validate_workflow(run: dict) -> list[str]:
    """对照 /object_info 预检:class_type 在册/必填齐/组合值合法(免烧实弹轮次)。"""
    problems: list[str] = []
    wf = json.loads(run["workflow"].read_text(encoding="utf-8"))
    status, info = http_json(f"{ENGINE}/object_info", timeout=60.0)
    if status != 200:
        return [f"object_info 不可达(HTTP {status})"]
    for node_id, spec in wf.items():
        ct = spec.get("class_type")
        if ct not in info:
            problems.append(f"节点{node_id}: class_type={ct} 不在 object_info")
            continue
        node = info[ct]
        required = node["input"].get("required", {})
        optional = node["input"].get("optional", {})
        inputs = spec.get("inputs", {})
        for key in required:
            if key not in inputs:
                problems.append(f"节点{node_id}({ct}): 必填输入 {key} 缺失")
        for key, value in inputs.items():
            if isinstance(value, list):
                continue  # 链接输入
            spec_def = required.get(key) or optional.get(key)
            if spec_def is None:
                problems.append(f"节点{node_id}({ct}): 输入 {key} 不在 schema")
                continue
            if spec_def[0] == "COMBO":
                options = spec_def[1].get("options", [])
                if options and value not in options:
                    problems.append(
                        f"节点{node_id}({ct}): {key}={value!r} 不在组合值表")
    return problems


class RssSampler(threading.Thread):
    """引擎进程 RSS 全程采样(计划 §三.2④ Mac 口径;macOS ps rss 单位=KB)。"""

    def __init__(self, pid: int, csv_path: Path):
        super().__init__(daemon=True)
        self.pid = pid
        self.csv_path = csv_path
        self._stop = threading.Event()
        self.rows: list[tuple[int, int]] = []

    def run(self):
        with self.csv_path.open("w", encoding="utf-8") as fh:
            fh.write("unix_ts,rss_kb\n")
            while not self._stop.is_set():
                try:
                    out = subprocess.run(
                        ["ps", "-o", "rss=", "-p", str(self.pid)],
                        capture_output=True, text=True, timeout=5.0)
                    rss = int((out.stdout or "0").strip() or 0)
                except Exception:
                    rss = 0
                row = (int(time.time()), rss)
                self.rows.append(row)
                fh.write(f"{row[0]},{row[1]}\n")
                fh.flush()
                self._stop.wait(1.0)

    def stop(self) -> tuple[int, int]:
        self._stop.set()
        self.join(timeout=5.0)
        peak = max((r for _, r in self.rows), default=0)
        return peak, len(self.rows)


def engine_pid(port: int = 17001) -> int | None:
    out = subprocess.run(
        ["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-t"],
        capture_output=True, text=True, timeout=10.0)
    pids = (out.stdout or "").split()
    return int(pids[0]) if pids else None


def find_output_from_history(history: dict, prefix: str) -> Path | None:
    """从 history outputs 递归找带 filename/type 的落盘记录(兼容 gifs/videos 键名)。"""
    def walk(obj):
        if isinstance(obj, dict):
            if "filename" in obj and obj.get("type") == "output":
                yield obj
            for v in obj.values():
                yield from walk(v)
        elif isinstance(obj, list):
            for item in obj:
                yield from walk(item)

    for rec in history.values():
        for hit in walk(rec.get("outputs", {})):
            sub = hit.get("subfolder", "")
            p = ENGINE_OUTPUT / sub / hit["filename"]
            if p.is_file() and prefix in p.name:
                return p
    return None


def newest_output(prefix: str, after_ts: float) -> Path | None:
    cands = [p for p in ENGINE_OUTPUT.rglob(f"{prefix}*") if p.is_file()
             and p.stat().st_mtime >= after_ts - 5]
    if not cands:
        cands = [p for p in ENGINE_OUTPUT.rglob(f"{prefix}*") if p.is_file()]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries",
         "stream=index,codec_type,codec_name,width,height,r_frame_rate,channels",
         "-show_entries", "format=duration,size", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=60.0)
    if out.returncode != 0:
        return {"error": out.stderr[-500:]}
    return json.loads(out.stdout)


def probe_summary(probe: dict) -> dict:
    streams = probe.get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), {})
    audio = next((s for s in streams if s.get("codec_type") == "audio"), {})
    fmt = probe.get("format", {})
    return {
        "resolution_out": f"{video.get('width')}x{video.get('height')}",
        "fps_out": video.get("r_frame_rate"),
        "duration_out": round(float(fmt.get("duration", 0)), 3),
        "audio_codec": audio.get("codec_name"),
        "audio_channels": audio.get("channels"),
        "bytes": int(fmt.get("size", 0)),
    }


def make_final(raw: Path, out: Path, audio_mode: str = "aac") -> tuple[bool, str]:
    """计划 §三.4 统一终版命令(audio_mode: aac=主口径 / copy=变体兜底单测)。"""
    if audio_mode == "copy":
        audio_args = ["-c:a", "copy"]
    else:
        audio_args = ["-c:a", "aac", "-b:a", "128k"]
    cmd = [FFMPEG, "-y", "-v", "error", "-i", str(raw), "-i", str(SOURCE_VIDEO),
           "-map", "0:v:0", "-map", "1:a:0", "-c:v", "libx264", "-crf", "18",
           "-preset", "medium", "-pix_fmt", "yuv420p", *audio_args,
           "-movflags", "+faststart", "-shortest", str(out)]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=1800.0)
    return proc.returncode == 0, proc.stderr[-800:]


def run_mac(run: dict) -> int:
    run_dir: Path = run["dir"]
    meta_path = run_dir / "metadata.json"
    wf = json.loads(run["workflow"].read_text(encoding="utf-8"))

    # 输入在位复核(指纹锚)
    engine_input = ENGINE_INPUT / run["input_file"]
    if not engine_input.is_file():
        print(f"FATAL: 引擎 input 缺 {engine_input}")
        return 2

    pid = engine_pid()
    if pid is None:
        print("FATAL: 引擎不在驾(17001 无监听)")
        return 2
    print(f"engine_pid={pid}")

    # 发车(§三.2③:Mac 单时钟,POST 200 时刻=计时起点)
    client_id = uuid.uuid4().hex
    t0 = time.time()
    status, body = http_json(
        f"{ENGINE}/prompt", {"prompt": wf, "client_id": client_id})
    if status != 200:
        print(f"FATAL: POST /prompt HTTP {status}: {json.dumps(body, ensure_ascii=False)[:800]}")
        return 2
    prompt_id = body.get("prompt_id")
    print(f"POST_OK prompt_id={prompt_id} t0={t0}")

    sampler = RssSampler(pid, run_dir / "rss.csv")
    sampler.start()

    # 轮询 /history(间隔 3s,≤5s 纪律)
    poll_interval = 3.0
    completed = False
    history = {}
    error_msg = None
    while True:
        time.sleep(poll_interval)
        st, hist = http_json(f"{ENGINE}/history/{prompt_id}", timeout=30.0)
        if st == 200 and isinstance(hist, dict) and prompt_id in hist:
            rec = hist[prompt_id]
            status_obj = rec.get("status", {})
            if status_obj.get("status_str") == "completed":
                completed = True
                history = hist
                break
            if status_obj.get("completed"):
                completed = True
                history = hist
                break
            # 引擎侧错误态(status_str=error)→取证退出
            if status_obj.get("status_str") == "error":
                error_msg = json.dumps(status_obj, ensure_ascii=False)
                history = hist
                break
        elapsed = time.time() - t0
        if elapsed > 7200:
            error_msg = f"轮询超 7200s 硬停(已 {elapsed:.0f}s)"
            break
        if int(elapsed) % 60 < poll_interval:
            print(f"polling… {elapsed:.0f}s", flush=True)

    t_done = time.time()
    wall_seconds = round(t_done - t0, 2)
    rss_peak_kb, rss_samples = sampler.stop()
    print(f"DONE completed={completed} wall={wall_seconds}s "
          f"rss_peak={rss_peak_kb}KB samples={rss_samples}")
    if error_msg:
        print(f"ENGINE_ERROR: {error_msg[:1500]}")
        (run_dir / "history-error.json").write_text(
            json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")

    # 产物即拉(9e6a4e46 教训:产物随引擎 output 清场殉)
    raw_src = find_output_from_history(history, run["prefix"]) or \
        newest_output(run["prefix"], t0)
    if raw_src is None or not raw_src.is_file():
        print(f"FATAL: 未找到产物({run['prefix']}*)")
        peak, n = rss_peak_kb, rss_samples
        meta = {
            "solution": run["solution"], "side": run["side"],
            "tier": run["tier"], "tier_group": run["tier_group"],
            "status": "FAILED", "wall_seconds": wall_seconds,
            "poll_interval_s": poll_interval, "prompt_id": prompt_id,
            "rss_peak_mib": round(peak / 1024, 1), "rss_samples": n,
            "rss_note": "ps rss 口径(KB→MiB),与 nvidia-smi 不可直比",
            "error": error_msg or "no output file",
        }
        meta_path.write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return 3
    raw_dst = run_dir / f"{run['prefix']}-raw.mp4"
    shutil.copy2(raw_src, raw_dst)
    print(f"RAW_PULLED {raw_dst} ({raw_dst.stat().st_size}B, engine_src={raw_src})")

    # 统一终版(§三.4 主口径)+ -c:a copy 变体单测(R1 补测项)
    final_dst = run_dir / f"{run['prefix']}-final.mp4"
    ok1, err1 = make_final(raw_dst, final_dst, "aac")
    print(f"FINAL_AAC ok={ok1} {err1[:200] if not ok1 else ''}")
    final_copy_dst = run_dir / f"{run['prefix']}-final-audio-copy.mp4"
    ok2, err2 = make_final(raw_dst, final_copy_dst, "copy")
    print(f"FINAL_AUDIO_COPY ok={ok2} {err2[:200] if not ok2 else ''}")

    # 判据采集(六项,§三.2)
    raw_probe = probe_summary(ffprobe(raw_dst))
    final_probe = probe_summary(ffprobe(final_dst)) if ok1 else {}
    copy_probe = probe_summary(ffprobe(final_copy_dst)) if ok2 else {}
    tw, th = run["target_res"]
    res_ok = final_probe.get("resolution_out") == f"{tw}x{th}"
    dur_ok = abs((final_probe.get("duration_out") or 0) - 5.167) <= 0.2
    audio_ok = bool(final_probe.get("audio_codec")) and \
        (final_probe.get("audio_channels") or 0) >= 1
    fps_ok = final_probe.get("fps_out") == "24/1"

    meta = {
        "solution": run["solution"], "side": run["side"],
        "tier": run["tier"], "tier_group": run["tier_group"],
        "status": "PASS" if (res_ok and dur_ok and audio_ok and ok1) else "FAILED",
        "wall_seconds": wall_seconds,
        "poll_interval_s": poll_interval,
        "prompt_id": prompt_id,
        "engine_src_output": str(raw_src),
        "raw": {
            "path": str(raw_dst), "probe": raw_probe,
            "bytes_raw": raw_dst.stat().st_size,
        },
        "final": {
            "path": str(final_dst), "probe": final_probe,
            "bytes_final": final_dst.stat().st_size if ok1 else None,
            "audio_mode": "aac 128k (统一口径 §三.4)",
        },
        "final_audio_copy_variant": {
            "path": str(final_copy_dst), "probe": copy_probe,
            "ok": ok2, "note": "R1 补测项:-c:a copy 变体兜底单测",
        },
        "criteria": {
            "①出片成功": True,
            "②分辨率达标": res_ok,
            "③耗时": f"{wall_seconds}s(Mac 单时钟,POST→completed)",
            "④显存峰值": f"rss_peak={rss_peak_kb}KB≈{rss_peak_kb/1024:.0f}MiB"
                         f"(ps rss 口径,与 nvidia-smi 不可直比)",
            "⑤音轨保真": {
                "audio_ok": audio_ok, "fps_ok": fps_ok,
                "duration_ok": dur_ok,
            },
            "⑥文件大小": {
                "raw": raw_dst.stat().st_size,
                "final": final_dst.stat().st_size if ok1 else None,
            },
        },
        "rss_peak_mib": round(rss_peak_kb / 1024, 1),
        "rss_samples": rss_samples,
        "rss_note": "ps rss 口径(KB→MiB),与 nvidia-smi 不可直比",
        "params": json.loads(run["workflow"].read_text(encoding="utf-8")),
        "notes": "统一终版=Mac /opt/homebrew ffmpeg 7.x libx264 crf18 medium;"
                 "raw=引擎 SaveVideo format=auto(mp4)原产留档。",
    }
    if error_msg:
        meta["engine_error"] = error_msg
    meta_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"METADATA_WRITTEN {meta_path} status={meta['status']}")
    print(f"RES={final_probe.get('resolution_out')} DUR={final_probe.get('duration_out')} "
          f"AUDIO={final_probe.get('audio_codec')}/{final_probe.get('audio_channels')}ch")
    return 0 if meta["status"] == "PASS" else 3


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", metavar="RUN")
    ap.add_argument("--run", metavar="RUN")
    args = ap.parse_args()
    if not (args.validate or args.run):
        print(__doc__)
        return 1
    run = RUNS[args.validate or args.run]
    if args.validate:
        problems = validate_workflow(run)
        if problems:
            print("VALIDATE_FAIL:")
            for p in problems:
                print(f"  - {p}")
            return 1
        print("VALIDATE_OK: class_type/必填/组合值 全过 object_info 预检")
        return 0
    return run_mac(run)


if __name__ == "__main__":
    raise SystemExit(main())
