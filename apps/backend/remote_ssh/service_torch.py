"""service_torch.py — PyTorch/CUDA 升级域(版本探测、三件套对照、安装与任务跟踪;改写模块级变量的 upgrade_engine_torch 留在 service.py)

本模块的类由 service.SSHService 混入组合而成:方法体自 SSHService 逐字搬出(1124 超线文件拆分),对外接口不变。

两点约定:
- 须在 service 之后导入(类体里用到的名字在 service 初始化时才就绪;单独先导入本模块会循环导入失败);
- 测试会在 service 上整个替换的名字、以及定义在原类之后的名字,一律经 `service.<名字>` 取(调用时才查),
  在 service 上打桩的效果与搬出前相同。
"""

from __future__ import annotations

import base64
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import re
from remote_ssh import config as ssh_config
import time

from . import service
from .service import (
    PINNED_TORCH,
    SSHServiceError,
    TORCH_TA_MAP,
    TORCH_TV_MAP,
    TorchInstallUnknownError,
    _TORCH_KILL_PATTERN,
    _TORCH_SESSION,
    _WIN_COMFY_ROOT,
    _WIN_VENV_PYTHON,
    _pip_running_from_proc_lines,
    _torch_clear_markers,
    _torch_powershell,
    _torch_quote,
    logger,
)


