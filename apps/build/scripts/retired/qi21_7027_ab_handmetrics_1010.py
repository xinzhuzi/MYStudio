#!/usr/bin/env python3
"""7027 A/B 双臂产物:手部区裁片+像素指标(1010)。

两臂同 seed 同构图,同尺寸裁片框(人物中下区手带);指标:
- Laplacian 方差(细节/锐度)
- Sobel 边缘密度(结构线条密度)
- 色彩度 Hasler-Süsstrunk(风格鲜艳度)
- 灰度均值/标准差
全图+手部区分别计算;裁片落盘。
"""
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

D = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/fisher-pose-test/7027ab")


def laplacian_var(gray):
    a = np.asarray(gray, dtype=np.float64)
    lap = (a[:-2, 1:-1] + a[2:, 1:-1] + a[1:-1, :-2] + a[1:-1, 2:] - 4 * a[1:-1, 1:-1])
    return float(lap.var())


def sobel_edge_density(gray):
    a = np.asarray(gray, dtype=np.float64)
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    gx[:, 1:-1] = a[:, 2:] - a[:, :-2]
    gy[1:-1, :] = a[2:, :] - a[:-2, :]
    mag = np.hypot(gx, gy)
    return float((mag > 40).mean())


def colorfulness(rgb):
    a = np.asarray(rgb, dtype=np.float64)
    rg = a[:, :, 0] - a[:, :, 1]
    yb = 0.5 * (a[:, :, 0] + a[:, :, 1]) - a[:, :, 2]
    return float(math.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * math.sqrt(rg.mean() ** 2 + yb.mean() ** 2))


def metrics(img):
    rgb = img.convert("RGB")
    gray = img.convert("L")
    a = np.asarray(gray, dtype=np.float64)
    return {"laplacian_var": round(laplacian_var(gray), 1),
            "edge_density": round(sobel_edge_density(gray), 4),
            "colorfulness": round(colorfulness(rgb), 1),
            "gray_mean": round(float(a.mean()), 1), "gray_std": round(float(a.std()), 1)}


W, H = 1920, 832
# 人物中下区手带:横取中带,竖取中下(垂手/腰间剑柄高度)
BOXES = {
    "handband_mid_lower": (int(W * 0.25), int(H * 0.35), int(W * 0.75), int(H * 0.80)),
    "hand_left_third": (int(W * 0.20), int(H * 0.35), int(W * 0.47), int(H * 0.80)),
    "hand_right_third": (int(W * 0.53), int(H * 0.35), int(W * 0.80), int(H * 0.80)),
    "hand_tight_core": (int(W * 0.30), int(H * 0.45), int(W * 0.70), int(H * 0.72)),
}

out = {}
for arm, name in (("A", "A-bypass"), ("B", "B-inchain")):
    img = Image.open(D / f"{name}.png")
    assert img.size == (W, H), f"{name} 尺寸异常 {img.size}"
    rec = {"full": metrics(img), "boxes": {}}
    for bname, box in BOXES.items():
        crop = img.crop(box)
        crop.save(D / f"{name}.{bname}.png")
        rec["boxes"][bname] = {"box": box, **metrics(crop)}
    out[name] = rec

D.joinpath("pixel-metrics.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(out, ensure_ascii=False, indent=1))
