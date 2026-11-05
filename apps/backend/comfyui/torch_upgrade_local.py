from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from urllib import error

from remote_ssh import service as torch_service
from remote_ssh.service import _TORCH_UPGRADE_LOCK, PINNED_TORCH, TORCH_TV_MAP

from comfyui import engine_manager as engine_module
from comfyui import manifest


def snapshot_installed_packages(job_id: str) -> tuple[str, str]:
    if not re.fullmatch(r"[a-zA-Z0-9_-]+", job_id):
        raise ValueError("无效的升级任务标识")
    freeze = subprocess.run(
        [str(manifest.venv_python()), "-m", "pip", "freeze"],
        capture_output=True, text=True, timeout=120, check=True,
    ).stdout
    pins = dict(re.findall(r"(?im)^(torch|torchvision)==([^\s]+)\s*$", freeze))
    old_torch, old_vision = pins.get("torch", ""), pins.get("torchvision", "")
    if not all(re.fullmatch(r"\d+\.\d+\.\d+(?:\+[a-zA-Z0-9._-]+)?", pin) for pin in (old_torch, old_vision)):
        raise RuntimeError("快照缺少可安全回滚的 torch/torchvision 版本")
    directory = manifest.comfy_home() / "torch-upgrade"
    directory.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    with (directory / f"rollback-{timestamp}-{job_id}.txt").open("x", encoding="utf-8") as snapshot:
        snapshot.write(freeze)
    return old_torch, old_vision


def get_engine_torch_info() -> dict:
    current = None
    try:
        ledger = json.loads((manifest.comfy_home() / "torch-upgrade.json").read_text(encoding="utf-8"))
        if isinstance(ledger, dict) and isinstance(ledger.get("current"), dict):
            current = ledger["current"]
    except (OSError, ValueError):
        pass

    live = False
    mps = None
    try:
        manager = engine_module.engine_manager()
        stats = engine_module._get_json(f"{manager.engine_url()}/system_stats", timeout=5.0)
        version = stats.get("system", {}).get("pytorch_version")
        if isinstance(version, str) and version:
            same_version = current is not None and current.get("torch") == version
            current = {
                "torch": version,
                "torchvision": current.get("torchvision") if same_version and current is not None else None,
                "cuda": None,
                "updatedAt": current.get("updatedAt") if same_version and current is not None else None,
                "via": "live",
            }
            live = True
            probe = subprocess.run(
                [str(manifest.venv_python()), "-c", "import json,torch; print(json.dumps([torch.__version__,torch.backends.mps.is_available()]))"],
                capture_output=True, text=True, timeout=30, check=True,
            )
            installed_version, available = json.loads(probe.stdout.strip().splitlines()[-1])
            if installed_version == version and isinstance(available, bool):
                mps = available
    except (OSError, error.URLError, ValueError, TypeError, AttributeError, IndexError,
            subprocess.SubprocessError, engine_module.EngineOpError):
        pass
    active = engine_module.jobs.active_of("torch-upgrade")
    return {
        "mode": "local", "current": current, "live": live, "mps": mps,
        "hostMatched": True, "busy": active is not None,
        "jobId": active["id"] if active else None, "allowedTargets": list(TORCH_TV_MAP), "pinnedTarget": PINNED_TORCH,
    }


class PipStillRunning(RuntimeError):
    pass


class PipVersionMismatch(RuntimeError):
    pass


def _verify_specs(specs: list[str]) -> None:
    names, expected = zip(*(spec.split("==", 1) for spec in specs))
    expression = "import json,importlib; print(json.dumps([importlib.import_module(name).__version__ for name in " + repr(list(names)) + "]))"
    try:
        result = subprocess.run([str(manifest.venv_python()), "-c", expression], capture_output=True, text=True, timeout=60, check=True)
        actual = json.loads(result.stdout.strip().splitlines()[-1])
    except (subprocess.SubprocessError, OSError, ValueError, IndexError) as exc:
        raise PipVersionMismatch(f"pip 已退出但版本验证失败: {exc}") from exc
    if actual != list(expected):
        raise PipVersionMismatch(f"pip 已退出但版本验证失败: {actual}")


def _verify_import(version: str) -> None:
    probe = subprocess.run(
        [str(manifest.venv_python()), "-c", "import json,torch; print(json.dumps([torch.__version__,torch.backends.mps.is_available()]))"],
        capture_output=True, text=True, timeout=60, check=True,
    )
    actual, available = json.loads(probe.stdout.strip().splitlines()[-1])
    if actual != version or available is not True:
        raise RuntimeError(f"PyTorch 验证失败: {actual}, MPS={available}")


