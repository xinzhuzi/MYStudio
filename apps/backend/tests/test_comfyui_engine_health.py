"""引擎退化防线 engine_health 单元测试(blank-gate-1024 测试 C)。

锚数字纪律:渐进退化确认发数断言唯一来源=tests/fixtures/degrade_sim_1024.py
(1-based 口径钉死,复跑即得):锚定式 40/18/12、滚动窗对照 None/None/12。
"""
from __future__ import annotations

import os
import time
import unittest
from unittest.mock import MagicMock, patch

from engines.image_engine import engine_health
from engines.image_engine.engine_health import DegradeTracker, duration_from_history, free_memory

GENERATION = 1000.0


def _history(start_ms: int, success_ms: int) -> dict:
    return {"status": {"messages": [
        ["execution_start", {"prompt_id": "p", "timestamp": start_ms}],
        ["execution_success", {"prompt_id": "p", "timestamp": success_ms}],
    ]}}


class DurationFromHistoryTests(unittest.TestCase):
    def test_extracts_timestamp_diff_in_seconds(self):
        # C-1: 毫秒时间戳差抽取(12000ms → 12.0s)
        self.assertAlmostEqual(duration_from_history(_history(1000, 13000)), 12.0)
        self.assertIsNone(duration_from_history(None))
        self.assertIsNone(duration_from_history({"status": {}}))
        self.assertIsNone(duration_from_history({"status": {"messages": [
            ["execution_start", {"timestamp": 1000}],
        ]}}))
        self.assertIsNone(duration_from_history({"status": {"messages": [
            ["execution_start", {"timestamp": 5000}], ["execution_success", {"timestamp": 1000}],
        ]}}))  # 负差=时钟异常,不采用


