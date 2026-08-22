"""DOVER-Mobile 推理架构与双视图预处理。

溯源:
  - 仓库：VQAssessment/DOVER (https://github.com/VQAssessment/DOVER)
  - commit: f1ddc96215bc (2024-08-12 master)
  - 许可：S-Lab License 1.0；完整条款随包位于 DOVER_LICENSE.txt
功能:
  - load_model(weight_path: str) -> DOVERMobileWrapper
  - score_frames(model, video_path, start_s=None, duration_s=None)
依赖:
  - torch、numpy、系统 ffmpeg/ffprobe；不要求 decord/torchvision
注意:
  - 权重文件需为 VQAssessment/DOVER repo 的 pre-trained weight（如 DOVER-Mobile.pth）
  - 运行时 lazy import(probe 路径零重依赖)
"""

from __future__ import annotations

import json
import math
import os
import subprocess
from pathlib import Path
from typing import Iterator

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# ===========================================================================
# LICENSE NOTICE
# ===========================================================================
# This module is derived from VQAssessment/DOVER repository under S-Lab License 1.0.
# Full license text is shipped beside this module in DOVER_LICENSE.txt.
# Redistribution and use for non-commercial purpose are permitted with proper attribution.

# ===========================================================================
# DROPPATH (from timm.models.layers.drop_block, vendored fallback)
# ===========================================================================
class DropPath(nn.Module):
    """DropPath (Stochastic Depth per Random Masking paper)"""
    def __init__(self, drop_prob: float = 0.) -> None:
        super().__init__()
        self.drop_prob = drop_prob

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.drop_prob == 0. or not self.training:
            return x
        keep_prob = 1 - self.drop_prob
        shape = (x.shape[0],) + (1,) * (x.ndim - 1)
        random_tensor = keep_prob + torch.rand(shape, dtype=x.dtype, device=x.device)
        random_tensor.floor_()
        return x.div(keep_prob) * random_tensor


# ===========================================================================
# LAYER NORM (exact vendor from conv_backbone.py line 124)
# ===========================================================================
class LayerNorm(nn.Module):
    r""" LayerNorm that supports two data formats: channels_last (default) or channels_first 
    The ordering of the dimensions in the inputs. channels_last corresponds to inputs with 
    shape (batch_size, height, width, channels) while channels_first corresponds to inputs 
    with shape (batch_size, channels, height, width).
    """
    def __init__(self, normalized_shape, eps=1e-6, data_format="channels_last"):
        super().__init__()
        self.weight = nn.Parameter(torch.ones(normalized_shape))
        self.bias = nn.Parameter(torch.zeros(normalized_shape))
        self.eps = eps
        self.data_format = data_format
        if self.data_format not in ["channels_last", "channels_first"]:
            raise NotImplementedError 
        self.normalized_shape = (normalized_shape,) if isinstance(normalized_shape, int) else tuple(normalized_shape)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.data_format == "channels_last":
            return F.layer_norm(x, self.normalized_shape, self.weight, self.bias, self.eps)
        elif self.data_format == "channels_first":
            u = x.mean(1, keepdim=True)
            s = (x - u).pow(2).mean(1, keepdim=True)
            x = (x - u) / torch.sqrt(s + self.eps)
            if len(x.shape) == 4:
                x = self.weight[:, None, None] * x + self.bias[:, None, None]
            elif len(x.shape) == 5:
                x = self.weight[:, None, None, None] * x + self.bias[:, None, None, None]
            return x


# ===========================================================================
# GRN (exact vendor from conv_backbone.py line 8)
# ===========================================================================
class GRN(nn.Module):
    """ GRN (Global Response Normalization) layer - exact vendor from conv_backbone.py line 8 """
    def __init__(self, dim: int) -> None:
        super().__init__()
        self.gamma = nn.Parameter(torch.zeros(1, 1, 1, dim))
        self.beta = nn.Parameter(torch.zeros(1, 1, 1, dim))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # norm along C and T dimensions (dim 1 and 2 in N,C,T,H,W format)
        Gx = torch.norm(x, p=2, dim=(1, 2), keepdim=True)
        Nx = Gx / (Gx.mean(dim=-1, keepdim=True) + 1e-6)
        return self.gamma * (x * Nx) + self.beta + x


