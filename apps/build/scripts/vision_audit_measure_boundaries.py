#!/usr/bin/env python3
"""成片视觉审计·边界测量器(08-22-video-use-vision-release R1)。

从视频本身测量镜间边界:1fps 灰度缩略图 → 相邻帧差分 → 局部极大值 →
按镜序单调对齐到 artifact EDL(顺序保持,数量一致时 i↔i 匹配)。

产物: <out>/measured-timeline.json  [{shot, shotNo, startS}, ...] + 残差报告。
背景: 渲染侧转场钳制与 artifact EDL 声称值不一致(实测 current.mp4 145.05s
vs artifact 压缩推算 134.27s),不能按 artifact 打时间码;此脚本给出真值。

用法:
  python3 vision_audit_measure_boundaries.py --video <mp4> --artifact <artifact.json> --out <dir>
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

THUMB_W, THUMB_H = 48, 27
MIN_SHOT_SPACING_S = 1.2  # 最短镜长约束(43 镜里最短的镜+转场不会低于此)


def extract_fps_thumbs(video: str, out_dir: Path) -> list[tuple[float, Path]]:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", video,
         "-vf", f"fps=1,scale={THUMB_W}:{THUMB_H}", "-pix_fmt", "gray",
         str(out_dir / "t%04d.png")],
        check=True, capture_output=True, text=True,
    )
    files = sorted(out_dir.glob("t*.png"))
    return [((i) + 0.5, f) for i, f in enumerate(files)]  # 帧时刻 ≈ 秒中点


def gray_vector(path: Path) -> list[int]:
    with Image.open(path) as im:
        return list(im.getdata())


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--min-boundaries-score", type=float, default=6.0)
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        thumbs = extract_fps_thumbs(args.video, Path(tmp))
        if len(thumbs) < 10:
            sys.exit("缩略图过少,视频可能异常")
        vectors = [gray_vector(f) for _, f in thumbs]
        times = [t for t, _ in thumbs]
        diffs = []
        for i in range(1, len(vectors)):
            diffs.append(sum(abs(a - b) for a, b in zip(vectors[i - 1], vectors[i])) / (THUMB_W * THUMB_H))
        # 差分序列时刻 = 两帧中点
        diff_times = [(times[i - 1] + times[i]) / 2 for i in range(1, len(times))]

    artifact = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
    edl = artifact["edl"]
    n_shots = len(edl)
    n_expected = n_shots - 1

    # 局部极大值 + 最小间距约束,取与期望边界数相同的 top 候选
    candidates: list[tuple[float, float]] = []  # (score, time)
    for i in range(1, len(diffs) - 1):
        if diffs[i] >= diffs[i - 1] and diffs[i] >= diffs[i + 1] and diffs[i] >= args.min_boundaries_score:
            candidates.append((diffs[i], diff_times[i]))
    candidates.sort(reverse=True)
    picked: list[float] = []
    for score, t in candidates:
        if all(abs(t - p) >= MIN_SHOT_SPACING_S for p in picked):
            picked.append(t)
        if len(picked) >= n_expected:
            break
    picked.sort()
    if len(picked) < n_expected:
        print(f"警告: 只测得 {len(picked)}/{n_expected} 个边界(阈值 {args.min_boundaries_score});"
              "剩余按 EDL 比例外推", file=sys.stderr)

    # 单调对齐:测得边界 i ↔ EDL 边界 i(顺序保持)。EDL 期望边界用未压缩累计
    # 时长按测得总跨度线性映射,只作残差参考,不作真值。
    video_end = times[-1]
    edl_total = sum(float(e["durationS"]) for e in edl)
    scale = video_end / edl_total
    expected: list[float] = []
    acc = 0.0
    for e in edl[:-1]:
        acc += float(e["durationS"])
        expected.append(acc * scale)

    shots: list[dict] = []
    residuals: list[float] = []
    for i, entry in enumerate(edl):
        start = 0.0 if i == 0 else (picked[i - 1] if i - 1 < len(picked) else expected[i - 1])
        shots.append({"shot": str(entry["shotId"]), "shotNo": i + 1, "startS": round(start, 3)})
        if i < len(picked) and i < len(expected):
            residuals.append(abs(picked[i] - expected[i]))

    (out_dir / "measured-timeline.json").write_text(
        json.dumps({
            "video": str(Path(args.video).resolve()),
            "method": "1fps gray thumb absdiff local maxima, spacing>= "
                      f"{MIN_SHOT_SPACING_S}s, aligned i<->i to EDL order",
            "boundariesMeasured": len(picked),
            "boundariesExpected": n_expected,
            "videoEndS": round(video_end, 3),
            "residualMeanS": round(sum(residuals) / len(residuals), 3) if residuals else None,
            "residualMaxS": round(max(residuals), 3) if residuals else None,
            "shots": shots,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"边界: {len(picked)}/{n_expected};残差 mean={sum(residuals)/len(residuals):.2f}s "
          f"max={max(residuals):.2f}s;输出 {out_dir / 'measured-timeline.json'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
