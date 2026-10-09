#!/usr/bin/env python3
"""QuadView(Alissonerdx)对拍实弹(09-20;vs civitai 4-View 件,同台四视角对拍)。

背景:用户裁定优先 Alissonerdx 同仓库件——QuadView_krea2_v1 是现用
DynamicCharacterSheet 的前身(README:Dynamic trained on top of 4 Views),
固定四格(特写+前/侧/背全格),触发词单句,无元数据区(布局约束硬)。
本脚本零文件改动,API 图层面:
  · [164] LoRA→QuadView 件;官方口径=euler/simple/10 步(README 工作流);
  · [119].prompt 连线→字面量(官方触发词+人物底座锚+主体句,锚现读 json);
  · 弹 VLM 三件+[305]/[163]/[307](单句触发词不需 VLM;汉字层待布局定型);
  · [29] images 回接 [54];尺寸=文件默认 2K(与 4-View 对照发同条件)。
图落双目录;台账段 post-mod-quadview。
用法:python3 apps/build/scripts/daojie_charsheet_quadview_0920.py [--base-url …]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_charsheet_logic_0919 as cs  # noqa: E402
from daojie_charsheet_logic_0919 import http_json  # noqa: E402

LORA_QUAD = "QuadView_krea2_v1.safetensors"
# Alissonerdx README §QuadView — Krea 2 触发词逐字
TRIGGER = ("Convert the character in the image to a Character Sheet showing "
           "a face close-up, front full body, side full body and back full "
           "body views")
SKIP_QUAD = {"184", "162", "163", "305", "307"}
TAG = "step2_设定板_QuadView对拍"


def main() -> int:
    ap = argparse.ArgumentParser(description="QuadView 对拍实弹")
    ap.add_argument("--base-url", default=cs.probe_base())
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    ref_png = cs.DOWNLOADS / "step1_立绘_人物型_seed42.png"
    if not ref_png.is_file():
        print("✗ 缺立绘参考图", file=sys.stderr)
        return 1

    bases = {e["zh"]: e for e in json.loads(
        cs.BASES_JSON.read_text(encoding="utf-8"))}
    anchor = bases["人物"]["positive"]

    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)

    up = cs.upload_image(base, ref_png)
    print(f"[quad] 参考图上传: {up}", flush=True)
    graph, summary = cs.sheet_graph(oi, up, None, None)
    for nid in SKIP_QUAD:
        graph.pop(nid, None)
    graph["164"]["inputs"]["lora_name"] = LORA_QUAD
    graph["164"]["inputs"]["strength_model"] = 1.0
    graph["119"]["inputs"]["prompt"] = f"{TRIGGER}\n{anchor}\n{cs.SUBJECT}"
    graph["53"]["inputs"]["steps"] = 10
    graph["53"]["inputs"]["scheduler"] = "euler"   # 官方 QuadView 工作流口径
    graph["29"]["inputs"]["images"] = ["54", 0]
    summary.update(lora=LORA_QUAD, steps=10, scheduler="euler",
                   note="QuadView 对拍:官方触发词+euler/simple/10 步,弹 VLM/汉字层")

    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    cs.settle(rec, TAG)
    cs.merge_audit([rec], "post-mod-quadview", {
        "purpose": "QuadView(Alissonerdx 原厂四格件)对拍 vs civitai 4-View",
        "trigger": TRIGGER, "lora": LORA_QUAD,
        "official_ref": "README §QuadView — Krea 2 + workflows/QuadView_krea2_v1.json",
        "ref_image": str(ref_png)})
    print(f"[quad] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[quad] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
