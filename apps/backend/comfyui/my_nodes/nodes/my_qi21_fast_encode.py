# Copyright (c) 2026 MYStudio
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""Qwen Image 2.1 单遍文本编码节点(MyQi21FastEncode,my21fast-1025 序2;v3 io 类)。

同域重实现声明:语义与形态参照本仓装机引擎 ComfyUI 的
comfy_extras/nodes_qwen.py::TextEncodeQwenImage21(define_schema :111-141/
execute :143-182)。引擎 GPLv3 与本仓 AGPL-3.0 同属 GPL 家族且单向兼容
(GPLv3 代码可合法进入 AGPL-3.0 仓),属同域参照重实现,非第三方 GPL
抄袭;零 Goohaitools 引用。

形态(1025 序2 回环定谳:legacy(V1) 注册形在执行期丢动态 images.image_N
子键——autogrow 动态展开仅施于 io.ComfyNode 新类 get_finalized_class_inputs,
故照官方同款 v3 io 类重写):comfy_api.latest io.ComfyNode define_schema +
io.Autogrow.Input;注册仍走 my_nodes NODE_CLASS_MAPPINGS 收集链(引擎
nodes.py 装载 V1 分支把本类原样落 nodes.NODE_CLASS_MAPPINGS,与官方
comfy_entrypoint V3 分支同册;执行/对象信息按 issubclass(_ComfyNodeInternal)
动态识别 v3 身份,与注册路径无关)。

唯一自研分叉=负面出口直通正向同一 conditioning——官方对 negative_prompt
再跑一遍 tokenize/encode(:177),本节点省去该第二遍:采样链全程 cfg=1
(无分类器引导)时负面 conditioning 不参与采样,负向编码是纯冗余开销;
同对象直通即两出口 conditioning 逐位相等(官方 :178-180 对双出施加
reference_latents,本节点仅对 positive 施加后直通,identity 等价)。
其余逐参与官方一致:参考图按 image_N 序号入列、统一分辨率取整(32 倍数,
保长宽比,下限 32)、文编看图列 alpha 垫白、VAE 参考潜 append 注入、
零潜 latent 形状 [1,64,⌈H/16⌉,⌈W/16⌉] 随首张参考图。

