import base64
import hashlib
import json
import re
import sys
import threading
from pathlib import Path
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comfyui import engine_manager, manifest
from engines.image_engine import comfyui_bridge
from remote_ssh import service


@pytest.fixture(autouse=True)
def isolated_home(monkeypatch, tmp_path):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path))


@pytest.fixture
def setup_job(monkeypatch, tmp_path):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    instance = service.SSHService()
    freeze = "torch==2.11.0+cu128\ntorchvision==0.26.0+cu128\ntorchaudio==2.11.0+cu128"
    state = {"queue": {"queue_pending": [], "queue_running": []}, "free": str(20 * 1024 ** 3), "install_errors": [], "stats_version": "2.11.0+cu128", "ta_version": "2.11.0+cu128"}
    instance.status = lambda: {"connected": True}
    instance.sftp_read_text = lambda path: freeze

    def command(script, timeout_s=30):
        if "IndexOf" in script:
            return "0"
        if "SizeRemaining" in script:
            return state["free"]
        if "nvidia-smi" in script:
            return "CUDA Version: 13.2"
        if "pip freeze" in script:
            return hashlib.sha256(freeze.encode()).hexdigest()
        if "importlib.metadata" in script:
            return state["ta_version"]
        if "torch.cuda.is_available" in script:
            # 1107 补:torchaudio 三件套验证探针(torch 版本/cuda 可用/torchaudio 版本)
            return "2.14.1+cu132\nTrue\n2.11.1+cu132"
        return ""

    def http(path, timeout_s=20):
        if path == "/queue":
            return state["queue"]
        if path == "/object_info":
            return {"nodeCount": 1}
        return {"system": {"pytorch_version": state["stats_version"]}, "devices": [{}]}

    def install(specs, channel, job_id, *, allow_mirror=True):
        if state["install_errors"]:
            error = state["install_errors"].pop(0)
            if error:
                raise RuntimeError(error)

    instance._torch_command = command
    instance._torch_http = http
    instance._torch_stop_engine = Mock()
    instance._torch_install = Mock(side_effect=install)
    instance._torch_restart = Mock(return_value={"system": {"pytorch_version": "2.14.1+cu132"}, "devices": [{}]})
    instance._torch_write_ledger = Mock()
    job_id = registry.create("torch-upgrade")
    return instance, registry, job_id, state, tmp_path


def test_success(setup_job):
    instance, registry, job_id, _, home = setup_job
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    job = registry.get(job_id)
    assert job["status"] == "complete"
    assert job["result"]["from"] == "2.11.0+cu128"
    assert list((home / "torch-upgrade-backup").glob("rollback-*.txt"))
    assert instance._torch_write_ledger.call_count == 1


def test_remote_in_progress_lifecycle_and_host(setup_job):
    instance, registry, job_id, _, _ = setup_job
    marker = service._torch_stuck_marker()
    def install(*_args, **_kwargs):
        data = json.loads(marker.read_text())
        assert data["state"] == "in-progress" and data["host"] == "example"
        assert data["mode"] == "remote" and data["jobId"] == job_id
    instance._torch_install.side_effect = install
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132", "example")
    assert registry.get(job_id)["status"] == "complete"
    assert not marker.exists()


def test_remote_in_progress_write_failure_never_starts_pip(setup_job, monkeypatch):
    instance, registry, job_id, _, _ = setup_job
    instance._torch_restart.return_value = {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]}
    monkeypatch.setattr(service, "_write_torch_in_progress", Mock(side_effect=RuntimeError("marker failed")))
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132", "example")
    assert registry.get(job_id)["status"] == "error"
    instance._torch_install.assert_not_called()
    instance._torch_restart.assert_called_once()


def test_remote_primary_marker_failure_keeps_fallback_without_pip(setup_job, monkeypatch):
    instance, registry, job_id, _, home = setup_job
    blocked = home / "blocked"
    blocked.write_text("not a directory")
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: blocked / "stuck.json")
    instance._torch_restart.return_value = {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]}
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132", "example")
    assert registry.get(job_id)["status"] == "error"
    instance._torch_install.assert_not_called()
    record = json.loads(service._torch_fallback_marker().read_text())
    assert record["target"] == "2.14.1+cu132" and record["host"] == "example"


def test_remote_fallback_survives_restart_and_primary_recovery(setup_job, monkeypatch):
    instance, registry, job_id, _, home = setup_job
    blocked = home / "blocked"
    blocked.write_text("not a directory")
    primary = {"path": blocked / "stuck.json"}
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: primary["path"])
    instance._torch_restart.return_value = {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]}
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132", "example")
    registry.update(job_id, error="finished")
    fallback = service._torch_fallback_marker()
    original = fallback.read_bytes()
    primary["path"] = home / "restored" / "stuck.json"
    instance._connected_host = "example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    instance._torch_remote_pip_running = Mock(return_value=False)
    instance._torch_verify_recovery_import = Mock(side_effect=RuntimeError("version mismatch"))
    with pytest.raises(RuntimeError, match="无法核实"):
        instance.upgrade_engine_torch("2.14.1")
    instance._torch_verify_recovery_import.assert_called_once_with("2.14.1+cu132")
    assert fallback.read_bytes() == original
    assert not primary["path"].exists()


