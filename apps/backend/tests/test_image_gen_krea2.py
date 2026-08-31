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
