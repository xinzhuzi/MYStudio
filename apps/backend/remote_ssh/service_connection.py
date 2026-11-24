"""service_connection.py — 连接与状态域(构造、启动/停止、keeper 重连、隧道探测、状态与远端命令)

本模块的类由 service.SSHService 混入组合而成:方法体自 SSHService 逐字搬出(1124 超线文件拆分),对外接口不变。

两点约定:
- 须在 service 之后导入(类体里用到的名字在 service 初始化时才就绪;单独先导入本模块会循环导入失败);
- 测试会在 service 上整个替换的名字、以及定义在原类之后的名字,一律经 `service.<名字>` 取(调用时才查),
  在 service 上打桩的效果与搬出前相同。
"""

from __future__ import annotations

from remote_ssh.tunnel import TunnelManager
from remote_ssh import config as ssh_config
import threading
import time

from .service import (
    SSHServiceError,
    _BACKOFF_INITIAL_S,
    _BACKOFF_MAX_S,
    _CONNECT_TIMEOUT_S,
    _KEEPALIVE_S,
    _TORCH_SESSION,
    _TUNNEL_REMOTE_HOST,
    _TUNNEL_REMOTE_PORT,
    _WATCH_INTERVAL_S,
    _paramiko,
    _resolve_key_path,
    _tunnel_local_port_from_cfg,
)


