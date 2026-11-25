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

import base64
import concurrent.futures
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path, PureWindowsPath

from remote_ssh import config as ssh_config
from remote_ssh.tunnel import TunnelManager

logger = logging.getLogger(__name__)

# 令牌文件名:与 image_gen/server.py 的 REMOTE_TOKEN_FILE_NAME 同字面
# (消费链 server.py:130 _remote_sidecar_token_from_file 零改动;此处不
# import server 避免 image_gen→remote_ssh→image_gen 环)。
TOKEN_FILE_NAME = "remote-image-token.txt"
# B7 同款令牌正则(deploy-dual.sh 令牌搬运口径):字母数字开头,后跟
# 字母数字/下划线/连字符
_TOKEN_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]*")
# F-1 (1109 审计): engine-sync name/url 白名单——cmd 元字符 (& | < > ^ ( ) % ! " ' 空格) 截断/展开命令,
# shlex.quote 对 cmd 无效。name 同 plugin_manager._safe_plugin_id 口径;url 排除 % 与全部 cmd 元字符。
_SYNC_NAME_RE = re.compile(r"^[0-9A-Za-z._\-]+$")
_SYNC_URL_RE = re.compile(r"^[A-Za-z0-9_./:@+~\-]+$")
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
# Win 账本补记用的系统 python(engine_task.py 同款;base 缺 venv 包但 stdlib json 足够)
_WIN_BASE_PYTHON = "D:\\Python312\\python.exe"
TORCH_TV_MAP = {"2.14.1": "0.29.1", "2.14.0": "0.29.0", "2.13.0": "0.28.0"}
# 1107 补挂账:升级管线只带 torch/torchvision 漏了 torchaudio,旧件 2.11.0+cu128 在 torch 2.14.1+cu132 下
# 加载即炸,拖挂 6 插件(MiniMaxH3×3/LayerStyle/LTXVideo/CRT-Nodes)。
# 官方 cu132 通道 torchaudio 最新=2.11.1(节奏落后 torch,非同版本号);其依赖 torch>=2.11 宽松下界,
# pip 对已装的 2.14.1 判 Requirement already satisfied 不重下不降级(1107 dry-run 实证)。
TORCH_TA_MAP = {k: "2.11.1" for k in TORCH_TV_MAP}

# 1107 自愈可见化:引擎日志「Cannot import ...custom_nodes\NAME ...: 挂因」解析
# (get_engine_plugin_health 用;纯函数离线可测,与 engine_task.MISSING_MODULE_RE 同款双斜杠形态)
_PLUGIN_IMPORT_FAIL_RE = re.compile(
    r"Cannot import [^\n]*custom_nodes[/\\]([A-Za-z0-9_.\-]+) "
    r"module for custom nodes: (.+)")


def _parse_plugin_import_failures(log_segment: str) -> dict:
    """日志段 → {插件: {loaded:False, cause:挂因}}(同名去重保首因)。"""
    out: dict = {}
    for name, cause in _PLUGIN_IMPORT_FAIL_RE.findall(log_segment):
        if name not in out:
            out[name] = {"loaded": False, "cause": cause.strip()[:220]}
    return out


# 1125 销账:deps-install.log 账本行「<时间>] OK|FAIL (插件): 规格」解析
# (get_engine_plugin_health 用;规格串剥版本约束后按 (插件, 包基名) 记账)
_DEPS_LEDGER_RE = re.compile(r"^\[[^\]]+\]\s+(OK|FAIL)\s+\(([^)]+)\):\s*(.+)$")


def _spec_base(spec: str) -> str:
    """依赖规格 → 包基名(`gguf>=0.13.0`→`gguf`;`requests >=2.28.0`→`requests`)。"""
    return re.split(r"[<>=!~;\s\[]", spec.strip(), maxsplit=1)[0].strip().lower()


