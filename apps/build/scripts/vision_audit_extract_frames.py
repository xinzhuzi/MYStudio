#!/usr/bin/env python3
"""成片视觉审计抽帧器(08-22-video-use-vision-release R1)。

从 video-use artifact 的 EDL 推导压缩时间轴(转场重叠同口径:非 cut 转场
durationUs 累计前移),按边界/镜中抽帧,PIL 合成带标注的审查网格。

产物:
  <out>/frames/    单帧 PNG(480x270,可追溯)
  <out>/grids/     grid-NN.png(4x4,每格烧 timecode+shot+kind 标注)
  <out>/manifest.json  网格↔帧↔shot 映射(供 findings 交叉引用)

用法:
  python3 vision_audit_extract_frames.py --video <mp4> --artifact <video-use-artifact.json> --out <dir> [--mechanical]
  --mechanical: 转场不渲染的机械 preview(边界只取前后帧,无 blend 帧 QC 用途)。
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

TILE_W, TILE_H = 480, 270
LABEL_H = 22
GRID_COLS, GRID_ROWS = 4, 4


def ffmpeg() -> str:
    path = shutil.which("ffmpeg")
    if not path:
        sys.exit("ffmpeg 不在 PATH")
    return path


def compressed_timeline(edl: list[dict]) -> tuple[list[float], list[float | None]]:
    """压缩时间轴:每镜 (compressed_start_s, 该镜出边界的转场时长 s|None)。"""
    starts: list[float] = []
    transition_out: list[float | None] = []
    shift = 0.0
    for entry in edl:
        starts.append(float(entry["timelineStartS"]) - shift)
        t = entry.get("transitionToNext")
        if isinstance(t, dict) and str(t.get("effectId") or "cut") != "cut":
            d = float(t.get("durationUs") or 0) / 1_000_000
            shift += d
            transition_out.append(d if d > 0 else None)
        else:
            transition_out.append(None)
    return starts, transition_out


def extract_frame(video: str, t: float, out_path: Path) -> bool:
    result = subprocess.run(
        [ffmpeg(), "-y", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", video,
         "-frames:v", "1", "-vf", f"scale={TILE_W}:{TILE_H}", str(out_path)],
        capture_output=True, text=True,
    )
    return result.returncode == 0 and out_path.is_file() and out_path.stat().st_size > 0


def font() -> ImageFont.FreeTypeFont:
    for candidate in ("/System/Library/Fonts/Helvetica.ttc", "/System/Library/Fonts/SFNS.ttf"):
        try:
            return ImageFont.truetype(candidate, 13)
        except OSError:
            continue
    return ImageFont.load_default()


def label_tile(tile: Image.Image, text: str, fnt: ImageFont.ImageFont) -> Image.Image:
    canvas = Image.new("RGB", (TILE_W, TILE_H + LABEL_H), (0, 0, 0))
    canvas.paste(tile, (0, 0))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, TILE_H, TILE_W, TILE_H + LABEL_H], fill=(0, 0, 0))
    draw.text((4, TILE_H + 3), text, fill=(255, 220, 80), font=fnt)
    return canvas


def mmss(t: float) -> str:
    return f"{int(t // 60):02d}:{t % 60:04.1f}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--mechanical", action="store_true")
    parser.add_argument("--boundaries", help="measured-timeline.json(边界测量器产物);提供时以实测镜起点为真值,忽略 artifact 压缩推算")
    args = parser.parse_args()

    artifact = json.loads(Path(args.artifact).read_text(encoding="utf-8"))
    edl = artifact["edl"]
    if args.boundaries:
        measured = json.loads(Path(args.boundaries).read_text(encoding="utf-8"))
        shots_measured = measured["shots"]
        if [s["shot"] for s in shots_measured] != [str(e["shotId"]) for e in edl]:
            sys.exit("measured-timeline 与 artifact EDL 镜序不一致,拒绝抽帧")
        starts = [float(s["startS"]) for s in shots_measured]
        total = float(measured.get("videoEndS") or (starts[-1] + float(edl[-1]["durationS"])))
        # 实测边界点=差异极大值(blend 中点/硬切)。pre/blend/post 相对边界点取帧。
        boundary_points = starts[1:]
        transition_out: list[float | None] = [None] * len(edl)
    else:
        if args.mechanical:
            # 机械 preview(硬切拼接)无转场重叠:直接用未压缩 timelineStartS。
            starts = [float(e["timelineStartS"]) for e in edl]
            transition_out = [None] * len(edl)
        else:
            starts, transition_out = compressed_timeline(edl)
        total = starts[-1] + float(edl[-1]["durationS"])
        boundary_points = None
    durations = [float(e["durationS"]) for e in edl]

    out_dir = Path(args.out)
    frames_dir = out_dir / "frames"
    grids_dir = out_dir / "grids"
    frames_dir.mkdir(parents=True, exist_ok=True)
    grids_dir.mkdir(parents=True, exist_ok=True)

    # 采样点:每镜 mid;每边界 pre/mid(blend)/post。
    # --boundaries 模式:边界点=实测差异极大值;artifact 模式:由转场重叠推算。
    samples: list[dict] = []
    for i, entry in enumerate(edl):
        shot = str(entry["shotId"])
        shot_no = i + 1
        if boundary_points is not None:
            shot_end = boundary_points[i] if i < len(boundary_points) else total
        else:
            shot_end = starts[i] + durations[i]
        mid = starts[i] + (shot_end - starts[i]) * 0.5
        samples.append({"t": mid, "shot": shot, "shotNo": shot_no, "kind": "mid"})
        if i + 1 >= len(edl):
            continue
        if boundary_points is not None:
            b = boundary_points[i]
            samples.append({"t": b - 0.35, "shot": shot, "shotNo": shot_no, "kind": "pre"})
            samples.append({"t": b, "shot": shot, "shotNo": shot_no, "kind": "blend"})
            samples.append({"t": b + 0.7, "shot": str(edl[i + 1]["shotId"]), "shotNo": shot_no + 1, "kind": "post"})
        else:
            d = transition_out[i] or 0.0
            boundary_next_start = starts[i] + durations[i] - d
            samples.append({"t": boundary_next_start - 0.35, "shot": shot, "shotNo": shot_no, "kind": "pre"})
            if d > 0 and not args.mechanical:
                samples.append({"t": boundary_next_start + d * 0.5, "shot": shot, "shotNo": shot_no, "kind": "blend"})
            samples.append({"t": boundary_next_start + d + 0.25, "shot": str(edl[i + 1]["shotId"]), "shotNo": shot_no + 1, "kind": "post"})
    samples = [s for s in samples if 0.05 <= s["t"] <= total - 0.05]

    fnt = font()
    manifest: list[dict] = []
    kept: list[dict] = []
    for idx, sample in enumerate(samples):
        frame_path = frames_dir / f"f{idx:03d}_{sample['kind']}_s{sample['shotNo']:02d}_t{sample['t']:07.1f}.png"
        if not extract_frame(args.video, sample["t"], frame_path):
            print(f"  跳过(抽帧失败) {sample['kind']} s{sample['shotNo']:02d} @{sample['t']:.1f}s", file=sys.stderr)
            continue
        kept.append({**sample, "file": str(frame_path)})

    per_grid = GRID_COLS * GRID_ROWS
    grid_count = 0
    for grid_start in range(0, len(kept), per_grid):
        batch = kept[grid_start:grid_start + per_grid]
        tiles = []
        for item in batch:
            tile = Image.open(item["file"]).convert("RGB")
            tiles.append(label_tile(
                tile,
                f"#{item['shotNo']:02d} {mmss(item['t'])} {item['kind']}",
                fnt,
            ))
        grid_count += 1
        grid_path = grids_dir / f"grid-{grid_count:02d}.png"
        canvas = Image.new("RGB", (TILE_W * GRID_COLS, (TILE_H + LABEL_H) * GRID_ROWS), (24, 24, 24))
        for slot, tile in enumerate(tiles):
            canvas.paste(tile, ((slot % GRID_COLS) * TILE_W, (slot // GRID_COLS) * (TILE_H + LABEL_H)))
        canvas.save(grid_path)
        manifest.append({
            "grid": grid_path.name,
            "frames": [
                {"file": Path(item["file"]).name, "t": round(item["t"], 2), "shot": item["shot"],
                 "shotNo": item["shotNo"], "kind": item["kind"]}
                for item in batch
            ],
        })

    (out_dir / "manifest.json").write_text(
        json.dumps({
            "video": str(Path(args.video).resolve()),
            "artifact": str(Path(args.artifact).resolve()),
            "mechanical": bool(args.mechanical),
            "edlTotalUncompressedS": round(sum(durations), 3),
            "timelineCompressedS": round(total, 3),
            "frames": len(kept),
            "grids": grid_count,
            "manifest": manifest,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"完成: {len(kept)} 帧 → {grid_count} 网格;压缩时长 {total:.2f}s;输出 {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
