#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一镜到底-分段 全链三采 实弹判决门(11-14-multiseg-full-3stage,PRD「A/B 双保险与判决门」)。

六步(Win 17000 实弹,2 段×5 秒):
  ① 前置:引擎活+队列双空(fail-fast);HTTP 全程禁系统代理(ProxyHandler({})=trust_env False)
  ② 段A 构造:100 提示词 2×5秒(模板竹林正文,时长标签 1秒→5秒)、seed=42、3031.length=243
     (帧数公式,复核定谳⑨;实跑以 p1 ffprobe 双核对,≠243 实测回填重发,雷#17)
  ③ 发段A → 轮询 history → p1(960×544)/p2(1440×832) 落盘下载;ffprobe 规格断言
  ④ POST /free {"unload_models": true} → 段B 子图(4000.file=p2 注解名 subfolder/filename [output])
     → p3 落盘;ffprobe 断言 2880×1664/24fps/时长≈10.1s
  ⑤ QC:接缝帧±2(seg≈0基123)+均匀8帧,p1/p2/p3 同帧号抽帧;色彩量化(帧间直方图 Δ);
     qc-seam-compare.jpg=接缝帧三联对比条
  ⑥ 产物归集 apps/output/multiseg-full3stage-1114/;judge-summary.json 终态

断点续跑:checkpoint.json 已落盘且参数一致即跳过(禁重复烧已完成段)。
硬契约:主跑命令恒为 python3 apps/build/scripts/multiseg_full3stage_livefire.py --judge
图构造 import 手术脚本(单一真源,禁复制)。
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "apps/build/scripts"))
import multiseg_full3stage_extend as EXT  # noqa: E402  图构造单一真源

ENGINE = "http://192.168.0.101:17000"
OUT_DIR = REPO_ROOT / "apps/output/multiseg-full3stage-1114"   # configure() 按 --out-dir 覆写
FRAMES_DIR = OUT_DIR / "frames"
CKPT = OUT_DIR / "checkpoint.json"

SEED = 42


def _snap_nearest_17n5(n: int) -> int:
    """h3_utils.snap_to_grid_nearest 同构:最近 17k+5,等距偏好向上(减分段数)。"""
    if n <= 5:
        return 5
    k = (n - 5) // 17
    down, up = 5 + k * 17, 5 + (k + 1) * 17
    return down if (n - down) < (up - n) else up


def _snap_nearest_17(n: int) -> int:
    k = n // 17
    down, up = k * 17, (k + 1) * 17
    return down if (n - down) < (up - n) else up


def plan_frames(seg_seconds: int, fps: int = 24, context: int = 5, n_seg: int = 2) -> tuple[int, list[int]]:
    """h3_utils.compute_tag_chunks 同构(等段特化):targets→snap(首段 17k+5/非首段 17 倍数)→
    diff 按 17 粒度自末段补偿;总帧=Σnew,seg_sizes[0]=new0、非首段=new+context。
    判例回归:s=5→(243,[124,124]) 与 1114 判决门实测精确吻合;s=10→(481,[243,243])。"""
    targets = [int(seg_seconds * fps)] * n_seg
    new = [_snap_nearest_17n5(targets[0])] + [_snap_nearest_17(t) for t in targets[1:]]
    diff = sum(targets) - sum(new)
    if diff != 0:
        k = round(diff / 17)
        step = 17 if k > 0 else -17
        idx, remaining = n_seg - 1, abs(k)
        while remaining > 0 and idx >= 0:
            if new[idx] + step >= 5:
                new[idx] += step
                remaining -= 1
            idx -= 1
    seg_sizes = [new[0]] + [n + context for n in new[1:]]
    return sum(new), seg_sizes


