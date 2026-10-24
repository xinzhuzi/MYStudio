"""Diffusion pipeline — thin dispatcher(08-31 重构:每引擎独立模块)。

本文件只做:① PipelineError ② generate_image 统一入口(按 layout 分派
到 engines/<name>.py 的 generate)。引擎自身装配/生成/LoRA 全在 engines/。
blank-gate-1024:generate_image 追加空片门禁+判废重掷(§3.1)——b64 过
output_gate.evaluate_output,判废走「/free→换 seed 重掷一次→仍废报错」,
两发共享同一 wall-clock 预算;新错误码 bridge-blank-output/engine-degraded
在此抛出(server 映射 502/503,前端零改动)。
"""
from __future__ import annotations

import base64
import io
import math
import os
import random
import threading
import time
from pathlib import Path
from typing import Any

from engines.image_engine import model_cache as _model_cache
from engines.image_engine.model_cache import (
    IMAGE_MODELS,
    comfyui_models_dir,
    z_image_comfyui_models_dir,
    hf_snapshot_dir,
    resolve_image_model_name,
    find_cached_image_model_for_spec,
)
from engines.image_engine import krea2 as _krea2
from engines.image_engine import flux2 as _flux2
from engines.image_engine import z_image as _z_image
from engines.image_engine import qwen as _qwen
from engines.image_engine import comfyui_bridge as _comfyui_bridge
from engines.image_engine import qwen21 as _qwen21

_lock = threading.Lock()
# 生成互斥的排队上限(秒):拿不到锁时排队等待,超时按「正忙」拒绝
_GENERATION_LOCK_TIMEOUT_S = 600
# 服务端真取消(09-02):用户点「停止」→渲染层对 sidecar 发 /v1/images/cancel
# →置位本事件→引擎逐步回调检测到即中止,生成锁立即释放(此前 IPC 不可中途
# 取消,停止后已开跑的图要空转 2-3 分钟,期间再点生成只能排队)。每次新
# 生成在持锁后清位。
_CANCEL_EVENT = threading.Event()


def cancel_generation() -> None:
    """请求中止当前在途生成(幂等;无在途生成时无副作用)。"""
    _CANCEL_EVENT.set()


def is_generation_cancelled() -> bool:
    return _CANCEL_EVENT.is_set()

# Compatibility state for the pre-engine-separation worker API.  The Qwen
# engine cache remains the single source of truth; exposing the same mapping
# lets existing callers clear/reuse it without duplicating loaded weights.
_pipelines = _qwen._cache
_img2img_pipelines: dict[str, Any] = {}

ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1": (1024, 1024), "16:9": (1152, 640), "9:16": (640, 1152),
    "4:3": (1072, 808), "3:4": (808, 1072),
}
RESOLUTION_SCALES: dict[str, float] = {"512": 0.5, "768": 0.75, "1024": 1.0, "2048": 1.5}


class PipelineError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


_ENGINE_BY_LAYOUT = {
    "krea2-pointed": _krea2,
    "flux2-pointed": _flux2,
    "z-image-pointed": _z_image,
    "qwen-pointed": _qwen,
    "comfyui-bridge": _comfyui_bridge,
    "qwen21-viggle": _qwen21,
}

# 桥布局驱动(comfyui_bridge/qwen21 经同一引擎执行):空片重掷前的 /free 与
# 退化防线只对它们生效(判据 spec.layout,方案 §3.1)
_BRIDGE_LAYOUTS = ("comfyui-bridge", "qwen21-viggle")

# 空片/退化错误文案(§5):重掷字样按「实际是否掷过」+MYSTUDIO_COMFYUI_BLANK_RETRY
# 现值选择——禁止把重掷字样写死在单一常量(第 2 轮 L5:开关关时是假话)
_BLANK_COPY_WITH_RETRY = "生成结果疑似空白(引擎长时间运行后可能出现),已自动重掷一次仍未改善。请到 设置 → 本地配置 → ComfyUI 图像引擎 重启引擎后再试。"
_BLANK_COPY_NO_RETRY = "生成结果疑似空白(引擎长时间运行后可能出现)。请到 设置 → 本地配置 → ComfyUI 图像引擎 重启引擎后再试。"
_ENGINE_DEGRADED_COPY = "检测到 ComfyUI 引擎性能明显退化(长时间运行的内存碎片堆积)。请重启引擎(设置 → 本地配置 → ComfyUI 图像引擎)后再试。"


