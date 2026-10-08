#!/usr/bin/env python3
"""RGBA四型·透明极简公式重拍(1008)——走真 ApiPE.rewrite 透传分支(确定性 lean)。

每型:主体句取 R3 装配文快照(同 R3 逐字)→ MyQi21ApiPE().rewrite(透明模式=True,
api_url=不可达→透传分支=极简公式 head_en+主体句+tail_en)→ T8 FunAcc 同seed出图
→ S11 校准门机检(四角16px alpha≤2 + 全透≥50%)。
产物:apps/output/bgscope-r3-9types/<型>.lean.png
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
sys.path.insert(0, str(REPO / "apps/backend"))
ENGINE = "http://127.0.0.1:17001"
SRC = REPO / "apps/output/bgscope-r3-9types"
TYPES = [("道具", 2011), ("多视图", 2013), ("高清人脸", 2014), ("表情差分", 2016)]


def subject_of(zh: str) -> str:
    """从 R3 装配文快照提取主体句(头行═══ 主体句…═══ 之后、下一═══之前的正文行)。"""
    lines = (SRC / f"{zh}.装配文.txt").read_text(encoding="utf-8").split("\n")
    out, on = [], False
    for ln in lines:
        if ln.startswith("═══ 主体句"):
            on = True
            continue
        if on:
            if ln.startswith("═══"):
                break
            if ln.strip():
                out.append(ln.strip())
    return "\n".join(out).strip()


CONTENT_MARK = {"道具": "青铜剑", "多视图": None, "高清人脸": None, "表情差分": None}


def main() -> None:
    from engines.comfyui.my_nodes.nodes import my_qi21_api_pe, my_qi21_base
    node = my_qi21_api_pe.MyQi21ApiPE()
    base_node = my_qi21_base.MyQi21DaojieBase()
    only = sys.argv[1:] or [zh for zh, _ in TYPES]
    for zh, seed in TYPES:
        if zh not in only:
            continue
        subj = subject_of(zh)
        base_text, w, h, neg_text, _t = base_node.run(zh)
        r = node.rewrite(正向提示词=subj, 类型句正向=base_text, 类型句负向=neg_text,
                         画幅宽=int(w), 画幅高=int(h), 透明模式=True,
                         api_url="http://127.0.0.1:9", timeout_sec=3)
        pos, neg, tm, w2, h2 = r["result"]
        assert pos.startswith("This is an RGBA format image"), f"{zh} 未走极简公式"
        mark = CONTENT_MARK.get(zh)
        if mark:
            assert mark in pos, f"{zh} 主体句丢失(极简公式体不含『{mark}』)——提取逻辑坏"
        assert "平涂" not in pos and "美术风格底座" not in pos, f"{zh} 富装配泄漏"
        (SRC / f"{zh}.lean.装配文.txt").write_text(
            f"# 型={zh} seed={seed} 透明极简公式 正向{len(pos)}字\n\n═══ 进编码正向 ═══\n{pos}\n\n═══ 进编码负向 ═══\n{neg}\n",
            encoding="utf-8")
        g = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "qwen_image_2.1_bf16.safetensors", "weight_dtype": "default"}},
            "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen3vl_8b_bf16_heretic.safetensors", "type": "qwen_image", "device": "default"}},
            "3": {"class_type": "VAELoader", "inputs": {"vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
            "7013": {"class_type": "T8QwenImage21FunAccPDD4Step",
                     "inputs": {"model": ["1", 0], "positive": ["4015", 0], "latent_image": ["4", 0],
                                "model_file": "Qwen-Image-2.1-Fun-Acc-4Step-PDD-T8.safetensors", "seed": seed}},
            "4015": {"class_type": "TextEncodeQwenImage21",
                     "inputs": {"prompt": pos, "negative_prompt": neg, "resolution": 1024, "clip": ["2", 0]}},
            "4": {"class_type": "EmptyLatentImage", "inputs": {"width": int(w2), "height": int(h2), "batch_size": 1}},
            "5": {"class_type": "VAEDecode", "inputs": {"samples": ["7013", 0], "vae": ["3", 0]}},
            "8": {"class_type": "SaveImage", "inputs": {"images": ["5", 0], "filename_prefix": f"QI21_R3lean_{zh}"}},
        }
        req = urllib.request.Request(f"{ENGINE}/prompt", data=json.dumps({"prompt": g, "client_id": "r3-lean"}).encode(),
                                     headers={"Content-Type": "application/json"})
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
        print(f"[{zh}] lean正向{len(pos)}字 seed={seed} queued {pid}", flush=True)
        t0 = time.time()
        while time.time() - t0 < 900:
            time.sleep(8)
            with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as resp:
                hist = json.load(resp)
            if pid in hist:
                outs = hist[pid].get("outputs", {})
                done = False
                for _nid, o in outs.items():
                    for img in o.get("images", []):
                        url = (f"{ENGINE}/view?filename={urllib.parse.quote(img['filename'])}"
                               f"&subfolder={urllib.parse.quote(img.get('subfolder', ''))}&type=output")
                        dst = SRC / f"{zh}.lean.png"
                        urllib.request.urlretrieve(url, dst)
                        print(f"[{zh}] DONE {dst} ({time.time()-t0:.0f}s)", flush=True)
                        done = True
                        break
                if done:
                    break
        else:
            print(f"[{zh}] TIMEOUT", flush=True)
            sys.exit(1)
    # ── S11 校准门机检 ──
    print("\n═══ S11 alpha 机检(四角16px≤2 + 全透≥50%) ═══")
    from PIL import Image
    allpass = True
    for zh, _seed in TYPES:
        if zh not in only:
            continue
        im = Image.open(SRC / f"{zh}.lean.png").convert("RGBA")
        W, H = im.size
        px = im.load()
        corners = [px[x, y][3] for x, y in ((15, 15), (W - 16, 15), (15, H - 16), (W - 16, H - 16))]
        alphas = list(im.getchannel("A").getdata())
        n = len(alphas)
        full = sum(1 for a in alphas if a <= 2) / n * 100
        semi = sum(1 for a in alphas if 3 <= a <= 250) / n * 100
        ok = max(corners) <= 2 and full >= 50
        allpass &= ok
        print(f"[{zh}] {W}x{H} 四角={corners} 全透={full:.2f}% 半透={semi:.2f}% → {'PASS' if ok else 'FAIL'}")
    sys.exit(0 if allpass else 1)


if __name__ == "__main__":
    main()
