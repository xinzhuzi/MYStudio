#!/usr/bin/env python3
"""daojie_sheet_lazycache_ab_1114.py — 设定卡编辑路 LazyCache 加速 A/B 定谢(1114 用户令)。

被试=face 编辑步(身份关键格,基线=1113 役 step_03_face.png,25步 cfg1 base,seed3)。
嫁接源=qi21 加速子图档3「混动 40步+缓存」点名件(t2i-通用.json 子图逐参数):
  LazyCache(reuse_threshold=0.2, start_percent=0.15, end_percent=0.95, verbose=false)
  档3采样器=KSampler 40步 cfg4.0 euler/simple dn1 + Fix qwen2.1-detail-fix-2.0×0.4
两变体(同 prompt 同 seed 同参考图):
  B=25步 cfg1 + LazyCache(纯提速嫁接,配方零动;LazyCache×cfg1 无实录=本实验要定谢)
  C=40步 cfg4 + Fix×0.4 + LazyCache(档3 原样嫁接, LazyCache×cfg4 有兼容实录)
产物=apps/output/daojie-sheet-b-qwen-1113/对照_lazycache_{B,C}.png
"""
from __future__ import annotations

import importlib.util
import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location(
    "pl", Path(__file__).resolve().parent / "daojie_sheet_b_pipeline.py")
pl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pl)

OUT = REPO / "apps/output/daojie-sheet-b-qwen-1113"


def face_api(image_name, instr, neg, seed, prefix, models, smp, variant):
    """build_q_edit 镜像 + 变体模型链(B=+LazyCache;C=+Fix+LazyCache 档3 采样)。"""
    api = pl.build_q_edit(image_name, instr, neg, seed, prefix, models, smp)
    if variant == "B":       # 25步 cfg1 原配方,只包 LazyCache
        api["7040"] = {"class_type": "LazyCache",
                       "inputs": {"model": ["1", 0], "reuse_threshold": 0.2,
                                  "start_percent": 0.15, "end_percent": 0.95,
                                  "verbose": False}}
        api["7"]["inputs"]["model"] = ["7040", 0]
    else:                    # C=档3 原样:Fix→LazyCache→KSampler 40步 cfg4
        api["7026"] = {"class_type": "LoraLoaderModelOnly",
                       "inputs": {"model": ["1", 0],
                                  "lora_name": "qwen2.1-detail-fix-2.0.safetensors",
                                  "strength_model": 0.4}}
        api["7040"] = {"class_type": "LazyCache",
                       "inputs": {"model": ["7026", 0], "reuse_threshold": 0.2,
                                  "start_percent": 0.15, "end_percent": 0.95,
                                  "verbose": False}}
        api["7"]["inputs"]["model"] = ["7040", 0]
        api["7"]["inputs"].update({"steps": 40, "cfg": 4.0})
    return api


def main() -> int:
    global OUT
    pl.OUT = OUT
    bases = json.loads(pl.BASES.read_text(encoding="utf-8"))
    q = bases["sheet_card_qwen"]
    assert int(q["format_version"].lstrip("v")) >= 2
    bgp = q["backgrounds"]["纯白"]["phrase"]
    style_neg = bases["art_style_base"].get("negative_text", "")
    instr = q["edit_instructions"]["face"].replace("{背景}", bgp)
    neg = ",".join(p for p in (style_neg, q["edit_negative"]) if p)

    # 发车前门:队列空
    queue = pl.http_json(f"{pl.ENGINE}/queue", timeout=10)
    if queue.get("queue_running") or queue.get("queue_pending"):
        print(f"[FAIL] 队列非空,让行")
        return 9

    up = pl.upload_image(OUT / "step_00_master.png")
    seed = q["seeds"]["face"]  # 管线口径: args.seed(0)+seeds[face](3)
    for variant in ("B", "C"):
        api = face_api(up, instr, neg, seed, f"sheetBq/lc_{variant}",
                       q["models"], q["sampler"], variant)
        t0 = time.time()
        dst = OUT / f"对照_lazycache_{variant}.png"
        pl.fire(api, f"lc_{variant}", dst)
        print(f"[{variant}] {time.time() - t0:.0f}s(提交→落盘) → {dst.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