@pytest.mark.parametrize("blocked_path", ["primary", "fallback"])
def test_remote_marker_preflight_checks_both_paths_before_stopping(setup_job, monkeypatch, blocked_path):
    instance, registry, job_id, _, home = setup_job
    registry.update(job_id, error="finished")
    blocked = home / "blocked"
    blocked.write_text("not a directory")
    marker_name = "_torch_stuck_marker" if blocked_path == "primary" else "_torch_fallback_marker"
    monkeypatch.setattr(service, marker_name, lambda: blocked / "stuck.json")
    with pytest.raises(RuntimeError, match="异常标记路径不可写"):
        instance.upgrade_engine_torch("2.14.1")
    instance._torch_stop_engine.assert_not_called()


@pytest.mark.parametrize("blocked_path", ["primary", "fallback"])
def test_sync_marker_preflight_checks_both_paths_before_stopping(setup_job, monkeypatch, blocked_path):
    instance, registry, job_id, _, home = setup_job
    registry.update(job_id, error="finished")
    blocked = home / "blocked"
    blocked.write_text("not a directory")
    marker_name = "_torch_stuck_marker" if blocked_path == "primary" else "_torch_fallback_marker"
    monkeypatch.setattr(service, marker_name, lambda: blocked / "stuck.json")
    with pytest.raises(RuntimeError, match="异常标记路径不可写"):
        instance.sync_engine([])
    instance._torch_stop_engine.assert_not_called()


@pytest.mark.parametrize("conflict", ["host", "mode", "missing"])
def test_in_memory_disk_conflict_preserves_both_markers(monkeypatch, tmp_path, conflict):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    record = {"host": "disk-host", "mode": "remote", "jobId": "job", "at": "now", "target": "2.14.1+cu132", "kind": "stuck", "state": "stuck", "reason": "test"}
    if conflict == "missing":
        record.pop("at")
    markers = (service._torch_stuck_marker(), service._torch_fallback_marker())
    for marker in markers:
        marker.parent.mkdir(parents=True)
        marker.write_text(json.dumps(record))
    originals = [marker.read_bytes() for marker in markers]
    monkeypatch.setattr(service, "_TORCH_STUCK_HELD", True)
    monkeypatch.setattr(service, "_TORCH_STUCK_MODE", "local" if conflict == "mode" else "remote")
    monkeypatch.setattr(service, "_TORCH_STUCK_HOST", "other-host" if conflict == "host" else "disk-host")
    with pytest.raises(RuntimeError, match="跨主机/状态冲突"):
        service._acquire_torch_operation(service.SSHService())
    assert [marker.read_bytes() for marker in markers] == originals


@pytest.mark.parametrize("case", ["state", "blank-target"])
def test_disk_markers_reject_record_conflicts_and_blank_target(monkeypatch, tmp_path, case):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    record = {"host": "example", "mode": "remote", "jobId": "job", "at": "now",
              "target": "   " if case == "blank-target" else "2.14.1+cu132", "state": "in-progress", "kind": "in-progress", "reason": "test"}
    markers = (service._torch_stuck_marker(), service._torch_fallback_marker())
    for index, marker in enumerate(markers):
        marker.parent.mkdir(parents=True)
        marker.write_text(json.dumps({**record, "state": "stuck" if case == "state" and index else "in-progress"}))
    originals = [marker.read_bytes() for marker in markers]
    with pytest.raises(RuntimeError, match="跨主机/状态冲突" if case == "state" else "缺少目标版本"):
        service._acquire_torch_operation(service.SSHService())
    assert [marker.read_bytes() for marker in markers] == originals


@pytest.mark.parametrize("field,value", [(field, value) for field in ("state", "kind", "reason") for value in (None, "   ", 42)] + [("state", "invalid"), ("kind", "invalid")])
def test_incomplete_marker_fields_preserve_both_markers(monkeypatch, tmp_path, field, value):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    service._write_torch_in_progress("job", mode="remote", host="example", target="2.14.1+cu132")
    markers = (service._torch_stuck_marker(), service._torch_fallback_marker())
    record = json.loads(markers[0].read_text())
    if value is None:
        record.pop(field)
    else:
        record[field] = value
    for marker in markers:
        marker.write_text(json.dumps(record))
    originals = [marker.read_bytes() for marker in markers]
    with pytest.raises(RuntimeError, match="跨主机/状态冲突"):
        service._acquire_torch_operation(service.SSHService())
    assert [marker.read_bytes() for marker in markers] == originals


def test_fallback_only_recovers_after_successful_probes(setup_job, monkeypatch):
    instance, registry, job_id, _, _ = setup_job
    registry.update(job_id, error="finished")
    fallback = service._torch_fallback_marker()
    fallback.parent.mkdir(parents=True)
    fallback.write_text(json.dumps({"host": "example", "mode": "remote", "jobId": "job", "at": "now",
                                    "target": "2.14.1+cu132", "state": "stuck", "kind": "stuck", "reason": "test"}))
    instance._connected_host = "example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    instance._torch_remote_pip_running = Mock(return_value=False)
    instance._torch_verify_recovery_import = Mock()
    monkeypatch.setattr(service, "_scan_mac_git_packages", dict)
    monkeypatch.setattr(service, "load_engine_sync_doc", lambda: {"plugins": []})
    monkeypatch.setattr(service, "merge_mac_scan_into_doc", lambda doc, scan: (doc, False))
    instance._win_custom_nodes_names = lambda: set()
    assert instance.sync_engine([]) == {"items": []}
    instance._torch_verify_recovery_import.assert_called_once_with("2.14.1+cu132")
    assert not fallback.exists() and not service._torch_stuck_marker().exists()
    assert service._TORCH_UPGRADE_LOCK.acquire(blocking=False)
    service._TORCH_UPGRADE_LOCK.release()