def _env_enabled(name: str, default: bool = True) -> bool:
    """robust 布尔开关(照 MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S 解析先例,非法值回落默认)。"""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _blank_output_error(*, retried: bool) -> PipelineError:
    # 文案选择=「开关开 且 真掷过」才带重掷字样(预算耗尽/开关关都不掷=不说掷过)
    message = _BLANK_COPY_WITH_RETRY if (retried and _env_enabled("MYSTUDIO_COMFYUI_BLANK_RETRY")) else _BLANK_COPY_NO_RETRY
    return PipelineError("bridge-blank-output", message)


def _shared_budget_deadline() -> float:
    """两发共享的 wall-clock 预算起点(=MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S,robust 解析)。"""
    try:
        budget_s = float(os.environ.get("MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S", "600"))
    except (TypeError, ValueError, OverflowError):
        budget_s = 600.0
    if not math.isfinite(budget_s) or budget_s <= 0:
        budget_s = 600.0
    return time.monotonic() + budget_s


def convert_qwen25_vl_state_dict_key(key: str) -> str:
    """Map ComfyUI Qwen-VL keys to the transformers module namespace."""
    if key.startswith("visual."):
        return "model." + key
    if key.startswith("model.layers."):
        return "model.language_model." + key[len("model."):]
    if key.startswith("model.embed_tokens."):
        return "model.language_model." + key[len("model."):]
    if key.startswith("model.norm."):
        return "model.language_model." + key[len("model."):]
    return key


def _get_qwen_pipeline(model_name: str = _qwen.MODEL_NAME):
    """Build or return the legacy Qwen pipeline facade.

    New production calls dispatch directly to ``engines.qwen.generate``;
    this facade intentionally keeps the old worker/test seam available while
    sharing the separated module's cache and path resolvers.
    """
    model_name = resolve_image_model_name(model_name)
    if model_name in _pipelines:
        return _pipelines[model_name]
    if model_name != _qwen.MODEL_NAME:
        raise PipelineError("unknown-model", f"未知图像模型: {model_name}")

    cache_dir = _model_cache.primary_hf_cache_dir()
    resolved = _qwen.resolve_big_files(
        comfyui_models_dir(), _model_cache.hf_snapshot_dir, cache_dir
    )
    if not resolved:
        raise PipelineError("model-not-downloaded", "Qwen 大件未就绪")
    small = _qwen.small_pieces_status(_model_cache.hf_snapshot_dir, cache_dir)
    if not small["ready"]:
        raise PipelineError(
            "small-pieces-missing",
            f"{_qwen.SPEC['label']} 小件未补齐: {', '.join(small['missing'])}",
        )

    import torch
    from diffusers import (
        AutoencoderKLQwenImage,
        FlowMatchEulerDiscreteScheduler,
        QwenImageEditPlusPipeline,
        QwenImageTransformer2DModel,
    )
    from transformers import AutoProcessor, AutoTokenizer, Qwen2_5_VLConfig, Qwen2_5_VLForConditionalGeneration
    from safetensors.torch import load_file

    snapshot_dirs = small.get("snapshot_dirs", {})
    image_snapshot = Path(snapshot_dirs.get(_qwen.IMAGE_REPO) or "")
    vl_snapshot = Path(snapshot_dirs.get(_qwen.VL_REPO) or "")
    config_dir = image_snapshot / "transformer"
    try:
        from diffusers.quantizers.quantization_config import GGUFQuantizationConfig
    except ImportError:
        from diffusers.quantizers.gguf import GGUFQuantizationConfig

    transformer = QwenImageTransformer2DModel.from_single_file(
        str(resolved["main"]), config=str(config_dir),
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        torch_dtype=torch.bfloat16,
    )
    vae = AutoencoderKLQwenImage.from_pretrained(
        image_snapshot, subfolder="vae", torch_dtype=torch.bfloat16
    )
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(image_snapshot, subfolder="scheduler")
    tokenizer = AutoTokenizer.from_pretrained(vl_snapshot)
    processor = AutoProcessor.from_pretrained(vl_snapshot)
    config = Qwen2_5_VLConfig.from_json_file(str(vl_snapshot / "config.json"))
    text_encoder = Qwen2_5_VLForConditionalGeneration(config)
    state = load_file(str(resolved["text_encoder"]))
    remapped = {convert_qwen25_vl_state_dict_key(key): value for key, value in state.items()}
    text_encoder.load_state_dict(remapped, strict=False)
    if hasattr(text_encoder, "eval"):
        text_encoder.eval()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    pipe = QwenImageEditPlusPipeline(
        transformer=transformer, vae=vae, text_encoder=text_encoder,
        tokenizer=tokenizer, scheduler=scheduler, processor=processor,
    ).to(device)
    _pipelines[model_name] = pipe
    return pipe


