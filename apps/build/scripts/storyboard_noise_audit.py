#!/usr/bin/env python3
"""分镜图噪点量化审计(Phase 0, gpt-image-noise-repair 任务)。

目标:对存量分镜成图与资产参考图计算噪点指标,归因"生成噪点 vs 参考图自带霉斑"。

指标(PIL+numpy,免 cv2):
- noise_std : 平坦区(5x5 中值滤波残差小者的下半)残差标准差 = 颗粒噪点强度(核心指标)
- lap_var   : 灰度 Laplacian 方差 = 高频能量(锐度+噪点混合,作对照)
- block_var : 8x8 块内标准差的中位数 = 局部颗粒感
- chroma_noise: 饱和度通道中值滤波残差标准差 = 色斑/脏斑强度

分组(按文件名/路径):
- sb_final    : workflow-images 下 *成图* 且非 up4x(渠道成图)
- sb_up4x     : up4x-* 超分产物(超分会放大噪点,作对照)
- sb_intermediate: 背景板/人物净底等中间产物
- assets_ref  : 资产库参考图(霉斑归因基准)

用法:
  python3 storyboard_noise_audit.py [--top 30] [--json OUT] [--md OUT]
默认输出到 stdout;--md 同时落 markdown 报告。
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

PROJECT = Path("/Users/zhengbingjin/Project/IP/MA")
WI = PROJECT / "workflow-images"
ASSETS = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/assets")
MAX_SIDE = 1024  # 统一降采样,指标跨图可比且快


def _conv3x3(gray: np.ndarray, k: np.ndarray) -> np.ndarray:
    p = np.pad(gray, 1, mode="edge")
    out = np.zeros_like(gray, dtype=np.float32)
    for di in range(3):
        for dj in range(3):
            out += k[di, dj] * p[di : di + gray.shape[0], dj : dj + gray.shape[1]]
    return out


LAPLACIAN = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
BOX = np.full((3, 3), 1.0 / 9.0, dtype=np.float32)


def _flat_noise_std(gray: np.ndarray) -> float:
    """平坦区中值滤波残差 std:先算残差,取残差幅值下半(≈平坦区)的 std。"""
    med = np.asarray(
        Image.fromarray(gray.astype(np.uint8)).filter(ImageFilter.MedianFilter(5)),
        dtype=np.float32,
    )
    res = gray - med
    flat = res[np.abs(res) <= np.percentile(np.abs(res), 50)]
    return float(flat.std()) if flat.size else 0.0


def measure(path: Path) -> dict | None:
    try:
        im = Image.open(path).convert("RGB")
    except Exception:
        return None
    if max(im.size) > MAX_SIDE:
        r = MAX_SIDE / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)), Image.LANCZOS)
    a = np.asarray(im, dtype=np.float32)
    gray = a.mean(axis=2)
    lap = _conv3x3(gray, LAPLACIAN)
    lap_var = float(lap.var())
    noise_std = _flat_noise_std(gray)
    h, w = gray.shape
    bh, bw = h // 8 * 8, w // 8 * 8
    if bh >= 8 and bw >= 8:
        blocks = gray[:bh, :bw].reshape(bh // 8, 8, bw // 8, 8)
        block_var = float(np.median(blocks.std(axis=(1, 3))))
    else:
        block_var = 0.0
    sat = np.asarray(im.convert("HSV"), dtype=np.float32)[:, :, 1]
    chroma_noise = _flat_noise_std(sat / 2.55)  # 归一到 0-100 量级
    return {
        "path": str(path),
        "size": f"{im.width}x{im.height}",
        "lap_var": round(lap_var, 1),
        "noise_std": round(noise_std, 2),
        "block_var": round(block_var, 2),
        "chroma_noise": round(chroma_noise, 2),
    }


def classify(path: Path) -> str | None:
    if ASSETS in path.parents:
        return "assets_ref"
    name = path.name
    if not (name.endswith(".png") or name.endswith(".jpg")):
        return None
    if "成图" not in name:
        return "sb_intermediate" if any(t in name for t in ("背景板", "人物净底")) else None
    if name.startswith("up4x-"):
        return "sb_up4x"
    return "sb_final"


def collect() -> list[Path]:
    seen: set[Path] = set()
    out: list[Path] = []
    roots = [WI, ASSETS]
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp") and p not in seen:
                seen.add(p)
                if classify(p):
                    out.append(p)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--json", type=str)
    ap.add_argument("--md", type=str)
    args = ap.parse_args()

    paths = collect()
    if not paths:
        print("no images found", file=sys.stderr)
        return 1
    rows = [r for p in paths if (r := measure(p))]
    groups: dict[str, list[dict]] = {}
    for r in rows:
        groups.setdefault(classify(Path(r["path"])), []).append(r)

    def gstats(rs: list[dict], key: str) -> float:
        return round(statistics.median(x[key] for x in rs), 4) if rs else 0.0

    summary = {}
    for g, rs in sorted(groups.items()):
        summary[g] = {
            "n": len(rs),
            "median": {k: gstats(rs, k) for k in ("lap_var", "noise_std", "block_var", "chroma_noise")},
        }
    noise_score = lambda r: r["noise_std"] + r["chroma_noise"]  # noqa: E731
    top = sorted(rows, key=noise_score, reverse=True)[: args.top]

    print(json.dumps({"summary": summary}, ensure_ascii=False, indent=2))
    print(f"\nTOP {args.top} noisiest:")
    for r in top:
        g = classify(Path(r["path"]))
        print(f"[{g}] score={noise_score(r):.3f} noise={r['noise_std']} blk={r['block_var']} chroma={r['chroma_noise']} lap={r['lap_var']} {Path(r['path']).name[:80]}")

    if args.json:
        Path(args.json).write_text(json.dumps({"summary": summary, "top": top}, ensure_ascii=False, indent=2))
    if args.md:
        lines = ["# 噪点审计报告(Phase 0)", "", "## 分组中位数", "", "| 组 | n | lap_var | noise_std | block_var | chroma_noise |", "|---|---|---|---|---|---|"]
        for g, s in summary.items():
            m = s["median"]
            lines.append(f"| {g} | {s['n']} | {m['lap_var']} | {m['noise_std']} | {m['block_var']} | {m['chroma_noise']} |")
        lines += ["", f"## TOP {args.top} 最脏", "", "| 组 | score | noise_std | chroma_noise | 文件 |", "|---|---|---|---|---|"]
        for r in top:
            lines.append(f"| {classify(Path(r['path']))} | {noise_score(r):.3f} | {r['noise_std']} | {r['chroma_noise']} | `{Path(r['path']).name[:90]}` |")
        Path(args.md).write_text("\n".join(lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
