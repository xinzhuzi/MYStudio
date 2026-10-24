"""comfy_fire_core 离线单测(10-24 stable-fire-core)。

全离线: 合成图(PIL/numpy) + FakeTransport 注入, 零引擎发包。
跑法: python3 apps/build/scripts/test_comfy_fire_core.py
"""
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import comfy_fire_core as fc  # noqa: E402

import numpy as np
from PIL import Image


def png_bytes(arr, mode='RGB') -> bytes:
    buf = io.BytesIO()
    Image.fromarray(arr.astype('uint8'), mode=mode).save(buf, format='PNG')
    return buf.getvalue()


def content_img(fg_val=90, bg_val=250, size=512) -> bytes:
    """白底+中心深色方块(≈25% 前景) 的合格图。"""
    a = np.full((size, size, 3), bg_val, dtype=np.uint8)
    a[size // 4:size * 3 // 4, size // 4:size * 3 // 4] = fg_val
    return png_bytes(a)


class FakeTransport:
    """可编排假引擎: queue/alive/history/view_bytes/post_handler 由测试注入。"""

    def __init__(self, queue=None, alive=True, history=None, view_bytes=b'',
                 post_handler=None):
        self.queue = queue if queue is not None else {'queue_running': [], 'queue_pending': []}
        self.alive = alive
        self.history = history or {}
        self.view_bytes = view_bytes
        self.post_handler = post_handler
        self.calls = []

    def get_json(self, path, timeout=10):
        self.calls.append(('GET', path))
        if path == '/queue':
            return self.queue
        if path == '/system_stats':
            if not self.alive:
                raise ConnectionError('down')
            return {}
        if path.startswith('/history/'):
            return self.history
        raise AssertionError(f'unexpected GET {path}')

    def post_json(self, path, payload, timeout=30):
        self.calls.append(('POST', path))
        if self.post_handler is not None:
            return self.post_handler(path, payload)
        raise AssertionError(f'unexpected POST {path}')

    def fetch_bytes(self, path, timeout=300):
        self.calls.append(('FETCH', path))
        return self.view_bytes


class TestClassifyFailure(unittest.TestCase):
    """缺陷①: 门禁类确定性失败必须与空片判废/瞬时失败分开。"""

    def test_waste_family(self):
        for msg in ('3.金丹期-poster 空片嫌疑: 文件仅56KB(<400KB), 弃用',
                    'tag 空片: 非背景占比0.0%(<8%), 弃用',
                    'tag 画幅门禁: 1024×1024 比1.000 出 1.78±0.05',
                    'tag alpha 门禁: 全透占比42.0%(>10%) 判失败重掷'):
            self.assertEqual(fc.classify_failure(RuntimeError(msg)), 'waste', msg)

    def test_deterministic_family(self):
        for msg in ('2.筑基期-poster 引擎报错: 门禁拒单: 主体句含违禁词',
                    'node_errors: Return type mismatch',
                    'upload 三层防线③: 引擎实载 md5 不一致——停线',
                    '参考背景态断言不过: 不透明70.0%(需≥80)',
                    '模板缺节点: [11]'):
            self.assertEqual(fc.classify_failure(RuntimeError(msg)), 'deterministic', msg)

    def test_transient_family_and_default(self):
        for exc in (TimeoutError('tag 超时(900s)'),
                    RuntimeError('URLError: Connection refused'),
                    RuntimeError('HTTP 500 Bad Gateway')):
            self.assertEqual(fc.classify_failure(exc), 'transient', str(exc))
        # 未知错误默认 transient(受队列闸保护, 不失旧脚本的重试机会)
        self.assertEqual(fc.classify_failure(RuntimeError('奇怪的新错误')), 'transient')

    def test_realworld_http_rejection_forms(self):
        """真实引擎异常形态(grill 1024 #3): 4xx 拒单=确定性, 5xx=瞬时。"""
        e400 = RuntimeError('拒单 HTTP 400: {"error":{"type":"prompt_outputs_failed_validation",'
                            '"node_errors":{"400":"Return type mismatch"}}}')
        self.assertEqual(fc.classify_failure(e400), 'deterministic')
        e500 = RuntimeError('HTTP 500: Internal Server Error')
        self.assertEqual(fc.classify_failure(e500), 'transient')

    def test_realworld_engine_gate_message(self):
        """引擎执行错误带 status.messages 节点异常文本(含门禁字样)→确定性。"""
        e = RuntimeError("t 引擎报错: error [['execution_error', '门禁拒单: 主体句含违禁词']]")
        self.assertEqual(fc.classify_failure(e), 'deterministic')

    def test_realworld_output_missing(self):
        """图成功但无目标前缀输出=确定性(重掷=整跑白烧)。"""
        e = RuntimeError('t 输出缺失(确定性): 无 MYStudio-2K 输出')
        self.assertEqual(fc.classify_failure(e), 'deterministic')


class TestAnchorModeEnv(unittest.TestCase):
    """锚口径 env: ring 默认/pixel 显式/垃圾值回落 ring。"""

    def test_anchor_mode_env(self):
        with mock.patch.dict(os.environ, {'MYSTUDIO_FIRE_ANCHOR': 'PIXEL'}):
            self.assertEqual(fc.anchor_mode(), 'pixel')
        with mock.patch.dict(os.environ, {'MYSTUDIO_FIRE_ANCHOR': 'garbage'}):
            self.assertEqual(fc.anchor_mode(), 'ring')
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop('MYSTUDIO_FIRE_ANCHOR', None)
            self.assertEqual(fc.anchor_mode(), 'ring')


class TestDeadlineEnv(unittest.TestCase):
    """缺陷③: deadline 可配置, 非法值回落默认。"""

    def test_env_override_and_fallback(self):
        with mock.patch.dict(os.environ, {'MYSTUDIO_FIRE_DEADLINE_S': '1200'}):
            self.assertEqual(fc.deadline_s(), 1200.0)
        with mock.patch.dict(os.environ, {'MYSTUDIO_FIRE_DEADLINE_S': 'abc'}):
            self.assertEqual(fc.deadline_s(), 900.0)
        with mock.patch.dict(os.environ, {'MYSTUDIO_FIRE_DEADLINE_S': '-5'}):
            self.assertEqual(fc.deadline_s(), 900.0)


class TestQueueGate(unittest.TestCase):
    """缺陷②: 队列清零闸 fail-closed, 非空/查询失败都不得放行重掷。"""

    def test_clear_when_both_empty(self):
        self.assertTrue(fc.queue_clear(FakeTransport()))

    def test_busy_when_running_or_pending(self):
        self.assertFalse(fc.queue_clear(FakeTransport(
            queue={'queue_running': [{'x': 1}], 'queue_pending': []})))
        self.assertFalse(fc.queue_clear(FakeTransport(
            queue={'queue_running': [], 'queue_pending': ['p1']})))

    def test_fail_closed_on_query_error(self):
        tr = FakeTransport()
        tr.get_json = lambda path, timeout=10: (_ for _ in ()).throw(ConnectionError('down'))
        self.assertFalse(fc.queue_clear(tr))


class TestBlankGates(unittest.TestCase):
    """阈值不变 + 缺陷④: 边界环锚修复角落纹理误判。"""

    def test_min_bytes(self):
        with self.assertRaisesRegex(RuntimeError, '空片嫌疑'):
            fc.blank_gates(b'\x89PNG' + b'0' * 1000, 't')

    def test_low_fg_rejected(self):
        flat = png_bytes(np.full((512, 512, 3), 250, dtype=np.uint8))
        with self.assertRaisesRegex(RuntimeError, '非背景占比'):
            fc.blank_gates(flat, 't', min_bytes=1_000)

    def test_good_image_passes_with_stats(self):
        s = fc.blank_gates(content_img(), 't', min_bytes=1_000)
        self.assertEqual(s['w'], 512)
        self.assertGreater(s['fg'], 0.2)
        self.assertEqual(s['full_trans'], 0.0)

    def test_ring_anchor_fixes_pixel_false_negative(self):
        """缺陷④的漏判面: 真前景仅≈5%(<8% 应拦)但旧锚位落深色脏斑——
        pixel 锚=60 → 背景(250)全被当前景 → fg≈100% 放行(漏判);
        ring 锚=边界环中位≈250 → 按真实占比拦截。"""
        a = np.full((512, 512, 3), 250, dtype=np.uint8)
        a[0:114, 0:114] = 90  # 左上角块 ≈4.9% 真前景(含旧锚位 [20,20])
        b = png_bytes(a)
        with self.assertRaisesRegex(RuntimeError, '非背景占比'):
            fc.blank_gates(b, 't', min_bytes=1_000, mode='ring')  # 正确拦截
        s_pixel = fc.blank_gates(b, 't', min_bytes=1_000, mode='pixel')  # 旧口径: 虚高放行(漏判面在案)
        self.assertGreater(s_pixel['fg'], 0.9, 'pixel 锚前景占比应虚高≈100%')

    def test_rgba_green_path_white_composite(self):
        """②路在役产物形态绿路径: RGBA 白底合成+环锚过门(白底+深主体+少量全透<10%)。"""
        a = np.full((512, 512, 4), 250, dtype=np.uint8)
        a[..., 3] = 255
        a[128:384, 128:384, :3] = 90  # 深色主体 ≈25%
        a[0:30, 0:30, 3] = 0  # 0.3% 全透
        buf = io.BytesIO()
        Image.fromarray(a, mode='RGBA').save(buf, format='PNG')
        s = fc.blank_gates(buf.getvalue(), 't', min_bytes=1_000, max_full_trans=0.10)
        self.assertLess(s['full_trans'], 0.01)
        self.assertGreater(s['fg'], 0.2)  # 白底合成后按真实主体占比量得

    def test_alpha_gate(self):
        a = np.full((512, 512, 4), 250, dtype=np.uint8)
        a[..., 3] = 255
        a[0:256, :, 3] = 0  # 上半全透=50%>10%
        buf = io.BytesIO()
        Image.fromarray(a, mode='RGBA').save(buf, format='PNG')
        with self.assertRaisesRegex(RuntimeError, 'alpha 门禁'):
            fc.blank_gates(buf.getvalue(), 't', min_bytes=1_000, max_full_trans=0.10)

    def test_ratio_gate(self):
        with self.assertRaisesRegex(RuntimeError, '画幅门禁'):
            fc.blank_gates(content_img(size=512), 't', min_bytes=1_000, want_ratio=1.78)


class TestFireDiscipline(unittest.TestCase):
    """缺陷①②的收口: 确定性失败一掷即止; waste/transient 重掷前过队列闸。"""

    @staticmethod
    def make_fire(exc_seq):
        calls = {'n': 0, 'seeds': []}

        def fire(seed):
            calls['seeds'].append(seed)
            if calls['n'] < len(exc_seq):
                calls['n'] += 1
                raise exc_seq[calls['n'] - 1]
            return 'ok'

        return fire, calls

    def test_deterministic_no_reroll(self):
        fire, calls = self.make_fire([RuntimeError('门禁拒单: 主体句违禁')])
        tr = FakeTransport(alive=False)  # 引擎死也不该触发重掷路径
        logs = []
        rc, cls = fc.fire_with_discipline(fire, 5, 't', tr, logs.append)
        self.assertEqual(rc, 1)
        self.assertEqual(cls, 'deterministic')
        self.assertEqual(calls['seeds'], [5])  # 只有一掷, 无白烧
        self.assertIn('不重掷直报', ''.join(logs))

    def test_waste_rerolls_once_with_queue_gate(self):
        fire, calls = self.make_fire([RuntimeError('t 空片: 非背景占比0.0%')])
        tr = FakeTransport(queue={'queue_running': [], 'queue_pending': []})
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 7, 't', tr, lambda m: None,
                                              queue_wait_s=5, engine_wait_s=5)
        self.assertEqual(rc, 0)
        self.assertEqual(calls['seeds'], [7, 1007])  # 重掷 seed+1000
        self.assertTrue(any(p == '/queue' for _, p in tr.calls))  # 队列闸实际查过

    def test_transient_blocked_by_busy_queue(self):
        """队列非空(第一单可能仍在跑)→ 停线不重掷(12 连败防线)。"""
        fire, calls = self.make_fire([TimeoutError('t 超时(900s)')])
        tr = FakeTransport(queue={'queue_running': [{'id': 'first'}], 'queue_pending': []})
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 3, 't', tr, lambda m: None,
                                              queue_wait_s=0.2, engine_wait_s=5)
        self.assertEqual(rc, 1)
        self.assertIn('queue-busy', cls)
        self.assertEqual(calls['seeds'], [3])  # 未重掷

    def test_reroll_failure_stops_at_two(self):
        fire, calls = self.make_fire([RuntimeError('t 空片嫌疑: 56KB'), RuntimeError('t 空片: 0%')])
        tr = FakeTransport()
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 9, 't', tr, lambda m: None,
                                              queue_wait_s=5, engine_wait_s=5)
        self.assertEqual(rc, 1)
        self.assertEqual(calls['seeds'], [9, 1009])  # 两掷即止, 无第三掷

    def test_reroll_failure_reports_reroll_class(self):
        """R2-N1: 重掷失败上报重掷自身分类(最新引擎状态证据)——
        首掷 waste+重掷超时 → 上报 transient(批层停线), 不得被 waste 掩盖。"""
        fire, calls = self.make_fire([RuntimeError('t 空片: 非背景占比0.0%'),
                                      TimeoutError('t 超时(900s)')])
        tr = FakeTransport()
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 13, 't', tr, lambda m: None,
                                              queue_wait_s=5, engine_wait_s=5)
        self.assertEqual(rc, 1)
        self.assertEqual(cls, 'transient+reroll-failed')
        self.assertEqual(calls['seeds'], [13, 1013])

    def test_reroll_deterministic_failure_lets_batch_continue(self):
        """R2-N5: 首掷 transient+重掷确定性拒单 → 上报 deterministic(批层可续跑)。"""
        fire, calls = self.make_fire([TimeoutError('t 超时(900s)'),
                                      RuntimeError('拒单 HTTP 400: node_errors')])
        tr = FakeTransport()
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 15, 't', tr, lambda m: None,
                                              queue_wait_s=5, engine_wait_s=5)
        self.assertEqual(rc, 1)
        self.assertEqual(cls, 'deterministic+reroll-failed')

    def test_transient_reroll_success(self):
        """瞬时失败过闸重掷成功路(rc=0, seed+1000)。"""
        fire, calls = self.make_fire([TimeoutError('t 超时(900s)')])
        tr = FakeTransport()
        with mock.patch('time.sleep'):
            rc, cls = fc.fire_with_discipline(fire, 11, 't', tr, lambda m: None,
                                              queue_wait_s=5, engine_wait_s=5)
        self.assertEqual(rc, 0)
        self.assertEqual(cls, 'transient+rerolled')
        self.assertEqual(calls['seeds'], [11, 1011])


