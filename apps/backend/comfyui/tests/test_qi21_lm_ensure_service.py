"""1102 按需拉起契约:LM Studio 由扩写节点用时拉起,看门狗链退役。

隔离加载 my_qi21_api_pe(spec_from_file_location,不走 my_nodes/__init__
注册链——顶层虽纯标准库,包 init 会拖 ComfyUI 本体,测试环境没有)。
覆盖 _ensure_lm_service 全分支:非本机不拉/起服务参数/env 注入/装载
参数/超时放弃/装载超时仍放行/lms.exe 缺件。
"""
from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path
from unittest import mock

NODE_FILE = (Path(__file__).resolve().parents[1]
             / 'my_nodes' / 'nodes' / 'my_qi21_api_pe.py')
_spec = importlib.util.spec_from_file_location('qi21_pe_isolated', NODE_FILE)
pe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pe)


class TestEnsureLmService(unittest.TestCase):
    """patch 恒类 setUp 作用域(共享模块实例,全局 patch 会串测试)。"""

    def setUp(self):
        patches = [
            mock.patch.object(pe, '_is_local_win_target', return_value=True),
            mock.patch.object(pe.os.path, 'exists', return_value=True),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _mk(self, greeting_seq, loaded, popen_exc=None, run_result=None,
            run_exc=None):
        """组装 mock:popen/run/greeting/any_loaded 一次性注入。"""
        popen = mock.Mock(side_effect=[popen_exc] if popen_exc else [None])
        run = mock.Mock(
            side_effect=[run_exc] if run_exc else [run_result or mock.Mock(returncode=0)])
        grt = mock.Mock(side_effect=greeting_seq)
        ldr = mock.Mock(return_value=loaded)
        for p, tgt in ((mock.patch.object(pe.subprocess, 'Popen', popen), 'Popen'),
                       (mock.patch.object(pe.subprocess, 'run', run), 'run'),
                       (mock.patch.object(pe, '_lm_greeting', grt), 'greeting'),
                       (mock.patch.object(pe, '_lm_any_loaded', ldr), 'loaded')):
            p.start()
            self.addCleanup(p.stop)
        return popen, run, grt, ldr

    def test_not_local_target_never_pulls(self):
        with mock.patch.object(pe, '_is_local_win_target', return_value=False), \
             mock.patch.object(pe.subprocess, 'Popen') as popen:
            self.assertFalse(pe._ensure_lm_service('http://10.9.9.9:1234', 'm'))
            popen.assert_not_called()

    def test_lms_exe_missing_returns_false(self):
        with mock.patch.object(pe.os.path, 'exists', return_value=False), \
             mock.patch.object(pe.subprocess, 'Popen') as popen:
            self.assertFalse(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))
            popen.assert_not_called()

    def test_server_and_model_ready_skips_load(self):
        popen, run, grt, ldr = self._mk([True], loaded=True)
        self.assertTrue(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))
        run.assert_not_called()  # 模型在位=零装载(幂等快路径)

    def test_server_start_argv_and_env_injection(self):
        popen, *_ = self._mk([True], loaded=True)
        pe._ensure_lm_service('http://127.0.0.1:1234', 'm')
        argv = popen.call_args[0][0]
        self.assertEqual(argv, [pe._LMS_EXE, 'server', 'start', '--bind', '0.0.0.0'])
        env = popen.call_args[1]['env']
        self.assertEqual(env['USERPROFILE'], pe._LMS_ENV['USERPROFILE'])
        self.assertEqual(env['APPDATA'], pe._LMS_ENV['APPDATA'])
        self.assertTrue(popen.call_args[1]['creationflags'] & 0x8)  # DETACHED_PROCESS

    def test_load_invoked_with_watchdog_recipe_when_no_model(self):
        popen, run, _, _ = self._mk([True], loaded=False)
        self.assertTrue(pe._ensure_lm_service('http://192.168.0.101:1234', 'my-9b'))
        argv = run.call_args[0][0]
        self.assertEqual(argv[:6], [pe._LMS_EXE, 'load', '--gpu', 'max',
                                    '--parallel', '1'])
        self.assertEqual(argv[6:9], ['-c', '32768', '-y'])
        self.assertEqual(argv[9], 'my-9b')
        self.assertEqual(run.call_args[1]['timeout'], pe._LM_ENSURE_LOAD_BUDGET)

    def test_load_timeout_still_returns_true_to_try_request(self):
        import subprocess as real_sp
        popen, run, _, _ = self._mk(
            [True], loaded=False,
            run_exc=real_sp.TimeoutExpired(cmd='lms', timeout=300))
        self.assertTrue(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))

    def test_greeting_never_ready_gives_up(self):
        with mock.patch.object(pe, '_LM_ENSURE_SERVER_BUDGET', 0):
            popen, run, grt, _ = self._mk([False], loaded=False)
            self.assertFalse(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))
            run.assert_not_called()  # 服务没起成=不装载

    def test_popen_failure_returns_false(self):
        popen, run, _, _ = self._mk([], loaded=False,
                                    popen_exc=OSError('boom'))
        self.assertFalse(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))


