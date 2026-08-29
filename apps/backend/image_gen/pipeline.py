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
    QWEN_IMAGE_EDIT_MODEL,
    QWEN_IMAGE_REPO,
    QWEN_VL_REPO,
    find_cached_image_model_for_spec,
    qwen_pointed_big_files,
    qwen_small_pieces_status,
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
                "text_encoders/qwen_2.5_vl_7b.safetensors。",
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

        main_file, text_encoder_file = qwen_pointed_big_files()
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