def _collect_dep_debts(tail: str) -> tuple[dict, list[str]]:
    """deps-install 尾段 → ({(插件, 包基名): 原始FAIL行}, 未销账包基名列表)。

    账本序销账:同 (插件, 基名) 其后的 OK 行销掉先前 FAIL(重装装成=还清;
    OK 后又 FAIL=重挂,按最后一条算)——1125 用户令「探针加销账机制」。
    1107「失败持续可见不再一闪而过」的设计不变,销掉的只是已还清的账;
    运行时可导入性复核在 get_engine_plugin_health 侧做(要 SSH)。
    """
    debts: dict[tuple[str, str], str] = {}
    for ln in tail.splitlines():
        m = _DEPS_LEDGER_RE.match(ln.strip())
        if not m:
            continue
        key = (m.group(2).strip(), _spec_base(m.group(3)))
        if m.group(1) == "FAIL":
            debts[key] = ln.rstrip()
        else:
            debts.pop(key, None)
    return debts, sorted({base for _, base in debts})


def _utc_now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
PINNED_TORCH = "2.14.1"  # 升版时修改此常量
_REMOTE_TORCH_JOB_ID: str | None = None
_TORCH_UPGRADE_LOCK = threading.Lock()
_TORCH_RECOVERY_LOCK = threading.Lock()
_TORCH_STUCK_HELD = False
_TORCH_STUCK_MODE = "remote"
_TORCH_STUCK_HOST = None
_TORCH_SESSION = threading.local()
_TORCH_CHANNELS = {"cu128", "cu130", "cu132"}
_TORCH_KILL_PATTERN = r"comfyui.+main\.py"
_WIN_APP_EXE = "E:\\IP\\manying-studio\\manying-studio.exe"
_SCHTASK_APP = "StartMYStudio"
_SCHTASK_ENGINE = "EngineDurable"
_MYSTUDIO_SESSION = threading.local()


def _exclusive_engine_sync(method):
    @wraps(method)
    def guarded(*args, **kwargs):
        _acquire_torch_operation(args[0])
        try:
            try:
                pip_running = args[0]._torch_remote_pip_running()
            except Exception as exc:
                raise RuntimeError("无法核实远端 pip 状态，引擎同步已让路") from exc
            if pip_running:
                raise RuntimeError("远端 pip 仍在运行，引擎同步已让路")
            return method(*args, **kwargs)
        finally:
            _TORCH_UPGRADE_LOCK.release()
    return guarded


def _torch_stuck_marker() -> Path:
    from comfyui.manifest import comfy_home
    return comfy_home() / "torch-upgrade-backup" / "stuck.json"


def _torch_fallback_marker() -> Path:
    from comfyui.manifest import comfy_home
    return comfy_home() / "torch-upgrade-mac-state" / "stuck.json"


def _torch_any_marker() -> bool:
    return _torch_stuck_marker().exists() or _torch_fallback_marker().exists()


# 1122 同步全败根修:变异 pip 判据——只认 install/uninstall/download/wheel 四动词
_PIP_MUTATING_RE = re.compile(r"-m\s+pip\s+(?:install|uninstall|download|wheel)\b", re.IGNORECASE)


def _pip_running_from_proc_lines(lines: list[str], venv_python: str) -> bool:
    """远端 python 进程清单(PROC|pid|b64cmdline 行)→ 是否有变异 pip 在跑。

    1122 用户实弹:引擎冷重启窗口 torch-info 轮询的只读探针(`-m pip show`/
    `-c import torch`,反斜杠 venv 形态)近乎常驻,旧判据「命令行含 venv
    python 即算 pip」把门恒关,引擎同步点一次 500 一次(~50 发全灭)。
    新判据三重收窄:venv python(斜杠双态归一——engine_task 正斜杠启动)+ 
    `-m pip` + 变变动词;只读探针与引擎本体(main.py)永不拦门。
    PROCDONE 缺席=探针失声(CLIXML 噪声吞掉输出),交上层 fail-closed。
    """
    venv_norm = venv_python.replace("/", "\\").casefold()
    saw_done = False
    for raw in lines:
        line = raw.strip()
        if line == "PROCDONE":
            saw_done = True
            continue
        parts = line.split("|", 2)
        if len(parts) != 3 or parts[0] != "PROC":
            continue  # CLIXML 进度记录(GBK)等噪声行(1107 实弹同款)
        try:
            cmdline = base64.b64decode(parts[2]).decode("utf-8", errors="replace")
        except (ValueError, UnicodeError):
            continue
        norm = cmdline.replace("/", "\\").casefold()
        if venv_norm in norm and _PIP_MUTATING_RE.search(norm):
            return True
    if not saw_done:
        raise RuntimeError("无法核实远端 pip 状态")
    return False


