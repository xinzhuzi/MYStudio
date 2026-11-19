#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""metrics.py — 双视频帧级量化对比基建(脸区 Laplacian 锐度 + 对源 RMSE/PSNR)。

口径铁律: 禁跨生成代理帧 —— src 与 dst 必须是同一生成系内可对帧的产物
(同帧号、同分辨率),否则 RMSE 无意义。本脚本用同帧号抽帧,不猜不对齐。

用法 A(视频 + 计划文件,推荐;region 随帧指定):
    python3 metrics.py --src SRC.mp4 --dst DST.mp4 \
        --plan plan-a2rv.json --outdir .
    plan JSON 形如:
    [
      {"frame": 60,  "label": "far", "region": [1864, 992, 1996, 1156]},
      {"frame": 156, "label": "cu",  "region": [1605, 495, 2340, 1185]}
    ]
    region = [x1, y1, x2, y2] 全分辨率像素坐标(src/dst 帧分辨率)。

用法 B(视频 + 同一 region 应用于所有帧):
    python3 metrics.py --src SRC.mp4 --dst DST.mp4 --frames 60,156 \
        --labels far,cu --region 1864,992,1996,1156 --outdir .

用法 C(已有图片对,跳过抽帧):
    python3 metrics.py --src-img a.jpg --dst-img b.jpg --label cu \
        --region 1605,495,2340,1185

输出:
    <outdir>/mx_{label}_{src|dst}.png   抽帧(无损,指标基于它)
    <outdir>/mx_{label}_{src|dst}.jpg   视觉审片用(q2)
    <outdir>/mx_{label}_face_{src|dst}.jpg  脸区放大 3x 预览
    stdout: markdown 表;并写 metrics-report.md + metrics-report.json

指标列:
    lap_src/lap_dst  脸区灰度 Laplacian 方差(锐度;越高越"锐")
    lap_ratio        dst/src(>1 更锐,<1 更糊/被平滑)
    rmse_face/psnr_face  脸区 RGB 对源均方根误差(0-255 尺度)/峰值信噪比
    rmse_full/psnr_full  整帧同指标(背景漂移参考)
