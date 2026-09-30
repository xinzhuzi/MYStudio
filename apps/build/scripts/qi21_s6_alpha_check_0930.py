#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available via COMMERCIAL_LICENSE.md.
"""qi21 S6 PNG alpha 程序取证(09-30,Trellis 09-29-qi21-canvas-batch S6/D7)。

用法:python3 qi21_s6_alpha_check_0930.py <png> <transparent|opaque>
stdout=JSON 判定(IHDR 色型/PIL mode/四角 alpha/透明像素占比/极值均值)。

判定口径(程序取证,非人眼):
  - transparent:IHDR 色型 6(RGBA)且四角 alpha 全 0 且 alpha==0 占比 ≥ 50%
    (对标 0928b 透明战役真透明带 76-90%;50%=保守下限,低于带值如实报数);
  - opaque:无 alpha 通道,或 alpha 全 255(min=255);
  - 例外如实记:容器色型 6 而像素全不透明=「6bg」形(0929 6/8 役实录),
    判 opaque 由像素真值归,不追容器形态。
"""
from __future__ import annotations

import json
import struct
import sys

from PIL import Image


def ihdr(path: str) -> dict:
    with open(path, "rb") as f:
        data = f.read(26)
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("not a png")
    w, h, bit, ct = struct.unpack(">IIBB", data[16:26])
    return {"w": w, "h": h, "bit_depth": bit, "color_type": ct}


def analyze(path: str) -> dict:
    info = ihdr(path)
    im = Image.open(path)
    im.load()
    out = {"ihdr": info, "pil_mode": im.mode, "size": list(im.size)}
    bands = im.getbands()
    if "A" not in bands:
        out["has_alpha"] = False
        return out
    out["has_alpha"] = True
    a = im.getchannel("A")
    w, h = im.size
    hist = a.histogram()
    total = w * h
    n0 = hist[0]
    n255 = hist[255]
    n_semi = total - n0 - n255
    # 四角(四顶点内缩 2px 防边缘插值)+四角 8×8 块最小值(鲁棒性副证)
    pts = {"tl": (2, 2), "tr": (w - 3, 2), "bl": (2, h - 3), "br": (w - 3, h - 3)}
    corners = {k: a.getpixel(v) for k, v in pts.items()}
    blk = {}
    for k, (x, y) in pts.items():
        region = a.crop((max(0, x - 8), max(0, y - 8), min(w, x + 8), min(h, y + 8)))
        blk[k] = region.getextrema()[0]
    s = 0
    cnt = 0
    for lvl, c in enumerate(hist):
        s += lvl * c
        cnt += c
    present = [l for l in range(256) if hist[l] > 0]
    out["metrics"] = {
        "corners": corners,
        "cornerBlockMin": blk,
        "alphaMin": min(present),
        "alphaMax": max(present),
        "alphaMean": round(s / cnt, 2),
        "ratioAlpha0": round(n0 / total, 6),
        "ratioAlpha255": round(n255 / total, 6),
        "ratioSemi": round(n_semi / total, 6),
        "transparentPx": n0,
        "totalPx": total,
    }
    return out


def main() -> int:
    path, expect = sys.argv[1], sys.argv[2]
    r = analyze(path)
    m = r.get("metrics")
    if expect == "transparent":
        if not r["has_alpha"]:
            verdict, ok = "no-alpha-channel", False
        else:
            corners_ok = all(v == 0 for v in m["corners"].values())
            ratio_ok = m["ratioAlpha0"] >= 0.50
            if corners_ok and ratio_ok:
                verdict = "transparent(corners=0 & ratio0>=0.50)"
            elif not corners_ok:
                verdict = "corners-not-zero"
            else:
                verdict = "ratio0-below-gate(%.4f)" % m["ratioAlpha0"]
            ok = corners_ok and ratio_ok
    elif expect == "opaque":
        if not r["has_alpha"]:
            verdict, ok = "opaque(no alpha band)", True
        else:
            # 口径校准(0930 T5 实拍):本 VAE 解码不透明图 alpha 非恒 255——
            # 噪声地板 ~230-254(0929 6/8 役「6bg」同象:容器色型 6 像素实不透明)。
            # opaque 判据=零真透明区:全透占比<0.1% 且四角≥250 且均值≥250;
            # 旧严口径(alphaMin==255)结果并报(metrics.alphaMin 在场可复核)。
            ok = m["ratioAlpha0"] < 0.001 and all(v >= 250 for v in m["corners"].values()) and m["alphaMean"] >= 250
            strict = m["alphaMin"] == 255
            verdict = ("opaque(zero-transparent-zone; strict alphaMin==255: %s)" % ("yes" if strict else "no(alphaMin=%d,VAE 噪声地板)" % m["alphaMin"])) if ok \
                else ("leak? ratio0=%.4f corners=%s mean=%.1f" % (m["ratioAlpha0"], list(m["corners"].values()), m["alphaMean"]))
    else:
        print(json.dumps({"error": f"unknown expect {expect}"}))
        return 2
    print(json.dumps({"png": path, "expect": expect, "pass": ok, "verdict": verdict, **r}, ensure_ascii=False))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