@pytest.mark.parametrize("failure", ["queue", "disk"])
def test_preflight_refuses(setup_job, failure):
    instance, registry, job_id, state, _ = setup_job
    if failure == "queue":
        state["queue"]["queue_running"] = ["task"]
    else:
        state["free"] = "0"
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert registry.get(job_id)["status"] == "error"
    instance._torch_stop_engine.assert_not_called()
    instance._torch_install.assert_not_called()


@pytest.mark.parametrize("rollback_fails", [False, True])
def test_install_failure_rolls_back(setup_job, rollback_fails):
    instance, registry, job_id, state, _ = setup_job
    state["install_errors"] = ["install failed", "rollback failed" if rollback_fails else None]
    instance._torch_restart.return_value = {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]}
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    job = registry.get(job_id)
    assert job["status"] == "error"
    assert ("回滚失败" if rollback_fails else "已回滚至 2.11.0+cu128") in job["message"]
    assert instance._torch_install.call_args_list[1].args[1] == "cu128"
    if not rollback_fails:
        # 1107 补:torchaudio 按自身 CUDA 通道单独回滚(混装态各走各的 index)
        assert instance._torch_install.call_args_list[2].args[0] == ["torchaudio==2.11.0+cu128"]
        assert instance._torch_install.call_args_list[2].args[1] == "cu128"
    assert service._torch_stuck_marker().exists() is rollback_fails


def test_skip_when_torch_and_torchaudio_both_latest(setup_job):
    instance, registry, job_id, state, _ = setup_job
    state["stats_version"] = "2.14.1+cu132"
    state["ta_version"] = "2.11.1+cu132"
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    job = registry.get(job_id)
    assert job["status"] == "complete" and "跳过升级" in job["message"]
    instance._torch_install.assert_not_called()


def test_torchaudio_stale_runs_full_upgrade(setup_job):
    # 1107 事故回放:引擎 torch 已达标(2.14.1+cu132)但 torchaudio 残留 cu128 →
    # skip-if-latest 不得放行,须跑全链补装三件套(pip 对已满足 pin 不重下,仅补 ~2MB)
    instance, registry, job_id, state, _ = setup_job
    state["stats_version"] = "2.14.1+cu132"
    state["ta_version"] = "2.11.0+cu128"
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert registry.get(job_id)["status"] == "complete"
    specs = instance._torch_install.call_args_list[0].args[0]
    assert specs == ["torch==2.14.1+cu132", "torchvision==0.29.1+cu132", "torchaudio==2.11.1+cu132"]


def test_stop_pattern_excludes_myssia():
    assert re.search(service._TORCH_KILL_PATTERN, r"E:\comfyui\ComfyUI\main.py", re.IGNORECASE)
    assert not re.search(service._TORCH_KILL_PATTERN, r"E:\myssia\main.py", re.IGNORECASE)


def test_stop_command_matches_only_engine_samples():
    instance = service.SSHService()
    instance._torch_command = Mock()
    instance._torch_stop_engine()
    command = instance._torch_command.call_args.args[0]
    match = re.search(r"CommandLine -match '([^']+)'", command)
    assert match is not None
    pattern = match.group(1)
    def matches(command_line):
        return bool(re.search(pattern, command_line, re.IGNORECASE))
    assert not matches(r"D:\myssia\python\pythonw.exe -X utf8 D:\myssia\remote\win_keeper.py")
    assert not matches(r"D:\Python312\python.exe -m pip install torch")
    assert matches(r"E:\IP\app\comfyui\venv\Scripts\python.exe E:/IP/漫影工作室/comfyui/ComfyUI/main.py")


