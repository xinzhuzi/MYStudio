"""Krea2 Turbo 引擎独立模块(08-31 分离,用户裁定:每模型一个脚本)。

包含:常量/spec/大件解析/小件清单/装配/生成/LoRA/下载。
不依赖其他引擎模块;model_cache/pipeline 只 import 本文件的接口。
"""
from __future__ import annotations

import io
import sys
import base64
import threading
from pathlib import Path
from typing import Any

# ── 常量 ──
MODEL_NAME = "krea2-turbo"
LAYOUT = "krea2-pointed"

COMFY_MAIN_FILE = "diffusion_models/krea2_turbo_bf16.safetensors"
COMFY_TEXT_ENCODER_FILE = "text_encoders/qwen3-vl-4b-heretic.safetensors"
COMFY_VAE_FILE = "vae/qwen_image_vae.safetensors"
COMFY_LORA_DIR = "loras/Krea2-NSFW"
DEFAULT_LORA_FILE = "Krea 2 NSFW V4.safetensors"

SMALL_REPO = "krea/Krea-2-Turbo"
SMALL_EXACT_FILES = (
    "model_index.json",
    "scheduler/scheduler_config.json",
    "transformer/config.json",
    "vae/config.json",
    "text_encoder/config.json",
    "tokenizer/chat_template.jinja",
    "tokenizer/tokenizer.json",
    "tokenizer/tokenizer_config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/model.safetensors",
)
SMALL_PATTERNS = (
    "scheduler/*",
    "transformer/config.json",
    "vae/config.json",
    "text_encoder/config.json",
    "tokenizer/*",
)
REQUIRED_FILES = (
    "transformer/config.json",
    "scheduler/scheduler_config.json",
    "vae/config.json",
    "vae/diffusion_pytorch_model.safetensors",
    "text_encoder/config.json",
    "text_encoder/model.safetensors",
    "tokenizer/tokenizer_config.json",
)

SPEC = {
    "label": "Krea2 Turbo",
    "repo_id": SMALL_REPO,
    "repo_ids": (SMALL_REPO,),
    "size_mb": 35600,
    "license": "Krea Community License",
    "steps": 8,
    "description": "本地主力生图（Turbo 蒸馏 8 步；Qwen3-VL 破限版文本编码器；LoRA 工作流可挂 NSFW/identity 编辑；大件指向 ComfyUI 现成文件零重下）",
    "layout": LAYOUT,
}

ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "16:9": (1152, 640),
    "9:16": (640, 1152),
    "4:3": (1072, 808),
    "3:4": (808, 1072),
}

_lock = threading.Lock()
_pipeline_cache: dict[str, dict[str, Any]] = {}
_lora_cache: dict[str, dict[str, Any]] = {}


# ── 大件解析 ──
def pointed_big_files(models_dir: Path) -> tuple[Path, Path, Path]:
    return (
        models_dir / COMFY_MAIN_FILE,
        models_dir / COMFY_TEXT_ENCODER_FILE,
        models_dir / COMFY_VAE_FILE,
    )


def resolve_big_files(models_dir: Path, cache_dir: Path | None = None) -> dict | None:
    main, te, vae = pointed_big_files(models_dir)
    if not all(f.is_file() for f in (main, te, vae)):
        return None
    total = sum(f.stat().st_size for f in (main, te, vae))
    return {
        "main": main, "text_encoder": te, "vae": vae,
        "source": "comfyui", "cache_dir": str(models_dir),
        "size_mb": round(total / 1024 / 1024, 2),
    }


def find_cached(models_dir: Path, cache_dir: Path | None = None) -> dict | None:
    resolved = resolve_big_files(models_dir)
    if not resolved:
        return None
    return {
        "repo_id": f"comfyui:{COMFY_MAIN_FILE}",
        "cache_dir": resolved["cache_dir"],
        "repo_cache_dir": str(resolved["main"].parent),
        "size_mb": resolved["size_mb"],
    }


def small_pieces_status(hf_snapshot_dir, cache_dir: Path | None = None) -> dict:
    snapshot = hf_snapshot_dir(SMALL_REPO, cache_dir)
    missing = (
        [f"{SMALL_REPO}:{n}" for n in REQUIRED_FILES]
        if snapshot is None
        else [f"{SMALL_REPO}:{n}" for n in REQUIRED_FILES if not (snapshot / n).is_file()]
    )
    return {
        "ready": not missing, "missing": missing,
        "snapshot_dirs": {SMALL_REPO: str(snapshot) if snapshot else None},
    }


