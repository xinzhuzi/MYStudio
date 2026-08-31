"""Diffusion pipeline management — lazy load, local files only.

Inference NEVER downloads models. A missing model raises PipelineError with
code "model-not-downloaded" so callers surface an actionable message.

Qwen-Image-Edit 2511(指向版,08-28 尖刺实证配方):
- 主模型 GGUF + 文本编码器 safetensors 直用 ComfyUI 现成文件;
- 文本编码器 ComfyUI 原始 HF 导出键名 → transformers 5.x 结构,纯函数映射;
- 纯文生图 = 白底画布(编辑管线语义);参考图 = image 列表首位;
- 分辨率档对齐 Qwen 官方(resolution 缩放旋钮对 Qwen 不生效)。
"""

from __future__ import annotations

import base64
import io
import threading
from typing import Any

from .model_cache import (
    FLUX2_KLEIN_MODEL,
    QWEN_IMAGE_EDIT_MODEL,
    QWEN_IMAGE_REPO,
    QWEN_VL_REPO,
    Z_IMAGE_MODEL,
    find_cached_image_model_for_spec,
    resolve_qwen_big_files,
    resolve_z_image_big_files,
    resolve_flux2_big_files,
    flux2_small_pieces_status,
    qwen_small_pieces_status,
    z_image_small_pieces_status,
    resolve_image_model_name,
)
from .model_cache import IMAGE_MODELS

# Aspect ratio presets (width, height) matching common storyboard ratios.
ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024),
    "16:9": (1152, 640),
    "9:16": (640, 1152),
    "4:3": (1072, 808),
    "3:4": (808, 1072),
}

# Qwen 官方分辨率档(1MP 训练域;非官方档质量下降)
QWEN_ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1328, 1328),
    "16:9": (1664, 928),
    "9:16": (928, 1664),
    "4:3": (1472, 1140),
    "3:4": (1140, 1472),
}

RESOLUTION_SCALES: dict[str, float] = {
    "512": 0.5,
    "768": 0.75,
    "1024": 1.0,
    "2048": 1.5,
}


class PipelineError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_lock = threading.Lock()
_pipelines: dict[str, Any] = {}
_img2img_pipelines: dict[str, Any] = {}
# 推理互斥:diffusers 管线非线程安全(GGUF 量化层/tqdm 等共享态),两个请求并发
# 调同一管线会互相拖死(实弹:双请求后 handler 线程永锁在 Python 锁上)。
# 引擎语义=串行单飞;忙时快速报错,不排队(排队只会把 HTTP 拖到超时)。
_infer_lock = threading.Lock()


def _run_inference(pipe, kwargs: dict[str, Any]):
    if not _infer_lock.acquire(blocking=False):
        raise PipelineError(
            "generation-busy",
            "上一张图还在生成中(本地生图为串行引擎),请等待完成后再试。",
        )
    try:
        return pipe(**kwargs)
    finally:
        _infer_lock.release()


# ---------------------------------------------------------------------------
# Qwen 文本编码器键名映射(ComfyUI 原始 HF 导出 → transformers 5.x 结构)
# ---------------------------------------------------------------------------


def convert_qwen25_vl_state_dict_key(key: str) -> str:
    """Qwen2.5-VL ComfyUI 导出键名 → transformers 5.x 结构键名(尖刺实证:
    missing=0 unexpected=0,仅主模型侧 __index_timestep_zero__ 类无害键)。"""
    if key == "lm_head.weight":
        return key
    if key.startswith("visual."):
        return "model." + key
    if key.startswith("model."):
        return "model.language_model." + key[len("model."):]
    return key


def _load_qwen_text_encoder(text_encoder_path, config_path):
    """ComfyUI 单文件 TE 直载:键名映射后 assign 进空权重骨架,免 16GB 重下。"""
    import torch
    from accelerate import init_empty_weights
    import safetensors.torch as safetensors_io
    from transformers import Qwen2_5_VLConfig, Qwen2_5_VLForConditionalGeneration

    state_dict = safetensors_io.load_file(str(text_encoder_path))
    converted = {convert_qwen25_vl_state_dict_key(key): value for key, value in state_dict.items()}
    config = Qwen2_5_VLConfig.from_json_file(str(config_path))
    with init_empty_weights():
        model = Qwen2_5_VLForConditionalGeneration(config)
    model.load_state_dict(converted, strict=False, assign=True)
    return model.to(torch.bfloat16)


