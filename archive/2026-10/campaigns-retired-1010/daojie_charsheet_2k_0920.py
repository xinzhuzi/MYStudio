#!/usr/bin/env python3
"""角色设定表 2K 实弹(09-20;补课:步2 分辨率 1536×1024 → 2K 口径)。

背景:fd13403 交付的设定板步输出恒 1536×1024([156] EmptySD3LatentImage 现值),
用户口径=2K。本脚本不改工作流文件,构造 API 图时 override [156] 尺寸实弹验证:
  · 尺寸=2568×1712(native_px 3:2 × 4.2MP;t2i 人物档同 4.2MP 口径);
  · 配置=A2 终态(人物型+turbo 急停,seed2027,10 步 lcm);
  · 判据=出图成功+实际像素=2568×1712(VLM/采样链在高 MP 下不炸)。

构图漂移为已知风险(同种子换分辨率必漂,09-18 在案),如实记录不判失败。
图双落 ~/Downloads/daojie_charsheet_0919/ 与 docs/prompts/道劫_设定表实弹_0919/;
台账段 post-mod-2k。EXEC_TIMEOUT_S 放大至 3600(2K 首图冷估 13~20 分钟)。
用法:python3 apps/build/scripts/daojie_charsheet_2k_0920.py [--base-url …]
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

W2K, H2K = 2568, 1712  # 3:2(模板 FIXED LANDSCAPE 锁横幅)× 4.2MP,与 t2i 人物档同 MP 口径
TAG = "step2_设定板_A2_人物_2K_无turbo"


def main() -> int:
    ap = argparse.ArgumentParser(description="设定板 2K 实弹")
    ap.add_argument("--base-url", default=cs.probe_base())
    ap.add_argument("--from-file", action="store_true",
                    help="验证文件本体默认值(不 override [156],工作流已落账 2K 后用)")
    args = ap.parse_args()
    base = args.base_url.rstrip("/")

    tag = TAG
    mode = "override-2568x1712"
    if args.from_file:
        tag = "step2_设定板_文件本体_2K_无turbo"
        mode = "file-default(零 override,验证工作流本体)"

    cs.EXEC_TIMEOUT_S = 3600  # 2K 首图冷估远超默认 900s
    ref_png = cs.DOWNLOADS / "step1_立绘_人物型_seed42.png"
    if not ref_png.is_file():
        print("✗ 缺立绘参考图(先跑 daojie_charsheet_logic_0919.py --only charshot)",
              file=sys.stderr)
        return 1

    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop(
        "preview", None)

    up = cs.upload_image(base, ref_png)
    print(f"[2k] 参考图上传: {up}", flush=True)
    graph, summary = cs.sheet_graph(oi, up, None if args.from_file else "人物", None)
    if not args.from_file:
        graph["156"]["inputs"]["width"] = W2K
        graph["156"]["inputs"]["height"] = H2K
    summary.update(resolution=f"{graph['156']['inputs']['width']}×{graph['156']['inputs']['height']}",
                   mode=mode, note="A2 终态(文件默认:设定板档+turbo 急停+人物)")

    rec: dict = {"ran": False, **summary}
    rec = cs.submit(base, graph, rec)
    cs.settle(rec, tag)
    cs.merge_audit([rec], "post-mod-2k", {
        "purpose": ("步2 分辨率 2K 实弹([156] override 2568×1712,文件未动)"
                    if not args.from_file else
                    "步2 文件本体默认值验证(零 override;工作流 [156] 已落账 2K)"),
        "config": "A2 终态(设定板档+turbo 急停+人物/seed2027/10 步 lcm)",
        "mode": mode, "resolution": summary["resolution"]})
    print(f"[2k] {'OK' if rec.get('ran') else rec.get('skip_reason')} "
          f"wall={rec.get('wall_s')}s bytes={rec.get('bytes')}", flush=True)
    if rec.get("detail"):
        print(f"[2k] detail: {rec['detail']}", flush=True)
    return 0 if rec.get("ran") else 1


if __name__ == "__main__":
    sys.exit(main())