def test_mirror_install_falls_back_to_official(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    instance = service.SSHService()
    instance.run_remote_command = Mock(side_effect=[(1, "failed"), (0, "done")])
    instance._torch_install(["torch==2.14.1+cu132"], "cu132", registry.create("torch-upgrade"))
    assert instance.run_remote_command.call_count == 2
    scripts = [base64.b64decode(call.args[0].split()[-1]).decode("utf-16le") for call in instance.run_remote_command.call_args_list]
    # 1107 终裁:交大(.cn Clash 直连不被篡改)首选,官方源兜底;阿里无 cu132 已除名
    assert "https://mirror.sjtu.edu.cn/pytorch-wheels/cu132" in scripts[0]
    assert "https://download.pytorch.org/whl/cu132" in scripts[1]
    assert all("PYTHONUTF8" in script for script in scripts)


def test_unknown_job_retains_lock_and_blocks_sync(setup_job, monkeypatch):
    instance, registry, previous_id, _, _ = setup_job
    registry.update(previous_id, error="finished")
    instance._client = object()
    instance._connected = True
    instance._connected_host = "example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    instance._torch_install = service.SSHService._torch_install.__get__(instance)
    instance._torch_remote_pip_running = Mock(side_effect=[False, True, True])
    def remote_command(_command, _timeout):
        if not getattr(remote_command, "timed_out", False):
            remote_command.timed_out = True
            try:
                raise TimeoutError("timeout")
            except TimeoutError as exc:
                raise service.SSHServiceError("timeout") from exc
        return 0, "running"
    instance.run_remote_command = remote_command
    monkeypatch.setattr(service, "time", Mock(monotonic=Mock(side_effect=[0, 1801])))
    try:
        job_id = instance.upgrade_engine_torch("2.14.1")
        assert registry.get(job_id)["status"] == "error"
        assert not service._TORCH_UPGRADE_LOCK.acquire(timeout=1)
        with pytest.raises(RuntimeError, match="引擎同步已让路"):
            instance.sync_engine([])
    finally:
        if service._TORCH_UPGRADE_LOCK.locked():
            service._TORCH_UPGRADE_LOCK.release()
        service._TORCH_STUCK_HELD = False


@pytest.mark.parametrize("restart,marker_present,running", [
    (False, True, False), (False, True, True),
    (True, True, False), (True, True, True),
    (True, False, False), (True, False, True),
])
def test_stuck_recovery_and_restart_guard(setup_job, monkeypatch, restart, marker_present, running):
    instance, registry, previous_id, _, home = setup_job
    registry.update(previous_id, error="finished")
    instance._client, instance._connected, instance._connected_host = object(), True, "example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    def unknown(job_id, *_args):
        registry.update(job_id, error="pip 状态未知")
        return True
    instance._torch_upgrade_job = unknown
    instance.upgrade_engine_torch("2.14.1")
    marker = home / "torch-upgrade-backup" / "stuck.json"
    assert marker.is_file()
    if restart:
        service._TORCH_UPGRADE_LOCK.release()
        service._TORCH_STUCK_HELD = False
    if not marker_present:
        marker.unlink()
    instance._torch_remote_pip_running = Mock(return_value=running)
    instance._torch_verify_recovery_import = Mock()
    monkeypatch.setattr(service, "_scan_mac_git_packages", dict)
    monkeypatch.setattr(service, "load_engine_sync_doc", lambda: {"plugins": []})
    monkeypatch.setattr(service, "merge_mac_scan_into_doc", lambda doc, scan: (doc, False))
    instance._win_custom_nodes_names = lambda: set()
    try:
        if running:
            with pytest.raises(RuntimeError, match="远端 pip 仍在运行"):
                instance.sync_engine([])
            assert marker.exists() == marker_present
        else:
            assert instance.sync_engine([]) == {"items": []}
            assert not marker.exists()
    finally:
        if service._TORCH_STUCK_HELD:
            service._TORCH_UPGRADE_LOCK.release()
            service._TORCH_STUCK_HELD = False


def test_stuck_recovery_fails_closed_when_probe_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    marker = tmp_path / "torch-upgrade-backup" / "stuck.json"
    marker.parent.mkdir()
    marker.write_text(json.dumps({"host": "example", "mode": "remote", "target": "2.14.1+cu132", "jobId": "job", "at": "now", "kind": "stuck", "state": "stuck", "reason": "test"}))
    instance = service.SSHService()
    instance._connected_host = "example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    instance._torch_remote_pip_running = Mock(side_effect=service.SSHServiceError("offline"))
    with pytest.raises(RuntimeError, match="无法核实远端 pip 状态"):
        instance.sync_engine([])
    assert marker.exists()


@pytest.mark.parametrize("probe", [(1, "import failed"), service.SSHServiceError("offline"), TimeoutError("timeout")])
def test_remote_recovery_requires_successful_import(monkeypatch, tmp_path, probe):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    marker = tmp_path / "torch-upgrade-backup" / "stuck.json"
    marker.parent.mkdir()
    marker.write_text(json.dumps({"host": "example", "mode": "remote", "target": "2.14.1+cu132", "jobId": "job", "at": "now", "kind": "stuck", "state": "stuck", "reason": "test"}))
    instance = service.SSHService()
    instance._connected_host = "example"
    instance._torch_remote_pip_running = Mock(return_value=False)
    instance.run_remote_command = Mock(side_effect=probe if isinstance(probe, Exception) else None, return_value=probe)
    service._TORCH_UPGRADE_LOCK.acquire()
    monkeypatch.setattr(service, "_TORCH_STUCK_HELD", True)
    monkeypatch.setattr(service, "_TORCH_STUCK_MODE", "remote")
    monkeypatch.setattr(service, "_TORCH_STUCK_HOST", "example")
    try:
        with pytest.raises(RuntimeError, match="无法核实远端 pip 状态"):
            instance.sync_engine([])
        assert marker.exists()
        assert service._TORCH_STUCK_HELD
        assert service._TORCH_UPGRADE_LOCK.locked()
        command = instance.run_remote_command.call_args.args[0]
        script = base64.b64decode(command.split()[-1]).decode("utf-16le")
        assert "import torch, torchvision" in script
    finally:
        service._TORCH_UPGRADE_LOCK.release()
        service._TORCH_STUCK_HELD = False


def test_remote_marker_write_failure_is_visible_and_keeps_lock(monkeypatch, tmp_path):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("block")
    marker_path = {"value": tmp_path / "writable" / "stuck.json"}
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: marker_path["value"])
    instance = service.SSHService()
    instance._client, instance._connected, instance._connected_host = object(), True, "example"
    def unknown(job_id, *_args):
        marker_path["value"] = blocked / "stuck.json"
        registry.update(job_id, error="原始 pip 错误", message="原始 pip 错误")
        return True
    instance._torch_upgrade_job = unknown
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    try:
        job = registry.get(instance.upgrade_engine_torch("2.14.1"))
        assert job["status"] == "error"
        assert "原始 pip 错误" in job["message"]
        assert "备用标记" in job["message"]
        assert service._TORCH_STUCK_HELD and service._TORCH_UPGRADE_LOCK.locked()
    finally:
        service._TORCH_UPGRADE_LOCK.release()
        service._TORCH_STUCK_HELD = False
    with pytest.raises(RuntimeError, match="无法核实"):
        instance.upgrade_engine_torch("2.14.1")