def _get_qwen_pipeline(model_name: str):
    with _lock:
        if model_name in _pipelines:
            return _pipelines[model_name]

        spec = IMAGE_MODELS[model_name]
        cached = find_cached_image_model_for_spec(spec)
        if not cached:
            raise PipelineError(
                "model-not-downloaded",
                "Qwen 大件未就绪:需 ComfyUI models 目录下存在 "
                "diffusion_models/qwen_image_edit_2511_Q8_0.gguf 与 "
                "text_encoders/qwen_2.5_vl_7b.safetensors,"
                "或前往 设置 → 本地配置 → 本地图片生成 点击「下载完整模型」自足获取。",
            )
        pieces = qwen_small_pieces_status()
        if not pieces["ready"]:
            raise PipelineError(
                "small-pieces-missing",
                "Qwen 小件未补齐(VAE/调度器/分词器,约 300MB)。"
                "请前往 设置 → 本地配置 → 本地图片生成 点击「补齐小件」。",
            )
        image_snapshot = pieces["snapshot_dirs"].get(QWEN_IMAGE_REPO)
        vl_snapshot = pieces["snapshot_dirs"].get(QWEN_VL_REPO)
        if not image_snapshot or not vl_snapshot:
            raise PipelineError("small-pieces-missing", "Qwen 小件 snapshot 目录缺失,请重新补齐小件。")

        from pathlib import Path

        # 两源解析:ComfyUI 指向优先,应用缓存自足回退(均为单文件,装配无分支)
        big_files = resolve_qwen_big_files()
        if not big_files:
            raise PipelineError("model-not-downloaded", "Qwen 大件在解析后仍缺失(两源皆无),请重新探测或下载。")
        main_file = big_files["main"]
        text_encoder_file = big_files["text_encoder"]
        image_dir = Path(image_snapshot)
        vl_dir = Path(vl_snapshot)

        try:
            import torch
            from diffusers import (
                AutoencoderKLQwenImage,
                FlowMatchEulerDiscreteScheduler,
                QwenImageEditPlusPipeline,
                QwenImageTransformer2DModel,
            )
            from transformers import AutoProcessor, AutoTokenizer
            # GGUFQuantizationConfig 0.40.0 起从 quantizers.gguf 搬到
            # quantizers.quantization_config(实弹踩坑:旧路径 ImportError)
            try:
                from diffusers.quantizers.quantization_config import GGUFQuantizationConfig
            except ImportError:
                from diffusers.quantizers.gguf import GGUFQuantizationConfig
        except ImportError as exc:
            raise PipelineError("diffusers-missing", f"Qwen 生图依赖未安装: {exc}") from exc

        try:
            # from_single_file 必须显式 config=,默认会去拉 SD1.5 配置然后 404
            transformer_config_dir = image_dir / "transformer"
            config_dir = transformer_config_dir if transformer_config_dir.is_dir() else image_dir
            transformer = QwenImageTransformer2DModel.from_single_file(
                str(main_file),
                config=str(config_dir),
                quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
                torch_dtype=torch.bfloat16,
            )
            # VAE 必须显式 bf16:默认 float32 与 bf16 主干混跑,MPS 推理报
            # "Input type (BFloat16) and bias type (float) should be the same"(实弹踩坑)
            vae = AutoencoderKLQwenImage.from_pretrained(image_dir, subfolder="vae", torch_dtype=torch.bfloat16)
            scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(image_dir, subfolder="scheduler")
            tokenizer = AutoTokenizer.from_pretrained(vl_dir)
            processor = AutoProcessor.from_pretrained(vl_dir)
            text_encoder = _load_qwen_text_encoder(text_encoder_file, vl_dir / "config.json")
            pipe = QwenImageEditPlusPipeline(
                transformer=transformer,
                vae=vae,
                text_encoder=text_encoder,
                tokenizer=tokenizer,
                scheduler=scheduler,
                processor=processor,
            )
            device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
            pipe = pipe.to(device)
        except PipelineError:
            raise
        except Exception as exc:
            raise PipelineError("model-load-failed", f"Qwen 生图管线装配失败: {exc}") from exc

        _pipelines[model_name] = pipe
        return pipe


