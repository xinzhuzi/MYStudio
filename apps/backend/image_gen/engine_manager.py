"""ComfyUI 引擎托管(一期后端流 A)——自管实例的下载/安装/启动/守卫/更新/复位。

裁定 2:引擎 = 独立服务进程 + 独立 venv(隔壁邻居),永不 import 进 sidecar;
裁定 3(GPL 红线):与 ComfyUI 的全部交互面 = subprocess 调 git/pip + HTTP API,
代码零拷贝;裁定 4/ grill Q10:全新托管下载取最新 release,版本跟随+显式更新链。

重活(网络下载/安装)全部走 job 抽象(照 download_model.py 的 job/进度范式),
本模块不 import 任何 ComfyUI 代码;纯函数(端口分配/launch 翻译/tag 解析/
节点差分/导入错误收集)保持可单测。
"""
from __future__ import annotations

import gzip
import json
import re
import shutil
import socket
import subprocess
import sys
import tarfile
import threading
import time
import uuid
from pathlib import Path
from urllib import error, request

from . import comfy_manifest as cm

COMFYUI_REPO = "https://github.com/comfyanonymous/ComfyUI"
INSTALL_REQUIRED_GB = 10.0  # 引擎源码+venv+torch MPS 栈的保守余量门
PORT_RANGE_START = 17000
PORT_RANGE_END = 17999
# 17595=本 sidecar 固定端口;17598=桥回落专用段位(Comfy Desktop 约定),永不出让
RESERVED_PORTS = frozenset({17595, 17598})
HEALTH_TIMEOUT_S = 120.0  # 首次冷启动 torch 导入慢,健康轮询窗口放宽
GUARD_INTERVAL_S = 3.0
GUARD_MAX_RESTARTS = 3
GUARD_WINDOW_S = 900.0
# 09-08 加固①:stop 彻底性——SIGTERM 后等满 10 秒仍活着(引擎卡在 C 扩展里
# 收不到信号是实弹见过的)就升级 SIGKILL;stopped 回复以进程真实退出为准。
STOP_TERM_WAIT_S = 10.0
STOP_KILL_WAIT_S = 5.0

# ComfyUI extra_model_paths.yaml 的标准目录键(modelsDir 指向现有库用)
_MODEL_FOLDER_KEYS = (
    "checkpoints", "configs", "loras", "vae", "clip", "unet", "clip_vision",
    "style_models", "embeddings", "controlnet", "gligen", "upscale_models",
    "hypernetworks", "photomaker", "ipadapter",
    # 09-08 实弹补修:krea/flux 系权重住 diffusion_models,文本编码器住
    # text_encoders(现代 ComfyUI 主力目录);缺这两个键=UNETLoader/CLIPLoader
    # 看不见现有库的自托管权重,接管模式形同虚设。
    "diffusion_models", "text_encoders",
)


class EngineOpError(Exception):
    """大白话操作失败(给前端直接展示)。"""


# ── job 框架(engine/plugin 共用;照 download_model.py 的进度范式) ─────
class JobRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, dict] = {}

    def create(self, kind: str, message: str = "排队中") -> str:
        job_id = uuid.uuid4().hex[:12]
        with self._lock:
            self._jobs[job_id] = {
                "id": job_id, "kind": kind, "status": "running", "progress": 0,
                "step": "queued", "message": message, "error": None, "result": None,
                "tail": [], "createdAt": int(time.time() * 1000), "updatedAt": int(time.time() * 1000),
            }
        return job_id

    def update(self, job_id: str, *, progress: int | None = None, step: str | None = None,
               message: str | None = None, error: str | None = None, result=None,
               tail_line: str | None = None) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job:
                return
            if progress is not None:
                job["progress"] = max(0, min(100, int(progress)))
            if step is not None:
                job["step"] = step
            if message is not None:
                job["message"] = message
            if error is not None:
                job["error"] = error
                job["status"] = "error"
            if result is not None:
                job["result"] = result
                job["status"] = "complete"
                job["progress"] = 100
            if tail_line is not None:
                job["tail"] = (job["tail"] + [tail_line])[-30:]
            job["updatedAt"] = int(time.time() * 1000)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def active_of(self, kind: str) -> dict | None:
        """该类别当前仍在跑的 job(状态机判定用;返回副本)。"""
        with self._lock:
            for job in self._jobs.values():
                if job["kind"] == kind and job["status"] == "running":
                    return dict(job)
        return None

    def start(self, job_id: str, target) -> None:
        def _wrapped() -> None:
            try:
                target(job_id)
            except Exception as exc:  # 兜底:job 目标函数自身未消化的异常
                self.update(job_id, error=f"内部错误: {exc}")

        threading.Thread(target=_wrapped, daemon=True, name=f"comfy-job-{job_id}").start()


jobs = JobRegistry()


# ── 纯函数(单测覆盖) ─────────────────────────────────────────────
_TAG_LINE_RE = re.compile(r"^refs/tags/(v?\d+(?:\.\d+)*)$")
_VERSION_RE = re.compile(r"\d+")


