"""Pure-torch SRVGGNetCompact (v3 modular) — lightweight compact VGG-style
super-resolution network used by realesr-general-x4v3 / realesr-animevideov3
weights.

Ported from xinntao/Real-ESRGAN (BSD-3-Clause) without basicsr. The v3
checkpoints keep every layer inside `body`; the final conv emits
num_out_ch * scale^2 channels and the network ends with pixel_shuffle
(verified against the released weight key/shape layout: general-x4v3 has
num_conv=32 → body.66 as tail, animevideov3 has num_conv=16 → body.34).
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn


class SRVGGNetCompact(nn.Module):
    """Compact VGG-style super-resolution network (v3 modular layout)."""

    def __init__(
        self,
        num_in_ch: int = 3,
        num_out_ch: int = 3,
        num_feat: int = 64,
        num_conv: int = 32,
        upscale: int = 4,
    ) -> None:
        super().__init__()
        self.num_in_ch = num_in_ch
        self.num_out_ch = num_out_ch
        self.num_feat = num_feat
        self.num_conv = num_conv
        self.upscale = upscale

        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = x
        for layer in self.body:
            out = layer(out)
        out = F.pixel_shuffle(out, self.upscale)
        return out
