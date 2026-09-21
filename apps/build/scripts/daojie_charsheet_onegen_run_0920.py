#!/usr/bin/env python3
"""一次成表(硬约束口径)实弹(09-20 十一轮;用户定死五约束)。

用户口径(全部写进触发词,不留给模型发挥):
  一次生成四视图(不拼板)/严格半身(腰上)/正正面/标准 90° 侧身/正 180° 背身/
  纯白背景无色调不海报/衣纹垂落/不加道具不加人。
本脚本=零 override 直读工作流文件提交(工作流已是单链硬约束态);
--seed 可换发(QuadView 布局随机,人数/格数不符时重roll)。
用法:python3 apps/build/scripts/daojie_charsheet_onegen_run_0920.py [--seed N]
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


def main() -> int:
    ap = argparse.ArgumentParser(description="一次成表硬约束实弹")
    ap.add_argument("--seed", type=int, default=None, help="覆盖 [53] 种子(重roll 用)")
    args = ap.parse_args()
    base = cs.probe_base().rstrip("/")

    ref_png = cs.DOWNLOADS / "step1_立绘_人物型_seed42.png"
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    up = cs.upload_image(base, ref_png)
    print(f"[onegen] 参考图上传: {up}", flush=True)

    wf = json.loads(cs.WF_SHEET.read_text(encoding="utf-8"))
    overrides = {"72.image": up}
    if args.seed is not None:
        overrides["53.seed"] = args.seed
    graph = cs.ui_to_api_sheet(wf, oi, overrides)
    summary = {"seed": graph["53"]["inputs"]["seed"],
               "steps": graph["53"]["inputs"]["steps"]}

    cs.EXEC_TIMEOUT_S = 3600
    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    tag = "step2_一次成表_硬约束四视图"
    cs.settle(rec, tag)
    cs.merge_audit([rec], "post-mod-onegen", {
        "purpose": "一次成表(用户五硬约束:半身/正/90°侧/180°背/纯白底垂衣)",
        "trigger_node": "308(工作流文件真源)"})
    print(f"[onegen] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[onegen] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
