"""空片判废重掷链路测试(blank-gate-1024 测试 B)——pipeline.generate_image 全链。

用真门禁(真 PNG fixture:纯黑=判废/中彩贴纸=放行)+假引擎,钉 §3.1 流程:
单次重掷、seed 策略(§3.2 死 seed 坑)、共享预算、取消位、/free 只对桥布局、
文案按实际是否掷过分支(第 2 轮 L5)、engine-degraded 优先(§8.2)。
"""
from __future__ import annotations

import base64
import unittest
from unittest.mock import patch

from engines.image_engine import engine_health
from engines.image_engine import krea2 as krea2_engine
from engines.image_engine import comfyui_bridge as bridge_engine
from image_gen import pipeline
from image_gen.pipeline import PipelineError
from fixtures import output_gate_reference_1024 as ref

BLACK_B64 = base64.b64encode(ref.fixture_pure((0, 0, 0))).decode("ascii")
GOOD_B64 = base64.b64encode(ref.fixture_sticker_rgba((160, 60, 40))).decode("ascii")


class BlankRetryTests(unittest.TestCase):
    def _run(self, engine_module, side_effect, model="krea2-turbo", **generate_kwargs):
        """跑 generate_image:假引擎按 side_effect 依次返回;返回 (结果, generate mock)。"""
        with patch.object(pipeline, "_require_downloaded"), patch.object(
            engine_module, "generate", side_effect=side_effect
        ) as generate:
            result = pipeline.generate_image(model, "水墨山水", **generate_kwargs)
        return result, generate

    def test_first_rejected_second_passes_with_explicit_random_seed(self):
        # B-1: 首废次好 → 两次调用、第二次 seed=显式随机 int(§3.2 死 seed 坑:
        # 首发 seed=None 时 t2i 模板烘焙死 seed,重掷传 None 会逐字节复播废片)
        with patch("builtins.print") as printed:
            result, generate = self._run(krea2_engine, [BLACK_B64, GOOD_B64])
        self.assertEqual(result, GOOD_B64)
        self.assertEqual(generate.call_count, 2)
        self.assertIsNone(generate.call_args_list[0].kwargs["seed"])
        second_seed = generate.call_args_list[1].kwargs["seed"]
        self.assertIsInstance(second_seed, int)
        self.assertTrue(1 <= second_seed <= 2**31 - 1)
        self.assertTrue(any("空片判废重掷后改善" in str(call) for call in printed.call_args_list))

    def test_double_rejection_raises_blank_output(self):
        # B-2: 两连废 → bridge-blank-output+文案含「重启引擎」(退化未确认时)
        with patch.object(engine_health, "degradation_confirmed", return_value=False), patch("builtins.print"):
            with self.assertRaises(PipelineError) as ctx, patch.object(
                krea2_engine, "generate", side_effect=[BLACK_B64, BLACK_B64]
            ) as generate, patch.object(pipeline, "_require_downloaded"):
                pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(ctx.exception.code, "bridge-blank-output")
        self.assertIn("重启引擎", ctx.exception.message)
        self.assertIn("已自动重掷一次", ctx.exception.message)  # 实际掷过=文案如实带重掷字样
        self.assertEqual(generate.call_count, 2)

    def test_engine_degraded_takes_priority_when_confirmed(self):
        # B-8(§8.2 单向联动): 重掷仍废且步时信号已独立确认退化 → engine-degraded 优先
        with patch.object(engine_health, "degradation_confirmed", return_value=True), patch("builtins.print"):
            with self.assertRaises(PipelineError) as ctx, patch.object(
                krea2_engine, "generate", side_effect=[BLACK_B64, BLACK_B64]
            ), patch.object(pipeline, "_require_downloaded"):
                pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(ctx.exception.code, "engine-degraded")
        self.assertIn("性能明显退化", ctx.exception.message)

    def test_fixed_seed_kept_and_free_fires_for_bridge_layout(self):
        # B-3: 固定 seed → 第二次 seed 不变;桥布局重掷前 free_memory 被调
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            result, generate = self._run(
                bridge_engine, [BLACK_B64, GOOD_B64], model="comfyui-bridge", seed=42)
        self.assertEqual(result, GOOD_B64)
        self.assertEqual(generate.call_args_list[1].kwargs["seed"], 42)
        free_mock.assert_called_once()

    def test_free_not_fired_for_non_bridge_layout(self):
        # B-4: 非桥布局(krea2-pointed)→ free_memory 不被调
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            self._run(krea2_engine, [BLACK_B64, GOOD_B64])
        free_mock.assert_not_called()

    def test_retry_disabled_reports_without_reroll_copy(self):
        # B-5: BLANK_RETRY=0 → 单发即报错且文案无「已自动重掷」字样(§5 分支钉)
        with patch.dict("os.environ", {"MYSTUDIO_COMFYUI_BLANK_RETRY": "0"}), patch("builtins.print"):
            with self.assertRaises(PipelineError) as ctx, patch.object(
                krea2_engine, "generate", side_effect=[BLACK_B64]
            ) as generate, patch.object(pipeline, "_require_downloaded"):
                pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(ctx.exception.code, "bridge-blank-output")
        self.assertNotIn("已自动重掷", ctx.exception.message)
        self.assertIn("重启引擎", ctx.exception.message)
        self.assertEqual(generate.call_count, 1)

    def test_cancelled_after_rejection_raises_generation_cancelled(self):
        # B-6: 判废后取消位已置 → generation-cancelled 不重掷
        def cancel_then_black(**_kwargs):
            pipeline.cancel_generation()
            return BLACK_B64

        with patch("builtins.print"):
            with self.assertRaises(PipelineError) as ctx, patch.object(
                krea2_engine, "generate", side_effect=cancel_then_black
            ) as generate, patch.object(pipeline, "_require_downloaded"):
                pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(ctx.exception.code, "generation-cancelled")
        self.assertEqual(generate.call_count, 1)

    def test_exhausted_shared_budget_skips_second_attempt(self):
        # B-7: 共享预算(600s 默认-30s 地板)耗尽 → 不发第二发直接报错;
        # 预算钉 1s=deadline-30 已在过去,首发(即时返回)后必命中
        with patch.dict("os.environ", {"MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S": "1"}), patch("builtins.print"):
            with self.assertRaises(PipelineError) as ctx, patch.object(
                krea2_engine, "generate", side_effect=[BLACK_B64]
            ) as generate, patch.object(pipeline, "_require_downloaded"):
                pipeline.generate_image("krea2-turbo", "水墨山水")
        self.assertEqual(ctx.exception.code, "bridge-blank-output")
        self.assertNotIn("已自动重掷", ctx.exception.message)  # 没掷过=不说掷过
        self.assertEqual(generate.call_count, 1)


if __name__ == "__main__":
    unittest.main()