class AnchoredBaselineTests(unittest.TestCase):
    def _tracker(self) -> DegradeTracker:
        return DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3, exceed_persist=10)

    def _shot(self, tracker: DegradeTracker, seconds: float, bucket: str = "t2i|ckpt",
              history: dict | None = None) -> None:
        with patch("builtins.print"):
            tracker.record_shot(bucket=bucket, steps=1, history_entry=history, wall_s=seconds,
                                engine_started_at=GENERATION)

    def test_anchor_freezes_median_of_first_five_then_two_strikes_confirm(self):
        # C-2: 前 5 样本(2/4/6/8/10)冻结中位=6;第 6/7 发 20(>18)连续 2 次确认
        tracker = self._tracker()
        for value in (2.0, 4.0, 6.0, 8.0, 10.0):
            self._shot(tracker, value)
        self.assertAlmostEqual(tracker.anchor_of("t2i|ckpt"), 6.0)
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))
        self._shot(tracker, 20.0)
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))  # strikes=1 未达 2
        self._shot(tracker, 20.0)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))

    def test_history_timestamps_beat_wall_clock(self):
        # C-1b: 引擎时间戳优先于客户端墙钟(wall=2.0s 但 ts=4.0s,锚冻结=4.0)
        tracker = self._tracker()
        self._shot(tracker, 2.0, history=_history(0, 4000))
        self.assertIsNone(tracker.anchor_of("t2i|ckpt"))  # 建锚窗未满(1/5),锚未冻结
        for _ in range(4):
            self._shot(tracker, 2.0, history=_history(0, 4000))
        self.assertAlmostEqual(tracker.anchor_of("t2i|ckpt"), 4.0)  # 全按 ts 4.0s 冻结

    def test_single_spike_does_not_confirm(self):
        # C-4: 单发 10× 毛刺 → 随后回带把 strikes 清零,不确认
        tracker = self._tracker()
        for _ in range(5):
            self._shot(tracker, 3.0)
        self._shot(tracker, 30.0)
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))
        self._shot(tracker, 3.0)
        self._shot(tracker, 30.0)  # 中断后再超标=重新计数(strikes=1)
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))

    def test_recovery_after_three_in_band_shots(self):
        # C-5a: 确认退化后步时回带连续 3 发复位(锚不动)
        tracker = self._tracker()
        for _ in range(5):
            self._shot(tracker, 3.0)
        self._shot(tracker, 30.0)
        self._shot(tracker, 30.0)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))
        for _ in range(2):
            self._shot(tracker, 3.0)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))  # 回带 2 发未达 3
        self._shot(tracker, 3.0)
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))
        self.assertAlmostEqual(tracker.anchor_of("t2i|ckpt"), 3.0)

    def test_started_at_change_reanchors_and_resets(self):
        # C-5b: startedAt 变更(引擎重启)=新世代:重锚+复位
        tracker = self._tracker()
        for _ in range(5):
            self._shot(tracker, 3.0)
        self._shot(tracker, 30.0)
        self._shot(tracker, 30.0)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))
        with patch("builtins.print"):
            tracker.record_shot(bucket="t2i|ckpt", steps=1, history_entry=None, wall_s=2.0,
                                engine_started_at=GENERATION + 1)  # startedAt 变更=新世代
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))
        self.assertIsNone(tracker.anchor_of("t2i|ckpt"))  # 新世代建锚窗重新开始

    def test_master_switch_disables_tracker(self):
        # C-5c: DEGRADE_GUARD=0 → tracker 全直通(不建锚不判)
        tracker = self._tracker()
        with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_DEGRADE_GUARD": "0"}):
            for _ in range(10):
                self._shot(tracker, 30.0)
        self.assertIsNone(tracker.anchor_of("t2i|ckpt"))
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))

    def test_bucket_key_isolation_between_checkpoints(self):
        # C-6: 同模板不同 checkpoint 步时序列不互染(桶键=模板+checkpoint)
        tracker = self._tracker()
        for _ in range(5):
            self._shot(tracker, 3.0, bucket="manying_t2i|ckptA")
            self._shot(tracker, 12.0, bucket="manying_t2i|ckptB")  # ckptB 健康步时即 4×
        self.assertAlmostEqual(tracker.anchor_of("manying_t2i|ckptA"), 3.0)
        self.assertAlmostEqual(tracker.anchor_of("manying_t2i|ckptB"), 12.0)
        self.assertFalse(tracker.is_degraded("manying_t2i|ckptB"))  # 各桶各锚,A 的 3× 不套 B
        self._shot(tracker, 30.0, bucket="manying_t2i|ckptA")  # 10×A 锚,仅 A 连续超标
        self._shot(tracker, 30.0, bucket="manying_t2i|ckptA")
        self.assertTrue(tracker.is_degraded("manying_t2i|ckptA"))
        self.assertFalse(tracker.is_degraded("manying_t2i|ckptB"))


class DegradationSimulationTests(unittest.TestCase):
    def test_anchored_vs_rolling_anchors(self):
        # C-3: 渐进退化回归钉(1-based)[ref:degrade_sim]——锚定式 40/18/12;
        # 滚动窗对照爬升/陡坡均 None(第 1 轮缺陷钉:滚动基线渐进失明)
        from fixtures import degrade_sim_1024 as sim

        with patch("builtins.print"):
            anchors = sim.run_anchors()
        self.assertEqual(anchors["anchored_ramp_100"], 40)
        self.assertEqual(anchors["anchored_steep_30"], 18)
        self.assertEqual(anchors["anchored_step"], 12)
        self.assertIsNone(anchors["rolling_ramp_100"])
        self.assertIsNone(anchors["rolling_steep_30"])
        self.assertEqual(anchors["rolling_step"], 12)