def test_stuck_recovery_refuses_different_ssh_host(monkeypatch, tmp_path):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    marker = tmp_path / "torch-upgrade-backup" / "stuck.json"
    marker.parent.mkdir()
    marker.write_text(json.dumps({"host": "original", "mode": "remote", "state": "in-progress", "kind": "in-progress", "reason": "test", "target": "2.14.1+cu132", "jobId": "job", "at": "now"}))
    instance = service.SSHService()
    instance._connected_host = "different"
    instance._torch_remote_pip_running = Mock(return_value=False)
    with pytest.raises(RuntimeError, match="无法核实远端 pip 状态"):
        instance.sync_engine([])
    instance._torch_remote_pip_running.assert_not_called()
    assert marker.exists()


def test_fallback_after_restart_refuses_different_ssh_host(monkeypatch, tmp_path):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "different"})
    marker = service._torch_fallback_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"host": "original", "mode": "remote", "target": "2.14.1+cu132", "kind": "stuck", "state": "stuck", "reason": "test", "jobId": "job", "at": "now"}))
    instance = service.SSHService()
    instance._connected_host = "different"
    instance._torch_remote_pip_running = Mock(return_value=False)
    with pytest.raises(RuntimeError, match="无法核实远端 pip 状态"):
        instance.sync_engine([])
    instance._torch_remote_pip_running.assert_not_called()
    assert marker.exists()


def test_in_memory_stuck_recovery_refuses_different_ssh_host(monkeypatch):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(service, "_TORCH_STUCK_HELD", True)
    monkeypatch.setattr(service, "_TORCH_STUCK_MODE", "remote")
    monkeypatch.setattr(service, "_TORCH_STUCK_HOST", "original")
    instance = service.SSHService()
    instance._connected_host = "different"
    instance._torch_remote_pip_running = Mock(return_value=False)
    assert service._TORCH_UPGRADE_LOCK.acquire(blocking=False)
    try:
        with pytest.raises(RuntimeError, match="无法核实远端 pip 状态"):
            instance.sync_engine([])
        instance._torch_remote_pip_running.assert_not_called()
        assert service._TORCH_UPGRADE_LOCK.locked()
    finally:
        service._TORCH_UPGRADE_LOCK.release()


@pytest.mark.parametrize("running", [True, False])
def test_upgrade_entry_recovers_stuck_marker(monkeypatch, tmp_path, running):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "example"})
    marker = tmp_path / "torch-upgrade-backup" / "stuck.json"
    marker.parent.mkdir()
    marker.write_text(json.dumps({"host": "example", "mode": "remote", "state": "in-progress", "target": "2.14.1+cu132", "jobId": "job", "at": "now", "kind": "in-progress", "reason": "test"}))
    instance = service.SSHService()
    instance._client, instance._connected, instance._connected_host = object(), True, "example"
    instance._torch_remote_pip_running = Mock(return_value=running)
    instance._torch_verify_recovery_import = Mock()
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    def finish(job_id, *_args):
        registry.update(job_id, error="test complete")
        return False
    instance._torch_upgrade_job = finish
    if running:
        with pytest.raises(RuntimeError, match="远端 pip 仍在运行"):
            instance.upgrade_engine_torch("2.14.1")
        assert marker.exists()
    else:
        instance.upgrade_engine_torch("2.14.1")
        assert not marker.exists()


@pytest.mark.parametrize("code", [None, -1])
def test_pip_probe_rejects_unknown_exit_code(code):
    instance = service.SSHService()
    instance.run_remote_command = Mock(return_value=(code, "0"))
    with pytest.raises(RuntimeError):
        instance._torch_remote_pip_running()


@pytest.mark.parametrize("after,expected", [(1, "error"), (190, "complete")])
def test_remote_smoke_respects_node_baseline(setup_job, monkeypatch, after, expected):
    instance, registry, job_id, _, _ = setup_job
    monkeypatch.setattr(service.time, "sleep", lambda seconds: None)  # 烟测重试 5×30s 免真睡
    original_http = instance._torch_http
    counts = iter([200, after] + [200] * 5)
    instance._torch_http = lambda path, timeout_s=20: {"nodeCount": next(counts)} if path == "/object_info" else original_http(path, timeout_s)
    instance._torch_restart.side_effect = [
        {"system": {"pytorch_version": "2.14.1+cu132"}, "devices": [{}]},
        {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]},
    ]
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert registry.get(job_id)["status"] == expected
    if expected == "error":
        assert "已回滚至" in registry.get(job_id)["message"]


def test_remote_snapshot_requires_torchvision_before_stop(setup_job):
    instance, registry, job_id, _, _ = setup_job
    freeze = "torch==2.11.0+cu128"
    original_command = instance._torch_command
    instance.sftp_read_text = lambda _: freeze
    instance._torch_command = lambda script, timeout_s=30: hashlib.sha256(freeze.encode()).hexdigest() if "pip freeze" in script else original_command(script, timeout_s)
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    job = registry.get(job_id)
    assert job["step"] == "snapshot" and "torchvision pin" in job["message"]
    assert not job["result"]["rollback"]
    instance._torch_stop_engine.assert_not_called()


