#!/usr/bin/env python3
"""道劫九型 3x3 总览拼图(09-23):
把 ~/Downloads/qi21-jiuxing/ 九张 1024² 单型图拼成一张 3x3 总览——
每格上方一条深墨标签栏写中文型名(canon 九型顺序),格间留白+细边,纸白底。
输出两份:~/Downloads/qi21-道劫九型总览.png(给用户)与
仓库 .trellis/tasks/09-23-qwen-image-21-research/research/qi21-道劫九型总览.png(工作区副本)。
用法:引擎 venv python 执行(依赖 PIL)。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC_DIR = Path.home() / "Downloads/qi21-jiuxing"
OUTS = [
    Path.home() / "Downloads/qi21-道劫九型总览.png",
    Path.home() / "Project/Github/MYStudio/.trellis/tasks/09-23-qwen-image-21-research/research/qi21-道劫九型总览.png",
]
# canon 九型顺序(daojie_bases.json zh)
NAMES = ["人物", "场景", "道具", "美宣", "三视图", "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]

FONT_CANDIDATES = [
    "/System/Library/Fonts/Hiragino Sans GB.ttc",   # 实测本机 PIL 可开(09-23)
    "/System/Library/Fonts/STHeiti Light.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/PingFang.ttc",            # 本机 PIL 打不开,留后位兜底
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
]

IMG = 1024          # 单图边长
LABEL_H = 76        # 标签栏高
BORDER = 2          # 每格细边
GAP = 30            # 格间留白
MARGIN = 34         # 外边距
BG = (247, 245, 240)      # 纸白
INK = (34, 34, 38)        # 深墨(标签栏底/细边)
FG = (245, 243, 238)      # 标签文字色


def load_font(size):
    for p in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    raise SystemExit(f"无可用中文字体: {FONT_CANDIDATES}")


def main():
    imgs = []
    for i, name in enumerate(NAMES, 1):
        p = SRC_DIR / f"{i}-{name}.png"
        if not p.exists():
            raise SystemExit(f"缺单型图: {p}")
        im = Image.open(p).convert("RGB")
        if im.size != (IMG, IMG):
            raise SystemExit(f"{p} 尺寸异常: {im.size}")
        imgs.append(im)

    cell_w = IMG + 2 * BORDER
    cell_h = LABEL_H + IMG + 2 * BORDER
    W = MARGIN * 2 + cell_w * 3 + GAP * 2
    H = MARGIN * 2 + cell_h * 3 + GAP * 2
    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)
    font = load_font(46)

    for idx, (name, im) in enumerate(zip(NAMES, imgs)):
        r, c = divmod(idx, 3)
        x = MARGIN + c * (cell_w + GAP)
        y = MARGIN + r * (cell_h + GAP)
        # 细边框(整格)
        draw.rectangle([x, y, x + cell_w - 1, y + cell_h - 1], outline=INK, width=BORDER)
        # 标签栏
        draw.rectangle([x + BORDER, y + BORDER, x + cell_w - 1 - BORDER, y + BORDER + LABEL_H - 1], fill=INK)
        bbox = draw.textbbox((0, 0), name, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text((x + (cell_w - tw) / 2 - bbox[0], y + BORDER + (LABEL_H - th) / 2 - bbox[1]), name, font=font, fill=FG)
        # 单型图
        canvas.paste(im, (x + BORDER, y + BORDER + LABEL_H))

    for out in OUTS:
        out.parent.mkdir(parents=True, exist_ok=True)
        canvas.save(out, "PNG")
        print(f"saved {out} ({out.stat().st_size} bytes, {W}x{H})")
    print(f"grid {W}x{H}, cells 3x3 label_h={LABEL_H} gap={GAP} border={BORDER}")


if __name__ == "__main__":
    sys.exit(main())
