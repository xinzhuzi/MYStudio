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



def _tunnel_local_port_from_cfg() -> int:
    """当前配置的隧道口偏好(巡检重建用;配置缺省=17600)。"""
    cfg = ssh_config.load_config()
    port = cfg.get("tunnelLocalPort")
    if isinstance(port, int) and 0 < port <= 65535:
        return port
    return ssh_config.DEFAULT_TUNNEL_LOCAL_PORT


# ── 1104 引擎同步中心(tasks/11-04-engine-sync)─────────────────────────
# Windows 引擎家与 sync_plugins(1104 plugin-sync)同字面——同机同布局,
# 两法同源;这里收拢成常量供新 engine-sync 逻辑引用。
_WIN_COMFY_ROOT = "E:\\IP\\漫影工作室\\comfyui"
_WIN_CUSTOM_NODES = _WIN_COMFY_ROOT + "\\ComfyUI\\custom_nodes"
_WIN_VENV_PYTHON = _WIN_COMFY_ROOT + "\\venv\\Scripts\\python.exe"
# 引擎条目名(清单/回执里 ComfyUI 本体的固定 name)
_ENGINE_SYNC_ENGINE_NAME = "ComfyUI"
_COMFYUI_REPO_URL = "https://github.com/comfyanonymous/ComfyUI"
# Q2:my-nodes 归 deploy-dual 管,engine-sync 恒跳过
_ENGINE_SYNC_SKIP_NAMES = {"my-nodes"}
# Q3:同步整体超时 30min(1104 修正:10→30min,41 件全量 clone 需要时间;
# 部分失败不阻断,超时项标 failed)
_ENGINE_SYNC_OVERALL_TIMEOUT_S = 1800.0
# 单件 git 操作上限(pull/clone;1104 修正:180→300s,整仓 clone 需要时间)
_ENGINE_SYNC_ITEM_TIMEOUT_S = 300.0


def engine_sync_json_path() -> Path:
    """engine-sync.json 单真源路径(仓库内 committed,部署随 App 分发)。

    MYSTUDIO_ENGINE_SYNC_JSON 显式覆写=测试缝(照 comfy_home 的
    MYSTUDIO_COMFYUI_HOME 范式),防测试写脏仓库文件。
    """
    override = os.environ.get("MYSTUDIO_ENGINE_SYNC_JSON", "")
    if override:
        return Path(override).expanduser()
    return Path(__file__).resolve().parents[1] / "comfyui" / "engine-sync.json"


def _mac_custom_nodes_dir() -> Path:
    """Mac 本机 custom_nodes 路径(from comfyui.manifest import comfy_home 口径)。"""
    from comfyui.manifest import comfy_home

    return comfy_home() / "ComfyUI" / "custom_nodes"


