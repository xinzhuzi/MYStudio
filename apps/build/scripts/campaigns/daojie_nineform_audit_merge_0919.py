#!/usr/bin/env python3
"""九型实弹·配方版 runs_audit 补记合并(09-19;首轮引擎中断的诚实重建)。

背景:首轮 7 跑完成(图已双落、四锚校验全过),第 8 跑(表情差分)执行中引擎
连接中断崩溃,脚本在 wait_idle 处未捕获连接异常即退出——runs_audit.json
未落盘。引擎自动重启(17001)后 --only 续跑补齐缺型。

本脚本把首轮 7 跑诚实并回审计:
  ran=true 依据=首轮日志「完成」行(=四锚全过:status/正向头/主体句/按型清单);
  bytes/sha256/pixel_sha256=盘上 PNG 实算;wall_s=日志值;prompt_id=首轮
  值已不可考,置 null 并标 audit_reconstructed;key_inputs=确定性配置重建
  (seed=42/原生分辨率/主体句/预期 applied 与续跑同源同式)。
首轮日志全文存档为同目录 first_pass_log.txt(证据链)。

用法:python3 apps/build/scripts/daojie_nineform_audit_merge_0919.py
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import struct
import sys
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_nineform_recipe_livefire_0919 import (  # noqa: E402
    BASES_JSON, STACK_JSON, SUBJECTS, WS_DIR, expected_applied, native_px,
    sha256_bytes, png_pixel_sha)

FIRST_PASS_LOG = Path("/tmp/nineform_livefire.log")
AUDIT = WS_DIR / "runs_audit.json"


def main() -> int:
    if not FIRST_PASS_LOG.is_file():
        print("✗ 首轮日志不在(/tmp/nineform_livefire.log)", file=sys.stderr)
        return 2
    log = FIRST_PASS_LOG.read_text(errors="replace")
    walls = {m.group(1): float(m.group(2)) for m in re.finditer(
        r"\[九型\] (.+?) 完成 wall=([\d.]+)s", log)}
    audit = json.loads(AUDIT.read_text(encoding="utf-8"))
    bases = {e["zh"]: e for e in json.loads(BASES_JSON.read_text(encoding="utf-8"))}
    slots = json.loads(STACK_JSON.read_text(encoding="utf-8"))

    existing = {r["name"]: r for r in audit["runs"]}
    rebuilt = 0
    for zh, entry in bases.items():
        if zh in existing:
            continue
        png = WS_DIR / f"{zh}.png"
        if not png.is_file() or zh not in walls:
            continue
        data = png.read_bytes()
        w, h = native_px(entry["aspect_ratio"], entry["megapixels"])
        rec = {
            "name": zh, "ran": True, "audit_reconstructed": True,
            "prompt_id": None,
            "wall_s": walls[zh],
            "recipe": " + ".join(f"{Path(i['file']).name}×{i['weight']:g}"
                                 for i in entry["lora_recipe"]),
            "native": f"{w}×{h}",
            "key_inputs": {
                "seed": 42, "steps": 4, "cfg": 1, "w": w, "h": h, "base": zh,
                "preset": "跟随底座型", "90.base_link": ["80", 4]},
            "expected_applied_90": expected_applied(zh, slots),
            "checks": {"final_head_ok": True, "subject_ok": True,
                       "applied_90_ok": True,
                       "evidence": "首轮日志「完成」行=四锚全过;见 first_pass_log.txt"},
            "bytes": len(data), "sha256": sha256_bytes(data),
            "pixel_sha256": png_pixel_sha(data),
            "output": str(Path.home() / "Downloads" / "daojie_nineform_recipe_0919"
                          / f"{zh}.png"),
            "ws_copy": str(png),
        }
        existing[zh] = rec
        rebuilt += 1

    audit["runs"] = [existing[n] for n in SUBJECTS if n in existing]
    audit["runs_total"] = len(audit["runs"])
    audit["ok_count"] = sum(1 for r in audit["runs"] if r.get("ran"))
    audit["first_pass_interruption"] = (
        "首轮 7 跑完成后续跑中引擎连接中断(表情差分 ConnectionReset;日志末见 "
        "引擎侧栈,自动重启于 17001);--only 续跑补齐 2 型;7 跑条目由盘上 PNG"
        "+首轮日志补记(prompt_id 不可考置 null,余皆实算/日志实录)")
    AUDIT.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
                     encoding="utf-8")
    shutil.copyfile(FIRST_PASS_LOG, WS_DIR / "first_pass_log.txt")
    print(json.dumps({"rebuilt": rebuilt, "runs_total": audit["runs_total"],
                      "ok_count": audit["ok_count"]}, ensure_ascii=False))
    return 0 if audit["ok_count"] == audit["runs_total"] == 9 else 1


if __name__ == "__main__":
    sys.exit(main())
