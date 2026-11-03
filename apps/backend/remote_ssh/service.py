"""SSHService 单例(paramiko 同步实现;11-03 sidecar-ssh-module R1/R2)。

架构(paramiko 转正定谳,PRD 库选型表):
  - 同步 API 与 sidecar 的 ThreadingHTTPServer 线程模型原生合体;
  - _keeper daemon 线程:建连(超时 10s)→ Transport.set_keepalive(30) →
    断线指数退避重连(1s 起步、30s 封顶);断开即收隧道——断开窗口代理链
    回落直连、重连后 ensure 重建(R3/C2);
  - 密钥=复用现有免密 key(Q2):keyPath 空 → 自动探测 ~/.ssh/id_ed25519 →
    id_ecdsa → id_rsa 首个存在者;allow_agent=False + look_for_keys=False;
  - load_system_host_keys() + AutoAddPolicy = accept-new 同语义(已知键
    不匹配仍拒,新增主机自动收录);
  - 令牌自愈(R2):SFTP 依次读远端 config.json 取 controlToken,**禁远程
    exec**(PowerShell-over-SSH 挂死前科,engine_manager.py:1077-1078);
  - fail-open:paramiko 惰性导入,ImportError=服务不可用但 sidecar 照常起。
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import re
import threading
import time
from pathlib import Path

from remote_ssh import config as ssh_config
from remote_ssh.tunnel import TunnelManager

# 令牌文件名:与 image_gen/server.py 的 REMOTE_TOKEN_FILE_NAME 同字面
# (消费链 server.py:130 _remote_sidecar_token_from_file 零改动;此处不
# import server 避免 image_gen→remote_ssh→image_gen 环)。
TOKEN_FILE_NAME = "remote-image-token.txt"
# B7 同款令牌正则(deploy-dual.sh 令牌搬运口径):字母数字开头,后跟
# 字母数字/下划线/连字符
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
# keyPath 空时的自动探测顺序(Q2:复用现有免密 key,ed25519 优先)
_KEY_CANDIDATES = (".ssh/id_ed25519", ".ssh/id_ecdsa", ".ssh/id_rsa")
# keeper 建连超时(秒)
_CONNECT_TIMEOUT_S = 10
# 保活间隔(秒):Transport.set_keepalive(30)
_KEEPALIVE_S = 30
# 断线重连退避:1s 起步、30s 封顶
_BACKOFF_INITIAL_S = 1.0
_BACKOFF_MAX_S = 30.0
# keeper 已连接态的巡检间隔(秒):wake 立时可醒
_WATCH_INTERVAL_S = 5.0
# 隧道转发目标:远端本机 sidecar(与 server.REMOTE_SIDECAR_PORT=17595 同字面;
# 冒烟脚本 tunnel 127.0.0.1:17596 → Windows 127.0.0.1:17595 同款)
_TUNNEL_REMOTE_HOST = "127.0.0.1"
_TUNNEL_REMOTE_PORT = 17595


class SSHServiceError(Exception):
    """SSH 服务级失败(未连接/未装依赖/IO 失败);调用方按降级处理。"""


def _paramiko():
    """paramiko 惰性导入:未装(needs-runtime)→ None,fail-open 不拦 sidecar。"""
    try:
        import paramiko  # noqa: PLC0415 — 惰性导入是 fail-open 契约本体
    except ImportError:
        return None
    return paramiko


def _resolve_key_path(key_path: str) -> str | None:
    """keyPath 显式给了 → expanduser 直用;空 → 探测默认 key 首个存在者。"""
    explicit = (key_path or "").strip()
    if explicit:
        return str(Path(os.path.expanduser(explicit)))
    ssh_root = Path(os.path.expanduser("~"))
    for name in _KEY_CANDIDATES:
        candidate = ssh_root / name
        if candidate.exists():
            return str(candidate)
    return None


class SSHService:
    """paramiko 同步 SSH 客户端(线程安全;所有对外调用异常不外溢成崩溃)。"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._client = None
        self._keeper: threading.Thread | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._started = False
        self._connected = False
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
        self._recover_start(ssh_config.load_config())
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
            cfg = ssh_config.load_config()
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
        # R2①:sidecar 启动后台预取(daemon 线程,非阻塞;失败静默回落文件/env)
        threading.Thread(
            target=self.refresh_remote_token,
            kwargs={"timeout_s": 15},
            name="remote-ssh-token-prefetch",
            daemon=True,
        ).start()

    def _watch_connection(self) -> None:
        """已连接态巡检:transport 失活/收到 wake(配置变更)即返回重连。"""
        while not self._stop.is_set():
            if self._wake.is_set() or not self._transport_active():
                return
            self._wake.wait(_WATCH_INTERVAL_S)

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

    def refresh_remote_token(self, timeout_s: float | None = None) -> bool:
        """R2 令牌自愈:SFTP 依次读 tokenConfigPaths → controlToken → 正则校验
        → tmp+replace 原子写 comfyui 家 remote-image-token.txt(消费链零改动)。

        timeout_s 给定时在独立线程执行并限时返回(R2② 的 15s 超时;超时=失败,
        后台线程自然收尾不阻塞调用方)。失败恒返回 False,不外溢异常。
        """
        if timeout_s is None:
            try:
                return self._refresh_token_once()
            except Exception:  # noqa: BLE001 — 自愈链失败=诚实 False
                return False
        future = _sftp_executor().submit(self._refresh_token_once)
        try:
            return bool(future.result(timeout=timeout_s))
        except concurrent.futures.TimeoutError:
            return False
        except Exception:  # noqa: BLE001
            return False

    def _refresh_token_once(self) -> bool:
        cfg = ssh_config.load_config()
        for path in ssh_config.effective_token_config_paths(cfg):
            try:
                raw = self.sftp_read_text(path)
                data = json.loads(raw)
            except (SSHServiceError, OSError, ValueError):
                continue  # miss / 坏 JSON / 未连接:试下一条真源路径
            if not isinstance(data, dict):
                continue
            token = data.get("controlToken")
            if not isinstance(token, str) or not _TOKEN_RE.fullmatch(token):
                continue  # 正则拒/类型不对:试下一条(B7 同款口径)
            self._write_token_file(token)
            with self._lock:
                self._token_refreshed_at = time.time()
            return True
        return False

    @staticmethod
    def _write_token_file(token: str) -> None:
        """tmp+replace 原子写(与 B7 裸写同内容 last-writer-wins,无冲突 C4)。"""
        from comfyui.manifest import comfy_home

        home = comfy_home()
        home.mkdir(parents=True, exist_ok=True)
        target = home / TOKEN_FILE_NAME
        tmp = home / f"{TOKEN_FILE_NAME}.tmp"
        tmp.write_text(token, encoding="utf-8")
        tmp.replace(target)

    def peek_remote_token(self, timeout_s: float | None = None) -> dict:
        """「测试连接」用的令牌读取回执(len 掩码;只读不落盘)。

        timeout_s 给定时在独立线程执行并限时返回(R1「对外调用必带超时」,
        1103 独立复核#2:transport 半死时 paramiko SFTP 请求可无限阻塞,不许
        悬挂 HTTP handler 线程——test 路与 refresh 路同款 executor 限时;超时/
        异常=读取失败回执 {ok: False},后台线程自然收尾不阻塞调用方)。
        """
        if timeout_s is None:
            return self._peek_token_once()
        future = _sftp_executor().submit(self._peek_token_once)
        try:
            return dict(future.result(timeout=timeout_s))
        except Exception:  # noqa: BLE001 — 超时/异常统一=失败回执,不外溢
            return {"ok": False, "length": None, "source": None}

    def _peek_token_once(self) -> dict:
        cfg = ssh_config.load_config()
        for path in ssh_config.effective_token_config_paths(cfg):
            try:
                raw = self.sftp_read_text(path)
                data = json.loads(raw)
            except (SSHServiceError, OSError, ValueError):
                continue
            if isinstance(data, dict) and isinstance(data.get("controlToken"), str):
                token = data["controlToken"]
                return {
                    "ok": bool(_TOKEN_RE.fullmatch(token)),
                    "length": len(token),
                    "source": path,
                }
        return {"ok": False, "length": None, "source": None}

    def test_connection(self) -> dict:
        """R4「测试连接」回执四件:登录用户/服务器版本/令牌读取(len 掩码)/隧道探活。

        令牌读取带 15s 超时(R1 对外调用必带超时,1103 独立复核#2);入口顺带
        后装恢复探针(paramiko 刚装好即起 keeper,本次回执按未连接、keeper
        立即开始建连,后续 status 自愈)。
        """
        if not self.available():
            return {
                "ok": False,
                "reason": "needs-runtime",
                "message": "paramiko 未安装:请在设置的 Python 运行环境页完成依赖配置后重试",
            }
        cfg = ssh_config.load_config()
        if not cfg.get("host"):
            return {"ok": False, "reason": "not-configured", "message": "未配置 SSH 主机"}
        self._recover_start(cfg)
        with self._lock:
            connected = self._connected
            last_error = self._last_error
        if not connected:
            return {
                "ok": False,
                "reason": "disconnected",
                "host": cfg.get("host") or "",
                "message": last_error or "SSH 未连接(keeper 重连中)",
            }
        transport = self._client_transport()
        login_user = ""
        if transport is not None:
            try:
                login_user = str(transport.get_username() or "")
            except Exception:  # noqa: BLE001
                login_user = ""
        with self._lock:
            server_version = self._server_version
        # 隧道回执同用单锁快照(1103 复核#4 同源):active 与 localPort 一致取全
        tunnel_active, tunnel_port = self._tunnel.snapshot()
        return {
            "ok": True,
            "user": login_user or (cfg.get("user") or ""),
            "serverVersion": server_version,
            "token": self.peek_remote_token(timeout_s=15),
            "tunnel": {"active": tunnel_active, "localPort": tunnel_port},
        }