class AnchorStalenessSelfHealTests(unittest.TestCase):
    def _degrade(self, tracker: DegradeTracker, generation: float) -> None:
        for _ in range(5):
            self._shot(tracker, 3.0, generation)
        self._shot(tracker, 22.0, generation)
        self._shot(tracker, 22.0, generation)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))

    def _shot(self, tracker: DegradeTracker, seconds: float, generation: float,
              bucket: str = "t2i|ckpt") -> None:
        with patch("builtins.print"):
            tracker.record_shot(bucket=bucket, steps=1, history_entry=None, wall_s=seconds,
                                engine_started_at=generation)

    def test_persist_after_free_reanchors_once_per_generation(self):
        # C-7: 确认退化→/free 后仍持续超标 10 发→自动重锚+复位;每世代至多一次
        tracker = DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3,
                                 exceed_persist=10, free_min_interval_s=0.0)
        generation = time.time() - 7 * 3600  # 世代 token 与 uptime 基准同源
        self._degrade(tracker, generation)
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock:
            tracker.pre_submit("http://127.0.0.1:17598", started_at=generation)
        free_mock.assert_called_once()
        for _ in range(9):
            self._shot(tracker, 22.0, generation)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))  # 9 发未达 10
        self._shot(tracker, 22.0, generation)  # 第 10 发:锚过时自愈
        self.assertFalse(tracker.is_degraded("t2i|ckpt"))
        self.assertAlmostEqual(tracker.anchor_of("t2i|ckpt"), 22.0)  # 最近 5 发中位重锚
        # 第二循环:不再自愈(reanchored 已置位,每世代至多一次)
        for _ in range(2):
            self._shot(tracker, 100.0, generation)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))
        with patch.object(engine_health, "free_memory", return_value=True):
            tracker.pre_submit("http://127.0.0.1:17598", started_at=generation)
        for _ in range(10):
            self._shot(tracker, 100.0, generation)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))
        self.assertAlmostEqual(tracker.anchor_of("t2i|ckpt"), 22.0)  # 锁定不再漂


class PreSubmitFreeTests(unittest.TestCase):
    def _degraded_tracker(self, generation: float | None = GENERATION,
                          interval: float = 1800.0) -> DegradeTracker:
        tracker = DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3,
                                 exceed_persist=10, free_min_interval_s=interval)
        with patch("builtins.print"):
            for _ in range(5):
                tracker.record_shot(bucket="t2i|ckpt", steps=1, history_entry=None, wall_s=3.0,
                                    engine_started_at=generation)
            for _ in range(2):
                tracker.record_shot(bucket="t2i|ckpt", steps=1, history_entry=None, wall_s=22.0,
                                    engine_started_at=generation)
        self.assertTrue(tracker.is_degraded("t2i|ckpt"))
        return tracker

    def test_free_fires_once_and_respects_interval(self):
        # C-8a: 确认退化 DEGRADE_FREE=1 → /free 一次;限频窗内二次不再发
        generation = time.time() - 7 * 3600
        tracker = self._degraded_tracker(generation=generation)
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            tracker.pre_submit("http://127.0.0.1:17598", started_at=generation)
            tracker.pre_submit("http://127.0.0.1:17598", started_at=generation)
        self.assertEqual(free_mock.call_count, 1)

    def test_free_disabled_by_env(self):
        # C-8b: DEGRADE_FREE=0 → 不发
        generation = time.time() - 7 * 3600
        tracker = self._degraded_tracker(generation=generation)
        with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_DEGRADE_FREE": "0"}), patch.object(
            engine_health, "free_memory", return_value=True
        ) as free_mock, patch("builtins.print"):
            tracker.pre_submit("http://127.0.0.1:17598", started_at=generation)
        free_mock.assert_not_called()

    def test_uptime_gate_below_threshold_skips_disposal(self):
        # C-10: uptime 门槛——运行 1h(<6h)只记日志不处置;7h 正常处置;
        # startedAt 恒未知(世代 token=None)按满足处置(记日志)
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            young_generation = time.time() - 3600
            young = self._degraded_tracker(generation=young_generation)
            young.pre_submit("http://127.0.0.1:17598", started_at=young_generation)
        free_mock.assert_not_called()
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            mature_generation = time.time() - 7 * 3600
            mature = self._degraded_tracker(generation=mature_generation)
            mature.pre_submit("http://127.0.0.1:17598", started_at=mature_generation)
        self.assertEqual(free_mock.call_count, 1)
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock, patch("builtins.print"):
            unknown = self._degraded_tracker(generation=None)
            unknown.pre_submit("http://127.0.0.1:17598", started_at=None)
        self.assertEqual(free_mock.call_count, 1)  # 未知 uptime 按满足→发了一次

    def test_free_memory_swallows_transport_errors(self):
        # C-8c: /free 抛 OSError → 吞错不阻塞(恒 False 恒不抛)
        with patch.object(engine_health.request, "urlopen", side_effect=OSError("engine busy")):
            self.assertFalse(free_memory("http://127.0.0.1:17598"))

    def test_pre_submit_noop_when_not_degraded(self):
        tracker = DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3, exceed_persist=10)
        with patch.object(engine_health, "free_memory", return_value=True) as free_mock:
            tracker.pre_submit("http://127.0.0.1:17598", started_at=time.time() - 7 * 3600)
        free_mock.assert_not_called()


