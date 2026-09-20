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

ID = "同一位红衣女修，肤色白皙匀净如瓷、跨格肤色完全一致"
# 裁定13 加强版(09-20):五官全覆盖(眉/眼/鼻颊/唇/头下颌逐项)+幅度放大,
# 防 K2 滑回「修仙沉静默认脸」——「不然这个表情看起来都像一样的」。
PANELS = [
    ("沉静", f"{ID}面容特写，沉静：眉毛舒展平顺，双目半垂眼睑放松、目光低而稳，鼻息平顺鼻翼放松，唇线平直轻闭，下颌放松头正；面部肌肉全部松弛，气息安宁。"),
    ("含笑", f"{ID}面容特写，含笑：眉梢弯起微挑，双眼眯起、眼角挤出细弯笑纹、目光温润，苹果肌上提颊边微鼓，嘴角大幅上扬轻抿不露齿，头微偏；笑意从眼中透出，表情幅度鲜明。"),
    ("怒", f"{ID}面容特写，盛怒：剑眉倒竖拧向眉心，双目圆睁、怒火直逼、目光如炬，鼻翼怒张呼吸粗重，牙关紧咬嘴角狠压下撇，下颌绷紧头微前倾；面颊绷起肌肉紧绷，怒意逼人。"),
    ("哀", f"{ID}面容特写，哀恸：眉梢大幅下垂成八字、眉心蹙起，眼睑沉重半垂、双眼含泪光、目光失焦向下，鼻头微红抽动，嘴角大幅下垂微颤、嘴唇哆嗦，头微低；满面愁苦，泪将落未落。"),
    ("惧", f"{ID}面容特写，惊惧：眉毛高高挑起向眉心紧拢，双眼瞪大圆睁、瞳孔紧缩、目光惊惶游移，鼻翼急促翕张，唇瓣褪白微张轻颤、牙齿轻磕，头缩后仰僵直；额角一点冷汗，肤色基调不变。"),
    ("凌厉", f"{ID}面容特写，凌厉杀意：眉峰如刀锐利下压，双眼狠眯成缝、目光如刀锋直刺，鼻梁挺直鼻翼紧收，嘴角一侧狠挑紧抿，下颌线绷直头微侧压低；杀气凛然，眼神锐利如鹰。"),
    ("惊讶", f"{ID}面容特写，惊讶：眉毛高高扬起拉直，双眼瞪到最大、白睛微露、瞳孔放大，鼻孔微张轻吸气，唇张开成小圆形上唇微翘，头后仰肩微缩；整张脸写满错愕，表情幅度夸张。"),
    ("害羞", f"{ID}面容特写，害羞：双眉微蹙内拢下垂，眼帘低垂半闭、睫毛轻颤、目光躲闪不敢直视，双颊泛起浅浅红晕（仅颊部，肤色基调不变），嘴角含羞轻抿微微歪，头明显侧偏低垂；神情扭捏。"),
    ("决然", f"{ID}面容特写，决然：剑眉紧锁有力下压，双目圆睁、目光如铁直视前方寸步不让，鼻翼扩张深吸气，嘴角平直紧紧抿住、下颌前扬，头正肩平；眼神刚毅坚决，面部线条如刀刻。"),
]
CELL, SEED = 1024, 42
OUT_DIR = Path.home() / "Downloads/daojie_emotion_compose_0920"
STRIP = Path.home() / "Downloads/daojie_nineform_recipe_0919/表情差分_C案_拼板.png"


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
            import urllib.parse
            import urllib.request
            urllib.request.urlretrieve(
                f"{base}/view?filename={urllib.parse.quote(img['filename'])}&subfolder={urllib.parse.quote(img.get('subfolder',''))}&type={img.get('type','output')}",
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
