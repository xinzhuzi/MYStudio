"""FLUX.2 Klein 9B 引擎独立模块。"""
from __future__ import annotations

import io, base64
from pathlib import Path
from typing import Any

MODEL_NAME = "flux2-klein-9b"
LAYOUT = "flux2-pointed"

COMFY_MAIN_FILE = "diffusion_models/flux2_klein_9b.safetensors"
COMFY_TEXT_ENCODER_FILES = (
    "text_encoders/qwen_3_8b.safetensors",
    "text_encoders/flux2-klein-9b-uncensored-q8_0.gguf",
)
COMFY_VAE_FILE = "vae/flux2-vae.safetensors"

SMALL_REPO = "black-forest-labs/FLUX.2-klein-9B"
SMALL_EXACT_FILES = (
    "scheduler/scheduler_config.json", "transformer/config.json",
    "vae/config.json", "text_encoder/config.json", "text_encoder/generation_config.json",
    "tokenizer/added_tokens.json", "tokenizer/chat_template.jinja",
    "tokenizer/merges.txt", "tokenizer/special_tokens_map.json",
    "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json", "tokenizer/vocab.json",
    "vae/diffusion_pytorch_model.safetensors",
)
REQUIRED_FILES = (
    "transformer/config.json", "scheduler/scheduler_config.json",
    "vae/config.json", "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/config.json", "tokenizer/tokenizer_config.json",
)

SPEC = {
    "label": "FLUX.2 Klein 9B", "repo_id": SMALL_REPO, "repo_ids": (SMALL_REPO,),
    "size_mb": 35000, "license": "FLUX.2 Community License", "steps": 8,
    "description": "本地快速生图+参考图编辑（9B 蒸馏档，原生支持参考图生成）",
    "layout": LAYOUT,
}

ASPECT_RATIOS = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}

_cache: dict[str, Any] = {}


def _te_file(models_dir: Path) -> Path | None:
    for name in COMFY_TEXT_ENCODER_FILES:
        c = models_dir / name
        if c.is_file():
            return c
    return None


def resolve_big_files(models_dir: Path, cache_dir: Path | None = None) -> dict | None:
    main = models_dir / COMFY_MAIN_FILE
    te = _te_file(models_dir)
    if not (main.is_file() and te):
        return None
    vae_comfy = models_dir / COMFY_VAE_FILE
    comfy_vae = vae_comfy if vae_comfy.is_file() else None
    total = main.stat().st_size + te.stat().st_size
    return {"main": main, "text_encoder": te, "vae": comfy_vae,
            "source": "comfyui", "cache_dir": str(models_dir),
            "size_mb": round(total / 1024 / 1024, 2)}


def find_cached(models_dir: Path, cache_dir=None):
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


def generate(prompt, aspect_ratio, negative_prompt, steps, seed, reference_b64, **ctx) -> str:
    import time as _time, torch
    from diffusers import Flux2KleinPipeline
    from PIL import Image

    models_dir, snapshot_dir = ctx["models_dir"], ctx["snapshot_dir"]
    resolved = resolve_big_files(models_dir)
    if not resolved:
        raise RuntimeError("FLUX.2 大件未就绪")

    import torch
    from diffusers import Flux2Transformer2DModel, AutoencoderKLFlux2, FlowMatchEulerDiscreteScheduler
    from transformers import AutoConfig, AutoTokenizer, Qwen3ForCausalLM
    from safetensors.torch import load_file

    if "comps" not in _cache:
        main, te_file = resolved["main"], resolved["text_encoder"]
        transformer = Flux2Transformer2DModel.from_single_file(
            str(main), config=str(snapshot_dir / "transformer"), torch_dtype=torch.bfloat16)
        vae = AutoencoderKLFlux2.from_pretrained(snapshot_dir, subfolder="vae", torch_dtype=torch.bfloat16)
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(snapshot_dir, subfolder="scheduler")
        tokenizer = AutoTokenizer.from_pretrained(snapshot_dir / "tokenizer")
        te_config = AutoConfig.from_pretrained(snapshot_dir / "text_encoder")
        if te_file.suffix == ".gguf":
            text_encoder = Qwen3ForCausalLM.from_pretrained(
                str(te_file.parent), gguf_file=te_file.name, config=te_config, torch_dtype=torch.bfloat16)
        else:
            text_encoder = Qwen3ForCausalLM(te_config).to(torch.bfloat16)
            text_encoder.load_state_dict(load_file(str(te_file)), strict=False)
        text_encoder.eval()
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        _cache["comps"] = {"transformer": transformer.to(device), "vae": vae.to(device),
                           "scheduler": scheduler, "tokenizer": tokenizer,
                           "text_encoder": text_encoder.to(device), "is_distilled": True}

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    kwargs = {"prompt": prompt, "height": height, "width": width, "num_inference_steps": steps}
    if seed is not None:
        kwargs["generator"] = torch.Generator("cpu").manual_seed(seed)
    if reference_b64:
        raw = reference_b64.split(",", 1)[-1] if reference_b64.startswith("data:") else reference_b64
        init = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        kwargs["image"] = [init]

    t = _time.time()
    pipe = Flux2KleinPipeline(**_cache["comps"])
    result = pipe(**kwargs)
    print(f"[image-sidecar] flux2 timing: steps={steps} inference={_time.time()-t:.1f}s", flush=True)
    buf = io.BytesIO(); result.images[0].save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def fetch_small_pieces(cache_dir, hf_snapshot_download=None, modelscope_download=None):
    try:
        if modelscope_download:
            modelscope_download(SMALL_REPO, cache_dir, allow_paths=list(SMALL_EXACT_FILES)); return
    except Exception: pass
    if hf_snapshot_download:
        hf_snapshot_download(repo_id=SMALL_REPO, allow_patterns=[
            "scheduler/*", "transformer/config.json", "vae/config.json",
            "text_encoder/config.json", "tokenizer/*"], cache_dir=cache_dir)