class TorchUpgradeMixin:
    """PyTorch/CUDA 升级域(版本探测、三件套对照、安装与任务跟踪;改写模块级变量的 upgrade_engine_torch 留在 service.py)"""

    @contextmanager
    def _torch_session_guard(self):
        expected = getattr(_TORCH_SESSION, "client", None)
        if expected is None:
            yield
            return
        with self._lock:
            if self._client is not expected or not self._connected:
                raise SSHServiceError("升级期间 SSH 会话已改变，拒绝操作其他主机")
        try:
            yield
        finally:
            with self._lock:
                if self._client is not expected or not self._connected:
                    raise SSHServiceError("升级期间 SSH 会话已改变，拒绝操作其他主机")

    def _torch_command(self, script: str, timeout_s: float = 30) -> str:
        with self._torch_session_guard():
            code, output = self.run_remote_command(_torch_powershell(script), timeout_s)
        if code != 0:
            raise RuntimeError(output.strip() or f"远端命令失败 ({code})")
        return output.strip()

    def _torch_remote_pip_running(self) -> bool:
        output = self._torch_command(
            "$ErrorActionPreference='Stop'; "
            "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | ForEach-Object { "
            "if ($_.CommandLine) { 'PROC|' + $_.ProcessId + '|' + "
            "[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.CommandLine)) } }; 'PROCDONE'"
        )
        return _pip_running_from_proc_lines(output.splitlines(), _WIN_VENV_PYTHON)

    def _torch_pkg_metadata(self, name: str) -> str:
        """包版本探针(pip show 元数据只读,不 import——坏件(如 cu128 旧 torchaudio
        配 cu132 torch)import 即抛 OSError,metadata 安全)。1108 用户令「能取到版本
        就先取」:返回版本串;未安装返回 "NONE"(确定性缺件);命令执行失败返回 ""
        (调用方按「未能读取」降级,不冒充缺件)。"""
        output = self._torch_command(
            f"$env:PYTHONUTF8='1'; & {_torch_quote(_WIN_VENV_PYTHON)} -m pip show {name}; exit $LASTEXITCODE",
            60,
        )
        m = re.search(r"(?im)^Version:\s*(\S+)", output or "")
        if m:
            return m.group(1)
        return "NONE" if re.search(r"(?i)not found", output or "") else ""

    def _torch_verify_recovery_import(self, target: str) -> None:
        actual = self._torch_command(f"& {_torch_quote(_WIN_VENV_PYTHON)} -c 'import torch, torchvision; print(torch.__version__)'; exit $LASTEXITCODE", 60)
        if actual.splitlines()[-1:] != [target]:
            raise RuntimeError("远端 PyTorch 版本与异常标记不一致")

    def _torch_http(self, path: str, timeout_s: float = 20) -> dict:
        projection = "@{nodeCount=@($value.PSObject.Properties).Count}" if path == "/object_info" else "$value"
        output = self._torch_command(
            f"$ErrorActionPreference='Stop'; $value=Invoke-RestMethod -TimeoutSec {int(timeout_s)} -Uri 'http://127.0.0.1:17000{path}'; {projection} | ConvertTo-Json -Depth 100 -Compress",
            timeout_s,
        )
        data = json.loads(output)
        if not isinstance(data, dict):
            raise TypeError(f"{path} 返回的数据无效")
        return data

    def _torch_wait_ready(self) -> dict:
        # 1107 用户实弹:20G 模型冷启动 120s 不够,提至 300s(引擎家加载全量模型栈)
        deadline = time.monotonic() + 300
        while time.monotonic() < deadline:
            try:
                return self._torch_http("/system_stats")
            except (SSHServiceError, RuntimeError, TypeError, ValueError):
                time.sleep(3)
        raise RuntimeError("引擎重启后 300 秒内未就绪")

    def _torch_restart(self) -> dict:
        with self._torch_session_guard():
            reply = self.restart_remote_engine()
        if not reply.get("ok"):
            raise RuntimeError(f"引擎重启失败: {reply.get('output', '')}")
        return self._torch_wait_ready()

    def _torch_stop_engine(self) -> None:
        self._torch_command(f"Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | Where-Object {{ $_.CommandLine -match '{_TORCH_KILL_PATTERN}' }} | ForEach-Object {{ Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }}; $end=(Get-Date).AddSeconds(60); while (Get-NetTCPConnection -LocalPort 17000 -State Listen -ErrorAction SilentlyContinue) {{ if ((Get-Date) -gt $end) {{ throw 'port 17000 remains in use' }}; Start-Sleep -Seconds 2 }}", 75)

    def _torch_install(self, specs: list[str], channel: str, job_id: str, *, allow_mirror: bool = True) -> None:
        from comfyui.engine_manager import jobs

        packages = " ".join(_torch_quote(spec) for spec in specs)
        last_output = ""
        # 1107 终裁:交大(SJTU)镜像为首选——.cn 域名 Clash 走直连不经代理,不会被篡改;
        # 官方源做备选(网络好时也快);阿里镜像无 cu132 已排除;清华无 cu132。
        indexes = [f"https://mirror.sjtu.edu.cn/pytorch-wheels/{channel}"]
        if allow_mirror:
            indexes.append(f"https://download.pytorch.org/whl/{channel}")
        for index in indexes:
            # 1107 终裁:交大(.cn)首选源 Clash 直连不经代理,无需停 mihomo;仅在备选官方源时才清代理。
            script = (
                f"$env:HTTPS_PROXY=''; $env:HTTP_PROXY=''; $env:NO_PROXY='*'; "
                f"$env:PYTHONUTF8='1'; & {_torch_quote(_WIN_VENV_PYTHON)} -m pip install "
                f"--no-cache-dir {packages} --index-url {_torch_quote(index)} 2>&1; exit $LASTEXITCODE")
            try:
                with self._torch_session_guard():
                    code, output = self.run_remote_command(_torch_powershell(script), 3600)
            except SSHServiceError as exc:
                if isinstance(exc.__cause__, TimeoutError):
                    self._torch_monitor_install(specs, job_id)
                    return
                raise TorchInstallUnknownError(f"pip 状态不明: {exc}") from exc
            last_output = output.strip()
            for line in last_output.splitlines()[-30:]:
                jobs.update(job_id, tail_line=line)
            if code == 0:
                return
            if code is None or code < 0:
                raise TorchInstallUnknownError(f"pip 状态不明，退出码 {code}: {last_output[-1500:]}")
        raise RuntimeError(f"pip 安装失败: {last_output[-1500:]}")

    def _torch_monitor_install(self, specs: list[str], job_id: str) -> None:
        from comfyui.engine_manager import jobs

        deadline = time.monotonic() + 1800
        while True:
            try:
                running = self._torch_remote_pip_running()
            except (SSHServiceError, RuntimeError, ValueError) as exc:
                raise TorchInstallUnknownError(f"pip 监控失败: {exc}") from exc
            state = "running" if running else "stopped"
            jobs.update(job_id, tail_line=f"pip 超时监控: {state}")
            if state == "stopped":
                break
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TorchInstallUnknownError("pip 监控超过 30 分钟，进程仍在运行")
            time.sleep(min(60, remaining))
        expected = [spec.split("==", 1)[1] for spec in specs]
        modules = [spec.split("==", 1)[0] for spec in specs]
        expression = "; ".join(f"print(__import__({name!r}).__version__)" for name in modules)
        probe = (f"$env:PYTHONUTF8='1'; & {_torch_quote(_WIN_VENV_PYTHON)} "
                 f'-c "{expression}"; exit $LASTEXITCODE')
        try:
            with self._torch_session_guard():
                code, output = self.run_remote_command(_torch_powershell(probe), 30)
        except SSHServiceError as exc:
            raise TorchInstallUnknownError(f"pip 版本验证状态不明: {exc}") from exc
        if code is None or code < 0:
            raise TorchInstallUnknownError("pip 版本验证状态不明")
        if code != 0 or output.strip().splitlines()[-len(expected):] != expected:
            raise RuntimeError(f"pip 已退出但版本验证失败: {output.strip()}")

    def _torch_write_ledger(self, current: dict, entry: dict) -> None:
        path = _WIN_COMFY_ROOT + "\\torch-upgrade.json"
        log_path = _WIN_COMFY_ROOT + "\\engine-upgrade.log"
        encoded_current = base64.b64encode(json.dumps(current, ensure_ascii=False).encode()).decode()
        encoded_entry = base64.b64encode(json.dumps(entry, ensure_ascii=False).encode()).decode()
        script = f"""
$ErrorActionPreference='Stop'
$path={_torch_quote(path)}; $log={_torch_quote(log_path)}
$current=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_current}')) | ConvertFrom-Json
$entry=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{encoded_entry}')) | ConvertFrom-Json
$history=@(); if (Test-Path -LiteralPath $path) {{ $old=Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json; $history=@($old.history) }}
$json=@{{current=$current; history=@($history)+@($entry)}} | ConvertTo-Json -Depth 20
$utf8=New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($path+'.tmp', $json, $utf8)
Move-Item -LiteralPath ($path+'.tmp') -Destination $path -Force
[IO.File]::AppendAllText($log, ($entry | ConvertTo-Json -Compress)+[Environment]::NewLine, $utf8)
"""
        self._torch_command(script)

    def _torch_log(self, job_id: str, message: str) -> None:
        line = json.dumps({"at": datetime.now(timezone.utc).isoformat(), "jobId": job_id, "message": message}, ensure_ascii=False)
        encoded = base64.b64encode((line + "\n").encode("utf-8")).decode("ascii")
        path = _WIN_COMFY_ROOT + "\\engine-upgrade.log"
        self._torch_command(f"$bytes=[Convert]::FromBase64String('{encoded}'); $stream=[IO.File]::Open({_torch_quote(path)},[IO.FileMode]::Append,[IO.FileAccess]::Write,[IO.FileShare]::Read); try {{ $stream.Write($bytes,0,$bytes.Length) }} finally {{ $stream.Dispose() }}")

    def get_engine_torch_info(self, *, expected_host: str | None = None, expected_url: str | None = None) -> dict:
        from comfyui.engine_manager import jobs
        from engines.image_engine.comfyui_bridge import _http_json, bridge_url
        from urllib.parse import urlparse

        with self._lock:
            configured_host = ssh_config.load_config().get("host")
            expected_client = self._client
            host_matched = bool(expected_host and isinstance(configured_host, str)
                                and expected_host.casefold() == configured_host.casefold()
                                and self._connected and self._connected_host == configured_host)
        def verify_ssh_identity() -> None:
            with self._lock:
                if not host_matched or self._client is not expected_client or not self._connected or self._connected_host != configured_host:
                    raise SSHServiceError("SSH 主机或会话不匹配")
            if expected_url and bridge_url().rstrip("/") != expected_url.rstrip("/"):
                raise SSHServiceError("引擎地址已改变，拒绝读取其他引擎")

        current = None
        errors = []
        try:
            url = bridge_url()
            host = urlparse(url).hostname
            if not expected_host or not host or host.casefold() != expected_host.casefold() or (expected_url and url.rstrip("/") != expected_url.rstrip("/")):
                raise RuntimeError("引擎地址已改变，拒绝读取其他引擎")
            stats = _http_json("GET", f"{url}/system_stats", timeout=5)
            if bridge_url().rstrip("/") != url.rstrip("/"):
                raise RuntimeError("引擎地址在探测期间改变")
            version = stats.get("system", {}).get("pytorch_version")
            if not isinstance(version, str) or not version.strip():
                raise ValueError("system_stats 缺少 pytorch_version")
            cuda_match = re.search(r"\+cu(\d{2})(\d)$", version)
            current = {"torch": version, "torchvision": None,
                       "cuda": f"{int(cuda_match.group(1))}.{cuda_match.group(2)}" if cuda_match else None,
                       "updatedAt": None, "via": "live", "source": "system_stats"}
        except Exception as exc:
            errors.append(f"system_stats: {str(exc)[:300] or type(exc).__name__}")
        if current is None:
            try:
                verify_ssh_identity()
                version = self._torch_command(f"$env:PYTHONUTF8='1'; & {_torch_quote(_WIN_VENV_PYTHON)} -c 'import torch; print(torch.__version__)'; exit $LASTEXITCODE", 20).splitlines()[-1].strip()
                verify_ssh_identity()
                if not re.fullmatch(r"\d+\.\d+\.\d+[a-zA-Z0-9.+_-]*", version):
                    raise ValueError("venv 未返回有效版本")
                cuda_match = re.search(r"\+cu(\d{2})(\d)$", version)
                current = {"torch": version, "torchvision": None,
                           "cuda": f"{int(cuda_match.group(1))}.{cuda_match.group(2)}" if cuda_match else None,
                           "updatedAt": None, "via": "live", "source": "venv-probe"}
            except (SSHServiceError, RuntimeError, TypeError, ValueError, OSError, IndexError) as exc:
                errors.append(f"venv-probe: {str(exc)[:300] or type(exc).__name__}")
        if current is None:
            try:
                verify_ssh_identity()
                ledger = json.loads(self.sftp_read_text((_WIN_COMFY_ROOT + "\\torch-upgrade.json").replace("\\", "/")))
                verify_ssh_identity()
                entry = ledger.get("current") if isinstance(ledger, dict) else None
                if not isinstance(entry, dict) or not isinstance(entry.get("torch"), str) or not entry["torch"].strip():
                    raise ValueError("账本缺少 PyTorch 版本")
                current = {**entry, "source": "ledger"}
            except (SSHServiceError, RuntimeError, TypeError, ValueError, OSError) as exc:
                errors.append(f"ledger: {str(exc)[:300] or type(exc).__name__}")
        active_job = jobs.active_of("torch-upgrade")
        # 1107 用户令(点前写明会动什么):现值探针补卫星包(metadata 只读,坏件 import 即炸)
        # + 暴露 tvMap/taMap 供 UI 渲染「当前→目标」三件套对照清单
        # 1108 用户令「能取到版本就先取,取不到再显示其他的」:torchvision 从不探测的
        # 旧缺口补上——两件都经 SSH pip show 真取;值域=版本串|"NONE"(确定性未安装)|
        # None(未能读取:SSH 未连接/执行失败,前端按降级态显示,不渲染成「将安装」)。
        if current is not None and self._client is not None and self._connected:
            for _pkg in ("torchvision", "torchaudio"):
                try:
                    verify_ssh_identity()
                    _v = self._torch_pkg_metadata(_pkg)
                    verify_ssh_identity()
                    if _v and _v != "NONE" and re.fullmatch(r"\d+\.\d+\.\d+[a-zA-Z0-9.+_-]*", _v):
                        current = {**current, _pkg: _v}
                    elif _v == "NONE":
                        current = {**current, _pkg: "NONE"}
                    else:
                        current = {**current, _pkg: None}
                        errors.append(f"{_pkg}-probe: 探测未返回有效版本")
                except (SSHServiceError, RuntimeError, TypeError, ValueError, OSError) as exc:
                    current = {**current, _pkg: None}
                    errors.append(f"{_pkg}-probe: {str(exc)[:200] or type(exc).__name__}")
        return {"current": current, "live": current is not None and current["source"] != "ledger", "errors": errors, "hostMatched": host_matched,
                "busy": active_job is not None, "jobId": active_job["id"] if active_job and active_job.get("mode") == "remote" and isinstance(active_job.get("origin_host"), str) and isinstance(expected_host, str) and active_job["origin_host"].casefold() == expected_host.casefold() else None,
                "allowedTargets": list(TORCH_TV_MAP), "pinnedTarget": PINNED_TORCH,
                "tvMap": TORCH_TV_MAP, "taMap": TORCH_TA_MAP}

    def _torch_upgrade_job(self, job_id: str, target: str, channel: str, host: str | None = None) -> bool:
        from comfyui.engine_manager import jobs
        from comfyui.manifest import comfy_home

        old_torch = ""
        old_tv = ""
        stopped = False
        install_started = False
        baseline = 0
        target_version = f"{target}+{channel}"
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        result = {"from": None, "to": target_version, "rollback": False, "pipError": None}
        def progress(step: str, percent: int, message: str) -> None:
            jobs.update(job_id, step=step, progress=percent, message=message)
            self._torch_log(job_id, f"{step}: {message}")
        try:
            if not self.status().get("connected"):
                raise RuntimeError("SSH 未连接")
            # 1107: skip-if-latest——当前版本已等于目标则跳过全链,不重下 4GB
            # 1107 补:torchaudio 同查(metadata 探针)——torch 达标但 torchaudio 旧件残留时
            # 不得跳过(cu128 旧件拖挂 6 插件役教训);pip 对已满足的 torch/torchvision pin
            # 判 already-satisfied 不重下,补装 torchaudio 仅 ~2MB
            try:
                _stats = self._torch_http("/system_stats")
                _cur = _stats.get("system", {}).get("pytorch_version", "")
                if _cur == target_version:
                    _ta = self._torch_pkg_metadata("torchaudio")
                    if _ta == f"{TORCH_TA_MAP[target]}+{channel}":
                        result["from"] = _cur
                        jobs.update(job_id, step="ledger", progress=100, message=f"已是目标版本 {_cur}(含 torchaudio {_ta}),跳过升级", result=result)
                        return result
            except Exception:
                pass  # 探针失败不拦升级流程
            progress("preflight", 5, "检查远端引擎")
            if self._torch_remote_pip_running():
                raise RuntimeError("引擎环境中已有 pip 安装进程，拒绝并发升级")
            try:
                self._torch_http("/system_stats")
            except (SSHServiceError, RuntimeError, TypeError, ValueError):
                self._torch_restart()
            queue = self._torch_http("/queue")
            if queue.get("queue_pending") != [] or queue.get("queue_running") != []:
                # 1107 用户斥「啥没说」:报错须带队列内容摘要,不能只甩「非空」
                _run_q = queue.get("queue_running") or []
                _pend_q = queue.get("queue_pending") or []
                _first_node = ""
                for _entry in list(_run_q) + list(_pend_q):
                    _prompt = _entry[2] if isinstance(_entry, (list, tuple)) and len(_entry) > 2 and isinstance(_entry[2], dict) else None
                    if _prompt:
                        _node = next(iter(_prompt.values()), None)
                        _first_node = str(_node.get("class_type", "")) if isinstance(_node, dict) else ""
                        break
                raise RuntimeError(
                    f"引擎队列非空(执行中 {len(_run_q)} 项、待跑 {len(_pend_q)} 项"
                    + (f",首节点 {_first_node}" if _first_node else "")
                    + ")——引擎正在跑生成任务,等任务完成或清空队列后再点升级;中途升级会杀引擎毁掉在途出图"
                )
            baseline = self._torch_http("/object_info", 120).get("nodeCount", 0)
            if baseline <= 0:
                raise RuntimeError("节点基线为空")
            free = int(self._torch_command("(Get-Volume -DriveLetter E).SizeRemaining"))
            if free < 15 * 1024 ** 3:
                raise RuntimeError("E 盘可用空间不足 15 GiB")
            driver = self._torch_command("& nvidia-smi; exit $LASTEXITCODE")
            match = re.search(r"CUDA(?:\s+UMD)?\s+Version:\s*(\d+)\.(\d+)", driver)
            if not match or (int(match.group(1)), int(match.group(2))) < (int(channel[2:-1]), int(channel[-1])):
                raise RuntimeError("显卡驱动不支持目标 CUDA 版本")

            progress("snapshot", 10, "备份已安装包")
            filename = f"rollback-{timestamp}-{job_id}.txt"
            remote_dir = _WIN_COMFY_ROOT + "\\torch-upgrade"
            remote_path = remote_dir + "\\" + filename
            snapshot_hash = self._torch_command(f"$ErrorActionPreference='Stop'; $env:PYTHONUTF8='1'; New-Item -ItemType Directory -Force -Path {_torch_quote(remote_dir)} | Out-Null; $lines=@(& {_torch_quote(_WIN_VENV_PYTHON)} -m pip freeze); if ($LASTEXITCODE -ne 0) {{ exit $LASTEXITCODE }}; [IO.File]::WriteAllLines({_torch_quote(remote_path)}, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false))); (Get-FileHash -Algorithm SHA256 -LiteralPath {_torch_quote(remote_path)}).Hash", 120)
            with self._torch_session_guard():
                copied = self.sftp_read_text(remote_path.replace("\\", "/"))
            if hashlib.sha256(copied.encode("utf-8")).hexdigest().lower() != snapshot_hash.lower():
                raise RuntimeError("远端快照回拷校验失败")
            pins = dict(re.findall(r"(?im)^(torch|torchvision|torchaudio)==([^\s]+)\s*$", copied))
            old_torch, old_tv = pins.get("torch", ""), pins.get("torchvision", "")
            old_ta = pins.get("torchaudio", "")  # 1107 补:回滚带 torchaudio(无件环境=空串不强求)
            if not re.fullmatch(r"\d+\.\d+\.\d+\+cu\d+", old_torch):
                raise RuntimeError("快照缺少可回滚的 CUDA torch pin")
            if not re.fullmatch(r"\d+\.\d+\.\d+\+cu\d+", old_tv):
                raise RuntimeError("快照缺少可回滚的 torchvision pin")
            result["from"] = old_torch
            backup_dir = comfy_home() / "torch-upgrade-backup"
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / filename).write_text(copied, encoding="utf-8")

            progress("stop-engine", 15, "停止远端引擎")
            stopped = True
            self._torch_stop_engine()
            progress("install", 15, "安装目标版本")
            service._write_torch_in_progress(job_id, mode="remote", host=host, target=target_version)
            install_started = True
            specs = [f"torch=={target_version}"]
            specs.append(f"torchvision=={TORCH_TV_MAP[target]}+{channel}")
            specs.append(f"torchaudio=={TORCH_TA_MAP[target]}+{channel}")  # 1107 补:三件套齐
            self._torch_install(specs, channel, job_id)
            progress("verify-import", 85, "验证 PyTorch 和 CUDA")
            probe = self._torch_command(f"$env:PYTHONUTF8='1'; & {_torch_quote(_WIN_VENV_PYTHON)} -c 'import torch, torchaudio; print(torch.__version__); print(torch.cuda.is_available()); print(torchaudio.__version__)'; exit $LASTEXITCODE", 120).splitlines()
            if len(probe) < 3 or probe[-3:] != [target_version, "True", f"{TORCH_TA_MAP[target]}+{channel}"]:
                raise RuntimeError("PyTorch/torchaudio 版本或 CUDA 导入验证失败")
            progress("restart", 90, "重启引擎")
            stats = self._torch_restart()
            progress("smoke", 95, "验证引擎节点")
            # 1107: 引擎重启后插件异步加载,节点数需时间爬升;重试 5 轮×30s(共 150s 等待)
            smoke_ok = False
            for smoke_try in range(5):
                try:
                    node_count = self._torch_http("/object_info", 120).get("nodeCount", 0)
                    ver_ok = stats.get("system", {}).get("pytorch_version") == target_version
                    dev_ok = bool(stats.get("devices"))
                    count_ok = node_count >= max(1, baseline * 0.95)
                    if ver_ok and dev_ok and count_ok:
                        smoke_ok = True
                        break
                    import time as _t; _t.sleep(30)
                    stats = self._torch_http("/system_stats")  # 刷新版本(首轮可能旧缓存)
                except Exception:
                    import time as _t; _t.sleep(30)
                    try: stats = self._torch_http("/system_stats")
                    except Exception: pass
            if not smoke_ok:
                raise RuntimeError(f"引擎烟测失败(版本={stats.get('system',{}).get('pytorch_version','?')}, 节点={node_count}/{baseline})")
            progress("ledger", 99, "记录升级结果")
            now = datetime.now(timezone.utc).isoformat()
            current = {"torch": target_version, "torchvision": f"{TORCH_TV_MAP[target]}+{channel}", "torchaudio": f"{TORCH_TA_MAP[target]}+{channel}", "cuda": f"{channel[2:-1]}.{channel[-1]}", "updatedAt": now, "via": "oneclick"}
            self._torch_write_ledger(current, {"at": now, "from": old_torch, "to": target_version, "ok": True, "rollback": False, "jobId": job_id})
            _torch_clear_markers()
            jobs.update(job_id, step="ledger", progress=100, message="升级完成，引擎已重启", result=result)
        except Exception as exc:
            logger.exception("Torch upgrade failed")
            stuck = isinstance(exc, TorchInstallUnknownError)
            error = str(exc)
            result["pipError"] = error if install_started else None
            if stopped and isinstance(exc, TorchInstallUnknownError):
                error += "；回滚未执行，引擎可能离线，须人工确认远端 pip 已停止后介入"
            elif stopped:
                try:
                    if install_started:
                        self._torch_stop_engine()
                        old_channel = old_torch.rsplit("+", 1)[1]
                        self._torch_install([f"torch=={old_torch}", f"torchvision=={old_tv}"], old_channel, job_id, allow_mirror=False)
                        # 1107 补:torchaudio 单独回滚——混装态(如 torch cu132+torchaudio cu128)
                        # 通道不同,须各走各的 index 找得到轮子;CPU 版 pin(无+cuXXX)无通道可言,跳过
                        if old_ta and "+" in old_ta:
                            self._torch_install([f"torchaudio=={old_ta}"], old_ta.rsplit("+", 1)[1], job_id, allow_mirror=False)
                    stats = self._torch_restart()
                    if old_torch and (stats.get("system", {}).get("pytorch_version") != old_torch or not stats.get("devices")):
                        raise RuntimeError("回滚后引擎版本验证失败")
                    if install_started and self._torch_http("/object_info", 120).get("nodeCount", 0) < max(1, baseline * 0.95):
                        raise RuntimeError("回滚后节点数量验证失败")
                    result["rollback"] = True
                    error += f"；已回滚至 {old_torch}" if install_started else "；引擎已恢复"
                    if install_started:
                        now = datetime.now(timezone.utc).isoformat()
                        self._torch_write_ledger({"torch": old_torch, "torchvision": old_tv or None, "torchaudio": old_ta or None, "cuda": None, "updatedAt": now, "via": "rollback"}, {"at": now, "from": old_torch, "to": target_version, "ok": False, "rollback": True, "jobId": job_id})
                        _torch_clear_markers()
                except Exception as rollback_exc:
                    logger.exception("Torch rollback failed")
                    stuck = isinstance(rollback_exc, TorchInstallUnknownError)
                    error += f"；回滚失败，引擎可能离线，须人工介入: {rollback_exc}"
            try:
                self._torch_log(job_id, error)
            except (SSHServiceError, RuntimeError, TypeError, ValueError, OSError) as log_exc:
                jobs.update(job_id, tail_line=f"升级日志写入失败: {log_exc}")
            jobs.update(job_id, result=result, complete=False)
            jobs.update(job_id, error=error, message=error, tail_line=error)
            return stuck
        return False