引擎库(torch/comfy/node_helpers)全 execute 内懒导入——源码位可在
sidecar pytest 零引擎依赖验契约(同包纪律);comfy_api.latest 为 v3 类
定义期必需(官方同款顶层导入),sidecar 由 tests conftest 桩垫。数值路径
由实弹兑底。
"""

from __future__ import annotations

import math

from comfy_api.latest import io


class MyQi21FastEncode(io.ComfyNode):
    """Qwen Image 2.1 文本编码·漫影单遍(正面单遍+负面直通,cfg=1 链专用)。"""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="MyQi21FastEncode",
            display_name="Qwen Image 2.1 文本编码·漫影单遍",
            category="漫影",
            description=(
                "漫影单遍文本编码:只对正向提示词跑一遍 Qwen Image 2.1 文本编码,"
                "负面出口直通正向同一 conditioning。面向 cfg=1 采样链(Turbo/原生"
                "双 KSampler cfg 锁 1):无分类器引导下负面 conditioning 不参与采样,"
                "故负面文本在本节点不编码、不生效;参考图经 VAE 编成参考潜注入正向"
                "(与官方 TextEncodeQwenImage21 逐参一致)。"
            ),
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input("prompt", multiline=True, dynamic_prompts=True,
                                tooltip="正向提示词:唯一实际过文本编码器的文本(漫影单遍只编码正向)。"),
                io.String.Input("negative_prompt", multiline=True, dynamic_prompts=True,
                                tooltip="负面提示词:仅保留连线面;cfg=1 采样链不使用负面 conditioning,本节点不为其编码。"),
                io.Vae.Input("vae", optional=True,
                             tooltip="参考潜编码用 VAE;不接则参考图只供看图、零参考潜(keep_vision 自动回真)。"),
                io.Int.Input("resolution", default=1024, min=0, max=4096, step=32,
                             tooltip="参考图统一基准边长(32 的倍数,保长宽比缩放);0=各参考图按自身尺寸取 32 倍数;零潜画幅随首张参考图。"),
                io.Autogrow.Input(
                    "images",
                    template=io.Autogrow.TemplateNames(
                        io.Image.Input("image"),
                        names=[f"image_{i}" for i in range(1, 17)],
                        min=0,
                    ),
                    tooltip="参考图(至多 16 张,按 image_N 序号排序):文本编码器逐张看图,并经 VAE 编成参考潜注入正向;不接=纯文编。",
                ),
            ],
            outputs=[
                io.Conditioning.Output(display_name="positive"),
                io.Conditioning.Output(display_name="negative"),
                io.Latent.Output(display_name="latent",
                                 tooltip="零潜 latent(画幅随首张参考图),供采样节点直接接线。"),
            ],
        )

    @classmethod
    def execute(cls, clip, prompt, negative_prompt, vae=None, resolution=1024,
                images: io.Autogrow.Type = None) -> io.NodeOutput:
        """单遍编码:参数序与官方 nodes_qwen.py:144 对齐;第二遍负面编码不跑。"""
        import torch

        import comfy.model_management
        import comfy.utils
        import node_helpers

        ref_latents = []
        images_vl = []
        images = images or {}
        latent_w = latent_h = resolution or 1024
        for name in sorted(images, key=lambda n: int(n.rsplit("_", 1)[-1])):
            image = images[name]
            if image is None:
                continue
            # 与官方同源的统一缩放:文编看图与 VAE 编潜共用同一尺寸,每个视觉
            # 槽恰覆 2x2 潜;一槽一图(首张定零潜画幅)。
            samples = image[:1].movedim(-1, 1)
            if resolution > 0:
                ratio = samples.shape[3] / samples.shape[2]
                width = round(math.sqrt(resolution * resolution * ratio) / 32) * 32
                height = round(math.sqrt(resolution * resolution / ratio) / 32) * 32
            else:
                width, height = round(samples.shape[3] / 32) * 32, round(samples.shape[2] / 32) * 32
            width, height = max(32, width), max(32, height)
            if (width, height) == (samples.shape[3], samples.shape[2]):
                s = image[:1]
            else:
                s = comfy.utils.common_upscale(samples, width, height, "lanczos", "disabled").movedim(1, -1)
            if not images_vl:
                latent_w, latent_h = width, height
            # 看图列垫白(alpha 合成到白底);VAE 编潜保留原四通道。
            rgb = s[:, :, :, :3]
            if s.shape[-1] > 3:
                rgb = rgb * s[:, :, :, 3:] + (1.0 - s[:, :, :, 3:])
            images_vl.append(rgb)
            if vae is not None:
                ref_latents.append(vae.encode(s))

        # 单遍分叉:只跑正向(官方 :176);无参考潜时 keep_vision=True 让文编
        # 自带视觉占位,有参考潜时 False(占位由注入的参考潜承接)。
        keep_vision = len(ref_latents) == 0
        positive = clip.encode_from_tokens_scheduled(
            clip.tokenize(prompt, images=images_vl, keep_vision=keep_vision,
                          prevent_empty_text=True))
        # 官方 :178-180 对双出施加 reference_latents;本节点仅对 positive 施加,
        # 随后负面直通同对象——两出口 conditioning 逐位相等(cfg=1 链下负面
        # 不参与采样,负面文本不生效)。
        if len(ref_latents) > 0:
            positive = node_helpers.conditioning_set_values(
                positive, {"reference_latents": ref_latents}, append=True)
        negative = positive
        latent = torch.zeros(
            [1, 64, latent_h // 16, latent_w // 16],
            device=comfy.model_management.intermediate_device())
        return io.NodeOutput(positive, negative, {"samples": latent})
