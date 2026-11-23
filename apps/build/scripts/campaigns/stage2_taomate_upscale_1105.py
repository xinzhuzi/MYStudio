#!/usr/bin/env python3
"""1105 二阶段放大段实弹: taomate 3步 LoRA 正确用法验证。

背景: taomate 此前误挂 TESSERA refine 段(ManualSigmas 4点, 蒸馏 LoRA 无用武之地, 实测 85.7s vs 82s 无加速)。
B 站横评定谳正确用法 = 二阶段放大: 一阶产出 → 潜空间放大 ×1.5 → FL2VA + taomate 3步 + LCM + 3值σ 轻降噪。

蓝本:
- 结构 = api_fl2va.json(1031 首跑验证: SamplerCustomAdvanced+BasicGuider+KSamplerSelect(lcm)+ManualSigmas)
- σ 表 = 0.636,0.298,0.000(班长 1102 节点282, H3 社区 3步实证); CZMartin 卡: steps3/cfg1.0(BasicGuider 天然)/strength1.0
- 放大 = LatentUpscaleBy ×1.5 比例法(1280×704→1920×1056, 全程 %32 对齐; 勿用 LatentUpscale 填像素尺寸——它收潜空间单位)
- 音频 = 源音轨直通交付(CreateVideo audio=GetVideoComponents.audio); AV 联合潜空间里 audio 通道 mask=1
  (对齐联合模型训练分布, v4 同款), 重生成音频弃用
- 对拍基准 = TESSERA formal v4 同源同目标(85.7s, apps/output/h3-4k-tessera-1104)

用法: python3 stage2_taomate_upscale_1105.py [--engine http://192.168.0.101:17000] [--seed 20261105]
"""
import argparse
import json
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

ENGINE_DEFAULT = "http://192.168.0.101:17000"
SRC_VIDEO = "tessera-src-1280x704.mp4"  # TESSERA formal v4 同源
OUT_DIR = Path(__file__).resolve().parents[2] / "output" / "h3-stage2-taomate-1105"

PROMPT_TEXT = (
    "How the reference picture aligns with the target video — Picture 1 aligns with the 0.00-second "
    "mark of the target video, and the target video is the upscaled continuation of that exact shot.\n\n"
    "integrated_multimodal_description: [Shot 1] Upscale enhancement of the source clip: identical "
    "characters, motion, framing and timing as the source, with sharp, crisp details and a natural "
    "photorealistic appearance. No new events, no camera moves beyond the source, no style change.\n\n"
    "overall_soundscape: unchanged from the source clip."
)


def build_prompt(seed: int) -> dict:
    return {
        # 源视频分解
        "1": {"class_type": "LoadVideo", "inputs": {"file": SRC_VIDEO}},
        "2": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "3": {"class_type": "ImageFromBatch", "inputs": {"image": ["2", 0], "batch_index": 0, "length": 1}},
        # 加载器(fl2va 底模 + kitchen INT8 注意力 + taomate 3步)
        "10": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_video_vae_int8_convrot.safetensors"}},
        "11": {"class_type": "VAELoader", "inputs": {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}},
        "12": {"class_type": "CLIPLoader", "inputs": {
            "clip_name": "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "type": "minimax", "device": "default"}},
        "13": {"class_type": "UNETLoader", "inputs": {
            "unet_name": "minimax_h3_fl2va_pruned_int8_convrot.safetensors", "weight_dtype": "default"}},
        "14": {"class_type": "ModelAttentionBackend", "inputs": {
            "model": ["13", 0], "attention": "comfy kitchen attention"}},
        # 首发教训: kitchen 裸跑 H3 前向 → cudaErrorNotReady(comfy_kitchen int8_linear)。
        # v4 已验证单元 = kitchen + BlockSparseAttention(sol-attn) 成对(参数照抄 v4 节点148)。
        "16": {"class_type": "BlockSparseAttention", "inputs": {
            "model": ["14", 0], "selection": "sol-attn", "selection.tau": 1.5,
            "start_percent": 0.0, "end_percent": 1.0, "dense_blocks": "0,1",
            "min_tokens": 12288, "extra_tokens": 256,
            "sink_conditioning": "exact_kv_and_rows", "verbose": False}},
        "15": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["16", 0], "lora_name": "taomate_h3_3step.safetensors", "strength_model": 1.0}},
        # 潜空间: 视频编码→×1.5 放大; 音频编码→mask=1(训练分布对齐); AV 拼合
        "20": {"class_type": "VAEEncode", "inputs": {"pixels": ["2", 0], "vae": ["10", 0]}},
        "21": {"class_type": "LatentUpscaleBy", "inputs": {
            "samples": ["20", 0], "upscale_method": "nearest-exact", "scale_by": 1.5}},
        "22": {"class_type": "VAEEncodeAudio", "inputs": {"audio": ["2", 1], "vae": ["11", 0]}},
        "24": {"class_type": "SolidMask", "inputs": {"value": 1.0, "width": 32, "height": 32}},
        "23": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["22", 0], "mask": ["24", 0]}},
        "25": {"class_type": "LTXVConcatAVLatent", "inputs": {"video_latent": ["21", 0], "audio_latent": ["23", 0]}},
        # 条件: 首帧锚定 i2v(宽高长与放大后目标一致)
        "30": {"class_type": "MiniMaxH3ImageToVideo", "inputs": {
            "clip": ["12", 0], "vae": ["10", 0], "prompt": PROMPT_TEXT,
            "width": 1920, "height": 1056, "length": 192, "first_frame": ["3", 0]}},
        # 采样: LCM + 3值σ(=B站二阶段配方; BasicGuider 天然 cfg=1.0, CZMartin 卡红线)
        "32": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "lcm"}},
        "33": {"class_type": "ManualSigmas", "inputs": {"sigmas": "0.636,0.298,0.000"}},
        "34": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "35": {"class_type": "BasicGuider", "inputs": {"model": ["15", 0], "conditioning": ["30", 0]}},
        "36": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["34", 0], "guider": ["35", 0], "sampler": ["32", 0],
            "sigmas": ["33", 0], "latent_image": ["25", 0]}},
        # 出片: 重解码视频 + 源音轨/fps 直通
        "40": {"class_type": "VAEDecode", "inputs": {"samples": ["36", 0], "vae": ["10", 0]}},
        "41": {"class_type": "CreateVideo", "inputs": {
            "images": ["40", 0], "fps": ["2", 2], "audio": ["2", 1],
            "bit_depth": "auto", "color_space": "sRGB", "chroma_subsampling": "auto", "codec": "none"}},
        "42": {"class_type": "SaveVideo", "inputs": {
            "video": ["41", 0], "filename_prefix": "h3-stage2-taomate-1105/stage2-taomate-1920x1056",
            "format": "mp4", "format.codec": "h264",
            "format.codec.encoding": "re-encode", "format.codec.encoding.crf": 12.0}},
    }


