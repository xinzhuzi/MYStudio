#!/usr/bin/env python3
"""4-View 四格粘连诊断矩阵(09-20 三轮;1536 快档三发定位根因)。

量化实况:四视图未分格——人物1 独立 x[0,25%],人物2-4 粘连成 x[36%,100%]。
三个嫌疑单变量隔离(其余=4-View 官方口径):
  A 纯触发词+裸栈(弹九型栈)+3:2   → 基线:件本身在 3:2 下分不分格
  B 纯触发词+九型栈+3:2           → 若 A 分 B 粘=栈干扰
  C 纯触发词+裸栈+16:9(1344×768) → 若 C 分 A 粘=画幅外推问题
判据=读图+列分布量化(内容柱≥4 段且各中心近等分=分格)。
图落 Downloads;台账段 post-mod-4view-diag。
用法:python3 apps/build/scripts/daojie_charsheet_4view_diag_0920.py [--only A|B|C]
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

TRIGGER = ("Convert the character in Figure 1 into a 4-view turnaround: "
           "from left to right, full-body front view, full-body side view, "
           "full-body back view, and a close-up facial shot. Pure white background.")
SKIP = {"184", "162", "163", "305", "307", "304", "306"}  # VLM/拼接/底座/汉字层/审计面

LEGS = {
    "A": dict(stack=True, size=(1536, 1024), tag="step2_diag_A_裸栈_触发词_3比2"),
    "B": dict(stack=False, size=(1536, 1024), tag="step2_diag_B_九型栈_触发词_3比2"),
    "C": dict(stack=True, size=(1344, 768), tag="step2_diag_C_裸栈_触发词_16比9"),
}


def main() -> int:
    ap = argparse.ArgumentParser(description="4-View 粘连诊断矩阵")
    ap.add_argument("--base-url", default=cs.probe_base())
    ap.add_argument("--only", choices=list(LEGS), default=None)
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    ref_png = cs.DOWNLOADS / "step1_立绘_人物型_seed42.png"
    if not ref_png.is_file():
        print("✗ 缺立绘参考图", file=sys.stderr)
        return 1

    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)
    up = cs.upload_image(base, ref_png)
    print(f"[diag] 参考图上传: {up}", flush=True)

    legs = [args.only] if args.only else list(LEGS)
    bases = {e["zh"]: e for e in json.loads(
        cs.BASES_JSON.read_text(encoding="utf-8"))}
    runs = []
    rc = 0
    for key in legs:
        cfg = LEGS[key]
        graph, summary = cs.sheet_graph(oi, up, None, None)
        for nid in SKIP:
            graph.pop(nid, None)
        graph["119"]["inputs"]["prompt"] = TRIGGER          # 纯触发词
        graph["164"]["inputs"]["lora_name"] = "Krea2_Character_Design_4-View_V1.safetensors"
        graph["85"]["inputs"]["prompt"] = bases["人物"]["negative"]  # 弹 [304] 后负向字面量化
        graph["53"]["inputs"]["steps"] = 8
        graph["156"]["inputs"]["width"], graph["156"]["inputs"]["height"] = cfg["size"]
        graph["29"]["inputs"]["images"] = ["54", 0]         # 弹 [307] 后回接
        if cfg["stack"] and graph["164"]["inputs"]["model"][0] == "90":
            graph["164"]["inputs"]["model"] = ["55", 0]     # 弹 [90] 后 UNET 直供
        summary.update(leg=key, steps=8, size="x".join(map(str, cfg["size"])),
                       stack="裸" if cfg["stack"] else "九型档", prompt="纯触发词")
        rec: dict = {"ran": False, **summary}
        rec = cs.submit(base, graph, rec)
        cs.settle(rec, cfg["tag"])
        runs.append(rec)
        print(f"[diag] {key} {'OK' if rec.get('ran') else rec.get('skip_reason')} "
              f"wall={rec.get('wall_s')}s", flush=True)
        rc |= 0 if rec.get("ran") else 1
    cs.merge_audit(runs, "post-mod-4view-diag", {
        "purpose": "四格粘连根因矩阵:A 裸栈/3:2,B 九型栈/3:2,C 裸栈/16:9(均纯触发词)",
        "trigger": TRIGGER, "ref_image": str(ref_png)})
    return rc


if __name__ == "__main__":
    sys.exit(main())
