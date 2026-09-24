"""net_speed 离线单测(09-24 下载前测速+pip 镜像)——零网络:打模块级名字
(_probe_line/outbound_proxy_url,同 test_comfy_hardening 打 net._outbound_proxy_cache
的 house 先例),直改 _route_cache;探测真实 HTTP/线程行为不在本文件(实弹
验证走装机前手动跑 pick_pip_route)。
"""
from __future__ import annotations

import os
import unittest
from unittest import mock

import common.net_speed as net
from common.net_speed import PipRoute

MB = 1024.0 * 1024.0


class NetSpeedTests(unittest.TestCase):
    def setUp(self):
        # 每测隔离:缓存清零 + 摘真机环境(测试机可能真设了 MYSTUDIO_OUTBOUND_PROXY/代理)
        net._route_cache = None
        self.addCleanup(net.invalidate_pip_route)
        env = {k: v for k, v in os.environ.items()
               if k != "MYSTUDIO_OUTBOUND_PROXY" and not k.lower().endswith("_proxy")}
        env_patcher = mock.patch.dict(os.environ, env, clear=True)
        env_patcher.start()
        self.addCleanup(env_patcher.stop)
        proxy_patcher = mock.patch.object(net, "outbound_proxy_url", lambda: None)
        proxy_patcher.start()
        self.addCleanup(proxy_patcher.stop)

    def _patch_speeds(self, speeds: dict[str, float]):
        """按 label 注入罐头探测结果(label 唯一:三镜像+官方源+官方源(直连))。"""
        return mock.patch.object(net, "_probe_line", lambda line: speeds.get(line.label, 0.0))

    # ① 择路排名 + 1.5× 保险
    def test_pick_prefers_fast_mirror_over_slow_official(self):
        with self._patch_speeds({"清华镜像": 35.2 * MB, "官方源(直连)": 0.08 * MB}):
            route = net.pick_pip_route()
        self.assertIsNotNone(route)
        self.assertEqual(route.label, "清华镜像")
        self.assertTrue(route.strip_proxy)
        self.assertFalse(route.is_fallback)
        self.assertEqual(route.index_url, "https://pypi.tuna.tsinghua.edu.cn/simple")

    def test_pick_keeps_current_when_mirror_under_switch_factor(self):
        # 镜像仅 1.2× 于现行线 → 维持现行(境外快网场景自动退化为 09-19 行为)
        with self._patch_speeds({"清华镜像": 1.2 * MB, "官方源(直连)": 1.0 * MB}):
            route = net.pick_pip_route()
        self.assertIsNotNone(route)
        self.assertEqual(route.label, "官方源(直连)")
        self.assertTrue(route.is_fallback)

    def test_pick_direct_strip_line_needs_factor_over_proxy_current(self):
        # 代理在场(现行线=官方+代理):官方直连是改变行为的 strip 线,同样受 1.5× 保险
        with mock.patch.object(net, "outbound_proxy_url", lambda: "http://127.0.0.1:7897"):
            with self._patch_speeds({"官方源": 0.08 * MB, "官方源(直连)": 1.0 * MB}):
                route = net.pick_pip_route()
        self.assertEqual(route.label, "官方源(直连)")
        self.assertTrue(route.strip_proxy)
        self.assertFalse(route.is_fallback)

    # ② 失败兜底
    def test_pick_returns_none_when_all_lines_fail(self):
        with self._patch_speeds({}):
            self.assertIsNone(net.pick_pip_route())

    def test_probe_exception_scores_zero_without_blowing_up(self):
        def _probe(line):
            if line.label == "阿里镜像":
                raise RuntimeError("探测断线")
            return {"清华镜像": 30.0 * MB, "官方源(直连)": 0.08 * MB}.get(line.label, 0.0)

        with mock.patch.object(net, "_probe_line", _probe):
            route = net.pick_pip_route()
        self.assertEqual(route.label, "清华镜像")  # 单线炸=0 分,整体照常择路

    # ③ TTL 缓存
    def test_ttl_caches_then_reprobes(self):
        calls = []

        def _probe(line):
            calls.append(line.label)
            return {"清华镜像": 35.2 * MB}.get(line.label, 0.0)

        with mock.patch.object(net, "_probe_line", _probe):
            net.pick_pip_route()
            first = len(calls)
            net.pick_pip_route()  # TTL 窗内:命中缓存不重探
            self.assertEqual(len(calls), first)
            ts, route = net._route_cache
            net._route_cache = (ts - net._ROUTE_TTL_S - 1.0, route)  # 时戳改旧
            net.pick_pip_route()
            self.assertGreater(len(calls), first)

    def test_invalidate_forces_reprobe(self):
        calls = []
        with mock.patch.object(net, "_probe_line", lambda line: calls.append(line.label) or 0.0):
            self.assertIsNone(net.pick_pip_route())
            first = len(calls)
            net.invalidate_pip_route()
            self.assertIsNone(net.pick_pip_route())
            self.assertGreater(len(calls), first)

    # ④ MYSTUDIO_OUTBOUND_PROXY 显式覆盖语义(单一真源=net_outbound 同函数)
    def test_explicit_url_shapes_candidates(self):
        # 设 URL:代理线用该 URL、无官方直连线、镜像三线恒在
        with mock.patch.dict(os.environ, {"MYSTUDIO_OUTBOUND_PROXY": "http://127.0.0.1:7897"}):
            with mock.patch.object(net, "outbound_proxy_url", lambda: "http://127.0.0.1:7897"):
                lines = net._candidate_lines()
        proxy_lines = [ln for ln in lines if ln.proxy_url]
        self.assertEqual(len(proxy_lines), 1)
        self.assertEqual(proxy_lines[0].proxy_url, "http://127.0.0.1:7897")
        self.assertTrue(proxy_lines[0].is_fallback)  # 官方+代理=现行线
        self.assertFalse(any(ln.label == "官方源(直连)" for ln in lines))
        self.assertEqual(sum(1 for ln in lines if ln.label.endswith("镜像")), 3)

    def test_explicit_empty_strips_proxy_line(self):
        # 空串=强制直连:无代理线(镜像三线恒在;现行线=直连,无须探测)
        with mock.patch.dict(os.environ, {"MYSTUDIO_OUTBOUND_PROXY": ""}):
            lines = net._candidate_lines()
        self.assertTrue(all(ln.proxy_url is None for ln in lines))
        self.assertEqual(len(lines), 3)

    def test_no_env_with_proxy_gives_five_lines(self):
        # 未设 env 且探测到本机代理:三镜像+官方代理+官方直连=5 线(主场景)
        with mock.patch.object(net, "outbound_proxy_url", lambda: "http://127.0.0.1:7897"):
            lines = net._candidate_lines()
        self.assertEqual(len(lines), 5)
        self.assertEqual(sum(1 for ln in lines if ln.is_fallback), 1)  # 现行线=官方+代理

    # ⑥ simple 页解析纯函数(相对/绝对+#sha256 两格式)
    def test_whl_url_from_relative_mirror_layout(self):
        html = ('<a href="../../packages/aa/bb/cc/numpy-1.26.4-cp311-whl.whl#sha256=abc123">'
                "numpy-1.26.4-cp311.whl</a>")
        page = "https://pypi.tuna.tsinghua.edu.cn/simple/numpy/"
        self.assertEqual(
            net._whl_url_from_simple(html, page),
            "https://pypi.tuna.tsinghua.edu.cn/packages/aa/bb/cc/numpy-1.26.4-cp311-whl.whl")

    def test_whl_url_from_absolute_official_layout_takes_last_wheel(self):
        html = ('<a href="https://files.pythonhosted.org/packages/xx/numpy-1.26.4.tar.gz#sha256=zz">s</a> '
                '<a href="https://files.pythonhosted.org/packages/yy/numpy-2.0.0-cp311.whl#sha256=qq">w</a>')
        page = "https://pypi.org/simple/numpy/"
        self.assertEqual(
            net._whl_url_from_simple(html, page),
            "https://files.pythonhosted.org/packages/yy/numpy-2.0.0-cp311.whl")

    def test_whl_url_none_without_wheels(self):
        self.assertIsNone(net._whl_url_from_simple("<html></html>", "https://pypi.org/simple/numpy/"))

    # ⑦ speed_text / note 格式
    def test_speed_text_formats(self):
        self.assertEqual(PipRoute("x", "u", 35.2 * MB, True, False).speed_text, "35.2MB/s")
        self.assertEqual(PipRoute("x", "u", 77 * 1024.0, True, False).speed_text, "77KB/s")

    def test_note_mirror_vs_current(self):
        mirror = PipRoute("清华镜像", "u", 35.2 * MB, strip_proxy=True, is_fallback=False)
        self.assertEqual(mirror.note, "(清华镜像·实测35.2MB/s)")
        current = PipRoute("官方源", "u", 80 * 1024.0, strip_proxy=False, is_fallback=True)
        self.assertEqual(current.note, "")

    def test_pip_route_note_default_picks_route(self):
        # 缺省参:经 net 命名空间的 pick_pip_route 取缓存/现探,镜像线才有注记
        with mock.patch.object(net, "pick_pip_route", lambda: PipRoute(
                "清华镜像", "u", 35.2 * MB, True, False)):
            self.assertEqual(net.pip_route_note(), "(清华镜像·实测35.2MB/s)")
        with mock.patch.object(net, "pick_pip_route", lambda: None):
            self.assertEqual(net.pip_route_note(), "")


if __name__ == "__main__":
    unittest.main()