def http_json(engine: str, path: str, payload=None, timeout=30):
    url = engine.rstrip("/") + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 直连,绕系统代理
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default=ENGINE_DEFAULT)
    ap.add_argument("--seed", type=int, default=20261105)
    ap.add_argument("--timeout", type=int, default=1200, help="轮询上限秒数")
    args = ap.parse_args()

    # 引擎在跑别的活就别抢(排队串行也行,但先看清现场)
    queue = http_json(args.engine, "/queue")
    running = queue.get("queue_running", [])
    pending = queue.get("queue_pending", [])
    print(f"engine queue: running={len(running)} pending={len(pending)}")

    prompt = build_prompt(args.seed)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    api_path = OUT_DIR / "api_stage2_taomate.json"
    api_path.write_text(json.dumps({"prompt": prompt}, ensure_ascii=False, indent=1))
    print(f"api json → {api_path}")

    client_id = str(uuid.uuid4())
    t0 = time.time()
    resp = http_json(args.engine, "/prompt", {"prompt": prompt, "client_id": client_id})
    if resp.get("node_errors"):
        print("NODE ERRORS:", json.dumps(resp["node_errors"], ensure_ascii=False, indent=1))
        raise SystemExit(1)
    pid = resp["prompt_id"]
    print(f"queued prompt_id={pid}")

    while True:
        elapsed = time.time() - t0
        if elapsed > args.timeout:
            print(f"TIMEOUT after {elapsed:.0f}s")
            raise SystemExit(2)
        time.sleep(10)
        hist = http_json(args.engine, f"/history/{pid}")
        entry = hist.get(pid)
        if not entry:
            print(f"  [{elapsed:6.0f}s] running…")
            continue
        status = entry.get("status", {})
        if not status.get("completed"):
            print(f"  [{elapsed:6.0f}s] FAILED status={json.dumps(status, ensure_ascii=False)[:400]}")
            for nid, nerr in entry.get("node_errors", {}).items() or (entry.get("status", {}).get("messages") or []):
                print(f"  node {nid}: {nerr}")
            raise SystemExit(3)
        outputs = entry.get("outputs", {})
        print(f"DONE in {elapsed:.0f}s")
        for nid, out in outputs.items():
            for vid, vinfo in (out.get("videos") or out.get("gifs") or {}).items():
                print(f"  output node {nid}: {vinfo}")
        (OUT_DIR / "run_record.json").write_text(json.dumps({
            "prompt_id": pid, "seed": args.seed, "elapsed_s": round(elapsed, 1),
            "outputs": outputs, "fired_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }, ensure_ascii=False, indent=1))
        break


if __name__ == "__main__":
    main()
