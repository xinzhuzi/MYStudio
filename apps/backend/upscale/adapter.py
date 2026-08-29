"""Upscale adapter — pure-torch Real-ESRGAN super-resolution inference.

No cv2/basicsr/realesrgan pip dependencies: only torch + Pillow + numpy,
all provided by the shared managed Python requirements. On failure this
adapter raises typed UpscaleError — it NEVER silently falls back to plain
interpolation (the 2026-08-15 manual run showed a Lanczos fallback hides a
missing dependency and ships detail-free output).
"""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path
from typing import Any

from .model_cache import (
    DEFAULT_UPSCALE_MODEL,
    UPSCALE_MODELS,
    find_cached_upscale_model,
    primary_model_dir,
    verify_model_sha256,
)

DEFAULT_TILE = 512
DEFAULT_TILE_PAD = 10
# Reject inputs whose long side already exceeds 4K — re-upscaling a 4K result
# would produce a 16K monster (400M+ pixels) that chokes downstream renders.
MAX_INPUT_LONG_SIDE = 4096


class UpscaleError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _select_device() -> str:
    import torch

    try:
        if torch.backends.mps.is_available():
            return "mps"
    except (AttributeError, RuntimeError):
        pass
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _build_network(model_name: str):
    import torch

    from .rrdbnet import RRDBNet
    from .srvgg import SRVGGNetCompact

    spec = UPSCALE_MODELS[model_name]
    arch = dict(spec["arch"])
    kind = arch.pop("kind")
    if kind == "rrdbnet":
        return RRDBNet(**arch)
    if kind == "srvgg":
        return SRVGGNetCompact(num_in_ch=3, num_out_ch=3, **arch)
    raise UpscaleError("unknown-model", f"未知超分模型架构: {kind}")


def _load_model(model_name: str):
    import torch

    spec = UPSCALE_MODELS.get(model_name)
    if not spec:
        raise UpscaleError("unknown-model", f"未知超分模型: {model_name}")
    cached = find_cached_upscale_model(model_name)
    if not cached:
        verified, location = verify_model_sha256(model_name)
        if not verified and location not in {"model-not-downloaded", "unknown-model"}:
            raise UpscaleError("model-corrupt", f"超分模型摘要校验失败: {location}")
        raise UpscaleError(
            "model-not-downloaded",
            f"超分模型 {spec['label']} 未下载,请前往设置 > 本地配置显式下载",
        )
    try:
        state = torch.load(cached["file_path"], map_location="cpu", weights_only=True)
    except TypeError:
        # torch < 2.0 fallback for weights_only
        state = torch.load(cached["file_path"], map_location="cpu")
    except FileNotFoundError as exc:
        raise UpscaleError("model-not-downloaded", f"超分模型文件缺失: {cached['file_path']}") from exc
    except Exception as exc:
        raise UpscaleError("model-corrupt", f"超分模型权重加载失败: {exc}") from exc
    # Official Real-ESRGAN releases wrap the state dict: {"params_ema": {...}}
    # (occasionally "params"). SRVGG releases store the bare state dict.
    if isinstance(state, dict) and not any(k.endswith(".weight") or k.endswith(".bias") for k in state.keys()):
        for wrapper in ("params_ema", "params", "state_dict", "model"):
            inner = state.get(wrapper)
            if isinstance(inner, dict):
                state = inner
                break
    network = _build_network(model_name)
    try:
        network.load_state_dict(state, strict=True)
    except Exception as exc:
        raise UpscaleError("model-corrupt", f"超分模型权重与网络结构不匹配: {exc}") from exc
    network.eval()
    device = _select_device()
    network.to(device)
    return network, device, spec