def _torch_clear_markers() -> None:
    try:
        _torch_stuck_marker().unlink(missing_ok=True)
        _torch_fallback_marker().unlink(missing_ok=True)
    except OSError as exc:
        raise RuntimeError("异常标记无法清除，须人工介入") from exc


def _torch_write_marker(record: dict) -> None:
    marker = _torch_stuck_marker()
    fallback = _torch_fallback_marker()
    try:
        fallback.parent.mkdir(parents=True, exist_ok=True)
        fallback.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"异常备用标记无法持久化：{fallback}，须人工介入") from exc
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    except OSError as exc:
        raise RuntimeError(f"异常标记主路径不可写，已保存备用标记 {fallback}，须人工介入") from exc


def _ensure_stuck_marker_writable() -> None:
    # 1106 裁定:同步入口也做可写预检并 fail-closed；路径不可写须人工介入。
    for marker in (_torch_stuck_marker(), _torch_fallback_marker()):
        try:
            marker.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.TemporaryFile(dir=marker.parent) as probe:
                probe.write(b"probe")
                probe.flush()
        except OSError as exc:
            raise RuntimeError(f"异常标记路径不可写：{marker}，须人工介入") from exc
    # pip 启动前仍需成功写入持久标记，不能依赖此探针替代写入。


def _write_torch_in_progress(job_id: str, *, mode: str, host: str | None = None, target: str | None = None) -> None:
    _torch_write_marker({"jobId": job_id, "at": datetime.now(timezone.utc).isoformat(),
                         "reason": "pip 安装进行中", "mode": mode, "host": host,
                         "target": target, "kind": "in-progress", "state": "in-progress"})


def _mark_torch_stuck(job_id: str, reason: str, *, mode: str, host: str | None = None, target: str | None = None) -> str | None:
    global _TORCH_STUCK_HELD, _TORCH_STUCK_MODE, _TORCH_STUCK_HOST
    with _TORCH_RECOVERY_LOCK:
        _TORCH_STUCK_HELD = True
        _TORCH_STUCK_MODE = mode
        _TORCH_STUCK_HOST = host
        try:
            _torch_write_marker({"jobId": job_id, "at": datetime.now(timezone.utc).isoformat(), "reason": reason, "host": host, "mode": mode, "target": target, "kind": "stuck", "state": "stuck"})
        except RuntimeError as exc:
            logger.exception("无法保存 PyTorch 升级异常标记")
            return str(exc)
    return None


