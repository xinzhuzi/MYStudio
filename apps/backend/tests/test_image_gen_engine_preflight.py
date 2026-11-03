"""1104 A2+A3 引擎预检闸测试(pipeline.generate_image 入口,先于 _require_downloaded)。

钉三条:
- A2 远端死:远端配置在但引擎不可达 → 最坏 3s 内 bridge-unreachable(不进生成链;
  旧:探活过了但后续各步超时叠加=用户等 60s)。
- A3 零引擎:无远端+本地探不到桥服务+账本无安装记录 → no-engine-configured
  明确指路(旧:模糊报 model-not-downloaded/「ComfyUI 没在运行」)。
- 保护面:①远端活→放行进生成链;②自管引擎已装未跑→闸放行(ensure_engine_ready
  自动拉起补口不破门,09-11 实弹裁定);③原生布局(krea2 等)不吃引擎,闸零拦。
"""
from __future__ import annotations

import json
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from image_gen import pipeline
from image_gen.pipeline import PipelineError


class _FakeEngine:
    SUPPORTS_REFERENCE = True
    SUPPORTS_MULTI_REFERENCE = True
    SMALL_REPO = None

    def generate(self, **_kwargs):
        return "aGk="


class _SystemStatsHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 — http.server 约定
        if self.path == "/system_stats":
            body = json.dumps({"comfyui_version": "9.9.9-test"}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, *_args):  # 静默,免测试输出噪音
        pass


