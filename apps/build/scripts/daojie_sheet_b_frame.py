#!/usr/bin/env python3
"""daojie_sheet_b_frame.py — 设定卡 B 线固定底框合成(1112 用户令:固定底框+分格图生图)。

架构定位:框/格线/全部角标文字/题名=程序绘(零缺笔零印章,结构性根除 1110「发型」
残字一类模型天花板);格内画面=管线(daojie_sheet_b_pipeline)分格生成后 fit-crop 裁贴。
几何=K 版型文版式口径(qi21_bases.json 设定卡条:标题带通栏/左列约三成三视图竖排/
右列约七成三行=六格特写带+配色带+底部四区 40:20:20:20)。

本件纯 PIL 零引擎依赖,可离线自检:python3 daojie_sheet_b_frame.py --selftest
用法(管线侧 import compose):compose(cells, palette, title, dst)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

# ── 画布与版式常量(3840×2160=设定卡 resolution_override 口径,32 对齐)──
W, H = 3840, 2160
M = 36          # 外边距
G = 20          # 格间距
BAND_H = 216    # 标题带高(≈一成)
LEFT_W = 1063   # 左列宽(三成:round((W-2M-G)*0.30))
PAPER = (247, 243, 234)      # 宣纸米白
INK_LINE = (107, 101, 90)    # 细线边框
INK_TEXT = (44, 39, 32)      # 角标/题名墨色

TITLE_SIZE = round(BAND_H * 0.62)   # 题名字号(题名后叠件同口径)
LABEL_SIZE = 36                      # 角标字号(4K 画布可辨下限)

# 格名→(行,列语义)登记;compose 断言缺格即红(半成品卡禁出门)
CELL_KEYS = (
    "front", "side", "back",                    # 左列三视图
    "face", "head", "eye", "hair", "wrist", "waist",   # 右列六格
    "weapon", "weapon_a", "weapon_b",           # 四区·武器(整器+两局部)
    "fabric_1", "fabric_2", "fabric_3",         # 四区·服饰纹理三样
    "gear_1", "gear_2",                         # 四区·装备细节两格
    "fx_1", "fx_2",                             # 四区·能力两格
)


def _font(size: int) -> ImageFont.FreeTypeFont:
    """中文字体链(题名后叠件同款:楷体→冬黑→苹方)。"""
    for fp in ("/System/Library/Fonts/STKaiti.ttc",
               "/System/Library/Fonts/Hiragino Sans GB.ttc",
               "/System/Library/Fonts/PingFang.ttc"):
        if os.path.exists(fp):
            return ImageFont.truetype(fp, size)
    raise SystemExit("[FAIL] 无可用中文字体")


def layout() -> dict:
    """版式几何:(x0,y0,x1,y1) 格矩全集,K 版口径。"""
    cells: dict = {}
    top = M + BAND_H + G
    main_h = H - M - top
    # 左列三视图竖排(上下摞放成一竖列)
    ch = (main_h - 2 * G) // 3
    for i, k in enumerate(("front", "side", "back")):
        y = top + i * (ch + G)
        cells[k] = (M, y, M + LEFT_W, y + ch)
    # 右列三行
    rx0 = M + LEFT_W + G
    rw = W - M - rx0
    r1_h = round(main_h * 0.55)
    r2_h = round(main_h * 0.13)
    r3_h = main_h - r1_h - r2_h - 2 * G
    # 行一:六格特写横排
    cw = (rw - 5 * G) // 6
    for i, k in enumerate(("face", "head", "eye", "hair", "wrist", "waist")):
        x = rx0 + i * (cw + G)
        cells[k] = (x, top, x + cw, top + r1_h)
    # 行二:配色带(标签+五圆,无格;矩形留给管线画圆)
    y2 = top + r1_h + G
    cells["_palette"] = (rx0, y2, W - M, y2 + r2_h)
    # 行三:四区 40:20:20:20
    y3 = y2 + r2_h + G
    zw = (rw - 3 * G)
    z1w = round(zw * 0.40)
    zsw = (zw - z1w) // 3
    x = rx0
    z1 = (x, y3, x + z1w, y3 + r3_h); x += z1w + G
    z2 = (x, y3, x + zsw, y3 + r3_h); x += zsw + G
    z3 = (x, y3, x + zsw, y3 + r3_h); x += zsw + G
    z4 = (x, y3, W - M, y3 + r3_h)
    # 区一·武器展示:左幅整器+右侧上下两局部
    inner_w = z1[2] - z1[0] - G
    ww = round(inner_w * 0.55)
    ih = (r3_h - G) // 2
    cells["weapon"] = (z1[0], y3, z1[0] + ww, y3 + r3_h)
    cells["weapon_a"] = (z1[0] + ww + G, y3, z1[2], y3 + ih)
    cells["weapon_b"] = (z1[0] + ww + G, y3 + ih + G, z1[2], y3 + r3_h)
    # 区二·服饰纹理:纵向三枚
    sh = (r3_h - 2 * G) // 3
    for i, k in enumerate(("fabric_1", "fabric_2", "fabric_3")):
        y = y3 + i * (sh + G)
        cells[k] = (z2[0], y, z2[2], y + sh)
    # 区三·装备细节:上下两格
    cells["gear_1"] = (z3[0], y3, z3[2], y3 + ih)
    cells["gear_2"] = (z3[0], y3 + ih + G, z3[2], y3 + r3_h)
    # 区四·能力:上下两格
    cells["fx_1"] = (z4[0], y3, z4[2], y3 + ih)
    cells["fx_2"] = (z4[0], y3 + ih + G, z4[2], y3 + r3_h)
    return cells


LABELS = {
    "front": "正视图", "side": "侧视图", "back": "背视图",
    "face": "面部特写", "head": "头部细节", "eye": "眉眼", "hair": "发型",
    "wrist": "腕部", "waist": "腰部",
    "weapon": "武器展示", "weapon_a": "握持部位", "weapon_b": "收存结构",
    "fabric_1": "服饰纹理", "gear_1": "装备细节", "fx_1": "能力",
}


def fit_crop(img: Image.Image, rect, focal=(0.5, 0.5)) -> Image.Image:
    """按格矩长宽比 cover 裁剪缩放;focal=(fx,fy) 裁剪焦点(0..1,可偏置取局部)。"""
    x0, y0, x1, y1 = rect
    rw, rh = x1 - x0, y1 - y0
    iw, ih = img.size
    scale = max(rw / iw, rh / ih)
    nw, nh = max(rw, round(iw * scale)), max(rh, round(ih * scale))
    im = img.resize((nw, nh), Image.LANCZOS)
    cx, cy = nw * focal[0], nh * focal[1]
    lx = min(max(cx - rw / 2, 0), nw - rw)
    ly = min(max(cy - rh / 2, 0), nh - rh)
    return im.crop((round(lx), round(ly), round(lx) + rw, round(ly) + rh))


def extract_palette(img: Image.Image, n: int = 5):
    """主体实际设色提取:中位切分量化→滤画布纸底(仅滤与 PAPER 同值,月白衣不误伤)
    →去重+最小色距→按 覆盖×饱和 评分取前 n(1112 首单教训:量化槽重复色与
    「近白即滤」曾致三枚同值圆卡+月白缺席)。"""
    small = img.convert("RGB")
    small.thumbnail((320, 320))
    q = small.quantize(colors=24, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:72]
    counts = sorted(q.getcolors() or [], reverse=True)
    picked: list = []

    def far_enough(rgb):
        return all(sum(abs(a - b) for a, b in zip(rgb, p)) > 60 for p, _ in picked)

    for cnt, idx in counts:
        r, g, b = pal[idx * 3: idx * 3 + 3]
        if abs(r - PAPER[0]) + abs(g - PAPER[1]) + abs(b - PAPER[2]) < 24:
            continue                      # 仅滤画布纸底本身
        mx, mn = max(r, g, b), min(r, g, b)
        sat = 0.0 if mx == 0 else (mx - mn) / mx
        rgb, score = (r, g, b), cnt * (0.2 + sat)
        if not far_enough(rgb):
            continue
        picked.append((rgb, score))
        if len(picked) >= n:
            break
    while len(picked) < n:                # 不足补墨色阶梯(仍守最小色距)
        for cand in ((44, 39, 32), (90, 86, 78), (140, 134, 122),
                     (190, 184, 170), (232, 226, 212)):
            if far_enough(cand):
                picked.append((cand, 0))
                break
        else:
            break
    return [c for c, _ in picked[:n]]


def _place(canvas: Image.Image, draw: ImageDraw.ImageDraw,
           img, rect, label: str | None, focal=(0.5, 0.5),
           label_font: ImageFont.FreeTypeFont | None = None,
           mode: str = "cover"):
    """mode=cover:占满裁切(特写/局部);contain:整图入格居中,余白衬纸色
    (三视图/整器=全身与整剑必须完整;1112 首单教训:cover 把头与剑两端裁掉)。"""
    x0, y0, x1, y1 = rect
    rw, rh = x1 - x0, y1 - y0
    if mode == "contain":
        iw, ih = img.size
        s = min(rw / iw, rh / ih)
        nw, nh = max(1, round(iw * s)), max(1, round(ih * s))
        tile = Image.new("RGB", (rw, rh), PAPER)
        tile.paste(img.resize((nw, nh), Image.LANCZOS), ((rw - nw) // 2, (rh - nh) // 2))
        canvas.paste(tile, (x0, y0))
    else:
        canvas.paste(fit_crop(img, rect, focal), (x0, y0))
    draw.rectangle(rect, outline=INK_LINE, width=2)
    if label:
        f = label_font or _font(LABEL_SIZE)
        bb = draw.textbbox((0, 0), label, font=f)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pad = 8
        draw.rectangle((x0, y0, x0 + tw + 2 * pad, y0 + th + 2 * pad), fill=PAPER)
        draw.text((x0 + pad - bb[0], y0 + pad - bb[1]), label, font=f, fill=INK_TEXT)


def compose(cells: dict, palette, title: str, dst: str) -> str:
    """整卡合成。cells 键见 CELL_KEYS(值=PIL Image);palette=五色列表;title=题名真字。

    缺格断言红(半成品卡禁出门);产物恒 RGB 无 alpha(出图验收门禁)。
    """
    missing = [k for k in CELL_KEYS if not isinstance(cells.get(k), Image.Image)]
    assert not missing, f"缺格 {missing}(18 格全填才准合成)"
    assert len(palette) == 5, "配色应恰五枚"

    canvas = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(canvas)
    geo = layout()
    label_font = _font(LABEL_SIZE)

    # 外框+标题带底线
    d.rectangle((M, M, W - M, H - M), outline=INK_LINE, width=3)
    d.line((M, M + BAND_H + G // 2, W - M, M + BAND_H + G // 2),
           fill=INK_LINE, width=2)
    # 题名真字(程序绘,居中;题名后叠件同字体链)
    tf = _font(TITLE_SIZE)
    bb = d.textbbox((0, 0), title, font=tf)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    d.text(((W - tw) // 2 - bb[0], M + (BAND_H - th) // 2 - bb[1]),
           title, font=tf, fill=INK_TEXT)

    # 18 格裁贴(角标随格;三视图与整器=contain 整图入格,其余 cover 裁切)
    CONTAIN = {"front", "side", "back", "weapon", "eye"}
    for k in CELL_KEYS:
        _place(canvas, d, cells[k], geo[k], LABELS.get(k),
               focal=cells_focal().get(k, (0.5, 0.5)), label_font=label_font,
               mode="contain" if k in CONTAIN else "cover")

    # 配色带:角标+五枚圆卡(取自主体实际设色)
    px0, py0, px1, py1 = geo["_palette"]
    bb = d.textbbox((0, 0), "配色", font=label_font)
    d.text((px0 + 8 - bb[0], py0 + (py1 - py0 - (bb[3] - bb[1])) // 2 - bb[1]),
           "配色", font=label_font, fill=INK_TEXT)
    r = min((py1 - py0) // 2 - 14, (px1 - px0 - 260) // 12)
    cx = px0 + 200
    cy = (py0 + py1) // 2
    for rgb in palette:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=rgb,
                  outline=INK_LINE, width=3)
        cx += 2 * r + max(30, (px1 - px0 - 260 - 5 * 2 * r) // 4)

    canvas.save(dst)  # RGB 模式保存,PNG 恒无 alpha
    return dst


def cells_focal() -> dict:
    """格名→裁剪焦点偏置(眉眼取面上部/发型取头顶/武器两局部取两端/特效下格取剑锋)。"""
    return {
        "front": (0.5, 0.46), "side": (0.5, 0.46), "back": (0.5, 0.46),
        "eye": (0.5, 0.36), "hair": (0.5, 0.20),
        "weapon_a": (0.12, 0.5), "weapon_b": (0.88, 0.5),
        "fabric_1": (0.5, 0.44), "fx_2": (0.62, 0.38),
    }


def _selftest(dst="/tmp/sheetB_frame_selftest.png"):
    """离线几何自检:色块占位合成一整卡,肉眼/尺寸双验。"""
    import random
    random.seed(0)
    cells = {}
    for i, k in enumerate(CELL_KEYS):
        hue = (i * 37) % 255
        cells[k] = Image.new("RGB", (900, 600), (hue, (hue * 2) % 255, (hue * 3) % 255))
    compose(cells, [(200, 60, 60)] * 5, "自检·沈孤鸿", dst)
    im = Image.open(dst)
    assert im.size == (W, H) and im.mode == "RGB", (im.size, im.mode)
    print(f"[SELFTEST OK] {dst} {im.size}")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        print(__doc__)
