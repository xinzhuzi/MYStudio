"""remote_ssh.tunnel 单元测(11-03 sidecar-ssh-module S1;1103 实弹修复随动)。

矩阵(PRD 测试矩阵 tunnel 行):防撞跳保留区 / channel 开失败关连接 /
幂等 ensure / 并发上限 8 / **bind+listen 真 socket 回环**(1103 实弹事故:
首版 bind 不 listen,accept 线程 EINVAL 即退、隧道假活,全 mock 测试漏网
——故保留区/扫描用 mock 精控,listen 语义用真回环 socket 钉死)。
C7 口径:零真实 SSH/零外网(回环 socket 属本机,不算网络)。
"""

from __future__ import annotations

import socket
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from remote_ssh import tunnel as tunnel_mod
from remote_ssh.tunnel import MAX_CONCURRENT_CONNECTIONS, RESERVED_LOCAL_PORTS, TunnelManager, bind_local_port

# 1103 修复后:默认口 17600;保留区={17593 TTS,17595 sidecar,17596 本 App
# 云中继(comfy-cloud-relay.ts:16 实弹撞车),17597 开发侧车,17598 引擎回落}
DEFAULT_TUNNEL_PORT = 17600


class _FakeSocketRegistry:
    """socket 模块假体:occupied 集合控制 bind 失败,记录 bind/listen/close 轨迹。"""

    def __init__(self, occupied: set[int]) -> None:
        self.occupied = set(occupied)
        self.bind_attempts: list[int] = []
        self.bound: list[int] = []
        self.listened: list[int] = []
        self.closed: list[int] = []
        self.created = 0

    def module(self) -> SimpleNamespace:
        registry = self

        class _Sock:
            def setsockopt(self, *args) -> None:
                pass

            def bind(self, addr) -> None:
                port = addr[1]
                registry.bind_attempts.append(port)
                if port in registry.occupied:
                    raise OSError(48, "Address already in use")
                registry.bound.append(port)
                self.port = port

            def listen(self, backlog: int = 0) -> None:
                registry.listened.append(self.port)

            def close(self) -> None:
                if getattr(self, "port", None) is not None:
                    registry.closed.append(self.port)

            def accept(self):
                raise OSError("listener closed in tests")

        def _make_sock(*args, **kwargs) -> _Sock:
            registry.created += 1
            return _Sock()

        return SimpleNamespace(
            AF_INET=2, SOCK_STREAM=1, SOL_SOCKET=1, SO_REUSEADDR=2,
            socket=_make_sock,
        )


class BindLocalPortTests(unittest.TestCase):
    def _bind(self, occupied: set[int], preferred: int):
        registry = _FakeSocketRegistry(occupied)
        with patch("remote_ssh.tunnel.socket", registry.module()):
            result = bind_local_port(preferred)
        return registry, result

    def test_default_port_taken_scans_past_reserved_zone(self) -> None:
        # D5 防撞:17600 被占 → 17601 落口(默认段 17600..17609 无保留区)
        registry, result = self._bind({DEFAULT_TUNNEL_PORT}, DEFAULT_TUNNEL_PORT)
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 17601)
        self.assertEqual(registry.listened, [17601])  # 占口=bind+listen 双成

    def test_reserved_zone_members(self) -> None:
        # 1103 实弹修复:云中继 17596 与 TTS 17593 进保留区(撞车实证)
        self.assertIn(17596, RESERVED_LOCAL_PORTS)
        self.assertIn(17593, RESERVED_LOCAL_PORTS)
        self.assertEqual(RESERVED_LOCAL_PORTS, {17593, 17595, 17596, 17597, 17598})

    def test_preferred_in_reserved_zone_is_skipped(self) -> None:
        # 配置错指保留区(17595=sidecar 本口)或云中继口(17596):扫描起点跳,
        # 落到 17599(17593/17595/17596/17597/17598 全保留)
        registry, result = self._bind(set(), 17595)
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 17599)
        self.assertNotIn(17595, registry.bind_attempts)
        self.assertNotIn(17596, registry.bind_attempts)

    def test_all_scanned_ports_taken_returns_none(self) -> None:
        # 17600..17609 全占 → None
        occupied = set(range(17600, 17610))
        registry, result = self._bind(occupied, DEFAULT_TUNNEL_PORT)
        self.assertIsNone(result)
        self.assertEqual(len(registry.bind_attempts), 10)

    def test_free_preferred_wins_without_scan(self) -> None:
        registry, result = self._bind(set(), DEFAULT_TUNNEL_PORT)
        self.assertEqual(result[1], DEFAULT_TUNNEL_PORT)
        self.assertEqual(registry.bind_attempts, [DEFAULT_TUNNEL_PORT])
        self.assertEqual(registry.listened, [DEFAULT_TUNNEL_PORT])