def test_rollback_uses_direct_mirror_only(setup_job):
    instance, registry, job_id, _, _ = setup_job
    real_install = service.SSHService._torch_install.__get__(instance)
    instance.run_remote_command = Mock(return_value=(1, "offline"))
    def install(specs, channel, active_id, *, allow_mirror=True):
        if allow_mirror:
            raise RuntimeError("forward failed")
        return real_install(specs, channel, active_id, allow_mirror=allow_mirror)
    instance._torch_install.side_effect = install
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert "回滚失败" in registry.get(job_id)["message"]
    assert instance.run_remote_command.call_count == 1
    script = base64.b64decode(instance.run_remote_command.call_args.args[0].split()[-1]).decode("utf-16le")
    # 1107 终裁:回滚单源=交大直连(allow_mirror=False 不再兜官方;官方域名走 Clash 代理有篡改雷)
    assert "https://mirror.sjtu.edu.cn/pytorch-wheels/cu128" in script and "download.pytorch.org" not in script


def test_upgrade_lock_blocks_engine_and_plugin_job_creation(monkeypatch):
    from comfyui import plugin_manager

    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(plugin_manager, "jobs", registry)
    create = Mock(wraps=registry.create)
    monkeypatch.setattr(registry, "create", create)
    with service._TORCH_UPGRADE_LOCK:
        with pytest.raises(engine_manager.EngineOpError, match="暂停引擎更新"):
            engine_manager.EngineManager().update_job()
        with pytest.raises(engine_manager.EngineOpError, match="暂停插件安装"):
            plugin_manager.install_plugin_job("git", "example")
    create.assert_not_called()


def test_engine_and_plugin_jobs_start_when_upgrade_lock_idle(monkeypatch):
    from comfyui import plugin_manager

    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(plugin_manager, "jobs", registry)
    monkeypatch.setattr(registry, "start", Mock())
    monkeypatch.setattr(manifest, "engine_installed", lambda: True)
    monkeypatch.setattr(manifest, "load_manifest", lambda: {"engine": {"sha": "old"}})
    monkeypatch.setattr(manifest, "plugin_ledger", dict)
    monkeypatch.setattr(plugin_manager, "_resolve_plan", lambda source, ref: {"dirName": "node", "source": source})
    manager = engine_manager.EngineManager()
    manager._last_check = {"headSha": "new", "latest": "v1"}
    monkeypatch.setattr(manager, "_local_engine_sha", lambda _: "old")
    update_id = manager.update_job()
    plugin_id = plugin_manager.install_plugin_job("git", "example")["jobId"]
    assert registry.get(update_id)["kind"] == "engine-update"
    assert registry.get(plugin_id)["kind"] == "plugin-install"


def test_unknown_pip_state_never_starts_rollback(setup_job):
    instance, registry, job_id, _, _ = setup_job
    instance._torch_install.side_effect = service.TorchInstallUnknownError("connection lost")
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert "回滚未执行" in registry.get(job_id)["message"]
    assert instance._torch_install.call_count == 1


def test_session_switch_cannot_run_command():
    instance = service.SSHService()
    instance._client = object()
    instance._connected = True
    service._TORCH_SESSION.client = object()
    try:
        with pytest.raises(service.SSHServiceError, match="会话已改变"):
            instance._torch_command("Write-Output ok")
    finally:
        del service._TORCH_SESSION.client


def test_command_rejects_session_switch_before_exec():
    instance = service.SSHService()
    client = Mock()
    instance._client = client
    instance._connected = True
    service._TORCH_SESSION.client = object()
    try:
        with pytest.raises(service.SSHServiceError, match="会话已改变"):
            instance.run_remote_command("echo hello")
        client.exec_command.assert_not_called()
    finally:
        del service._TORCH_SESSION.client


def test_guard_detects_session_switch_after_command():
    instance = service.SSHService()
    instance._client = object()
    instance._connected = True
    service._TORCH_SESSION.client = instance._client
    try:
        with pytest.raises(service.SSHServiceError, match="会话已改变"), instance._torch_session_guard():
            instance._client = object()
    finally:
        del service._TORCH_SESSION.client


def test_active_job_is_single_flight(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    registry.create("torch-upgrade")
    with pytest.raises(RuntimeError, match="已在运行"):
        service.SSHService().upgrade_engine_torch("2.14.1")


@pytest.mark.parametrize("kind", ["engine-update", "plugin-install"])
def test_upgrade_rejects_active_venv_job(monkeypatch, kind):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    registry.create(kind)
    with pytest.raises(RuntimeError, match="引擎更新或插件安装"):
        service.SSHService().upgrade_engine_torch("2.14.1")
    assert not service._TORCH_UPGRADE_LOCK.locked()
    assert registry.active_of("torch-upgrade") is None


def test_service_rejects_target_outside_whitelist(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    with pytest.raises(ValueError, match="仅支持") as error:
        service.SSHService().upgrade_engine_torch("9.9.9")
    assert all(version in str(error.value) for version in service.TORCH_TV_MAP)
    assert registry.active_of("torch-upgrade") is None


def test_connection_host_must_match_accepted_engine(monkeypatch):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "other.example"})
    instance = service.SSHService()
    instance._client = object()
    instance._connected = True
    instance._connected_host = "other.example"
    with pytest.raises(RuntimeError, match="主机不一致"):
        instance.upgrade_engine_torch("2.14.1", expected_host="engine.example")


def test_snapshot_hash_mismatch_does_not_stop_engine(setup_job):
    instance, registry, job_id, _, _ = setup_job
    instance.sftp_read_text = lambda path: "modified"
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert "快照回拷校验失败" in registry.get(job_id)["message"]
    instance._torch_stop_engine.assert_not_called()