def _get_pipeline(model_name: str):
    """Legacy generic pipeline seam used by the image worker."""
    return _get_qwen_pipeline(resolve_image_model_name(model_name))


def _get_img2img_pipeline(model_name: str):
    """Create an img2img pipeline without re-entering the load lock."""
    model_name = resolve_image_model_name(model_name)
    cached = _img2img_pipelines.get(model_name)
    if cached is not None:
        return cached
    try:
        from diffusers import AutoPipelineForImage2Image
    except ImportError as exc:
        raise PipelineError("dependency-missing", "缺少 diffusers 图生图管线") from exc
    base = _get_pipeline(model_name)
    image_pipeline = AutoPipelineForImage2Image.from_pipe(base)
    _img2img_pipelines[model_name] = image_pipeline
    return image_pipeline


def _generate_qwen(
    prompt: str,
    aspect_ratio: str,
    negative_prompt: str | None,
    steps: int,
    seed: int | None,
    reference_image_b64: str | None,
) -> str:
    """Legacy Qwen generation seam retained for worker compatibility/tests."""
    if not _lock.acquire(blocking=False):
        raise PipelineError("generation-busy", "图像生成正忙，请稍后重试")
    try:
        from PIL import Image

        pipe = _get_qwen_pipeline(_qwen.MODEL_NAME)
        width, height = _qwen.QWEN_ASPECT_RATIOS.get(
            aspect_ratio, _qwen.QWEN_ASPECT_RATIOS["1:1"]
        )
        if reference_image_b64:
            raw = reference_image_b64.split(",", 1)[-1] if reference_image_b64.startswith("data:") else reference_image_b64
            image = Image.open(io.BytesIO(base64.b64decode(raw))).convert("RGB").resize((width, height))
        else:
            image = Image.new("RGB", (width, height), "white")
        kwargs: dict[str, Any] = {
            "image": [image], "prompt": prompt, "num_inference_steps": steps,
        }
        if seed is not None:
            import torch
            kwargs["generator"] = torch.Generator("cpu").manual_seed(seed)
        if negative_prompt:
            kwargs["negative_prompt"] = negative_prompt
            kwargs["true_cfg_scale"] = 4.0
        result = pipe(**kwargs)
        output = io.BytesIO()
        result.images[0].save(output, format="PNG")
        return base64.b64encode(output.getvalue()).decode("ascii")
    finally:
        _lock.release()


def _require_downloaded(model_name: str) -> None:
    spec = IMAGE_MODELS.get(model_name)
    if not spec:
        raise PipelineError("unknown-model", f"未知图像模型: {model_name}")
    cached = find_cached_image_model_for_spec(spec)
    if not cached and spec.get("layout") == "comfyui-bridge":
        # 桥的"大件"是引擎服务本身:探不到先试着拉起(自管引擎装了没跑→起),
        # 起来后复探——不能在这里秒拒,否则桥 generate 里的 ensure 补口永远
        # 轮不到(09-11 实弹:漫影生图引擎停着时 1ms 假报"没在运行")
        from comfyui import engine_manager as _em
        try:
            _em.engine_manager().ensure_engine_ready()
        except _em.EngineOpError:
            pass
        cached = find_cached_image_model_for_spec(spec)
    if not cached:
        # 桥的"大件"就是服务本身:不可达时给桥专属话术(server 映射 503),
        # 别让用户按通用文案去设置页找不存在的下载按钮
        if spec.get("layout") == "comfyui-bridge":
            raise PipelineError("bridge-unreachable", "ComfyUI 没在运行，请先打开 ComfyUI 再试")
        raise PipelineError(
            "model-not-downloaded",
            f"图像模型 {spec['label']} 未就绪。请前往 设置 → 本地配置 → 本地图片生成 检查。",
        )

    # Big files alone are not enough for the native pointed engines: the
    # diffusers config/tokenizer/VAE pieces are loaded at generation time.
    # Keep this gate in the shared dispatcher so every engine fails closed
    # with a stable, actionable error instead of surfacing an import or
    # from_pretrained traceback after a request has already started.
    layout = spec.get("layout", "")
    if layout == "comfyui-bridge":
        return
    engine = _ENGINE_BY_LAYOUT.get(layout)
    if engine is None or not hasattr(engine, "small_pieces_status"):
        return
    cache_dir = _model_cache.primary_hf_cache_dir()
    small = engine.small_pieces_status(_model_cache.hf_snapshot_dir, cache_dir)
    if not small.get("ready"):
        missing = ", ".join(str(item) for item in small.get("missing", []))
        raise PipelineError(
            "small-pieces-missing",
            f"{spec['label']} 小件未补齐: {missing}",
        )


