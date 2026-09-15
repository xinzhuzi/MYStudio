#!/usr/bin/env python
"""P2 对拍切割件(Trellis 09-15-teman-absorption)。

宫格/三视图产物按行×列等分切割成独立单图(宫格版式泄漏警示:切割后才可当参考)。
幂等: 产物在盘即跳过(--force 强制重切)。可选 --metrics 输出格间边界梯度粗测
(边界条带 vs 格中心条带的平均梯度对比,作规整度的可量化粗测,人工目检为主)。

用法:
  p2_grid_cut.py --image PATH --rows 3 --cols 3 --prefix NAME [--out-dir DIR] [--metrics] [--force]
  p2_grid_cut.py --stage p2a        # 实验约定批量切法(见 main)
  p2_grid_cut.py --stage p2b
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

RESULTS_DIR = Path("/tmp/p2_duipai")
ENGINE_OUT = Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/output")


def boundary_metrics(arr: np.ndarray, rows: int, cols: int) -> dict:
    """边界条带与格中心条带的平均梯度能量对比(粗测: 规整分格的边界条带应显著高于中心)。"""
    gray = arr.mean(axis=2)
    gy, gx = np.gradient(gray)
    grad = np.hypot(gx, gy)
    H, W = gray.shape

    def strip_energy(vertical: bool, pos: int) -> float:
        band = 4
        if vertical:
            lo, hi = max(0, pos - band), min(W, pos + band)
            return float(grad[:, lo:hi].mean())
        lo, hi = max(0, pos - band), min(H, pos + band)
        return float(grad[lo:hi, :].mean())

    def center_energy(r: int, c: int) -> float:
        ch, cw = H // rows, W // cols
        y0, x0 = r * ch + ch // 4, c * cw + cw // 4
        return float(grad[y0:y0 + ch // 2, x0:x0 + cw // 2].mean())

    centers = [center_energy(r, c) for r in range(rows) for c in range(cols)]
    v_bounds = [strip_energy(True, int(round(c * W / cols))) for c in range(1, cols)]
    h_bounds = [strip_energy(False, int(round(r * H / rows))) for r in range(1, rows)]
    return {
        "grad_center_mean": round(sum(centers) / len(centers), 2),
        "grad_v_boundaries": [round(v, 2) for v in v_bounds],
        "grad_h_boundaries": [round(v, 2) for v in h_bounds],
        "v_boundary_vs_center_ratio": [round(v / (sum(centers) / len(centers)), 2) for v in v_bounds],
        "h_boundary_vs_center_ratio": [round(v / (sum(centers) / len(centers)), 2) for v in h_bounds],
    }


def cut(image_path: Path, rows: int, cols: int, out_dir: Path, prefix: str,
        force: bool = False, metrics: bool = False) -> list[Path]:
    img = Image.open(image_path)
    W, H = img.size
    ch, cw = H // rows, W // cols
    arr = np.asarray(img.convert("RGB")) if metrics else None
    outs = []
    for r in range(rows):
        for c in range(cols):
            p = out_dir / f"{prefix}_r{r}c{c}.png"
            if p.exists() and not force:
                outs.append(p)
                continue
            cell = img.crop((c * cw, r * ch, (c + 1) * cw, (r + 1) * ch))
            cell.save(p)
            outs.append(p)
    if metrics and arr is not None:
        m = boundary_metrics(arr, rows, cols)
        m["image"] = str(image_path)
        m["rows"], m["cols"] = rows, cols
        m["cell_size"] = [cw, ch]
        mp = out_dir / f"{prefix}_metrics.json"
        mp.write_text(json.dumps(m, ensure_ascii=False, indent=1))
        print(json.dumps(m, ensure_ascii=False))
    return outs


def stage_cut(stage: str, force: bool, metrics: bool, out_dir: Path) -> None:
    master = RESULTS_DIR / "results_master.json"
    results = json.loads(master.read_text()) if master.exists() else {}
    if stage == "p2a":
        jobs = [(f"A_grid1mp_s{s}", 3, 3) for s in (20250915, 88001177)] + \
               [(f"A_grid2mp_s{s}", 3, 3) for s in (20250915, 88001177)] + \
               [("A_grid2mp12_s20250915", 3, 3)]
        src = "p2a"
    elif stage == "p2b":
        jobs = [(f"A_tri_s{s}", 1, 3) for s in (20250915, 88001177)]
        src = "p2b-assets"
    else:
        raise SystemExit(f"未知 stage: {stage}")
    for cid, rows, cols in jobs:
        rec = results.get(src, {}).get(cid)
        if not rec or rec.get("status") != "ok":
            print(f"  跳过(无成功产物) {cid}")
            continue
        image_path = Path(rec["outputs"][0]["abs"])
        # 三视图切割件命名约定: p1/p2/p3(下游用 _p1= 正面)
        outs = cut(image_path, rows, cols, out_dir, cid, force=force, metrics=metrics)
        if rows == 1:
            named = [out_dir / f"{cid}_p{i+1}.png" for i in range(3)]
            for srcf, dst in zip(outs, named):
                if force or not dst.exists():
                    dst.write_bytes(srcf.read_bytes())
        print(f"  {cid} -> {[p.name for p in outs]}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", type=Path)
    ap.add_argument("--rows", type=int, default=3)
    ap.add_argument("--cols", type=int, default=3)
    ap.add_argument("--prefix")
    ap.add_argument("--out-dir", type=Path, default=RESULTS_DIR / "cuts")
    ap.add_argument("--stage", choices=["p2a", "p2b"])
    ap.add_argument("--metrics", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    if args.stage:
        stage_cut(args.stage, args.force, args.metrics, args.out_dir)
        return
    if not (args.image and args.prefix):
        ap.error("需要 --image + --prefix,或 --stage")
    cut(args.image, args.rows, args.cols, args.out_dir, args.prefix,
        force=args.force, metrics=args.metrics)


if __name__ == "__main__":
    main()
