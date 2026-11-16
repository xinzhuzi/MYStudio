#!/usr/bin/env python3
"""superi_j5pilot_fire_1115.py — qi21 型库 J5 试点实弹(1115 全开批,审计件#1 唯一缺口)。

装配=API 直连装配(库直写三层,h3image_daojie14_1112.py 同口径):
  ① 主体句(docs/prompts/道劫_类型主体句示例.md §2 首例围栏逐字)
  ② 型底座 positive_text(qi21_bases.json types[1] 场景——每次发弹现读本仓 JSON,
     引擎数据层不消费;变体弹自然吃改后真源,无同步链依赖)
  ③ 美术风格底座正文(art_style_base.positive_text)
场景型 2048×1152,seed=2101 恒定(与 1112 十四型役场景弹同 seed 口径)。
负面层结构性缺席(H3-Image=CFG 蒸馏 guidance 1,ConditioningZeroOut)。
产物=apps/output/superi_j5pilot_1115/{基线,变体}.png。

用法:
  python3 superi_j5pilot_fire_1115.py fire --tag 基线|变体
  python3 superi_j5pilot_fire_1115.py assert <variant_pid>   # history 装配链断言
  python3 superi_j5pilot_fire_1115.py quant                   # alpha+色彩量化 A/B
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
OUT = REPO / "apps/output/superi_j5pilot_1115"
ENGINE = "http://192.168.0.101:17000"
SEED = 2101
W, H = 2048, 1152
TYPE_IDX = 1  # 场景

DIT = "minimax_h3_image_pruned_int8_convrot.safetensors"
TE = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE = "minimax_h3_image_vae_fp16.safetensors"

# J5 试点句(改真源后变体装配文中须逐字存活;python 源内串=断言锚,与 JSON 各自独立)
J5_SENT = "雨后石阶因水气浸养而色层加深，檐下灯盏的暖色沿墙面晕开成片，晨雾将远景色层压淡一档"


def extract_subject(idx: int) -> str:
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


def assemble() -> str:
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    style_pos = bases["art_style_base"]["positive_text"]
    type_pos = bases["types"][TYPE_IDX]["positive_text"]
    return "\n".join([extract_subject(TYPE_IDX), type_pos, style_pos])


def build_api(prompt: str, prefix: str):
    return {
        "1": {"class_type": "UNETLoader",
              "inputs": {"unet_name": DIT, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader",
              "inputs": {"clip_name": TE, "type": "minimax", "device": "default"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE}},
        "5": {"class_type": "MiniMaxH3ImageConditioning",
              "inputs": {"clip": ["2", 0], "vae": ["3", 0], "prompt": prompt,
                         "width": W, "height": H}},
        "6": {"class_type": "ConditioningZeroOut",
              "inputs": {"conditioning": ["5", 0]}},
        "7": {"class_type": "KSampler",
              "inputs": {"model": ["1", 0], "positive": ["5", 0],
                         "negative": ["6", 0], "latent_image": ["5", 1],
                         "seed": SEED, "steps": 6, "cfg": 1.0,
                         "sampler_name": "euler", "scheduler": "simple",
                         "denoise": 1.0}},
        "8": {"class_type": "VAEDecode",
              "inputs": {"samples": ["7", 0], "vae": ["3", 0]}},
        "9": {"class_type": "SaveImage",
              "inputs": {"images": ["8", 0], "filename_prefix": prefix}},
    }


def fire(tag: str) -> int:
    prompt = assemble()
    print(f"[{tag}] 装配三层 {len(prompt)} 字;J5 试点句在场: {J5_SENT[:12]}… → {J5_SENT in prompt}")
    q = json.loads(urllib.request.urlopen(f"{ENGINE}/queue", timeout=10).read())
    if q.get("queue_running") or q.get("queue_pending"):
        print(f"[FAIL] 队列非空:{len(q.get('queue_running', []))}+{len(q.get('queue_pending', []))}")
        return 9
    api = build_api(prompt, f"superi_j5pilot/{tag}")
    body = json.dumps({"prompt": api, "client_id": f"superi-j5pilot-{tag}"}).encode()
    req = urllib.request.Request(f"{ENGINE}/prompt", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        pid = json.loads(r.read().decode())["prompt_id"]
    print(f"[{tag}] prompt_id={pid} seed={SEED} {W}x{H}")
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
                        print(f"[{tag}] ERROR {json.dumps(m, ensure_ascii=False)[:400]}")
                return 1
            if st.get("completed"):
                for no in (e.get("outputs") or {}).values():
                    for img in no.get("images", []):
                        if img.get("type") == "output":
                            q2 = urllib.parse.urlencode(
                                {"filename": img["filename"],
                                 "subfolder": img.get("subfolder", ""),
                                 "type": "output"})
                            b = urllib.request.urlopen(
                                f"{ENGINE}/view?{q2}", timeout=120).read()
                            (OUT / f"{tag}.png").write_bytes(b)
                print(f"[{tag}] PASS {time.time() - t0:.0f}s → {OUT / (tag + '.png')}")
                return 0
    print(f"[{tag}] TIMEOUT")
    return 1


def hist_prompt_text(pid: str) -> str:
    hh = json.loads(urllib.request.urlopen(
        f"{ENGINE}/history/{pid}", timeout=15).read())
    e = hh[pid]
    pd = e.get("prompt") or []
    graphs = [x for x in pd if isinstance(x, dict) and x]  # 0.45.2 history:[int,pid,graph,extra,[out]]
    for graph in graphs:
        for node in graph.values():
            if isinstance(node, dict) and node.get("class_type") == "MiniMaxH3ImageConditioning":
                return (node.get("inputs") or {}).get("prompt", "")
    return ""


def assert_variant(pid: str) -> int:
    full = hist_prompt_text(pid)
    if not full:
        print("[assert] history 无 MiniMaxH3ImageConditioning prompt")
        return 1
    print(f"[assert] 装配全文 {len(full)} 字")
    ok = J5_SENT in full
    print(f"[assert] J5 因果句逐字存活: {ok}")
    # 三层在场性
    bases = json.loads(BASES.read_text(encoding="utf-8"))
    print(f"[assert] 型底座在场: {bases['types'][TYPE_IDX]['positive_text'] in full}")
    print(f"[assert] 风格底座在场: {bases['art_style_base']['positive_text'] in full}")
    print(f"[assert] 主体句在场: {extract_subject(TYPE_IDX) in full}")
    print(f"[assert] 全文尾部 200 字: …{full[-200:]}")
    return 0 if ok else 1


def quant() -> int:
    try:
        from PIL import Image
        import statistics
    except ImportError:
        print("[quant] 无 PIL")
        return 1
    for tag in ("基线", "变体"):
        p = OUT / f"{tag}.png"
        im = Image.open(p)
        print(f"[{tag}] mode={im.mode} size={im.size}")
        if im.mode == "RGBA":
            a = im.getchannel("A")
            hist = a.histogram()
            transparent = sum(hist[:256])  # A=0 完全透明
            total = im.size[0] * im.size[1]
            print(f"[{tag}] 透明像素占比={transparent / total * 100:.4f}%")
        rgb = im.convert("RGB")
        px = list(rgb.getdata())
        n = len(px)
        for ch, name in ((0, "R"), (1, "G"), (2, "B")):
            vals = [p[ch] for p in px]
            mean = sum(vals) / n
            var = sum((v - mean) ** 2 for v in vals) / n
            print(f"[{tag}] {name} mean={mean:.2f} var={var:.2f}")
    return 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 2
    if argv[0] == "fire" and len(argv) >= 3 and argv[1] == "--tag":
        return fire(argv[2])
    if argv[0] == "assert" and len(argv) >= 2:
        return assert_variant(argv[1])
    if argv[0] == "quant":
        return quant()
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