class SSHServiceConnection:
    """连接与状态域(构造、启动/停止、keeper 重连、隧道探测、状态与远端命令)"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._client = None
        self._keeper: threading.Thread | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._started = False
        self._connected = False
        self._connected_host: str | None = None
        self._server_version: str | None = None
        self._last_error: str | None = None
        self._token_refreshed_at: float | None = None
        self._backoff = _BACKOFF_INITIAL_S
        self._tunnel = TunnelManager()

    # ── 模块级能力 ─────────────────────────────────────────────────────

    def available(self) -> bool:
        """paramiko 是否已装(未装=needs-runtime,一切入口只降级)。"""
        return _paramiko() is not None

    # ── 生命周期 ───────────────────────────────────────────────────────

    def start(self) -> bool:
        """起 keeper daemon 线程;未配置(host 空)/paramiko 未装 → 不起(fail-open)。"""
        cfg = ssh_config.load_config()
        if not cfg.get("host"):
            return False  # 未配置=常态,静默不起线程
        if _paramiko() is None:
            print(
                "[remote-ssh] paramiko 未安装(needs-runtime):SSH 功能不可用,"
                "sidecar 照常运行,令牌链回落文件/env",
                flush=True,
            )
            return False
        with self._lock:
            if self._started:
                return True
            self._started = True
            self._stop.clear()
            self._wake.clear()
            self._keeper = threading.Thread(
                target=self._keeper_loop, name="remote-ssh-keeper", daemon=True
            )
            self._keeper.start()
        return True

    def stop(self) -> None:
        """收摊(测试/退出用):停巡检、关隧道、断连接。"""
        self._stop.set()
        self._wake.set()
        self._tunnel.stop()
        self._disconnect_client()

    def notify_config_changed(self) -> None:
        """配置写后热重载:唤醒 keeper 立即重读;keeper 未起(paramiko 后装/
        首启未配置)而前提已齐 → 补调 start() 起 keeper(后装恢复链,
        1103 独立复核#1:免重启 sidecar)。未起 keeper 且仍不可起 → 无操作。"""
        self._recover_start(ssh_config.effective_config())
        self._wake.set()

    def _recover_start(self, cfg: dict) -> None:
        """后装恢复(1103 独立复核#1):启动时 paramiko 未装/未配置 → start()
        在置 _started 前即返 False,keeper 从未创建;用户装好依赖(同进程惰性
        import 立即可用)或写入配置后,首个入口(notify_config_changed/
        status/test_connection)补调 start() 起 keeper——否则 available 变 true
        而 connected 恒 false,须重启 sidecar 才恢复。

        已起(_started=True)恒无操作;paramiko 仍缺/未配置由前置判断短路
        (不走 start() 的打印路径,status 轮询不刷屏);补起失败不拦查询入口。
        """
        if self._started or not cfg.get("host") or _paramiko() is None:
            return
        try:
            self.start()
        except Exception:  # noqa: BLE001 — 补启失败不拦查询入口(fail-open)
            pass

    # ── keeper 线程 ────────────────────────────────────────────────────

    def _keeper_loop(self) -> None:
        """保活循环:建连 → keepalive+隧道+令牌首取 → 巡检;断线指数退避重连。"""
        while not self._stop.is_set():
            # 密码会话叠加(1104 B4):盘上恒空,真密码从进程内存 effective_config 补
            cfg = ssh_config.effective_config()
            if not cfg.get("host"):
                self._mark_disconnected(None)  # 配置被清:安静回未配置态
                self._wake.wait(1.0)
                self._wake.clear()
                continue
            try:
                # 旧连接先收(重连/配置变更路径):连同隧道一并收摊——重连窗口
                # (建连超时 10s+退避)里死 transport 的 listener 不许继续占口
                self._mark_disconnected(None)
                if self._connect_once(cfg):
                    self._backoff = _BACKOFF_INITIAL_S
                    self._on_connected(cfg)
                    self._watch_connection()
                    self._mark_disconnected("SSH 连接断开")
                else:
                    self._mark_disconnected("paramiko 不可用")
            except Exception as exc:  # noqa: BLE001 — keeper 永不外溢崩溃
                self._mark_disconnected(str(exc))
            # 退避等待;wake(配置变更)可提前唤醒立即重试
            if self._wake.wait(self._backoff):
                self._wake.clear()
            self._backoff = min(self._backoff * 2, _BACKOFF_MAX_S)

    def _reconnect_for_sync(self, deadline: float, max_wait_s: float = 20.0) -> bool:
        """同步途中会话死亡的自愈(1104 B5):唤醒 keeper 立即重连(打断退避等待),
        轮询等连接翻绿;keeper 未起(测试/未配置态)直接 False 不空等。"""
        if not self._started:
            return False
        self._wake.set()
        limit = min(time.monotonic() + max_wait_s, deadline)
        while time.monotonic() < limit:
            with self._lock:
                if self._connected and self._client is not None:
                    return True
            time.sleep(0.5)
        return False

    def _connect_once(self, cfg: dict) -> bool:
        """同步建连:accept-new 同语义 + 免密 key;成功即设 keepalive(30)。"""
        paramiko = _paramiko()
        if paramiko is None:
            return False
        client = paramiko.SSHClient()
        client.load_system_host_keys()  # 已知主机键(含键不匹配仍拒的严格面)
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())  # 新主机自动收录
        key_path = _resolve_key_path(cfg.get("keyPath") or "")
        password = str(cfg.get("password") or "").strip()
        connect_kwargs = {
            "hostname": cfg["host"],
            "port": int(cfg.get("port") or ssh_config.DEFAULT_SSH_PORT),
            "username": (cfg.get("user") or None),
            "allow_agent": False,
            "look_for_keys": False,
            "timeout": _CONNECT_TIMEOUT_S,
        }
        # 认证优先序(1103 补):显式密码 > 显式密钥路径 > 自动探测密钥
        # —— paramiko connect 的 password 参数会先试密码,失败回退 key_filename。
        # 两者都给=paramiko 自行回退;都空=连不上(诚实报 auth failed)。
        if password:
            connect_kwargs["password"] = password
            connect_kwargs["look_for_keys"] = True  # 密码失败回退自动探测密钥
        if key_path:
            connect_kwargs["key_filename"] = key_path
            if not password:
                connect_kwargs["look_for_keys"] = True  # 显式 key 失败也回退探测
        elif not password:
            # 都空:让 paramiko 自己探测默认密钥(但 look_for_keys 已 False,手动开)
            connect_kwargs["look_for_keys"] = True
        client.connect(**connect_kwargs)
        transport = client.get_transport()
        if transport is not None:
            try:
                transport.set_keepalive(_KEEPALIVE_S)
            except Exception:  # noqa: BLE001 — keepalive 失败不推翻已建立的连接
                pass
        with self._lock:
            self._client = client
            self._connected = True
            self._connected_host = cfg["host"]
            self._last_error = None
            if transport is not None:
                version = getattr(transport, "remote_version", None)
                if isinstance(version, str):
                    self._server_version = version
        return True

    def _on_connected(self, cfg: dict) -> None:
        """连接建立后的两件事:①隧道(R3 默认开)②令牌后台预取(R2①)。"""
        if cfg.get("tunnelEnabled", True):
            transport = self._client_transport()
            if transport is not None:
                self._tunnel.ensure(
                    transport,
                    int(cfg.get("tunnelLocalPort") or ssh_config.DEFAULT_TUNNEL_LOCAL_PORT),
                    _TUNNEL_REMOTE_HOST,
                    _TUNNEL_REMOTE_PORT,
                )
        elif self._tunnel.active():
            self._tunnel.stop()  # 配置改关隧道:旧 listener 一并收
        # R2①:sidecar 启动后台预取(daemon 线程,非阻塞;失败回落文件/env)
        def prefetch_token() -> None:
            refreshed = self.refresh_remote_token(timeout_s=15)
            print(f"[remote-ssh] 令牌预取{'成功' if refreshed else '失败'}", flush=True)

        threading.Thread(
            target=prefetch_token,
            name="remote-ssh-token-prefetch",
            daemon=True,
        ).start()

    def _watch_connection(self) -> None:
        """已连接态巡检:transport 失活/隧道数据面死/收到 wake 即返回重连。

        1103 修(隧道通道死链自愈):Windows App 重启→sidecar 进程换代→隧道
        通道(内嵌在 SSH 里的 direct-tcpip)指向旧进程=数据面死,但 SSH 连接
        (22 端口→sshd)活着→transport.is_active()=True→旧巡检永不触发重连。
        加数据面探针(穿隧道打远端 /health,3s 超时):SSH 活但隧道死→撕掉
        旧通道→用现 transport 重建→远端 sidecar 在即秒恢复;不在则下一轮
        探针再试(SSH 层面仍连着,重试零成本)。
        """
        tunnel_probe_failures = 0
        while not self._stop.is_set():
            if self._wake.is_set() or not self._transport_active():
                return
            # 隧道数据面探针(只在隧道启用时)
            if self._tunnel.active():
                if not self._probe_tunnel_data_path():
                    tunnel_probe_failures += 1
                    if tunnel_probe_failures >= 2:  # 连续两败=真死,重建
                        self._tunnel.stop()
                        self._tunnel.ensure(
                            self._client_transport(),
                            _tunnel_local_port_from_cfg(),
                            _TUNNEL_REMOTE_HOST,
                            _TUNNEL_REMOTE_PORT,
                        )
                        tunnel_probe_failures = 0
                else:
                    tunnel_probe_failures = 0
            self._wake.wait(_WATCH_INTERVAL_S)

    def _probe_tunnel_data_path(self) -> bool:
        """隧道数据面探针:穿隧道打远端 sidecar /health(无鉴权路由,3s 超时)。

        探针路径走隧道口(127.0.0.1:{port}/health)→SSH 通道→远端 17595。
        回 200=数据面活;任何异常(拒绝/超时/断连)=死。
        """
        port = self._tunnel.local_port()
        if port is None:
            return False
        import urllib.request
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/health")
            with urllib.request.urlopen(req, timeout=3) as resp:
                return resp.status == 200
        except Exception:  # noqa: BLE001 — 任何异常=数据面死
            return False

    def _transport_active(self) -> bool:
        transport = self._client_transport()
        if transport is None:
            return False
        try:
            return bool(transport.is_active())
        except Exception:  # noqa: BLE001 — transport 已塌等异常按失活处理
            return False

    def _client_transport(self):
        with self._lock:
            client = self._client
        if client is None:
            return None
        try:
            return client.get_transport()
        except Exception:  # noqa: BLE001
            return None

    def _mark_disconnected(self, reason: str | None) -> None:
        """断开收尾(R3/C2):关 client + 停隧道。

        隧道随断开一并收摊——否则 SSH 断开(sshd 停/网络断/配置清 host)期间
        listener 仍占隧道口(默认 17600),tunnel_active() 恒 True,_remote_sidecar_base_url
        继续把代理引到死 transport 上开 channel 全 502;停口后断开窗口自动
        回落直连(server.py R3「隧道未活(未配置/断开)→现行直连路径零迁移」)。
        keeper 重连后 _on_connected→ensure(新 transport) 原路径重建,零额外态。
        """
        with self._lock:
            self._connected = False
            if reason is not None:
                self._last_error = reason
        self._tunnel.stop()
        self._disconnect_client()

    def _disconnect_client(self) -> None:
        with self._lock:
            client = self._client
            self._client = None
            self._connected = False
        if client is not None:
            try:
                client.close()
            except Exception:  # noqa: BLE001 — 收尾失败忽略
                pass

    # ── 对外查询 ───────────────────────────────────────────────────────

    def status(self) -> dict:
        """状态快照(R1 契约字段 + available/tunnelEnabled 补充)。

        顺带做后装恢复探针(1103 独立复核#1):paramiko 装好后前端回开设置页
        首个 status 即补起 keeper,徽章三态自愈(available→connected)。
        """
        cfg = ssh_config.load_config()
        self._recover_start(cfg)
        with self._lock:
            return {
                "available": self.available(),
                "configured": bool(cfg.get("host")),
                "connected": self._connected,
                "host": cfg.get("host") or "",
                "user": cfg.get("user") or "",
                # password 永不回显(安全;UI 编辑时密码框留空=不改现有密码)
                "serverVersion": self._server_version,
                "lastError": self._last_error,
                "tunnelEnabled": bool(cfg.get("tunnelEnabled", True)),
                "tunnelActive": self._tunnel.active(),
                "tunnelLocalPort": self._tunnel.local_port(),
                "tokenRefreshedAt": self._token_refreshed_at,
            }

    def tunnel_active(self) -> bool:
        return self._tunnel.active()

    def tunnel_local_port(self) -> int | None:
        return self._tunnel.local_port()

    def tunnel_snapshot(self) -> tuple[bool, int | None]:
        """单锁快照 (active, port):active=True 时 port 必非 None——代理链
        (_remote_sidecar_base_url)分调 tunnel_active/tunnel_local_port 是两次
        独立加锁,间隙恰逢断开收摊会拼出 http://127.0.0.1:None 坏 URL
        (1103 独立复核#4 TOCTOU);本快照一次锁内取全,该竞态无处发生。"""
        return self._tunnel.snapshot()

    # ── SFTP 面(R2:全链只走 SFTP,禁远程 exec)───────────────────────

    def sftp_read_text(self, path: str) -> str:
        """共享 client 加锁读远端文本;SFTPClient 每次新建用完关(防陈旧句柄)。"""
        with self._lock:
            client = self._client
        if client is None or not self._connected:
            raise SSHServiceError("SSH 未连接")
        try:
            sftp = client.open_sftp()
        except Exception as exc:  # noqa: BLE001 — paramiko 各类失败统一映射
            raise SSHServiceError(f"SFTP 打开失败: {exc}") from exc
        try:
            with sftp.open(path, "r") as handle:
                data = handle.read()
        except Exception as exc:  # noqa: BLE001 — 含远端 miss/坏路径/IO
            raise SSHServiceError(f"SFTP 读取失败: {exc}") from exc
        finally:
            try:
                sftp.close()
            except Exception:  # noqa: BLE001
                pass
        if isinstance(data, bytes):
            return data.decode("utf-8", "replace")
        return str(data)

    def run_remote_command(self, command: str, timeout_s: float = 30) -> tuple[int, str]:
        """SSH exec_command(1104 plugin-sync):在远端执行 shell 命令,回 (exit_code, stdout+stderr)。

        只在已连接时可用;失败抛 SSHServiceError(调用方诚实报)。
        """
        with self._lock:
            client = self._client
            expected = getattr(_TORCH_SESSION, "client", None)
            if expected is not None and (client is not expected or not self._connected):
                raise SSHServiceError("升级期间 SSH 会话已改变，拒绝操作其他主机")
        if client is None:
            raise SSHServiceError("SSH 未连接")
        try:
            _, stdout, stderr = client.exec_command(command, timeout=timeout_s)
            output = stdout.read().decode("utf-8", "replace") + stderr.read().decode("utf-8", "replace")
            return int(stdout.channel.recv_exit_status()), output
        except Exception as exc:
            raise SSHServiceError(f"远端命令执行失败: {exc}") from exc
