"""Qwen-Image-Edit 2511 引擎独立模块。"""
from __future__ import annotations

import io, base64
from pathlib import Path
from typing import Any

MODEL_NAME = "qwen-image-edit-2511"
LAYOUT = "qwen-pointed"

COMFY_MAIN_FILE = "diffusion_models/qwen_image_edit_2511_Q8_0.gguf"
COMFY_TE_FILE = "text_encoders/qwen_2.5_vl_7b.safetensors"

GGUF_REPO = "unsloth/Qwen-Image-Edit-2511-GGUF"
GGUF_FILE = "qwen-image-edit-2511-Q8_0.gguf"
TE_REPO = "Comfy-Org/Qwen-Image_ComfyUI"
TE_FILE = "split_files/text_encoders/qwen_2.5_vl_7b.safetensors"
BIG_FILE_REPOS = ((GGUF_REPO, (GGUF_FILE,)), (TE_REPO, (TE_FILE,)))

IMAGE_REPO = "Qwen/Qwen-Image"
VL_REPO = "Qwen/Qwen2.5-VL-7B-Instruct"
SMALL_PIECE_REPOS = (
    (IMAGE_REPO, ("vae/*", "scheduler/*", "transformer/config.json")),
    (VL_REPO, ("config.json","preprocessor_config.json","processor_config.json",
               "tokenizer.json","tokenizer_config.json","vocab.json","merges.txt",
               "chat_template.json","special_tokens_map.json")),
)
IMAGE_REQUIRED = ("transformer/config.json","scheduler/scheduler_config.json",
                  "vae/config.json","vae/diffusion_pytorch_model.safetensors")
VL_REQUIRED = ("config.json","preprocessor_config.json","tokenizer.json",
               "tokenizer_config.json","vocab.json","merges.txt")
SMALL_PIECES_SIZE_MB = 300

SPEC = {
    "label": "Qwen-Image-Edit 2511", "repo_id": IMAGE_REPO,
    "repo_ids": (IMAGE_REPO, VL_REPO), "size_mb": 36560,
    "license": "Apache-2.0", "steps": 20,
    "description": "本地编辑级生图（21.7B GGUF Q8_0）",
    "layout": LAYOUT,
}

QWEN_ASPECT_RATIOS = {
    "1:1": (1328,1328), "16:9": (1664,928), "9:16": (928,1664),
    "4:3": (1472,1140), "3:4": (1140,1472),
}

_cache: dict[str, Any] = {}


def pointed_big_files(models_dir):
    return models_dir / COMFY_MAIN_FILE, models_dir / COMFY_TE_FILE


def appcache_big_files(hf_snapshot_dir, cache_dir=None):
    gguf_snap = hf_snapshot_dir(GGUF_REPO, cache_dir)
    main = next(iter(sorted(gguf_snap.rglob("*Q8_0.gguf"))), None) if gguf_snap else None
    te_snap = hf_snapshot_dir(TE_REPO, cache_dir)
    te = (te_snap / TE_FILE) if te_snap else None
    if main is None or te is None or not (main.is_file() and te.is_file()): return None
    return main, te


def resolve_big_files(models_dir, hf_snapshot_dir=None, cache_dir=None):
    main, te = pointed_big_files(models_dir)
    if main.is_file() and te.is_file():
        return {"main":main,"text_encoder":te,"source":"comfyui",
                "cache_dir":str(models_dir),
                "size_mb":round((main.stat().st_size+te.stat().st_size)/1024/1024,2)}
    if hf_snapshot_dir:
        ac = appcache_big_files(hf_snapshot_dir, cache_dir)
        if ac:
            return {"main":ac[0],"text_encoder":ac[1],"source":"app-cache",
                    "cache_dir":str(cache_dir or ""),
                    "size_mb":round((ac[0].stat().st_size+ac[1].stat().st_size)/1024/1024,2)}
    return None


def find_cached(models_dir, hf_snapshot_dir=None, cache_dir=None):
    r = resolve_big_files(models_dir, hf_snapshot_dir, cache_dir)
    if not r: return None
    return {"repo_id":f"comfyui:{COMFY_MAIN_FILE}","cache_dir":r["cache_dir"],
            "repo_cache_dir":str(r["main"].parent),"size_mb":r["size_mb"]}


def small_pieces_status(hf_snapshot_dir, cache_dir=None):
    missing, snapshot_dirs = [], {}
    for repo_id, _pat in SMALL_PIECE_REPOS:
        snap = hf_snapshot_dir(repo_id, cache_dir)
        snapshot_dirs[repo_id] = str(snap) if snap else None
        required = IMAGE_REQUIRED if repo_id == IMAGE_REPO else VL_REQUIRED
        if snap is None:
            missing.extend(f"{repo_id}:{n}" for n in required)
        else:
            missing.extend(f"{repo_id}:{n}" for n in required if not (snap/n).is_file())
    return {"ready": not missing, "missing": missing, "snapshot_dirs": snapshot_dirs}


