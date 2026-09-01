"""Krea2 引擎契约测试(Phase 0 止血批)。

钉住三件事:① 参考图能力门禁(机制级:不支持的引擎 fail-closed;
Krea2 经 SDEdit 已支持,单独钉回归);② use_lora 从 generate_image
一路透传到引擎;③ 默认引擎常量。
"""

from __future__ import annotations

import unittest
from unittest import mock

from image_gen import model_cache, pipeline
from image_gen.engines import krea2 as krea2_engine
from image_gen.pipeline import PipelineError


class ReferenceCapabilityGateTest(unittest.TestCase):
    def test_gate_rejects_reference_for_engine_that_lacks_support(self) -> None:
        # 门禁机制测试:引擎声明不支持时,带参考图立即 fail-closed(先于就绪检查)
        with mock.patch.object(krea2_engine, "SUPPORTS_REFERENCE", False), mock.patch.object(
            pipeline, "_require_downloaded"
        ) as require_downloaded:
            with self.assertRaises(PipelineError) as ctx:
                pipeline.generate_image(
                    "krea2-turbo", "水墨山水", reference_image_b64="aGVsbG8="
                )
        self.assertEqual(ctx.exception.code, "reference-unsupported")
        self.assertIn("暂不支持参考图", ctx.exception.message)
        require_downloaded.assert_not_called()
        # Krea2 SDEdit 参考图支持的回归钉由其特性提交自带(本批不裹挟在途代码)

    def test_flux2_reference_passes_gate_then_fails_closed_on_download(self) -> None:
        # 本机无 FLUX.2 大件:走到就绪检查即证明参考门禁对其放行
        with self.assertRaises(PipelineError) as ctx:
            pipeline.generate_image(
                "flux2-klein-9b", "水墨山水", reference_image_b64="aGVsbG8="
            )
        self.assertEqual(ctx.exception.code, "model-not-downloaded")

    def test_krea2_without_reference_skips_gate(self) -> None:
        with mock.patch.object(pipeline, "_require_downloaded") as require_downloaded, mock.patch.object(
            krea2_engine, "generate", return_value="ZmFrZQ=="
        ) as generate:
            result = pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(result, "ZmFrZQ==")
        require_downloaded.assert_called_once_with("krea2-turbo")
        self.assertEqual(generate.call_args.kwargs["reference_b64"], None)

    def test_krea2_reference_is_forwarded_to_sdedit_engine(self) -> None:
        with mock.patch.object(pipeline, "_require_downloaded"), mock.patch.object(
            krea2_engine, "generate", return_value="ZmFrZQ=="
        ) as generate:
            result = pipeline.generate_image(
                "krea2-turbo",
                "水墨山水",
                reference_image_b64="data:image/png;base64,aGVsbG8=",
                strength=0.7,
            )
        self.assertEqual(result, "ZmFrZQ==")
        self.assertEqual(generate.call_args.kwargs["reference_b64"], "data:image/png;base64,aGVsbG8=")
        self.assertEqual(generate.call_args.kwargs["strength"], 0.7)


class UseLoraPassthroughTest(unittest.TestCase):
    def test_use_lora_reaches_engine(self) -> None:
        with mock.patch.object(pipeline, "_require_downloaded"), mock.patch.object(
            krea2_engine, "generate", return_value="ZmFrZQ=="
        ) as generate:
            pipeline.generate_image("krea2-turbo", "水墨山水", use_lora=True)
        self.assertIs(generate.call_args.kwargs["use_lora"], True)

    def test_use_lora_defaults_off(self) -> None:
        with mock.patch.object(pipeline, "_require_downloaded"), mock.patch.object(
            krea2_engine, "generate", return_value="ZmFrZQ=="
        ) as generate:
            pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertIs(generate.call_args.kwargs["use_lora"], False)


class DefaultEngineTest(unittest.TestCase):
    def test_default_image_model_is_krea2(self) -> None:
        self.assertEqual(model_cache.DEFAULT_IMAGE_MODEL, "krea2-turbo")


if __name__ == "__main__":
    unittest.main()