def _generate_qwen(
    prompt: str,
    aspect_ratio: str,
    negative_prompt: str | None,
    steps: int,
    seed: int | None,
    reference_image_b64: str | None,
) -> str:
    pipe = _get_qwen_pipeline(QWEN_IMAGE_EDIT_MODEL)

    from PIL import Image

    width, height = QWEN_ASPECT_RATIOS.get(aspect_ratio, QWEN_ASPECT_RATIOS["1:1"])

    if reference_image_b64:
        raw = reference_image_b64
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            init_image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        except Exception as exc:
            raise PipelineError("invalid-reference", f"参考图解码失败: {exc}") from exc
        init_image = init_image.resize((width, height))
    else:
        # 纯文生图 = 白底画布:编辑管线以输入画布为底,模型把它"编辑"成提示词画面
        init_image = Image.new("RGB", (width, height), "white")

    kwargs: dict[str, Any] = {
        "image": [init_image],
        "prompt": prompt,
        "num_inference_steps": steps,
    }
    if seed is not None:
        import torch

        kwargs["generator"] = torch.Generator(device="cpu").manual_seed(seed)
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
        # true_cfg_scale 需配 negative_prompt 才生效;guidance_scale 会被忽略(非蒸馏引导)
        kwargs["true_cfg_scale"] = 4.0

    import time as _time

    _phase_start = _time.time()
    try:
        result = _run_inference(pipe, kwargs)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc

    # 分相计时:tqdm 进度条在 MPS 异步执行下会说谎(kernel 排队快、真算慢,
    # 实测 20 步条显 2s 实算 ~300s)——日志时间戳是唯一可信口径(08-29 实弹教训)
    print(
        f"[image-sidecar] qwen phase timing: steps={steps} negative={'yes' if negative_prompt else 'no'} "
        f"size={width}x{height} inference={_time.time() - _phase_start:.1f}s",
        flush=True,
    )

    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


_z_image_pipelines: dict[str, dict[str, Any]] = {}


def _get_z_image_components() -> dict[str, Any]:
    """Z-Image-Turbo 五件套装配(大件 ComfyUI 指向 + 小件应用缓存 snapshot)。

    与 Qwen 指向版同纪律:缺件 fail-closed 报可操作错误码,绝不自动下载。
    """
    resolved = resolve_z_image_big_files()
    if not resolved:
        raise PipelineError(
            "model-not-downloaded",
            "Z-Image 大件未就绪:需 ComfyUI models 目录下存在 "
            "diffusion_models/z_image_turbo_bf16.safetensors 与 "
            "text_encoders/qwen_3_4b.safetensors。",
        )
    pieces = z_image_small_pieces_status()
    if not pieces["ready"]:
        raise PipelineError(
            "small-pieces-missing",
            "Z-Image 小件未补齐(VAE/调度器/分词器,约 400MB)。"
            "请前往 设置 → 本地配置 → 本地图片生成 点击「补齐小件」。",
        )
    snapshot_str = next(iter(pieces["snapshot_dirs"].values()), None)
    if not snapshot_str:
        raise PipelineError("small-pieces-missing", "Z-Image 小件 snapshot 目录缺失,请重新补齐小件。")

    from pathlib import Path as _P

    snapshot = _P(snapshot_str)
    try:
        import torch
        from diffusers import (
            AutoencoderKL,
            FlowMatchEulerDiscreteScheduler,
            ZImageTransformer2DModel,
        )
        from transformers import AutoConfig, AutoTokenizer, Qwen3ForCausalLM
        from safetensors.torch import load_file
    except ImportError as exc:
        raise PipelineError("diffusers-missing", f"Z-Image 生图依赖未安装: {exc}") from exc

    try:
        main_file = resolved["main"]
        te_file = resolved["text_encoder"]
        transformer = ZImageTransformer2DModel.from_single_file(
            str(main_file),
            config=str(snapshot / "transformer"),
            torch_dtype=torch.bfloat16,
        )
        # VAE 双源(08-30 用户补下 ComfyUI ae.safetensors):优先 ComfyUI
        # 单文件直载;不在则回退小件仓 snapshot
        vae_comfy = resolved.get("vae")
        # from_single_file 不带 config 会按 sd/flux 默认猜,32 通道潜变量的
        # Z-Image VAE 会撞 conv_out 形状(实弹)——必须喂小件仓的 vae config
        vae = (
            AutoencoderKL.from_single_file(
                str(vae_comfy), config=str(snapshot / "vae"), torch_dtype=torch.bfloat16
            )
            if vae_comfy
            else AutoencoderKL.from_pretrained(snapshot, subfolder="vae", torch_dtype=torch.bfloat16)
        )
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(snapshot, subfolder="scheduler")
        tokenizer = AutoTokenizer.from_pretrained(snapshot / "tokenizer")
        te_config = AutoConfig.from_pretrained(snapshot / "text_encoder")
        text_encoder = Qwen3ForCausalLM(te_config).to(torch.bfloat16)
        state = load_file(str(te_file))
        missing_keys, unexpected_keys = text_encoder.load_state_dict(state, strict=False)
        text_encoder.eval()
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("model-load-failed", f"Z-Image 生图管线装配失败: {exc}") from exc

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    return {
        "transformer": transformer.to(device),
        "vae": vae.to(device),
        "scheduler": scheduler,
        "tokenizer": tokenizer,
        "text_encoder": text_encoder.to(device),
    }


