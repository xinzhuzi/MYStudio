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

# ── 「Krea2-NSFW专业流」固定流程(09-01 逐节点对照 ComfyUI 原版工作流移植+深审修正) ──
# 原版 = ~/Project/ComfyUI/user/default/workflows/K2图像/Krea2-NSFW专业流.json:
#   PowerLoraLoader 开关态 = Mystic XXX v3@1.0 + pussy@0.3(NSFW V4 为关闭态);
#   两文件深审实证:512 键全 diffusion_model.*、零 alpha/dora 键 → ComfyUI
#   calculate_weight 的缩放系数 = 纯 strength(无 alpha/rank 因子),无 TE 侧权重;
#   ConditioningKrea2Rebalance 节点51(multiplier=1, 12 带 weights 第9带×5;节点76 未连线);
#   负条件 = ZeroOut(重平衡后正条件); KSampler euler/simple 8步 cfg=1。
PRO_LORA_STACK = (
    ("KREA 2 Mystic XXX v3.safetensors", 1.0),
    ("Krea 2 pussy.safetensors", 0.3),
)
# 12 权重 = Krea2Pipeline text_encoder_select_layers=(2,5,...,35) 升序 12 层
# (与 ComfyUI 编码器 (B,12,seq,2560) 升序展平到末维同构)
PRO_REBALANCE_MULTIPLIER = 1.0
PRO_REBALANCE_WEIGHTS = (1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 5.0, 1.0, 1.0, 1.0)
# ComfyUI sampling_function: math.isclose(cfg,1.0) → uncond=None(跳负通道纯正向);
# diffusers do_cfg = s>0 且混合式同构 → s=0 为逐位同义,且免负通道计算(耗时减半)
GUIDANCE_SCALE = 0.0

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

# ComfyUI ResolutionSelector 公式对齐:1MP 目标、round(w*s/multiple)*multiple;
# multiple 取 16(管线的 vae_scale_factor*patch_size 整除校验,ComfyUI 的 8 会被
# 管线 ValueError 拒绝):1:1=1024²、16:9=1360×768、4:3=1184×880
ASPECT_RATIOS = {
    "1:1": (1024, 1024),
    "16:9": (1360, 768),
    "9:16": (768, 1360),
    "4:3": (1184, 880),
    "3:4": (880, 1184),
}

_lock = threading.RLock()  # generate() 持锁调 get_lora_components() 内部再抢锁:必须可重入(09-01 实弹:普通 Lock 下 use_lora 首跑自锁 0%CPU 挂死)
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
    # 原版工作流恒用 ComfyUI 的 heretic 破限版 TE(两个 K2 工作流同);官方 TE 仅
    # 在 heretic 大件缺席时兜底。heretic→Qwen3VL 键名走 remap(08-31 shard 对拍)
    official_te = snapshot_dir / "text_encoder" / "model.safetensors"
    if Path(te_file).is_file():
        state = load_file(str(te_file))
        remapped = {
            k.replace("model.layers.", "language_model.layers.")
             .replace("model.embed_tokens.", "language_model.embed_tokens.")
             .replace("model.norm.", "language_model.norm.")
             .replace("model.visual.", "visual."): v
            for k, v in state.items()
        }
        text_encoder.load_state_dict(remapped, strict=False)
    elif official_te.is_file():
        text_encoder.load_state_dict(load_file(str(official_te)), strict=True)
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
    for lora_name, strength in PRO_LORA_STACK:
        lora_file = models_dir / COMFY_LORA_DIR / lora_name
        if lora_file.is_file():
            try:
                merge_lora(lora_comps["transformer"], str(lora_file), strength)
            except Exception as exc:
                print(f"[image-sidecar] krea2 lora merge 失败({lora_name}): {exc}", file=sys.stderr)
        else:
            print(f"[image-sidecar] krea2 专业流 LoRA 缺失,跳过: {lora_file}", file=sys.stderr)
    _lora_cache["krea2_lora"] = lora_comps
    return lora_comps