# ── 权重转换(ComfyUI→diffusers,430 键) ──
def convert_state(state: dict, model: Any) -> dict:
    cfg = dict(model.config) if hasattr(model, "config") else {}
    inner_dim = cfg.get("num_attention_heads", 48) * cfg.get("attention_head_dim", 128)
    out: dict = {}
    for key, tensor in state.items():
        new_key = key
        reshape = None
        if key.startswith("blocks.") or (key.startswith("txtfusion.") and (".attn." in key or ".mlp." in key)):
            prefix, suffix = key.split(".", 1)
            new_key = ("transformer_blocks." if prefix == "blocks" else "text_fusion.") + suffix
        elif key.startswith("txtfusion."):
            new_key = "text_fusion." + key[len("txtfusion."):]
        for src, dst in [
            (".attn.wq.", ".attn.to_q."), (".attn.wk.", ".attn.to_k."),
            (".attn.wv.", ".attn.to_v."), (".attn.wo.", ".attn.to_out.0."),
            (".attn.gate.", ".attn.to_gate."),
            (".attn.qknorm.qnorm.scale", ".attn.norm_q.weight"),
            (".attn.qknorm.knorm.scale", ".attn.norm_k.weight"),
            (".mlp.down.", ".ff.down."), (".mlp.gate.", ".ff.gate."),
            (".mlp.up.", ".ff.up."),
            (".prenorm.scale", ".norm1.weight"), (".postnorm.scale", ".norm2.weight"),
        ]:
            new_key = new_key.replace(src, dst)
        if ".mod.lin" in new_key:
            new_key = new_key.replace(".mod.lin", ".scale_shift_table")
            reshape = True
        for src, dst in [
            ("txtmlp.0.scale", "txt_in.norm.weight"),
            ("txtmlp.1.", "txt_in.linear_1."), ("txtmlp.3.", "txt_in.linear_2."),
            ("tmlp.0.", "time_embed.linear_1."), ("tmlp.2.", "time_embed.linear_2."),
            ("tproj.1.", "time_mod_proj."),
            ("last.linear.", "final_layer.linear."),
            ("last.norm.scale", "final_layer.norm.weight"),
            ("last.modulation.lin", "final_layer.scale_shift_table"),
            ("first.", "img_in."),
        ]:
            if new_key == src or new_key.startswith(src):
                if src == "last.modulation.lin":
                    reshape = True
                new_key = dst + new_key[len(src):]
                break
        if reshape and tensor.dim() == 1:
            tensor = tensor.reshape(-1, inner_dim)
        out[new_key] = tensor
    model_keys = set(model.state_dict().keys())
    missing = model_keys - set(out)
    if missing:
        raise RuntimeError(f"Krea2 权重转换后缺 {len(missing)} 键: {sorted(missing)[:4]}")
    return out


# ── LoRA ──
def _map_lora_key(key: str) -> str:
    if key.startswith("blocks."):
        key = "transformer_blocks." + key[len("blocks."):]
    elif key.startswith("txtfusion."):
        key = "text_fusion." + key[len("txtfusion."):]
    for src, dst in [
        (".attn.wq", ".attn.to_q"), (".attn.wk", ".attn.to_k"),
        (".attn.wv", ".attn.to_v"), (".attn.wo", ".attn.to_out.0"),
        (".attn.gate", ".attn.to_gate"),
        (".mlp.down", ".ff.down"), (".mlp.gate", ".ff.gate"),
        (".mlp.up", ".ff.up"),
    ]:
        key = key.replace(src + ".", dst + ".").replace(src, dst) if key.endswith(src) else key.replace(src + ".", dst + ".")
    return key


def merge_lora(transformer: Any, lora_path: str, strength: float = 1.0) -> int:
    from safetensors.torch import load_file
    raw = load_file(lora_path)
    pairs: dict[str, dict[str, Any]] = {}
    for key, tensor in raw.items():
        suffix = key.replace("diffusion_model.", "", 1)
        if ".lora_A." in suffix:
            base = suffix.rpartition(".lora_A.weight")[0]
        elif ".lora_B." in suffix:
            base = suffix.rpartition(".lora_B.weight")[0]
        else:
            continue
        mapped = _map_lora_key(base)
        side = "A" if ".lora_A." in suffix else "B"
        pairs.setdefault(mapped, {})[side] = tensor.float()
    merged = 0
    import torch
    with torch.no_grad():
        sd = transformer.state_dict()
        for target_key, ab in pairs.items():
            lookup = target_key + ".weight"
            if lookup not in sd or "A" not in ab or "B" not in ab:
                continue
            delta = (ab["B"] @ ab["A"]).to(sd[lookup].device, sd[lookup].dtype) * strength
            sd[lookup].add_(delta)
            merged += 1
    print(f"[image-sidecar] krea2 lora merged: {merged}/{len(pairs)} pairs (strength={strength})", flush=True)
    return merged


