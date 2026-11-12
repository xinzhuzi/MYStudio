#!/usr/bin/env python3
"""mac_engine_regress_1112.py — Mac 引擎 0.44→0.45.2 升级回归烟雾(1112 H3-Image 役收尾)。

回归件=qi21 线最小 t2i(道劫图像产线日常在跑的链形):UNET+TE(heretic)+VAE+TextEncodeQwenImage21
+EmptyLatentImage+KSampler(有 turbo LoRA 则 8步 cfg1,无则 25步)+VAEDecode+SaveImage。
模型名单=object_info 现查自适应(不硬编码文件名);产物落 apps/output/h3image-smoke-1112/。
引擎口=manifest.json engine.port(Mac 冷启动由 App 拉起后本脚本才可跑)。
"""
from __future__ import annotations

import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

MANIFEST = Path.home() / "Library/Application Support/漫影工作室/comfyui/manifest.json"
OUT = Path("/Users/zhengbingjin/Project/Github/MYStudio/apps/output/h3image-smoke-1112")
PROMPT = "一位青衣女修立于云海石阶之上,水墨国风,大量留白,矿物色"


def engine() -> str:
    port = json.loads(MANIFEST.read_text(encoding="utf-8"))["engine"]["port"]
    return f"http://127.0.0.1:{port}"


def obj(cls):
    with urllib.request.urlopen(f"{engine()}/object_info/{urllib.parse.quote(cls)}", timeout=20) as r:
        return json.loads(r.read())[cls]


def pick(names, *keys, exclude=()):
    for n in names:
        if all(k.lower() in n.lower() for k in keys) and not any(e.lower() in n.lower() for e in exclude):
            return n
    return None


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    unet = pick(obj("UNETLoader")["input"]["required"]["unet_name"][0], "qwen")
    clip = pick(obj("CLIPLoader")["input"]["required"]["clip_name"][0], "qwen3", "heretic")
    vae = pick(obj("VAELoader")["input"]["required"]["vae_name"][0], "qwen")
    loras = obj("LoraLoaderModelOnly")["input"]["required"]["lora_name"][0]
    turbo = pick(loras, "turbo") or pick(loras, "avg_rank")
    if not (unet and clip and vae):
        print(f"[FAIL] 模型名单缺件 unet={unet} clip={clip} vae={vae}")
        return 2
    use_turbo = turbo is not None
    print(f"选型: unet={unet} clip={clip} vae={vae} turbo_lora={turbo}")

    api: dict = {}
    api["1"] = {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}}
    nid = "1"
    if use_turbo:
        api["10"] = {"class_type": "LoraLoaderModelOnly",
                     "inputs": {"lora_name": turbo, "strength_model": 1.0, "model": ["1", 0]}}
        nid = "10"
    api["2"] = {"class_type": "CLIPLoader",
                "inputs": {"clip_name": clip, "type": "qwen_image", "device": "default"}}
    api["3"] = {"class_type": "VAELoader", "inputs": {"vae_name": vae}}
    api["4"] = {"class_type": "TextEncodeQwenImage21",
                "inputs": {"clip": ["2", 0], "prompt": PROMPT, "negative_prompt": "",
                           "resolution": 0}}  # resolution=参考图归一化,t2i 无参考恒 0
    api["5"] = {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}}
    api["6"] = {"class_type": "KSampler",
                "inputs": {"model": [nid, 0], "positive": ["4", 0], "negative": ["4", 1],
                           "latent_image": ["5", 0], "seed": 4242,
                           "steps": 8 if use_turbo else 25, "cfg": 1.0,
                           "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}}
    api["7"] = {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["3", 0]}}
    api["8"] = {"class_type": "SaveImage",
                "inputs": {"images": ["7", 0], "filename_prefix": "regress_1112/mac_qi21"}}

    body = json.dumps({"prompt": api, "client_id": "mac-regress-1112"}).encode()
    req = urllib.request.Request(f"{engine()}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read().decode())["prompt_id"]
    except urllib.error.HTTPError as e:
        print(f"[FAIL] /prompt {e.code}: {e.read().decode()[:600]}")
        return 3
    print("prompt_id:", pid, flush=True)

    t0 = time.time()
    while time.time() - t0 < 1200:
        time.sleep(6)
        try:
            with urllib.request.urlopen(f"{engine()}/history/{pid}", timeout=15) as r:
                h = json.loads(r.read())
        except Exception:
            continue
        if pid in h:
            e = h[pid]
            st = e.get("status", {})
            for mid, m in (st.get("messages") or []):
                if mid == "execution_error":
                    print("execution_error:", json.dumps(m, ensure_ascii=False)[:400])
                    return 4
            if st.get("completed"):
                files = []
                for no in (e.get("outputs") or {}).values():
                    for img in no.get("images", []):
                        if img.get("type") != "output":
                            continue
                        q = urllib.parse.urlencode({"filename": img["filename"],
                                                    "subfolder": img.get("subfolder", ""),
                                                    "type": "output"})
                        b = urllib.request.urlopen(f"{engine()}/view?{q}", timeout=60).read()
                        fp = OUT / f"regress-mac__{img['filename']}"
                        fp.write_bytes(b)
                        files.append(fp.name)
                print(f"MAC REGRESS PASS {time.time()-t0:.0f}s files={files}")
                return 0
    print("[FAIL] 超时")
    return 5


if __name__ == "__main__":
    sys.exit(main())
