# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""Qwen21Upscaler 网络(学习型 2x 潜空间放大器)。

来源:kinfolk0117/ComfyUI-QwenImage21-LatentUpscale(model.py,MIT);
适配自 LoganBooker/SesquiLSR 论文 "One Small Step in Latent, One Giant Leap for Pixels"。

纯卷积轻量网(12.5MB),零外部依赖(torch 内建层)。
"""
from __future__ import annotations

import torch
import torch.nn as nn


class ResidualBlock(nn.Module):
    def __init__(self, channels: int):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.conv2(torch.nn.functional.silu(self.conv1(x)))


class Qwen21Upscaler(nn.Module):
    """Qwen Image 2.1 latent 2x 放大器(64ch in → 64ch out,H/W ×2)。"""

    def __init__(self):
        super().__init__()
        ch = 64
        self.entry = nn.Conv2d(ch, 128, 3, padding=1)
        self.res_blocks = nn.ModuleList([ResidualBlock(128) for _ in range(8)])
        self.upsample = nn.ConvTranspose2d(128, 128, 4, stride=2, padding=1)
        self.exit = nn.Conv2d(128, ch, 3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.entry(x)
        for block in self.res_blocks:
            h = block(h)
        h = torch.nn.functional.silu(self.upsample(h))
        return self.exit(h)