class MaybeRestartEngineTests(unittest.TestCase):
    def _degraded_module_tracker(self) -> None:
        tracker = DegradeTracker(ratio=3.0, anchor_n=5, strikes_needed=2, recover_n=3, exceed_persist=10)
        with patch("builtins.print"):
            for _ in range(5):
                tracker.record_shot(bucket="t2i|ckpt", steps=1, history_entry=None, wall_s=3.0,
                                    engine_started_at=GENERATION)
            for _ in range(2):
                tracker.record_shot(bucket="t2i|ckpt", steps=1, history_entry=None, wall_s=22.0,
                                    engine_started_at=GENERATION)
        # 换入 module 单例(maybe_restart_engine 读它);addCleanup 恢复,防跨测试污染
        patcher = patch.object(engine_health, "_tracker", tracker)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_default_off_always_false(self):
        # C-9a: DEGRADE_RESTART 默认关 → 恒 False(退化态也不动)
        self._degraded_module_tracker()
        with patch.dict(os.environ, {}, clear=True), patch.object(engine_health, "_queue_empty", return_value=True):
            self.assertFalse(engine_health.maybe_restart_engine("http://127.0.0.1:17598"))

    def test_restart_only_when_all_guards_pass(self):
        # C-9b: 开关开+/queue 双连探空+_proc 活+端口吻合+execute jobs 空闲 → 调 restart
        self._degraded_module_tracker()
        fake_manager = MagicMock()
        fake_manager._proc.poll.return_value = None
        fake_manager._running_port = 17598
        fake_jobs = MagicMock()
        fake_jobs.active_of.return_value = None
        with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_DEGRADE_RESTART": "1"}), patch.object(
            engine_health, "_queue_empty", return_value=True
        ), patch.object(engine_health.time, "sleep"), patch(
            "comfyui.engine_manager.engine_manager", return_value=fake_manager
        ), patch("comfyui.engine_manager.jobs", fake_jobs):
            self.assertTrue(engine_health.maybe_restart_engine("http://127.0.0.1:17598"))
        fake_manager.restart.assert_called_once()

    def test_restart_refused_when_any_guard_fails(self):
        # C-9c: 任一不满足 → False(队列占用/进程死/端口不吻合/execute 在跑)
        cases = {
            "queue_busy": {"queue_empty": False},
            "proc_dead": {"proc_poll": 1},
            "port_mismatch": {"port": 17599},
            "execute_busy": {"execute_job": object()},
        }
        for name, overrides in cases.items():
            with self.subTest(case=name):
                self._degraded_module_tracker()
                fake_manager = MagicMock()
                fake_manager._proc.poll.return_value = overrides.get("proc_poll")
                fake_manager._running_port = overrides.get("port", 17598)
                fake_jobs = MagicMock()
                fake_jobs.active_of.return_value = overrides.get("execute_job")
                with patch.dict(os.environ, {"MYSTUDIO_COMFYUI_DEGRADE_RESTART": "1"}), patch.object(
                    engine_health, "_queue_empty", return_value=overrides.get("queue_empty", True)
                ), patch.object(engine_health.time, "sleep"), patch(
                    "comfyui.engine_manager.engine_manager", return_value=fake_manager
                ), patch("comfyui.engine_manager.jobs", fake_jobs):
                    self.assertFalse(engine_health.maybe_restart_engine("http://127.0.0.1:17598"))
                fake_manager.restart.assert_not_called()


if __name__ == "__main__":
    unittest.main()