class BindListenRealSocketTests(unittest.TestCase):
    """真 socket 回环(1103 实弹事故的钉子):bind_local_port 返回的 listener
    必须已 listen——否则 connect 超时/bound-only 假活。零外网,仅 127.0.0.1。"""

    @staticmethod
    def _free_port() -> int:
        probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
        probe.close()
        return port

    def test_bound_listener_accepts_real_connection(self) -> None:
        preferred = self._free_port()
        bound = bind_local_port(preferred)
        self.assertIsNotNone(bound)
        listener, port = bound
        self.assertEqual(port, preferred)
        try:
            listener.settimeout(3)
            # connect 成功 ⇔ 已 listen(bound-only 会 connect 超时/拒绝)
            client = socket.create_connection(("127.0.0.1", port), timeout=3)
            try:
                accepted, _addr = listener.accept()
                client.sendall(b"ping")
                self.assertEqual(accepted.recv(4), b"ping")
                accepted.close()
            finally:
                client.close()
        finally:
            listener.close()

    def test_occupied_port_scans_to_listening_neighbor(self) -> None:
        preferred = self._free_port()
        holder = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        holder.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        holder.bind(("127.0.0.1", preferred))
        holder.listen(1)
        try:
            bound = bind_local_port(preferred)
            self.assertIsNotNone(bound)
            listener, port = bound
            self.assertNotEqual(port, preferred)
            try:
                listener.settimeout(3)
                client = socket.create_connection(("127.0.0.1", port), timeout=3)
                client.close()
            finally:
                listener.close()
        finally:
            holder.close()


class TunnelManagerTests(unittest.TestCase):
    def _manager_with_fake_sockets(self, occupied: set[int] | None = None):
        registry = _FakeSocketRegistry(occupied or set())
        patcher = patch("remote_ssh.tunnel.socket", registry.module())
        patcher.start()
        self.addCleanup(patcher.stop)
        return TunnelManager(), registry

    def test_ensure_is_idempotent_for_same_transport(self) -> None:
        manager, registry = self._manager_with_fake_sockets()
        transport = Mock()
        first = manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        second = manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        self.assertEqual(first, DEFAULT_TUNNEL_PORT)
        self.assertEqual(second, DEFAULT_TUNNEL_PORT)
        self.assertTrue(manager.active())
        self.assertEqual(manager.local_port(), DEFAULT_TUNNEL_PORT)
        self.assertEqual(len(registry.bound), 1)  # 同 transport 只建一个 listener
        self.assertEqual(registry.listened, [DEFAULT_TUNNEL_PORT])  # 且真听

    def test_ensure_rebuilds_when_transport_changes(self) -> None:
        # keeper 重连=transport 换新:旧 listener 关、新 listener 建
        manager, registry = self._manager_with_fake_sockets()
        old_transport, new_transport = Mock(), Mock()
        self.assertEqual(manager.ensure(old_transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595), DEFAULT_TUNNEL_PORT)
        self.assertEqual(manager.ensure(new_transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595), DEFAULT_TUNNEL_PORT)
        self.assertEqual(len(registry.bound), 2)  # 重建了一个
        self.assertEqual(registry.closed, [DEFAULT_TUNNEL_PORT])  # 旧口已关

    def test_ensure_returns_none_when_no_port_available(self) -> None:
        occupied = set(range(17600, 17610))
        manager, _registry = self._manager_with_fake_sockets(occupied)
        self.assertIsNone(manager.ensure(Mock(), DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595))
        self.assertFalse(manager.active())

    def test_stop_releases_listener(self) -> None:
        manager, registry = self._manager_with_fake_sockets()
        manager.ensure(Mock(), DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        self.assertTrue(manager.active())
        manager.stop()
        self.assertFalse(manager.active())
        self.assertIsNone(manager.local_port())
        self.assertEqual(registry.closed, [DEFAULT_TUNNEL_PORT])

    def test_snapshot_is_consistent_pair_under_one_lock(self) -> None:
        # 1103 独立复核#4:分调 active()/local_port() 是两次独立加锁,间隙恰逢
        # stop() 收摊会读到 active=True 而 port=None(代理链拼出 127.0.0.1:None
        # 坏 URL);snapshot 单锁取全——活态 port 必非 None,收摊态 (False, None)。
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        self.assertEqual(manager.snapshot(), (True, DEFAULT_TUNNEL_PORT))
        manager.stop()
        self.assertEqual(manager.snapshot(), (False, None))

    def test_channel_open_failure_closes_client_socket(self) -> None:
        # Windows App 未开(sshd 在、sidecar 死):channel 开失败 → 关客户端连接
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        transport.open_channel.side_effect = Exception("Channel closed")
        manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        cli = Mock()
        manager._spawn_connection(cli)
        cli.close.assert_called_once()

    def test_channel_open_none_also_closes_client(self) -> None:
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        transport.open_channel.return_value = None  # paramiko None 同判失败
        manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        cli = Mock()
        manager._spawn_connection(cli)
        cli.close.assert_called_once()

    def test_concurrent_connection_cap_rejects_new(self) -> None:
        # 并发上限 8:满员后新连接直接关,不再开 channel
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        manager._conn_count = MAX_CONCURRENT_CONNECTIONS
        cli = Mock()
        manager._spawn_connection(cli)
        cli.close.assert_called_once()
        transport.open_channel.assert_not_called()

    def test_open_channel_uses_direct_tcpip_with_remote_target(self) -> None:
        # 配方契约:open_channel("direct-tcpip", (远端 host, 远端 port), src)
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        chan = Mock()
        transport.open_channel = Mock(return_value=chan)
        manager.ensure(transport, DEFAULT_TUNNEL_PORT, "127.0.0.1", 17595)
        with patch("remote_ssh.tunnel.threading.Thread") as thread_cls:
            manager._spawn_connection(Mock())
        transport.open_channel.assert_called_once_with(
            "direct-tcpip", ("127.0.0.1", 17595), ("127.0.0.1", 0)
        )
        # 每连接一个泵线程(daemon)
        self.assertTrue(thread_cls.call_args.kwargs.get("daemon"))


if __name__ == "__main__":
    unittest.main()