def _ensure_no_pip() -> None:
    result = subprocess.run(["ps", "-axo", "pid,args"], capture_output=True, text=True, timeout=10, check=True)
    entries = engine_module._parse_ps_pid_args(result.stdout)
    if not entries:
        raise RuntimeError("无法验证本地 pip 进程")
    executable = str(manifest.venv_python())
    if any(args.startswith(executable + " ") and re.search(r"\s-m\s+pip\s+install(?:\s|$)", args) for _, args in entries):
        raise RuntimeError("引擎环境中已有 pip 安装进程")


def _verify_recovery_import() -> None:
    subprocess.run(
        [str(manifest.venv_python()), "-c", "import torch, torchvision"],
        capture_output=True, text=True, timeout=60, check=True,
    )


def _pip_install(specs: list[str], job_id: str, *, mirror: bool = False) -> None:
    index = "https://pypi.tuna.tsinghua.edu.cn/simple" if mirror else "https://pypi.org/simple"
    command = [str(manifest.venv_python()), "-m", "pip", "install", "--no-cache-dir", *specs, "--index-url", index]
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as output:
        process = subprocess.Popen(command, stdout=output, stderr=subprocess.STDOUT)
        timed_out = False
        try:
            code = process.wait(timeout=3600)
        except subprocess.TimeoutExpired:
            timed_out = True
            engine_module.jobs.update(job_id, tail_line="pip 超时，继续监控本地进程")
            deadline = time.monotonic() + 1800
            while process.poll() is None and time.monotonic() < deadline:
                time.sleep(60)
            if process.poll() is None:
                message = "pip 监控超过 30 分钟，正在终止进程"
                engine_module.jobs.update(job_id, message=message)
                try:
                    process.kill()
                    process.wait(timeout=10)
                except (OSError, subprocess.TimeoutExpired) as exc:
                    target = next((spec.removeprefix("torch==") for spec in specs if spec.startswith("torch==")), None)
                    warning = torch_service._mark_torch_stuck(job_id, "无法确认本地 pip 已终止", mode="local", target=target)
                    message = "无法确认 pip 已终止，须人工介入"
                    raise PipStillRunning(f"{message}；{warning}" if warning else message) from exc
            code = process.returncode
        output.seek(0)
        lines = output.read().splitlines()
        for line in lines[-30:]:
            engine_module.jobs.update(job_id, tail_line=line)
        if timed_out:
            _verify_specs(specs)
        elif code:
            raise RuntimeError("pip 安装失败: " + (lines[-1] if lines else str(code)))


