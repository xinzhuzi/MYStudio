"""image_gen/server.py SSH 集成测(11-03 sidecar-ssh-module S2)。

矩阵(PRD 测试矩阵 server 集成行):/comfy/ssh 四路由鉴权与回执 /
_remote_sidecar_base_url 隧道活/死两分支 / 403→刷新→重试一次链(全 mock,
零真 SSH/网络;SSH 服务统一以 fake 单例注入,patch image_gen.server._ssh_service)。
"""

from __future__ import annotations

import json
import tempfile
import unittest
from email.message import Message
from http import HTTPStatus
from pathlib import Path
from unittest.mock import Mock, patch
from urllib import error as urllib_error

from image_gen import server


class _ComfyHandler(server.Handler):
    """照 test_image_gen_server 范式:捕获应答+直通鉴权(鉴权另有专项)。"""

    def _authorized(self) -> bool:
        return True

    def _send_json(self, payload, status: int = HTTPStatus.OK) -> None:
        self.response = (payload, status)

    def _send_error_json(self, status: int, message: str, code: str = "error") -> None:
        self.response = ({"error": {"message": message, "code": code}}, status)


class _FakeSshService:
    """SSHService 测试替身:记录调用,行为可注入。"""

    def __init__(self, *, available=True, tunnel=False, port=17600, refresh_ok=True) -> None:
        self._available = available
        self._tunnel = tunnel
        self._port = port
        self._refresh_ok = refresh_ok
        self.refresh_calls: list[dict] = []

    def available(self) -> bool:
        return self._available

    def tunnel_active(self) -> bool:
        return self._tunnel

    def tunnel_local_port(self):
        return self._port if self._tunnel else None

    def refresh_remote_token(self, timeout_s=None) -> bool:
        self.refresh_calls.append({"timeout_s": timeout_s})
        return self._refresh_ok

    def status(self) -> dict:
        return {
            "available": self._available, "configured": True, "connected": self._tunnel,
            "host": "192.168.0.101", "user": "zbj",
            "serverVersion": "SSH-2.0-OpenSSH_for_Windows_9.5", "lastError": None,
            "tunnelEnabled": True, "tunnelActive": self._tunnel,
            "tunnelLocalPort": self._port if self._tunnel else None,
            "tokenRefreshedAt": 1730000000.0 if self._refresh_ok else None,
        }

    def test_connection(self) -> dict:
        return {"ok": True, "user": "zbj", "serverVersion": "SSH-2.0-OpenSSH_for_Windows_9.5",
                "token": {"ok": True, "length": 36}, "tunnel": {"active": self._tunnel}}


class _Resp:
    def __init__(self, payload: dict) -> None:
        self._body = json.dumps(payload, ensure_ascii=False).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def _http_error(url: str, code: int) -> urllib_error.HTTPError:
    return urllib_error.HTTPError(url, code, "Reason", None, None)


class SshRoutesTests(unittest.TestCase):
    """GET /comfy/ssh/status · POST /comfy/ssh/config|test|token-refresh。"""

    REMOTE_ENGINE = "http://192.168.0.101:17000"

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._home = Path(self._tmp.name)
        seal = patch("comfyui.manifest.comfy_home", return_value=self._home)
        seal.start()
        self.addCleanup(seal.stop)

    def _comfy(self, method: str, path: str, payload: dict | None = None, query: dict | None = None):
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler.headers = Message()
        handler._comfy(method, path, payload or {}, query or {})
        return handler.response

    def test_ssh_routes_share_comfy_group_auth_gate(self) -> None:
        # 鉴权同组:/comfy/ssh/* 走 do_GET/do_POST 的 _authorized 闸(不 override)
        from io import BytesIO

        for method, path in (
            ("GET", "/comfy/ssh/status"), ("POST", "/comfy/ssh/config"),
            ("POST", "/comfy/ssh/test"), ("POST", "/comfy/ssh/token-refresh"),
        ):
            with self.subTest(path=path), patch.dict("os.environ", {}, clear=True):
                handler = server.Handler.__new__(server.Handler)
                handler.headers = Message()
                handler.path = path
                handler.rfile = BytesIO(b"{}" if method == "POST" else b"")
                handler.wfile = BytesIO()
                handler.send_response = Mock()
                handler.send_header = Mock()
                handler.end_headers = Mock()
                if method == "GET":
                    handler.do_GET()
                else:
                    handler.do_POST()
            body = handler.wfile.getvalue().decode("utf-8", "replace")
            self.assertIn('"invalid_local_token"', body)  # 令牌缺失=fail-closed

    def test_status_route_returns_service_status(self) -> None:
        fake = _FakeSshService()
        with patch("image_gen.server._ssh_service", return_value=fake):
            payload, status = self._comfy("GET", "/comfy/ssh/status")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(payload["host"], "192.168.0.101")
        self.assertTrue(payload["available"])

    def test_config_route_saves_and_reloads(self) -> None:
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch("remote_ssh.service.notify_config_changed") as notify:
            payload, status = self._comfy("POST", "/comfy/ssh/config", {"host": "", "user": "zbj"})
        self.assertEqual(status, HTTPStatus.OK)
        self.assertEqual(payload["host"], "192.168.0.101")  # host 空预填引擎 hostname
        notify.assert_called_once_with()  # 写后触发 service 重载
        written = json.loads((self._home / "ssh-remote.json").read_text(encoding="utf-8"))
        self.assertEqual(written, payload)

    def test_test_route_returns_four_artifacts(self) -> None:
        fake = _FakeSshService()
        with patch("image_gen.server._ssh_service", return_value=fake):
            payload, status = self._comfy("POST", "/comfy/ssh/test")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(payload["ok"])
        for key in ("user", "serverVersion", "token", "tunnel"):
            self.assertIn(key, payload)  # R4 回执四件

    def test_token_refresh_route_reports_refresh_outcome(self) -> None:
        fake = _FakeSshService(refresh_ok=True)
        with patch("image_gen.server._ssh_service", return_value=fake):
            payload, status = self._comfy("POST", "/comfy/ssh/token-refresh")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertTrue(payload["ok"])
        self.assertEqual(fake.refresh_calls, [{"timeout_s": 15}])  # 15s 超时口径
        self.assertEqual(payload["tokenRefreshedAt"], 1730000000.0)

        fake_fail = _FakeSshService(refresh_ok=False)
        with patch("image_gen.server._ssh_service", return_value=fake_fail):
            payload, status = self._comfy("POST", "/comfy/ssh/token-refresh")
        self.assertEqual(status, HTTPStatus.OK)
        self.assertFalse(payload["ok"])  # 失败=诚实 False,不 5xx


