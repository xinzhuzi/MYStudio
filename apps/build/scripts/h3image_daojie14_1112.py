#!/usr/bin/env python3
"""h3image_daojie14_1112.py — 道劫十四型 × H3-Image 全型出图实弹(1112 用户令「14型都出图了?」)。

装配=库直写件口径三层(layer_contract.assembly_order.positive 直写行序):
  ① 主体句(docs/prompts/道劫_类型主体句示例.md §1..§14 首例围栏逐字)
  ② 型底座 positive_text(qi21_bases.json types[i])
  ③ 美术风格底座正文(qi21_bases.json art_style_base.positive_text)
负面层结构性缺席:H3-Image=CFG 蒸馏 guidance 1 无负面词(ConditioningZeroOut)。
透明底型(道具/多视图/高清人脸/表情差分/人脸基准/无衣物定妆)按 RGB 直出验内容
——RGBA 是 Qwen 线程序化包裹能力,不在本役判定面。
分辨率=型库 resolution_override(32 对齐化:2160→2176)/无 override 型按 AR×MP 推 32 对齐。
seed=2100+i 逐型定值。产物=apps/output/h3image-smoke-1112/daojie14/。
"""
from __future__ import annotations

import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
BASES = REPO / "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
EXAMPLES = REPO / "docs/prompts/道劫_类型主体句示例.md"
OUT = REPO / "apps/output/h3image-smoke-1112/daojie14"
ENGINE = "http://192.168.0.101:17000"

# 与 smoke 件同款装载四件(主机适配终版)
DIT = "minimax_h3_image_pruned_int8_convrot.safetensors"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE = "minimax_h3_image_vae_fp16.safetensors"

# §N → types[i] 行序对齐(例句库节序=型库序);无 override 型的 32 对齐推导
RES = {  # idx: (w, h, 来源)
    0: (1536, 2048), 1: (2048, 1152), 2: (1024, 1024), 3: (2048, 1152),
    4: (1824, 1024), 5: (1024, 1024), 6: (2048, 1152), 7: (1248, 1248),  # 1:1 1.5MP
    8: (2048, 1152), 9: (3840, 2176),  # 设定卡 2160→2176 对齐 32
    10: (2048, 1152), 11: (1024, 1024), 12: (960, 1280), 13: (1024, 1024),
}


def extract_subject(idx: int) -> str:
    """§{idx+1} 节首例围栏逐字(带 fire 件同款护栏:禁节头/限长)。"""
    text = EXAMPLES.read_text(encoding="utf-8")
    m = re.search(rf"^## {idx + 1}\. .*$", text, re.M)
    if not m:
        sys.exit(f"§{idx + 1} 节未找到")
    nxt = re.search(r"^## \d+\. ", text[m.end():], re.M)
    section = text[m.end(): m.end() + nxt.start()] if nxt else text[m.end():]
    fence = re.search(r"```\n(.*?)\n```", section, re.S)
    if not fence:
        sys.exit(f"§{idx + 1} 无围栏例句")
    subj = fence.group(1).strip()
    for marker in ("## ", "主体句", "历史口径"):
        if marker in subj:
            sys.exit(f"§{idx + 1} 主体句抽取污染(含「{marker}」)")
    if len(subj) > 600:
        sys.exit(f"§{idx + 1} 主体句超长 {len(subj)}")
    return subj


def build_api(prompt: str, w: int, h: int, seed: int, prefix: str):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "5": {"class_type": "MiniMaxH3ImageConditioning",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt,
                         "width": w, "height": h}},
        "6": {"class_type": "ConditioningZeroOut",
              "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["5", 0],
                         "negative": ["6", 0], "latent_image": ["5", 1],
                         "seed": seed, "steps": 6, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def main() -> int:
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    style_pos = bases["art_style_base"]["positive_text"]
    types = bases["types"]
    OUT.mkdir(parents=True, exist_ok=True)

    # 在驾门:队列双空才发
    q = json.loads(urllib.request.urlopen(f"{ENGINE}/queue", timeout=10).read())
    if q.get("queue_running") or q.get("queue_pending"):
        print(f"[FAIL] 队列非空:{len(q.get('queue_running', []))}+{len(q.get('queue_pending', []))}")
        return 9

    report = []
    for i, t in enumerate(types):
        name = t["zh"]
        subj = extract_subject(i)
        prompt = "\n".join([subj, t["positive_text"], style_pos])
        w, h = RES[i]
        seed = 2100 + i
        api = build_api(prompt, w, h, seed, f"daojie14/{i:02d}_{name}")
        body = json.dumps({"prompt": api, "client_id": "daojie14-1112"}).encode()
        req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            pid = json.loads(r.read().decode())["prompt_id"]
        t0 = time.time()
        while time.time() - t0 < 1800:
            time.sleep(5)
            try:
                hh = json.loads(urllib.request.urlopen(
                    f"{ENGINE}/history/{pid}", timeout=15).read())
            except Exception:
                continue
            if pid in hh:
                e = hh[pid]
                st = e.get("status", {})
                if st.get("status_str") == "error":
                    for mid, m in (st.get("messages") or []):
                        if mid == "execution_error":
                            print(f"[{i:02d} {name}] ERROR "
                                  f"{json.dumps(m, ensure_ascii=False)[:300]}")
                    report.append((i, name, "ERROR", 0, ""))
                    break
                if st.get("completed"):
                    fn = ""
                    for no in (e.get("outputs") or {}).values():
                        for img in no.get("images", []):
                            if img.get("type") == "output":
                                fn = img["filename"]
                                q2 = urllib.parse.urlencode(
                                    {"filename": fn,
                                     "subfolder": img.get("subfolder", ""),
                                     "type": "output"})
                                b = urllib.request.urlopen(
                                    f"{ENGINE}/view?{q2}", timeout=120).read()
                                (OUT / f"{i:02d}_{name}.png").write_bytes(b)
                    dt = time.time() - t0
                    print(f"[{i:02d} {name}] PASS {dt:.0f}s {w}x{h} {fn}")
                    report.append((i, name, "PASS", dt, fn))
                    break
        else:
            print(f"[{i:02d} {name}] TIMEOUT")
            report.append((i, name, "TIMEOUT", 1800, ""))

    ok = sum(1 for r in report if r[2] == "PASS")
    print(f"\n===== {ok}/14 PASS =====")
    return 0 if ok == 14 else 1


if __name__ == "__main__":
    sys.exit(main())
