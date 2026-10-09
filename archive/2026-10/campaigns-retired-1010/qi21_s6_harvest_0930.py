#!/usr/bin/env python3
# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available via COMMERCIAL_LICENSE.md.
"""qi21 S6 首拍事后收割(09-30,Trellis 09-29-qi21-canvas-batch S6)。

首跑驱动器 alpha 判读行有 JS 越权访问 bug(读 metrics.ihdr 崩,t1/t2 两拍的
文证/截图拍内未采),引擎侧执行与 history 完整——本件从 /history 按拍签名
(三态 mode+型 base+档位 mode+seed value 四元组,与驱动器同式)收割:
  status / 产物图(/view 落盘) / 最终文本([27] 装配预览 text 输出)。
不做(如实记缺失):tee 执行帧(页面已逝)/拍内截图。

用法:python3 qi21_s6_harvest_0930.py [engine_hostport=127.0.0.1:17599]
stdout=JSON 收割账;退出码 0=两拍都寻获。
"""
from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
OUT_DIR = REPO / "apps/output/s6-transparency-0930"

SHOTS = [
    {"key": "t1-prop", "type": "道具", "rgba": "跟随型", "speed": "0 · 直出40步", "seed": 9001, "expect": "transparent"},
    {"key": "t2-multiview", "type": "多视图", "rgba": "跟随型", "speed": "0 · 直出40步", "seed": 9002, "expect": "transparent"},
]


def get(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=120) as r:
        return r.read()


def main() -> int:
    base = f"http://{sys.argv[1] if len(sys.argv) > 1 else '127.0.0.1:17599'}"
    hist = json.loads(get(f"{base}/history"))
    out = {"shots": {}}
    ok = True
    for shot in SHOTS:
        found = None
        for pid, e in hist.items():
            # 分隔符对齐 JS JSON.stringify 紧凑形(签名串无空格,python 默认带空格会漏配)
            blob = json.dumps(e.get("prompt", [None, None, {}])[2] or {}, ensure_ascii=False, separators=(",", ":"))
            sig = (f'"mode":"{shot["rgba"]}"' in blob and f'"base":"{shot["type"]}"' in blob
                   and f'"mode":"{shot["speed"]}"' in blob
                   and (f'"value":{shot["seed"]},' in blob or f'"value":{shot["seed"]}}}' in blob))
            if sig:
                found = (pid, e)
                break
        rec = {"signature": f'{shot["rgba"]}|{shot["type"]}|{shot["speed"]}|seed{shot["seed"]}'}
        if not found:
            rec["found"] = False
            ok = False
            out["shots"][shot["key"]] = rec
            continue
        pid, e = found
        rec.update(found=True, pid=pid, status=e.get("status", {}).get("status_str"))
        imgs = []
        for o in (e.get("outputs") or {}).values():
            imgs.extend(o.get("images") or [])
        png = next((i for i in imgs if (i.get("type") or "output") == "output" and i["filename"].lower().endswith(".png")), None)
        if png:
            q = urllib.parse.urlencode({"filename": png["filename"], "subfolder": png.get("subfolder", ""), "type": png.get("type", "output")})
            data = get(f"{base}/view?{q}")
            path = OUT_DIR / f'{shot["key"]}-seed{shot["seed"]}.png'
            path.write_bytes(data)
            rec["png"] = str(path)
            rec["pngBytes"] = len(data)
            rec["engineFilename"] = png["filename"]
        texts = []
        for o in (e.get("outputs") or {}).values():
            texts.extend(o.get("text") or [])
        final = next((t for t in texts if len(t) > 40), "")
        rec["finalTextLen"] = len(final)
        if final:
            (OUT_DIR / f'{shot["key"]}-finaltext.txt').write_text(final, encoding="utf-8")
            rec["finalTextHead"] = final[:200]
        out["shots"][shot["key"]] = rec
    print(json.dumps(out, ensure_ascii=False, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
