#!/usr/bin/env python3
"""Viggle Turbo v0.3 6-step LoRA · 人物海报实弹测试(1108)

视频 BV1mDx56RECy「Qwen-Image-2.1直接起飞…6步出图最高提速6.3倍」的 LoRA 定谳为
Viggle/Qwen-Image-2.1-viggle-turbo v0.3 6-step(6步替代40步/免CFG/LoRA形态)。

官方工具流 = Viggle 仓库 comfyui/Qwen-Image-2.1-viggle-turbo-t2i.json(存 /tmp/viggle-t2i.json),
本脚本把 UI 图转 API 图直投 Win 引擎。相对官方图的改动:
  1. LoRA r128 → r256(引擎在位件,仓库推荐档;r128 未装)
  2. 提示词 → 人物海报(官方 PE 链保留: TextGenerate 用 8B TE 当 LLM 改写)
  3. 分辨率 3:2 → 2:3 竖版海报(ResolutionSelector 2:3@1MP×32 的确定输出 = 832×1248)
  4. StringFormat(autogrow) → StringConcatenate+常量:0.44 的 autogrow 输入 API 序列化
     两种形状(逐名 a/b/c 与 values-dict)均实证报错,拼串语义等价替换,官方链实质零改动
其余逐节点逐连线照抄官方图(含 ViggleTurboSigmas 六步 sigma 表与 BasicGuider 关 CFG)。

用法: python3 viggle_turbo_poster_test_1108.py [引擎URL]   # 默认 http://192.168.0.101:17000
产物: ~/Downloads/1108-viggle-turbo-poster/
"""

import json
import pathlib
import struct
import sys
import time
import urllib.parse
import urllib.request
import uuid

ENGINE = sys.argv[1] if len(sys.argv) > 1 else "http://192.168.0.101:17000"
UI_WF = pathlib.Path("/tmp/viggle-t2i.json")
OUT_DIR = pathlib.Path.home() / "Downloads/1108-viggle-turbo-poster"
SEEDS = [7014, 90114]
ASPECT = "2:3 (Portrait Photo)"  # 海报竖版
POLL_TIMEOUT_S = 20 * 60

# 人物海报提示词(英文短句,官方 PE 会重写为长段;含书法标题字样以测大字渲染)
POSTER_PROMPT = (
    "Cinematic wuxia character poster: a young female swordswoman with long flowing black hair "
    "and ink-dark flowing robes stands on a cliff edge at dusk, wind and drifting petals "
    "swirling around her, determined gaze into the distance, dramatic golden rim lighting "
    "against stormy teal clouds, heroic low-angle full-body composition, ultra-detailed face "
    "and fabric texture, bold vertical Chinese calligraphy title 道劫 on the right side of "
    "the poster, epic movie poster design, dark teal and crimson color palette"
)

LORA_R256 = "Qwen-Image-2.1-viggle-turbo-v0.3-6step-lora-r256.safetensors"
SIGMAS_6STEP = "1.0, 0.9375, 0.875, 0.75, 0.5, 0.25"


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def build_api(seed: int) -> dict:
    ui = json.loads(UI_WF.read_text())
    # 官方 PE 系统提示词逐字取自官方图 node 10,不手抄
    pe_sys = next(n for n in ui["nodes"] if n["id"] == 10)["widgets_values"][0]
    return {
        "2": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "qwen_image_2.1_int8_convrot.safetensors", "weight_dtype": "default"}},
        "3": {"class_type": "ViggleTurboLora", "inputs": {
            "model": ["2", 0], "lora_name": LORA_R256, "strength": 1}},
        "4": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_8b_int8_convrot.safetensors", "type": "qwen_image",
            "device": "default"}},
        "5": {"class_type": "VAELoader", "inputs": {
            "vae_name": "qwen_image_2.1_vae_bf16.safetensors"}},
        "6": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": POSTER_PROMPT}},
        # ResolutionSelector('2:3',1MP,×32) 的确定输出直接落常量(832×1248,恰 2:3、1.04MP)
        "8": {"class_type": "EmptyLatentImage", "inputs": {
            "width": 832, "height": 1248, "batch_size": 1}},
        "9": {"class_type": "PrimitiveBoolean", "inputs": {"value": True}},  # Enhance prompt: PE 开
        "10": {"class_type": "PrimitiveStringMultiline", "inputs": {"value": pe_sys}},
        # 官方图此节点为 StringFormat(autogrow 拼串),API 侧以 StringConcatenate 等价替换
        "11": {"class_type": "StringConcatenate", "inputs": {
            "string_a": ["6", 0], "string_b": "Aspect ratio: 832:1248", "delimiter": "\n"}},
        "12": {"class_type": "TextGenerate", "inputs": {
            "clip": ["4", 0], "prompt": ["11", 0], "max_length": 512,
            "sampling_mode": "off", "thinking": True, "use_default_template": True,
            "mtp": "auto", "system_prompt": ["10", 0]}},
        "13": {"class_type": "JsonExtractString", "inputs": {
            "json_string": ["12", 0], "key": "rewritten_prompt"}},
        "14": {"class_type": "StringCompare", "inputs": {
            "string_a": ["13", 0], "string_b": "", "mode": "Equal", "case_sensitive": True}},
        # 改写失败(空串)→ 回退原句
        "15": {"class_type": "ComfySwitchNode", "inputs": {
            "switch": ["14", 0], "on_true": ["6", 0], "on_false": ["13", 0]}},
        # PE 开关 → 用改写句/原句
        "16": {"class_type": "ComfySwitchNode", "inputs": {
            "switch": ["9", 0], "on_true": ["15", 0], "on_false": ["6", 0]}},
        "17": {"class_type": "PreviewAny", "inputs": {"source": ["16", 0]}},
        "18": {"class_type": "TextEncodeQwenImage21", "inputs": {
            "clip": ["4", 0], "prompt": ["16", 0], "negative_prompt": "",
            "resolution": 1024, "vae": ["5", 0]}},
        "19": {"class_type": "BasicGuider", "inputs": {
            "model": ["3", 0], "conditioning": ["18", 0]}},  # 官方:CFG 关(BasicGuider)
        "20": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "21": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "22": {"class_type": "ViggleTurboSigmas", "inputs": {
            "latent": ["8", 0], "nodes": SIGMAS_6STEP}},
        "23": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["20", 0], "guider": ["19", 0], "sampler": ["21", 0],
            "sigmas": ["22", 0], "latent_image": ["8", 0]}},
        "24": {"class_type": "VAEDecode", "inputs": {"samples": ["23", 0], "vae": ["5", 0]}},
        "25": {"class_type": "SaveImage", "inputs": {
            "images": ["24", 0], "filename_prefix": f"viggle_turbo/poster1108_s{seed}"}},
    }