def parse_release_tags(ls_remote_lines: list[str]) -> list[tuple[tuple[int, ...], str]]:
    """从 `git ls-remote --tags` 输出提取纯数字版本 tag(v0.9.2 风格)。

    剥离 `^{}` 附注标签行与 -rc/-beta 等后缀 tag,按版本元组升序返回。
    """
    parsed: list[tuple[tuple[int, ...], str]] = []
    for line in ls_remote_lines:
        parts = line.split("\t")
        if len(parts) != 2:
            continue
        ref, tag = parts[1].strip(), parts[1].strip().removeprefix("refs/tags/")
        match = _TAG_LINE_RE.match(ref)
        if not match:
            continue
        version = tuple(int(n) for n in _VERSION_RE.findall(match.group(1)))
        if version:
            parsed.append((version, tag))
    return sorted(parsed)


def pick_latest_release(ls_remote_lines: list[str]) -> str | None:
    tags = parse_release_tags(ls_remote_lines)
    return tags[-1][1] if tags else None


def allocate_port(occupied: set[int], start: int = PORT_RANGE_START, end: int = PORT_RANGE_END) -> int | None:
    """17xxx 段顺序探测:跳过已占端口(含 17598 被占场景)与保留段位,取第一个空闲。"""
    for port in range(start, end + 1):
        if port in RESERVED_PORTS or port in occupied:
            continue
        return port
    return None


def build_launch_args(launch_cfg: dict, port: int, script: str = "main.py") -> list[str]:
    """性能档 → 实际启动 flag(prd:不暴露命令行原文)。

    显存策略:gpu-only→--gpu-only;reserve-vram→--reserve-vram <GB>;
    加速方式:pytorch-cross-attention→--use-pytorch-cross-attention。
    """
    args = [script, "--listen", "127.0.0.1", "--port", str(port)]
    vram = launch_cfg.get("vramPolicy")
    if vram == "gpu-only":
        args.append("--gpu-only")
    elif vram == "reserve-vram":
        reserve = launch_cfg.get("reserveVramGb")
        args += ["--reserve-vram", str(reserve if isinstance(reserve, (int, float)) and reserve > 0 else 4)]
    if launch_cfg.get("attentionMode") == "pytorch-cross-attention":
        args.append("--use-pytorch-cross-attention")
    return args


def diff_node_sets(before: set[str], after: set[str]) -> dict:
    """object_info 前后差分(插件安装「新增 N 个节点」成功口径)。"""
    added = sorted(after - before)
    removed = sorted(before - after)
    return {"added": added, "removed": removed, "addedCount": len(added), "removedCount": len(removed)}


_IMPORT_FAILED_RE = re.compile(r"\(IMPORT FAILED\):\s*(\S+)")
_CANNOT_IMPORT_RE = re.compile(r"Cannot import (\S*custom_nodes/\S+) module for custom nodes")


def collect_import_failures(log_text: str) -> list[dict]:
    """从引擎日志收集 custom_nodes 加载失败(更新链第 5 步插件兼容性点名)。

    兼容两种格式:0.3x 的 `(IMPORT FAILED): /path/custom_nodes/xxx` 与旧式
    `Cannot import /path/custom_nodes/xxx module for custom nodes: ...`。
    """
    seen: set[str] = set()
    failures: list[dict] = []
    for line in log_text.splitlines():
        hit = _IMPORT_FAILED_RE.search(line) or _CANNOT_IMPORT_RE.search(line)
        if not hit:
            continue
        raw = hit.group(1).rstrip(":")
        plugin = raw.rstrip("/").split("custom_nodes/")[-1].split("/")[0]
        if not plugin or plugin in seen:
            continue
        seen.add(plugin)
        failures.append({"plugin": plugin, "detail": line.strip()[:300]})
    return failures