def test_live_info_does_not_reuse_stale_ledger_versions(monkeypatch):
    instance = service.SSHService()
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine.example"})
    instance._connected = True
    instance._connected_host = "engine.example"
    instance.sftp_read_text = lambda path: json.dumps({"current": {"torch": "2.11.0+cu128", "torchvision": "0.26.0+cu128", "cuda": "12.8"}})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://engine.example:17000")
    monkeypatch.setattr(comfyui_bridge, "_http_json", lambda *args, **kwargs: {"system": {"pytorch_version": "2.14.1+cu132"}})
    current = instance.get_engine_torch_info(expected_host="engine.example")["current"]
    assert current["cuda"] == "13.2"
    assert current["torchvision"] is None
    assert current["source"] == "system_stats"


@pytest.mark.parametrize("exit_code", [-1, None])
def test_unknown_exit_does_not_retry_or_rollback(setup_job, exit_code):
    instance, registry, job_id, _, _ = setup_job
    instance._torch_install = service.SSHService._torch_install.__get__(instance)
    instance.run_remote_command = Mock(return_value=(exit_code, "connection lost"))
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert instance.run_remote_command.call_count == 1
    assert registry.get(job_id)["status"] == "error"
    assert "人工" in registry.get(job_id)["message"]


def test_install_does_not_block_status_or_single_flight(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine.example"})
    instance = service.SSHService()
    instance._recover_start = Mock()
    instance._client = object()
    instance._connected = True
    instance._connected_host = "engine.example"
    entered, release, checked = threading.Event(), threading.Event(), threading.Event()
    def command(*args):
        entered.set()
        assert release.wait(3)
        return 0, "done"
    instance.run_remote_command = command
    job_id = registry.create("torch-upgrade")
    def install():
        service._TORCH_SESSION.client = instance._client
        try:
            instance._torch_install(["torch==2.14.1+cu132"], "cu132", job_id)
        finally:
            del service._TORCH_SESSION.client
    worker = threading.Thread(target=install, daemon=True)
    worker.start()
    assert entered.wait(1)
    results = []
    def check():
        results.append(instance.status()["connected"])
        try:
            instance.upgrade_engine_torch("2.14.1")
        except RuntimeError as exc:
            results.append(str(exc))
        checked.set()
    threading.Thread(target=check, daemon=True).start()
    try:
        assert checked.wait(1)
        assert results[0] is True and "已在运行" in results[1]
    finally:
        release.set()
        worker.join(2)


def test_info_host_mismatch_rejects_other_hosts_ledger_and_exposes_job(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "other.example"})
    instance = service.SSHService()
    instance._connected = True
    instance._connected_host = "other.example"
    instance.sftp_read_text = Mock(return_value=json.dumps({"current": {"torch": "old"}}))
    instance._torch_http = Mock()
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://other.example:17000")
    job_id = registry.create("torch-upgrade", mode="remote", origin_host="engine.example")
    monkeypatch.setattr(service, "_REMOTE_TORCH_JOB_ID", job_id)
    info = instance.get_engine_torch_info(expected_host="engine.example")
    assert info["current"] is None and not info["live"] and not info["hostMatched"]
    assert info["busy"] and info["jobId"] == job_id and len(info["errors"]) == 3
    instance._torch_http.assert_not_called()
    instance.sftp_read_text.assert_not_called()


@pytest.mark.parametrize("owned", [False, True], ids=["foreign-job", "remote-job"])
def test_info_exposes_only_remote_owned_active_job(monkeypatch, owned):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    job_id = registry.create("torch-upgrade", mode="remote" if owned else "local", origin_host="engine.example" if owned else "local")
    monkeypatch.setattr(service, "_REMOTE_TORCH_JOB_ID", job_id if owned else None)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "other.example"})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://other.example:17000")
    info = service.SSHService().get_engine_torch_info(expected_host="engine.example")
    assert info["busy"] is True
    assert info["jobId"] == (job_id if owned else None)


def test_remote_info_hides_other_host_job_but_keeps_global_busy(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    job_id = registry.create("torch-upgrade", mode="remote", origin_host="a.example")
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "a.example"})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://unused.invalid:17000")
    instance = service.SSHService()
    assert instance.get_engine_torch_info(expected_host="b.example")["jobId"] is None
    assert instance.get_engine_torch_info(expected_host="b.example")["busy"] is True
    assert instance.get_engine_torch_info(expected_host="a.example")["jobId"] == job_id


def test_remote_info_system_stats_succeeds_without_ssh(monkeypatch):
    instance = service.SSHService()
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine.example"})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://engine.example:17000")
    monkeypatch.setattr(comfyui_bridge, "_http_json", lambda *args, **kwargs: {"system": {"pytorch_version": "2.11.0+cu128"}})
    instance._torch_command = Mock()
    instance.sftp_read_text = Mock()
    info = instance.get_engine_torch_info(expected_host="engine.example")
    assert info["current"]["source"] == "system_stats" and info["live"] and not info["hostMatched"]
    assert info["errors"] == []
    instance._torch_command.assert_not_called()
    instance.sftp_read_text.assert_not_called()


def test_remote_info_rejects_changed_port_on_same_host(monkeypatch):
    instance = service.SSHService()
    instance._connected, instance._connected_host = True, "engine.example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine.example"})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://engine.example:18000")
    instance._torch_command = Mock()
    instance.sftp_read_text = Mock()
    info = instance.get_engine_torch_info(expected_host="engine.example", expected_url="http://engine.example:17000")
    assert info["current"] is None and len(info["errors"]) == 3
    instance._torch_command.assert_not_called()
    instance.sftp_read_text.assert_not_called()