class ProWorkflowParityTest(unittest.TestCase):
    """「Krea2-NSFW专业流」固定流程对拍(09-01 深审修正版):常量与 ComfyUI
    原版工作流逐项一致;重平衡数学按真实 4D 形状逐位对拍 ComfyUI 参考;
    分辨率表按 ComfyUI nodes_resolution 公式(1MP,步进16)复算。"""

    def test_pro_lora_stack_matches_original_workflow_toggles(self) -> None:
        # 原版 PowerLoraLoader 开关态:Mystic XXX v3@1.0 + pussy@0.3(NSFW V4 关闭);
        # 深审实证两文件零 alpha/dora 键、纯 diffusion_model.* → 缩放=纯 strength
        self.assertEqual(
            krea2_engine.PRO_LORA_STACK,
            (("KREA 2 Mystic XXX v3.safetensors", 1.0), ("Krea 2 pussy.safetensors", 0.3)),
        )
        self.assertNotIn(
            "Krea 2 NSFW V4", [name for name, _ in krea2_engine.PRO_LORA_STACK]
        )

    def test_rebalance_constants_match_original_node(self) -> None:
        # 原版节点51(在连线内):multiplier=1, 12 带 weights 第9带×5;节点76 未连线
        self.assertEqual(krea2_engine.PRO_REBALANCE_MULTIPLIER, 1.0)
        self.assertEqual(
            krea2_engine.PRO_REBALANCE_WEIGHTS,
            (1.0,) * 8 + (5.0,) + (1.0,) * 3,
        )

    def test_guidance_zero_matches_comfyui_cfg_one(self) -> None:
        # ComfyUI sampling_function: isclose(cfg,1.0)→uncond=None;diffusers s=0 同义
        self.assertEqual(krea2_engine.GUIDANCE_SCALE, 0.0)

    def test_aspect_table_matches_comfyui_resolution_formula(self) -> None:
        import math

        ratios = {"1:1": (1, 1), "16:9": (16, 9), "9:16": (9, 16), "4:3": (4, 3), "3:4": (3, 4)}
        for ratio, (wr, hr) in ratios.items():
            with self.subTest(ratio=ratio):
                total = 1.0 * 1024 * 1024
                scale = math.sqrt(total / (wr * hr))
                w = round(wr * scale / 16) * 16
                h = round(hr * scale / 16) * 16
                self.assertEqual(krea2_engine.ASPECT_RATIOS[ratio], (w, h))
                self.assertEqual(w % 16, 0)
                self.assertEqual(h % 16, 0)

    def test_rebalance_embeds_4d_bitwise_matches_comfyui_flatten_reference(self) -> None:
        import torch as _torch

        # 真实生产形态:diffusers encode_prompt 返回 (B, seq, 12, 2560);
        # ComfyUI 参考 = 升序展平到末维 (B, seq, 12*2560) 后按 _scale_cond_tensor 缩放
        def comfy_reference_flat(t4, scale, weights):
            # ComfyUI 路径:(B,12,seq,h) 展平为 (B,seq,12*h) 后逐位 _scale_cond_tensor。
            # 此处 t4 已是 (B,seq,12,h) 连续形态,等价展平 = reshape(不需要 permute——
            # 首版参考误加了 ComfyUI 的 permute,把 seq/层维搅乱导致假失败)
            b, seq, n, h = t4.shape
            flat = t4.reshape(b, seq, n * h).clone()
            layer_dim = h
            orig_dtype = flat.dtype
            flat = flat.float()
            flat = flat.view(*flat.shape[:-1], n, layer_dim)
            gains = _torch.tensor(weights, dtype=flat.dtype, device=flat.device)
            flat = flat * gains.view(*([1] * (flat.dim() - 2)), n, 1)
            flat = flat.view(*flat.shape[:-2], n * h)
            return flat.to(orig_dtype) * scale

        _torch.manual_seed(11)
        embeds = _torch.randn(2, 37, 12, 2560, dtype=_torch.bfloat16)
        ours = krea2_engine._rebalance_prompt_embeds(
            embeds, krea2_engine.PRO_REBALANCE_WEIGHTS, krea2_engine.PRO_REBALANCE_MULTIPLIER
        )
        ref = comfy_reference_flat(
            embeds.clone(), krea2_engine.PRO_REBALANCE_MULTIPLIER, list(krea2_engine.PRO_REBALANCE_WEIGHTS)
        )
        self.assertEqual(ours.shape, embeds.shape)
        self.assertTrue(_torch.equal(ours.reshape(*embeds.shape), ref.view(*ours.shape)))
        # 第9层(index 8)范数 ≈ 原层 ×5,其余层不变(旧实现的静默无效即在此暴露)
        orig_layers = embeds.float()
        ours_layers = ours.float()
        ratio9 = ours_layers[..., 8, :].norm() / orig_layers[..., 8, :].norm()
        ratio1 = ours_layers[..., 0, :].norm() / orig_layers[..., 0, :].norm()
        self.assertAlmostEqual(ratio9.item(), 5.0, delta=0.2)
        self.assertAlmostEqual(ratio1.item(), 1.0, delta=0.05)

    def test_rebalance_embeds_3d_concat_bitwise_matches_comfyui_reference(self) -> None:
        import torch as _torch

        def comfy_reference(t, scale, weights):
            flat = t.shape[-1]
            n_layers = len(weights)
            if n_layers > 1 and flat % n_layers == 0:
                layer_dim = flat // n_layers
                orig_dtype = t.dtype
                t = t.float()
                t = t.view(*t.shape[:-1], n_layers, layer_dim)
                gains = _torch.tensor(weights, dtype=t.dtype, device=t.device)
                t = t * gains.view(*([1] * (t.dim() - 2)), n_layers, 1)
                t = t.view(*t.shape[:-2], flat)
                return t.to(orig_dtype) * scale
            return t * scale

        _torch.manual_seed(7)
        embeds = _torch.randn(2, 17, 12 * 2560, dtype=_torch.bfloat16)
        ours = krea2_engine._rebalance_prompt_embeds(
            embeds, krea2_engine.PRO_REBALANCE_WEIGHTS, krea2_engine.PRO_REBALANCE_MULTIPLIER
        )
        ref = comfy_reference(
            embeds.clone(), krea2_engine.PRO_REBALANCE_MULTIPLIER, list(krea2_engine.PRO_REBALANCE_WEIGHTS)
        )
        self.assertTrue(_torch.equal(ours, ref))
