#!/usr/bin/env python3
"""南风 H3 FaceRefine 实弹嫁接发车器(1117)。

对 BV15eby6fE2E(UP主南风阳平=Carasibana/ComfyUI-H3-FaceRefine)小脸修复链的一次
API 直投实弹:作者链路原样(Track+Crop→InjectLatent→AudioLock→PerFrameDenoise→
Stitch Back),生成侧换装我方在役栈——
  UNET=Cobijada hybrid int8  LoRA=pika_turbo_8step_fl2va@1.0(8步,simple,denoise 0.45)
  TE=qwen3vl_32b_minimax_h3_nvfp4_awq(minimax)  VAE=video int8_convrot + audio fp32
作者 lightx2v 4step LoRA 不下载(在役栈实证替换;步数纪律=8步配8step件)。

铁律:所有节点 schema 现查 object_info 逐输入断言,禁手写字段名(接口边界假设核对)。
用法:
  python3 facerefine_livefire_1117.py --video <Win侧路径.mp4> --ref <input内参考图.png> \
      --audio <input内音频.wav> --length 226 [--seed 42] [--dry-run]
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
import urllib.error

ENGINE = "http://192.168.0.101:17000"
CLIENT = "facerefine-livefire-1117"

REQUIRED_NODES = [
    "H3FaceTrackCrop", "H3InjectVideoLatent", "H3PerFrameDenoise", "H3FaceStitch",
    "MiniMaxH3ReferenceToVideo", "MiniMaxH3NativeAudioLock",
    "VHS_LoadVideoPath", "VHS_LoadAudioUpload", "VHS_VideoCombine",
    "UNETLoader", "CLIPLoader", "VAELoader", "LoraLoaderModelOnly",
    "LoadImage", "RandomNoise", "BasicGuider", "KSamplerSelect",
    "BasicScheduler", "SamplerCustomAdvanced", "VAEDecode", "PreviewImage",
]


def http_json(path: str, timeout: int = 20):
    with urllib.request.urlopen(ENGINE + path, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post(path: str, body: dict, timeout: int = 30) -> dict:
    req = urllib.request.Request(
        ENGINE + path, data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        sys.exit(f"[FATAL] HTTP {e.code} from {path}:\n{detail[:3000]}")


def fetch_object_info() -> dict:
    oi = http_json("/object_info", timeout=60)
    missing = [n for n in REQUIRED_NODES if n not in oi]
    if missing:
        sys.exit(f"[FATAL] 引擎缺节点: {missing}(FaceRefine 装了吗?引擎重启了吗?)")
    return oi


def need_inputs(oi: dict, node: str) -> dict:
    spec = oi[node]["input"]
    merged = {}
    for section in ("required", "optional"):
        for k, v in spec.get(section, {}).items():
            if k == "extra_pnginfo" or k.startswith("control_after_generated"):
                continue
            merged[k] = v
    return merged


def require(oi: dict, node: str, *names: str) -> None:
    have = need_inputs(oi, node)
    miss = [n for n in names if n not in have]
    if miss:
        sys.exit(f"[FATAL] {node} 缺输入 {miss};实际输入={sorted(have)}")


def option_of(oi: dict, node: str, name: str) -> list:
    v = need_inputs(oi, node)[name][0]
    return list(v) if isinstance(v, list) else []


def pick_option(oi: dict, node: str, name: str, want: str) -> str:
    opts = option_of(oi, node, name)
    hits = [o for o in opts if want.lower() in str(o).lower()]
    if not hits:
        sys.exit(f"[FATAL] {node}.{name} 无匹配 '{want}',可选项={opts[:12]}")
    return hits[0]


def pick_model(oi: dict, node: str, field: str, want: str) -> str:
    opts = option_of(oi, node, field)
    hits = [o for o in opts if want in str(o)]
    if not hits:
        sys.exit(f"[FATAL] {node}.{field} 找不到 '{want}',可选项={opts[:12]}")
    return hits[0]


def build_prompt(oi: dict, a) -> dict:
    # --- schema 断言(逐节点逐输入,防上游漂移) ---
    require(oi, "H3FaceTrackCrop", "images", "detector", "confidence", "crop_factor",
            "canvas_mode")
    require(oi, "MiniMaxH3ReferenceToVideo", "clip", "length", "ref_images")
    require(oi, "H3InjectVideoLatent", "av_latent", "images", "vae")
    require(oi, "MiniMaxH3NativeAudioLock", "av_latent")
    require(oi, "H3PerFrameDenoise", "model", "av_latent", "transform")
    require(oi, "H3FaceStitch", "base_images", "refined_crops", "transform")
    require(oi, "VHS_LoadVideoPath", "video")
    require(oi, "VHS_VideoCombine", "images")

    det = pick_model(oi, "H3FaceTrackCrop", "detector", "face_yolov8m")
    unet = pick_model(oi, "UNETLoader", "unet_name", "Cobijada_H3_Hybrid")
    te = pick_model(oi, "CLIPLoader", "clip_name", "qwen3vl_32b_minimax_h3_nvfp4_awq")
    vae_v = pick_model(oi, "VAELoader", "vae_name", "minimax_h3_video_vae_int8_convrot")
    vae_a = pick_model(oi, "VAELoader", "vae_name", "minimax_h3_audio_vae_fp32")
    lora = pick_model(oi, "LoraLoaderModelOnly", "lora_name", "pika_turbo_8step_fl2va")
    te_type = pick_option(oi, "CLIPLoader", "type", "minimax")
    canvas_mode = pick_option(oi, "H3FaceTrackCrop", "canvas_mode", "auto_capped_768")

    g: dict = {}

    def N(cid, cls, **kw):
        g[str(cid)] = {"class_type": cls, "inputs": kw}

    # CLIP Vision 身份嵌入器(动漫域跨域认人)
    N(800, "CLIPVisionLoader", clip_name="clip_vision_g.safetensors")

    # 源片 + 参考图 + 人声轨
    N(1, "VHS_LoadVideoPath", video=a.video, force_rate=0, frame_load_cap=a.length,
      skip_first_frames=0, select_every_nth=1, format="H3",
      custom_width=0, custom_height=0)
    N(2, "LoadImage", image=a.ref)
    N(3, "VHS_LoadAudioUpload", audio=a.audio)

    # 在役栈装载
    N(10, "UNETLoader", unet_name=unet, weight_dtype="default")
    N(11, "LoraLoaderModelOnly", lora_name=lora, strength_model=1.0, model=["10", 0])
    N(12, "CLIPLoader", clip_name=te, type=te_type, device="default")
    N(13, "VAELoader", vae_name=vae_v)
    N(14, "VAELoader", vae_name=vae_a)

    # 追踪+裁剪(crops/transform/canvas)
    N(20, "H3FaceTrackCrop", images=["1", 0], detector=det, confidence=0.15,
      crop_factor=2.5, canvas_width=768, canvas_height=768, canvas_mode=canvas_mode,
      smooth_window=21, size_smooth_window=51, smooth_method="gaussian",
      size_mode="per_frame", identity_track=True, identity_threshold=0.0,
      select="closest_to_xy", fallback_detector="segm\\person_yolov8m-seg.pt",
      fallback_head_frac=0.5, select_index=0, identity_model="clip_vision",
      cut_detection="none", cut_threshold=3.0, absent_shots="off",
      X=1920, Y=900, frame_index=170, identity_clip_vision=["800", 0])

    # H3 重画(画布=追踪器动态画布,须连线不能手填)
    # 实测 schema:REF 节点不吃 model(模型只走采样链);
    # 出口序:crops=0 transform=1 preview=2 report=3 canvas_w=4 canvas_h=5
    ref_inputs = need_inputs(oi, "MiniMaxH3ReferenceToVideo")
    ref_kw = dict(clip=["12", 0], length=a.length)
    if "vae" in ref_inputs:
        ref_kw["vae"] = ["13", 0]
    if "audio_vae" in ref_inputs:
        ref_kw["audio_vae"] = ["14", 0]
    if "ref_images" in ref_inputs:
        ref_kw["ref_images"] = [["2", 0]]
    if "prompt" in ref_inputs:
        ref_kw["prompt"] = a.prompt
    if "ref_image_size" in ref_inputs:
        ref_kw["ref_image_size"] = "max"  # 在役单镜同参
    for k, idx in (("width", 4), ("height", 5)):
        if k in ref_inputs:
            ref_kw[k] = ["20", idx]  # canvas_w/canvas_h 出口
    N(21, "MiniMaxH3ReferenceToVideo", **ref_kw)

    # 注入真实帧(视频流 img2img);REF 出口序:0=CONDITIONING 1=LATENT
    N(22, "H3InjectVideoLatent", av_latent=["21", 1], images=["20", 0], vae=["13", 0])

    # 音轨锁(口型);实测 required=model+av_latent+audio_vae+audio,出口 0=MODEL 1=LATENT
    N(23, "MiniMaxH3NativeAudioLock", model=["11", 0], av_latent=["22", 0],
      audio_vae=["14", 0], audio=["3", 0])

    # 逐帧 denoise(新版 model-in/model-out);AudioLock 出口 0=MODEL 1=LATENT
    N(24, "H3PerFrameDenoise", model=["23", 0], av_latent=["23", 1], transform=["20", 1],
      denoise_multiplier_small_face=1.0, denoise_multiplier_large_face=0.35,
      scale_mode="absolute_px", face_px_small=60.0, face_px_large=200.0,
      gamma=1.0, smooth_frames=9)

    # 采样链(在役纪律:lcm+simple 8步;强度走 BasicScheduler denoise)
    N(30, "BasicGuider", model=["24", 2], conditioning=["21", 0])
    N(31, "KSamplerSelect", sampler_name="lcm")
    N(32, "BasicScheduler", model=["24", 2], scheduler="simple", steps=8, denoise=0.45)
    N(33, "RandomNoise", noise_seed=a.seed)
    N(34, "SamplerCustomAdvanced", noise=["33", 0], guider=["30", 0],
      sampler=["31", 0], sigmas=["32", 0], latent_image=["24", 0])
    N(35, "VAEDecode", samples=["34", 0], vae=["13", 0])

    # 贴回 + 存片
    N(40, "H3FaceStitch", base_images=["1", 0], refined_crops=["35", 0],
      transform=["20", 1], paste_region="face_only", mask_dilation=16, feather=24,
      colour_match=1.0, blend=1.0, undetected_frames="fade_out")
    vc = {"images": ["40", 0], "filename_prefix": a.prefix, "fps": 24,
          "frame_rate": 24, "loop_count": 0, "format": "video/h264-mp4",
          "pingpong": False, "save_output": True}
    va = need_inputs(oi, "VHS_VideoCombine")
    for k in va:
        if "audio" in k.lower():
            vc[k] = ["3", 0]  # 原片人声轨随片保存
            break
    N(41, "VHS_VideoCombine", **vc)
    N(42, "PreviewImage", images=["20", 2])  # 追踪预览(检boxes)
    return g


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True, help="Win 侧源片绝对路径")
    ap.add_argument("--ref", required=True, help="input 目录内参考图文件名")
    ap.add_argument("--audio", required=True, help="input 目录内音频文件名")
    ap.add_argument("--length", type=int, required=True, help="帧数(17k+5 网格)")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--prefix", default="FaceRefine1117")
    ap.add_argument("--prompt", default=(
        "The same young woman as <Picture 1>: middle-parted long black hair with soft wispy bangs, "
        "multiple thin braids along both cheeks, a single champagne-gold flower hair ornament with "
        "beaded tassel on one side, slim oval face with narrow chin, calm gentle eyes, small nose, "
        "small mouth with soft rosy lips, light natural makeup, serene cool temperament; white "
        "layered hanfu with teal-green sash. Keep her exact facial identity, no redesign."))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    q = http_json("/queue")
    if q["queue_running"] or q["queue_pending"]:
        sys.exit(f"[GATE] 队列非空,发车取消: {q}")

    oi = fetch_object_info()
    g = build_prompt(oi, a)
    if a.dry_run:
        print(json.dumps(g, ensure_ascii=False, indent=1))
        return 0

    t0 = time.time()
    r = post("/prompt", {"client_id": CLIENT, "prompt": g,
                         "extra_data": {"client_id": CLIENT}})
    pid = r.get("prompt_id")
    if "error" in r:
        sys.exit(f"[FATAL] 引擎拒单: {r}")
    print(f"[FIRED] prompt_id={pid}")

    while True:
        time.sleep(5)
        h = http_json(f"/history/{pid}")
        if pid not in h:
            continue
        entry = h[pid]
        if entry.get("status", {}).get("completed"):
            dt = time.time() - t0
            outs = [o["gifs"][0]["filename"] for n in entry["outputs"].values()
                    for o in [n] if "gifs" in n for _ in [0]]
            print(f"[DONE] {dt:.0f}s outputs={outs}")
            return 0
        for e in entry.get("status", {}).get("messages", []):
            if e[0] == "execution_error":
                sys.exit(f"[ERROR] {json.dumps(e[1], ensure_ascii=False)[:800]}")
        if time.time() - t0 > 3600:
            sys.exit("[TIMEOUT] 3600s")


if __name__ == "__main__":
    raise SystemExit(main())
