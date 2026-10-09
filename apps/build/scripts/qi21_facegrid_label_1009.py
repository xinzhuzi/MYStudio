#!/usr/bin/env python3
"""表情差分九宫格:标注预览图 + 九切独立件(1009)。

问题:九宫格素材本体干净(无字),但「哪格是哪个表情」无标签——用户看不出
对应关系,也无法核对模型是否按提示词规定的阅读序(左→右、上→下)落格。

本件零模型参与,纯后处理:
1. 切缝检测:对 alpha 做行/列投影,找格子间透明沟(整行/列近全透)=真缝;
   检测不到(格子无边距)则退回三等分;
2. 标注预览:<名>.标注.png = 原图 + 每格底部半透明标签条(序号+情绪名);
3. 九切件:<名>九切/NN情绪.png 逐格独立输出(透明底保留,产线素材直接可用)。

情绪序=§8 主体句规定序(沉静/含笑/怒/哀/惧/凌厉/惊讶/害羞/决然),
阅读序=左→右、上→下。标签贴的是「规定序」;模型若乱序,对照标签一眼可辨。

用法:python3 qi21_facegrid_label_1009.py [--img path] [--label 表情差分]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
OUT_DIR = REPO / "apps/output/bgscope-r3-9types"
EMOTIONS = ["沉静", "含笑", "怒", "哀", "惧", "凌厉", "惊讶", "害羞", "决然"]
FONT_CANDIDATES = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Light.ttc",
]


def _cuts(proj, size, n=3):
    """返回 n-1 个内缝切点(缝=alpha 占比近零的连续带,限 15%~85% 画幅内);
    找不齐则退回三等分。"""
    low = proj < 0.04
    bands, i = [], 0
    while i < len(low):
        if low[i]:
            j = i
            while j + 1 < len(low) and low[j + 1]:
                j += 1
            bands.append((i, j))
            i = j + 1
        else:
            i += 1
    inner = [(a, b) for a, b in bands
             if size * 0.15 < (a + b) / 2 < size * 0.85 and b - a >= 2]
    if not inner:
        return [round(size * (k + 1) / n) for k in range(n - 1)]
    picks = []
    for k in range(1, n):
        w = size * k / n
        best = min(inner, key=lambda ab: abs((ab[0] + ab[1]) / 2 - w))
        if best not in picks and abs((best[0] + best[1]) / 2 - w) < size * 0.12:
            picks.append(best)
    if len(picks) == n - 1:
        return sorted((a + b) // 2 for a, b in picks)
    return [round(size * (k + 1) / n) for k in range(n - 1)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--img", default=str(OUT_DIR / "表情差分.png"))
    ap.add_argument("--label", default="表情差分")
    args = ap.parse_args()

    src = Image.open(args.img).convert("RGBA")
    W, H = src.size
    alpha = src.getchannel("A")
    import numpy as np
    a = np.array(alpha).astype(float) / 255.0
    xs = _cuts(a.mean(axis=0), W)
    ys = _cuts(a.mean(axis=1), H)
    thirds = ([W // 3, 2 * W // 3] == xs) and ([H // 3, 2 * H // 3] == ys)
    xbounds = [0, *xs, W]
    ybounds = [0, *ys, H]

    font = None
    for fp in FONT_CANDIDATES:
        if Path(fp).exists():
            font = ImageFont.truetype(fp, max(20, H // 36))
            break
    assert font, "无可用中文字体"

    # 标注预览:每格底部半透明条 + 序号/情绪名
    prev = src.copy()
    d = ImageDraw.Draw(prev)
    for r in range(3):
        for c in range(3):
            x0, x1 = xbounds[c], xbounds[c + 1]
            y0, y1 = ybounds[r], ybounds[r + 1]
            i = r * 3 + c
            text = f"{i + 1}·{EMOTIONS[i]}"
            bar_h = font.size + 16
            bar = Image.new("RGBA", (x1 - x0, bar_h), (20, 20, 20, 200))
            bd = ImageDraw.Draw(bar)
            bd.text((10, 8), text, font=font, fill=(255, 235, 120, 255))
            prev.alpha_composite(bar, (x0, y1 - bar_h))
    prev_out = Path(args.img).with_name(f"{args.label}.标注.png")
    prev.save(prev_out)

    # 九切独立件(干净素材,零标注)
    cell_dir = Path(args.img).with_name(f"{args.label}九切")
    cell_dir.mkdir(exist_ok=True)
    names = []
    for r in range(3):
        for c in range(3):
            i = r * 3 + c
            cell = src.crop((xbounds[c], ybounds[r], xbounds[c + 1], ybounds[r + 1]))
            p = cell_dir / f"{i + 1:02d}{EMOTIONS[i]}.png"
            cell.save(p)
            names.append(p.name)

    print(f"切缝: x={xs} y={ys}({'三等分退回(未检出内缝)' if thirds else '检出透明内缝'})")
    # 几何体检:每格不透明占比应>5%(九格全有内容)
    for r in range(3):
        occ = []
        for c in range(3):
            cell = a[ybounds[r]:ybounds[r + 1], xbounds[c]:xbounds[c + 1]]
            occ.append(f"{(cell >= 0.97).mean() * 100:4.1f}")
        print(f"  行{r + 1} 各格实块%: {' '.join(occ)}")
    print(f"标注预览 → {prev_out}")
    print(f"九切件({len(names)}) → {cell_dir}/")
    for n in names:
        print(f"  {n}")


if __name__ == "__main__":
    main()