def _rebalance_prompt_embeds(embeds: Any, weights: "tuple[float, ...]", multiplier: float) -> Any:
    """逐层条带缩放,移植 ComfyUI ConditioningKrea2Rebalance._scale_cond_tensor。
    形状对齐(09-01 深审实锤):ComfyUI 把 12 层栈 (B,12,seq,2560) 升序展平到
    末维 (B,seq,12*2560) 后按末维均分条带;diffusers encode_prompt 保持 4D
    (B,seq,12,2560)——层在轴 -2。若按末维均分,2560%12≠0 恒走兜底 ×multiplier
    =静默无效。此处按真实形状选轴:4D 缩轴 -2,3D 末维均分。"""
    import torch
    n = len(weights)
    if n <= 1:
        return embeds * multiplier
    orig_dtype = embeds.dtype
    t = embeds.float()
    gains = torch.tensor(weights, dtype=t.dtype, device=t.device)
    if t.dim() >= 3 and t.shape[-2] == n:
        t = t * gains.view(*([1] * (t.dim() - 2)), n, 1)
    else:
        flat = int(t.shape[-1])
        if flat % n != 0:
            return embeds * multiplier
        t = t.view(*t.shape[:-1], n, flat // n)
        t = t * gains.view(*([1] * (t.dim() - 2)), n, 1)
        t = t.view(*t.shape[:-2], flat)
    return t.to(orig_dtype) * multiplier




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
def _cancel_step_callback():
    """diffusers 逐步回调:检测服务端取消即中止(锁随异常释放)。

    延迟导入避免 engines→pipeline 环(与 _pipeline_error 同法)。部分管线
    不支持 callback_on_step_end 时由调用方降级(不接取消)。

    返回值是 diffusers 契约的一部分:管线拿回调返回值 dict 去 pop
    "latents"/"prompt_embeds"(pipeline_flux.py 无 None 保护)。返回 None
    会在第一步去噪后 NoneType.pop 必崩(0dc6724 装机首跑实锤)——正常
    路径必须把 callback_kwargs 原样透传(不改写张量输入)。
    """
    from ..pipeline import is_generation_cancelled

    def _on_step_end(_pipe, _step_index, _t, callback_kwargs):
        if is_generation_cancelled():
            raise RuntimeError("generation-cancelled")
        return callback_kwargs

    return _on_step_end


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

    def build_text_inputs(text: str) -> dict:
        """专业流=先编码再注入(重平衡在 embeds 上做);普通流=直接传文本。
        guidance=0(cfg=1 同义)时负条件整条跳过,与原版 ZeroOut+cfg1 语义一致。"""
        if not use_lora:
            return {"prompt": text}
        embeds, embeds_mask = pipe.encode_prompt(prompt=text)
        embeds = _rebalance_prompt_embeds(embeds, PRO_REBALANCE_WEIGHTS, PRO_REBALANCE_MULTIPLIER)
        return {"prompt_embeds": embeds, "prompt_embeds_mask": embeds_mask}

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
            **build_text_inputs(prompt),
            "height": height, "width": width,
            "num_inference_steps": effective_steps,
            "guidance_scale": GUIDANCE_SCALE,
            "latents": noised_latents,
        }
        if generator is not None:
            kwargs["generator"] = generator
        step_cb = _cancel_step_callback()
        try:
            result = pipe(**kwargs, callback_on_step_end=step_cb)
        except TypeError:
            # 管线不支持逐步回调时不接取消(降级:取消仅在步骤间生效于支持管线)
            result = pipe(**kwargs)
        image = result.images[0]
        print(
            f"[image-sidecar] krea2 img2img: strength={strength} eff_steps={effective_steps}/{steps} "
            f"size={width}x{height} inference={_time.time() - phase_start:.1f}s",
            flush=True,
        )
    else:
        # ═══ 纯文生图 ═══
        kwargs = {
            **build_text_inputs(prompt),
            "height": height, "width": width,
            "num_inference_steps": steps,
            "guidance_scale": GUIDANCE_SCALE,
        }
        if generator is not None:
            kwargs["generator"] = generator
        step_cb = _cancel_step_callback()
        try:
            result = pipe(**kwargs, callback_on_step_end=step_cb)
        except TypeError:
            # 管线不支持逐步回调时不接取消(降级:取消仅在步骤间生效于支持管线)
            result = pipe(**kwargs)
        image = result.images[0]
        print(
            f"[image-sidecar] krea2 t2i: steps={steps} size={width}x{height} "
            f"inference={_time.time() - phase_start:.1f}s "
            f"(guidance={GUIDANCE_SCALE} lora={'专业流' if use_lora else '无'})",
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