class EnginePreflightTest(unittest.TestCase):
    """generate_image 预检闸(经公开入口驱动,不捅私有函数)。"""

    BRIDGE_SPEC = {"label": "假桥", "layout": "comfyui-bridge", "steps": 8}

    def setUp(self):
        self.assertTrue(pipeline._lock.acquire(False), "锁被残留持有,测试环境不干净")
        pipeline._lock.release()
        self.engine = _FakeEngine()
        self.remote_url = "http://127.0.0.1:1"  # 端口 1:恒连接拒绝(死引擎快通道)
        self.remote = mock.patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.remote_url,
        )
        self.remote.start()
        self.addCleanup(self.remote.stop)

    def _install_bridge_model(self):
        patches = [
            mock.patch.dict(pipeline._ENGINE_BY_LAYOUT, {"comfyui-bridge": self.engine}),
            mock.patch.dict(pipeline.IMAGE_MODELS, {"comfyui-bridge": dict(self.BRIDGE_SPEC)}),
            mock.patch.object(pipeline, "comfyui_models_dir", lambda: "/tmp/fake-models"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def _patch_require(self):
        patcher = mock.patch.object(pipeline, "_require_downloaded", lambda _name: None)
        patcher.start()
        self.addCleanup(patcher.stop)

    # ── A2:远端死 → 3s 内 bridge-unreachable ──

    def test_remote_dead_raises_bridge_unreachable_fast(self):
        self._install_bridge_model()
        start = time.monotonic()
        with self.assertRaises(PipelineError) as ctx:
            pipeline.generate_image("comfyui-bridge", "p")
        elapsed = time.monotonic() - start
        self.assertEqual(ctx.exception.code, "bridge-unreachable")
        self.assertIn("远端引擎不可达", ctx.exception.message)
        self.assertIn(self.remote_url, ctx.exception.message)
        self.assertLess(elapsed, 3.0, f"预检闸必须秒报(实测 {elapsed:.2f}s),不得叠 60s 超时")

    def test_remote_hang_capped_at_3s_probe_timeout(self):
        """不可达网络形态(黑洞地址,连接挂起)→ 探测超时封顶 3s,不得 60s。"""
        self._install_bridge_model()
        self.remote.stop()
        hang = mock.patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value="http://10.255.255.1:17000",
        )
        hang.start()
        self.addCleanup(hang.stop)
        start = time.monotonic()
        with self.assertRaises(PipelineError) as ctx:
            pipeline.generate_image("comfyui-bridge", "p")
        elapsed = time.monotonic() - start
        self.assertEqual(ctx.exception.code, "bridge-unreachable")
        self.assertLess(elapsed, 5.0, f"挂起型不可达必须 3s 超时封顶(实测 {elapsed:.2f}s)")

    def test_remote_dead_rejected_before_generation_chain(self):
        """闸在生成链之前:引擎 generate 与 _require_downloaded 都不得被触达。"""
        self._install_bridge_model()
        require = mock.patch.object(pipeline, "_require_downloaded")
        with require as require_mock:
            with self.assertRaises(PipelineError):
                pipeline.generate_image("comfyui-bridge", "p")
        require_mock.assert_not_called()

    def test_remote_alive_passes_gate_into_generation(self):
        """远端引擎活(真 /system_stats 200)→ 闸放行,进生成链出图。"""
        server = ThreadingHTTPServer(("127.0.0.1", 0), _SystemStatsHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.shutdown)
        self.remote.stop()
        live = mock.patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=f"http://127.0.0.1:{server.server_port}",
        )
        live.start()
        self.addCleanup(live.stop)
        self._install_bridge_model()
        self._patch_require()
        generate = mock.patch.object(self.engine, "generate", side_effect=lambda **_k: "aGk=")
        with generate as generate_mock:
            result = pipeline.generate_image("comfyui-bridge", "p")
        self.assertEqual(result, "aGk=")
        generate_mock.assert_called_once()

    # ── A3:无远端+无本地引擎 → no-engine-configured ──

    def _no_remote(self):
        self.remote.stop()
        none_remote = mock.patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=None,
        )
        none_remote.start()
        self.addCleanup(none_remote.stop)

    def test_no_engine_configured_gives_actionable_error(self):
        self._no_remote()
        self._install_bridge_model()
        cached = mock.patch.object(pipeline, "find_cached_image_model_for_spec", return_value=None)
        installed = mock.patch("comfyui.manifest.engine_installed", return_value=False)
        with cached, installed:
            with self.assertRaises(PipelineError) as ctx:
                pipeline.generate_image("comfyui-bridge", "p")
        self.assertEqual(ctx.exception.code, "no-engine-configured")
        # 两条指路必须在(引擎地址/本地配置),不许再模糊报 model-not-downloaded
        self.assertIn("未配置任何引擎", ctx.exception.message)
        self.assertIn("引擎地址", ctx.exception.message)
        self.assertIn("本地配置", ctx.exception.message)

    def test_installed_but_not_running_passes_gate_for_autostart(self):
        """自管引擎已装未跑:闸放行(_require_downloaded 的 ensure_engine_ready
        自动拉起补口不破门——09-11 实弹裁定:不能秒拒,否则自动启动永远轮不到)。"""
        self._no_remote()
        self._install_bridge_model()
        self._patch_require()
        cached = mock.patch.object(pipeline, "find_cached_image_model_for_spec", return_value=None)
        installed = mock.patch("comfyui.manifest.engine_installed", return_value=True)
        with cached, installed:
            self.assertEqual(pipeline.generate_image("comfyui-bridge", "p"), "aGk=")

    def test_local_bridge_alive_passes_gate(self):
        """无远端但本地桥服务在跑(find_cached 探活命中)→ 闸放行。"""
        self._no_remote()
        self._install_bridge_model()
        self._patch_require()
        cached = mock.patch.object(
            pipeline,
            "find_cached_image_model_for_spec",
            return_value={"repo_id": "comfyui-service:127.0.0.1", "cache_dir": "x", "repo_cache_dir": "x", "size_mb": 0},
        )
        with cached:
            self.assertEqual(pipeline.generate_image("comfyui-bridge", "p"), "aGk=")

    # ── 保护面:原生布局不吃引擎,闸零拦 ──

    def test_native_layout_skips_gate_when_remote_dead(self):
        """krea2 等原生 diffusers 布局既不吃远端引擎也不吃 ComfyUI 服务——
        远端死时不得误拦(闸只对桥布局生效)。"""
        native_spec = {"label": "假原生", "layout": "krea2-pointed", "steps": 8}
        patches = [
            mock.patch.dict(pipeline._ENGINE_BY_LAYOUT, {"krea2-pointed": self.engine}),
            mock.patch.dict(pipeline.IMAGE_MODELS, {"fake-native": native_spec}),
            mock.patch.object(pipeline, "_require_downloaded", lambda _name: None),
            mock.patch.object(pipeline, "comfyui_models_dir", lambda: "/tmp/fake-models"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.assertEqual(pipeline.generate_image("fake-native", "p"), "aGk=")


if __name__ == "__main__":
    unittest.main()
