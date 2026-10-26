#!/usr/bin/env python3
"""任务B⑤:对比条拼图——三联横条(源|A|B)+人脸/躯干局部放大条。"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT_DIR = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/outfit_probe_1026")
SRC_AL = OUT_DIR / "src_aligned.png"
ARM_A = OUT_DIR / "B_armA_基线.png"
ARM_B = OUT_DIR / "B_armB_outfit.png"
NUMBERS = OUT_DIR / "numbers.json"

GAP = 10
LABELS = ("SRC", "A base", "B outfit")


def panelize(images, labels, out_path, label_h=34):
    w = min(im.width for im in images)
    ims = []
    for im in images:
        if im.width != w:
            s = w / im.width
            im = im.resize((w, round(im.height * s)), Image.LANCZOS)
        ims.append(im)
    h = min(im.height for im in ims)
    ims = [im.crop((0, (im.height - h) // 2, w, (im.height - h) // 2 + h)) for im in ims]
    canvas = Image.new("RGB", (w * len(ims) + GAP * (len(ims) + 1), h + label_h + GAP),
                       (24, 24, 24))
    d = ImageDraw.Draw(canvas)
    for i, (im, lab) in enumerate(zip(ims, labels)):
        x = GAP + i * (w + GAP)
        canvas.paste(im, (x, GAP))
        d.text((x + 8, h + GAP + 9), lab, fill=(240, 240, 240))
    canvas.save(out_path)
    return out_path


def main() -> int:
    import json
    src = Image.open(SRC_AL).convert("RGB")
    a = Image.open(ARM_A).convert("RGB")
    b = Image.open(ARM_B).convert("RGB")

    # ① 三联横条
    panelize([src, a, b], LABELS, OUT_DIR / "B_compare_strip.png")

    # ② 局部放大条:人脸区+躯干区(取 numbers.json 对齐系框),2x 放大
    boxes = json.loads(NUMBERS.read_text(encoding="utf-8"))["boxes"]
    rows = [("FACE", tuple(boxes["face_aligned_px"])),
            ("TORSO", tuple(boxes["torso_aligned_px"]))]

    crops = []
    labels2 = []
    for tag, (x, y, w, h) in rows:
        for im, lab in ((src, "SRC"), (a, "A"), (b, "B")):
            c = im.crop((x, y, x + w, y + h))
            c = c.resize((c.width * 2, c.height * 2), Image.LANCZOS)
            crops.append(c)
            labels2.append(f"{lab} {tag}")
    # 两行(人脸行/躯干行),各三联
    fw = min(c.width for c in crops[:3])
    fh = min(c.height for c in crops[:3])
    row1 = [c.resize((fw, fh)) for c in crops[:3]]
    bh = min(c.height for c in crops[3:])
    row2 = [c.resize((fw, bh)) for c in crops[3:]]
    lab_h = 30
    canvas = Image.new("RGB", (fw * 3 + GAP * 4, (fh + lab_h) + (bh + lab_h) + GAP * 3),
                       (24, 24, 24))
    d = ImageDraw.Draw(canvas)
    for i, (im, lab) in enumerate(zip(row1, labels2[:3])):
        x = GAP + i * (fw + GAP)
        canvas.paste(im, (x, GAP))
        d.text((x + 6, GAP + fh + 7), lab, fill=(240, 240, 240))
    y2 = GAP + fh + lab_h + GAP
    for i, (im, lab) in enumerate(zip(row2, labels2[3:])):
        x = GAP + i * (fw + GAP)
        canvas.paste(im, (x, y2))
        d.text((x + 6, y2 + bh + 7), lab, fill=(240, 240, 240))
    canvas.save(OUT_DIR / "B_compare_zoom.png")
    print("[compare] 落 B_compare_strip.png / B_compare_zoom.png")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