class TestSubmitAwaitOutput(unittest.TestCase):
    """核心传输层四路覆盖(grill 1024 #4: 此前零单测)。"""

    @staticmethod
    def _rec(status='success', images=None, messages=None):
        rec = {'status': {'status_str': status}, 'outputs': {}}
        if messages is not None:
            rec['status']['messages'] = messages
        if images:
            rec['outputs'] = {'504': {'images': images}}
        return rec

    def test_submit_ok(self):
        tr = FakeTransport(post_handler=lambda p, pl: {'prompt_id': 'p1'})
        self.assertEqual(fc.submit(tr, {'n': 1}, 'c'), 'p1')

    def test_submit_node_errors_deterministic(self):
        tr = FakeTransport(post_handler=lambda p, pl: {'node_errors': {'400': 'Return type mismatch'}})
        with self.assertRaises(RuntimeError) as cm:
            fc.submit(tr, {'n': 1}, 'c')
        self.assertEqual(fc.classify_failure(cm.exception), 'deterministic')

    def test_submit_no_prompt_id(self):
        tr = FakeTransport(post_handler=lambda p, pl: {})
        with self.assertRaisesRegex(RuntimeError, '引擎未返回任务编号'):
            fc.submit(tr, {'n': 1}, 'c')

    def test_await_output_success(self):
        img = {'filename': 'MYStudio-2K_0001.png', 'subfolder': '', 'type': 'output'}
        blob = content_img()
        tr = FakeTransport(history={'p1': self._rec(images=[img])}, view_bytes=blob)
        with mock.patch('time.sleep'):
            self.assertEqual(fc.await_output(tr, 'p1', 't', filename_prefix='MYStudio-2K',
                                             timeout=30), blob)

    def test_await_output_engine_gate_error_deterministic(self):
        rec = self._rec(status='error', messages=[['execution_error', '门禁拒单: 主体句含违禁词']])
        tr = FakeTransport(history={'p1': rec})
        with mock.patch('time.sleep'), self.assertRaises(RuntimeError) as cm:
            fc.await_output(tr, 'p1', 't', timeout=30)
        self.assertEqual(fc.classify_failure(cm.exception), 'deterministic')

    def test_await_output_no_prefix_output_deterministic(self):
        tr = FakeTransport(history={'p1': self._rec(images=[{'filename': 'ComfyUI_0001.png'}])})
        with mock.patch('time.sleep'), self.assertRaises(RuntimeError) as cm:
            fc.await_output(tr, 'p1', 't', filename_prefix='MYStudio-2K', timeout=30)
        self.assertIn('输出缺失', str(cm.exception))
        self.assertEqual(fc.classify_failure(cm.exception), 'deterministic')

    def test_await_output_timeout_transient(self):
        tr = FakeTransport(history={})
        with mock.patch('time.sleep'), self.assertRaises(TimeoutError) as cm:
            fc.await_output(tr, 'p1', 't', timeout=0.05)
        self.assertEqual(fc.classify_failure(cm.exception), 'transient')


class TestKvIdempotentForce(unittest.TestCase):
    """缺陷③入口层: 幂等跳过默认, --force --seed 显式重做通道(kv 入口)。"""

    def test_skip_when_exists_and_force_reruns(self):
        import yanliao_kv_viewsheet_1023 as kv
        with tempfile.TemporaryDirectory() as td:
            calls = []
            orig = (kv.OUT, kv.log, kv.fire_once)
            kv.OUT = Path(td)
            kv.log = lambda m: None
            kv.fire_once = lambda stage, kind, seed: (calls.append(seed), Path(td) / 'x')[1]
            try:
                dest = kv.OUT / '晏燎_筑基期_海报_v1.png'  # stage_base('2.筑基期')='筑基期'
                dest.write_bytes(b'exists')
                self.assertEqual(kv.fire_shot('2.筑基期', 'poster'), 0)
                self.assertEqual(calls, [])  # 幂等: 已存在零发包
                self.assertEqual(kv.fire_shot('2.筑基期', 'poster', seed=5, force=True), 0)
                self.assertEqual(calls, [5])  # force: 显式重做一发
            finally:
                kv.OUT, kv.log, kv.fire_once = orig


if __name__ == '__main__':
    unittest.main(verbosity=2)