def _tile_forward(network, tensor, scale: int, tile: int, tile_pad: int):
    """Tiled inference — port of Real-ESRGANer.tile_process. Keeps peak memory
    bounded so 4K outputs do not exhaust MPS/CPU on large inputs."""
    import torch

    batch, channel, height, width = tensor.shape
    output_height = height * scale
    output_width = width * scale
    # uint8 canvas on CPU keeps the accumulator small (300MB float -> 75MB for
    # a 1K->4K result); each tile is converted before being pasted back.
    output = torch.zeros(
        (batch, channel, output_height, output_width),
        dtype=torch.uint8,
    )
    tiles_x = -(-width // tile)
    tiles_y = -(-height // tile)
    for y in range(tiles_y):
        for x in range(tiles_x):
            ofs_x = x * tile
            ofs_y = y * tile
            input_start_x = ofs_x
            input_end_x = min(ofs_x + tile, width)
            input_start_y = ofs_y
            input_end_y = min(ofs_y + tile, height)

            input_start_x_pad = max(0, input_start_x - tile_pad)
            input_end_x_pad = min(width, input_end_x + tile_pad)
            input_start_y_pad = max(0, input_start_y - tile_pad)
            input_end_y_pad = min(height, input_end_y + tile_pad)

            input_tile = tensor[
                :,
                :,
                input_start_y_pad:input_end_y_pad,
                input_start_x_pad:input_end_x_pad,
            ]
            try:
                with torch.no_grad():
                    output_tile = network(input_tile)
            except Exception as exc:
                raise UpscaleError("inference-failed", f"超分推理失败: {exc}") from exc
            # Real-ESRGAN networks consume and return normalized [0, 1] RGB.
            # Convert to the PNG byte domain exactly once before assembling the
            # CPU accumulator; clamping the float tensor directly would turn
            # every normal pixel into 0 or 1.
            output_tile = output_tile.detach().mul(255.0).clamp_(0, 255).round_().to(torch.uint8).cpu()

            output_start_x = input_start_x * scale
            output_end_x = input_end_x * scale
            output_start_y = input_start_y * scale
            output_end_y = input_end_y * scale
            tile_start_x = (input_start_x - input_start_x_pad) * scale
            tile_end_x = input_end_x * scale - input_start_x_pad * scale
            tile_start_y = (input_start_y - input_start_y_pad) * scale
            tile_end_y = input_end_y * scale - input_start_y_pad * scale

            output[
                :,
                :,
                output_start_y:output_end_y,
                output_start_x:output_end_x,
            ] = output_tile[
                :,
                :,
                tile_start_y:tile_end_y,
                tile_start_x:tile_end_x,
            ]
    return output


def _validate_output_quality(input_rgb, output_rgb, input_alpha, scale: int) -> None:
    """Reject a collapsed near-black result when the visible input carries signal.

    This is intentionally conservative: fully transparent or intentionally dark
    sources are allowed, while a bright/normal input whose mean, upper
    percentile, and dynamic range all collapse to black is never accepted.
    """
    import numpy as np

    def luminance(rgb):
        values = rgb.astype(np.float32)
        return values[..., 0] * 0.2126 + values[..., 1] * 0.7152 + values[..., 2] * 0.0722

    input_values = luminance(input_rgb)
    if input_alpha is not None:
        visible = input_alpha > 0
        if not np.any(visible):
            return
        input_values = input_values[visible]
        output_visible = np.repeat(np.repeat(visible, scale, axis=0), scale, axis=1)
        output_values = luminance(output_rgb)[output_visible]
    else:
        input_values = input_values.reshape(-1)
        output_values = luminance(output_rgb).reshape(-1)

    input_mean = float(np.mean(input_values))
    input_p95 = float(np.percentile(input_values, 95))
    input_p05 = float(np.percentile(input_values, 5))
    output_mean = float(np.mean(output_values))
    output_p95 = float(np.percentile(output_values, 95))
    output_p05 = float(np.percentile(output_values, 5))
    input_range = input_p95 - input_p05
    output_range = output_p95 - output_p05

    input_has_signal = input_mean >= 8.0 or input_p95 >= 16.0
    output_collapsed = output_mean <= 2.0 and output_p95 <= 4.0 and output_range <= max(4.0, input_range * 0.05)
    if input_has_signal and output_collapsed:
        raise UpscaleError(
            "output-quality-failed",
            "超分输出亮度和动态范围异常收缩为近黑图，已拒绝写入结果",
        )


# 4K 档位表(镜像前端 image-size-presets IMAGE_RESOLUTIONS 4K 行;
# 超分收尾校准用——输出恒定落档,生图渠道的源尺寸浮动不再放大传播)
_UPSCALE_SNAP_4K = (
    (3840, 2160),  # 16:9
    (2160, 3840),  # 9:16
    (2880, 2880),  # 1:1
    (3264, 2448),  # 4:3
    (2448, 3264),  # 3:4
    (3520, 2352),  # 3:2
    (2352, 3520),  # 2:3
    (3840, 1648),  # 21:9
    (1648, 3840),  # 9:21
)


def _snap_target_4k(width: int, height: int) -> tuple[int, int] | None:
    """按输出宽高比选最近 4K 档位;偏差>5% 视为非常规画幅不校准(保真)。"""
    ratio = width / height
    best = min(_UPSCALE_SNAP_4K, key=lambda t: abs(t[0] / t[1] - ratio))
    if abs(best[0] / best[1] - ratio) / ratio > 0.05:
        return None
    return best



def _lowfreq_denoise(rgb: "Image.Image", strength: float = 12.0, keep: float = 0.3) -> "Image.Image":
    """双边滤波低频+高频软阈值保线稿(轻度去噪档)。

    与 apps/build/scripts/image_lowfreq_denoise.py 同源(噪点治理 08-29);
    只在超分前做预处理,gpt-image 斑驳噪点先压掉再放大。
    """
    import numpy as np
    from PIL import Image

    def bilateral(a: "np.ndarray", radius: int = 4, sigma_s: float = 4.0, sigma_r: float = 25.0) -> "np.ndarray":
        out = np.zeros_like(a)
        wsum = np.zeros(a.shape[:2] + (1,), dtype=np.float32)
        gs = np.exp(-(np.arange(-radius, radius + 1) ** 2) / (2 * sigma_s**2))
        for di in range(-radius, radius + 1):
            for dj in range(-radius, radius + 1):
                sh = np.roll(np.roll(a, di, axis=0), dj, axis=1)
                dr = np.linalg.norm(sh - a, axis=2, keepdims=True)
                wgt = gs[abs(di)] * gs[abs(dj)] * np.exp(-(dr**2) / (2 * sigma_r**2))
                out += sh * wgt
                wsum += wgt
        return out / wsum

    a = np.asarray(rgb, dtype=np.float32)
    low = bilateral(a)
    high = a - low
    mag = np.abs(high).max(axis=2, keepdims=True)
    gain = keep + (1.0 - keep) * np.clip(mag / max(strength, 1e-3), 0.0, 1.0)
    out = low + high * gain
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def upscale_image(
    input_path: str,
    output_path: str,
    model: str = DEFAULT_UPSCALE_MODEL,
    *,
    tile: int = DEFAULT_TILE,
    tile_pad: int = DEFAULT_TILE_PAD,
    snap_4k: bool = False,
    denoise: bool = False,
) -> dict[str, Any]:
    """Super-resolve one image. Returns the artifact field dict.

    denoise=True 时在超分前先做轻度高低频去噪(保线稿双边滤波)。"""

    started = time.time()
    source = Path(input_path)
    if not source.is_file():
        raise UpscaleError("input-not-found", f"输入图片不存在: {input_path}")
    try:
        import torch
    except ImportError as exc:
        raise UpscaleError("torch-missing", f"PyTorch 未安装: {exc}") from exc
    try:
        from PIL import Image
    except ImportError as exc:
        raise UpscaleError("pillow-missing", f"Pillow 未安装: {exc}") from exc

    network, device, spec = _load_model(model)
    scale = spec["scale"]

    input_sha = _sha256(source)
    try:
        with Image.open(source) as handle:
            handle.load()
            has_alpha = handle.mode in ("RGBA", "LA", "PA") or (
                handle.mode == "P" and "transparency" in handle.info
            )
            base = handle.convert("RGBA") if has_alpha else handle.convert("RGB")
            alpha = base.getchannel("A") if has_alpha else None
            rgb = base.convert("RGB")
    except Exception as exc:
        raise UpscaleError("image-load-failed", f"无法读取图片: {exc}") from exc
    if denoise:
        rgb = _lowfreq_denoise(rgb)

    import numpy as np

    array = np.asarray(rgb, dtype=np.uint8)
    height, width = array.shape[:2]
    if max(width, height) > MAX_INPUT_LONG_SIDE:
        raise UpscaleError(
            "input-too-large",
            f"输入图片 {width}×{height} 已达到或超过 4K，无需再超分（上限 {MAX_INPUT_LONG_SIDE}px 长边）",
        )
    tensor = torch.from_numpy(array.astype(np.float32) / 255.0)
    tensor = tensor.permute(2, 0, 1).unsqueeze(0).to(device)

    output = _tile_forward(network, tensor, scale, tile, tile_pad)
    result = output.squeeze(0).permute(1, 2, 0).numpy()
    input_alpha = np.asarray(alpha, dtype=np.uint8) if alpha is not None else None
    _validate_output_quality(array, result, input_alpha, scale)

    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(f"{destination.name}.{os.getpid()}.tmp")
    try:
        output_image = Image.fromarray(result, mode="RGB")
        if snap_4k:
            # 档位校准:超分(x4 实际增益)完成后,把输出精确收到画幅最近的 4K 档
            # (LANCZOS 仅做 ≤%个位数的收尾缩放,不是"纯缩放冒充超分"的禁令场景
            # ——x4 上采样真实发生,这里只消灭渠道源尺寸的浮动)。非常规画幅不收。
            target = _snap_target_4k(output_image.size[0], output_image.size[1])
            if target and (target[0], target[1]) != output_image.size:
                output_image = output_image.resize(target, Image.Resampling.LANCZOS)
                # 证据语义=实际有效放大倍率(收口后 output/输入),旧公式
                # scale*output/width 把模型倍率又乘一遍(1672→3840 算出 9.19);
                # 控制器按输入输出实测尺寸核对,此处必须报真实比值
                scale = round(output_image.size[0] / width, 2)
                result = None  # noqa: F841 — result 不再落盘,尺寸以校准后为准
        if alpha is not None:
            output_alpha = alpha.resize(output_image.size, Image.Resampling.NEAREST)
            output_image.putalpha(output_alpha)
        output_image.save(temporary, format="PNG", optimize=True)
        temporary.replace(destination)
    except Exception as exc:
        if temporary.exists():
            temporary.unlink()
        raise UpscaleError("output-write-failed", f"无法写入超分结果: {exc}") from exc

    return {
        "inputSha256": input_sha,
        "outputSha256": _sha256(destination),
        "outputPath": str(destination.resolve()),
        "width": output_image.size[0],
        "height": output_image.size[1],
        "scale": scale,
        "outputBytes": destination.stat().st_size,
        "elapsedSeconds": round(time.time() - started, 2),
    }


def probe_model(model: str = DEFAULT_UPSCALE_MODEL) -> dict[str, Any]:
    """Probe runtime dependency + model availability for the settings panel."""
    spec = UPSCALE_MODELS.get(model)
    if not spec:
        return {"status": "blocked", "code": "unknown-model", "message": f"未知超分模型: {model}"}
    try:
        import torch  # noqa: F401
    except ImportError:
        return {
            "status": "blocked",
            "code": "torch-missing",
            "message": "PyTorch 未安装,请先在设置中安装共享 Python 运行时依赖",
        }
    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        return {
            "status": "blocked",
            "code": "pillow-missing",
            "message": "Pillow 未安装,请先在设置中安装共享 Python 运行时依赖",
        }
    cached = find_cached_upscale_model(model)
    if not cached:
        verified, location = verify_model_sha256(model)
        if not verified and location not in {"model-not-downloaded", "unknown-model"}:
            return {
                "status": "blocked",
                "code": "model-corrupt",
                "message": f"超分模型摘要校验失败: {location}",
                "cacheDir": str(primary_model_dir()),
            }
        return {
            "status": "blocked",
            "code": "model-not-downloaded",
            "message": f"超分模型 {spec['label']} 未下载",
            "cacheDir": str(primary_model_dir()),
        }
    return {
        "status": "ready",
        "model": model,
        "modelFile": cached["file_path"],
        "sizeMb": cached["size_mb"],
        "cacheDir": str(primary_model_dir()),
    }