# ── 单例与模块级入口 ────────────────────────────────────────────────────

_service: SSHService | None = None
_service_lock = threading.Lock()
# SFTP 限时操作的专用单线程池(refresh/peek 共用;daemon:超时不拖进程退出,
# 泄漏线程由池复用——单 worker 串行化同一 client 上的 SFTP 会话)
_sftp_pool: concurrent.futures.ThreadPoolExecutor | None = None


def ssh_service() -> SSHService:
    """进程级单例(照 comfyui.engine_manager.engine_manager 范式)。"""
    global _service
    with _service_lock:
        if _service is None:
            _service = SSHService()
        return _service


def notify_config_changed() -> None:
    """config.save_config 写后回调入口。"""
    ssh_service().notify_config_changed()


def _sftp_executor() -> concurrent.futures.ThreadPoolExecutor:
    global _sftp_pool
    if _sftp_pool is None:
        _sftp_pool = concurrent.futures.ThreadPoolExecutor(
            max_workers=1, thread_name_prefix="remote-ssh-sftp"
        )
    return _sftp_pool


def reset_for_tests() -> None:
    """测试隔离:重置单例(照 comfyui.bridge_actions.reset_for_tests 范式)。"""
    global _service, _sftp_pool
    with _service_lock:
        if _service is not None:
            _service.stop()
        _service = SSHService()
    if _sftp_pool is not None:
        _sftp_pool.shutdown(wait=False)
        _sftp_pool = None