def _generate_z_image(
    prompt: str,
    aspect_ratio: str,
    negative_prompt: str | None,
    steps: int,
    seed: int | None,
    reference_image_b64: str | None,
    strength: float = 0.35,
) -> str:
    """Z-Image-Turbo:T2I 直出;参考图走 Img2Img+strength(低重绘语义,B 站
    修复工作流同源——strength 0.1~0.25 即精修档,留待后续修复链)。
    默认 0.35 为实弹标定:0.55 重绘过度内容漂移(题材丢失),0.3 构图人物
    全保(08-30 三苦力码头实弹)。"""
    import time as _time

    with _lock:
        if "z" not in _z_image_pipelines:
            _z_image_pipelines["z"] = _get_z_image_components()
        comps = _z_image_pipelines["z"]

    from diffusers import ZImageImg2ImgPipeline, ZImagePipeline
    from PIL import Image

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])

    init_image = None
    pipe: Any
    if reference_image_b64:
        raw = reference_image_b64
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            init_image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        except Exception as exc:
            raise PipelineError("invalid-reference", f"参考图解码失败: {exc}") from exc
        init_image = init_image.resize((width, height))
        pipe = ZImageImg2ImgPipeline(**comps)
    else:
        pipe = ZImagePipeline(**comps)

    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "height": height,
        "width": width,
        "num_inference_steps": steps,
        "guidance_scale": 1.0,
    }
    if negative_prompt:
        kwargs["negative_prompt"] = negative_prompt
        kwargs["guidance_scale"] = 4.0
    if seed is not None:
        import torch

        kwargs["generator"] = torch.Generator(device="cpu").manual_seed(seed)
    if init_image is not None:
        kwargs["image"] = init_image
        kwargs["strength"] = strength

    phase_start = _time.time()
    try:
        result = _run_inference(pipe, kwargs)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"Z-Image 生成失败: {exc}") from exc
    print(
        f"[image-sidecar] z-image phase timing: steps={steps} ref={'yes' if init_image else 'no'} "
        f"size={width}x{height} inference={_time.time() - phase_start:.1f}s",
        flush=True,
    )
    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


_flux2_pipelines: dict[str, dict[str, Any]] = {}


