#!/usr/bin/env python3
"""daojie14 验收:PIL 逐件尺寸对表 + 拼 4×4 带号接图(供 vision 一次验全)。"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/h3image-smoke-1112/daojie14")
EXPECT = {
    0: (1536, 2048, "人物海报"), 1: (2048, 1152, "场景"), 2: (1024, 1024, "道具"),
    3: (2048, 1152, "美宣"), 4: (1824, 1024, "人物多视图"), 5: (1024, 1024, "高清人脸"),
    6: (2048, 1152, "分镜剧情图"), 7: (1248, 1248, "表情差分"), 8: (2048, 1152, "概念气氛图"),
    9: (3840, 2176, "设定卡"), 10: (2048, 1152, "3D剖面场景图"), 11: (1024, 1024, "人脸基准"),
    12: (960, 1280, "无衣物定妆"), 13: (1024, 1024, "自由"),
}
TILE_W = 360
LABEL_H = 34
COLS, ROWS = 4, 4


def main() -> int:
    files = {}
    for p in sorted(OUT.glob("*.png")):
        idx = int(p.name[:2])
        files[idx] = p
    size_ok = 0
    for i in range(14):
        if i not in files:
            print(f"[{i:02d}] 缺件")
            continue
        w, h, name = EXPECT[i]
        im = Image.open(files[i])
        ok = im.size == (w, h)
        size_ok += ok
        print(f"[{i:02d} {name}] {im.size} {'✓' if ok else f'✗ 期望{(w, h)}'}")

    # 接图:4×4,每格统一高(等比缩放),顶条黑底白字标号+型名
    tile_h = 300
    sheet = Image.new("RGB", (COLS * TILE_W, ROWS * (tile_h + LABEL_H)), (24, 24, 24))
    draw = ImageDraw.Draw(sheet)
    for i in range(14):
        r, c = divmod(i, COLS)
        x0, y0 = c * TILE_W, r * (tile_h + LABEL_H)
        draw.rectangle([x0, y0, x0 + TILE_W, y0 + LABEL_H], fill=(10, 10, 10))
        draw.text((x0 + 8, y0 + 9), f"{i:02d} {EXPECT[i][2]}", fill=(255, 255, 255))
        if i in files:
            im = Image.open(files[i]).convert("RGB")
            im.thumbnail((TILE_W - 8, tile_h - 8))
            sheet.paste(im, (x0 + (TILE_W - im.width) // 2,
                             y0 + LABEL_H + (tile_h - im.height) // 2))
    sheet.save(OUT / "_contact_sheet.jpg", quality=88)
    print(f"\n尺寸对表 {size_ok}/14;接图={OUT / '_contact_sheet.jpg'}")
    return 0 if size_ok == 14 else 1


if __name__ == "__main__":
    raise SystemExit(main())
