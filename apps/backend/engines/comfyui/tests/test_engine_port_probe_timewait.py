"""1006 端口漂移定谳回归:_port_bindable 的 TIME_WAIT 语义。

根因实录:引擎绑口走 aiohttp TCPSite → asyncio create_server,POSIX 默认
SO_REUSEADDR;旧探测不带 REUSEADDR,把刚死引擎残留的 TIME_WAIT(macOS
2×MSL=30s,内核持有)误判「被占」→ resolve_launch_port/find_free_port
无谓顺延 → 端口漂移(实测 17000↔17001 摇摆)。修法=探测与引擎绑口同样带
REUSEADDR:TIME_WAIT 窗口判「可绑」(引擎本可绑回原口),活监听仍判「被占」。

测试只用 port=0 随机回环口,绝不触碰 17000-17999 引擎段(并行会话所在);
Windows 无同语义,整文件 POSIX-only 跳过。
"""
from __future__ import annotations

import os
import socket

import pytest

from engines.comfyui.engine_manager import _port_bindable

pytestmark = pytest.mark.skipif(os.name != "posix", reason="REUSEADDR 语义 POSIX-only")


def _spawn_timewait_on_fresh_port() -> int:
    """在随机回环口制造服务端侧 TIME_WAIT:accept 后服务端主动关闭,
    内核为该 (口, 对端) 保留 TIME_WAIT——即旧引擎刚死时的真实残留形态。"""
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.bind(("127.0.0.1", 0))
    port = server.getsockname()[1]
    server.listen(1)
    client = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    client.connect(("127.0.0.1", port))
    conn, _ = server.accept()
    conn.close()      # 服务端主动关闭 → 该口服务端侧进 TIME_WAIT
    client.close()
    server.close()    # 监听 socket 关闭:口上已无监听者,仅剩 TIME_WAIT
    return port


class TestPortBindableTimeWait:
    def test_timewait_only_port_is_bindable(self):
        """TIME_WAIT 残留(无监听者)须判可绑——否则引擎每次重启无谓顺延。"""
        port = _spawn_timewait_on_fresh_port()
        assert _port_bindable(port) is True

    def test_live_listener_still_reported_unbindable(self):
        """活监听者必须仍判被占——REUSEADDR 不放行双绑(双引擎防线不松)。"""
        server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        server.bind(("127.0.0.1", 0))
        port = server.getsockname()[1]
        server.listen(1)
        try:
            assert _port_bindable(port) is False
        finally:
            server.close()
