#!/usr/bin/env python3
"""四格拼版工作流文件本体实弹(09-20 十轮)。

工作流=四支单视角子链(半身/正/侧/背各一支)+[307] 拼版标注(人数/视角/
顺序由图结构定死)。本脚本零 override 直读文件提交(旧 sheet_graph 的
[53].seed 硬编码 override 在 mute 单链后失效,故直调 ui_to_api_sheet)。
图落双目录;台账段 post-mod-compose-final。
用法:python3 apps/build/scripts/daojie_charsheet_compose_run_0920.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_charsheet_logic_0919 as cs  # noqa: E402
from daojie_charsheet_logic_0919 import http_json  # noqa: E402

TAG = "step2_四格拼版_半身正侧背_2K"


def main() -> int:
    base = cs.probe_base().rstrip("/")
    ref_png = cs.DOWNLOADS / "step1_立绘_人物型_seed42.png"
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    up = cs.upload_image(base, ref_png)
    print(f"[compose] 参考图上传: {up}", flush=True)

    wf = json.loads(cs.WF_SHEET.read_text(encoding="utf-8"))
    graph = cs.ui_to_api_sheet(wf, oi, {"72.image": up})
    summary = {"mode": "file-default(四支拼版,零参数 override)"}

    cs.EXEC_TIMEOUT_S = 3600
    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    cs.settle(rec, TAG)
    cs.merge_audit([rec], "post-mod-compose-final", {
        "purpose": "四支单视角拼版文件本体实弹(半身/正/侧/背定死)",
        "ref_image": str(ref_png)})
    print(f"[compose] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[compose] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