def _get_flux2_components() -> dict[str, Any]:
    """FLUX.2 Klein 五件套装配(三大件 ComfyUI 指向 + 小件应用缓存)。"""
    resolved = resolve_flux2_big_files()
    if not resolved:
        raise PipelineError(
            "model-not-downloaded",
            "FLUX.2 大件未就绪:需 ComfyUI models 目录下存在 "
            "diffusion_models/flux2_klein_9b.safetensors、text_encoders/qwen_3_8b.safetensors "
            "与 vae/flux2-vae.safetensors。",
        )
    pieces = flux2_small_pieces_status()
    if not pieces["ready"]:
        raise PipelineError(
            "small-pieces-missing",
            "FLUX.2 小件未补齐(调度器/配置/分词器,MB 级)。"
            "请前往 设置 → 本地配置 → 本地图片生成 点击「补齐小件」。",
        )
    snapshot_str = next(iter(pieces["snapshot_dirs"].values()), None)
    if not snapshot_str:
        raise PipelineError("small-pieces-missing", "FLUX.2 小件 snapshot 目录缺失,请重新补齐小件。")

    from pathlib import Path as _P

    snapshot = _P(snapshot_str)
    try:
        import torch
        from diffusers import AutoencoderKLFlux2, Flux2Transformer2DModel, FlowMatchEulerDiscreteScheduler
        from transformers import AutoConfig, AutoTokenizer, Qwen3ForCausalLM
        from safetensors.torch import load_file
    except ImportError as exc:
        raise PipelineError("diffusers-missing", f"FLUX.2 生图依赖未安装: {exc}") from exc

    try:
        main_file = resolved["main"]
        te_file = resolved["text_encoder"]
        transformer = Flux2Transformer2DModel.from_single_file(
            str(main_file),
            config=str(snapshot / "transformer"),
            torch_dtype=torch.bfloat16,
        )
        # Klein VAE:走小件仓 diffusers 版(ComfyUI flux2-vae 为旧版键名,
        # 与 diffusers 不兼容——实弹键全 miss;AutoencoderKLFlux2 亦无
        # from_single_file)。336MB 显式下载。
        vae = AutoencoderKLFlux2.from_pretrained(snapshot, subfolder="vae", torch_dtype=torch.bfloat16)
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(snapshot, subfolder="scheduler")
        tokenizer = AutoTokenizer.from_pretrained(snapshot / "tokenizer")
        te_config = AutoConfig.from_pretrained(snapshot / "text_encoder")
        if te_file.suffix == ".gguf":
            # 用户 TE 换代(08-30):uncensored Q8 GGUF——transformers
            # gguf_file 装载(自解量化到 bf16)
            text_encoder = Qwen3ForCausalLM.from_pretrained(
                str(te_file.parent),
                gguf_file=te_file.name,
                config=te_config,
                torch_dtype=torch.bfloat16,
            )
        else:
            text_encoder = Qwen3ForCausalLM(te_config).to(torch.bfloat16)
            state = load_file(str(te_file))
            text_encoder.load_state_dict(state, strict=False)
        text_encoder.eval()
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("model-load-failed", f"FLUX.2 生图管线装配失败: {exc}") from exc

    device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    return {
        "transformer": transformer.to(device),
        "vae": vae.to(device),
        "scheduler": scheduler,
        "tokenizer": tokenizer,
        "text_encoder": text_encoder.to(device),
        "is_distilled": True,
    }


def _generate_flux2(
    prompt: str,
    aspect_ratio: str,
    negative_prompt: str | None,
    steps: int,
    seed: int | None,
    reference_image_b64: str | None,
) -> str:
    """FLUX.2 Klein:T2I 直出;参考图走原生 image 输入(Klein 编辑语义)。"""
    import time as _time

    with _lock:
        if "flux2" not in _flux2_pipelines:
            _flux2_pipelines["flux2"] = _get_flux2_components()
        comps = _flux2_pipelines["flux2"]

    from diffusers import Flux2KleinPipeline
    from PIL import Image

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])

    init_image = None
    if reference_image_b64:
        raw = reference_image_b64
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            init_image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
        except Exception as exc:
            raise PipelineError("invalid-reference", f"参考图解码失败: {exc}") from exc

    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "height": height,
        "width": width,
        "num_inference_steps": steps,
    }
    if seed is not None:
        import torch

        kwargs["generator"] = torch.Generator(device="cpu").manual_seed(seed)
    if init_image is not None:
        kwargs["image"] = [init_image]

    phase_start = _time.time()
    try:
        pipe = Flux2KleinPipeline(**comps)
        result = _run_inference(pipe, kwargs)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"FLUX.2 生成失败: {exc}") from exc
    print(
        f"[image-sidecar] flux2 phase timing: steps={steps} ref={'yes' if init_image else 'no'} "
        f"size={width}x{height} inference={_time.time() - phase_start:.1f}s",
        flush=True,
    )
    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _require_downloaded(model_name: str) -> None:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        raise PipelineError("unknown-model", f"未知图像模型: {model_name}")
    cached = find_cached_image_model_for_spec(spec)
    if not cached:
        raise PipelineError(
            "model-not-downloaded",
            f"图像模型 {spec['label']} 未下载。请前往 设置 → 本地配置 → 本地图片生成 下载。",
        )


def _get_pipeline(model_name: str):
    _require_downloaded(model_name)
    if IMAGE_MODELS[model_name].get("layout") == "qwen-pointed":
        return _get_qwen_pipeline(model_name)
    with _lock:
        if model_name in _pipelines:
            return _pipelines[model_name]

        spec = IMAGE_MODELS[model_name]
        try:
            import torch
            from diffusers import AutoPipelineForText2Image
        except ImportError as exc:
            raise PipelineError("diffusers-missing", f"diffusers/torch 未安装: {exc}") from exc

        device = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
        dtype = torch.float16 if device in ("mps", "cuda") else torch.float32
        try:
            pipe = AutoPipelineForText2Image.from_pretrained(
                spec["repo_id"],
                torch_dtype=dtype,
                local_files_only=True,
            )
            pipe = pipe.to(device)
        except Exception as exc:
            raise PipelineError("model-load-failed", f"模型 {spec['label']} 加载失败: {exc}") from exc

        _pipelines[model_name] = pipe
        return pipe


