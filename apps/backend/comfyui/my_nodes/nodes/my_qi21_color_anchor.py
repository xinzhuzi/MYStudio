# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""漫影 qi21 二采色彩锚(MyQi21ColorAnchor,1107 色重役)。

背景:二采 Edit 修图段(cfg=1 裸底模+纯修图指令)按模型默认鲜艳审美重绘
全图,实测 S 饱和度均值系统性 +50-60%(0.172→0.264);指令内加色控句无效
(cfg=1 无引导不吃提示词色控,1107 实弹 S=0.277≈无锚 0.264)。

正解=Lab 色统计迁移(Reinhard 经典法):以一采图为色彩权威,把一采的
L/a/b 逐通道均值+标准差迁到二采图上——「二采结构(修好的手/兵器)
+一采色彩(产线全装配的克制色)」。全局统计迁移不要求逐像素对齐,
构图微漂移免疫;1107 三验(视觉子代理):色回一采水平/结构零损伤/
无色带伪影;唯一副作用=暖区略过淡,chroma_keep 回调(默认 0.15=保留
15% 二采色度)可收。

1107 晚补·std 比值钳制 [0.5,1.5]:近灰低方差图(无衣物定妆型)二采
a/b 方差远小于一采时,未钳制的 std_s/std_d 放大残差色噪(实测 S
0.076→0.163 过冲);钳制后五型对拍全部收敛到一采 ±0.015 内(含人物
海报 0.264→0.152 的重度去饱和案,均值迁移不受钳制影响)。

torch/comfy 全 execute 内懒导入(sidecar pytest 零引擎依赖纪律)。
"""
from __future__ import annotations


class MyQi21ColorAnchor:
    """漫影 二采色彩锚:Lab 统计迁移(一采色 → 二采图)。"""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image": ("IMAGE", {
                    "tooltip": "二采 Edit 修图产物(结构权威;尺寸/通道原样输出)。"}),
                "reference": ("IMAGE", {
                    "tooltip": "一采直出图(色彩权威;尺寸不齐自动双线性对齐)。"}),
                "chroma_keep": ("FLOAT", {
                    "default": 0.15, "min": 0.0, "max": 1.0, "step": 0.05,
                    "tooltip": "二采色度保留比:0=完全吃一采色;1=不迁移。"
                               "1107 三验:暖区略过淡,0.15 回调可收。"}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "anchor"
    CATEGORY = "漫影/qi21二采"
    DESCRIPTION = (
        "二采色彩锚:以一采为色彩权威做 Lab 逐通道均值/方差迁移,"
        "保二采结构、还原一采克制色;alpha 通道原样透传。")

    def anchor(self, image, reference, chroma_keep=0.15):
        import torch

        if image.shape[0] != reference.shape[0]:
            reference = reference[: image.shape[0]] if reference.shape[0] > image.shape[0] \
                else reference.repeat((image.shape[0] + reference.shape[0] - 1)
                                      // reference.shape[0], 1, 1, 1)[: image.shape[0]]
        if reference.shape[1:3] != image.shape[1:3]:
            reference = torch.nn.functional.interpolate(
                reference.permute(0, 3, 1, 2), size=image.shape[1:3],
                mode="bilinear", align_corners=False).permute(0, 2, 3, 1)

        rgb = image[..., :3]
        ref_rgb = reference[..., :3]

        def to_lab(t):
            # sRGB->linear->XYZ(D65)->Lab;逐通道查表加速(cbrt 分段线性近似)
            lin = torch.where(t <= 0.04045, t / 12.92,
                              ((t + 0.055) / 1.055).clamp(min=1e-8) ** 2.4)
            m = torch.tensor([[[[0.4124, 0.3576, 0.1805],
                                [0.2126, 0.7152, 0.0722],
                                [0.0193, 0.1192, 0.9505]]]],
                             device=t.device, dtype=t.dtype)
            xyz = torch.matmul(lin.unsqueeze(-2), m).squeeze(-2)
            wp = torch.tensor([0.95047, 1.0, 1.08883], device=t.device, dtype=t.dtype)
            f = torch.sign(xyz) * torch.abs(xyz / wp).clamp(min=1e-8) ** (1.0 / 3.0)
            fx, fy, fz = f[..., 0], f[..., 1], f[..., 2]
            return torch.stack([116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)], dim=-1)

        def from_lab(lab):
            fy = (lab[..., 0] + 16) / 116
            fx = fy + lab[..., 1] / 500
            fz = fy - lab[..., 2] / 200
            f = torch.stack([fx, fy, fz], dim=-1)
            xyz = torch.sign(f) * torch.abs(f).clamp(min=1e-8) ** 3
            wp = torch.tensor([0.95047, 1.0, 1.08883], device=lab.device, dtype=lab.dtype)
            xyz = xyz * wp
            m = torch.tensor([[[[3.2406, -1.5372, -0.4986],
                                [-0.9689, 1.8758, 0.0415],
                                [0.0557, -0.2040, 1.0570]]]],
                             device=lab.device, dtype=lab.dtype)
            lin = torch.matmul(xyz.unsqueeze(-2), m).squeeze(-2).clamp(0.0, 1.0)
            return torch.where(lin <= 0.0031308, lin * 12.92,
                               1.055 * lin ** (1.0 / 2.4) - 0.055).clamp(0.0, 1.0)

        lab_d = to_lab(rgb)
        lab_s = to_lab(ref_rgb)
        flat_d = lab_d.reshape(-1, 3)
        flat_s = lab_s.reshape(-1, 3)
        if ref_rgb.shape[-1] > 3:  # 参考图透明区不进色彩统计
            mask = (reference[..., 3:] >= 0.04).reshape(-1)
            flat_s = flat_s[mask] if int(mask.sum()) > 64 else flat_s
        if image.shape[-1] > 3:
            mask = (image[..., 3:] >= 0.04).reshape(-1)
            flat_d = flat_d[mask] if int(mask.sum()) > 64 else flat_d

        mean_d, std_d = flat_d.mean(0), flat_d.std(0).clamp(min=1e-4)
        mean_s, std_s = flat_s.mean(0), flat_s.std(0).clamp(min=1e-4)
        # 1107 晚补:std 比值钳制 [0.5,1.5]——近灰低方差图防色噪放大
        # (无衣物定妆 0.076→0.163 过冲实录;钳后五型全收敛 ±0.015)
        ratio = (std_s / std_d).clamp(0.5, 1.5)
        out = (lab_d - mean_d) * ratio + mean_s
        if chroma_keep > 0.0:  # 色度回调:向二采原色度回混
            out = torch.stack(
                [out[..., 0],
                 out[..., 1] * (1.0 - chroma_keep) + lab_d[..., 1] * chroma_keep,
                 out[..., 2] * (1.0 - chroma_keep) + lab_d[..., 2] * chroma_keep],
                dim=-1)
        result = from_lab(out)
        if image.shape[-1] > 3:  # alpha 原样透传(透明型保护)
            result = torch.cat([result, image[..., 3:]], dim=-1)
        return (result,)


NODE_CLASS_MAPPINGS = {"MyQi21ColorAnchor": MyQi21ColorAnchor}
NODE_DISPLAY_NAME_MAPPINGS = {
    "MyQi21ColorAnchor": "漫影 二采色彩锚 [MyQi21ColorAnchor]"}
