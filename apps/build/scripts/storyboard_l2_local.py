#!/usr/bin/env python3
"""L2 本地层——现有本地权重的图-文特征粗筛(零下载,免费离线)。

组合(08-24 实证各角色):
  depth 特征(Depth-Anything-V2-Small, MPS 秒级/图): 景别(远景占比/深度方差)
    ——描述含「特写/手部/面部」却高远景占比 → 特写误拍嫌疑;含「远山/全景/
    街巷深处」却低远景 → 场景嫌疑
  PIL 质量基检: 亮度(黑图/白图)、清晰度(Laplacian 方差,糊图)、主色
    ——水墨漫剧期望低饱和;高饱和撞色标嫌疑

输出每镜 verdict: ok / suspect(附特征),供 L3 云端只看可疑。
用法: python3 storyboard_l2_local.py --shots 5,12  (或 --all-generated)
"""
from __future__ import annotations
import json, sys, glob
from pathlib import Path
from urllib.parse import unquote

import torch
from PIL import Image
from transformers import pipeline

STORE = Path("/Users/zhengbingjin/Project/IP/MA/store/studio-workflow")
DEPTH_MODEL = next((Path("/Users/zhengbingjin/Library/Application Support/漫影工作室/model/depth/models--depth-anything--Depth-Anything-V2-Small-hf/snapshots")).iterdir())

def shot_image(sb):
    p = (sb.get("mediaRef") or {}).get("path", "")
    if "workflow-images/" not in p: return None
    return Path("/Users/zhengbingjin/Project/IP/MA/workflow-images/" + unquote(p.split("workflow-images/")[-1]))

def l2_check(sb, depth_pipe) -> dict:
    img_path = shot_image(sb)
    if not img_path or not img_path.exists():
        return {"verdict": "skip", "reason": "无图"}
    img = Image.open(img_path).convert("RGB")
    desc = (sb.get("videoDesc") or "") + (sb.get("lines") or "")
    # 质量基检(原图缩样)
    small = img.copy(); small.thumbnail((256, 256))
    import numpy as np
    a = np.asarray(small, dtype=float)
    brightness = a.mean() / 255
    gray = a.mean(axis=2)
    lap = abs(gray[:-1, :-1] - gray[1:, 1:]).mean()
    saturation = (a.max(axis=2) - a.min(axis=2)).mean() / 255
    notes = []
    if brightness < 0.08: notes.append(f"过暗({brightness:.2f})")
    if brightness > 0.92: notes.append(f"过亮({brightness:.2f})")
    if lap < 3: notes.append(f"疑似糊图(lap={lap:.1f})")
    if saturation > 0.55: notes.append(f"高饱和({saturation:.2f})非水墨预期")
    # depth 特征(景别比对)
    d_img = img.copy(); d_img.thumbnail((384, 384))
    out = depth_pipe(d_img)
    d = out["predicted_depth"].float().flatten()
    dn = (d - d.min()) / (d.max() - d.min() + 1e-6)
    far = (dn > 0.6).float().mean().item()
    is_closeup_desc = any(k in desc for k in ("特写", "手部", "面部", "指尖", "手指", "手", "眼睛", "喉结", "细节"))
    is_wide_desc = any(k in desc for k in ("远景", "全景", "远处", "全境", "山河", "队列穿过", "街巷另一侧", "深处"))
    if is_closeup_desc and far > 0.5: notes.append(f"特写描述但远景占比高(far={far:.2f})")
    if is_wide_desc and far < 0.45: notes.append(f"远景描述但纵深不足(far={far:.2f})")
    return {
        "verdict": "suspect" if notes else "ok",
        "features": {"far": round(far, 3), "brightness": round(brightness, 3), "lap": round(float(lap), 1), "saturation": round(float(saturation), 3)},
        "notes": notes,
    }

def main():
    args = sys.argv[1:]
    man = json.loads((STORE / "manifest.json").read_text())
    sbs = {}
    for shard in man["shards"]:
        if "storyboards" not in shard: continue
        d = json.loads((STORE / shard).read_text())
        for sb in d["state"].get("storyboards") or []: sbs[sb.get("index")] = sb
    if "--all-generated" in args:
        targets = sorted(i for i, sb in sbs.items() if (sb.get("mediaRef") or {}).get("kind") == "image")
    elif "--shots" in args:
        targets = [int(x) for x in args[args.index("--shots") + 1].split(",")]
    else:
        print(__doc__); return
    depth_pipe = pipeline("depth-estimation", model=str(DEPTH_MODEL), device="mps")
    results = {}
    for idx in targets:
        sb = sbs.get(idx)
        if not sb: continue
        results[idx] = l2_check(sb, depth_pipe)
        r = results[idx]
        tag = r["verdict"] + (" " + "; ".join(r["notes"]) if r.get("notes") else "")
        print(f"S{idx:02d}: {tag} {r.get('features','')}")
    Path("/tmp/l2_report.json").write_text(json.dumps(results, ensure_ascii=False, indent=1))
    print(f"\nL2 汇总: {len(results)}镜 | suspect {sum(1 for r in results.values() if r['verdict']=='suspect')} | 报告 /tmp/l2_report.json")

if __name__ == "__main__":
    main()