# ===========================================================================
# BLOCK V23D (exact vendor from conv_backbone.py line 222)
# ===========================================================================
class BlockV23D(nn.Module):
    """ ConvNeXtV2 Block.
    
    Args:
        dim (int): Number of input channels.
        drop_path (float): Stochastic depth rate. Default: 0.0
    """
    def __init__(self, dim: int, drop_path: float = 0., inflate_len: int = 3) -> None:
        super().__init__()
        self.dwconv = nn.Conv3d(dim, dim, kernel_size=(inflate_len,7,7), padding=(inflate_len // 2,3,3), groups=dim)  # depthwise conv
        self.norm = LayerNorm(dim, eps=1e-6, data_format="channels_last")
        self.pwconv1 = nn.Linear(dim, 4 * dim)  # pointwise/1x1 convs, implemented with linear layers
        self.act = nn.GELU()
        self.grn = GRN(4 * dim)
        self.pwconv2 = nn.Linear(4 * dim, dim)
        self.drop_path = DropPath(drop_path) if drop_path > 0. else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        input = x
        x = self.dwconv(x)
        x = x.permute(0, 2, 3, 4, 1) # (N, C, T, H, W) -> (N, T, H, W, C)
        x = self.norm(x)
        x = self.pwconv1(x)
        x = self.act(x)
        x = self.grn(x)
        x = self.pwconv2(x)
        x = x.permute(0, 4, 1, 2, 3) # (N, T, H, W, C) -> (N, C, T, H, W)
        x = input + self.drop_path(x)
        return x


# ===========================================================================
# CONVNEXTV2 3D BACKBONE (merged from conv_backbone.py)
# ===========================================================================
class ConvNeXtV23D(nn.Module):
    """Full ConvNeXt V2 3D backbone with multi-frame support"""
    def __init__(
        self, in_chans: int = 3, num_classes: int = 1000,
        depths: tuple[int, ...] = (2, 2, 6, 2),
        dims: tuple[int, ...] = (48, 96, 192, 384),
        drop_path_rate: float = 0.,
    ) -> None:
        super().__init__()
        self.depths = depths
        # Stem
        stem = nn.Sequential(
            nn.Conv3d(in_chans, dims[0], kernel_size=(2,4,4), stride=(2,4,4)),
            LayerNorm(dims[0], eps=1e-6, data_format="channels_first")
        )
        self.downsample_layers = nn.ModuleList([stem])
        # Intermediate downsampling
        for i in range(3):
            downsample_layer = nn.Sequential(
                LayerNorm(dims[i], eps=1e-6, data_format="channels_first"),
                nn.Conv3d(dims[i], dims[i+1], kernel_size=(1,2,2), stride=(1,2,2)),
            )
            self.downsample_layers.append(downsample_layer)

        # Stages (inflate_strategy='131' → inflate_len sequence: 1,3,1)
        self.stages = nn.ModuleList()
        dp_rates = [x.item() for x in torch.linspace(0, drop_path_rate, sum(depths))]
        cur = 0
        for i in range(4):
            inflate_strategy = "131"
            stage = nn.Sequential(
                *[BlockV23D(dim=dims[i], drop_path=dp_rates[cur + j], 
                            inflate_len=int(inflate_strategy[j % len(inflate_strategy)]))
                  for j in range(depths[i])]
            )
            self.stages.append(stage)
            cur += depths[i]

        self.norm = nn.LayerNorm(dims[-1], eps=1e-6) # final norm layer
        self.head = nn.Linear(dims[-1], num_classes)
        self.apply(self._init_weights)
        self.head.weight.data.mul_(1.0)
        self.head.bias.data.mul_(0.0)

    def _init_weights(self, m):
        if isinstance(m, (nn.Conv3d, nn.Linear)):
            nn.init.trunc_normal_(m.weight, std=.02)
            if m.bias is not None:
                nn.init.constant_(m.bias, 0)

    def forward_features(self, x: torch.Tensor, return_spatial: bool = False) -> torch.Tensor:
        for i in range(4):
            x = self.downsample_layers[i](x)
            x = self.stages[i](x)
        if return_spatial:
            # Official ConvNeXtV23D applies the final norm in channels-last
            # order, then restores (N,C,T,H,W) for VQAHead's Conv3d layers.
            return self.norm(x.permute(0, 2, 3, 4, 1)).permute(0, 4, 1, 2, 3)
        # Global average pooling (N, C, T, H, W) -> (N, C)
        return self.norm(x.mean([-3, -2, -1]))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Official ConvNeXtV23D.forward = forward_features(x, return_spatial=True);
        # score-level pooling happens later in VQAHead/the evaluator.
        return self.forward_features(x, return_spatial=True)


# ===========================================================================
# HEADS (exact vendor from head.py)
# ===========================================================================
class VQAHead(nn.Module):
    """MLP Regression Head for VQA.
    
    Args:
        in_channels: input channels for MLP
        hidden_channels: hidden channels for MLP
        dropout_ratio: the dropout ratio for features before the MLP (default 0.5)
        pre_pool: whether pre-pool the features or not (True for Aesthetic Attributes, False for Technical Attributes)
    """
    def __init__(self, in_channels: int = 384, hidden_channels: int = 32,
                 dropout_ratio: float = 0.5, pre_pool: bool = False) -> None:
        super().__init__()
        self.dropout_ratio = dropout_ratio
        self.in_channels = in_channels
        self.hidden_channels = hidden_channels
        self.pre_pool = pre_pool
        if self.dropout_ratio != 0:
            self.dropout = nn.Dropout(p=self.dropout_ratio)
        else:
            self.dropout = None
        self.fc_hid = nn.Conv3d(self.in_channels, self.hidden_channels, kernel_size=(1, 1, 1))
        self.fc_last = nn.Conv3d(self.hidden_channels, 1, kernel_size=(1, 1, 1))
        self.gelu = nn.GELU()
        self.avg_pool = nn.AdaptiveAvgPool3d((1, 1, 1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        if self.pre_pool:
            x = self.avg_pool(x)
        # dropout_ratio=0 leaves self.dropout unset — identity in that case
        if self.dropout is not None:
            x = self.dropout(x)
            qlt_score = self.fc_last(self.dropout(self.gelu(self.fc_hid(x))))
        else:
            qlt_score = self.fc_last(self.gelu(self.fc_hid(x)))
        return qlt_score


# ===========================================================================
# DOVER MOBILE (Dual Backbones + Dual Heads per official structure)
# ===========================================================================
class DOVERMobile(nn.Module):
    """DOVER-Mobile model: two ConvNeXt V2 3D backbones with dual heads (technical/aesthetic)"""
    def __init__(
        self,
        vqa_head_hidden: int = 32,
        backbone_dims: tuple[int, ...] = (48, 96, 192, 384),
    ):
        super().__init__()
        # Dual backbones (technical + aesthetic) with official num_classes=1000
        self.technical_backbone = ConvNeXtV23D(
            depths=(2, 2, 6, 2),
            dims=backbone_dims,
            drop_path_rate=0.4,
        )
        self.aesthetic_backbone = ConvNeXtV23D(
            depths=(2, 2, 6, 2),
            dims=backbone_dims,
            drop_path_rate=0.4,
        )
        
        # Replace classification head with our own VQA heads
        # These expect pooled features from forward_features()
        self.technical_head = VQAHead(in_channels=backbone_dims[-1], hidden_channels=vqa_head_hidden)
        self.aesthetic_head = VQAHead(in_channels=backbone_dims[-1], hidden_channels=vqa_head_hidden)
        
        # Remove the old classification heads (will be replaced)
        del self.technical_backbone.head
        del self.aesthetic_backbone.head

    def forward(
        self,
        technical_view: torch.Tensor | dict[str, torch.Tensor],
        aesthetic_view: torch.Tensor | None = None,
    ) -> dict[str, torch.Tensor]:
        """Official routing: views dict {"technical": t, "aesthetic": a} runs each
        branch on its own view and returns raw per-branch score maps
        ({"technical", "aesthetic"}); callers pool and fuse, exactly like the
        official evaluator. A bare tensor keeps the legacy single-view
        fallback (both branches, fused score included) for old callers."""
        if isinstance(technical_view, dict):
            t_in = technical_view["technical"]
            a_in = technical_view.get("aesthetic", t_in)
            # Official evaluator calls each backbone module directly; its
            # forward already returns spatial features (return_spatial=True).
            tech_feat = self.technical_backbone(t_in)
            aest_feat = self.aesthetic_backbone(a_in)
            return {
                "technical": self.technical_head(tech_feat),
                "aesthetic": self.aesthetic_head(aest_feat),
            }

        # Single-view fallback: both branches see the same frames.
        aesthetic_view = technical_view if aesthetic_view is None else aesthetic_view
        tech_feat = self.technical_backbone.forward_features(technical_view, return_spatial=True)
        aest_feat = self.aesthetic_backbone.forward_features(aesthetic_view, return_spatial=True)

        # Official VQAHead returns a spatial-temporal score map; inference
        # pools that map only after the head has seen the full feature volume.
        technical_score = self.technical_head(tech_feat).mean(dim=(1, 2, 3, 4))
        aesthetic_score = self.aesthetic_head(aest_feat).mean(dim=(1, 2, 3, 4))
        fused = fuse_scores(technical_score, aesthetic_score)
        return {
            "fused": fused,
            "technical": technical_score,
            "aesthetic": aesthetic_score,
        }


def fuse_scores(technical: float | torch.Tensor, aesthetic: float | torch.Tensor) -> float | torch.Tensor:
    """Score-level fusion — official evaluate_one_video.py fuse_results.

    Weights/means are the DOVER release defaults (shared by DOVER-Mobile);
    the trailing sigmoid bounds the fused score to [0, 1].
    """
    x = (technical - 0.1107) / 0.07355 * 0.6104 + (
        aesthetic + 0.08285
    ) / 0.03774 * 0.3896
    if isinstance(x, torch.Tensor):
        return 1 / (1 + torch.exp(-x))
    # Numerically stable scalar sigmoid (extreme scores overflow plain exp).
    if x >= 0:
        return 1 / (1 + math.exp(-x))
    exp_x = math.exp(x)
    return exp_x / (1 + exp_x)


# ===========================================================================
# UNIFIED FRAME SAMPLER (exact vendor from dover_datasets.py line 273)
# ===========================================================================
class UnifiedFrameSampler:
    """Official temporal sampler: fragments_t temporal fragments, each fsize_t
    frames at frame_interval stride, optionally repeated over num_clips."""

    def __init__(
        self, fsize_t: int, fragments_t: int, frame_interval: int = 1,
        num_clips: int = 1, drop_rate: float = 0.0,
    ) -> None:
        self.fragments_t = fragments_t
        self.fsize_t = fsize_t
        self.size_t = fragments_t * fsize_t
        self.frame_interval = frame_interval
        self.num_clips = num_clips
        self.drop_rate = drop_rate

    def get_frame_indices(self, num_frames: int, train: bool = False):
        import random as _random

        tgrids = np.array(
            [num_frames // self.fragments_t * i for i in range(self.fragments_t)],
            dtype=np.int32,
        )
        tlength = num_frames // self.fragments_t

        if tlength > self.fsize_t * self.frame_interval:
            rnd_t = np.atleast_1d(np.random.randint(
                0, tlength - self.fsize_t * self.frame_interval, size=len(tgrids)
            ))
        else:
            rnd_t = np.zeros(len(tgrids), dtype=np.int32)

        ranges_t = (
            np.arange(self.fsize_t)[None, :] * self.frame_interval
            + rnd_t[:, None]
            + tgrids[:, None]
        )

        drop = _random.sample(
            list(range(self.fragments_t)), int(self.fragments_t * self.drop_rate)
        )
        dropped_ranges_t = []
        for i, rt in enumerate(ranges_t):
            if i not in drop:
                dropped_ranges_t.append(rt)
        return np.concatenate(dropped_ranges_t)

    def __call__(self, total_frames: int, train: bool = False, start_index: int = 0):
        frame_inds = []
        for _i in range(self.num_clips):
            frame_inds += [self.get_frame_indices(total_frames)]
        frame_inds = np.concatenate(frame_inds)
        frame_inds = np.mod(frame_inds + start_index, total_frames)
        return frame_inds.astype(np.int32)


# ===========================================================================
# VIEW TRANSFORMS (vendor of dover_datasets.py get_single_view semantics)
# ===========================================================================
VIEW_RESIZE = "resize"        # aesthetic branch: whole frame → 224×224
VIEW_FRAGMENTS = "fragments"  # technical branch: 7×7 grid of 32px source blocks


def _resize_view(frames_np: np.ndarray) -> np.ndarray:
    """get_resized_video equivalent: (N,H,W,C) uint8 → (N,224,224,C) uint8."""
    from PIL import Image

    out = np.zeros((len(frames_np), 224, 224, frames_np.shape[3]), dtype=np.uint8)
    for i, frame in enumerate(frames_np):
        out[i] = np.array(Image.fromarray(frame).resize((224, 224), Image.BILINEAR))
    return out


def _spatial_fragments_view(frames_np: np.ndarray, fragments_h: int = 7, fragments_w: int = 7,
                            fsize_h: int = 32, fsize_w: int = 32,
                            aligned: int = 32) -> np.ndarray:
    """Official get_spatial_fragments (dover_datasets.py line 22), inference path.

    For each 32-frame temporal group, every (i,j) grid cell copies a random
    32×32 block from its source-resolution cell into the 224×224 mosaic canvas
    — the technical branch sees native-resolution detail, never a downscaled
    frame. Sources smaller than the canvas are bilinear-upsampled first
    (official fallback_type="upsample")."""
    n = len(frames_np)
    if n % aligned != 0:
        raise ValueError(f"fragments view needs frame count divisible by {aligned}, got {n}")
    res_h, res_w = frames_np.shape[1], frames_np.shape[2]
    size_h, size_w = fragments_h * fsize_h, fragments_w * fsize_w

    ratio = min(res_h / size_h, res_w / size_w)
    if ratio < 1:
        from PIL import Image

        scale = 1.0 / ratio
        new_h, new_w = int(res_h * scale), int(res_w * scale)
        upscaled = np.zeros((n, new_h, new_w, frames_np.shape[3]), dtype=np.uint8)
        for i, frame in enumerate(frames_np):
            upscaled[i] = np.array(Image.fromarray(frame).resize((new_w, new_h), Image.BILINEAR))
        frames_np = upscaled
        res_h, res_w = new_h, new_w

    hgrids = [min(res_h // fragments_h * i, res_h - fsize_h) for i in range(fragments_h)]
    wgrids = [min(res_w // fragments_w * j, res_w - fsize_w) for j in range(fragments_w)]
    hlength, wlength = res_h // fragments_h, res_w // fragments_w
    groups = n // aligned

    # Official inference keeps the per-cell random jitter (rnd_h/rnd_w).
    def _jitter(bound: int) -> np.ndarray:
        # broadcast keeps deterministic test mocks (scalar returns) working
        shape = (fragments_h, fragments_w, groups)
        arr = np.asarray(np.random.randint(0, bound, shape), dtype=np.int64)
        if arr.shape != shape:
            arr = np.broadcast_to(arr, shape).copy()
        return arr

    rnd_h = _jitter(hlength - fsize_h) if hlength > fsize_h \
        else np.zeros((fragments_h, fragments_w, groups), dtype=np.int64)
    rnd_w = _jitter(wlength - fsize_w) if wlength > fsize_w \
        else np.zeros((fragments_h, fragments_w, groups), dtype=np.int64)

    target = np.zeros((n, size_h, size_w, frames_np.shape[3]), dtype=np.uint8)
    for i, hs in enumerate(hgrids):
        for j, ws in enumerate(wgrids):
            for g in range(groups):
                t_s, t_e = g * aligned, (g + 1) * aligned
                h_s, h_e = hs + rnd_h[i][j][g], hs + rnd_h[i][j][g] + fsize_h
                w_s, w_e = ws + rnd_w[i][j][g], ws + rnd_w[i][j][g] + fsize_w
                target[t_s:t_e, i * fsize_h:(i + 1) * fsize_h, j * fsize_w:(j + 1) * fsize_w] = \
                    frames_np[t_s:t_e, h_s:h_e, w_s:w_e]
    return target


def _apply_view(frames_np: np.ndarray, view: str) -> np.ndarray:
    if view == VIEW_FRAGMENTS:
        return _spatial_fragments_view(frames_np)
    if view == VIEW_RESIZE:
        return _resize_view(frames_np)
    raise ValueError(f"unknown view: {view}")


def _normalize_views(frames_np: np.ndarray) -> torch.Tensor:
    """(N,H,W,C) uint8 → (N,C,H,W) ImageNet-normalized float tensor."""
    frms = torch.from_numpy(frames_np.astype(np.float32)).permute(0, 3, 1, 2) / 255.0
    mean = torch.FloatTensor([0.485, 0.456, 0.406])
    std = torch.FloatTensor([0.229, 0.224, 0.225])
    return (frms - mean[:, None, None]) / std[:, None, None]


def _to_clip_batches(frames: torch.Tensor, num_clips: int) -> torch.Tensor:
    """Official evaluate_one_video regrouping: (N,C,H,W) → (num_clips,C,N/num_clips,H,W).

    The sampler emits clips back-to-back (clip 0's frames, then clip 1's …);
    this restores the batch structure so temporal convs stay inside one clip,
    exactly like the official `reshape(C, num_clips, -1, H, W).transpose(0,1)`."""
    n, c, h, w = frames.shape
    if n % num_clips != 0:
        raise ValueError(f"frame count {n} not divisible by num_clips {num_clips}")
    per_clip = n // num_clips
    return frames.permute(1, 0, 2, 3).reshape(c, num_clips, per_clip, h, w) \
        .transpose(0, 1).contiguous()


# ===========================================================================
# FRAME SAMPLING (partial vendor from dover_datasets.py)
# ===========================================================================
def _resolve_indices(total_frames: int, fps: float, sampler, fragments: int, clip_len: int,
                     num_clips: int, start_s: float | None,
                     duration_s: float | None) -> list[int]:
    """Index selection shared by both decoders.

    A UnifiedFrameSampler produces official fragment indices inside the
    (optional) time window; without one the legacy even-span sampling runs.
    All indices are clamped to valid frame numbers before decoding."""
    window_lo, window_hi = _sampling_window(total_frames, start_s, duration_s, fps)
    span = max(1, window_hi - window_lo)
    if sampler is not None:
        raw = np.asarray(sampler(span), dtype=np.int64) + window_lo
    else:
        indices = []
        for c in range(num_clips):
            span_lo = min(window_lo + c * max(1, (window_hi - window_lo) // num_clips),
                          max(window_lo, window_hi - clip_len))
            span_hi = min(span_lo + clip_len, window_hi)
            step = max(1, (span_hi - span_lo) // max(1, fragments - 1))
            indices.extend(range(span_lo, span_hi, step)[:fragments])
        raw = np.asarray(indices if indices else [window_lo], dtype=np.int64)
    return [int(min(max(i, 0), total_frames - 1)) for i in raw]


def sample_frames(video_path: str, sampler: UnifiedFrameSampler | None = None,
                  fragments: int = 32, clip_len: int = 32, frame_interval: int = 2,
                  num_clips: int = 1, start_s: float | None = None,
                  duration_s: float | None = None,
                  view: str = VIEW_RESIZE) -> torch.Tensor:
    """Sample frames following DOVERMobile configuration. Returns (N, C, H, W) tensor preprocessed.

    sampler overrides the legacy even-span index selection with the official
    UnifiedFrameSampler. view picks the official spatial transform: resize
    (aesthetic branch) or fragments (technical mosaic). start_s/duration_s
    restrict sampling to a time window (shot-level scoring). Frames are
    decoded at native resolution so the fragments view sees true detail.
    """
    try:
        import decord
    except ImportError:
        # Fallback to ffmpeg + PIL when decord unavailable
        return _sample_frames_ffmpeg(video_path, sampler=sampler, fragments=fragments,
                                     clip_len=clip_len, frame_interval=frame_interval,
                                     num_clips=num_clips, start_s=start_s,
                                     duration_s=duration_s, view=view)

    vr = decord.VideoReader(video_path, ctx=decord.cpu(0))
    total_frames = len(vr)
    fps = getattr(vr, "get_avg_fps", lambda: 24.0)() or 24.0
    indices = _resolve_indices(total_frames, fps, sampler, fragments, clip_len,
                               num_clips, start_s, duration_s)
    frames_np = vr.get_batch(indices).asnumpy()
    vr.release()
    return _normalize_views(_apply_view(frames_np, view))


def _sampling_window(total_frames: int, start_s: float | None,
                     duration_s: float | None, fps: float = 24.0) -> tuple[int, int]:
    """Map an optional [start_s, start_s+duration_s) window to frame bounds.

    Without a window the whole video is the sampling range; the window is
    clamped so slice scoring never reads past either end.
    """
    lo = min(max(0, int((start_s or 0.0) * fps)), max(0, total_frames - 1))
    hi = total_frames if duration_s is None else min(total_frames, lo + max(1, int(duration_s * fps)))
    if hi <= lo:
        hi = min(total_frames, lo + 1)
    return lo, hi


def _sample_frames_ffmpeg(video_path: str, sampler: UnifiedFrameSampler | None = None,
                          fragments: int = 32, clip_len: int = 32,
                          frame_interval: int = 2, num_clips: int = 1,
                          start_s: float | None = None,
                          duration_s: float | None = None,
                          view: str = VIEW_RESIZE) -> torch.Tensor:
    """Fallback frame sampling using ffmpeg + PIL when decord unavailable"""
    import subprocess
    import tempfile
    from PIL import Image

    def _probe(*entries: str) -> str:
        cmd = ['ffprobe', '-v', 'error', '-show_entries', ','.join(entries),
               '-of', 'csv=p=0', video_path]
        proc = subprocess.run(cmd, capture_output=True, text=True)
        return proc.stdout.strip()

    # Frame count: prefer nb_frames; some containers omit it, so fall back to
    # duration × fps rather than assuming a hardcoded count or frame rate.
    nb_frames_raw = _probe('stream=codec_type,nb_frames', 'stream=duration', 'stream=r_frame_rate')
    video_rows = [row for row in nb_frames_raw.split('\n')
                  if row and row.split(',')[0] == 'video']
    if not video_rows:
        raise RuntimeError(f"No video stream found for {video_path}")

    parts = video_rows[0].split(',')
    total_frames: int | None = None
    if len(parts) > 1 and parts[1].isdigit() and int(parts[1]) > 0:
        total_frames = int(parts[1])

    fps = 24.0
    if len(parts) > 2 and '/' in parts[2]:
        num, _, den = parts[2].partition('/')
        if den and float(den) > 0:
            fps = float(num) / float(den)

    if total_frames is None:
        # duration follows nb_frames per stream row (some containers omit count)
        rows = nb_frames_raw.split('\n')
        probed_duration = 0.0
        for row in rows:
            cols = row.split(',')
            if len(cols) >= 2 and cols[0] == 'video' and cols[1].replace('.', '', 1).isdigit():
                probed_duration = float(cols[1])
                break
        if probed_duration > 0:
            total_frames = max(1, int(probed_duration * fps))
        else:
            raise RuntimeError(f"Cannot determine frame count for {video_path}")

    indices = _resolve_indices(total_frames, fps, sampler, fragments, clip_len,
                               num_clips, start_s, duration_s)

    # Extract frames one by one via -ss keyframe seeking at NATIVE resolution
    # (the fragments view must see true detail); each temp file is removed
    # after decoding so repeated scoring never leaks disk space.
    frames = []
    first_shape: tuple[int, ...] | None = None
    for i, idx in enumerate(indices):
        fd, tmp_path = tempfile.mkstemp(suffix='.jpg')
        os.close(fd)
        try:
            ts = idx / fps
            cmd = [
                'ffmpeg', '-y', '-ss', f'{ts:.3f}',
                '-i', video_path, '-frames:v', '1', '-q:v', '2', tmp_path
            ]
            proc_result = subprocess.run(cmd, capture_output=True, text=True)
            if proc_result.returncode != 0:
                print(f"⚠️ Frame {i} extract failed: {proc_result.stderr[:100]}")
                continue
            img = Image.open(tmp_path).convert('RGB')
            frame_np = np.array(img)
            if first_shape is None:
                first_shape = frame_np.shape
            elif frame_np.shape != first_shape:
                # decoders can emit odd sizes on the last frame — unify
                frame_np = np.array(img.resize((first_shape[1], first_shape[0]), Image.BILINEAR))
            frames.append(frame_np)
        except Exception as e:  # noqa: BLE001 — single-frame failures degrade, not abort
            print(f"⚠️ Frame {i} decode failed: {e}")
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    # Pad to the expected index count (a UnifiedFrameSampler may yield more
    # than `fragments` — e.g. the 96-frame technical view — so never truncate).
    expected = len(indices)
    if len(frames) < expected:
        print(f"⚠️ Only got {len(frames)}/{expected} frames, zero-padding remainder")
    pad_shape = first_shape if first_shape is not None else (224, 224, 3)
    while len(frames) < expected:
        frames.append(np.zeros(pad_shape, dtype=np.uint8))

    frms = np.stack(frames, axis=0)  # (N, H, W, C) where N=len(indices)
    return _normalize_views(_apply_view(frms, view))


# ===========================================================================
# PUBLIC API (used by QC pipeline)
# ===========================================================================
class DOVERMobileWrapper:
    """Wrapper exposing load_model + score_frames interface"""
    def __init__(self, weight_path: str) -> None:
        self.model = DOVERMobile(
            vqa_head_hidden=32,
            backbone_dims=(48, 96, 192, 384),
        )
        # Load state dict carefully: map aesthetic_* to technical_* keys (shared weights)
        # Official DOVER-Mobile uses tied weights between the two branches
        state_dict = torch.load(weight_path, map_location="cpu", weights_only=True)
        
        # Full key mapping: every model key must find a weight (aesthetic/technical mutual fallback)
        new_state = {}
        for key in self.model.state_dict().keys():
            if key in state_dict:
                new_state[key] = state_dict[key]
            elif key.replace("technical_", "aesthetic_") in state_dict:
                new_state[key] = state_dict[key.replace("technical_", "aesthetic_")]
            elif key.replace("aesthetic_", "technical_") in state_dict:
                new_state[key] = state_dict[key.replace("aesthetic_", "technical_")]
            else:
                print(f"⚠️  Missing weight for {key}")
        
        # Load with strict=False (skip any remaining mismatches like head layers)
        filtered_state = {k: new_state[k] for k in sorted(new_state.keys())}
        self.model.load_state_dict(filtered_state, strict=False)
        self.model.eval()

    @staticmethod
    def load(weight_path: str) -> "DOVERMobileWrapper":
        return DOVERMobileWrapper(weight_path)

    def score(self, video_path: str, fragments: int = 32, start_s: float | None = None,
              duration_s: float | None = None) -> tuple[float, float, float]:
        """Score a video (optionally a [start_s, start_s+duration_s) window)
        → (fused, aesthetic, technical).

        Official decomposition (evaluate_one_video.py + dover.yml): the
        technical branch sees 3 clips × 32 frames as mosaic fragments, the
        aesthetic branch 32 frames resized — and each view is regrouped into
        its (num_clips, C, T/num_clips, H, W) batches, so temporal convs never
        mix one clip's frames with the next clip's. The window clamps the span
        for shot-level scoring."""
        with torch.no_grad():
            technical_frames = sample_frames(
                video_path, sampler=UnifiedFrameSampler(32, 3, 2),
                start_s=start_s, duration_s=duration_s, view=VIEW_FRAGMENTS)
            aesthetic_frames = sample_frames(
                video_path, sampler=UnifiedFrameSampler(1, 32, 2, 1),
                start_s=start_s, duration_s=duration_s, view=VIEW_RESIZE)

            technical_view = _to_clip_batches(technical_frames, num_clips=3)
            aesthetic_view = _to_clip_batches(aesthetic_frames, num_clips=1)

            outputs = self.model({"technical": technical_view, "aesthetic": aesthetic_view})
            # Official evaluator pools each branch's score map, then fuses.
            technical = outputs["technical"].mean().item()
            aesthetic = outputs["aesthetic"].mean().item()
            fused = fuse_scores(technical, aesthetic)
            return float(fused), float(aesthetic), float(technical)


def load_model(weight_path: str) -> DOVERMobileWrapper:
    return DOVERMobileWrapper.load(weight_path)


def score_frames(model: DOVERMobileWrapper, video_path: str, start_s: float | None = None,
                 duration_s: float | None = None) -> tuple[float, float, float]:
    """Score a video (optionally a [start_s, start_s+duration_s) window)."""
    return model.score(video_path, start_s=start_s, duration_s=duration_s)
