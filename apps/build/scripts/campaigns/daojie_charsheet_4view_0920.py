#!/usr/bin/env python3
"""4-View 设定表 LoRA 对照实弹(09-20;civitai 2937321,换装候选)。

背景:现用 Alissonerdx CharacterSheet 件布局软、文字区漂移压人;调研选型
civitai Krea2_Character_Design_4-View_V1(口径=turbo 底模/权重1.0/8步/cfg1,
i2i 触发词全文来自 civitai API;声明支持风格 LoRA 叠加)。本脚本零文件改动,
API 图层面对照样:
  · [164] LoRA→4-View 件;[53] steps 10→8(官方口径);
  · [119].prompt 连线→字面量(4-View 触发词+人物底座锚+主体句;锚文本现读
    daojie_bases.json 人物档,不硬编码);
  · 弹 VLM 三件+[305]/[163](触发词任务书不需要 VLM 重写)+[307] 汉字层
    (4-View 无左栏概念,汉字布局待布局定型后另行适配);
  · [29] images 回接 [54](弹 [307] 后链路自洽)。
判据=读图:4 格(前/侧/背/特写)横排是否成立、身份一致性、白底服从。
图落 ~/Downloads/daojie_charsheet_0919/ 与仓库实弹目录;台账段 post-mod-4view。
用法:python3 apps/build/scripts/daojie_charsheet_4view_0920.py [--base-url …]
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

LORA_4VIEW = "Krea2_Character_Design_4-View_V1.safetensors"
TRIGGER = ("Convert the character in Figure 1 into a 4-view turnaround: "
           "from left to right, full-body front view, full-body side view, "
           "full-body back view, and a close-up facial shot. Pure white background.")
SKIP_4VIEW = {"184", "162", "163", "305", "307"}  # VLM 三件+拼接+汉字层
TAG = "step2_设定板_4View对照"


def main() -> int:
    ap = argparse.ArgumentParser(description="4-View LoRA 对照实弹")
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
    print(f"[4view] 参考图上传: {up}", flush=True)
    graph, summary = cs.sheet_graph(oi, up, None, None)
    for nid in SKIP_4VIEW:
        graph.pop(nid, None)
    graph["164"]["inputs"]["lora_name"] = LORA_4VIEW
    graph["164"]["inputs"]["strength_model"] = 1.0
    graph["119"]["inputs"]["prompt"] = f"{TRIGGER}\n{anchor}\n{cs.SUBJECT}"
    graph["53"]["inputs"]["steps"] = 8
    graph["29"]["inputs"]["images"] = ["54", 0]   # 弹 [307] 后回接
    summary.update(lora=LORA_4VIEW, steps=8,
                   note="4-View 对照:触发词直灌+人物锚+主体句,弹 VLM/汉字层")

    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    cs.settle(rec, TAG)
    cs.merge_audit([rec], "post-mod-4view", {
        "purpose": "4-View LoRA(civitai 2937321)对照:布局稳定性/身份/白底",
        "trigger": TRIGGER, "lora": LORA_4VIEW,
        "ref_image": str(ref_png)})
    print(f"[4view] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[4view] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
