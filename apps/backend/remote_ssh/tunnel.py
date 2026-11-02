"""SSH 本地转发隧道(direct-tcpip + select 双向泵;11-03 sidecar-ssh-module R1)。

冒烟实证(tasks/11-03-sidecar-ssh-module/research/d6-smoke-verdict-1103.md):
paramiko transport.open_channel("direct-tcpip") + select 双向泵 ~40 行即可
转发(tunnel→17000 /system_stats=200),不引半维护的 sshtunnel 包。

端口防撞(D5):默认 17596;EADDRINUSE 时向后扫描 10 口,**跳过 17595/17597/
17598 保留区**(17595=sidecar、17597=开发侧车、17598=引擎回落)。

语义:sshd 在而 Windows sidecar 死(App 未开)→ channel 开失败 → 关客户端
连接 → HTTP 层吃 connection-refused → 由调用方诚实报错;keeper 重连后
下一次请求自愈。
"""

from __future__ import annotations

import select
import socket
import threading

# 本机保留区(定制代码地图.md:28 / comfyui_bridge.py:184):隧道口须避让三件
RESERVED_LOCAL_PORTS = {17595, 17597, 17598}
# 单个隧道的并发连接上限(超出拒新,防资源耗尽)
MAX_CONCURRENT_CONNECTIONS = 8
# 泵空闲超时:20s 无流量双向断开(挂死连接回收)
IDLE_TIMEOUT_S = 20.0
# 默认口占满时向后扫描的口数(17596..17605)
SCAN_SPAN = 10
_CHUNK = 65536


def bind_local_port(preferred_port: int) -> tuple[socket.socket, int] | None:
    """取一个空闲本地口:先试 preferred,EADDRINUSE 向后扫 10 口,跳过保留区。

    返回 (已 bind 的 listener, 实际口);10 口全满 → None(调用方按隧道未建处理)。
    """
    for candidate in range(preferred_port, preferred_port + SCAN_SPAN):
        if candidate in RESERVED_LOCAL_PORTS:
            continue  # 保留区跳过(即使配置错指到保留区也不占)
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            listener.bind(("127.0.0.1", candidate))
        except OSError:
            listener.close()  # 占用/不可绑:试下一个
            continue
        return listener, candidate
    return None


class TunnelManager:
    """direct-tcpip 转发管理器:幂等 ensure + accept 线程 + 每连接一泵线程。"""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._listener: socket.socket | None = None
        self._local_port: int | None = None
        self._transport = None  # paramiko Transport(弱持有,失效由 service 侧重建)
        self._remote_host = "127.0.0.1"
        self._remote_port = 0
        self._conn_count = 0

    # ── 状态 ─────────────────────────────────────────────────────────────

    def active(self) -> bool:
        with self._lock:
            return self._listener is not None

    def local_port(self) -> int | None:
        with self._lock:
            return self._local_port

    # ── 生命周期 ─────────────────────────────────────────────────────────

    def ensure(self, transport, preferred_port: int, remote_host: str, remote_port: int) -> int | None:
        """幂等建隧道:同一 transport 已建 → 返回现口;transport 变了(keeper
        重连)→ 关旧建新。返回实际监听口;绑定失败(10 口全满)→ None。"""
        with self._lock:
            if self._listener is not None and self._transport is transport:
                return self._local_port
            self._stop_locked()
        bound = bind_local_port(preferred_port)
        if bound is None:
            return None
        listener, port = bound
        with self._lock:
            self._listener = listener
            self._local_port = port
            self._transport = transport
            self._remote_host = remote_host
            self._remote_port = remote_port
        threading.Thread(
            target=self._accept_loop, name=f"remote-ssh-tunnel-{port}", daemon=True
        ).start()
        return port

    def stop(self) -> None:
        """关 listener(活动泵随 socket 关闭自行退出;计数自然归零)。"""
        with self._lock:
            self._stop_locked()

    def _stop_locked(self) -> None:
        if self._listener is not None:
            try:
                self._listener.close()
            except OSError:
                pass
        self._listener = None
        self._local_port = None
        self._transport = None

    # ── 连接处理 ─────────────────────────────────────────────────────────

    def _accept_loop(self) -> None:
        while True:
            with self._lock:
                listener = self._listener
            if listener is None:
                return  # 已 stop
            try:
                cli, _ = listener.accept()
            except OSError:
                return  # listener 关闭(stop/异常):退出 accept 线程
            self._spawn_connection(cli)

    def _spawn_connection(self, cli: socket.socket) -> None:
        """单连接处理:并发上限闸 → direct-tcpip channel → 泵线程。

        channel 开失败(远端 sidecar 未监听)= 关客户端连接(诚实拒,
        HTTP 层吃 connection-refused),绝不半开挂着。
        """
        with self._lock:
            transport = self._transport
            remote_host = self._remote_host
            remote_port = self._remote_port
            if transport is None:
                cli.close()
                return
            if self._conn_count >= MAX_CONCURRENT_CONNECTIONS:
                cli.close()  # 超并发上限:拒新
                return
            self._conn_count += 1
        try:
            chan = transport.open_channel(
                "direct-tcpip", (remote_host, remote_port), ("127.0.0.1", 0)
            )
        except Exception:  # noqa: BLE001 — channel 开失败(目标死/transport 断)
            self._connection_done(cli, None)
            return
        if chan is None:
            self._connection_done(cli, None)
            return
        threading.Thread(
            target=self._pump, args=(cli, chan), daemon=True,
            name="remote-ssh-tunnel-conn",
        ).start()

    def _pump(self, cli: socket.socket, chan) -> None:
        """select 双向泵(cli/chan 互拷):EOF 双关、异常双关、20s 空闲断。"""
        try:
            while True:
                readable, _, _ = select.select([cli, chan], [], [], IDLE_TIMEOUT_S)
                if not readable:
                    break  # 空闲超时断开
                if cli in readable:
                    data = cli.recv(_CHUNK)
                    if not data:
                        break  # 客户端 EOF:双关
                    chan.sendall(data)
                if chan in readable:
                    data = chan.recv(_CHUNK)
                    if not data:
                        break  # 远端 EOF:双关
                    cli.sendall(data)
        except OSError:
            pass  # 任一侧塌了:走 finally 双关
        finally:
            self._connection_done(cli, chan)

    def _connection_done(self, cli: socket.socket, chan) -> None:
        """收尾:双侧关闭 + 计数递减(幂等,关失败忽略)。"""
        for side in (cli, chan):
            if side is None:
                continue
            try:
                side.close()
            except OSError:
                pass
        with self._lock:
            self._conn_count = max(0, self._conn_count - 1)