def generate(prompt, aspect_ratio, negative_prompt, steps, seed, reference_b64, **ctx):
    import time as _time, torch
    from diffusers import QwenImageEditPlusPipeline
    from PIL import Image

    models_dir = ctx["models_dir"]
    snapshot_dirs = ctx.get("qwen_snapshot_dirs") or {}
    image_snap = Path(snapshot_dirs.get("Qwen/Qwen-Image") or "")
    vl_snap = Path(snapshot_dirs.get("Qwen/Qwen2.5-VL-7B-Instruct") or "")

    resolved = resolve_big_files(models_dir)
    if not resolved: raise RuntimeError("Qwen 大件未就绪")

    if "pipe" not in _cache:
        from diffusers import (AutoencoderKLQwenImage, FlowMatchEulerDiscreteScheduler,
                               QwenImageTransformer2DModel)
        from transformers import AutoProcessor, AutoTokenizer
        # GGUF loading...
        main_file = resolved["main"]
        te_file = resolved["text_encoder"]
        try:
            from diffusers.quantizers.quantization_config import GGUFQuantizationConfig
        except ImportError:
            from diffusers.quantizers.gguf import GGUFQuantizationConfig
        config_dir = image_snap/"transformer" if (image_snap/"transformer").is_dir() else image_snap
        transformer = QwenImageTransformer2DModel.from_single_file(
            str(main_file), config=str(config_dir),
            quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
            torch_dtype=torch.bfloat16)
        vae = AutoencoderKLQwenImage.from_pretrained(image_snap, subfolder="vae", torch_dtype=torch.bfloat16)
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(image_snap, subfolder="scheduler")
        tokenizer = AutoTokenizer.from_pretrained(vl_snap)
        processor = AutoProcessor.from_pretrained(vl_snap)
        # TE key mapping (ComfyUI→transformers)
        from safetensors.torch import load_file
        te_state = load_file(str(te_file))
        text_encoder = _load_qwen_te(te_state, vl_snap)
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        pipe = QwenImageEditPlusPipeline(
            transformer=transformer.to(device), vae=vae.to(device),
            text_encoder=text_encoder.to(device), tokenizer=tokenizer,
            scheduler=scheduler, processor=processor)
        _cache["pipe"] = pipe

    pipe = _cache["pipe"]
    width, height = QWEN_ASPECT_RATIOS.get(aspect_ratio, QWEN_ASPECT_RATIOS["1:1"])
    if reference_b64:
        raw = reference_b64.split(",",1)[-1] if reference_b64.startswith("data:") else reference_b64
        init = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((width,height))
    else:
        init = Image.new("RGB",(width,height),"white")
    kwargs = {"image":[init],"prompt":prompt,"num_inference_steps":steps}
    if seed is not None: kwargs["generator"] = torch.Generator("cpu").manual_seed(seed)
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt; kwargs["true_cfg_scale"] = 4.0

    t = _time.time(); result = pipe(**kwargs)
    print(f"[image-sidecar] qwen timing: steps={steps} inference={_time.time()-t:.1f}s", flush=True)
    buf = io.BytesIO(); result.images[0].save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _load_qwen_te(state, config_dir):
    """ComfyUI TE 键名→transformers 结构映射(纯函数)。"""
    import torch
    from transformers import Qwen2_5_VLForConditionalGeneration, AutoConfig
    cfg = AutoConfig.from_pretrained(config_dir)
    model = Qwen2_5_VLForConditionalGeneration(cfg).to(torch.bfloat16)
    remapped = {}
    for k, v in state.items():
        nk = k
        for src, dst in [
            ("model.embed_tokens.","model.embed_tokens."),
            ("model.layers.","model.language_model.layers."),
            ("model.norm.","model.language_model.norm."),
            ("lm_head.","lm_head."),
            ("visual.","model.visual."),
        ]:
            if k.startswith(src):
                nk = dst + k[len(src):]; break
        remapped[nk] = v
    model.load_state_dict(remapped, strict=False)
    model.eval()
    return model


def fetch_small_pieces(cache_dir, hf_snapshot_download=None, modelscope_download=None):
    for repo_id, patterns in SMALL_PIECE_REPOS:
        if hf_snapshot_download:
            hf_snapshot_download(repo_id=repo_id, allow_patterns=list(patterns), cache_dir=cache_dir)


def fetch_big_files(cache_dir, hf_snapshot_download=None, modelscope_download=None):
    for repo_id, files in BIG_FILE_REPOS:
        try:
            if modelscope_download:
                modelscope_download(repo_id, cache_dir, allow_paths=list(files))
                continue
        except Exception: pass
        if hf_snapshot_download:
            hf_snapshot_download(repo_id=repo_id, allow_patterns=list(files), cache_dir=cache_dir)