def _scan_mac_git_packages() -> dict[str, str]:
    """扫 Mac custom_nodes git 包(有 .git 目录者):name → origin url。

    排除 my-nodes(Q2)/非 git 目录/散件(example_node.py.example 不是目录)。
    url 读不到的包不入清单(诚实缺,不猜)。
    """
    import subprocess

    packages: dict[str, str] = {}
    nodes = _mac_custom_nodes_dir()
    if not nodes.is_dir():
        return packages
    for entry in sorted(nodes.iterdir()):
        if not entry.is_dir() or not (entry / ".git").is_dir():
            continue
        if entry.name in _ENGINE_SYNC_SKIP_NAMES:
            continue
        try:
            url = (
                subprocess.run(
                    ["git", "-C", str(entry), "remote", "get-url", "origin"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                .stdout.strip()
            )
        except Exception:  # noqa: BLE001 — 单包 git 读取失败不拦整轮扫描
            continue
        if url:
            packages[entry.name] = url
    return packages


def _mac_git_head(path: Path) -> str | None:
    """本地 git HEAD(读不到回 None——目录非 git/无提交/超时)。"""
    import subprocess

    try:
        out = (
            subprocess.run(
                ["git", "-C", str(path), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            .stdout.strip()
        )
    except Exception:  # noqa: BLE001
        return None
    return out or None


def _empty_engine_sync_doc() -> dict:
    """清单骨架(version=1;ComfyUI 引擎条目 repo+strategy=match-local,Q6)。"""
    return {
        "version": 1,
        "comfyui": {"repo": _COMFYUI_REPO_URL, "strategy": "match-local"},
        "plugins": [],
    }


def load_engine_sync_doc() -> dict:
    """读单真源文件;缺失/坏 JSON → 空骨架(首次扫描时自动生成)。"""
    path = engine_sync_json_path()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return _empty_engine_sync_doc()
    if not isinstance(data, dict) or not isinstance(data.get("plugins"), list):
        return _empty_engine_sync_doc()
    doc = _empty_engine_sync_doc()
    # comfyui 条目保留文件里的 repo/strategy(手动可编辑),缺省回补
    comfyui = data.get("comfyui")
    if isinstance(comfyui, dict):
        doc["comfyui"] = {
            "repo": str(comfyui.get("repo") or _COMFYUI_REPO_URL),
            "strategy": str(comfyui.get("strategy") or "match-local"),
        }
    for plugin in data["plugins"]:
        if isinstance(plugin, dict) and isinstance(plugin.get("name"), str) and plugin["name"]:
            doc["plugins"].append(
                {"name": plugin["name"], "url": str(plugin.get("url") or "")}
            )
    return doc


def write_engine_sync_doc(doc: dict) -> None:
    """原子回写单真源文件(tmp+replace,照 _write_token_file 范式)。"""
    path = engine_sync_json_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(
        json.dumps(doc, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    tmp.replace(path)


def merge_mac_scan_into_doc(doc: dict, scan: dict[str, str]) -> tuple[dict, bool]:
    """R1 合并逻辑:Mac 扫描结果并进清单——有则更新 URL,无则追加;回 (doc, changed)。

    changed=True 时由调用方回写文件(每次同步/清单时新 git 包自动追加)。
    """
    merged = False
    existing = {p["name"]: p for p in doc.get("plugins", [])}
    for name, url in scan.items():
        if name in existing:
            if existing[name]["url"] != url:
                existing[name]["url"] = url
                merged = True
        else:
            doc["plugins"].append({"name": name, "url": url})
            existing[name] = doc["plugins"][-1]
            merged = True
    return doc, merged

class SSHServiceError(Exception):
    """SSH 服务级失败(未连接/未装依赖/IO 失败);调用方按降级处理。"""


def _is_session_drop(message: str) -> bool:
    """会话死亡指纹(1104 B5):仅认实弹观察到的两种——paramiko EOF 包装的
    「session not active」与未连接前置拒「SSH 未连接」;其余错误不配触发重连。"""
    return "session not active" in message or "SSH 未连接" in message


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
        if client is None:
            raise SSHServiceError("SSH 未连接")
        try:
            _, stdout, stderr = client.exec_command(command, timeout=timeout_s)
            output = stdout.read().decode("utf-8", "replace") + stderr.read().decode("utf-8", "replace")
            return int(stdout.channel.recv_exit_status()), output
        except Exception as exc:
            raise SSHServiceError(f"远端命令执行失败: {exc}") from exc

    def sync_plugins(self, timeout_s: float = 300) -> dict:
        """1104 插件同步:Mac→Windows(版本对齐+缺装+有更+依赖+建议重启)。

        .. deprecated:: 1104 引擎同步中心
            已被 get_engine_sync_manifest/sync_engine 取代(R4:后端端点保留
            兼容,UI 入口已撤);新调用方请走 engine-sync 两法。

        返回 {comfyuiSynced, installed, updated, pipInstalled, engineRestarted, errors[], notes[]}
        """
        import json as _json

        result = {"comfyuiSynced": False, "installed": [], "updated": [], "pipInstalled": [], "engineRestarted": False, "errors": [], "notes": []}

        # ① 读 Mac 本机插件清单
        try:
            from comfyui.manifest import comfy_home
            local_nodes = comfy_home() / "ComfyUI" / "custom_nodes"
            if not local_nodes.is_dir():
                result["errors"].append("本机引擎未配置(custom_nodes 目录不存在)——请先在设置→本地配置准备本机引擎")
                return result
            mac_plugins = {}
            for d in local_nodes.iterdir():
                git_dir = d / ".git"
                if git_dir.is_dir() and d.name not in ("my-nodes",):
                    # 读 origin url
                    try:
                        import subprocess as _sp
                        url = _sp.run(["git", "-C", str(d), "remote", "get-url", "origin"],
                                      capture_output=True, text=True, timeout=5).stdout.strip()
                        if url:
                            mac_plugins[d.name] = url
                    except Exception:
                        pass
        except Exception as exc:
            result["errors"].append(f"读本机插件清单失败: {exc}")
            return result
        result["notes"].append(f"Mac 本机 {len(mac_plugins)} 件插件")

        # ② 读 Windows 引擎 custom_nodes
        code, out = self.run_remote_command("dir /b E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes 2>nul", 15)
        win_existing = {l.strip() for l in out.splitlines() if l.strip() and not l.startswith("Volume")} if code == 0 else set()
        result["notes"].append(f"Windows 现有 {len(win_existing)} 件")

        # ③ ComfyUI 版本对齐(git pull master)
        code, out = self.run_remote_command(
            "cd /d E:\\IP\\漫影工作室\\comfyui\\ComfyUI && git fetch origin 2>&1 && git pull --ff-only origin master 2>&1", 60)
        if "Already up to date" in out or code == 0:
            result["comfyuiSynced"] = True
            result["notes"].append("引擎版本已对齐" if "Already" not in out else "引擎版本已最新")
        else:
            result["errors"].append(f"引擎版本对齐失败: {out[:100]}")

        # ④ 缺的装(clone)/有的更(pull)
        win_nodes_base = "E:\\IP\\漫影工作室\\comfyui\\ComfyUI\\custom_nodes"
        venv_pip = "E:\\IP\\漫影工作室\\comfyui\\venv\\Scripts\\python.exe -m pip install -q"
        for name, url in mac_plugins.items():
            if name in win_existing:
                code, out = self.run_remote_command(
                    f"cd /d {win_nodes_base}\\{name} && git pull --ff-only 2>&1", 30)
                if code == 0 and "Already" not in out:
                    result["updated"].append(name)
            else:
                code, out = self.run_remote_command(
                    f"cd /d {win_nodes_base} && git clone --depth 1 {url} {name} 2>&1", 60)
                if code == 0:
                    result["installed"].append(name)
                else:
                    result["errors"].append(f"装 {name} 失败: {out[:80]}")

        # ⑤ 依赖安装(每件有 requirements.txt 则装)
        for name in list(mac_plugins.keys()):
            code, out = self.run_remote_command(
                f"if exist {win_nodes_base}\\{name}\\requirements.txt "
                f"(set PYTHONUTF8=1&& {venv_pip} -r {win_nodes_base}\\{name}\\requirements.txt 2>&1) else (echo NO_REQ)",
                120)
            if code == 0 and "NO_REQ" not in out:
                result["pipInstalled"].append(name)

        # ⑥ 建议重启(不自动重启)
        if result["installed"] or result["updated"] or result["comfyuiSynced"]:
            result["notes"].append("插件已同步——建议重启引擎(设置→本地配置→启动服务)")

        return result

    # ── 1104 引擎同步中心(tasks/11-04-engine-sync R2)──────────────────

    def _win_custom_nodes_names(self) -> set[str]:
        """SSH 读 Windows custom_nodes 目录名集合(dir /b /ad;失败回空集)。"""
        code, out = self.run_remote_command(
            f"dir /b /ad {_WIN_CUSTOM_NODES} 2>nul", 15
        )
        if code != 0:
            return set()
        return {
            line.strip()
            for line in out.splitlines()
            if line.strip() and not line.startswith("Volume") and not line.startswith("Directory of")
        }

    def _win_git_head(self, win_path: str) -> str | None:
        """SSH 读 Windows 侧 git HEAD(目录非 git/不存在/超时 → None)。"""
        code, out = self.run_remote_command(
            f'git -C "{win_path}" rev-parse HEAD 2>nul', 10
        )
        head = out.strip().splitlines()[-1].strip() if out.strip() else ""
        return head if code == 0 and head else None

    @staticmethod
    def _engine_sync_status(mac_present: bool, win_present: bool, name: str) -> str:
        """R2 四态:both=两侧都有 / mac-only=Mac 侧有(本机仓或清单声明,1104 复核
        修:手动条目双侧均无时也归此态——可见可勾选,同步按 URL clone)且 Win 缺
        (需 clone)/ win-only=Win 独有(跳过,Q1 并集不删)/ skip=my-nodes(Q2);
        双侧皆无仅引擎条目可达(Mac/Win HEAD 都读不到=无处可同步,同 skip 不渲染)。"""
        if name in _ENGINE_SYNC_SKIP_NAMES:
            return "skip"
        if mac_present and win_present:
            return "both"
        if mac_present:
            return "mac-only"
        if win_present:
            return "win-only"
        return "skip"

    def get_engine_sync_manifest(self) -> dict:
        """GET /comfy/ssh/engine-sync-manifest:单真源清单 + 双侧实况。

        流程(R2):读 engine-sync.json → 扫 Mac custom_nodes(新 git 包追加
        进清单+回写文件,R1 合并)→ SSH 扫 Windows custom_nodes(dir /b)→
        SSH 读 Win 各包/引擎 HEAD → 回 {items: [{name,url,macHead,winHead,status}]}。
        """
        scan = _scan_mac_git_packages()
        doc = load_engine_sync_doc()
        doc, changed = merge_mac_scan_into_doc(doc, scan)
        if changed:
            write_engine_sync_doc(doc)  # R1:新插件自动追加+回写

        win_names = self._win_custom_nodes_names()
        mac_heads: dict[str, str | None] = {
            name: _mac_git_head(_mac_custom_nodes_dir() / name) for name in scan
        }
        items: list[dict] = []
        # ComfyUI 引擎条目(恒首行)
        engine_mac_head = _mac_git_head(_mac_custom_nodes_dir().parent)
        engine_win_head = self._win_git_head(_WIN_COMFY_ROOT + "\\ComfyUI")
        items.append(
            {
                "name": _ENGINE_SYNC_ENGINE_NAME,
                "url": doc.get("comfyui", {}).get("repo", _COMFYUI_REPO_URL),
                "macHead": engine_mac_head,
                "winHead": engine_win_head,
                "status": self._engine_sync_status(
                    engine_mac_head is not None, engine_win_head is not None,
                    _ENGINE_SYNC_ENGINE_NAME,
                ),
            }
        )
        # 插件并集:清单条目 ∪ Mac 扫描 ∪ Win 现存(清单序稳定,Win 独有追加在后)
        plugins_by_name = {p["name"]: p for p in doc["plugins"]}
        win_only_names = sorted(win_names - set(plugins_by_name))
        for plugin in list(doc["plugins"]) + [
            {"name": n, "url": ""} for n in win_only_names
        ]:
            name = plugin["name"]
            mac_head = mac_heads.get(name)  # None=Mac 本机无此包(清单手动条目)
            win_head = self._win_git_head(f"{_WIN_CUSTOM_NODES}\\{name}") if name in win_names else None
            items.append(
                {
                    "name": name,
                    "url": plugin.get("url", ""),
                    "macHead": mac_head,
                    "winHead": win_head,
                    # Mac 侧在场=本机有仓,或「清单声明且 Win 缺」(R1 手动条目
                    # 双侧均无时不落 skip——skip 只留给 my-nodes Q2,否则手动新增
                    # 件在面板不可见永无法勾选;清单声明但 Win 已有而 Mac 无仓仍归
                    # win-only:无 Mac HEAD 可对齐,同步跳过保留,与 UI 灰显一致)
                    "status": self._engine_sync_status(
                        mac_head is not None
                        or (name in plugins_by_name and name not in win_names),
                        name in win_names,
                        name,
                    ),
                }
            )
        return {"items": items}

    def sync_engine(self, items: list[str], timeout_s: float | None = None) -> dict:
        """POST /comfy/ssh/sync-engine:逐项 SSH 同步(并集策略 Q1;GitHub 拉最新)。

        1104 用户裁定:「Windows 从 GitHub 拉最新,不 SSH 推 Mac HEAD」——
        删 git reset --hard <Mac HEAD> 强制对齐(Q6 就此废止),改为:
          Win 已有(引擎/both)→ git pull --ff-only(拉 GitHub 最新);
          Win 缺(mac-only/手动条目)→ git clone <清单 url>;
          win-only/skip(my-nodes) → 跳过(Q1 不删/Q2 不管);
          依赖 → 有 requirements.txt 则 PYTHONUTF8=1 venv pip install(失败不阻断,
          记 pipError);验证 → 只确认目录在+HEAD 可读(不比 Mac HEAD)。
        整体超时 30min(Q3,1104 修正 10→30min);部分失败不阻断(失败项在回执
        标明,C8)。

        返回 {items: [{name,type,macHead,winHead,action,verified,error,pipError}]}。
        """
        overall = _ENGINE_SYNC_OVERALL_TIMEOUT_S if timeout_s is None else timeout_s
        deadline = time.monotonic() + overall
        scan = _scan_mac_git_packages()
        doc = load_engine_sync_doc()
        doc, changed = merge_mac_scan_into_doc(doc, scan)
        if changed:
            write_engine_sync_doc(doc)
        plugins_by_name = {p["name"]: p for p in doc["plugins"]}
        win_names = self._win_custom_nodes_names()

        results: list[dict] = []

        def _dispatch(name: str) -> dict:
            """单件调度(引擎/插件/清单缺失三分支);SSHServiceError 向上抛给重试层。"""
            if name == _ENGINE_SYNC_ENGINE_NAME:
                mac_head = _mac_git_head(_mac_custom_nodes_dir().parent)
                return self._sync_one(
                    name=name, kind="engine", url=doc["comfyui"].get("repo", ""),
                    mac_head=mac_head, win_exists=True, deadline=deadline,
                )
            plugin = plugins_by_name.get(name)
            mac_head = _mac_git_head(_mac_custom_nodes_dir() / name)
            if plugin is None and mac_head is None and name not in win_names:
                # 三处都无(清单/Mac/Win)——诚实报失败;Win 独有件交 _sync_one 走 skipped
                return self._sync_result(
                    name, "plugin", mac_head, None, "failed", False,
                    "清单里没有这件插件(Mac 本机与清单均无)",
                )
            return self._sync_one(
                name=name, kind="plugin",
                url=(plugin or {}).get("url", ""),
                mac_head=mac_head, win_exists=name in win_names,
                deadline=deadline,
            )

        for name in items:
            if time.monotonic() >= deadline:
                results.append(
                    self._sync_result(
                        name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                        mac_head=None, win_head=None, action="failed", verified=False,
                        error=f"整体超时({int(overall / 60)}min),未同步",
                    )
                )
                continue
            try:
                results.append(_dispatch(name))
            except SSHServiceError as exc:
                # 断线自愈(1104 B5):长同步途中 TCP 被掐(paramiko EOF→session
                # not active / 未连接)→唤醒 keeper 立即重连,等翻绿后本件重试
                # 一次;重连不成或重试再败 → 诚实落 failed(不拦后续件 C8)
                if _is_session_drop(str(exc)) and self._reconnect_for_sync(deadline):
                    try:
                        results.append(_dispatch(name))
                        continue
                    except SSHServiceError as retry_exc:
                        results.append(
                            self._sync_result(
                                name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                                None, None, "failed", False,
                                f"{retry_exc}(断线重连后重试仍败)",
                            )
                        )
                        continue
                results.append(
                    self._sync_result(
                        name, "plugin" if name != _ENGINE_SYNC_ENGINE_NAME else "engine",
                        None, None, "failed", False, str(exc),
                    )
                )
        # 1104 补:同步逐件结果落盘 comfyui 家 engine-sync.log(用户令:要有日志)
        try:
            from comfyui.manifest import comfy_home as _ch
            import datetime as _dt
            _log = _ch() / "engine-sync.log"
            _ts = _dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _ok = sum(1 for i in results if i.get("action") in ("pulled", "cloned"))
            _fail = sum(1 for i in results if i.get("action") == "failed")
            _skip = sum(1 for i in results if i.get("action") == "skipped")
            _lines = [f"\n=== engine-sync {_ts} ==="]
            for _i in results:
                _icon = {"pulled": "✅", "cloned": "✅(新)", "skipped": "⏭️", "failed": "❌"}.get(_i.get("action"), "?")
                _err = f" | {_i['error']}" if _i.get("error") else ""
                _lines.append(f"  {_icon} {_i['name']} [{_i.get('action')}] {_err}")
            _lines.append(f"  总计: ✅{_ok} ❌{_fail} ⏭️{_skip}")
            with open(_log, "a", encoding="utf-8") as _f:
                _f.write("\n".join(_lines) + "\n")
        except Exception:  # noqa: BLE001 — 日志失败不阻断同步结果返回
            pass
        return {"items": results}

    @staticmethod
    def _sync_result(
        name: str, type_: str, mac_head: str | None, win_head: str | None,
        action: str, verified: bool, error: str | None = None,
        pip_error: str | None = None,
    ) -> dict:
        return {
            "name": name, "type": type_, "macHead": mac_head, "winHead": win_head,
            "action": action, "verified": verified, "error": error, "pipError": pip_error,
        }

    def _remaining_timeout(self, deadline: float, op_timeout_s: float) -> float:
        """单命令超时=操作上限与整体剩余量的较小者(下限 1s 让命令有机会自报)。"""
        return max(min(op_timeout_s, deadline - time.monotonic()), 1.0)

    def _sync_one(
        self, name: str, kind: str, url: str, mac_head: str | None,
        win_exists: bool, deadline: float,
    ) -> dict:
        """单件同步:Win 从 GitHub 拉最新(1104 用户裁定:不 SSH 推 Mac HEAD)。

        Win 已有(engine/both)→ git pull --ff-only;Win 缺 → git clone <url>;
        win-only/skip 直接过(Q1 不删/Q2 不管);验证只看目录在+HEAD 可读
        (不比 Mac HEAD,mac_head 仅随回执透传供参考)。
        """
        win_path = (
            _WIN_COMFY_ROOT + "\\ComfyUI"
            if kind == "engine"
            else f"{_WIN_CUSTOM_NODES}\\{name}"
        )
        if name in _ENGINE_SYNC_SKIP_NAMES:  # Q2
            return self._sync_result(name, kind, mac_head, None, "skipped", False)
        action: str
        if not win_exists:
            # Win 缺(mac-only/手动条目)→ clone 新装(清单 URL;单件 300s)
            action = "cloned"
            code, out = self.run_remote_command(
                f"cd /d {_WIN_CUSTOM_NODES} && git clone --depth 1 {url} {name} 2>&1",
                self._remaining_timeout(deadline, _ENGINE_SYNC_ITEM_TIMEOUT_S),
            )
            if code != 0:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    f"git clone 失败: {out.strip()[:200]}",
                )
        elif kind == "engine" or mac_head is not None:
            # Win 已有(引擎/both)→ 先比 HEAD 再决定要不要 pull(1104 优化:
            # fetch 后 local HEAD == origin/HEAD = 已最新 → 跳过,省 SSH 往返;
            # 落后才 pull。用户令:已同步的不要每次强制再拉)
            head_code, head_out = self.run_remote_command(
                f'cd /d "{win_path}" && git fetch origin 2>&1 && '
                f"git rev-parse HEAD 2>&1 && git rev-parse origin/HEAD 2>&1",
                self._remaining_timeout(deadline, 60),
            )
            if head_code == 0:
                lines = [l.strip() for l in head_out.strip().splitlines() if l.strip() and not l.startswith(("From ", "origin/"))]
                if len(lines) >= 2 and lines[-2] == lines[-1]:
                    return self._sync_result(
                        name, kind, mac_head, lines[-1], "skipped", True,
                        "已是最新(HEAD=origin/HEAD),跳过",
                    )
            # 不最新(或比对失败=保守走 pull)→ 从 GitHub 拉最新
            action = "pulled"
            code, out = self.run_remote_command(
                f'cd /d "{win_path}" && git pull --ff-only 2>&1',
                self._remaining_timeout(deadline, _ENGINE_SYNC_ITEM_TIMEOUT_S),
            )
            if code != 0:
                return self._sync_result(
                    name, kind, mac_head, None, "failed", False,
                    f"git pull 失败: {out.strip()[:200]}",
                )
        else:
            # win-only(Q1 并集不删):Win 独有,保留不动
            return self._sync_result(
                name, kind, None, None, "skipped", False, "win-only(Win 独有,保留不动)"
            )
        # 依赖安装(R2⑤):有 requirements.txt 则 PYTHONUTF8=1 venv pip install
        pip_error = None
        code, out = self.run_remote_command(
            f'if exist "{win_path}\\requirements.txt" '
            f'(set PYTHONUTF8=1&& "{_WIN_VENV_PYTHON}" -m pip install -q -r "{win_path}\\requirements.txt" 2>&1) '
            f"else (echo NO_REQ)",
            self._remaining_timeout(deadline, 240),
        )
        if code != 0:
            pip_error = f"pip install 失败: {out.strip()[:200]}"  # ⚠️ 不阻断(C8)
        # 验证(1104 裁定口径):只确认目录在+HEAD 可读(_win_git_head 对缺目录/
        # 非 git/无提交恒 None),不比 Mac HEAD
        win_head = self._win_git_head(win_path)
        verified = win_head is not None
        return self._sync_result(
            name, kind, mac_head, win_head, action, verified, None, pip_error
        )

    def restart_remote_engine(self) -> dict:
        """结果弹窗[重启引擎](R3):SSH schtasks /Run /TN EngineDurable。"""
        code, out = self.run_remote_command(
            "schtasks /Run /TN EngineDurable", 30
        )
        return {"ok": code == 0, "output": out.strip()[:500]}

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
        cfg = ssh_config.effective_config()
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