class TestIsLocalWinTarget(unittest.TestCase):

    def test_non_windows_never_local(self):
        with mock.patch.object(pe.os, 'name', 'posix'):
            self.assertFalse(pe._is_local_win_target('http://127.0.0.1:1234'))

    def test_loopback_is_local_on_windows(self):
        with mock.patch.object(pe.os, 'name', 'nt'):
            self.assertTrue(pe._is_local_win_target('http://127.0.0.1:1234'))
            self.assertTrue(pe._is_local_win_target('http://localhost:1234'))

    def test_foreign_host_not_local(self):
        with mock.patch.object(pe.os, 'name', 'nt'):
            self.assertFalse(pe._is_local_win_target('https://api.bigmodel.cn/v4'))


if __name__ == '__main__':
    unittest.main()


class TestFirewallSelfHealAndProgress(unittest.TestCase):
    """1102 增补:防火墙 Block 自愈(60s 触发一次)与进度上报载荷。"""

    def setUp(self):
        patches = [
            mock.patch.object(pe, '_is_local_win_target', return_value=True),
            mock.patch.object(pe.os.path, 'exists', return_value=True),
            mock.patch.object(pe.subprocess, 'Popen', mock.Mock(return_value=None)),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_firewall_heal_fires_once_after_60s_then_gives_up(self):
        import itertools
        clock = itertools.count(start=0, step=8)  # 每轮两取=+16s/轮
        with mock.patch.object(pe, '_LM_ENSURE_SERVER_BUDGET', 120), \
             mock.patch.object(pe.time, 'time', side_effect=lambda: next(clock)), \
             mock.patch.object(pe.time, 'sleep'), \
             mock.patch.object(pe, '_lm_greeting', return_value=False), \
             mock.patch.object(pe, '_disable_lm_block_rules',
                               side_effect=lambda: None) as fw:
            self.assertFalse(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))
            fw.assert_called_once()  # 恰一次(60s 后),不重复触发

    def test_firewall_heal_skipped_when_server_up_fast(self):
        with mock.patch.object(pe, '_lm_greeting', return_value=True), \
             mock.patch.object(pe, '_lm_any_loaded', return_value=True), \
             mock.patch.object(pe, '_disable_lm_block_rules') as fw:
            self.assertTrue(pe._ensure_lm_service('http://127.0.0.1:1234', 'm'))
            fw.assert_not_called()

    def test_progress_payload_and_none_node_id_short_circuit(self):
        import sys as real_sys
        sink = mock.Mock()
        fake_server = mock.Mock()
        # 访问链对齐真实形态:from server import PromptServer → PromptServer.instance.send_sync
        fake_server.PromptServer.instance.send_sync = sink
        with mock.patch.dict(real_sys.modules, {'server': fake_server}):
            pe._lm_progress('msg-A', '42')
            sink.assert_called_once_with(
                'my_lm_pull_progress', {'node_id': '42', 'msg': 'msg-A'})
        # node_id 缺席(旧引擎/直投无 hidden)→零发送零异常
        sink.reset_mock()
        pe._lm_progress('msg-B', None)
        sink.assert_not_called()

    def test_disable_block_rules_powershell_argv(self):
        with mock.patch.object(pe.subprocess, 'run') as run:
            pe._disable_lm_block_rules()
            argv = run.call_args[0][0]
            self.assertEqual(argv[:3], ['powershell', '-NoProfile', '-Command'])
            self.assertIn("Disable-NetFirewallRule", argv[3])
            self.assertIn("'LM Studio'", argv[3])
