"""generate_image 并发互斥回归(09-01 稳定性浸泡实锤)。

背景:08-31 引擎拆分重构把旧 _generate_qwen 的 generation-busy 互斥丢在了新
分发器外——引擎组件(scheduler/管线)是进程级共享可变状态,并发 generate 互踩
(实弹双 500 index out of bounds)。此处钉死三条:并发串行化/排队成功/超时正忙。
"""
import threading
import time
import unittest
from unittest import mock

from image_gen import pipeline
from image_gen.pipeline import PipelineError


class _FakeEngine:
    SUPPORTS_REFERENCE = True
    SMALL_REPO = None

    def __init__(self):
        self._guard = threading.Lock()
        self.active = 0
        self.max_active = 0

    def generate(self, prompt, **_kwargs):
        with self._guard:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.25)
        with self._guard:
            self.active -= 1
        return "aGk="


class GenerateImageConcurrencyTest(unittest.TestCase):
    def setUp(self):
        self.assertTrue(pipeline._lock.acquire(False), "锁被残留持有,测试环境不干净")
        pipeline._lock.release()
        self.engine = _FakeEngine()
        spec = {"label": "假引擎", "layout": "fake", "steps": 8}
        patches = [
            mock.patch.dict(pipeline._ENGINE_BY_LAYOUT, {"fake": self.engine}),
            mock.patch.dict(pipeline.IMAGE_MODELS, {"fake-model": spec}),
            mock.patch.object(pipeline, "_require_downloaded", lambda _name: None),
            mock.patch.object(pipeline, "comfyui_models_dir", lambda: "/tmp/fake-models"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _call(self):
        return pipeline.generate_image("fake-model", "p")

    def test_concurrent_generate_serialized(self):
        """两路并发必须串行(max_active==1)且双双成功,不再互踩 500。"""
        results, errors = [], []

        def worker():
            try:
                results.append(self._call())
            except Exception as exc:  # noqa: BLE001
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)
        self.assertEqual(errors, [])
        self.assertEqual(sorted(results), ["aGk=", "aGk="])
        self.assertEqual(self.engine.max_active, 1, "引擎被并发重入——共享状态会被互踩")

    def test_lock_timeout_reports_busy(self):
        """锁被长期占满时按 generation-busy 拒绝(可操作文案),不空转不崩溃。"""
        pipeline._lock.acquire()
        try:
            with mock.patch.object(pipeline, "_GENERATION_LOCK_TIMEOUT_S", 0.2):
                with self.assertRaises(PipelineError) as ctx:
                    self._call()
            self.assertEqual(ctx.exception.code, "generation-busy")
        finally:
            pipeline._lock.release()
        # 锁释放后应立即恢复可用
        self.assertEqual(self._call(), "aGk=")


if __name__ == "__main__":
    unittest.main()
