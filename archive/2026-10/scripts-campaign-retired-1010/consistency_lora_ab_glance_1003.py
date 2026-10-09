#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""1003 一瞥表:consistency-lora-ab-1001 四张可看图拼 2×2 终审辅助表。

上行 g1a(40步无LoRA) | g1b(40步+LoRA)   看点=变软/水彩化
下行 g2a(4步FunAcc无LoRA) | g2b(4步FunAcc+LoRA) 看点=叠加无害
g3a 黑图不入表;禁改四张源图(跑前跑后 md5 对拍断言)。
PIL 拼图;每格顶标题行(中文);格间留白+外框;每格等宽缩到约 768px。
字体链:PingFang.ttc → STHeiti(华文黑体) → 都缺则如实报错改英文标签。
"""
import hashlib
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/consistency-lora-ab-1001")
OUT_PNG = OUT_DIR / "对比一瞥表-1003.png"

# (文件名, 格标题)
CELLS = [
    [("g1a-40-nolora-en.png", "g1a · 40步 无LoRA(基线)"),
     ("g1b-40-lora-en.png", "g1b · 40步 +LoRA ▸ 看点:变软/水彩化")],
    [("g2a-4-funacc-en.png", "g2a · 4步FunAcc 无LoRA(基线)"),
     ("g2b-4-funacc-lora-en.png", "g2b · 4步FunAcc +LoRA ▸ 看点:叠加无害")],
]
BIG_TITLE = "A/B 一瞥:上行=40步±LoRA(看变软) 下行=4步FunAcc±LoRA(看叠加) 黑图免看"

CELL_W = 768          # 每格图宽(等宽)
PAD = 24              # 外边距
GAP = 20              # 格间留白
TITLE_H = 46          # 每格标题行高
BIG_H = 72            # 大标题行高

BG = (247, 247, 245)
FG = (24, 24, 24)
ACCENT = (160, 30, 30)
FRAME = (120, 120, 118)


def md5(p: Path) -> str:
    return hashlib.md5(p.read_bytes()).hexdigest()


def load_font(size: int) -> ImageFont.FreeTypeFont:
    """按 ask 的退级链找中文字体;两级都缺则抛错由上层改英文标签。"""
    for cand in [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ]:
        if Path(cand).is_file():
            try:
                return ImageFont.truetype(cand, size)
            except OSError:
                continue
    raise FileNotFoundError("PingFang/STHeiti 均不可用")


def main() -> int:
    src_md5_before = {name: md5(OUT_DIR / name) for row in CELLS for name, _ in row}

    try:
        f_big = load_font(38)
        f_cell = load_font(25)
        zh_ok, font_used = True, "STHeiti(华文黑体)"
    except FileNotFoundError:
        zh_ok, font_used = False, "default(bitmap)"
        f_big = ImageFont.load_default()
        f_cell = ImageFont.load_default()
        print("[WARN] PingFang/STHeiti 均缺失,按 ask 退级为英文标签", file=sys.stderr)

    if not zh_ok:
        global BIG_TITLE
        BIG_TITLE = ("A/B glance: top=40step -/+LoRA (soften) "
                     "bottom=4step FunAcc -/+LoRA (stack-harmless) black-skip")
        for r in range(2):
            CELLS[r] = [(n, t.replace("看点:", "see:").replace("变软/水彩化", "soften/watercolor")
                         .replace("叠加无害", "stack-harmless").replace("(基线)", "(baseline)"))
                        for n, t in CELLS[r]]

    # 每格等宽缩放
    thumbs = {}
    for name, _ in [(n, t) for row in CELLS for n, t in row]:
        im = Image.open(OUT_DIR / name).convert("RGB")
        h = round(CELL_W * im.height / im.width)
        thumbs[name] = im.resize((CELL_W, h), Image.LANCZOS)
    img_h = next(iter(thumbs.values())).height  # 四张同源尺寸 1728x960,高一致

    W = PAD + CELL_W + GAP + CELL_W + PAD
    H = PAD + BIG_H + GAP + 2 * (TITLE_H + img_h) + GAP + PAD
    canvas = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(canvas)

    # 大标题(居中)
    bb = d.textbbox((0, 0), BIG_TITLE, font=f_big)
    d.text(((W - (bb[2] - bb[0])) / 2, PAD + (BIG_H - (bb[3] - bb[1])) / 2 - bb[1]),
           BIG_TITLE, font=f_big, fill=FG)

    # 四格
    for r in range(2):
        for c in range(2):
            name, label = CELLS[r][c]
            x0 = PAD + c * (CELL_W + GAP)
            y0 = PAD + BIG_H + GAP + r * (TITLE_H + img_h + GAP)
            color = ACCENT if "+LoRA" in label else FG
            d.text((x0 + 2, y0 + 8), label, font=f_cell, fill=color)
            canvas.paste(thumbs[name], (x0, y0 + TITLE_H))
            d.rectangle([x0 - 1, y0 + TITLE_H - 1, x0 + CELL_W, y0 + TITLE_H + img_h],
                        outline=FRAME, width=1)

    # 外框
    d.rectangle([4, 4, W - 5, H - 5], outline=FRAME, width=2)

    canvas.save(OUT_PNG, "PNG")

    # 禁改源图:跑后 md5 对拍
    for name, before in src_md5_before.items():
        after = md5(OUT_DIR / name)
        assert after == before, f"源图被改!{name} {before} -> {after}"

    print(f"font={font_used} zh_ok={zh_ok}")
    print(f"out={OUT_PNG} size={canvas.size} bytes={OUT_PNG.stat().st_size}")
    for name, before in src_md5_before.items():
        print(f"src-md5-unchanged {name} {before}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