# ── subprocess 辅助(绝对路径 + 显式 cwd,防漂移坑) ────────────────
def _run(argv: list[str], cwd: Path | None = None, timeout: float = 600.0,
         on_line=None) -> str:
    """跑 git/pip(唯一交互面;绝不 shell=True),逐行回调输出。

    看门狗计时器兜底:pip 静默下载期间 readline 无输出,行内 deadline 检查
    会失灵,由 Timer 强杀后经退出码路径报大白话超时。
    """
    proc = subprocess.Popen(
        [str(a) for a in argv], cwd=str(cwd) if cwd else None,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    timed_out = {"hit": False}

    def _kill_on_timeout() -> None:
        timed_out["hit"] = True
        proc.kill()

    timer = threading.Timer(timeout, _kill_on_timeout)
    timer.daemon = True
    timer.start()
    lines: list[str] = []
    try:
        assert proc.stdout is not None
        for line in proc.stdout:
            line = line.rstrip("\n")
            lines.append(line)
            if on_line:
                on_line(line)
        code = proc.wait(timeout=60.0)
    finally:
        timer.cancel()
    output = "\n".join(lines)
    if timed_out["hit"]:
        raise EngineOpError(f"命令超时({timeout:.0f} 秒): {argv[0]} — 网络太慢或源不可达,请检查网络后重试")
    if code != 0:
        raise EngineOpError(f"命令失败({argv[0]},退出码 {code}): {output[-500:]}")
    return output


def _git(argv: list[str], cwd: Path | None = None, timeout: float = 600.0, on_line=None) -> str:
    return _run(["git", *argv], cwd=cwd, timeout=timeout, on_line=on_line)


def _pip(argv: list[str], timeout: float = 3600.0, on_line=None) -> str:
    return _run([*cm.venv_pip(), *argv], cwd=cm.comfy_home(), timeout=timeout, on_line=on_line)


def _get_json(url: str, timeout: float = 5.0):
    req = request.Request(url, headers={"User-Agent": "MYStudio-comfy-host/1.0"})
    with request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _port_bindable(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def find_free_port() -> int:
    """实测探测(含 17598 被占的并存场景);全段被占属极端情况,直接报大白话。"""
    for port in range(PORT_RANGE_START, PORT_RANGE_END + 1):
        if port in RESERVED_PORTS:
            continue
        if _port_bindable(port):
            return port
    raise EngineOpError("17000-17999 端口段全被占用,无法为 ComfyUI 引擎分配端口")


def _check_disk_space(required_gb: float = INSTALL_REQUIRED_GB) -> None:
    target = cm.comfy_home()
    probe = target
    while not probe.exists():
        if probe.parent == probe:
            break
        probe = probe.parent
    free_gb = shutil.disk_usage(probe).free / 1024 ** 3
    if free_gb < required_gb:
        raise EngineOpError(f"磁盘空间不足:安装 ComfyUI 引擎至少需要 {required_gb:.0f} GB,当前仅剩 {free_gb:.1f} GB")


def _write_extra_model_paths(models_dir: Path) -> None:
    """modelsDir → ComfyUI/extra_model_paths.yaml(指向现有模型库免重下)。

    纯配置数据文件(非代码),ComfyUI 官方机制;默认也指 <comfyui>/models,
    因为我们的隔离布局里 models 与源码目录是兄弟目录。
    """
    models_dir.mkdir(parents=True, exist_ok=True)
    lines = ["# MYStudio 自管实例模型目录映射(自动生成,手动改动会被覆盖)"]
    lines.append(f"mystudio:")
    for key in _MODEL_FOLDER_KEYS:
        lines.append(f"    {key}: {models_dir / key}/")
    target = cm.engine_source_dir() / "extra_model_paths.yaml"
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


# ── 引擎管理器(单例) ─────────────────────────────────────────────
class EngineManager:
    def __init__(self) -> None:
        self._proc: subprocess.Popen | None = None
        self._log_file = None
        self._lock = threading.Lock()
        self._stopping = False
        self._guard_enabled = False
        self._guard_thread: threading.Thread | None = None
        self._restart_times: list[float] = []
        self._last_check: dict = {}  # 最近一次 update-check 结果缓存(状态行用)
        self._last_node_count: int | None = None

    # -- 状态 ------------------------------------------------------------
    def engine_url(self, port: int | None = None) -> str:
        port = port if port is not None else cm.recorded_port()
        if port is None:
            raise EngineOpError("ComfyUI 引擎尚未安装")
        return f"http://127.0.0.1:{port}"

    def is_healthy(self, port: int | None = None, timeout: float = 2.0) -> bool:
        try:
            port = port if port is not None else cm.recorded_port()
            if port is None:
                return False
            stats = _get_json(f"{self.engine_url(port)}/system_stats", timeout=timeout)
            return isinstance(stats, dict)
        except (OSError, error.URLError, json.JSONDecodeError, EngineOpError):
            return False

    def status(self) -> dict:
        manifest = cm.load_manifest()
        installed = cm.engine_installed(manifest)
        port = cm.recorded_port(manifest)
        running = self.is_healthy(port) if port else False
        if not installed:
            state = "installing" if jobs.active_of("engine-install") else "not_installed"
        elif jobs.active_of("engine-install"):
            state = "installing"
        elif jobs.active_of("engine-update"):
            state = "updating"
        elif jobs.active_of("engine-reset"):
            state = "resetting"
        elif running:
            state = "running"
        else:
            state = "stopped"
        engine = manifest.get("engine") if isinstance(manifest.get("engine"), dict) else {}
        # 渲染层状态机补充面(09-08 集成,B 契约需要):默认模型目录(恢复默认)、
        # 安装目录(打开按钮)、needsSetup(源码目录残留=装了一半可继续)、
        # message(出错态大白话通道,一期占位 None)。
        needs_setup = (
            not installed
            and cm.engine_source_dir().exists()
            and jobs.active_of("engine-install") is None
        )
        return {
            "installed": installed,
            "version": engine.get("version"),
            "latest": self._last_check.get("latest"),
            "state": state,
            "running": running,
            "port": port,
            "modelsDir": str(cm.configured_models_dir(manifest)),
            "pluginCount": len(cm.plugin_ledger(manifest)),
            "updateAvailable": bool(self._last_check.get("updateAvailable")),
            "launchArgs": cm.engine_launch_args(manifest),
            "torch": engine.get("torch"),
            "nodeCount": self._last_node_count,
            "defaultModelsDir": str(cm.default_models_dir()),
            "installDir": str(cm.comfy_home()),
            "needsSetup": needs_setup,
            "message": None,
        }

    # -- 安装(全新托管下载,唯一模式) ------------------------------------
    def install_job(self) -> str:
        if jobs.active_of("engine-install"):
            raise EngineOpError("引擎正在安装中,请等待完成")
        if cm.engine_installed():
            raise EngineOpError("引擎已安装;如需重装请先在高级操作里复位")
        job_id = jobs.create("engine-install", "准备安装 ComfyUI 引擎")
        jobs.start(job_id, self._install_job)
        return job_id

    def _install_job(self, job_id: str) -> None:
        home = cm.comfy_home()
        home.mkdir(parents=True, exist_ok=True)
        jobs.update(job_id, progress=2, step="preflight", message="检查 git 与磁盘空间…")
        _git(["--version"])
        _check_disk_space()
        if cm.engine_source_dir().exists():
            # 09-08 集成补修:needs-setup(装一半)死锁拆除——install 拒残留+
            # reset 要求已装会把用户锁死在「需准备」。续装=清掉无价值的半装
            # 产物后重走全流程(半装目录对 git 无复用价值,直接删最稳)。
            jobs.update(job_id, progress=3, step="preflight", message="清理上次未完成的安装残留…")
            shutil.rmtree(cm.engine_source_dir(), ignore_errors=True)

        jobs.update(job_id, progress=5, step="resolve-version", message="获取最新 release 版本号…")
        remote = _git(["ls-remote", "--tags", COMFYUI_REPO], timeout=30.0)
        tag = pick_latest_release(remote.splitlines())
        if not tag:
            raise EngineOpError("无法获取 ComfyUI 的 release 版本列表,请检查网络后重试")

        jobs.update(job_id, progress=10, step="git-clone", message=f"下载 ComfyUI 源码({tag})…")
        clone_progress = {"seen": 0}

        def _on_clone_line(line: str) -> None:
            # git --progress 输出 Receiving objects: NN% / Resolving deltas: NN%
            receiving = re.search(r"Receiving objects:\s+(\d+)%", line)
            resolving = re.search(r"Resolving deltas:\s+(\d+)%", line)
            if receiving:
                clone_progress["seen"] = max(clone_progress["seen"], 10 + int(receiving.group(1)) * 30 // 100)
            elif resolving:
                clone_progress["seen"] = max(clone_progress["seen"], 42 + int(resolving.group(1)) * 3 // 100)
            if clone_progress["seen"]:
                jobs.update(job_id, progress=clone_progress["seen"])

        _git(["clone", "--progress", "--branch", tag, "--depth", "1", COMFYUI_REPO,
              str(cm.engine_source_dir())], timeout=3600.0, on_line=_on_clone_line)

        jobs.update(job_id, progress=45, step="venv", message="创建引擎专用虚拟环境…")
        _run([sys_python(), "-m", "venv", str(cm.venv_dir())], timeout=300.0)

        jobs.update(job_id, progress=50, step="pip-torch", message="安装 PyTorch(MPS 加速栈,体积较大)…")
        _pip(["install", "torch", "torchvision", "torchaudio"],
             on_line=lambda line: jobs.update(job_id, tail_line=line))
        jobs.update(job_id, progress=75, step="pip-requirements", message="安装 ComfyUI 依赖…")
        _pip(["install", "-r", str(cm.engine_source_dir() / "requirements.txt")],
             on_line=lambda line: jobs.update(job_id, tail_line=line))

        jobs.update(job_id, progress=92, step="layout", message="整理目录与端口…")
        for sub in (cm.custom_nodes_dir(), cm.workflows_dir(), cm.default_models_dir()):
            sub.mkdir(parents=True, exist_ok=True)
        port = find_free_port()
        _write_extra_model_paths(cm.default_models_dir())
        freeze = self.venv_freeze()
        torch_version = next((line.split("==")[1] for line in freeze if line.startswith("torch==")), None)

        def _record(manifest: dict) -> None:
            manifest["engine"] = {
                "version": tag, "pinned": True, "repo": COMFYUI_REPO,
                "torch": torch_version, "installedAt": cm.timestamp_ms(),
                "port": port, "launchArgs": {"vramPolicy": "auto", "attentionMode": "auto"},
                "coreDeps": _freeze_to_map(freeze),
            }

        cm.mutate_manifest(_record)
        jobs.update(job_id, result={
            "version": tag, "port": port, "torch": torch_version,
            "message": f"ComfyUI 引擎 {tag} 安装完成,点「准备运行时」启动服务",
        })

    def venv_freeze(self) -> list[str]:
        if not cm.venv_python().exists():
            raise EngineOpError("引擎虚拟环境不存在(尚未安装或已被清理),无法读取依赖清单")
        proc = subprocess.run([*cm.venv_pip(), "freeze"], capture_output=True, text=True, timeout=120.0)
        if proc.returncode != 0:
            raise EngineOpError(f"读取引擎环境依赖失败: {proc.stderr[-300:]}")
        return [line.strip() for line in proc.stdout.splitlines() if line.strip()]

    # -- 启动/停止/守卫 ----------------------------------------------------
    def start_job(self) -> str:
        job_id = jobs.create("engine-start", "正在启动 ComfyUI 引擎…")
        jobs.start(job_id, self._start_job)
        return job_id

    def _start_job(self, job_id: str) -> None:
        result = self.start_sync(progress=lambda pct, msg: jobs.update(job_id, progress=pct, message=msg))
        # 09-08 加固①配套:启动 job 必须落终态,否则渲染层 pollJobUntilTerminal
        # 会一直等到超时,把已经就绪的引擎报成「服务启动失败」。
        jobs.update(job_id, result={
            "port": result.get("port"), "adopted": bool(result.get("adopted")),
            "message": "接管了正在运行的 ComfyUI 实例" if result.get("adopted") else "ComfyUI 引擎已就绪",
        })

    def _orphan_is_comfyui(self, port: int) -> bool:
        """孤儿收编门槛:端口必须应答 /system_stats 且形状像 ComfyUI。

        09-08 加固①:此前只看「端口有 JSON 应答」就把进程收编——撞端口的其它
        服务、或停在半启动态的旧引擎都会被误认为就绪,后续 object_info 直接
        读到旧进程的节点表(卸载插件后节点数不降级的假象来源)。
        """
        try:
            stats = _get_json(f"{self.engine_url(port)}/system_stats", timeout=3.0)
        except (OSError, error.URLError, json.JSONDecodeError, EngineOpError):
            return False
        return isinstance(stats, dict) and ("system" in stats or "devices" in stats)

    def start_sync(self, progress=None) -> dict:
        """同步启动(启动 job 与插件链内部复用)。已健康=收编孤儿进程直接就绪。"""
        if not cm.engine_installed():
            raise EngineOpError("ComfyUI 引擎尚未安装,请先安装")
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return {"running": True, "port": cm.recorded_port()}
        port = cm.recorded_port()
        if port and self._orphan_is_comfyui(port):
            self._enable_guard()
            # 收编后强制刷新一次节点数:孤儿进程的插件态(刚装/刚卸)与我们的
            # _last_node_count 缓存无关,不刷新=状态行展示旧节点数假象。
            self._last_node_count = self.node_count()
            if progress:
                progress(100, "接管了正在运行的 ComfyUI 实例")
            return {"running": True, "port": port, "adopted": True}
        # 账本端口被外部占用(如 Comfy Desktop 顺延撞上)→ 重探测换端口
        if port and not _port_bindable(port):
            port = find_free_port()
            cm.mutate_manifest(lambda m: m["engine"].update({"port": port}))
        if progress:
            progress(20, "启动引擎进程…")
        src = cm.engine_source_dir()
        if not (src / "main.py").is_file():
            raise EngineOpError("ComfyUI 源码目录不完整,请执行「复位」修复")
        argv = [str(cm.venv_python()), *build_launch_args(cm.engine_launch_args(), port, script=str(src / "main.py"))]
        _write_extra_model_paths(cm.configured_models_dir())
        cm.engine_log_path().parent.mkdir(parents=True, exist_ok=True)
        self._log_file = open(cm.engine_log_path(), "a", encoding="utf-8", buffering=1)
        self._stopping = False
        # 显式 cwd=源码目录(相对资源解析),可执行文件与脚本全绝对路径(防漂移坑)
        self._proc = subprocess.Popen(argv, cwd=str(src), stdout=self._log_file, stderr=subprocess.STDOUT)
        if progress:
            progress(40, "等待引擎就绪(首次加载模型较慢)…")
        deadline = time.monotonic() + HEALTH_TIMEOUT_S
        while time.monotonic() < deadline:
            if self._proc.poll() is not None:
                raise EngineOpError("引擎进程启动后立刻退出了,请查看日志:" + str(cm.engine_log_path()))
            if self.is_healthy(port, timeout=2.0):
                self._enable_guard()
                self._last_node_count = self.node_count()
                if progress:
                    progress(100, "ComfyUI 引擎已就绪")
                return {"running": True, "port": port}
            time.sleep(1.5)
        raise EngineOpError("引擎健康检查超时(120 秒),请查看日志:" + str(cm.engine_log_path()))

    def stop(self) -> dict:
        """停引擎:SIGTERM → 等满 10s 仍活 → SIGKILL 再等。

        09-08 加固①:stopped 不再无条件 True,以进程真实退出为准;我们不
        跟踪的端口占用者(外部起的实例)由 running 字段如实暴露给上层。
        """
        with self._lock:
            self._guard_enabled = False
            self._stopping = True
            proc, self._proc = self._proc, None
        if proc is not None and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=STOP_TERM_WAIT_S)
            except subprocess.TimeoutExpired:
                proc.kill()  # SIGTERM 装死(卡 C 扩展)→ 升级 SIGKILL
                try:
                    proc.wait(timeout=STOP_KILL_WAIT_S)
                except subprocess.TimeoutExpired:
                    pass  # 连 SIGKILL 都收不回(不可中断睡眠):stopped 如实报 False
        if self._log_file:
            try:
                self._log_file.close()
            except OSError:
                pass
            self._log_file = None
        stopped = proc is None or proc.poll() is not None
        return {"running": self.is_healthy(), "stopped": stopped}

    def restart(self, progress=None) -> dict:
        """重启(插件安装/更新链用;期望引擎回到健康态)。"""
        self.stop()
        time.sleep(1.0)
        return self.start_sync(progress=progress)

    def _enable_guard(self) -> None:
        self._guard_enabled = True
        self._restart_times = []
        if self._guard_thread is None or not self._guard_thread.is_alive():
            self._guard_thread = threading.Thread(target=self._guard_loop, daemon=True, name="comfy-engine-guard")
            self._guard_thread.start()

    def _guard_loop(self) -> None:
        """崩溃守卫(照 sidecar spawn 守卫模式):意外退出→自动拉起,限次熔断。"""
        while True:
            time.sleep(GUARD_INTERVAL_S)
            if not self._guard_enabled or self._stopping:
                continue
            proc = self._proc
            if proc is not None and proc.poll() is None:
                continue
            if self.is_healthy():
                continue  # 孤儿/收编态,无需重启
            now = time.monotonic()
            self._restart_times = [t for t in self._restart_times if now - t < GUARD_WINDOW_S]
            if len(self._restart_times) >= GUARD_MAX_RESTARTS:
                print("[image-sidecar] comfy-engine: 崩溃守卫熔断(15 分钟内已拉起 3 次),停止自动重启", flush=True)
                self._guard_enabled = False
                continue
            self._restart_times.append(now)
            print("[image-sidecar] comfy-engine: 检测到引擎退出,自动拉起", flush=True)
            try:
                self.start_sync()
            except EngineOpError as exc:
                print(f"[image-sidecar] comfy-engine: 守卫拉起失败: {exc}", flush=True)

    # -- HTTP 面(object_info/节点数) -------------------------------------
    def object_info_names(self, timeout: float = 30.0) -> set[str]:
        info = _get_json(f"{self.engine_url()}/object_info", timeout=timeout)
        if not isinstance(info, dict):
            raise EngineOpError("引擎 /object_info 应答格式异常")
        self._last_node_count = len(info)
        return set(info.keys())

    def node_count(self) -> int | None:
        try:
            return len(self.object_info_names())
        except (OSError, error.URLError, json.JSONDecodeError, EngineOpError):
            return self._last_node_count

    # -- 版本更新链(grill Q10) -------------------------------------------
    def update_check(self) -> dict:
        current = (cm.load_manifest().get("engine") or {}).get("version")
        try:
            remote = _git(["ls-remote", "--tags", COMFYUI_REPO], timeout=20.0)
            latest = pick_latest_release(remote.splitlines())
        except (EngineOpError, OSError) as exc:
            self._last_check = {"current": current, "latest": None, "updateAvailable": False, "error": f"检查更新失败: {exc}"}
            return dict(self._last_check)
        self._last_check = {
            "current": current, "latest": latest,
            "updateAvailable": bool(latest and current and latest != current),
        }
        return dict(self._last_check)

    def update_job(self) -> str:
        if jobs.active_of("engine-update"):
            raise EngineOpError("引擎正在更新中")
        if not cm.engine_installed():
            raise EngineOpError("引擎尚未安装,无版本可更新")
        latest = self._last_check.get("latest") or self.update_check().get("latest")
        if not latest or latest == (cm.load_manifest().get("engine") or {}).get("version"):
            raise EngineOpError("当前已是最新版本,无需更新")
        job_id = jobs.create("engine-update", f"准备更新到 {latest}")
        jobs.start(job_id, lambda jid: self._update_job(jid, latest))
        return job_id

    def _update_job(self, job_id: str, target_tag: str) -> None:
        src = cm.engine_source_dir()
        old_version = (cm.load_manifest().get("engine") or {}).get("version")
        nodes_before = self._safe_node_names()
        plugin_total = len(cm.plugin_ledger())
        jobs.update(job_id, progress=5, step="snapshot", message="更新前自动快照(失败可一键回滚)…")
        snapshot_id = self.create_snapshot(reason=f"update:{old_version}->{target_tag}", full=True)

        try:
            jobs.update(job_id, progress=15, step="fetch", message=f"拉取新版 {target_tag}…")
            _git(["fetch", "origin", f"refs/tags/{target_tag}:refs/tags/{target_tag}", "--depth", "1"], cwd=src, timeout=600.0)
            _git(["checkout", "--force", target_tag], cwd=src)
            _git(["clean", "-fd"], cwd=src)

            jobs.update(job_id, progress=35, step="pip", message="依赖按需升级…")
            _pip(["install", "torch", "torchvision", "torchaudio"])
            _pip(["install", "-r", str(src / "requirements.txt")],
                 on_line=lambda line: jobs.update(job_id, tail_line=line))

            jobs.update(job_id, progress=55, step="restart", message="重启引擎…")
            self.restart(progress=lambda pct, msg: jobs.update(job_id, progress=55 + pct * 25 // 100, message=msg))

            jobs.update(job_id, progress=85, step="verify", message="重校验 object_info 与插件加载…")
            nodes_after = self.object_info_names()
            failures = collect_import_failures(self._engine_log_tail())
            diff = diff_node_sets(nodes_before, nodes_after)

            freeze = self.venv_freeze()
            torch_version = next((line.split("==")[1] for line in freeze if line.startswith("torch==")), None)
            cm.mutate_manifest(lambda m: m["engine"].update({
                "version": target_tag, "torch": torch_version, "coreDeps": _freeze_to_map(freeze),
            }))
            jobs.update(job_id, result={
                "oldVersion": old_version, "newVersion": target_tag,
                "nodeCount": len(nodes_after), "nodeDelta": diff["addedCount"] - diff["removedCount"],
                "pluginCount": plugin_total,
                "pluginIssues": failures, "snapshotId": snapshot_id,
                "message": f"已更新到 {target_tag};新增 {diff['addedCount']} 个节点,移除 {diff['removedCount']} 个",
            })
        except Exception as exc:
            jobs.update(job_id, progress=90, step="rollback", message="更新失败,正在回滚到更新前状态…")
            try:
                self.rollback_snapshot(snapshot_id)
                jobs.update(job_id, error=f"更新失败已回滚: {exc}")
            except Exception as rollback_exc:
                jobs.update(job_id, error=f"更新失败且回滚失败(快照 {snapshot_id} 保留,可手动回滚): {exc} / 回滚错误: {rollback_exc}")

    def _safe_node_names(self) -> set[str]:
        try:
            return self.object_info_names()
        except (OSError, error.URLError, json.JSONDecodeError, EngineOpError):
            return set()

    def _engine_log_tail(self, limit: int = 400) -> str:
        try:
            return "\n".join(cm.engine_log_path().read_text(encoding="utf-8", errors="replace").splitlines()[-limit:])
        except OSError:
            return ""

    # -- 快照/回滚 ---------------------------------------------------------
    def create_snapshot(self, reason: str, full: bool = False) -> str:
        """快照=manifest 拷贝(+full:源码 tar,排除 venv)+ torch 栈记录。

        09-08 加固②(创建端):指向绝对路径的符号链接直接拒收(跳过)并记
        warning 进快照 manifest——毒快照事故根源:绝对软链进 tar,回滚解包
        被 data 过滤器整体拒收,快照变砖。
        """
        snap_id = f"snap-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
        snap_dir = cm.snapshots_dir() / snap_id
        snap_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(cm.manifest_path(), snap_dir / "manifest.json")
        meta = {
            "id": snap_id, "createdAt": cm.timestamp_ms(), "reason": reason, "full": full,
            "version": (cm.load_manifest().get("engine") or {}).get("version"),
            "torchStack": self.venv_freeze() if full else [],
        }
        if full:
            src = cm.engine_source_dir()
            tar_warnings: list[str] = []
            with tarfile.open(snap_dir / "comfyui-src.tar.gz", "w:gz") as tar:
                tar.add(src, arcname="ComfyUI", filter=_tar_snapshot_filter(tar_warnings))
            if tar_warnings:
                meta["warnings"] = tar_warnings
        (snap_dir / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return snap_id

    def list_snapshots(self) -> list[dict]:
        snaps: list[dict] = []
        if not cm.snapshots_dir().is_dir():
            return snaps
        for entry in sorted(cm.snapshots_dir().iterdir(), reverse=True):
            meta_file = entry / "meta.json"
            if not meta_file.is_file():
                continue
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            meta["hasSource"] = (entry / "comfyui-src.tar.gz").is_file()
            snaps.append(meta)
        return snaps

    def rollback_snapshot(self, snapshot_id: str) -> dict:
        # id 只允许 snap-* 自家命名,杜绝路径注入
        if not re.fullmatch(r"snap-[0-9A-Za-z.\-]+", snapshot_id or ""):
            raise EngineOpError("无效的快照编号")
        snap_dir = cm.snapshots_dir() / snapshot_id
        if not snap_dir.is_dir():
            raise EngineOpError(f"快照不存在: {snapshot_id}")
        manifest_copy = snap_dir / "manifest.json"
        src_tar = snap_dir / "comfyui-src.tar.gz"
        if not manifest_copy.is_file():
            raise EngineOpError("快照缺少账本副本,无法回滚")
        self.stop()
        if src_tar.is_file():
            # 09-08 加固②:原子换树(解包校验到临时目录→旧树挪备份位→临时
            # 转正),失败把旧树挪回原位,不再留半还原树(此前靠 git reset 救援)。
            self._restore_source_tree(src_tar)
        shutil.copy2(manifest_copy, cm.manifest_path())
        if src_tar.is_file():
            _pip(["install", "-r", str(cm.engine_source_dir() / "requirements.txt")])
            self.restart()
        return {"rolledBackTo": snapshot_id, "running": self.is_healthy()}

    def _restore_source_tree(self, src_tar: Path) -> None:
        """源码树原子还原:先在 <home>/.rollback-tmp 里解包校验,全过再换树。

        步骤:①gzip 整流校验(截断/CRC 损坏在此爆)②解包到临时目录(data
        过滤器拒收绝对软链等危险成员=毒快照防线)③旧树挪 ComfyUI.bak-failed-*
        ④临时树转正 ⑤成功清掉备份与临时壳。任一步失败:旧树挪回原位、临时
        目录保留供人工救援。
        """
        home = cm.comfy_home()
        tmp = home / ".rollback-tmp"
        src = cm.engine_source_dir()
        bak: Path | None = None
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir(parents=True, exist_ok=True)
        try:
            _verify_tarball(src_tar)
            with tarfile.open(src_tar, "r:gz") as tar:
                tar.extractall(tmp, filter="data")
            restored = tmp / "ComfyUI"
            if not (restored / "main.py").is_file():
                raise EngineOpError("快照内容不完整(源码根缺 main.py),疑似损坏")
            if src.exists():
                bak = home / f"ComfyUI.bak-failed-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:4]}"
                src.rename(bak)
            shutil.move(str(restored), str(src))
        except Exception as exc:
            if bak is not None and bak.is_dir():
                shutil.rmtree(src, ignore_errors=True)  # 清掉转正到一半的残树
                shutil.move(str(bak), str(src))
            raise EngineOpError(
                f"回滚失败:快照解包或替换没完成,原目录已恢复原位;"
                f"解包现场保留在 {tmp} 供人工检查。原因: {exc}"
            ) from exc
        if bak is not None:
            shutil.rmtree(bak, ignore_errors=True)
        shutil.rmtree(tmp, ignore_errors=True)

    # -- 核弹复位 ----------------------------------------------------------
    def reset_job(self) -> str:
        if jobs.active_of("engine-reset"):
            raise EngineOpError("复位已在进行中")
        if not cm.engine_installed() and not cm.engine_source_dir().exists():
            raise EngineOpError("引擎尚未安装,无需复位")
        job_id = jobs.create("engine-reset", "核弹复位:清空 venv 并按账本重建")
        jobs.start(job_id, self._reset_job)
        return job_id

    def _reset_job(self, job_id: str) -> None:
        ledger = cm.plugin_ledger()
        jobs.update(job_id, progress=5, step="snapshot", message="复位前快照账本…")
        self.create_snapshot(reason="reset", full=False)
        jobs.update(job_id, progress=10, step="stop", message="停止引擎…")
        self.stop()
        jobs.update(job_id, progress=15, step="wipe-venv", message="删除引擎虚拟环境(应用其余部分不受影响)…")
        shutil.rmtree(cm.venv_dir(), ignore_errors=True)
        jobs.update(job_id, progress=20, step="venv", message="重建虚拟环境…")
        _run([sys_python(), "-m", "venv", str(cm.venv_dir())], timeout=300.0)
        jobs.update(job_id, progress=30, step="pip-core", message="重装引擎核心依赖(torch + requirements)…")
        _pip(["install", "torch", "torchvision", "torchaudio"])
        engine_req = cm.engine_source_dir() / "requirements.txt"
        if engine_req.is_file():  # 半装目录可能缺 requirements(09-08 死锁补修配套)
            _pip(["install", "-r", str(engine_req)],
                 on_line=lambda line: jobs.update(job_id, tail_line=line))
        jobs.update(job_id, progress=70, step="pip-plugins", message="按账本重装插件依赖…")
        for index, (plugin_dir, entry) in enumerate(ledger.items()):
            req = cm.custom_nodes_dir() / plugin_dir / "requirements.txt"
            if req.is_file():
                _pip(["install", "-r", str(req)])
            jobs.update(job_id, progress=70 + index * 20 // max(1, len(ledger)))
        freeze = self.venv_freeze()
        cm.mutate_manifest(lambda m: m["engine"].update({"coreDeps": _freeze_to_map(freeze)}))
        jobs.update(job_id, progress=92, step="restart", message="重启引擎并校验…")
        self.restart()
        nodes = self.object_info_names()
        jobs.update(job_id, result={
            "nodeCount": len(nodes), "pluginCount": len(ledger),
            "message": "复位完成:引擎与插件依赖已按账本重建",
        })

    # -- 配置(modelsDir/性能档;引擎卡设置区) ----------------------------
    def update_config(self, payload: dict) -> dict:
        models_dir = payload.get("modelsDir")
        launch = payload.get("launchArgs") or {}
        if models_dir is not None:
            if not isinstance(models_dir, str) or not models_dir.strip():
                raise EngineOpError("模型目录必须是有效的绝对路径")
            models_path = Path(models_dir).expanduser()
            if not models_path.is_absolute():
                raise EngineOpError("模型目录必须是绝对路径")
            models_path.mkdir(parents=True, exist_ok=True)

        def _apply(manifest: dict) -> None:
            if models_dir is not None:
                manifest["modelsDir"] = str(models_path)
            if not isinstance(manifest.get("engine"), dict):
                raise EngineOpError("引擎尚未安装,无法保存设置")
            args = manifest["engine"].setdefault("launchArgs", {})
            if launch.get("vramPolicy") in cm.VRAM_POLICIES:
                args["vramPolicy"] = launch["vramPolicy"]
            if launch.get("attentionMode") in cm.ATTENTION_MODES:
                args["attentionMode"] = launch["attentionMode"]
            reserve = launch.get("reserveVramGb")
            if isinstance(reserve, (int, float)) and reserve > 0:
                args["reserveVramGb"] = reserve

        cm.mutate_manifest(_apply)
        _write_extra_model_paths(cm.configured_models_dir())
        was_running = self.is_healthy()
        if was_running:
            self.restart()  # modelsDir/性能档变更需要重启生效
        return {**self.status(), "restarted": was_running}


def _tar_no_pycache(tarinfo):
    if tarinfo.name.endswith("__pycache__") or tarinfo.name.endswith(".pyc"):
        return None
    return tarinfo


# 绝对路径判定:/开头、Windows 盘符(C:\)与 UNC(\\server)都算
_ABS_SYMLINK_RE = re.compile(r"^(?:/|[A-Za-z]:[\\/]|\\\\)")


def _tar_snapshot_filter(warnings: list[str]):
    """快照打包过滤器:__pycache__/.pyc 之外,再拒收指向绝对路径的符号链接。

    拒收项(返回 None=跳过打包)记进 warnings,由 create_snapshot 落进快照
    meta.json 供审计;相对路径软链不受影响(ComfyUI 生态正常用法)。
    """
    def _filter(tarinfo):
        if _tar_no_pycache(tarinfo) is None:
            return None
        if tarinfo.issym() and _ABS_SYMLINK_RE.match(tarinfo.linkname):
            warnings.append(f"跳过绝对路径符号链接: {tarinfo.name} -> {tarinfo.linkname}")
            return None
        return tarinfo
    return _filter


def _verify_tarball(tar_path: Path) -> None:
    """gzip 整流解压校验:文件截断/CRC 损坏在这里抛出,不碰正式目录。"""
    with open(tar_path, "rb") as raw, gzip.GzipFile(fileobj=raw) as gz:
        while gz.read(1 << 20):
            pass


def _freeze_to_map(freeze_lines: list[str]) -> dict[str, str]:
    deps: dict[str, str] = {}
    for line in freeze_lines:
        if "==" in line and not line.startswith(("-", "@", "#")):
            name, _, version = line.partition("==")
            deps[name.strip().lower()] = version.strip()
    return deps


def sys_python() -> str:
    """创建 venv 用的解释器 = 应用已托管的 indygreg python(sidecar 自身即它)。"""
    return sys.executable


_manager: EngineManager | None = None
_manager_lock = threading.Lock()


def engine_manager() -> EngineManager:
    global _manager
    with _manager_lock:
        if _manager is None:
            _manager = EngineManager()
        return _manager
