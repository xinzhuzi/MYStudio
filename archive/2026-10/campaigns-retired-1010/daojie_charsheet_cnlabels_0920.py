#!/usr/bin/env python3
"""角色设定表中文标注对照实弹(09-20;回应用户「必须英文?」的根因定谳)。

假设:K2(Krea2/FLUX 系)底模写不了真汉字,画面标注文字可靠域=拉丁字母;
官方模板 VISIBLE TEXT 段「All labels must be English only」正是这一边界的产品化。
本脚本单变量改 [184] VLM 指令模板(English only → Simplified Chinese only,
左栏 metadata 列的 readable English 一并改),其余全同 A2 终态。
判据=读图:左栏画出真汉字(假设推翻,改模板即可)/假字乱码(假设证实,
汉字须走程序叠加或换 Qwen-Image-Edit 2509 底模,见汇报三案)。

1536×1024 快档(只为看文字形态,5 分钟级);图双落 Downloads 与仓库;台账段 post-mod-cn。
用法:python3 apps/build/scripts/daojie_charsheet_cnlabels_0920.py [--base-url …]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_charsheet_logic_0919 as cs  # noqa: E402
from daojie_charsheet_logic_0919 import http_json  # noqa: E402

TAG = "step2_设定板_CN标注_无turbo"
REPLACEMENTS = [
    ("All labels must be English only.",
     "All labels must be written in Simplified Chinese (简体中文汉字) only."),
    ("in compact readable English",
     "in compact readable Simplified Chinese (简体中文汉字)"),
]


def main() -> int:
    ap = argparse.ArgumentParser(description="设定板中文标注对照实弹")
    ap.add_argument("--base-url", default=cs.probe_base())
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
    print(f"[cn] 参考图上传: {up}", flush=True)
    graph, summary = cs.sheet_graph(oi, up, "人物", None)
    instr = graph["184"]["inputs"]["value"]  # PrimitiveStringMultiline 输入名=value
    hits = sum(instr.count(old) for old, _ in REPLACEMENTS)
    for old, new in REPLACEMENTS:
        instr = instr.replace(old, new)
    graph["184"]["inputs"]["value"] = instr
    summary.update(replaced_clauses=hits, note="单变量:VISIBLE TEXT+左栏列改中文要求")
    if hits < len(REPLACEMENTS):
        print(f"[cn] 警告: 指令模板命中 {hits}/{len(REPLACEMENTS)} 处(模板漂移?)", flush=True)

    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    cs.settle(rec, TAG)
    cs.merge_audit([rec], "post-mod-cn", {
        "purpose": "中文标注对照([184] English only→简体中文,单变量;A2 终态其余恒定)",
        "verdict_pending": "待读图:真汉字=换模板即可/假字乱码=底模不可行须程序叠加或换底模"})
    print(f"[cn] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[cn] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
