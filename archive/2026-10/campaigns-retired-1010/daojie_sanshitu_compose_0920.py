#!/usr/bin/env python3
"""三视图方案C·分格拼板(09-20 裁定12 后续,用户三连否单发格数漂移)。

根因:提示词=软约束,K2 宽幅 3MP 处格数不稳定(21:9 塞爆/3072 首张净/次张又多2)。
硬保证:4 张单图各自生成(单人物=K2 最强区,格数永不失控)→程序拼 3072×1024
(四格恰 768×1024)。同角色锚=身份段四句恒定+同 seed(09-20 人脸V2 锚法实证)。
面板:[80]=人物型(3:4·4.2=1816×2424),LoRA 走人物配方(跟随底座型)。
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import daojie_nineform_recipe_livefire_0919 as nf  # noqa: E402
from daojie_livefire_0917 import http_json, ui_to_api  # noqa: E402

lf = nf.lf
lf.SKIP_NODES = {20, 61, 88}

IDENT = "同一位玄色劲装的青年刀修"
PANELS = [
    ("半身", f"{IDENT}半身特写：正面平视，束发利落，神情沉静，中性微表情；头顶至胸腹入画。"),
    ("正面", f"{IDENT}全身立像：正面视角，自然站姿，双臂拢袖自然下垂，腰侧佩刀不持握；头顶至脚底完整入画。"),
    ("侧面", f"{IDENT}全身立像：正侧面视角(左侧九十度)，同以自然站姿，双臂拢袖自然下垂，腰侧佩刀不持握；头顶至脚底完整入画。"),
    ("背面", f"{IDENT}全身立像：背面视角，同以自然站姿，双臂拢袖自然下垂，腰侧佩刀不持握；头顶至脚底完整入画。"),
]
CELL_W, CELL_H, SEED = 768, 1024, 42
OUT_DIR = Path.home() / "Downloads/daojie_sanshitu_compose_0920"
STRIP = Path.home() / "Downloads/daojie_nineform_recipe_0919/三视图_C案_拼板.png"


def main() -> int:
    import os
    base = os.environ.get("DAOJIE_BASE_URL", nf.probe_base()).rstrip("/")
    print(f"engine={base}", flush=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wf_src = json.loads(nf.WF_DAOJIE.read_text(encoding="utf-8"))
    bases = {e["zh"]: e for e in json.loads(nf.BASES_JSON.read_text(encoding="utf-8"))}
    slots = json.loads(nf.STACK_JSON.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    w, h = nf.native_px("3:4 (Portrait Standard)", 4.2)
    want = nf.expected_applied("人物", slots)
    head = bases["人物"]["positive"]

    from PIL import Image
    strip = Image.new("RGB", (CELL_W * 4, CELL_H), (248, 248, 248))
    for i, (name, sent) in enumerate(PANELS):
        out_png = OUT_DIR / f"panel_{i}_{name}.png"
        if out_png.is_file() and out_png.stat().st_size > 100_000:
            print(f"[{name}] 已有,跳过生成", flush=True)
        else:
            if not nf.wait_idle(base):
                print(f"[{name}] SKIP 引擎忙", flush=True)
                return 1
            ov = {"12.seed": SEED, "53.width": w, "53.height": h,
                  "50.value": sent, "80.base": "人物"}
            graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, ov)
            graph["80"]["inputs"].pop("negative", None)
            t0 = time.time()
            resp = http_json(f"{base}/prompt", {"prompt": graph, "client_id": nf.CLIENT_ID}, timeout=60)
            if resp.get("node_errors"):
                print(f"[{name}] node_errors:{json.dumps(resp['node_errors'])[:300]}", flush=True)
                return 1
            entry, wall = nf.wait_done(base, resp["prompt_id"])
            if entry is None or entry.get("status", {}).get("status_str") != "success":
                print(f"[{name}] 执行失败", flush=True)
                return 1
            final = nf.node_output_text(entry, "62")
            applied = nf.node_output_text(entry, "86")
            assert final and final.startswith(head), f"[{name}] 正向头校验失败"
            assert sent[:12] in final, f"[{name}] 主体句校验失败"
            assert applied == want, f"[{name}] LoRA 清单不符:{applied}"
            img = nf.first_image(entry)
            assert img, f"[{name}] 无图"
            import urllib.parse
            import urllib.request
            urllib.request.urlretrieve(
                f"{base}/view?filename={urllib.parse.quote(img['filename'])}&subfolder={urllib.parse.quote(img.get('subfolder',''))}&type={img.get('type','output')}",
                out_png)
            print(f"[{name}] 完成 wall={wall:.0f}s 校验全过", flush=True)
        panel = Image.open(out_png).convert("RGB").resize((CELL_W, CELL_H), Image.LANCZOS)
        strip.paste(panel, (i * CELL_W, 0))

    strip.save(STRIP, "PNG")
    print(f"拼板已存 {STRIP}({CELL_W*4}×{CELL_H})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
