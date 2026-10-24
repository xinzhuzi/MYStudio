"""空片门禁 output_gate.v3 单元测试(blank-gate-1024 测试 A)。

锚数字纪律(方案 §0):全部断言值产自 tests/fixtures/output_gate_reference_1024.py
(种子钉死 20241024,复跑即得),另加生产实现×参考实现活对拍防漂移。

P0 真样记录(§0.1):10-24 实锤黑图废片真样在本役施工时不可得(自治施工,
无用户在环)——A-5 的真样 fg/span 固定断言按方案裁定的保守路径记 skipped
(信号二保持默认关,平滑弱结构盲区如实记方案 §9#18);现造三类样已全数入
参考脚本:黑图现造样(纯黑/渐变)、浅色主体透明样、白底高 key 小主体样。
"""
from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from engines.image_engine import output_gate
from engines.image_engine.output_gate import GateMetrics, GateRejected
from fixtures import output_gate_reference_1024 as ref


class OutputGateAnchorTests(unittest.TestCase):
    """锚断言:值=参考脚本输出(复跑 output_gate_reference_1024.py 即得)。"""

    def _reject(self, blob: bytes, reason: str, **kwargs) -> GateMetrics:
        with self.assertRaises(GateRejected) as ctx:
            output_gate.evaluate_output(blob, **kwargs)
        self.assertEqual(ctx.exception.reason, reason)
        return ctx.exception.metrics

    def test_pure_black_white_red_reject_on_signal_one(self):
        # A-1: 纯黑/纯白/纯红 1024² → REJECT-low-foreground(fg=0.0)
        for blob in (ref.fixture_pure((0, 0, 0)), ref.fixture_pure((255, 255, 255)), ref.fixture_pure((255, 0, 0))):
            metrics = self._reject(blob, "low-foreground")
            self.assertEqual(metrics.fg_ratio, 0.0)
            self.assertEqual(metrics.domain, "opaque")

    def test_fully_transparent_rejects_in_transparent_domain(self):
        # A-2: 全透 RGBA → REJECT-transparent-blank(azr=1.0)
        metrics = self._reject(ref.fixture_fully_transparent(), "transparent-blank")
        self.assertEqual(metrics.domain, "transparent")
        self.assertEqual(metrics.alpha_zero_ratio, 1.0)

    def test_mid_color_sticker_passes_transparent_domain(self):
        # A-3: 中彩主体透明贴纸 → PASS-trans(azr=0.846648[ref])
        metrics = output_gate.evaluate_output(ref.fixture_sticker_rgba((160, 60, 40)))
        self.assertEqual(metrics.domain, "transparent")
        self.assertAlmostEqual(metrics.alpha_zero_ratio, 0.846648, places=6)

    def test_light_sticker_passes_transparent_domain(self):
        # A-4: 浅色主体(230-248)透明贴纸 → PASS-trans——第 2 轮 H2 误杀回归钉
        # (第 1 轮白底合成域算法下该形态双杀;v3 域分流修复)
        metrics = output_gate.evaluate_output(ref.fixture_sticker_rgba((230, 238, 248)))
        self.assertEqual(metrics.domain, "transparent")
        self.assertAlmostEqual(metrics.alpha_zero_ratio, 0.846648, places=6)
        self.assertAlmostEqual(metrics.fg_ratio, 0.153352, places=6)

    def test_gradient_rejected_only_with_signal_two(self):
        # A-5: 0→30 渐变(fg=0.317158/span=30.0[ref]):信号一漏网(>min_fg),
        # 默认(span2=0)PASS;span2=1 → REJECT-low-luma-span(span<40 且 fg<0.5)
        gradient = ref.fixture_gradient_0_30()
        metrics = output_gate.evaluate_output(gradient)
        self.assertEqual(metrics.domain, "opaque")
        self.assertAlmostEqual(metrics.fg_ratio, 0.317158, places=5)
        self.assertAlmostEqual(metrics.luma_span, 30.0, places=3)
        rejected = self._reject(gradient, "low-luma-span", span2=True)
        self.assertAlmostEqual(rejected.luma_span, 30.0, places=3)

    def test_gradient_real_black_sample_anchors_skipped(self):
        # A-5 真样支:P0 拿不到 10-24 黑图真样(见文件头)——按方案记 skipped,
        # 真样到手后把真样字节入 tests/fixtures/ 并改挂实值断言。
        self.skipTest("P0 黑图真样不可得:信号二默认关,平滑盲区如实记(方案 §9#18)")

    def test_non_png_and_truncated_bytes_fail_open(self):
        # A-6: 非 PNG 小字节/空串/截断 PNG 头 → 放行+不抛(fail-open catch 硬规格)
        for blob in (b"fake-png", b"", ref.TRUNCATED_PNG_HEADER):
            with patch("builtins.print"):  # 警告日志不算失败
                self.assertIsNone(output_gate.evaluate_output(blob))

    def test_small_image_is_exempt(self):
        # A-7: 63×63 纯黑 → 放行(小图豁免,domain="small")
        metrics = output_gate.evaluate_output(ref._png(__import__("PIL.Image", fromlist=["Image"]).new("RGB", (63, 63), (0, 0, 0))))
        self.assertEqual(metrics.domain, "small")
        self.assertEqual((metrics.width, metrics.height), (63, 63))

    def test_two_color_halves_pass_via_p95_anchor(self):
        # A-8a: 双色对半 40 差 → PASS(fg_med=0.0/fg_p95=0.500813[ref])——
        # 中位锚把全图 diff 减半恰不过线,p95 锚救回
        metrics = output_gate.evaluate_output(ref.fixture_two_color_halves())
        self.assertEqual(metrics.domain, "opaque")
        self.assertAlmostEqual(metrics.fg_ratio_med, 0.0, places=6)
        self.assertAlmostEqual(metrics.fg_ratio_p95, 0.500813, places=5)
        self.assertAlmostEqual(metrics.fg_ratio, 0.500813, places=5)

    def test_col0_three_bands_anchor_determinism(self):
        # A-8b: col0 三条带 → 两锚 fg 一致(0.005756/0.005756[ref])——锚确定性钉
        metrics = self._reject(ref.fixture_col0_three_bands(), "low-foreground")
        self.assertEqual(metrics.fg_ratio_med, metrics.fg_ratio_p95)
        self.assertAlmostEqual(metrics.fg_ratio_med, 0.005756, places=5)

    def test_period2_stripes_pass_via_random_subsample(self):
        # A-9: 周期 2 条带(215/255)→ PASS(fg=0.499184[ref])——纯步长子采样
        # 相位混叠全灭的回归钉(随机子采样无周期相位)
        metrics = output_gate.evaluate_output(ref.fixture_period2_stripes())
        self.assertAlmostEqual(metrics.fg_ratio, 0.499184, places=5)
        self.assertGreaterEqual(metrics.fg_ratio, 0.01)

    def test_dark_noise_passes_via_p95_anchor(self):
        # 暗调噪声(灰 5-40):单中位锚 fg=0 会被信号一误杀,p95 锚救回(§11.2-H2)
        metrics = output_gate.evaluate_output(ref.fixture_dark_noise())
        self.assertAlmostEqual(metrics.fg_ratio_med, 0.0, places=6)
        self.assertAlmostEqual(metrics.fg_ratio_p95, 0.389427, places=5)
        self.assertGreaterEqual(metrics.fg_ratio, 0.01)

    def test_full_noise_passes_both_signals(self):
        # >1% 噪声脏黑图反例:fg=0.997852/span=201.3537[ref] 双信号均放行
        metrics = output_gate.evaluate_output(ref.fixture_full_noise())
        self.assertAlmostEqual(metrics.fg_ratio, 0.997852, places=5)
        self.assertGreater(metrics.luma_span, 40.0)

    def test_min_fg_threshold_scan_on_highkey_sample(self):
        # A-10a: BLANK_MIN_FG 扫 0.005/0.01/0.02(高 key 小主体样 fg=0.008652[ref]
        # 作载体——信号一误杀面的实测形态)
        sample = ref.fixture_white_highkey_small_subject()
        self.assertAlmostEqual(self._reject(sample, "low-foreground").fg_ratio, 0.008652, places=5)
        metrics = output_gate.evaluate_output(sample, min_fg=0.005)
        self.assertAlmostEqual(metrics.fg_ratio, 0.008652, places=5)
        self._reject(sample, "low-foreground", min_fg=0.02)

    def test_max_luma_span_scan_with_signal_two(self):
        # A-10b: BLANK_MAX_LUMA_SPAN 扫 40/60/80(渐变 span=30.0[ref],
        # 三带均命中信号二——启用信号二时的双向扫描钉)
        gradient = ref.fixture_gradient_0_30()
        for band in (40.0, 60.0, 80.0):
            self._reject(gradient, "low-luma-span", span2=True, max_luma_span=band)

    def test_master_switches_disable_gate(self):
        # A-11: IMAGE_GUARD=0 / BLANK_GATE=0 → 纯黑 1024² 也恒放行
        black = ref.fixture_pure((0, 0, 0))
        for env in ({"MYSTUDIO_COMFYUI_IMAGE_GUARD": "0"}, {"MYSTUDIO_COMFYUI_BLANK_GATE": "0"}):
            with self.subTest(env=env), patch.dict(os.environ, env):
                self.assertIsNone(output_gate.evaluate_output(black))

    def test_invalid_env_values_fall_back_to_defaults(self):
        # A-11: 非法值("oops"/"NaN"/"-1")回落默认(照 test_comfyui_bridge robust 样式)
        black = ref.fixture_pure((0, 0, 0))
        for name in ("MYSTUDIO_COMFYUI_BLANK_MIN_FG", "MYSTUDIO_COMFYUI_BLANK_MAX_LUMA_SPAN"):
            for bad in ("oops", "NaN", "-1"):
                with self.subTest(name=name, bad=bad), patch.dict(os.environ, {name: bad}):
                    with self.assertRaises(GateRejected):
                        output_gate.evaluate_output(black)
        with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_IMAGE_GUARD": "oops"}):
            with self.assertRaises(GateRejected):
                output_gate.evaluate_output(black)


