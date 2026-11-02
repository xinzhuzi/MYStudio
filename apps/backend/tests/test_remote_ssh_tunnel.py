"""remote_ssh.tunnel 单元测(11-03 sidecar-ssh-module S1)。

矩阵(PRD 测试矩阵 tunnel 行):防撞跳保留区 / channel 开失败关连接 /
幂等 ensure / 并发上限 8。全 mock socket+transport(C7:零真网络)。
"""

from __future__ import annotations

import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from remote_ssh import tunnel as tunnel_mod
from remote_ssh.tunnel import MAX_CONCURRENT_CONNECTIONS, RESERVED_LOCAL_PORTS, TunnelManager, bind_local_port


class _FakeSocketRegistry:
    """socket 模块假体:occupied 集合控制 bind 失败,记录 bind/close 轨迹。"""

    def __init__(self, occupied: set[int]) -> None:
        self.occupied = set(occupied)
        self.bind_attempts: list[int] = []
        self.bound: list[int] = []
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

    def test_default_port_taken_skips_reserved_zone(self) -> None:
        # D5 防撞:17596 占用 → 17597/17598 保留区**不试**→ 17599 落口
        registry, result = self._bind({17596}, 17596)
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 17599)
        # 保留区两口连 bind 尝试都没有
        self.assertNotIn(17597, registry.bind_attempts)
        self.assertNotIn(17598, registry.bind_attempts)

    def test_preferred_in_reserved_zone_is_skipped(self) -> None:
        # 配置错指保留区(17595=sidecar 本口):扫描起点也跳
        registry, result = self._bind(set(), 17595)
        self.assertIsNotNone(result)
        self.assertEqual(result[1], 17596)  # 跳过 17595 → 17596 空闲即用
        self.assertNotIn(17595, registry.bind_attempts)

    def test_all_scanned_ports_taken_returns_none(self) -> None:
        # 17596..17605 可试口全占(保留区本就不试)→ None
        occupied = {p for p in range(17595, 17606) if p not in RESERVED_LOCAL_PORTS}
        registry, result = self._bind(occupied, 17596)
        self.assertIsNone(result)
        self.assertEqual(len(registry.bind_attempts), 10 - len(RESERVED_LOCAL_PORTS & set(range(17596, 17606))))

    def test_free_preferred_wins_without_scan(self) -> None:
        registry, result = self._bind(set(), 17596)
        self.assertEqual(result[1], 17596)
        self.assertEqual(registry.bind_attempts, [17596])


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
        first = manager.ensure(transport, 17596, "127.0.0.1", 17595)
        second = manager.ensure(transport, 17596, "127.0.0.1", 17595)
        self.assertEqual(first, 17596)
        self.assertEqual(second, 17596)
        self.assertTrue(manager.active())
        self.assertEqual(manager.local_port(), 17596)
        self.assertEqual(len(registry.bound), 1)  # 同 transport 只建一个 listener

    def test_ensure_rebuilds_when_transport_changes(self) -> None:
        # keeper 重连=transport 换新:旧 listener 关、新 listener 建
        manager, registry = self._manager_with_fake_sockets()
        old_transport, new_transport = Mock(), Mock()
        self.assertEqual(manager.ensure(old_transport, 17596, "127.0.0.1", 17595), 17596)
        self.assertEqual(manager.ensure(new_transport, 17596, "127.0.0.1", 17595), 17596)
        self.assertEqual(len(registry.bound), 2)  # 重建了一个
        self.assertEqual(registry.closed, [17596])  # 旧口已关

    def test_ensure_returns_none_when_no_port_available(self) -> None:
        occupied = {p for p in range(17595, 17606) if p not in RESERVED_LOCAL_PORTS}
        manager, _registry = self._manager_with_fake_sockets(occupied)
        self.assertIsNone(manager.ensure(Mock(), 17596, "127.0.0.1", 17595))
        self.assertFalse(manager.active())

    def test_stop_releases_listener(self) -> None:
        manager, registry = self._manager_with_fake_sockets()
        manager.ensure(Mock(), 17596, "127.0.0.1", 17595)
        self.assertTrue(manager.active())
        manager.stop()
        self.assertFalse(manager.active())
        self.assertIsNone(manager.local_port())
        self.assertEqual(registry.closed, [17596])

    def test_channel_open_failure_closes_client_socket(self) -> None:
        # Windows App 未开(sshd 在、sidecar 死):channel 开失败 → 关客户端连接
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        transport.open_channel.side_effect = Exception("Channel closed")
        manager.ensure(transport, 17596, "127.0.0.1", 17595)
        cli = Mock()
        manager._spawn_connection(cli)
        cli.close.assert_called_once()

    def test_channel_open_none_also_closes_client(self) -> None:
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        transport.open_channel.return_value = None  # paramiko None 同判失败
        manager.ensure(transport, 17596, "127.0.0.1", 17595)
        cli = Mock()
        manager._spawn_connection(cli)
        cli.close.assert_called_once()

    def test_concurrent_connection_cap_rejects_new(self) -> None:
        # 并发上限 8:满员后新连接直接关,不再开 channel
        manager, _registry = self._manager_with_fake_sockets()
        transport = Mock()
        manager.ensure(transport, 17596, "127.0.0.1", 17595)
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
        manager.ensure(transport, 17596, "127.0.0.1", 17595)
        with patch("remote_ssh.tunnel.threading.Thread") as thread_cls:
            manager._spawn_connection(Mock())
        transport.open_channel.assert_called_once_with(
            "direct-tcpip", ("127.0.0.1", 17595), ("127.0.0.1", 0)
        )
        # 每连接一个泵线程(daemon)
        self.assertTrue(thread_cls.call_args.kwargs.get("daemon"))


if __name__ == "__main__":
    unittest.main()
