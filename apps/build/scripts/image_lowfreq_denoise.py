#!/usr/bin/env python3
"""纯图像高低频去噪(PS 法脚本化, gpt-image-noise-repair Phase 2)。

原理(B 站 BV1vG8m6vETh 评论区最高赞"溜达猫ovo"方案):
  低频层 = 表面模糊(近似)→去斑驳霉斑;高频层按强度阈值衰减→保线稿细节;
  结果 = 低频 + 衰减后高频。不变形、秒级、零 GPU。

实现:
  low   = 双边滤波(保边平滑,近似 PS 表面模糊)
  high  = gray - low(残差)
  衰减  = high * shrink(仅对幅值<strength 的细颗粒强衰减,大幅值线稿保留):
    soft = clip(|high|/strength,0,1); gain = keep + (1-keep)*soft
    out  = low + high*gain   (per-channel,亮度域为主,色度残差额外压制)
  chroma:HSV 饱和度残差 > blotch_strength 的孤立色斑按比例压回低频。

用法:
  单图:  python3 image_lowfreq_denoise.py in.png -o out.png [--strength 6] [--keep 0.25]
  批量:  python3 image_lowfreq_denoise.py --batch DIR_OR_FILELIST -o OUTDIR
  对拍:  加 --sidecar 会另存 _compare.png(左原右洗)
默认参数为审计口径的"轻度"档(strength=6, keep=0.25)。
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


def bilateral(a: np.ndarray, radius: int = 4, sigma_s: float = 4.0, sigma_r: float = 25.0) -> np.ndarray:
    """numpy 移位窗口双边滤波(=PS 表面模糊本尊)。1024 边长约 0.6s。"""
    out = np.zeros_like(a)
    wsum = np.zeros(a.shape[:2] + (1,), dtype=np.float32)
    gs = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * sigma_s**2))
    for di in range(-radius, radius + 1):
        for dj in range(-radius, radius + 1):
            sh = np.roll(np.roll(a, di, axis=0), dj, axis=1)
            dr = np.linalg.norm(sh - a, axis=2, keepdims=True)
            wgt = gs[abs(di)] * gs[abs(dj)] * np.exp(-(dr**2) / (2 * sigma_r**2))
            out += sh * wgt
            wsum += wgt
    return out / wsum


def denoise(
    im: Image.Image,
    strength: float = 12.0,
    keep: float = 0.3,
    blotch_strength: float = 10.0,
    radius: int = 4,
) -> Image.Image:
    a = np.asarray(im.convert("RGB"), dtype=np.float32)
    # 低频 = 双边滤波(保边表面模糊)。迭代教训:
    #  v1 median+SMOOTH 级联→线稿糊+HSV fromarray 漏 mode 参数→全局色偏,均打回;
    #  v3 median-only 色正但降幅 13% 不够;双边版视觉验收通过(2026-08-29 对拍)。
    low = bilateral(a, radius=radius)
    high = a - low
    # 高频软阈值:细颗粒(gpt-image 噪点/霉斑)衰减到 keep,线稿(幅值大)基本保留
    mag = np.abs(high).max(axis=2, keepdims=True)
    soft = np.clip(mag / max(strength, 1e-3), 0.0, 1.0)
    gain = keep + (1.0 - keep) * soft
    out = low + high * gain
    # 色斑压制:只削饱和度残差超出 blotch_strength 的部分(保守,勿整层混合)。
    hsv = np.asarray(im.convert("HSV"), dtype=np.float32)
    hsv_low = np.asarray(Image.fromarray(low.astype(np.uint8)).convert("HSV"), dtype=np.float32)
    res_s = hsv[:, :, 1] - hsv_low[:, :, 1]
    excess = np.abs(res_s) - blotch_strength
    target = hsv_low[:, :, 1] + np.sign(res_s) * np.minimum(np.abs(res_s), blotch_strength)
    blotch = np.clip(excess / 30.0, 0.0, 0.5) * (np.abs(res_s) > blotch_strength)
    sat = hsv[:, :, 1] * (1 - blotch) + target * blotch
    out_hsv = np.asarray(Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).convert("HSV"), dtype=np.float32)
    out_hsv[:, :, 1] = sat
    # 必须显式 mode="HSV":fromarray 对三通道 uint8 默认按 RGB 解读,HSV 数组被误读(全局色偏根因)
    out = np.asarray(Image.fromarray(out_hsv.astype(np.uint8), mode="HSV").convert("RGB"), dtype=np.float32)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def sidecar(orig: Image.Image, clean: Image.Image, path: Path) -> None:
    h = max(orig.height, clean.height)
    pair = Image.new("RGB", (orig.width + clean.width, h), "white")
    pair.paste(orig, (0, 0))
    pair.paste(clean, (orig.width, 0))
    pair.save(path)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--strength", type=float, default=12.0)
    ap.add_argument("--keep", type=float, default=0.3)
    ap.add_argument("--blotch-strength", type=float, default=10.0)
    ap.add_argument("--batch", action="store_true", help="input 为目录时批量递归")
    ap.add_argument("--sidecar", action="store_true")
    args = ap.parse_args()

    src = Path(args.input)
    outs = Path(args.out)
    targets: list[Path]
    if args.batch and src.is_dir():
        targets = [p for p in sorted(src.rglob("*")) if p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp")]
        outs.mkdir(parents=True, exist_ok=True)
    else:
        targets = [src]
        outs.parent.mkdir(parents=True, exist_ok=True)
    for p in targets:
        try:
            im = Image.open(p).convert("RGB")
        except Exception as e:
            print(f"skip {p.name}: {e}", file=sys.stderr)
            continue
        clean = denoise(im, args.strength, args.keep, args.blotch_strength)
        dest = outs / p.name if args.batch else outs
        clean.save(dest)
        if args.sidecar:
            sidecar(im, clean, dest.with_name(dest.stem + "_compare.png"))
        print(f"ok {dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
