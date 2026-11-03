"""remote_ssh.service 单元测(11-03 sidecar-ssh-module S1)。

矩阵(PRD 测试矩阵 service 行):key 自动探测顺序 / status 三态 / 刷新令牌
五分支(主路径/回退路径/双 miss/坏 JSON/正则拒)/ 依赖缺失 fail-open /
connect 配方(accept-new+免密 key+禁 agent)。**全 mock paramiko**(C7:
测试环境零真 SSH);keeper 线程循环的实弹行为归 S5 双机验收。
"""

from __future__ import annotations

import json
import sys
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from remote_ssh import config as ssh_config
from remote_ssh import service as ssh_service_mod
from remote_ssh.service import SSHServiceError, ssh_service


# ── fake paramiko(注入 sys.modules 即被惰性导入命中)────────────────────

class _FakeAutoAddPolicy:
    pass


class _FakeTransport:
    remote_version = "SSH-2.0-OpenSSH_for_Windows_9.5"

    def __init__(self) -> None:
        self.keepalive = None
        self.active = True
        self.username = "zbj"

    def set_keepalive(self, seconds: int) -> None:
        self.keepalive = seconds

    def is_active(self) -> bool:
        return self.active

    def get_username(self) -> str:
        return self.username


class _FakeSFTPFile:
    def __init__(self, payload) -> None:
        self._payload = payload if isinstance(payload, bytes) else str(payload).encode("utf-8")

    def read(self):
        return self._payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class _FakeSFTPClient:
    def __init__(self, files: dict) -> None:
        self._files = files  # path -> str|bytes|Exception
        self.closed = False

    def open(self, path: str, mode: str = "r"):
        if path not in self._files:
            raise IOError(f"no such file: {path}")  # noqa: N818 — paramiko 面异常
        payload = self._files[path]
        if isinstance(payload, Exception):
            raise payload
        return _FakeSFTPFile(payload)

    def close(self) -> None:
        self.closed = True


class _FakeSSHClient:
    AutoAddPolicy = _FakeAutoAddPolicy

    def __init__(self) -> None:
        self.loaded_system_keys = False
        self.policy = None
        self.connect_kwargs = None
        self.transport = _FakeTransport()
        self.sftp: _FakeSFTPClient | None = None
        self.closed = False

    def load_system_host_keys(self) -> None:
        self.loaded_system_keys = True

    def set_missing_host_key_policy(self, policy) -> None:
        self.policy = policy

    def connect(self, **kwargs) -> None:
        self.connect_kwargs = kwargs

    def get_transport(self) -> _FakeTransport:
        return self.transport

    def open_sftp(self) -> _FakeSFTPClient:
        if self.sftp is None:
            raise IOError("sftp unavailable")
        return self.sftp

    def close(self) -> None:
        self.closed = True


class _HangingSFTPClient(_FakeSFTPClient):
    """病态 transport 假体(1103 复核#2):SFTP open 请求悬挂——release 放行
    才返回,模拟「TCP 在、对端不应答」的半死连接。"""

    def __init__(self, release: threading.Event) -> None:
        super().__init__({})
        self._release = release

    def open(self, path: str, mode: str = "r"):
        self._release.wait(10)
        raise IOError(f"sftp hang released: {path}")  # noqa: N818 — paramiko 面异常


def _fake_paramiko_module() -> types.ModuleType:
    module = types.ModuleType("paramiko")
    module.SSHException = type("SSHException", (Exception,), {})
    module.AutoAddPolicy = _FakeAutoAddPolicy
    module.SSHClient = _FakeSSHClient
    return module


def _no_paramiko() -> dict:
    # sys.modules 值为 None 时 import 该名 raise ImportError(标准行为)
    return {"paramiko": None}