def _ledger(job_id: str, old: str, current: str, vision: str, *, rollback: bool) -> None:
    path = manifest.comfy_home() / "torch-upgrade.json"
    try:
        ledger = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(ledger, dict) or not isinstance(ledger.get("history", []), list):
            raise TypeError("升级账本格式无效")
    except FileNotFoundError:
        ledger = {}
    now = datetime.now(timezone.utc).isoformat()
    ledger["current"] = {"torch": current, "torchvision": vision, "cuda": None, "updatedAt": now, "via": "oneclick-local"}
    ledger.setdefault("history", []).append({"at": now, "from": old, "to": current, "ok": not rollback, "rollback": rollback, "jobId": job_id})
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(ledger, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def upgrade_engine_torch(target: str = PINNED_TORCH) -> str:
    if target not in TORCH_TV_MAP:
        raise ValueError("仅支持 " + " / ".join(TORCH_TV_MAP))
    torch_service._acquire_torch_operation(torch_service.ssh_service())
    try:
        jobs = engine_module.jobs
        if any(jobs.active_of(kind) for kind in ("torch-upgrade", "engine-update", "plugin-install")):
            raise RuntimeError("引擎或插件安装任务正在运行")
        job_id = jobs.create("torch-upgrade", "准备本地 PyTorch 升级")

        def run(active_id: str) -> None:
            try:
                _upgrade_job(active_id, target)
            finally:
                with torch_service._TORCH_RECOVERY_LOCK:
                    if torch_service._torch_any_marker():
                        torch_service._TORCH_STUCK_HELD = True
                        torch_service._TORCH_STUCK_MODE = "local"
                    elif not torch_service._TORCH_STUCK_HELD:
                        _TORCH_UPGRADE_LOCK.release()

        try:
            jobs.start(job_id, run)
        except Exception:
            jobs.update(job_id, error="升级任务启动失败")
            raise
        return job_id
    except Exception:
        _TORCH_UPGRADE_LOCK.release()
        raise


def _upgrade_job(job_id: str, target: str) -> None:
    jobs = engine_module.jobs
    manager = engine_module.engine_manager()
    old_torch = old_vision = ""
    stopped = install_started = False
    generation = None
    baseline = 0

    def progress(step: str, percent: int, message: str) -> None:
        jobs.update(job_id, step=step, progress=percent, message=message)
        with (manifest.comfy_home() / "engine-upgrade.log").open("a", encoding="utf-8") as log:
            log.write(f"{datetime.now(timezone.utc).isoformat()} {job_id} {step}: {message}\n")

    def http(path: str) -> dict:
        result = engine_module._get_json(f"{manager.engine_url()}{path}", timeout=20.0)
        if not isinstance(result, dict):
            raise TypeError(f"{path} 返回无效数据")
        return result

    def smoke(version: str) -> None:
        stats = http("/system_stats")
        if stats.get("system", {}).get("pytorch_version") != version or not stats.get("devices"):
            raise RuntimeError("引擎版本或设备验证失败")
        if len(http("/object_info")) < max(1, baseline * 0.95):
            raise RuntimeError("节点数量低于升级前基线的 95%")

    try:
        progress("preflight", 5, "检查本地引擎和磁盘")
        _ensure_no_pip()
        if not manager.is_healthy():
            manager.start_sync()
        queue = http("/queue")
        if queue.get("queue_running") != [] or queue.get("queue_pending") != []:
            raise RuntimeError("引擎队列非空或不可验证")
        baseline = len(http("/object_info"))
        if baseline == 0 or shutil.disk_usage(manifest.comfy_home()).free < 15 * 1024 ** 3:
            raise RuntimeError("节点基线为空或可用空间不足 15 GiB")
        progress("snapshot", 10, "快照已安装版本")
        old_torch, old_vision = snapshot_installed_packages(job_id)
        progress("stop-engine", 15, "停止本地引擎")
        generation, stopped = manager._stop_managed_process()
        remaining = engine_module._engine_home_processes()
        if not stopped or manager.is_healthy() or remaining is None or remaining:
            raise RuntimeError("本地引擎仍在运行，拒绝安装")
        progress("install", 15, "安装 PyTorch 和 torchvision")
        torch_service._write_torch_in_progress(job_id, mode="local", target=target)
        install_started = True
        specs = [f"torch=={target}", f"torchvision=={TORCH_TV_MAP[target]}"]
        try:
            _pip_install(specs, job_id)
        except (PipStillRunning, PipVersionMismatch):
            raise
        except RuntimeError:
            _pip_install(specs, job_id, mirror=True)
        progress("verify-import", 85, "验证版本和 MPS")
        _verify_import(target)
        progress("restart", 90, "重启本地引擎")
        manager.start_sync(expected_generation=generation, allow_adoption=False)
        progress("smoke", 95, "验证引擎和节点")
        smoke(target)
        progress("ledger", 99, "记录升级结果")
        _ledger(job_id, old_torch, target, TORCH_TV_MAP[target], rollback=False)
        torch_service._torch_clear_markers()
        jobs.update(job_id, message="升级完成，引擎已重启", result={"from": old_torch, "to": target})
    except Exception as exc:
        message = str(exc)
        result = {"from": old_torch, "to": target, "pipError": message}
        if stopped and not isinstance(exc, PipStillRunning):
            try:
                if install_started:
                    with manager._lock:
                        if manager._stop_generation != generation:
                            raise RuntimeError("引擎已收到新的停止请求，拒绝自动重启")
                    generation, stopped_again = manager._stop_managed_process()
                    remaining = engine_module._engine_home_processes()
                    if not stopped_again or manager.is_healthy() or remaining is None or remaining:
                        raise RuntimeError("回滚前无法停止引擎")
                    _pip_install([f"torch=={old_torch}", f"torchvision=={old_vision}"], job_id)
                    _verify_import(old_torch)
                manager.start_sync(expected_generation=generation, allow_adoption=False)
                smoke(old_torch)
                if install_started:
                    _ledger(job_id, target, old_torch, old_vision, rollback=True)
                    torch_service._torch_clear_markers()
                    message += f"；已回滚至 {old_torch}"
                else:
                    message += "；引擎已恢复"
                result["rollback"] = True
            except Exception as rollback_error:
                message += f"；回滚失败，引擎可能离线，须人工介入: {rollback_error}"
                result["rollback"] = False
        try:
            with (manifest.comfy_home() / "engine-upgrade.log").open("a", encoding="utf-8") as log:
                log.write(f"{datetime.now(timezone.utc).isoformat()} {job_id} error: {message}\n")
        except OSError:
            pass
        jobs.update(job_id, message=message, error=message, result=result, complete=False)
