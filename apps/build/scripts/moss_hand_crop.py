#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""moss_hand_crop.py -- MOSS 战役手/武器判读裁剪工具（PLAN-2 §⑦.2 两段判读命令面）。

第一段·定位（整图缩样初判；输出散文方位原样入账，不造像素框）：
  python3 apps/build/scripts/moss_hand_crop.py --image <png> --out crops/ --stage locate
第二段·定点放大（执行者按初判方位换算像素框传参；换算依据=初判 JSON 原文+图
尺寸，随 --reason 入账）：
  python3 apps/build/scripts/moss_hand_crop.py --image <png> --out crops/ \
      --crop 640,512,320,320 --zoom 2 --reason "..."
回退（初判未给出可换算框/换算争议；等分网格带间 overlap 重叠防手切半+中心
50%×50% 方块+整图缩样）：
  python3 apps/build/scripts/moss_hand_crop.py --image <png> --out crops/ \
      --grid 3 --overlap 0.18

所有裁剪追加写 <out>/crop_manifest.json：源图 sha256 / 框坐标 / zoom / 触发理由
/ 输出文件清单。纯 stdlib+PIL，Mac 判读侧运行（引擎产物回收 Mac 后裁剪）。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("PIL missing: pip install pillow (Mac judge side needs it)")

MANIFEST = "crop_manifest.json"
LOCATE_MAX_SIDE = 1024


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def clip_box(x: int, y: int, w: int, h: int, iw: int, ih: int) -> tuple[int, int, int, int, list[int]]:
    """Clip crop box to image bounds; return (x, y, w, h, clipped_flag_notes)."""
    ox, oy, ow, oh = x, y, w, h
    x, y = max(0, x), max(0, y)
    w = min(w, iw - x)
    h = min(h, ih - y)
    notes = []
    if (x, y, w, h) != (ox, oy, ow, oh):
        notes.append("clipped from (%d,%d,%d,%d)" % (ox, oy, ow, oh))
    return x, y, w, h, notes


def save(img: Image.Image, out_dir: Path, name: str, entry_files: list) -> None:
    p = out_dir / name
    img.save(p)
    entry_files.append({"name": name, "bytes": p.stat().st_size, "wh": list(img.size)})


def main() -> int:
    ap = argparse.ArgumentParser(description="MOSS hand/weapon crop tool (PLAN-2 §7.2)")
    ap.add_argument("--image", required=True, help="source png path")
    ap.add_argument("--out", default="crops", help="output dir (default crops/)")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--stage", choices=["locate"], help="stage 1: whole-image downscale sample")
    g.add_argument("--crop", default=None, metavar="X,Y,W,H",
                   help="stage 2: targeted pixel box")
    g.add_argument("--grid", type=int, default=None, metavar="N",
                   help="fallback: NxN tiles")
    ap.add_argument("--zoom", type=float, default=2.0, help="crop zoom factor (default 2)")
    ap.add_argument("--overlap", type=float, default=0.18, help="grid overlap fraction (default 0.18)")
    ap.add_argument("--reason", default="", help="trigger reason recorded into manifest")
    args = ap.parse_args()

    src = Path(args.image)
    if not src.exists():
        sys.exit("SRC-MISSING %s" % src)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    im = Image.open(src)
    iw, ih = im.size
    digest = sha256_file(src)
    stem = src.stem
    entry: dict = {"source": str(src), "source_sha256": digest,
                   "source_wh": [iw, ih], "reason": args.reason,
                   "created": time.strftime("%Y-%m-%dT%H:%M:%S")}
    files: list = []
    entry["files"] = files

    if args.stage == "locate":
        w, h = im.size
        scale = min(1.0, LOCATE_MAX_SIDE / max(w, h))
        tw, th = max(1, int(round(w * scale))), max(1, int(round(h * scale)))
        name = "%s_locate.png" % stem
        save(im.resize((tw, th), Image.LANCZOS), out_dir, name, files)
        entry.update({"mode": "locate", "box": None, "zoom": None,
                      "note": "whole-image sample %dx%d (prose bearing judgement only, no pixel box)" % (tw, th)})
    elif args.crop:
        try:
            x, y, w, h = (int(v) for v in args.crop.split(","))
        except ValueError:
            sys.exit("CROP-BAD %r (expect X,Y,W,H ints)" % args.crop)
        if w <= 0 or h <= 0:
            sys.exit("CROP-BAD non-positive w/h")
        x, y, w, h, notes = clip_box(x, y, w, h, iw, ih)
        zw, zh = max(1, int(round(w * args.zoom))), max(1, int(round(h * args.zoom)))
        name = "%s_crop_%d_%d_%d_%d.png" % (stem, x, y, w, h)
        save(im.crop((x, y, x + w, y + h)).resize((zw, zh), Image.LANCZOS), out_dir, name, files)
        entry.update({"mode": "crop", "box": [x, y, w, h], "zoom": args.zoom,
                      "out_wh": [zw, zh],
                      "note": "; ".join(notes) or "box in bounds"})
    else:  # grid fallback
        n = args.grid
        if n < 2 or n > 8:
            sys.exit("GRID-BAD N=%s (expect 2..8)" % n)
        ov = args.overlap
        if not (0.0 <= ov < 0.5):
            sys.exit("OVERLAP-BAD %s (expect 0 <= overlap < 0.5)" % ov)
        tw, th = iw // n, ih // n
        pad_x, pad_y = int(round(tw * ov)), int(round(th * ov))
        for r in range(n):
            for c in range(n):
                bx = max(0, c * tw - pad_x)
                by = max(0, r * th - pad_y)
                bw = min(iw - bx, tw + 2 * pad_x)
                bh = min(ih - by, th + 2 * pad_y)
                name = "%s_grid_r%d_c%d.png" % (stem, r, c)
                save(im.crop((bx, by, bx + bw, by + bh)), out_dir, name, files)
        cx, cy = iw // 4, ih // 4
        cw, ch = iw // 2, ih // 2
        name = "%s_center.png" % stem
        save(im.crop((cx, cy, cx + cw, cy + ch)), out_dir, name, files)
        entry.update({"mode": "grid", "grid": [n, ov], "tile_wh": [tw, th],
                      "box": None, "zoom": None,
                      "note": "NxN tiles +%.0f%% overlap + center 50%% square" % (ov * 100)})

    mf = out_dir / MANIFEST
    man = []
    if mf.exists():
        try:
            man = json.loads(mf.read_text(encoding="utf-8"))
        except Exception:
            man = [{"warning": "existing manifest unparseable, history truncated"}]
    man.append(entry)
    mf.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    print("CROPPED mode=%s files=%d manifest=%s" %
          (entry.get("mode"), len(files), mf))
    return 0


if __name__ == "__main__":
    sys.exit(main())