class SidecarBaseUrlTunnelBranchTests(unittest.TestCase):
    """R3:_remote_sidecar_base_url 隧道活=隧道口,死/无服务=直连零迁移(C2)。"""

    REMOTE_ENGINE = "http://192.168.0.101:17000"

    def _base_url(self, fake_service) -> str | None:
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch("image_gen.server._ssh_service", return_value=fake_service):
            return server._remote_sidecar_base_url()

    def test_tunnel_active_routes_to_loopback_tunnel_port(self) -> None:
        self.assertEqual(
            self._base_url(_FakeSshService(tunnel=True, port=17600)),
            "http://127.0.0.1:17600",
        )

    def test_tunnel_inactive_falls_back_to_direct_sidecar_url(self) -> None:
        self.assertEqual(
            self._base_url(_FakeSshService(tunnel=False)),
            "http://192.168.0.101:17595",  # 现行直连逻辑零迁移
        )

    def test_missing_ssh_service_keeps_direct_path(self) -> None:
        self.assertEqual(
            self._base_url(None),
            "http://192.168.0.101:17595",
        )


class RemoteSidecar403SelfHealTests(unittest.TestCase):
    """R2②:403 → 同步 refresh_remote_token(15s)→ 重试一次;仍败=诚实 403 不循环。"""

    REMOTE_ENGINE = "http://192.168.0.101:17000"
    REMOTE_SIDECAR = "http://192.168.0.101:17595"

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        seal = patch("comfyui.manifest.comfy_home", return_value=Path(self._tmp.name))
        seal.start()
        self.addCleanup(seal.stop)

    def _workflows(self, urlopen_side_effect, fake_service):
        handler = _ComfyHandler.__new__(_ComfyHandler)
        handler.headers = Message()
        with patch(
            "engines.image_engine.comfyui_bridge.remote_engine_url_from_settings",
            return_value=self.REMOTE_ENGINE,
        ), patch("image_gen.server._ssh_service", return_value=fake_service), patch(
            "urllib.request.urlopen", side_effect=urlopen_side_effect
        ) as urlopen:
            handler._comfy("GET", "/comfy/workflows", {}, {})
        return handler.response, urlopen

    def test_403_refreshes_token_and_retries_once(self) -> None:
        # 主链:403 → 刷新成功 → 新凭据重试一次 → 远端应答透传
        fake = _FakeSshService(refresh_ok=True)
        reply = {"workflows": [{"id": "1_图片/krea2.json"}]}
        response, urlopen = self._workflows(
            [_http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403), _Resp(reply)], fake
        )
        self.assertEqual(fake.refresh_calls, [{"timeout_s": 15}])  # 同步刷新一次
        self.assertEqual(urlopen.call_count, 2)  # 原请求+重试一次(不循环)
        self.assertEqual(response, (reply, HTTPStatus.OK))

    def test_403_after_successful_refresh_reports_honest_forbidden(self) -> None:
        # 刷新成功但远端仍拒:单次重试后交回诚实 403 文案
        fake = _FakeSshService(refresh_ok=True)
        response, urlopen = self._workflows(
            [
                _http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403),
                _http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403),
            ],
            fake,
        )
        self.assertEqual(urlopen.call_count, 2)  # 只重试一次
        payload, status = response
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-auth")
        self.assertNotIn("未运行", payload["error"]["message"])

    def test_403_with_failed_refresh_does_not_retry(self) -> None:
        # 刷新失败(未连接/双 miss/超时):不重试,直接 403 文案
        fake = _FakeSshService(refresh_ok=False)
        response, urlopen = self._workflows(
            [_http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403)], fake
        )
        self.assertEqual(urlopen.call_count, 1)  # 未重试
        payload, status = response
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-auth")

    def test_403_without_ssh_service_keeps_existing_behavior(self) -> None:
        # SSH 未配置/不可用:不触发自愈,保持 11-03 S4 行为
        response, urlopen = self._workflows(
            [_http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403)], None
        )
        self.assertEqual(urlopen.call_count, 1)
        payload, status = response
        self.assertEqual(status, HTTPStatus.FORBIDDEN)
        self.assertEqual(payload["error"]["code"], "remote-sidecar-auth")
        self.assertIn(server.REMOTE_TOKEN_ENV, payload["error"]["message"])

    def test_403_with_paramiko_missing_never_refreshes(self) -> None:
        # needs-runtime 态:available()=False,刷新不发起
        fake = _FakeSshService(available=False, refresh_ok=True)
        response, urlopen = self._workflows(
            [_http_error(f"{self.REMOTE_SIDECAR}/comfy/workflows", 403)], fake
        )
        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual(fake.refresh_calls, [])
        payload, status = response
        self.assertEqual(status, HTTPStatus.FORBIDDEN)


if __name__ == "__main__":
    unittest.main()