@pytest.mark.parametrize("probe_ok,ledger_ok", [(True, True), (False, True), (False, False)])
def test_remote_info_fallback_chain(monkeypatch, probe_ok, ledger_ok):
    instance = service.SSHService()
    instance._connected, instance._connected_host = True, "engine.example"
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine.example"})
    monkeypatch.setattr(comfyui_bridge, "bridge_url", lambda: "http://engine.example:17000")
    monkeypatch.setattr(comfyui_bridge, "_http_json", Mock(side_effect=RuntimeError("stats offline")))
    instance._torch_command = Mock(return_value="2.14.1+cu132") if probe_ok else Mock(side_effect=RuntimeError("probe offline"))
    instance.sftp_read_text = Mock(return_value=json.dumps({"current": {"torch": "2.11.0+cu128"}})) if ledger_ok else Mock(side_effect=OSError("ledger offline"))
    info = instance.get_engine_torch_info(expected_host="engine.example")
    assert info["errors"][0] == "system_stats: stats offline"
    if probe_ok:
        assert info["current"]["source"] == "venv-probe" and info["live"] and len(info["errors"]) == 1
        instance.sftp_read_text.assert_not_called()
    elif ledger_ok:
        assert info["current"]["source"] == "ledger" and not info["live"] and len(info["errors"]) == 2
    else:
        assert info["current"] is None and not info["live"] and len(info["errors"]) == 3


def test_sync_rejected_during_upgrade(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.ssh_config, "load_config", lambda: {"host": "engine"})
    instance = service.SSHService()
    instance._client, instance._connected, instance._connected_host = object(), True, "engine"
    entered, release = threading.Event(), threading.Event()
    def job(*args):
        entered.set()
        release.wait(3)
    instance._torch_upgrade_job = job
    instance.upgrade_engine_torch("2.14.1")
    try:
        assert entered.wait(1)
        with pytest.raises(RuntimeError, match="引擎同步已让路"):
            instance.sync_engine([])
    finally:
        release.set()
        assert service._TORCH_UPGRADE_LOCK.acquire(timeout=1)
        service._TORCH_UPGRADE_LOCK.release()


def test_upgrade_rejected_during_sync(monkeypatch):
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    def scan():
        entered.set()
        release.wait(3)
        raise RuntimeError("end test")
    monkeypatch.setattr(service, "_scan_mac_git_packages", scan)
    instance = service.SSHService()
    instance._torch_remote_pip_running = Mock(return_value=False)
    def sync():
        try:
            instance.sync_engine([])
        except RuntimeError:
            pass
        finally:
            finished.set()
    threading.Thread(target=sync, daemon=True).start()
    try:
        assert entered.wait(1)
        with pytest.raises(RuntimeError, match="引擎同步"):
            instance.upgrade_engine_torch("2.14.1")
    finally:
        release.set()
        assert finished.wait(1)


def timeout_error():
    error = service.SSHServiceError("远端命令执行失败")
    error.__cause__ = TimeoutError("timed out")
    return error


def test_install_timeout_monitors_until_matching_versions(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(service.time, "sleep", lambda seconds: None)
    instance = service.SSHService()
    instance.run_remote_command = Mock(side_effect=[timeout_error(), (0, "1"), (0, "0"), (0, "2.14.1+cu132\n0.29.1+cu132")])
    instance._torch_install(["torch==2.14.1+cu132", "torchvision==0.29.1+cu132"], "cu132", registry.create("torch-upgrade"))
    assert instance.run_remote_command.call_count == 4


def test_install_timeout_version_mismatch_rolls_back(setup_job):
    instance, registry, job_id, _, _ = setup_job
    instance._torch_install = service.SSHService._torch_install.__get__(instance)
    instance._torch_restart.return_value = {"system": {"pytorch_version": "2.11.0+cu128"}, "devices": [{}]}
    # 第4发=1107 补的 torchaudio 单独回滚(混装态各走各的 index)
    instance.run_remote_command = Mock(side_effect=[timeout_error(), (0, "wrong\nwrong"), (0, "rollback ok"), (0, "rollback ok")])
    instance._torch_upgrade_job(job_id, "2.14.1", "cu132")
    assert "已回滚至 2.11.0+cu128" in registry.get(job_id)["message"]
    assert instance.run_remote_command.call_count == 4


def test_install_timeout_disconnected_is_unknown(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    instance = service.SSHService()
    instance.run_remote_command = Mock(side_effect=[timeout_error(), service.SSHServiceError("断线")])
    with pytest.raises(service.TorchInstallUnknownError):
        instance._torch_install(["torch==2.14.1+cu132"], "cu132", registry.create("torch-upgrade"))
    assert instance.run_remote_command.call_count == 2


def test_install_timeout_monitor_limit_remains_unknown(monkeypatch):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    times = iter([0, 1801])
    monkeypatch.setattr(service.time, "monotonic", lambda: next(times))
    instance = service.SSHService()
    instance.run_remote_command = Mock(side_effect=[timeout_error(), (0, "1")])
    with pytest.raises(service.TorchInstallUnknownError, match="仍在运行"):
        instance._torch_install(["torch==2.14.1+cu132"], "cu132", registry.create("torch-upgrade"))
    assert instance.run_remote_command.call_count == 2