class _TunnelSocketSpy:
    """remote_ssh.tunnel.socket 假体(照 test_remote_ssh_tunnel 同款口径):
    记录 bind/close 轨迹,零真网络(C7)。"""

    def __init__(self, occupied: set[int] | None = None) -> None:
        self.occupied = set(occupied or set())
        self.bound: list[int] = []
        self.closed: list[int] = []

    def module(self) -> types.SimpleNamespace:
        spy = self

        class _Sock:
            def setsockopt(self, *args) -> None:
                pass

            def bind(self, addr) -> None:
                port = addr[1]
                if port in spy.occupied:
                    raise OSError(48, "Address already in use")
                spy.bound.append(port)
                self.port = port

            def listen(self, backlog: int = 0) -> None:
                pass  # 1103 修复随动:bind_local_port 现要求 bind+listen 双成

            def close(self) -> None:
                port = getattr(self, "port", None)
                if port is not None:
                    spy.closed.append(port)

            def accept(self):
                raise OSError("listener closed in tests")

        def _make_sock(*args, **kwargs) -> _Sock:
            return _Sock()

        return types.SimpleNamespace(
            AF_INET=2, SOCK_STREAM=1, SOL_SOCKET=1, SO_REUSEADDR=2, socket=_make_sock
        )


class RemoteSshServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        ssh_service_mod.reset_for_tests()
        # 收尾再清一次:末测试(_on_connected 的 spy listener)会留在进程级
        # 单例里,不清则同进程后跑的 test_image_gen_server 读到假活隧道
        # (HEAD 实证:remote_ssh 在前+image_gen 在后的合跑序全灭 4 测)
        self.addCleanup(ssh_service_mod.reset_for_tests)
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._home = Path(self._tmp.name)
        # 密封 comfyui 家:令牌文件与配置文件全落临时区
        self._seal = patch("comfyui.manifest.comfy_home", return_value=self._home)
        self._seal.start()
        self.addCleanup(self._seal.stop)
        # 密封 HOME:key 探测/expanduser 不吃真机 ~/.ssh
        self._env = patch.dict("os.environ", {"HOME": str(self._home)})
        self._env.start()
        self.addCleanup(self._env.stop)

    def _write_ssh_config(self, **overrides) -> dict:
        payload = {
            "host": "192.168.0.101", "port": 22, "user": "zbj",
            "keyPath": "", "tunnelEnabled": False, "tunnelLocalPort": 17600,
            "tokenConfigPaths": [],
        }
        payload.update(overrides)
        (self._home / "ssh-remote.json").write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        return payload

    def _connected_service(self, sftp_files: dict) -> tuple:
        svc = ssh_service()
        client = _FakeSSHClient()
        client.sftp = _FakeSFTPClient(sftp_files)
        svc._client = client
        svc._connected = True
        svc._server_version = client.transport.remote_version  # 模拟 _connect_once 已取版本
        return svc, client

    # ── key 自动探测顺序(Q2:ed25519 → ecdsa → rsa)───────────────────

    def test_key_autodetect_prefers_ed25519_then_ecdsa_then_rsa(self) -> None:
        ssh_dir = self._home / ".ssh"
        ssh_dir.mkdir(parents=True, exist_ok=True)
        resolve = ssh_service_mod._resolve_key_path

        (ssh_dir / "id_rsa").write_text("rsa", encoding="utf-8")
        self.assertTrue(resolve("").endswith("id_rsa"))  # 只有 rsa:用 rsa

        (ssh_dir / "id_ecdsa").write_text("ecdsa", encoding="utf-8")
        self.assertTrue(resolve("").endswith("id_ecdsa"))  # ecdsa 在则压过 rsa

        (ssh_dir / "id_ed25519").write_text("ed", encoding="utf-8")
        self.assertTrue(resolve("").endswith("id_ed25519"))  # ed25519 最优先

        # keyPath 显式给了:expanduser 直用,不走探测
        self.assertTrue(resolve("~/custom_key").endswith("custom_key"))

    def test_key_autodetect_returns_none_when_no_candidate_exists(self) -> None:
        self.assertIsNone(ssh_service_mod._resolve_key_path(""))

    # ── connect 配方(accept-new 同语义+免密 key+禁 agent)─────────────

    def test_connect_once_uses_autodetected_key_and_disables_agent(self) -> None:
        (self._home / ".ssh").mkdir(parents=True, exist_ok=True)
        (self._home / ".ssh" / "id_ed25519").write_text("ed", encoding="utf-8")
        cfg = self._write_ssh_config()
        svc = ssh_service()
        fake = _fake_paramiko_module()
        # status() 带后装恢复探针(1103 复核#1):patch Thread 防真 keeper 起跑
        with patch.dict(sys.modules, {"paramiko": fake}), patch("threading.Thread"):
            self.assertTrue(svc._connect_once(cfg))
        client = svc._client
        self.assertIsInstance(client, _FakeSSHClient)
        self.assertTrue(client.loaded_system_keys)  # load_system_host_keys
        self.assertIsInstance(client.policy, _FakeAutoAddPolicy)  # AutoAddPolicy
        kwargs = client.connect_kwargs
        self.assertEqual(kwargs["hostname"], "192.168.0.101")
        self.assertEqual(kwargs["username"], "zbj")
        self.assertIs(kwargs["allow_agent"], False)  # 禁 agent
        # 1103 密码认证补:显式 key 仍开探测回退(paramiko 先试 key_filename 失败再探默认键)
        self.assertIs(kwargs["look_for_keys"], True)
        self.assertEqual(kwargs["timeout"], 10)  # 建连超时 10s
        self.assertTrue(kwargs["key_filename"].endswith("id_ed25519"))
        self.assertEqual(client.transport.keepalive, 30)  # set_keepalive(30)
        # serverVersion 从 transport.remote_version 取
        self.assertEqual(svc.status()["serverVersion"], "SSH-2.0-OpenSSH_for_Windows_9.5")


    def test_connect_once_with_password_auth(self) -> None:
        """1103 密码认证补:cfg 带 password→connect kwargs 携 password(优先密码,回退探测)。"""
        cfg = self._write_ssh_config()
        cfg["password"] = "s3cret-pw"
        svc = ssh_service()
        fake = _fake_paramiko_module()
        with patch.dict(sys.modules, {"paramiko": fake}), patch("threading.Thread"):
            self.assertTrue(svc._connect_once(cfg))
        client = svc._client
        self.assertIsInstance(client, _FakeSSHClient)
        kwargs = client.connect_kwargs
        self.assertEqual(kwargs["password"], "s3cret-pw")
        self.assertIs(kwargs["allow_agent"], False)
        # 密码优先但失败回退探测(paramiko 自行处理回退序)
        self.assertIs(kwargs["look_for_keys"], True)

    def test_connect_once_without_any_key_omits_key_filename(self) -> None:
        # 无任何默认 key 且 keyPath 空:不带 key_filename(由服务端侧拒,诚实失败)
        cfg = self._write_ssh_config()
        svc = ssh_service()
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}):
            self.assertTrue(svc._connect_once(cfg))
        self.assertNotIn("key_filename", svc._client.connect_kwargs)

    # ── fail-open(C3:paramiko 未装不拦 sidecar)──────────────────────

    def test_paramiko_missing_makes_service_unavailable_without_crashing(self) -> None:
        with patch.dict(sys.modules, _no_paramiko()):
            svc = ssh_service()
            self.assertFalse(svc.available())
            self.assertFalse(svc.start())  # 有配置也不起 keeper,不抛
            status = svc.status()
            self.assertFalse(status["available"])
            self.assertFalse(status["connected"])

    def test_start_without_config_is_silent_noop(self) -> None:
        # 未配置(host 空)=常态:不起线程
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), \
                patch("threading.Thread") as thread_cls:
            self.assertFalse(ssh_service().start())
            thread_cls.assert_not_called()

    # ── 后装恢复链(C3/R4;1103 独立复核#1:paramiko 装好后免重启起 keeper)──

    def _started_flag(self, svc: object) -> bool:
        return bool(getattr(svc, "_started"))

    def test_paramiko_install_recovery_via_notify_config_changed(self) -> None:
        """病根:启动时 paramiko 未装 → start() 在置 _started 前返 False,keeper
        从未创建,旧 notify_config_changed 只 _wake.set()=无操作——装好依赖后
        connected 恒 false 须重启 sidecar。修复:notify 补调 start() 起 keeper。"""
        self._write_ssh_config()
        svc = ssh_service()
        with patch.dict(sys.modules, _no_paramiko()):
            self.assertFalse(svc.start())  # 首启失败:keeper 未起
            self.assertFalse(self._started_flag(svc))
            with patch("threading.Thread") as thread_cls:
                svc.notify_config_changed()  # 依赖仍缺:恢复探针短路,无 keeper
                thread_cls.assert_not_called()
        # paramiko 装好(同进程惰性 import 立即可用)→ notify 补起 keeper
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), \
                patch("threading.Thread") as thread_cls:
            svc.notify_config_changed()
            self.assertTrue(self._started_flag(svc))
            self.assertEqual(thread_cls.call_count, 1)  # keeper 恰一个
            # 再 notify:keeper 已起 → 不重复起(唤醒语义)
            svc.notify_config_changed()
            self.assertEqual(thread_cls.call_count, 1)

    def test_paramiko_install_recovery_via_status(self) -> None:
        # status 是前端回开设置页的首个入口(McpSettingsTab useEffect 拉状态):
        # 装好依赖后首个 status 即补起 keeper,徽章三态自愈
        self._write_ssh_config()
        svc = ssh_service()
        with patch.dict(sys.modules, _no_paramiko()):
            svc.status()  # 依赖缺:不自起
            self.assertFalse(self._started_flag(svc))
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), \
                patch("threading.Thread") as thread_cls:
            svc.status()
            self.assertTrue(self._started_flag(svc))
            self.assertEqual(thread_cls.call_count, 1)

    def test_paramiko_install_recovery_via_test_connection(self) -> None:
        # 「测试连接」同款补起:本次回执仍按未连接(诚实),keeper 立即开跑,
        # 后续 status 自愈 connected
        self._write_ssh_config()
        svc = ssh_service()
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), \
                patch("threading.Thread") as thread_cls:
            reply = svc.test_connection()
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["reason"], "disconnected")
        self.assertTrue(self._started_flag(svc))
        self.assertEqual(thread_cls.call_count, 1)

    def test_recovery_stays_dormant_when_unconfigured(self) -> None:
        # host 空(未配置)+ 依赖在:恢复探针不自起(照 start 契约)
        svc = ssh_service()
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), \
                patch("threading.Thread") as thread_cls:
            svc.status()
            svc.test_connection()
            ssh_service_mod.notify_config_changed()
            thread_cls.assert_not_called()
            self.assertFalse(self._started_flag(svc))

    # ── status 三态 ───────────────────────────────────────────────────

    def test_status_three_states(self) -> None:
        svc = ssh_service()
        # ①未配置
        status = svc.status()
        self.assertFalse(status["configured"])
        self.assertFalse(status["connected"])
        # ②已连接
        self._write_ssh_config()
        client = _FakeSSHClient()
        svc._client = client
        svc._connected = True
        status = svc.status()
        self.assertTrue(status["configured"])
        self.assertTrue(status["connected"])
        self.assertEqual(status["host"], "192.168.0.101")
        self.assertEqual(status["user"], "zbj")
        # ③断开:connected=False 且 lastError 带因
        svc._mark_disconnected("SSH 连接断开")
        status = svc.status()
        self.assertFalse(status["connected"])
        self.assertEqual(status["lastError"], "SSH 连接断开")
        self.assertTrue(client.closed)  # 断开即关旧 client

    # ── 刷新令牌五分支(R2)──────────────────────────────────────────

    PRIMARY = "E:/IP/漫影工作室/python/profiles/image-gen/config.json"
    FALLBACK = "C:/Users/zbj/AppData/Roaming/漫影工作室/python/profiles/image-gen/config.json"

    def _paths(self) -> list[str]:
        return [self.PRIMARY, self.FALLBACK]

    def test_refresh_token_primary_path_writes_file_atomically(self) -> None:
        # 主路径命中:controlToken 正则合法 → tmp+replace 写令牌文件
        token = "Abc123_xyz-NEW"
        svc, _client = self._connected_service(
            {self.PRIMARY: json.dumps({"controlToken": token})}
        )
        self._write_ssh_config()
        self.assertTrue(svc.refresh_remote_token())
        written = (self._home / ssh_service_mod.TOKEN_FILE_NAME).read_text(encoding="utf-8")
        self.assertEqual(written, token)
        self.assertFalse((self._home / f"{ssh_service_mod.TOKEN_FILE_NAME}.tmp").exists())
        self.assertIsNotNone(svc.status()["tokenRefreshedAt"])
        self.assertTrue(_client.sftp.closed)  # SFTP 用完即关(防陈旧句柄)

    def test_refresh_token_falls_back_to_second_path(self) -> None:
        # 回退路径:主路径 miss(远端无此文件)→ 第二条命中
        svc, _client = self._connected_service(
            {self.FALLBACK: json.dumps({"controlToken": "tok_from_appdata"})}
        )
        self._write_ssh_config()
        self.assertTrue(svc.refresh_remote_token())
        self.assertEqual(
            (self._home / ssh_service_mod.TOKEN_FILE_NAME).read_text(encoding="utf-8"),
            "tok_from_appdata",
        )

    def test_refresh_token_double_miss_returns_false(self) -> None:
        # 双 miss:两条真源都不在 → False(文件不写)
        svc, _client = self._connected_service({})
        self._write_ssh_config()
        self.assertFalse(svc.refresh_remote_token())
        self.assertFalse((self._home / ssh_service_mod.TOKEN_FILE_NAME).exists())

    def test_refresh_token_skips_corrupt_json_and_continues(self) -> None:
        # 坏 JSON:第一条真源损坏 → 跳过继续,不炸、不写脏令牌
        svc, _client = self._connected_service(
            {self.PRIMARY: "{corrupt", self.FALLBACK: json.dumps({"controlToken": "ok_after_corrupt"})}
        )
        self._write_ssh_config()
        self.assertTrue(svc.refresh_remote_token())
        self.assertEqual(
            (self._home / ssh_service_mod.TOKEN_FILE_NAME).read_text(encoding="utf-8"),
            "ok_after_corrupt",
        )

    def test_refresh_token_rejects_non_conforming_token(self) -> None:
        # 正则拒:B7 同款 ^[A-Za-z0-9][A-Za-z0-9_-]*$;含空格/特殊字符不写盘
        for bad in ("bad token!", "中文令牌", "-leading-dash", ""):
            with self.subTest(bad=bad):
                svc, _client = self._connected_service(
                    {self.PRIMARY: json.dumps({"controlToken": bad})}
                )
                self._write_ssh_config()
                self.assertFalse(svc.refresh_remote_token())
                self.assertFalse((self._home / ssh_service_mod.TOKEN_FILE_NAME).exists())

    def test_refresh_token_without_connection_returns_false(self) -> None:
        # SSH 未连接:诚实 False(不外溢异常)
        self._write_ssh_config()
        self.assertFalse(ssh_service().refresh_remote_token())

    def test_sftp_read_text_raises_service_error_when_disconnected(self) -> None:
        with self.assertRaises(SSHServiceError):
            ssh_service().sftp_read_text(self.PRIMARY)

    # ── 测试连接回执(R4 四件)───────────────────────────────────────

    def test_test_connection_needs_runtime_reason_when_paramiko_missing(self) -> None:
        with patch.dict(sys.modules, _no_paramiko()):
            reply = ssh_service().test_connection()
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["reason"], "needs-runtime")
        self.assertIn("Python 运行环境", reply["message"])

    def test_test_connection_returns_four_artifacts_when_connected(self) -> None:
        svc, _client = self._connected_service(
            {self.PRIMARY: json.dumps({"controlToken": "a" * 36})}
        )
        self._write_ssh_config()
        # 令牌读取走 executor 线程池(1103 复核#2):不能 patch threading.Thread
        # (池的 worker 也是 Thread);改以 _started=True 短路恢复探针(1103 复核#1)
        svc._started = True
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}):
            reply = svc.test_connection()
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["user"], "zbj")  # ①登录用户(transport.get_username)
        self.assertEqual(reply["serverVersion"], "SSH-2.0-OpenSSH_for_Windows_9.5")  # ②版本
        self.assertTrue(reply["token"]["ok"])  # ③令牌读取(len 掩码)
        self.assertEqual(reply["token"]["length"], 36)
        self.assertNotIn("a" * 36, json.dumps(reply))  # 掩码:不回明文
        self.assertIn("tunnel", reply)  # ④隧道探活

    def test_test_connection_reports_disconnected_with_last_error(self) -> None:
        self._write_ssh_config()
        svc = ssh_service()
        svc._last_error = "connection refused"
        # 后装恢复探针会起 keeper(1103 复核#1):patch Thread 保持确定性
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}), patch("threading.Thread"):
            reply = svc.test_connection()
        self.assertFalse(reply["ok"])
        self.assertEqual(reply["reason"], "disconnected")
        self.assertIn("connection refused", reply["message"])

    # ── 测试连接令牌读取限时(R1「对外调用必带超时」;1103 独立复核#2)────

    def test_test_connection_passes_timeout_to_token_peek(self) -> None:
        # test 路与 refresh 路同款口径:peek 走 executor 限时 15s
        svc, _client = self._connected_service({})
        self._write_ssh_config()
        svc._started = True  # 跳过恢复探针,聚焦超时面
        with patch.dict(sys.modules, {"paramiko": _fake_paramiko_module()}):
            with patch.object(svc, "peek_remote_token", wraps=svc.peek_remote_token) as peek:
                svc.test_connection()
        peek.assert_called_once_with(timeout_s=15)

    def test_token_peek_times_out_when_sftp_hangs(self) -> None:
        """病根:test 路同步 peek→sftp_read_text 无超时,transport 半死(TCP 在、
        对端不应答)时 SFTP 请求可无限阻塞 → POST /comfy/ssh/test 永不回执
        (R4 四件失真+handler 线程泄漏)。修复:限时返回失败回执。"""
        release = threading.Event()
        self.addCleanup(release.set)  # 收尾放行工作线程:单 worker 池不被钉死
        svc, client = self._connected_service({})
        client.sftp = _HangingSFTPClient(release)
        self._write_ssh_config()
        started = time.monotonic()
        reply = svc.peek_remote_token(timeout_s=0.3)
        elapsed = time.monotonic() - started
        self.assertLess(elapsed, 5.0)  # 限时返回,绝不悬挂
        self.assertEqual(reply, {"ok": False, "length": None, "source": None})

    def test_token_peek_with_timeout_still_reads_token(self) -> None:
        # 限时路径正常态:可读时照常回执(ok/len 掩码/真源路径)
        svc, _client = self._connected_service(
            {self.PRIMARY: json.dumps({"controlToken": "tok_peek_ok"})}
        )
        self._write_ssh_config()
        reply = svc.peek_remote_token(timeout_s=5)
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["length"], len("tok_peek_ok"))
        self.assertEqual(reply["source"], self.PRIMARY)

    # ── 断开即收隧道(R3/C2:断开窗口代理链回落直连)──────────────────

    def _tunnel_spy(self) -> _TunnelSocketSpy:
        spy = _TunnelSocketSpy()
        patcher = patch("remote_ssh.tunnel.socket", spy.module())
        patcher.start()
        self.addCleanup(patcher.stop)
        return spy

    def test_mark_disconnected_stops_tunnel(self) -> None:
        """R3/C2:SSH 断开(sshd 停/网络断)→ 隧道 listener 随之收摊:
        tunnel_active()=False、口释放——_remote_sidecar_base_url 回落直连,
        断开窗口不再经死 transport 开 channel 全 502(并误报「请开启 Windows
        侧 MYStudio App」,实际 Windows App 可能在跑、死的是 sshd)。"""
        svc, client = self._connected_service({})
        self._write_ssh_config(tunnelEnabled=True)
        spy = self._tunnel_spy()
        self.assertEqual(
            svc._tunnel.ensure(client.transport, 17600, "127.0.0.1", 17595), 17600
        )
        self.assertTrue(svc.tunnel_active())
        # 单锁快照(1103 复核#4):活态 (True, port);代理链一次取全
        self.assertEqual(svc.tunnel_snapshot(), (True, 17600))
        svc._mark_disconnected("SSH 连接断开")
        self.assertFalse(svc.tunnel_active())  # 隧道已收:代理链回落直连
        self.assertIsNone(svc.tunnel_local_port())
        self.assertEqual(spy.closed, [17600])  # 17600 口已释放(listener 不再占)
        self.assertTrue(client.closed)  # client 同关(原语义保留)

    def test_tunnel_rebuilt_after_keeper_reconnect(self) -> None:
        # 断开收摊 → keeper 重连(新 transport)→ _on_connected→ensure 原路径
        # 重建隧道:断开窗口回落直连、重连后回隧道,两态切换无残留口
        svc, _client = self._connected_service({})
        self._write_ssh_config(tunnelEnabled=True)
        spy = self._tunnel_spy()
        svc._on_connected({"tunnelEnabled": True, "tunnelLocalPort": 17600})
        self.assertTrue(svc.tunnel_active())
        svc._mark_disconnected("SSH 连接断开")
        self.assertFalse(svc.tunnel_active())
        new_client = _FakeSSHClient()
        svc._client = new_client
        svc._connected = True
        svc._on_connected({"tunnelEnabled": True, "tunnelLocalPort": 17600})
        self.assertTrue(svc.tunnel_active())  # 新 transport 上重建
        self.assertEqual(svc.tunnel_local_port(), 17600)
        self.assertEqual(spy.bound, [17600, 17600])  # 两次建、一收一重建
        self.assertEqual(spy.closed, [17600])


if __name__ == "__main__":
    unittest.main()