def _acquire_torch_operation(instance) -> None:
    from comfyui.engine_manager import jobs
    global _TORCH_STUCK_HELD, _TORCH_STUCK_HOST
    with _TORCH_RECOVERY_LOCK:
        marker = _torch_stuck_marker()
        if jobs.active_of("torch-upgrade"):
            raise RuntimeError("PyTorch 升级任务已在运行，引擎同步已让路")
        if _torch_any_marker() or _TORCH_STUCK_HELD:
            # 1106 裁定:兜底-only 可在主机一致、pip 空闲且 import 版本吻合后清标，否则保留并拒绝。
            mode = _TORCH_STUCK_MODE if _TORCH_STUCK_HELD else "remote"
            try:
                records = [json.loads(path.read_text(encoding="utf-8")) for path in (marker, _torch_fallback_marker()) if path.exists()]
                if not records:
                    raise RuntimeError("异常标记缺失，须人工核实")
                recorded = records[0]
                conflict = "检测到跨主机/状态冲突记录，须人工核验或运行一次完整升级覆盖"
                if any(not isinstance(record, dict) or
                       any(not isinstance(record.get(key), str) or not record[key].strip() for key in ("jobId", "at", "mode", "reason")) or
                       record.get("kind") not in ("in-progress", "stuck") or
                       record.get("state") not in ("in-progress", "stuck") or
                       "host" not in record or record["mode"] not in ("local", "remote") or
                       (record["mode"] == "local" and record["host"] is not None) or
                       (record["mode"] == "remote" and (not isinstance(record["host"], str) or not record["host"].strip()))
                       for record in records):
                    raise RuntimeError(conflict)
                if any(record != recorded for record in records[1:]):
                    raise RuntimeError(conflict)
                if _TORCH_STUCK_HELD and (recorded["mode"] != _TORCH_STUCK_MODE or recorded["host"] != _TORCH_STUCK_HOST):
                    raise RuntimeError(conflict)
                mode = recorded.get("mode", _TORCH_STUCK_MODE if _TORCH_STUCK_HELD else "remote")
                target = recorded.get("target")
                if not isinstance(target, str) or not target.strip():
                    raise RuntimeError("异常标记缺少目标版本，须人工核实")
                if mode == "local":
                    from comfyui import torch_upgrade_local
                    torch_upgrade_local._ensure_no_pip()
                    torch_upgrade_local._verify_import(target)
                elif mode == "remote":
                    host = recorded.get("host")
                    if not isinstance(host, str) or not host or instance._connected_host != host or ssh_config.load_config().get("host") != host:
                        raise RuntimeError("无法核实远端 pip 状态：SSH 主机与异常任务不一致")
                    if instance._torch_remote_pip_running():
                        raise RuntimeError("远端 pip 仍在运行，引擎同步已让路")
                    instance._torch_verify_recovery_import(target)
                else:
                    raise RuntimeError("未知 pip 异常来源")
            except RuntimeError as exc:
                if "远端 pip 仍在运行" in str(exc):
                    raise
                raise RuntimeError(f"无法核实{'本地' if mode == 'local' else '远端'} pip 状态，引擎同步已让路：{exc}") from exc
            except Exception as exc:
                raise RuntimeError(f"无法核实{'本地' if mode == 'local' else '远端'} pip 状态，引擎同步已让路") from exc
            _torch_clear_markers()
            if _TORCH_STUCK_HELD:
                _TORCH_UPGRADE_LOCK.release()
                _TORCH_STUCK_HELD = False
                _TORCH_STUCK_HOST = None
        _ensure_stuck_marker_writable()
        if not _TORCH_UPGRADE_LOCK.acquire(blocking=False):
            raise RuntimeError("引擎同步或 PyTorch 升级进行中，引擎同步已让路")


def _exclusive_mystudio(method):
    @wraps(method)
    def guarded(self, *args, **kwargs):
        timeout_s = args[0] if args else kwargs.get("timeout_s", method.__defaults__[0])
        deadline = time.monotonic() + timeout_s
        with self._lock:
            expected_client = self._client
            if expected_client is None or not self._connected:
                raise SSHServiceError("SSH 未连接")
        try:
            _acquire_torch_operation(self)
        except RuntimeError as exc:
            raise SSHServiceError(str(exc)) from exc
        try:
            _MYSTUDIO_SESSION.client = expected_client
            _MYSTUDIO_SESSION.deadline = deadline
            _MYSTUDIO_SESSION.result = {"ok": False, "output": "远端操作超时"}
            try:
                return method(self, *args, **kwargs)
            except TimeoutError:
                result = _MYSTUDIO_SESSION.result
                result.update(ok=False, output="远端操作超时")
                return result
        finally:
            _MYSTUDIO_SESSION.__dict__.clear()
            _TORCH_UPGRADE_LOCK.release()
    return guarded


def _torch_powershell(script: str) -> str:
    # 1107 根修:SSH exec 模式下 PowerShell 会把进度记录写成 CLIXML XML 混进 stdout,
    # 污染所有命令输出(pip 检查 isdecimal 失败/system_stats JSON 解析失败/磁盘检查失败)。
    # $ProgressPreference='SilentlyContinue' 在源头抑制进度输出,一刀切根治。
    full = "$ProgressPreference='SilentlyContinue'; " + script
    encoded = base64.b64encode(full.encode("utf-16le")).decode("ascii")
    return f"powershell -NoProfile -NonInteractive -EncodedCommand {encoded}"


def _torch_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"
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