def _judge_prompt(seg_seconds: int) -> str:
    s = f"{seg_seconds}秒"
    return (
        "段1:" + s + "\n[Shot 1] 中景，固定机位。一位穿深蓝色长袍的年轻剑修站在竹林小径上，微微抬头看向竹梢，"
        "晨光从竹叶缝隙洒落，竹叶轻晃。\n\n段2:" + s + "\n[Shot 1] 他收回视线，抬手把拂过肩头的竹叶轻轻拨开，"
        "衣袖摆动，沿小径继续向前走去。\n\noverall_soundscape: 清晨竹林鸟鸣，风吹竹叶沙沙声，脚步踩在落叶上的轻响"
    )


SEG_SECONDS = 5                                    # configure() 按 --seg-seconds 覆写(1115 2×10s 超限实弹)
EXPECTED_LENGTH, _SEGS = plan_frames(SEG_SECONDS)  # s=5 → 243,seg_sizes[124,124](1114 判决门实测吻合)
SEAM_GUESS_0BASED = _SEGS[0] - 1                   # seg1 末帧(0基)=seg_sizes[0]-1
JUDGE_PROMPT = _judge_prompt(SEG_SECONDS)
STAGEA_TIMEOUT = 60 * 60        # 一采+二采 双档(481 帧级 ~22min 量级),宽限 60min
STAGEB_TIMEOUT = 40 * 60
POLL = 6


def configure(seg_seconds: int, out_dir: str | None) -> None:
    """CLI 参数化入口:段时长(--seg-seconds)与产物夹(--out-dir)覆写模块全局;s=5 回归守卫。"""
    global SEG_SECONDS, EXPECTED_LENGTH, SEAM_GUESS_0BASED, JUDGE_PROMPT, OUT_DIR, FRAMES_DIR, CKPT
    SEG_SECONDS = seg_seconds
    EXPECTED_LENGTH, seg_sizes = plan_frames(seg_seconds)
    SEAM_GUESS_0BASED = seg_sizes[0] - 1
    JUDGE_PROMPT = _judge_prompt(seg_seconds)
    if seg_seconds == 5:
        assert (EXPECTED_LENGTH, seg_sizes) == (243, [124, 124]), "公式转写回归失败:s=5 应 243/[124,124]"
    if out_dir:
        p = Path(out_dir)
        OUT_DIR = p if p.is_absolute() else REPO_ROOT / p
        FRAMES_DIR = OUT_DIR / "frames"
        CKPT = OUT_DIR / "checkpoint.json"

_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 禁系统代理


def http_json(method: str, path: str, payload: dict | None = None, timeout: int = 30) -> dict:
    req = urllib.request.Request(ENGINE + path, method=method)
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        req.add_header("Content-Type", "application/json")
    with _opener.open(req, data=data, timeout=timeout) as r:
        body = r.read().decode("utf-8")
    return json.loads(body) if body.strip() else {}   # /free 等端点回空体


def download(path_qs: str, dest: Path) -> Path:
    with _opener.open(ENGINE + path_qs, timeout=300) as r, open(dest, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return dest


# ---------------------------------------------------------------------------
# ffprobe / ffmpeg
# ---------------------------------------------------------------------------
def ffprobe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams", str(path)],
        capture_output=True, text=True, check=True)
    streams = json.loads(out.stdout)["streams"]
    v = next(s for s in streams if s["codec_type"] == "video")
    frames = v.get("nb_frames")
    if frames is None:  # 容器无 nb_frames:数包
        n = subprocess.run(["ffprobe", "-v", "quiet", "-count_packets", "-select_streams", "v",
                            "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(path)],
                           capture_output=True, text=True, check=True)
        frames = int(n.stdout.strip())
    return {"width": v["width"], "height": v["height"], "fps": v["r_frame_rate"], "frames": int(frames)}


def extract_frames(src: Path, frame_ids: list[int], prefix: str) -> dict[int, Path]:
    """单遍 select 抽帧(0基帧号)。"""
    expr = "+".join(f"eq(n\\,{f})" for f in frame_ids)
    FRAMES_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(src),
                    "-vf", f"select='{expr}'", "-fps_mode", "passthrough",
                    str(FRAMES_DIR / f"{prefix}-%04d.png")], check=True, capture_output=True)
    got = sorted(FRAMES_DIR.glob(f"{prefix}-*.png"))
    return {f: got[i] for i, f in enumerate(frame_ids)}


