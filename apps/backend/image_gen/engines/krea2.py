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
SUPPORTS_REFERENCE = True  # SDEdit 图生图(08-31 实现,仿 ComfyUI KSampler denoise)

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




def _calc_krea2_mu(latents, scheduler):
    """计算 dynamic shifting 的 mu(分辨率相关位移量,仿 FluxPipeline)。"""
    import torch as _torch
    image_seq_len = latents.shape[-2] * latents.shape[-1]
    base_seq = scheduler.config.get("base_image_seq_len", 256)
    max_seq = scheduler.config.get("max_image_seq_len", 4096)
    base_shift = scheduler.config.get("base_shift", 0.5)
    max_shift = scheduler.config.get("max_shift", 1.15)
    # 线性插值 shift
    m = (image_seq_len - base_seq) / (max_seq - base_seq)
    m = m.clamp(0, 1) if hasattr(m, 'clamp') else max(0, min(1, m))
    shift = base_shift + m * (max_shift - base_shift)
    return _torch.tensor(shift)

# ── 生成(双工作流:文生图+图生图 SDEdit) ──
def generate(prompt, aspect_ratio, negative_prompt, steps, seed, reference_b64,
             use_lora=False, strength=0.65, **ctx) -> str:
    """Krea2 统一入口:有参考图走 SDEdit 图生图,无参考图走纯文生图。

    strength(图生图):0.0=完全保留原图,1.0=纯噪声(等同文生图)。
    ComfyUI KSampler 的 denoise 参数同义。
    """
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
    generator = torch.Generator(device="cpu").manual_seed(seed) if seed is not None else None
    phase_start = _time.time()

    pipe = Krea2Pipeline(**comps)

    if reference_b64:
        # ═══ 图生图(SDEdit,仿 ComfyUI KSampler denoise) ═══
        # 策略:VAE 编码参考图→加噪→把加噪潜空间作为管线 latents 参数传入,
        # 管线内部自动处理调度器(mu/dynamic shifting)与去噪循环。
        raw = reference_b64.split(",", 1)[-1] if reference_b64.startswith("data:") else reference_b64
        ref_img = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((width, height))

        # 1. VAE 编码参考图 → 归一化潜空间
        import numpy as _np
        ref_tensor = (
            torch.from_numpy(_np.array(ref_img))
            .permute(2, 0, 1).unsqueeze(0).unsqueeze(2)
            .float() / 127.5 - 1
        ).to(comps["vae"].device, comps["vae"].dtype)
        vae_cfg = comps["vae"].config
        lat_mean = torch.tensor(vae_cfg["latents_mean"]).view(1, -1, 1, 1, 1).to(ref_tensor.device, ref_tensor.dtype)
        lat_std = torch.tensor(vae_cfg["latents_std"]).view(1, -1, 1, 1, 1).to(ref_tensor.device, ref_tensor.dtype)
        with torch.no_grad():
            raw_lat = comps["vae"].encode(ref_tensor).latent_dist.sample()
            ref_latents = (raw_lat - lat_mean) / lat_std
            # VAE 输出 5D (B,C,F,H,W);管线期望 4D (B,C,H,W)——squeeze 帧维
            if ref_latents.dim() == 5:
                ref_latents = ref_latents.squeeze(2)

        # 2. 计算有效去噪步数(strength=0.6 → 跑 60% 的步数,跳过前 40%)
        effective_steps = max(1, int(steps * strength))

        # 3. 在起始 sigma 级别加噪
        device = pipe._execution_device
        scheduler = comps["scheduler"]
        # 先跑一遍完整步数拿到 sigma 序列,取截断位置的 sigma
        scheduler.set_timesteps(steps, device=device, mu=_calc_krea2_mu(ref_latents, scheduler))
        num_skip = steps - effective_steps
        sigma_start = scheduler.sigmas[num_skip].to(device, ref_latents.dtype)
        noise = torch.randn(ref_latents.shape, generator=generator, device="cpu", dtype=torch.float32).to(device, ref_latents.dtype)
        # Flow-matching 加噪: x_t = (1-σ)x_0 + σ·noise
        noised_4d = (1.0 - sigma_start) * ref_latents + sigma_start * noise

        # Patchify 4D→3D packed(管线 latents 参数要 (B,seq,in_channels)):
        # (B,16,h,w) → patch_size=2 → (B,h/2*w/2,16*4=64)
        patch_size = getattr(pipe, 'patch_size', 2)
        B, C, H, W = noised_4d.shape
        ph, pw = H // patch_size, W // patch_size
        packed = noised_4d.reshape(B, C, ph, patch_size, pw, patch_size)
        packed = packed.permute(0, 2, 4, 1, 3, 5)  # B,ph,pw,C,p1,p2
        noised_latents = packed.reshape(B, ph * pw, C * patch_size * patch_size)

        # 4. 交给管线去噪(管线自动处理 mu/调度/循环)
        kwargs = {
            "prompt": prompt,
            "height": height, "width": width,
            "num_inference_steps": effective_steps,
            "latents": noised_latents,
        }
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
        if generator is not None:
            kwargs["generator"] = generator
        result = pipe(**kwargs)
        image = result.images[0]
        print(
            f"[image-sidecar] krea2 img2img: strength={strength} eff_steps={effective_steps}/{steps} "
            f"size={width}x{height} inference={_time.time() - phase_start:.1f}s",
            flush=True,
        )
    else:
        # ═══ 纯文生图 ═══
        kwargs = {"prompt": prompt, "height": height, "width": width, "num_inference_steps": steps}
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
        if generator is not None:
            kwargs["generator"] = generator
        result = pipe(**kwargs)
        image = result.images[0]
        print(
            f"[image-sidecar] krea2 t2i: steps={steps} size={width}x{height} "
            f"inference={_time.time() - phase_start:.1f}s",
            flush=True,
        )

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
