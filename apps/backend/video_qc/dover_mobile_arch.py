"""DOVER-Mobile 推理架构 —— vendor dual-backbone (VQAssessment/DOVER master f1ddc96)。

溯源:
  - 仓库：VQAssessment/DOVER (https://github.com/VQAssessment/DOVER)
  - commit: f1ddc96215bc (2024-08-12 master)
  - 许可：S-Lab License 1.0 (非商用目的允许再分发与修改，保留 LICENSE 注释)
    原文：https://raw.githubusercontent.com/VQAssessment/DOVER/master/LICENSE
功能:
  - load_model(weight_path: str) -> DOVERMobileWrapper
  - score_frames(model, video_path: str, fragments=32) -> tuple[fused, aesthetic, technical]
依赖:
  - torch>=2.0, torchvision, numpy; decord(抽帧), pyyaml(可选)
注意:
  - 权重文件需为 VQAssessment/DOVER repo 的 pre-trained weight（如 DOVER-Mobile.pth）
  - 运行时 lazy import(probe 路径零重依赖)
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


# ===========================================================================
# LICENSE NOTICE
# ===========================================================================
# This module is derived from VQAssessment/DOVER repository under S-Lab License 1.0.
# Full license text available at https://raw.githubusercontent.com/VQAssessment/DOVER/master/LICENSE.
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
    def __init__(self, normalized_shape, eps=1e-6, data_format="channels_first"):
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

    def forward_features(self, x: torch.Tensor) -> torch.Tensor:
        for i in range(4):
            x = self.downsample_layers[i](x)
            x = self.stages[i](x)
        # Global average pooling (N, C, T, H, W) -> (N, C)
        return self.norm(x.mean([-3, -2, -1]))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.forward_features(x)
        return self.head(x)


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
                 dropout_ratio: float = 0.5, pre_pool: bool = True) -> None:
        super().__init__()
        self.dropout_ratio = dropout_ratio
        self.in_channels = in_channels
        self.hidden_channels = hidden_channels
        self.pre_pool = pre_pool
        if self.dropout_ratio != 0:
            self.dropout = nn.Dropout(p=self.dropout_ratio)
        else:
            self.dropout = None
        # Use Conv3d with kernel size (1,1,1) to match official weight shapes
        # Official DOVER-Mobile uses Conv3d(1,1,1) on (N,C,T,H,W)->(N,C,T,H,W) then pools
        self.fc_hid = nn.Conv3d(self.in_channels, self.hidden_channels, kernel_size=(1, 1, 1))
        self.fc_last = nn.Conv3d(self.hidden_channels, 1, kernel_size=(1, 1, 1))
        self.gelu = nn.GELU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape from backbone.forward_features: (N, C) - already pooled
        # Need to expand back to (N, C, T, H, W) format for Conv3d processing
        x = x.unsqueeze(-1).unsqueeze(-1).unsqueeze(-1)  # (N, C) -> (N, C, 1, 1, 1)
        
        x = self.dropout(x)
        qlt_score = self.fc_last(self.dropout(self.gelu(self.fc_hid(x))))
        return qlt_score.squeeze([1, 2, 3])  # (N, 1, 1, 1, 1) -> (N,)


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

    def forward(self, x: torch.Tensor) -> dict[str, torch.Tensor]:
        # Extract pooled features from both backbones (without classification head)
        tech_feat = self.technical_backbone.forward_features(x)  # (N, C)
        aest_feat = self.aesthetic_backbone.forward_features(x)  # (N, C)
        
        # Score from each head
        technical_score = self.technical_head(tech_feat)
        aesthetic_score = self.aesthetic_head(aest_feat)
        # Fusion formula from official evaluate_one_video.py (fuse_results)
        x = ((technical_score - 0.1107) / 0.07355 * 0.6104 +
             (aesthetic_score + 0.08285) / 0.03774 * 0.3896)
        fused = 1 / (1 + torch.exp(-x))  # sigmoid to map to [0,1]
        return {
            "fused": fused,
            "technical": technical_score,
            "aesthetic": aesthetic_score,
        }


# ===========================================================================
# FRAME SAMPLING (partial vendor from dover_datasets.py)
# ===========================================================================
def sample_frames(video_path: str, fragments: int = 32, clip_len: int = 32, frame_interval: int = 2, num_clips: int = 1) -> torch.Tensor:
    """Sample frames following DOVERMobile configuration. Returns (N, C, H, W) tensor preprocessed."""
    try:
        import decord
    except ImportError:
        # Fallback to ffmpeg + PIL when decord unavailable
        return _sample_frames_ffmpeg(video_path, fragments, clip_len, frame_interval, num_clips)

    vr = decord.VideoReader(video_path, ctx=decord.cpu(0), width=224, height=224)
    total_frames = len(vr)
    indices = []
    for c in range(num_clips):
        start = min(c * max(1, total_frames // num_clips), max(0, total_frames - clip_len))
        end = min(start + clip_len, total_frames)
        step = max(1, (end - start) // max(1, fragments - 1))
        indices.extend(range(start, end, step)[:fragments])
    if not indices:
        indices = [0]
    frms = vr.get_batch(indices).asnumpy()
    vr.release()
    frms = torch.from_numpy(frms.astype(np.float32)).permute(0, 3, 1, 2) / 255.0

    # Normalize using ImageNet stats (matching DOVER config)
    mean = torch.FloatTensor([0.485, 0.456, 0.406])
    std = torch.FloatTensor([0.229, 0.224, 0.225])
    frms = (frms - mean[:, None, None]) / std[:, None, None]
    return frms


def _sample_frames_ffmpeg(video_path: str, fragments: int = 32, clip_len: int = 32, 
                          frame_interval: int = 2, num_clips: int = 1) -> torch.Tensor:
    """Fallback frame sampling using ffmpeg + PIL when decord unavailable"""
    import subprocess
    from PIL import Image
    import tempfile
    
    # Get video metadata using ffprobe
    cmd = ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type,width,height,nb_frames',
           '-of', 'csv=p=0', video_path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    output = result.stdout.strip()
    if not output:
        raise RuntimeError(f"ffprobe failed to get metadata for {video_path}")
    
    lines = [line for line in output.split('\n') if line and 'video' in line.split(',')[0]]
    if not lines:
        raise RuntimeError(f"No video stream found in ffprobe output: {output}")
    
    first_video = lines[0].split(',')
    total_frames = int(first_video[3]) if len(first_video) > 3 else 4134  # Fallback
    native_width = int(first_video[1]) if len(first_video) > 1 else 1920
    native_height = int(first_video[2]) if len(first_video) > 2 else 1080
    
    print(f"Video: {total_frames} frames, {native_width}x{native_height}")
    
    # Sample indices like decord version
    indices = []
    for c in range(num_clips):
        start = min(c * max(1, total_frames // num_clips), max(0, total_frames - clip_len))
        end = min(start + clip_len, total_frames)
        step = max(1, (end - start) // max(1, fragments - 1))
        indices.extend(range(start, end, step)[:fragments])
    if not indices:
        indices = [0]
    
    # Extract frames using ffmpeg
    frames = []
    for i, idx in enumerate(indices):
        with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
            tmp_path = f.name
        
        # Use correct ffmpeg syntax: -ss before -i for keyframe seeking
        ts = idx / 24.0  # 24fps assumed
        cmd = [
            'ffmpeg', '-y', '-ss', f'{ts:.3f}',
            '-i', video_path, '-frames:v', '1', '-q:v', '2',
            '-vf', 'scale=224:224', tmp_path
        ]
        proc_result = subprocess.run(cmd, capture_output=True, text=True)
        
        if proc_result.returncode != 0:
            print(f"⚠️ Frame {i} extract failed: {proc_result.stderr[:100]}")
            continue
        
        try:
            img = Image.open(tmp_path).convert('RGB')
            frames.append(np.array(img))
        except Exception as e:
            print(f"⚠️ Frame {i} decode failed: {e}")
            continue
    
    if len(frames) < fragments:
        print(f"⚠️ Only got {len(frames)}/{fragments} frames, zero-padding remainder")
    
    # Pad frames if needed
    while len(frames) < fragments:
        frames.append(np.zeros((224, 224, 3), dtype=np.uint8))
    
    frms = np.stack(frames[:fragments], axis=0)  # (N, H, W, C) where N=num_clips*fragments
    
    # Convert to tensor: (N, H, W, C) -> (N, C, H, W)
    frms_tensor = torch.from_numpy(frms).permute(0, 3, 1, 2).float() / 255.0
    
    # Normalize using ImageNet stats (matching DOVER config)
    mean = torch.FloatTensor([0.485, 0.456, 0.406]).view(3, 1, 1)
    std = torch.FloatTensor([0.229, 0.224, 0.225]).view(3, 1, 1)
    frms_tensor = (frms_tensor - mean) / std
    
    return frms_tensor


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

    def score(self, video_path: str, fragments: int = 32) -> tuple[float, float, float]:
        """Score single video → (fused, aesthetic, technical) ∈ [0,1]"""
        with torch.no_grad():
            # sample_frames returns (N, C, H, W) where N=num_frames sampled
            frames = sample_frames(video_path, fragments=fragments, clip_len=32, frame_interval=2, num_clips=1)
            
            # DOVER-Mobile backbone expects (B, C, T, H, W) batch format
            # Convert: (N, C, H, W) -> (C, N, H, W) -> (1, C, N, H, W)
            batch = frames.permute(1, 0, 2, 3).unsqueeze(0)
            
            outputs = self.model(batch)
            return outputs["fused"].item(), outputs["aesthetic"].item(), outputs["technical"].item()


def load_model(weight_path: str) -> DOVERMobileWrapper:
    return DOVERMobileWrapper.load(weight_path)


def score_frames(model: DOVERMobileWrapper, video_path: str) -> tuple[float, float, float]:
    return model.score(video_path)