def hist_delta(a: Path, b: Path) -> float:
    """色彩量化:两帧 RGB 联合直方图(每通道 8 bin)归一化差的 L1。"""
    from PIL import Image
    def hist(p):
        im = Image.open(p).convert("RGB").resize((160, 90))
        h = im.histogram()
        q = [0] * 512
        px = im.load()
        for y in range(90):
            for x in range(160):
                r, g, b = px[x, y]
                q[(r >> 5) << 6 | (g >> 5) << 3 | (b >> 5)] += 1
        s = sum(q)
        return [v / s for v in q]
    ha, hb = hist(a), hist(b)
    return sum(abs(x - y) for x, y in zip(ha, hb))


# ---------------------------------------------------------------------------
# 引擎交互
# ---------------------------------------------------------------------------
def preflight(allow_busy: bool = False) -> None:
    """allow_busy=进程级续跑态(自家 prompt_id 在途/已完成待收):容忍队列占用,引擎活检查恒在。"""
    stats = http_json("GET", "/system_stats")
    q = http_json("GET", "/queue")
    running, pending = q.get("queue_running", []), q.get("queue_pending", [])
    if (running or pending) and not allow_busy:
        raise SystemExit(f"队列非空 fail-fast: running={len(running)} pending={len(pending)}")
    state = "续跑容忍占用(自家 prompt 在途)" if (running or pending) else "队列双空"
    print(f"[1/6] 前置 ✓ 引擎活 {stats.get('system', {}).get('comfyui_version', '?')} / {state}")


def submit(prompt: dict) -> str:
    r = http_json("POST", "/prompt", {"prompt": prompt, "client_id": "multiseg-full3stage-1114"})
    if "prompt_id" not in r:
        raise SystemExit(f"提交失败: {r}")
    return r["prompt_id"]


def wait_history(prompt_id: str, timeout: int, tag: str) -> dict:
    t0 = time.time()
    while time.time() - t0 < timeout:
        h = http_json("GET", f"/history/{prompt_id}")
        if prompt_id in h:
            entry = h[prompt_id]
            if entry.get("status", {}).get("status_str") == "error":
                raise SystemExit(f"{tag} 执行错误: {json.dumps(entry.get('status', {}))[:800]}")
            print(f"      {tag} 完成 ({int(time.time()-t0)}s)")
            return entry
        time.sleep(POLL)
    raise SystemExit(f"{tag} 超时 {timeout}s")


def save_video_outputs(entry: dict, node_ids: list[int]) -> dict[int, dict]:
    outs = entry.get("outputs", {})
    found = {}
    for nid in node_ids:
        o = outs.get(str(nid)) or {}
        for key in ("gifs", "videos", "images"):
            items = o.get(key)
            if items:
                found[nid] = items[-1]
                break
    missing = [n for n in node_ids if n not in found]
    if missing:
        raise SystemExit(f"history 缺产物节点 {missing}: {json.dumps(outs)[:600]}")
    return found


def annotated_name(item: dict) -> str:
    """subfolder/filename [type];Win 引擎回传路径含反斜杠,归一化正斜杠(LoadVideo 识别形)。"""
    sub = item.get("subfolder", "").replace("\\", "/")
    fn = item["filename"].replace("\\", "/")
    ty = item.get("type", "output")
    return f"{sub}/{fn} [{ty}]" if sub else f"{fn} [{ty}]"


def fetch(item: dict, dest: Path) -> Path:
    qs = urllib.parse.urlencode({"filename": item["filename"],
                                 "subfolder": item.get("subfolder", ""),
                                 "type": item.get("type", "output")})
    return download(f"/view?{qs}", dest)