def png_dims(path: pathlib.Path):
    b = path.read_bytes()
    return struct.unpack(">II", b[16:24])


def run_seed(seed: int, client_id: str):
    wf = build_api(seed)
    t0 = time.time()
    resp = http_json(f"{ENGINE}/prompt", {"prompt": wf, "client_id": client_id})
    pid = resp["prompt_id"]
    print(f"[seed {seed}] submitted prompt_id={pid} (t+0.0s)")
    last_beat = 0.0
    while time.time() - t0 < POLL_TIMEOUT_S:
        time.sleep(3)
        hist = http_json(f"{ENGINE}/history/{pid}")
        if pid in hist:
            entry = hist[pid]
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(f"[seed {seed}] ERROR:")
                for m in status.get("messages", []):
                    if m[0] == "execution_error":
                        print("  ", json.dumps(m[1], ensure_ascii=False)[:800])
                return None
            if status.get("completed"):
                wall = time.time() - t0
                outs = entry.get("outputs", {})
                results = []
                for imgs in outs.values():
                    for im in imgs.get("images", []):
                        q = urllib.parse.urlencode({
                            "filename": im["filename"], "subfolder": im.get("subfolder", ""),
                            "type": im.get("type", "output")})
                        dst = OUT_DIR / f"poster_s{seed}_{im['filename']}"
                        with urllib.request.urlopen(f"{ENGINE}/view?{q}", timeout=120) as r:
                            dst.write_bytes(r.read())
                        results.append((dst, *png_dims(dst)))
                print(f"[seed {seed}] DONE wall={wall:.1f}s")
                for dst, w, h in results:
                    print(f"  → {dst} ({w}x{h})")
                return {"seed": seed, "wall_s": wall, "files": results}
        if time.time() - last_beat > 30:
            q = http_json(f"{ENGINE}/queue")
            n_run, n_pend = len(q.get("queue_running", [])), len(q.get("queue_pending", []))
            print(f"[seed {seed}] waiting… t+{time.time()-t0:.0f}s queue(run={n_run},pend={n_pend})")
            last_beat = time.time()
    print(f"[seed {seed}] TIMEOUT after {POLL_TIMEOUT_S}s")
    return None


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    client_id = f"viggle-poster-{uuid.uuid4().hex[:8]}"
    info = http_json(f"{ENGINE}/system_stats")["system"]
    print(f"engine comfyui_version={info['comfyui_version']} client={client_id}")
    print(f"LoRA={LORA_R256}\nsigmas={SIGMAS_6STEP} | aspect={ASPECT} | PE=on | CFG=off(BasicGuider) | sampler=euler")
    print(f"prompt: {POSTER_PROMPT[:120]}…\n")
    results = []
    for i, seed in enumerate(SEEDS):
        print(f"=== run {i+1}/{len(SEEDS)} seed={seed} {'(cold,含模型装载)' if i == 0 else '(warm)'} ===")
        results.append(run_seed(seed, client_id))
    ok = [r for r in results if r]
    print("\n===== SUMMARY =====")
    for r in results:
        if r:
            print(f"seed {r['seed']}: {r['wall_s']:.1f}s → {[str(p.name) for p, _, _ in r['files']]}")
        else:
            print("FAILED run omitted")
    sys.exit(0 if len(ok) == len(SEEDS) else 1)


if __name__ == "__main__":
    main()