def _get_img2img_pipeline(model_name: str):
    """Convert the cached t2i pipeline to img2img (reference/consistency mode)."""
    _require_downloaded(model_name)
    with _lock:
        if model_name in _img2img_pipelines:
            return _img2img_pipelines[model_name]
    # _get_pipeline also takes _lock; resolve it outside the lock to avoid a
    # non-reentrant lock self-deadlock on the first reference-image request.
    t2i = _get_pipeline(model_name)
    try:
        from diffusers import AutoPipelineForImage2Image

        pipe = AutoPipelineForImage2Image.from_pipe(t2i)
    except Exception as exc:
        raise PipelineError("img2img-unavailable", f"img2img 转换失败: {exc}") from exc
    with _lock:
        if model_name in _img2img_pipelines:
            return _img2img_pipelines[model_name]
        _img2img_pipelines[model_name] = pipe
        return pipe


def generate_image(
    model_name: str,
    prompt: str,
    aspect_ratio: str = "1:1",
    resolution: str = "1024",
    negative_prompt: str | None = None,
    num_inference_steps: int | None = None,
    seed: int | None = None,
    reference_image_b64: str | None = None,
    strength: float = 0.55,
) -> str:
    """Generate an image and return it as base64 PNG (no data: prefix).

    When reference_image_b64 is provided (raw base64, data: prefix tolerated),
    generation runs against the reference — the local analogue of the cloud
    reference-image flow for character/scene consistency. Qwen 指向版走编辑
    管线(参考图即画布底图);HF 布局模型走 img2img(strength 生效)。
    """
    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS[model_name]

    if spec.get("layout") == "flux2-pointed":
        return _generate_flux2(
            prompt,
            aspect_ratio,
            negative_prompt,
            num_inference_steps or spec["steps"],
            seed,
            reference_image_b64,
        )
    if spec.get("layout") == "z-image-pointed":
        return _generate_z_image(
            prompt,
            aspect_ratio,
            negative_prompt,
            num_inference_steps or spec["steps"],
            seed,
            reference_image_b64,
        )
    if spec.get("layout") == "qwen-pointed":
        # Qwen 官方分辨率档固定,resolution 缩放旋钮不生效(非官方档质量下降)
        return _generate_qwen(
            prompt,
            aspect_ratio,
            negative_prompt,
            num_inference_steps or spec["steps"],
            seed,
            reference_image_b64,
        )

    width, height = ASPECT_RATIOS.get(aspect_ratio, ASPECT_RATIOS["1:1"])
    scale = RESOLUTION_SCALES.get(resolution, 1.0)
    width, height = int(width * scale), int(height * scale)
    width, height = max(512, (width // 8) * 8), max(512, (height // 8) * 8)

    steps = num_inference_steps or spec["steps"]

    import torch

    generator = None
    if seed is not None:
        generator = torch.Generator(device="cpu").manual_seed(seed)

    init_image = None
    if reference_image_b64:
        raw = reference_image_b64
        if raw.startswith("data:"):
            raw = raw.split(",", 1)[-1]
        try:
            from PIL import Image

            init_image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB")
            init_image = init_image.resize((width, height))
        except Exception as exc:
            raise PipelineError("invalid-reference", f"参考图解码失败: {exc}") from exc

    pipe = _get_img2img_pipeline(model_name) if init_image is not None else _get_pipeline(model_name)

    kwargs: dict[str, Any] = {
        "prompt": prompt,
        "num_inference_steps": steps,
        "generator": generator,
    }
    if init_image is not None:
        kwargs["image"] = init_image
        kwargs["strength"] = min(0.9, max(0.1, strength))
    else:
        kwargs["width"] = width
        kwargs["height"] = height
    if negative_prompt and model_name.startswith("sdxl"):
        kwargs["negative_prompt"] = negative_prompt
    if model_name == "sdxl-turbo":
        kwargs["guidance_scale"] = 0.0

    try:
        result = _run_inference(pipe, kwargs)
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc

    image = result.images[0]
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")