class OutputGateMatchesReferenceTests(unittest.TestCase):
    """生产实现×参考实现活对拍:同一 fixture 逐值一致(锚漂移即红)。"""

    def test_production_matches_reference_on_all_fixtures(self):
        for name, blob, kwargs in ref.CASES:
            with self.subTest(case=name):
                try:
                    expected = ref.evaluate(blob, **kwargs)
                    rejected_reason = None
                except ref.Rejected as exc:
                    expected = exc.metrics
                    rejected_reason = exc.reason
                if expected is None:
                    with patch("builtins.print"):
                        self.assertIsNone(output_gate.evaluate_output(blob, **kwargs))
                    continue
                if rejected_reason is None:
                    actual = output_gate.evaluate_output(blob, **kwargs)
                else:
                    with self.assertRaises(GateRejected) as ctx:
                        output_gate.evaluate_output(blob, **kwargs)
                    self.assertEqual(ctx.exception.reason, rejected_reason)
                    actual = ctx.exception.metrics
                self.assertEqual(actual.domain, expected["domain"])
                self.assertAlmostEqual(actual.alpha_zero_ratio, expected["alpha_zero_ratio"], places=5)
                self.assertAlmostEqual(actual.fg_ratio, expected["fg_ratio"], places=5)
                self.assertAlmostEqual(actual.luma_span, expected["luma_span"], places=3)
                self.assertAlmostEqual(actual.fg_ratio_med, expected["fg_ratio_med"], places=5)
                self.assertAlmostEqual(actual.fg_ratio_p95, expected["fg_ratio_p95"], places=5)


if __name__ == "__main__":
    unittest.main()
