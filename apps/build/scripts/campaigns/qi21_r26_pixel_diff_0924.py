#!/usr/bin/env python3
"""R26.4 开/关差分·像素带对账(0924;引擎 venv PIL;文件级,禁视觉读图)。

A=开态 4 步(LoRA=true) ~/Downloads/q21-final-0924/r26/r26-t2i-on-seed0-4step.png
B=关态 4 步(LoRA=false,差分实验件) /tmp/r26-disc-4step-off.png
同 seed=0 同 steps=4 唯一变量=LoRA 开关。
判据:16 横带 RGB 均值差 + 全图平均绝对差(AAD,0-255):
  AAD ≥ 1.0 → A≠B → LoRA 真加载生效(权重改变采样轨迹);
  AAD < 0.01 → 逐像素同 → LoRA 静默 no-op(硬红)。
用法: "<comfy-home>/venv/bin/python" qi21_r26_pixel_diff_0924.py <A.png> <B.png> <out.json>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image

A = Path(sys.argv[1])
B = Path(sys.argv[2])
OUT = Path(sys.argv[3]) if len(sys.argv) > 3 else None
BANDS = 16


def bands(img: Image.Image) -> list[list[float]]:
    g = img.convert("RGB")
    w, h = g.size
    out = []
    step = h // BANDS
    px = g.load()
    for bi in range(BANDS):
        y0, y1 = bi * step, (bi + 1) * step if bi < BANDS - 1 else h
        acc = [0.0, 0.0, 0.0]
        n = (y1 - y0) * w
        for y in range(y0, y1, 4):          # 行抽样 1/4(统计口径足够)
            for x in range(0, w, 4):
                p = px[x, y]
                acc[0] += p[0]; acc[1] += p[1]; acc[2] += p[2]
            # 按抽样行数折算
        rows = len(range(y0, y1, 4))
        cols = len(range(0, w, 4))
        m = rows * cols
        out.append([round(a / m, 3) for a in acc])
    return out


def aad(a: Image.Image, b: Image.Image) -> dict:
    ga, gb = a.convert("RGB").resize((228, 304), Image.NEAREST), b.convert("RGB").resize((228, 304), Image.NEAREST)
    pa, pb = ga.load(), gb.load()
    tot = maxd = 0.0
    cnt = 0
    for y in range(304):
        for x in range(228):
            d = abs(pa[x, y][0] - pb[x, y][0]) + abs(pa[x, y][1] - pb[x, y][1]) + abs(pa[x, y][2] - pb[x, y][2])
            tot += d / 3
            maxd = max(maxd, d / 3)
            cnt += 1
    return {"aad": round(tot / cnt, 4), "max_band_diff_px": round(maxd, 1)}


def main() -> int:
    ia, ib = Image.open(A), Image.open(B)
    ba, bb = bands(ia), bands(ib)
    band_diffs = [[round(bb[i][c] - ba[i][c], 3) for c in range(3)] for i in range(BANDS)]
    flat = [abs(v) for row in band_diffs for v in row]
    res = {
        "a": str(A), "b": str(B),
        "size_a": list(ia.size), "size_b": list(ib.size),
        "band_mean_diff_max": max(flat),
        "band_mean_diff_avg": round(sum(flat) / len(flat), 4),
        "pixel_aad": aad(ia, ib),
        "verdict_hint": None,
    }
    ad = res["pixel_aad"]["aad"]
    res["verdict_hint"] = (
        "A≠B → LoRA 真加载生效" if ad >= 1.0 else
        ("A≡B 逐像素级同 → LoRA 静默 no-op(硬红)" if ad < 0.01 else "弱差(边际态,人工判读数值)")
    )
    print(json.dumps(res, ensure_ascii=False, indent=2))
    if OUT:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
