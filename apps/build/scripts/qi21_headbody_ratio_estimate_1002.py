#!/usr/bin/env python3
# ⑥㉒头身比程序初裁(2026-10-02):剪影法估计头高/身高→头身比。
# 背景=宣纸白+淡彩山水(浅色),主体=浓墨线条人物(深色)→行覆盖法:
#   crown=首个覆盖行;feet=末个覆盖行;neck=头部区内行覆盖局部极小(颊宽→颈窄);
#   头身比=(feet-crown)/(neck-crown)。服装/发髻有偏,数值=程序初裁(人眼终审留用户)。
# 用法:python3 qi21_headbody_ratio_estimate_1002.py <png> [<png> ...]  → JSON on stdout
from __future__ import annotations

import json
import sys

import numpy as np
from PIL import Image


def estimate(path: str) -> dict:
    im = Image.open(path).convert("RGB")
    if im.width > 480:
        im = im.resize((480, int(im.height * 480 / im.width)), Image.LANCZOS)
    a = np.asarray(im).astype(np.float64)
    h, w, _ = a.shape
    lum = a @ np.array([0.299, 0.587, 0.114])
    # Otsu 阈值分深(主体墨线/衣)浅(纸底/淡彩);人物=深色大块
    hist, _ = np.histogram(lum, bins=256, range=(0, 256))
    total = lum.size
    best_t, best_var = 0, -1.0
    w0 = 0.0
    sum_all = (np.arange(256) * hist).sum()
    s0 = 0.0
    for t in range(256):
        w0 += hist[t]
        if w0 == 0:
            continue
        w1 = total - w0
        if w1 == 0:
            break
        s0 += t * hist[t]
        m0, m1 = s0 / w0, (sum_all - s0) / w1
        var = w0 * w1 * (m0 - m1) ** 2
        if var > best_var:
            best_var, best_t = var, t
    fg = lum < best_t
    # 最大连通块(scipy.ndimage),取含画面中部者(人物居中;远山/近石多为碎块)
    from scipy import ndimage
    lab, n = ndimage.label(fg)
    if n == 0:
        return {"png": path, "error": "零前景"}
    mid = lab[int(h * 0.45), int(w * 0.5)]
    sizes = ndimage.sum(fg, lab, range(1, n + 1))
    # 候选=中部标签或前三大块中最居中者
    def center_score(l):
        ys, xs = np.where(lab == l)
        if len(ys) == 0:
            return -1e9, None
        return -abs(xs.mean() - w / 2) - abs(ys.mean() - h * 0.5) * 0.3, (ys, xs)
    cand = sorted(range(1, n + 1), key=lambda l: -sizes[l - 1])[:6]
    if mid:
        cand = [mid] + [c for c in cand if c != mid]
    best, best_score, best_ys = None, -1e18, None
    for l in cand:
        sc, yx = center_score(l)
        if yx is None:
            continue
        ys, xs = yx
        if len(ys) < h * w * 0.01:
            continue
        if sc > best_score:
            best, best_score, best_ys = l, sc, (ys, xs)
    if best is None:
        return {"png": path, "error": "无居中主体块"}
    ys, xs = best_ys
    m = lab == best
    cov = m.sum(axis=1).astype(float)
    thr = max(2.0, w * 0.012)
    rows = np.where(cov > thr)[0]
    if len(rows) < 40:
        return {"png": path, "error": "主体行不足"}
    crown, feet = int(rows[0]), int(rows[-1])
    fig_h = feet - crown
    cs = np.convolve(cov, np.ones(5) / 5, mode="same")
    # 头峰=前 15% 身高内的覆盖峰(颅/颊+发);肩峰在其后——旧版取全区 argmax 会
    # 锚到肩袖,颈谷(头部峰后首个 <75% 头峰的局部极小)永远扫不到(1002 实调试错)
    head_win_end = crown + max(8, int(fig_h * 0.15))
    seg = cs[crown:head_win_end]
    peak = int(np.argmax(seg)) + crown
    neck = peak
    for y in range(peak + 2, crown + int(fig_h * 0.35)):
        if cs[y] < cs[y - 1] and cs[y] <= cs[y + 1] and cs[y] < seg.max() * 0.75:
            neck = y
            break
    head_h = neck - crown
    ratio = fig_h / head_h if head_h > 4 else None
    def width_at(y):
        r = np.where(m[y])[0]
        return (r[-1] - r[0] + 1) if len(r) else 0
    head_w = max(width_at(y) for y in range(crown, min(neck + 2, h)) if m[y].any())
    sh_lo, sh_hi = crown + int(fig_h * 0.28), crown + int(fig_h * 0.55)
    shoulder_w = max(width_at(y) for y in range(sh_lo, min(sh_hi, h)) if m[y].any())
    return {
        "png": path.split("/")[-1], "size": [im.width, im.height], "otsu_t": int(best_t),
        "crown_px": crown, "neck_px": neck, "feet_px": feet,
        "head_height_px": head_h, "figure_height_px": fig_h,
        "head_body_ratio": round(ratio, 2) if ratio else None,
        "head_width_px": int(head_w), "shoulder_width_px": int(shoulder_w),
        "head_over_shoulder": round(head_w / shoulder_w, 2) if shoulder_w else None,
        "method": "Otsu 剪影行覆盖(crown/neck/feet);程序初裁,人眼终审留用户",
    }


if __name__ == "__main__":
    print(json.dumps([estimate(p) for p in sys.argv[1:]], ensure_ascii=False, indent=1))