"""
import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

FFMPEG = "ffmpeg"


def run_ffmpeg_extract(video: Path, frame: int, out_png: Path, out_jpg: Path | None) -> None:
    """按帧号精确抽帧: select=eq(n\\,N)(逗号必须转义,防被当滤镜分隔符)+ -fps_mode passthrough。"""
    vf = f"select=eq(n\\,{frame})"
    cmd = [FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
           "-i", str(video), "-vf", vf, "-fps_mode", "passthrough",
           "-frames:v", "1", str(out_png)]
    subprocess.run(cmd, check=True)
    if out_jpg is not None:
        subprocess.run([FFMPEG, "-hide_banner", "-loglevel", "error", "-y",
                        "-i", str(out_png), "-q:v", "2", str(out_jpg)], check=True)


def load_gray_rgb(path: Path):
    img = Image.open(path)
    rgb = np.asarray(img.convert("RGB"), dtype=np.float64)
    gray = np.asarray(img.convert("L"), dtype=np.float64)
    return gray, rgb


def laplacian_var(gray: np.ndarray) -> float:
    """4 邻域 Laplacian 卷积(零填充)后取方差 —— 锐度代理。"""
    p = np.pad(gray, 1, mode="edge")
    lap = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:] - 4.0 * gray)
    return float(lap.var())


def clamp_region(region, w, h):
    x1, y1, x2, y2 = region
    x1, y1 = max(0, int(x1)), max(0, int(y1))
    x2, y2 = min(w, int(x2)), min(h, int(y2))
    if x2 - x1 < 8 or y2 - y1 < 8:
        raise ValueError(f"region 过小或越界: {region} vs {w}x{h}")
    return x1, y1, x2, y2


def rmse_psnr(a: np.ndarray, b: np.ndarray):
    d = a - b
    rmse = float(np.sqrt(np.mean(d * d)))
    psnr = float("inf") if rmse == 0 else 20.0 * math.log10(255.0 / rmse)
    return rmse, psnr


def compare_pair(src_png: Path, dst_png: Path, region, label: str,
                 outdir: Path, jpg_preview: bool, face_crop: bool) -> dict:
    g_src, rgb_src = load_gray_rgb(src_png)
    g_dst, rgb_dst = load_gray_rgb(dst_png)
    h, w = g_src.shape
    if g_dst.shape != g_src.shape:
        print(f"[warn] {label}: 分辨率不一致 src={w}x{h} dst={g_dst.shape[1]}x{g_dst.shape[0]},"
              f" dst 已缩放到 src 尺寸(RMSE 方可解读)", file=sys.stderr)
        rgb_dst = np.asarray(
            Image.fromarray(rgb_dst.astype(np.uint8)).resize((w, h), Image.LANCZOS),
            dtype=np.float64)
        g_dst = np.asarray(
            Image.fromarray(g_dst.astype(np.uint8)).resize((w, h), Image.LANCZOS),
            dtype=np.float64)

    x1, y1, x2, y2 = clamp_region(region, w, h)
    lap_s = laplacian_var(g_src[y1:y2, x1:x2])
    lap_d = laplacian_var(g_dst[y1:y2, x1:x2])
    lap_ratio = lap_d / lap_s if lap_s > 0 else float("nan")
    rmse_f, psnr_f = rmse_psnr(rgb_src[y1:y2, x1:x2], rgb_dst[y1:y2, x1:x2])
    rmse_full, psnr_full = rmse_psnr(rgb_src, rgb_dst)

    if jpg_preview:
        for tag, arr in (("src", rgb_src), ("dst", rgb_dst)):
            Image.fromarray(arr.astype(np.uint8)).save(outdir / f"mx_{label}_{tag}.jpg", quality=92)
    if face_crop:
        # 脸区 3x 放大预览,便于视觉复核四官/口型/接缝
        for tag, arr in (("src", rgb_src), ("dst", rgb_dst)):
            crop = Image.fromarray(arr[y1:y2, x1:x2].astype(np.uint8))
            crop = crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS)
            crop.save(outdir / f"mx_{label}_face_{tag}.jpg", quality=92)

    return {
        "label": label, "region": [x1, y1, x2, y2],
        "lap_src": round(lap_s, 1), "lap_dst": round(lap_d, 1),
        "lap_ratio": round(lap_ratio, 3),
        "rmse_face": round(rmse_f, 2), "psnr_face": round(psnr_f, 2) if math.isfinite(psnr_f) else "inf",
        "rmse_full": round(rmse_full, 2), "psnr_full": round(psnr_full, 2) if math.isfinite(psnr_full) else "inf",
    }


def md_table(rows):
    head = ("| label | lap_src | lap_dst | lap_ratio | rmse_face | psnr_face |"
            " rmse_full | psnr_full |")
    sep = "|---|---|---|---|---|---|---|---|"
    body = "\n".join(
        f"| {r['label']} | {r['lap_src']} | {r['lap_dst']} | {r['lap_ratio']} "
        f"| {r['rmse_face']} | {r['psnr_face']} | {r['rmse_full']} | {r['psnr_full']} |"
        for r in rows)
    return "\n".join([head, sep, body])


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src", help="源(基准)视频")
    ap.add_argument("--dst", help="被检(处理后)视频")
    ap.add_argument("--plan", help="JSON 计划: [{frame,label,region},...]")
    ap.add_argument("--frames", help="逗号分隔帧号列表(用法 B)")
    ap.add_argument("--labels", help="逗号分隔标签,与 --frames 对应(可省,默认 f{帧号})")
    ap.add_argument("--region", help="x1,y1,x2,y2 全分辨率像素(用法 B,所有帧共用)")
    ap.add_argument("--margin", type=int, default=0, help="region 四边外扩像素数(默认 0)")
    ap.add_argument("--src-img", help="用法 C: 已有源图")
    ap.add_argument("--dst-img", help="用法 C: 已有被检图")
    ap.add_argument("--label", default="pair", help="用法 C 标签")
    ap.add_argument("--outdir", default=".", help="输出目录(默认当前)")
    ap.add_argument("--prefix", default="", help="计划中每项可另给 prefix,此处为全局备用")
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    tasks = []  # (label, region, src_png, dst_png)

    if args.plan:  # 用法 A
        plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
        for item in plan:
            n, lab = int(item["frame"]), item.get("label", f"f{item['frame']}")
            reg = item["region"]
            if args.margin:
                reg = [reg[0] - args.margin, reg[1] - args.margin,
                       reg[2] + args.margin, reg[3] + args.margin]
            s_png = outdir / f"mx_{lab}_src.png"
            d_png = outdir / f"mx_{lab}_dst.png"
            run_ffmpeg_extract(Path(args.src), n, s_png, outdir / f"mx_{lab}_src.jpg")
            run_ffmpeg_extract(Path(args.dst), n, d_png, outdir / f"mx_{lab}_dst.jpg")
            tasks.append((lab, reg, s_png, d_png))
    elif args.frames:  # 用法 B
        if not args.region:
            ap.error("用法 B 需要 --region")
        regs = [int(v) for v in args.region.split(",")]
        if args.margin:
            regs = [regs[0] - args.margin, regs[1] - args.margin,
                    regs[2] + args.margin, regs[3] + args.margin]
        nums = [int(v) for v in args.frames.split(",")]
        labs = args.labels.split(",") if args.labels else [f"f{n}" for n in nums]
        if len(labs) != len(nums):
            ap.error("--labels 数量与 --frames 不一致")
        for n, lab in zip(nums, labs):
            s_png = outdir / f"mx_{lab}_src.png"
            d_png = outdir / f"mx_{lab}_dst.png"
            run_ffmpeg_extract(Path(args.src), n, s_png, outdir / f"mx_{lab}_src.jpg")
            run_ffmpeg_extract(Path(args.dst), n, d_png, outdir / f"mx_{lab}_dst.jpg")
            tasks.append((lab, regs, s_png, d_png))
    elif args.src_img and args.dst_img:  # 用法 C
        reg = json.loads(args.region) if args.region.startswith("[") else \
            [int(v) for v in args.region.split(",")]
        if args.margin:
            reg = [reg[0] - args.margin, reg[1] - args.margin,
                   reg[2] + args.margin, reg[3] + args.margin]
        tasks.append((args.label, reg, Path(args.src_img), Path(args.dst_img)))
    else:
        ap.error("需要 --plan,或 --frames+--region,或 --src-img+--dst-img")

    rows = [compare_pair(s, d, reg, lab, outdir,
                         jpg_preview=bool(args.plan or args.frames), face_crop=True)
            for lab, reg, s, d in tasks]

    table = md_table(rows)
    print(table)
    (outdir / "metrics-report.md").write_text(
        "# metrics report\n\n```\nsrc: %s\ndst: %s\n```\n\n%s\n"
        % (args.src or args.src_img, args.dst or args.dst_img, table),
        encoding="utf-8")
    (outdir / "metrics-report.json").write_text(
        json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n[written] {outdir/'metrics-report.md'} , {outdir/'metrics-report.json'}")


if __name__ == "__main__":
    main()
