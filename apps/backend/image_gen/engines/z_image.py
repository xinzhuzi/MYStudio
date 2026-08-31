"""Z-Image-Turbo 引擎独立模块。"""
from __future__ import annotations

import io, base64
from pathlib import Path
from typing import Any

MODEL_NAME = "z-image-turbo"
LAYOUT = "z-image-pointed"

COMFY_MAIN_FILE = "diffusion_models/z_image_turbo_bf16.safetensors"
COMFY_TEXT_ENCODER_FILE = "text_encoders/qwen_3_4b.safetensors"
COMFY_VAE_FILE = "vae/ae.safetensors"

SMALL_REPO = "Tongyi-MAI/Z-Image-Turbo"
SMALL_EXACT_FILES = (
    "vae/config.json", "vae/diffusion_pytorch_model.safetensors",
    "scheduler/scheduler_config.json", "transformer/config.json",
    "text_encoder/config.json",
    "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json", "tokenizer/merges.txt", "tokenizer/special_tokens_map.json",
)
REQUIRED_FILES = (
    "transformer/config.json", "scheduler/scheduler_config.json",
    "text_encoder/config.json", "tokenizer/tokenizer_config.json",
)

SPEC = {
    "label": "Z-Image-Turbo", "repo_id": SMALL_REPO, "repo_ids": (SMALL_REPO,),
    "size_mb": 13700, "license": "Apache-2.0", "steps": 8,
    "description": "本地快速生图（6B turbo 蒸馏，8 步出图）",
    "layout": LAYOUT,
}

ASPECT_RATIOS = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}

_cache: dict[str, Any] = {}


def resolve_big_files(models_dir: Path, cache_dir=None):
    main = models_dir / COMFY_MAIN_FILE
    te = models_dir / COMFY_TEXT_ENCODER_FILE
    if not (main.is_file() and te.is_file()): return None
    vae = models_dir / COMFY_VAE_FILE
    comfy_vae = vae if vae.is_file() else None
    total = main.stat().st_size + te.stat().st_size + (vae.stat().st_size if comfy_vae else 0)
    return {"main": main, "text_encoder": te, "vae": comfy_vae,
            "source": "comfyui", "cache_dir": str(models_dir), "size_mb": round(total/1024/1024, 2)}


def find_cached(models_dir, cache_dir=None):
    r = resolve_big_files(models_dir)
    if not r: return None
    return {"repo_id": f"comfyui:{COMFY_MAIN_FILE}", "cache_dir": r["cache_dir"],
            "repo_cache_dir": str(r["main"].parent), "size_mb": r["size_mb"]}


def small_pieces_status(hf_snapshot_dir, cache_dir=None):
    snapshot = hf_snapshot_dir(SMALL_REPO, cache_dir)
    missing = ([f"{SMALL_REPO}:{n}" for n in REQUIRED_FILES] if snapshot is None
               else [f"{SMALL_REPO}:{n}" for n in REQUIRED_FILES if not (snapshot / n).is_file()])
    return {"ready": not missing, "missing": missing,
            "snapshot_dirs": {SMALL_REPO: str(snapshot) if snapshot else None}}


def generate(prompt, aspect_ratio, negative_prompt, steps, seed, reference_b64, strength=0.35, **ctx):
    import time as _time, torch
    from diffusers import ZImagePipeline, ZImageImg2ImgPipeline
    from PIL import Image

    models_dir, snapshot_dir = ctx["models_dir"], ctx["snapshot_dir"]
    resolved = resolve_big_files(models_dir)
    if not resolved: raise RuntimeError("Z-Image 大件未就绪")

    from diffusers import ZImageTransformer2DModel, AutoencoderKL, FlowMatchEulerDiscreteScheduler
    from transformers import AutoConfig, AutoTokenizer, Qwen3ForCausalLM
    from safetensors.torch import load_file

    if "comps" not in _cache:
        main, te_file = resolved["main"], resolved["text_encoder"]
        vae_comfy = resolved.get("vae")
        transformer = ZImageTransformer2DModel.from_single_file(
            str(main), config=str(snapshot_dir/"transformer"), torch_dtype=torch.bfloat16)
        vae = (AutoencoderKL.from_single_file(str(vae_comfy), config=str(snapshot_dir/"vae"), torch_dtype=torch.bfloat16)
               if vae_comfy else AutoencoderKL.from_pretrained(snapshot_dir, subfolder="vae", torch_dtype=torch.bfloat16))
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(snapshot_dir, subfolder="scheduler")
        tokenizer = AutoTokenizer.from_pretrained(snapshot_dir / "tokenizer")
        te_config = AutoConfig.from_pretrained(snapshot_dir / "text_encoder")
        text_encoder = Qwen3ForCausalLM(te_config).to(torch.bfloat16)
        text_encoder.load_state_dict(load_file(str(te_file)), strict=False)
        text_encoder.eval()
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _cache["comps"] = {"transformer": transformer.to(device), "vae": vae.to(device),
                           "scheduler": scheduler, "tokenizer": tokenizer,
                           "text_encoder": text_encoder.to(device)}

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    kwargs = {"prompt": prompt, "height": height, "width": width,
              "num_inference_steps": steps, "guidance_scale": 1.0}
    if negative_prompt: kwargs["negative_prompt"] = negative_prompt; kwargs["guidance_scale"] = 4.0
    if seed is not None: kwargs["generator"] = torch.Generator("cpu").manual_seed(seed)
    if reference_b64:
        raw = reference_b64.split(",",1)[-1] if reference_b64.startswith("data:") else reference_b64
        init = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((width,height))
        kwargs["image"] = init; kwargs["strength"] = strength
        pipe = ZImageImg2ImgPipeline(**_cache["comps"])
    else:
        pipe = ZImagePipeline(**_cache["comps"])

    t = _time.time(); result = pipe(**kwargs)
    print(f"[image-sidecar] z-image timing: steps={steps} inference={_time.time()-t:.1f}s", flush=True)
    buf = io.BytesIO(); result.images[0].save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def fetch_small_pieces(cache_dir, hf_snapshot_download=None, modelscope_download=None):
    try:
        if modelscope_download:
            modelscope_download(SMALL_REPO, cache_dir, allow_paths=list(SMALL_EXACT_FILES)); return
    except Exception: pass
    if hf_snapshot_download:
        hf_snapshot_download(repo_id=SMALL_REPO, allow_patterns=[
            "vae/*","scheduler/*","transformer/config.json",
            "text_encoder/config.json","tokenizer/*"], cache_dir=cache_dir)