def generate_image(
    model_name: str,
    prompt: str,
    aspect_ratio: str = "1:1",
    resolution: str = "1024",
    negative_prompt: str | None = None,
    num_inference_steps: int | None = None,
    seed: int | None = None,
    reference_image_b64: str | None = None,
    reference_images_b64: list[str] | None = None,
    strength: float = 0.6,
    use_lora: bool = False,
    template: str | None = None,
    base_type: str | None = None,
    checkpoint: str | None = None,
    loras: "list[dict] | None" = None,
) -> str:
    """Generate an image and return it as base64 PNG."""
    model_name = resolve_image_model_name(model_name)
    spec = IMAGE_MODELS[model_name]
    layout = spec.get("layout", "")

    engine = _ENGINE_BY_LAYOUT.get(layout)
    if engine is None:
        raise PipelineError("unknown-model", f"未知布局: {layout}")

    # 能力门禁先于就绪检查:带参考图打到不支持的引擎,立刻得到可操作的指路
    references = reference_images_b64 if reference_images_b64 is not None else (
        [reference_image_b64] if reference_image_b64 else []
    )
    if references and not getattr(engine, "SUPPORTS_REFERENCE", True):
        raise PipelineError(
            "reference-unsupported",
            f"{spec['label']} 暂不支持参考图。请切换 FLUX.2 Klein / Qwen-Image-Edit 或云端引擎。",
        )
    if len(references) > 1 and not getattr(engine, "SUPPORTS_MULTI_REFERENCE", False):
        raise PipelineError(
            "reference-unsupported",
            f"{spec['label']} 暂不支持多张参考图。请切换 ComfyUI 桥接或云端引擎。",
        )

    _require_downloaded(model_name)

    steps = num_inference_steps or spec["steps"]

    # 构建引擎上下文(各引擎从 ctx 取自己需要的路径)
    models_dir = (
        z_image_comfyui_models_dir()
        if layout == "z-image-pointed"
        else comfyui_models_dir()
    )
    small_repo = getattr(engine, "SMALL_REPO", getattr(engine, "IMAGE_REPO", None))
    snapshot_dir = hf_snapshot_dir(small_repo) if small_repo else None
    ctx = {
        "models_dir": models_dir,
        "snapshot_dir": snapshot_dir,
    }
    if reference_images_b64 is not None:
        ctx["reference_images_b64"] = references
    if template is not None:
        # ComfyUI 桥模板点名(09-05 无衣物·指令编辑节点)
        ctx["template"] = template
    if base_type is not None:
        # qwen21 道劫装配子图型选择(1010:型随调用方,缺省=画布现值)
        ctx["base_type"] = base_type
    if checkpoint is not None:
        # 09-11 漫影专属生图:主模型文件名注入(manying_t2i 的 model_file 绑定)
        ctx["checkpoint"] = checkpoint
    if loras is not None:
        # LoRA 显式四槽透传(09-07 渲染层缺口收口):面板/节点改强度此前断在
        # pipeline 层(引擎签名早有 loras 但无人传);仅 Krea2 消费,其余引擎
        # 经 **ctx 吸收忽略
        ctx["loras"] = loras
    if layout == "qwen-pointed":
        ctx["qwen_snapshot_dirs"] = {
            "Qwen/Qwen-Image": str(hf_snapshot_dir("Qwen/Qwen-Image") or ""),
            "Qwen/Qwen2.5-VL-7B-Instruct": str(hf_snapshot_dir("Qwen/Qwen2.5-VL-7B-Instruct") or ""),
        }

    # 09-01 稳定性浸泡实锤:引擎组件(scheduler/管线)是进程级共享可变状态,
    # 并发 generate 会互踩(实测双 500 index out of bounds)。08-31 引擎拆分时
    # 旧 _generate_qwen 的互斥没搬进新分发器——此处补回:队列式互斥,短暂争用
    # 排队等待(画布多节点连点体验=依次完成),600s 仍拿不到锁才报正忙。
    if not _lock.acquire(timeout=_GENERATION_LOCK_TIMEOUT_S):
        raise PipelineError("generation-busy", "图像生成正忙，请稍后重试")
    _CANCEL_EVENT.clear()
    try:
        # 空片门禁+判废重掷(blank-gate-1024 §3.1):首发原样调用(行为零变化),
        # 产物过门禁;两发共享同一 wall-clock 预算(留 30s 地板,预算尽不掷直接报错)
        from engines.image_engine import output_gate

        call = dict(
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            negative_prompt=negative_prompt,
            steps=steps,
            seed=seed,
            reference_b64=reference_image_b64,
            strength=strength,
            use_lora=use_lora,
            **ctx,
        )

        def _attempt(seed_value: Any) -> str:
            call["seed"] = seed_value
            try:
                return engine.generate(**call)
            except PipelineError:
                raise
            except Exception as exc:
                raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc

        def _gate(b64: str):
            """返回 GateMetrics(放行)/GateRejected(判废)/None(fail-open);门禁自身异常=放行。"""
            try:
                return output_gate.evaluate_output(base64.b64decode(b64))
            except output_gate.GateRejected:
                raise
            except Exception as exc:  # noqa: BLE001 — 检查器故障不得打断生图主链
                print(f"[image-sidecar] pipeline: 空片门禁自身异常({exc}),fail-open 放行", flush=True)
                return None

        deadline = _shared_budget_deadline()
        first = _attempt(seed)
        try:
            _gate(first)
            return first
        except output_gate.GateRejected as rejection:
            if not _env_enabled("MYSTUDIO_COMFYUI_BLANK_RETRY"):
                raise _blank_output_error(retried=False) from rejection
            if is_generation_cancelled():
                raise PipelineError("generation-cancelled", "已停止") from rejection
            if time.monotonic() >= deadline - 30:
                print("[image-sidecar] pipeline: 空片判废但共享预算已尽,不再重掷", flush=True)
                raise _blank_output_error(retried=False) from rejection
            if _env_enabled("MYSTUDIO_COMFYUI_FREE_ON_BLANK") and layout in _BRIDGE_LAYOUTS:
                # 重掷前先 POST /free(§4.2-1):短超时吞错,恒不阻塞主链
                from engines.image_engine import engine_health

                engine_health.free_memory(_comfyui_bridge.bridge_url())
            # seed 策略(§3.2):None→显式随机(t2i 模板 seed=None 会逐字节复播废片);
            # 固定 seed=复现契约,原样保留(重掷前已 /free)
            second_seed = random.randint(1, 2**31 - 1) if seed is None else seed
            second = _attempt(second_seed)
            try:
                second_metrics = _gate(second)
            except output_gate.GateRejected as second_rejection:
                # 步时信号已独立确认退化时优先 engine-degraded(§8.2 单向联动)
                from engines.image_engine import engine_health

                if engine_health.degradation_confirmed():
                    raise PipelineError("engine-degraded", _ENGINE_DEGRADED_COPY) from second_rejection
                raise _blank_output_error(retried=True) from second_rejection
            print(
                f"[image-sidecar] pipeline: 空片判废重掷后改善(首发 {rejection.metrics.domain}"
                f"/fg={rejection.metrics.fg_ratio:.4f}/azr={rejection.metrics.alpha_zero_ratio:.4f}"
                f"→次发 {second_metrics.domain if second_metrics else 'fail-open'})",
                flush=True,
            )
            return second
    except PipelineError:
        raise
    except Exception as exc:
        raise PipelineError("inference-failed", f"图像生成失败: {exc}") from exc
    finally:
        _lock.release()