# ── 装配 ──
def get_components(models_dir: Path, snapshot_dir: Path) -> dict[str, Any]:
    resolved = resolve_big_files(models_dir)
    if not resolved:
        raise RuntimeError(
            "Krea2 大件未就绪:需 ComfyUI models 目录下存在 "
            f"{COMFY_MAIN_FILE}、{COMFY_TEXT_ENCODER_FILE} 与 {COMFY_VAE_FILE}。"
        )
    import torch
    from diffusers import AutoencoderKLQwenImage, FlowMatchEulerDiscreteScheduler, Krea2Transformer2DModel
    from transformers import AutoConfig, AutoTokenizer, Qwen3VLModel
    from safetensors.torch import load_file

    main_file = resolved["main"]
    te_file = resolved["text_encoder"]
    transformer = Krea2Transformer2DModel.from_config(
        Krea2Transformer2DModel.load_config(str(snapshot_dir / "transformer"))
    ).to(torch.bfloat16)
    converted = convert_state(load_file(str(main_file)), transformer)
    transformer.load_state_dict(converted, strict=True)
    transformer.eval()

    vae = AutoencoderKLQwenImage.from_pretrained(snapshot_dir, subfolder="vae", torch_dtype=torch.bfloat16)
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(snapshot_dir, subfolder="scheduler")
    tokenizer = AutoTokenizer.from_pretrained(snapshot_dir / "tokenizer")

    te_config = AutoConfig.from_pretrained(snapshot_dir / "text_encoder")
    text_encoder = Qwen3VLModel(te_config).to(torch.bfloat16)
    official_te = snapshot_dir / "text_encoder" / "model.safetensors"
    if official_te.is_file():
        text_encoder.load_state_dict(load_file(str(official_te)), strict=True)
    else:
        state = load_file(str(te_file))
        remapped = {
            k.replace("model.layers.", "language_model.layers.")
             .replace("model.embed_tokens.", "language_model.embed_tokens.")
             .replace("model.norm.", "language_model.norm.")
             .replace("model.visual.", "visual."): v
            for k, v in state.items()
        }
        text_encoder.load_state_dict(remapped, strict=False)
    text_encoder.eval()

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    return {
        "transformer": transformer.to(device),
        "vae": vae.to(device),
        "scheduler": scheduler,
        "tokenizer": tokenizer,
        "text_encoder": text_encoder.to(device),
        "is_distilled": True,
    }


def get_lora_components(models_dir: Path, snapshot_dir: Path) -> dict[str, Any]:
    import copy as _copy
    if "krea2_lora" in _lora_cache:
        return _lora_cache["krea2_lora"]
    with _lock:
        if "krea2" not in _pipeline_cache:
            _pipeline_cache["krea2"] = get_components(models_dir, snapshot_dir)
    base = _pipeline_cache["krea2"]
    lora_comps = dict(base)
    lora_comps["transformer"] = _copy.deepcopy(base["transformer"])
    lora_file = models_dir / COMFY_LORA_DIR / DEFAULT_LORA_FILE
    if lora_file.is_file():
        try:
            merge_lora(lora_comps["transformer"], str(lora_file), 1.0)
        except Exception as exc:
            print(f"[image-sidecar] krea2 lora merge 失败: {exc}", file=sys.stderr)
    _lora_cache["krea2_lora"] = lora_comps
    return lora_comps


# ── 生成 ──
def generate(prompt, aspect_ratio, negative_prompt, steps, seed, reference_b64, use_lora=False, **ctx) -> str:
    import time as _time
    import torch
    from diffusers import Krea2Pipeline
    from PIL import Image

    models_dir = ctx["models_dir"]
    snapshot_dir = ctx["snapshot_dir"]

    with _lock:
        if use_lora:
            comps = get_lora_components(models_dir, snapshot_dir)
        else:
            if "krea2" not in _pipeline_cache:
                _pipeline_cache["krea2"] = get_components(models_dir, snapshot_dir)
            comps = _pipeline_cache["krea2"]

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    kwargs = {"prompt": prompt, "height": height, "width": width, "num_inference_steps": steps}
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
    if seed is not None:
        kwargs["generator"] = torch.Generator(device="cpu").manual_seed(seed)

    phase_start = _time.time()
    pipe = Krea2Pipeline(**comps)
    result = pipe(**kwargs)
    print(
        f"[image-sidecar] krea2 timing: steps={steps} size={width}x{height} "
        f"inference={_time.time() - phase_start:.1f}s",
        flush=True,
    )
    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


# ── 下载 ──
def fetch_small_pieces(cache_dir: str, hf_snapshot_download=None, modelscope_download=None):
    for repo_id in (SMALL_REPO,):
        try:
            if modelscope_download:
                modelscope_download(repo_id, cache_dir, allow_paths=list(SMALL_EXACT_FILES))
                return
        except Exception:
            pass
        if hf_snapshot_download:
            hf_snapshot_download(repo_id=repo_id, allow_patterns=list(SMALL_PATTERNS), cache_dir=cache_dir)
