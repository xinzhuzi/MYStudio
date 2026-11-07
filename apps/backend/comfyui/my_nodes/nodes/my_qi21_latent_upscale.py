# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 二采精修潜空间放大器(MyQi21LatentUpscale)。

学习型 2x 潜空间放大:输入一采干净 latent(64 通道 Qwen Image 2.1),
输出版图 2x 的 latent——后接二采 KSampler 增细节。
模型内嵌于本件同目录(12.5MB,kinfolk0117/ComfyUI-QwenImage21-LatentUpscale,MIT)。
网络定义=原件 model.py 逐行复刻(SesquiLSR 架构)。

torch 全懒导入(1107 修):网络类收进 _build_net() 工厂——本件可在 sidecar
pytest 零引擎环境被 import(同 MyQi21FastEncode 懒导入纪律)。
注:1107 二采定谳走 Edit 修图模式(同尺寸),本节点暂离产线主路,留件备用。
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

_NET_CACHE: Any = None


def _build_net():
    """网络类工厂(源 kinfolk0117 model.py 逐行复刻,MIT;torch 懒导入)。"""
    global _NET_CACHE
    if _NET_CACHE is not None:
        return _NET_CACHE

    import torch
    from torch import nn
    from torch.nn import functional as F

    class IRLayerNorm(nn.Module):
        def __init__(self):
            super().__init__()
            self.weight = nn.Parameter(torch.ones(128))

        def forward(self, x):
            var, mean = torch.var_mean(x, dim=(1, 2, 3), unbiased=False, keepdim=True)
            std = (var + 1e-6).sqrt()
            return (x - mean) / std * self.weight.view(1, -1, 1, 1), std

    class ResidualBlock(nn.Module):
        def __init__(self, gates, bottleneck):
            super().__init__()
            self.gates = gates
            self.norm = IRLayerNorm()
            self.up = nn.Conv2d(128, gates * 9, 1, bias=False)
            self.down = nn.Conv2d(gates * 8, bottleneck, 1, bias=False)
            self.mix = nn.Conv2d(
                bottleneck, 128, 3, padding=1, padding_mode="reflect", bias=False
            )
            self.act = nn.Mish()

        def forward(self, x):
            y, std = self.norm(x)
            values, gates = self.up(y).split([self.gates * 8, self.gates], dim=1)
            b, _, h, w = values.shape
            values = self.act(values).view(b, self.gates, 8, h, w)
            y = (values * (gates * 0.5).tanh()[:, :, None]).reshape(b, -1, h, w)
            return x + self.mix(self.down(y)) * std

    class UpsampleHead(nn.Module):
        def __init__(self):
            super().__init__()
            self.ps_expand = nn.Conv2d(128, 512, 1)
            self.lift_expand = nn.Conv2d(128, 256, 1, bias=False)
            self.lift_mix = nn.Conv2d(
                64, 128, 3, padding=1, padding_mode="reflect", bias=False
            )
            self.refine = ResidualBlock(32, 128)
            self.register_buffer("filters", torch.empty(2, 2, 128, 4))
            self.register_buffer("gains", torch.empty(2))

        def forward(self, x):
            x = F.pixel_shuffle(self.ps_expand(x), 2) + self.lift_mix(
                F.pixel_shuffle(self.lift_expand(x), 2)
            )
            x = self.refine(x)
            result = torch.zeros_like(x)
            for filters, gain in zip(self.filters, self.gains):
                y = F.pad(x, (1, 2, 0, 0), mode="replicate").unfold(3, 4, 1)
                y = (y * filters[1][None, :, None, None, :]).sum(-1)
                y = F.pad(y, (0, 0, 1, 2), mode="replicate").unfold(2, 4, 1)
                y = (y * filters[0][None, :, None, None, :]).sum(-1)
                result = result + gain * y
            return result

    class LatentUpscaler(nn.Module):
        def __init__(self):
            super().__init__()
            self.head_conv = nn.Sequential(
                nn.Conv2d(64, 64, 3, padding=1, padding_mode="reflect", bias=False),
                nn.Mish(),
                nn.Conv2d(64, 128, 3, padding=1, padding_mode="reflect"),
            )
            self.in_blocks = nn.Sequential(*(ResidualBlock(24, 96) for _ in range(8)))
            self.upsample = UpsampleHead()
            self.out_blocks = nn.Sequential(*(ResidualBlock(32, 128) for _ in range(6)))
            self.tail_conv = nn.Sequential(
                nn.Conv2d(128, 64, 1, bias=False),
                nn.Mish(),
                nn.Conv2d(64, 64, 3, padding=1, padding_mode="reflect"),
            )
            self.skip_conv = nn.Conv2d(
                64, 64, 5, padding=2, padding_mode="reflect", bias=False
            )

        def forward(self, x):
            h = self.out_blocks(self.upsample(self.in_blocks(self.head_conv(x))))
            skip = F.interpolate(x, scale_factor=2, mode="bicubic", align_corners=False)
            return self.tail_conv(h) + self.skip_conv(skip)

    class Qwen21UpscalerNet(nn.Module):
        def __init__(self):
            super().__init__()
            self.register_buffer("mean", torch.empty(1, 64, 1, 1))
            self.register_buffer("std", torch.empty(1, 64, 1, 1))
            self.net = LatentUpscaler()

        def forward(self, raw):
            return self.net((raw - self.mean) / self.std) * self.std + self.mean

    _NET_CACHE = Qwen21UpscalerNet
    return _NET_CACHE


# ── 节点 ──

class MyQi21LatentUpscale:
    """漫影 二采精修潜空间 2x 放大器。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "latent": ("LATENT", {
                    "tooltip": "一采输出的干净 Qwen Image 2.1 latent(64 通道)。"
                }),
            }
        }

    RETURN_TYPES = ("LATENT",)
    FUNCTION = "upscale"
    CATEGORY = "漫影/qi21二采"
    DESCRIPTION = "学习型 2x 潜空间放大:一采干净 latent → 2x → 供二采 KSampler。"

    def upscale(self, latent):
        samples = latent["samples"]
        if samples.ndim != 4 or samples.shape[1] != 64:
            raise ValueError(
                f"[漫影·二采] 期望 Qwen 2.1 latent(4D×64ch),得 {tuple(samples.shape)}")
        if "noise_mask" in latent:
            raise ValueError("[漫影·二采] 带遮罩 latent 不支持。")

        model_path = Path(__file__).parent / "qwen21-latent-2x-v1.safetensors"
        if not model_path.is_file():
            raise FileNotFoundError(
                f"[漫影·二采] 放大器权重缺失:{model_path}")

        import torch

        from comfy import model_management, model_patcher
        from comfy import utils as comfy_utils

        network = _build_net()()
        state = comfy_utils.load_torch_file(str(model_path), safe_load=True)
        network.load_state_dict(state, strict=True)
        network.eval()

        device = model_management.get_torch_device()
        patcher = model_patcher.CoreModelPatcher(
            network, load_device=device,
            offload_device=model_management.unet_offload_device())
        model_management.load_models_gpu(
            [patcher],
            memory_required=128 * 1024 ** 2 + samples.numel() * 256,
            force_full_load=True)

        result = dict(latent)
        result["samples"] = network(
            samples.to(device=device, dtype=torch.float32)
        ).to(device=samples.device, dtype=samples.dtype)
        return (result,)


NODE_CLASS_MAPPINGS = {"MyQi21LatentUpscale": MyQi21LatentUpscale}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MyQi21LatentUpscale": "漫影 二采潜空间放大 2x [MyQi21LatentUpscale]"}