class TorchInstallUnknownError(RuntimeError):
    """远端 pip 是否仍运行不可知，不能并发启动回滚。"""


def _is_session_drop(message: str) -> bool:
    """会话死亡/瞬抖指纹(1104 B5;1105 补空详情类):实弹观察到的三种——
    paramiko EOF 包装的「session not active」、未连接前置拒「SSH 未连接」、
    与「远端命令执行失败:」尾空(socket.timeout/EOFError 的 str 恒空串,
    01:11 实弹 Frame-Interpolation 件)。其余错误不配触发重连。"""
    if "session not active" in message or "SSH 未连接" in message:
        return True
    return message.rstrip().endswith("远端命令执行失败:")


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


# ── 按域分住的实现(1124 超线文件拆分)─────────────────────────────────────────
# SSHService 的方法按域逐字搬到下列模块的类里,再混入组合成一个类,对外接口不变;留在本类里的
# 只有类文档串与 upgrade_engine_torch。各域模块须在本文件的模块级定义之后导入。
from .service_connection import SSHServiceConnection
from .service_engine_sync import EngineSyncMixin
from .service_torch import TorchUpgradeMixin
from .service_remote_app import RemoteAppMixin


class SSHService(SSHServiceConnection, EngineSyncMixin, TorchUpgradeMixin, RemoteAppMixin):
    """paramiko 同步 SSH 客户端(线程安全;所有对外调用异常不外溢成崩溃)。"""

    def upgrade_engine_torch(self, target: str, channel: str = "cu132", *, expected_host: str | None = None) -> str:
        global _REMOTE_TORCH_JOB_ID
        from comfyui.engine_manager import jobs

        if not isinstance(target, str) or not re.fullmatch(r"\d+\.\d+\.\d+", target) or channel not in _TORCH_CHANNELS:
            raise ValueError("无效的 PyTorch 版本或 CUDA 通道")
        if target not in TORCH_TV_MAP:
            raise ValueError("仅支持 " + " / ".join(TORCH_TV_MAP))
        _acquire_torch_operation(self)
        try:
            if jobs.active_of("torch-upgrade"):
                raise RuntimeError("PyTorch 升级任务已在运行")
            if jobs.active_of("engine-update") or jobs.active_of("plugin-install"):
                raise RuntimeError("引擎更新或插件安装进行中，请稍后再升级 PyTorch")
            with self._lock:
                client = self._client
                configured_host = ssh_config.load_config().get("host")
                if client is None or not self._connected or self._connected_host != configured_host:
                    raise RuntimeError("SSH 未连接或连接配置正在切换")
                if expected_host is not None and (not isinstance(configured_host, str) or configured_host.casefold() != expected_host.casefold()):
                    raise RuntimeError("当前远端引擎与已连接 SSH 主机不一致")
            job_id = jobs.create("torch-upgrade", mode="remote", origin_host=configured_host)
            _REMOTE_TORCH_JOB_ID = job_id
            def run(active_id):
                global _TORCH_STUCK_HELD, _TORCH_STUCK_MODE, _TORCH_STUCK_HOST
                _TORCH_SESSION.client = client
                stuck = False
                try:
                    stuck = self._torch_upgrade_job(active_id, target, channel, configured_host)
                finally:
                    del _TORCH_SESSION.client
                    if stuck:
                        message = jobs.get(active_id).get("message")
                        warning = _mark_torch_stuck(active_id, message, mode="remote", host=configured_host, target=f"{target}+{channel}")
                        if warning:
                            message = f"{message}；{warning}"
                            jobs.update(active_id, message=message, error=message, tail_line=warning)
                    else:
                        with _TORCH_RECOVERY_LOCK:
                            if _torch_any_marker():
                                _TORCH_STUCK_HELD = True
                                _TORCH_STUCK_MODE = "remote"
                                _TORCH_STUCK_HOST = configured_host
                            else:
                                _TORCH_UPGRADE_LOCK.release()
            try:
                jobs.start(job_id, run)
            except Exception:
                jobs.update(job_id, error="升级任务启动失败")
                raise
            return job_id
        except BaseException:
            _TORCH_UPGRADE_LOCK.release()
            raise


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
