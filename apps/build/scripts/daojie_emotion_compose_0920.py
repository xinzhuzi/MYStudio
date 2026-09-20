#!/usr/bin/env python3
"""表情差分方案C·每表情单独生成再拼九宫格(09-20 裁定11 后续)。

用户裁定:「很多表情看起来都没有展示出来」——九格塞一张时每格表情表达力不足
(微表情在小格糊化,怒/惧/惊讶等强情绪全垮)。行业同款解法=每表情单独整图
(NGA 解包/站酷 AVG 流),本脚本:9 张人脸特写型(高清人脸底座,三件+金雾0.8)
独立生成(同身份句+同 seed=同脸锚,每句带情绪的五官物理描述强化),拼 3×3
九宫格 3072×3072,再叠情绪标签(标签脚本复用)。
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

ID = "同一位红衣女修"
PANELS = [
    ("沉静", f"{ID}面容特写，沉静神情：双目平和微垂，眉舒展，唇线平直放松，面部松弛；头顶至锁骨正面平视。"),
    ("含笑", f"{ID}面容特写，含笑不语：眼角弯起细纹，嘴角上扬轻抿，眉梢微挑，笑意盈而不露齿；头顶至锁骨正面平视。"),
    ("怒", f"{ID}面容特写，怒意：剑眉倒竖，怒目圆睁目光锐利，牙关紧咬嘴角下压，面部肌肉绷紧；头顶至锁骨正面平视。"),
    ("哀", f"{ID}面容特写，哀恸：眉梢下垂呈八字，眼睑低垂含泪光，嘴角向下微微颤抖；头顶至锁骨正面平视。"),
    ("惧", f"{ID}面容特写，惊惧：眉毛高挑向眉心收拢，双眼圆睁，唇微张开颤，脸色发白；头顶至锁骨正面平视。"),
    ("凌厉", f"{ID}面容特写，凌厉：双眼眯起目光如刀，眉峰锐利下压，嘴角紧抿一侧微挑，杀意凛然；头顶至锁骨正面平视。"),
    ("惊讶", f"{ID}面容特写，惊讶：眉毛高高挑起，双眼睁大，唇微张成小圆，头微微后仰；头顶至锁骨正面平视。"),
    ("害羞", f"{ID}面容特写，害羞：双颊染红晕，眼帘低垂躲闪，嘴角含羞轻抿，头微侧偏；头顶至锁骨正面平视。"),
    ("决然", f"{ID}面容特写，决然：目光坚定直视前方，眉宇紧锁有力，嘴角平直牙关咬紧，神情刚毅；头顶至锁骨正面平视。"),
]
CELL, SEED = 1024, 42
OUT_DIR = Path.home() / "Downloads/daojie_emotion_compose_0920"
STRIP = Path.home() / "Downloads/daojie_nineform_recipe_0919/表情差分_C案_拼板.png"


def main() -> int:
    base = nf.probe_base().rstrip("/")
    print(f"engine={base}", flush=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    wf_src = json.loads(nf.WF_DAOJIE.read_text(encoding="utf-8"))
    bases = {e["zh"]: e for e in json.loads(nf.BASES_JSON.read_text(encoding="utf-8"))}
    slots = json.loads(nf.STACK_JSON.read_text(encoding="utf-8"))
    oi = http_json(f"{base}/object_info", timeout=60)
    oi.get("ResolutionSelector", {}).get("input", {}).get("optional", {}).pop("preview", None)
    want = nf.expected_applied("高清人脸", slots)
    head = bases["高清人脸"]["positive"]

    from PIL import Image
    grid = Image.new("RGB", (CELL * 3, CELL * 3), (248, 248, 248))
    for i, (name, sent) in enumerate(PANELS):
        out_png = OUT_DIR / f"panel_{i}_{name}.png"
        if not (out_png.is_file() and out_png.stat().st_size > 100_000):
            if not nf.wait_idle(base):
                print(f"[{name}] SKIP 引擎忙", flush=True)
                return 1
            ov = {"12.seed": SEED, "53.width": CELL, "53.height": CELL,
                  "50.value": sent, "80.base": "高清人脸"}
            graph = ui_to_api(json.loads(json.dumps(wf_src)), oi, ov)
            graph["80"]["inputs"].pop("negative", None)
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
            assert sent[:10] in final, f"[{name}] 主体句校验失败"
            assert applied == want, f"[{name}] LoRA 清单不符:{applied}"
            img = nf.first_image(entry)
            assert img, f"[{name}] 无图"
            import urllib.request
            urllib.request.urlretrieve(
                f"{base}/view?filename={img['filename']}&subfolder={img.get('subfolder','')}&type={img.get('type','output')}",
                out_png)
            print(f"[{name}] 完成 wall={wall:.0f}s 校验全过", flush=True)
        else:
            print(f"[{name}] 已有,跳过", flush=True)
        panel = Image.open(out_png).convert("RGB")
        if panel.size != (CELL, CELL):
            panel = panel.resize((CELL, CELL), Image.LANCZOS)
        grid.paste(panel, ((i % 3) * CELL, (i // 3) * CELL))

    grid.save(STRIP, "PNG")
    print(f"九宫格拼板已存 {STRIP}({CELL*3}×{CELL*3})", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