# ---------------------------------------------------------------------------
# 段A/段B 构造(import 手术脚本图,确定性摊平后按判决门覆写)
# ---------------------------------------------------------------------------
def build_judge_stageA(length: int) -> dict:
    base = json.loads(EXT.WF_PATH.read_text(encoding="utf-8"))
    graph = EXT.build_full3stage_graph(base)
    api = EXT.build_stageA_api(graph)
    api["100"]["inputs"]["long_prompt"] = JUDGE_PROMPT
    api["100"]["inputs"]["total_frames"] = length
    api["3030"]["inputs"]["value"] = JUDGE_PROMPT          # 同频(雷#14)
    api["3031"]["inputs"]["length"] = length               # 公式同步(雷#13)
    api["101"]["inputs"]["seed"] = SEED
    return api


def build_judge_stageB(p2_annotated: str) -> dict:
    base = json.loads(EXT.WF_PATH.read_text(encoding="utf-8"))
    graph = EXT.build_full3stage_graph(base)
    return EXT.build_stageB_api(graph, source_file=p2_annotated)


def load_ckpt() -> dict:
    if CKPT.exists():
        return json.loads(CKPT.read_text(encoding="utf-8"))
    return {}


def save_ckpt(d: dict) -> None:
    CKPT.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# 六步判决门
# ---------------------------------------------------------------------------
def judge() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ckpt = load_ckpt()
    notes: list[str] = []

    _a = ckpt.get("stageA") or {}
    _b = ckpt.get("stageB") or {}
    resume_a = bool(_a.get("prompt_id")) and not _a.get("ok")
    resume_b = bool(_b.get("prompt_id")) and not _b.get("ok")
    preflight(allow_busy=resume_a or resume_b)

    # ②③ 段A(p1+p2)
    length = EXPECTED_LENGTH
    p1, p2, p1i, p2i = OUT_DIR / "p1-960x544.mp4", OUT_DIR / "p2-1440x832.mp4", None, None
    ck_a = ckpt.get("stageA") or {}
    if ck_a.get("params", {}).get("length") == length and ck_a.get("ok") and p1.exists() and p2.exists():
        print(f"[2-3/6] 段A 检查点命中,跳过(禁重复烧): p1/p2 已在 {OUT_DIR}")
    else:
        resume_pid = ck_a.get("prompt_id") if ck_a.get("params", {}).get("length") == length else None
        while True:
            if resume_pid:
                print(f"[2/6] 段A 进程级续跑: prompt_id={resume_pid} 继续轮询/收产物(免重发免重烧)")
                entry = wait_history(resume_pid, STAGEA_TIMEOUT, "段A(续跑)")
                resume_pid = None
            else:
                api = build_judge_stageA(length)
                print(f"[2/6] 段A 构造 ✓ 2×{SEG_SECONDS}秒 seed={SEED} 3031.length={length}")
                pid = submit(api)
                ckpt["stageA"] = {"params": {"length": length, "seed": SEED}, "prompt_id": pid}
                save_ckpt(ckpt)   # 提交即持久化:进程若死,重跑按 pid 续收产物(禁重发重烧)
                print(f"[3/6] 段A 已发(prompt_id={pid});轮询 history …")
                entry = wait_history(pid, STAGEA_TIMEOUT, "段A(一采+二采)")
            items = save_video_outputs(entry, [4, 3071])
            p1i, p2i = items[4], items[3071]
            fetch(p1i, p1)
            fetch(p2i, p2)
            m1 = ffprobe(p1)
            print(f"      p1={m1['width']}x{m1['height']} {m1['fps']}fps {m1['frames']}帧")
            if m1["frames"] == length or length != EXPECTED_LENGTH:
                if m1["frames"] != length:
                    notes.append(f"p1 实测帧数 {m1['frames']} ≠ 首发公式 {EXPECTED_LENGTH}(公式版本漂移,以实测为准)")
                break
            # 雷#17:公式漂移 → 实测回填重发(仅一次)
            notes.append(f"p1 实测 {m1['frames']} 帧 ≠ 公式 {length},实测回填 3031.length 重发(雷#17)")
            length = m1["frames"]
        ckpt["stageA"] = {"params": {"length": length, "seed": SEED}, "ok": True,
                          "p1_annotated": annotated_name(p1i), "p2_annotated": annotated_name(p2i)}
        save_ckpt(ckpt)

    m1, m2 = ffprobe(p1), ffprobe(p2)
    assert (m1["width"], m1["height"]) == (960, 544), f"p1 规格 {m1}"
    assert (m2["width"], m2["height"]) == (1440, 832), f"p2 规格 {m2}"
    n_frames = m1["frames"]
    assert m2["frames"] == n_frames, f"p2 帧数 {m2['frames']} ≠ p1 {n_frames}"
    for m, tag in ((m1, "p1"), (m2, "p2")):
        assert abs(eval(m["fps"]) - 24.0) < 0.01, f"{tag} fps={m['fps']} 非 24"
    print(f"[3/6] ffprobe ✓ p1=960×544 p2=1440×832 24fps {n_frames}帧({n_frames/24:.2f}s)")

    # ④ 段B(p3)
    p3 = OUT_DIR / "p3-2880x1664.mp4"
    ck_b = ckpt.get("stageB") or {}
    p2_annot = ck_a.get("p2_annotated") or (ckpt.get("stageA") or {}).get("p2_annotated")
    if ck_b.get("ok") and p3.exists():
        print(f"[4/6] 段B 检查点命中,跳过: p3 已在 {OUT_DIR}")
    else:
        assert p2_annot, "缺 p2 注解名(段A 检查点不完整)"
        resume_b_pid = ck_b.get("prompt_id")
        if resume_b_pid:
            print(f"[4/6] 段B 进程级续跑: prompt_id={resume_b_pid} 继续轮询/收产物(免重发免重烧)")
            entry = wait_history(resume_b_pid, STAGEB_TIMEOUT, "段B(续跑)")
        else:
            http_json("POST", "/free", {"unload_models": True})
            print(f"[4/6] /free unload_models ✓;段B 子图 4000.file={p2_annot}")
            apiB = build_judge_stageB(p2_annot)
            pid = submit(apiB)
            ckpt["stageB"] = {"prompt_id": pid}
            save_ckpt(ckpt)   # 提交即持久化(同段A)
            entry = wait_history(pid, STAGEB_TIMEOUT, "段B(ReCaVSR 三采)")
        items = save_video_outputs(entry, [4003])
        fetch(items[4003], p3)
        ckpt["stageB"] = {"ok": True, "p3_annotated": annotated_name(items[4003])}
        save_ckpt(ckpt)

    m3 = ffprobe(p3)
    assert (m3["width"], m3["height"]) == (2880, 1664), f"p3 规格 {m3} 应 2880×1664(终档裁定)"
    assert abs(eval(m3["fps"]) - 24.0) < 0.01, f"p3 fps={m3['fps']} 非 24"
    assert m3["frames"] == n_frames, f"p3 帧数 {m3['frames']} ≠ {n_frames}"
    print(f"[4/6] ffprobe ✓ p3=2880×1664 24fps {m3['frames']}帧={m3['frames']/24:.2f}s")

    # ⑤ QC 抽帧:接缝±2 + 均匀8帧;色彩量化;三联对比条
    seam_frames = sorted({max(0, min(n_frames - 1, f))
                          for f in range(SEAM_GUESS_0BASED - 2, SEAM_GUESS_0BASED + 3)})
    uniform = sorted({round(i * (n_frames - 1) / 7) for i in range(8)})
    qc_frames = sorted(set(seam_frames) | set(uniform))
    print(f"[5/6] QC 抽帧 {len(qc_frames)} 帧(接缝±2 {seam_frames} + 均匀8 {uniform})")
    paths = {}
    for tag, src in (("p1", p1), ("p2", p2), ("p3", p3)):
        paths[tag] = extract_frames(src, qc_frames, tag)
    deltas = {}
    ordered = sorted(set(seam_frames))
    for i in range(len(ordered) - 1):
        a, b = ordered[i], ordered[i + 1]
        deltas[f"{a}->{b}"] = {tag: round(hist_delta(paths[tag][a], paths[tag][b]), 5)
                               for tag in ("p1", "p2", "p3")}
    seam_detect = max(ordered[:-1], key=lambda a: deltas[f"{a}->{ordered[ordered.index(a)+1]}"]["p1"]) \
        if len(ordered) > 1 else SEAM_GUESS_0BASED
    qc = {
        "task": "11-14-multiseg-full-3stage 判决门 QC",
        "params": {"segments": f"2×{SEG_SECONDS}秒", "seed": SEED, "expectedLength": EXPECTED_LENGTH,
                   "actualFrames": n_frames, "seamGuess0based": SEAM_GUESS_0BASED,
                   "seamDetected0based": seam_detect},
        "qcFrames": qc_frames, "seamFrames": seam_frames, "uniformFrames": uniform,
        "histDeltaL1": deltas,
        "verdict": {"colorJumpAtSeam": max((v["p1"] for v in deltas.values()), default=0),
                    "note": "帧与指标供视觉判缝;p1 接缝前后直方图 Δ 小(无色跳)为 PASS 参考"},
        "files": {f"frames/{p.name}": str(p.relative_to(OUT_DIR))
                  for p in sorted(FRAMES_DIR.glob("*.png"))},
    }
    (OUT_DIR / "qc.json").write_text(json.dumps(qc, ensure_ascii=False, indent=2), encoding="utf-8")

    seam_cmp = max(seam_frames, key=lambda f: abs(f - seam_detect))
    try:
        from PIL import Image
        ims = [Image.open(paths[t][seam_cmp]).convert("RGB") for t in ("p1", "p2", "p3")]
        h = 360
        strips = []
        for im in ims:
            w = round(im.width * h / im.height)
            strips.append(im.resize((w, h)))
        canvas = Image.new("RGB", (sum(s.width for s in strips) + 40, h + 30), (24, 24, 24))
        x = 0
        for s, tag in zip(strips, ("p1 960×544", "p2 1440×832", "p3 2880×1664")):
            canvas.paste(s, (x, 30))
            x += s.width + 20
        canvas.save(OUT_DIR / "qc-seam-compare.jpg", quality=88)
    except Exception as e:  # noqa: BLE001 QC 条非门,PIL 缺失不致命
        notes.append(f"qc-seam-compare 生成失败: {e}")
    print(f"[5/6] QC ✓ qc.json + qc-seam-compare.jpg(接缝帧 0基{seam_cmp})")

    # ⑥ 终态摘要
    fps = lambda m: round(eval(m["fps"]), 3)  # noqa: E731
    summary = {
        "ok": True,
        "p1": {"width": m1["width"], "height": m1["height"], "fps": fps(m1), "frames": m1["frames"]},
        "p2": {"width": m2["width"], "height": m2["height"], "fps": fps(m2), "frames": m2["frames"]},
        "p3": {"width": m3["width"], "height": m3["height"], "fps": fps(m3), "frames": m3["frames"]},
        "seamFrames": seam_frames,
        "notes": "; ".join(notes) or f"A 方案判决门三档全过(引擎活/规格 2880×1664/24fps);seamDetected=0基{seam_detect}",
    }
    (OUT_DIR / "judge-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[6/6] 判决门 ✓ 终态摘要 → {OUT_DIR/'judge-summary.json'}")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="全链三采实弹判决门(--judge 主跑)")
    ap.add_argument("--judge", action="store_true", help="六步判决门(主跑命令)")
    ap.add_argument("--seg-seconds", type=int, default=5,
                    help="每段时长秒数(默认 5;超限实弹用 10 → 481 帧≈20.04s,帧数公式内化自 h3_utils)")
    ap.add_argument("--out-dir", default=None,
                    help="产物夹(默认 apps/output/multiseg-full3stage-1114;不同段配置务必覆写以隔离产物)")
    args = ap.parse_args(argv)
    if not args.judge:
        ap.print_help()
        return 2
    configure(args.seg_seconds, args.out_dir)
    return judge()


if __name__ == "__main__":
    sys.exit(main())
