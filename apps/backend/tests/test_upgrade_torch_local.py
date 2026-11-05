import json
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from comfyui import engine_manager, manifest, torch_upgrade_local
from remote_ssh import service

actual_pip_install = torch_upgrade_local._pip_install


def test_snapshot_freezes_both_recovery_pins(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(manifest, "venv_python", lambda: tmp_path / "venv" / "bin" / "python")
    freeze = "torch==2.14.0\ntorchvision==0.29.0\nother==1.0\n"
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", Mock(return_value=SimpleNamespace(stdout=freeze)))
    assert torch_upgrade_local.snapshot_installed_packages("job-1") == ("2.14.0", "0.29.0")
    snapshots = list((tmp_path / "torch-upgrade").glob("rollback-*.txt"))
    assert len(snapshots) == 1 and snapshots[0].read_text(encoding="utf-8") == freeze


def test_snapshot_rejects_missing_vision_before_writing(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(manifest, "venv_python", lambda: tmp_path / "python")
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", Mock(return_value=SimpleNamespace(stdout="torch==2.14.0\n")))
    with pytest.raises(RuntimeError, match="快照缺少"):
        torch_upgrade_local.snapshot_installed_packages("job-2")
    assert not (tmp_path / "torch-upgrade").exists()


def test_live_info_requires_matching_venv_for_mps(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(manifest, "venv_python", lambda: tmp_path / "venv" / "bin" / "python")
    monkeypatch.setattr(engine_manager, "engine_manager", lambda: SimpleNamespace(engine_url=lambda: "http://127.0.0.1:17001"))
    monkeypatch.setattr(engine_manager, "_get_json", lambda *args, **kwargs: {"system": {"pytorch_version": "2.14.0"}})
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    run = Mock(return_value=SimpleNamespace(stdout='["2.14.0", true]\n'))
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", run)
    info = torch_upgrade_local.get_engine_torch_info()
    assert info["mode"] == "local" and info["live"] and info["mps"] is True
    assert info["current"]["torch"] == "2.14.0"
    run.return_value.stdout = '["2.14.1", true]\n'
    assert torch_upgrade_local.get_engine_torch_info()["mps"] is None


def test_ledger_fallback_does_not_claim_live(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(engine_manager, "engine_manager", lambda: SimpleNamespace(engine_url=Mock(side_effect=OSError("offline"))))
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    (tmp_path / "torch-upgrade.json").write_text(json.dumps({"current": {"torch": "2.14.0"}}), encoding="utf-8")
    info = torch_upgrade_local.get_engine_torch_info()
    assert info["current"]["torch"] == "2.14.0"
    assert info["live"] is False and info["mps"] is None


@pytest.fixture
def local_job(monkeypatch, tmp_path):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", lambda: None)
    monkeypatch.setattr(torch_upgrade_local.shutil, "disk_usage", lambda _: SimpleNamespace(free=20 * 1024 ** 3))
    monkeypatch.setattr(engine_manager, "_engine_home_processes", list)
    state = {"version": "2.14.1", "installs": []}
    manager = SimpleNamespace(
        _lock=threading.Lock(), _stop_generation=1,
        is_healthy=Mock(return_value=False), start_sync=Mock(),
        _stop_managed_process=Mock(return_value=(1, True)), engine_url=lambda: "http://127.0.0.1:17001",
    )
    monkeypatch.setattr(engine_manager, "engine_manager", lambda: manager)
    monkeypatch.setattr(engine_manager, "_get_json", lambda url, **_: (
        {"queue_pending": [], "queue_running": []} if url.endswith("/queue") else
        {"system": {"pytorch_version": state["version"]}, "devices": [{}]} if url.endswith("/system_stats") else {"Node": {}}
    ))
    monkeypatch.setattr(torch_upgrade_local, "snapshot_installed_packages", lambda _: ("2.14.0", "0.29.0"))
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", lambda _: None)
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", lambda specs, *_args, **_kwargs: state["installs"].append(specs))
    job_id = registry.create("torch-upgrade")
    return registry, job_id, state, manager


def test_local_upgrade_success(local_job, tmp_path):
    registry, job_id, state, _ = local_job
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    assert registry.get(job_id)["status"] == "complete"
    assert state["installs"] == [["torch==2.14.1", "torchvision==0.29.1"]]
    assert json.loads((tmp_path / "torch-upgrade.json").read_text())["current"]["via"] == "oneclick-local"


def test_local_install_failure_rolls_back(local_job, monkeypatch):
    registry, job_id, state, _ = local_job
    def install(specs, *_args, **_kwargs):
        if specs[0] == "torch==2.14.1":
            raise RuntimeError("offline")
        state["version"] = "2.14.0"
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", install)
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    assert registry.get(job_id)["status"] == "error"
    assert "已回滚至 2.14.0" in registry.get(job_id)["message"]
    assert not service._torch_stuck_marker().exists()


def test_local_rollback_failure_is_reported(local_job, monkeypatch):
    registry, job_id, _, _ = local_job
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", Mock(side_effect=RuntimeError("pip failed")))
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    assert "回滚失败" in registry.get(job_id)["message"]
    assert json.loads(service._torch_stuck_marker().read_text())["state"] == "in-progress"


def test_existing_pip_rejects_install(monkeypatch, tmp_path):
    executable = tmp_path / "venv" / "bin" / "python"
    monkeypatch.setattr(manifest, "venv_python", lambda: executable)
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=f"PID COMMAND\n42 {executable} -m pip install torch\n"))
    with pytest.raises(RuntimeError, match="已有 pip"):
        torch_upgrade_local._ensure_no_pip()


def test_running_other_install_rejects_upgrade(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    registry.create("plugin-install")
    with pytest.raises(RuntimeError, match="安装任务正在运行"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")


def test_local_pip_timeout_monitors_process(monkeypatch):
    process = Mock()
    process.wait.side_effect = torch_upgrade_local.subprocess.TimeoutExpired("pip", 3600)
    process.poll.side_effect = [None, 0, 0]
    process.returncode = 0
    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", lambda *args, **kwargs: process)
    monkeypatch.setattr(torch_upgrade_local.time, "sleep", lambda _: None)
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(torch_upgrade_local, "_verify_specs", lambda specs: None)
    job_id = engine_manager.jobs.create("torch-upgrade")
    torch_upgrade_local._pip_install(["torch==2.14.1"], job_id)
    assert "继续监控" in engine_manager.jobs.get(job_id)["tail"][0]


@pytest.mark.parametrize("matches", [True, False])
def test_timeout_exit_verifies_versions_and_recovers(local_job, monkeypatch, matches):
    registry, job_id, state, _ = local_job
    process = Mock(returncode=0)
    def wait(timeout=None):
        if timeout == 3600:
            raise torch_upgrade_local.subprocess.TimeoutExpired("pip", timeout)
        assert timeout == 10
        assert registry.get(job_id)["status"] == "running"
        assert registry.get(job_id)["error"] is None
        return 0
    process.wait.side_effect = wait
    process.poll.return_value = None
    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", lambda *args, **kwargs: process)
    clock = iter([0, 1801])
    monkeypatch.setattr(torch_upgrade_local.time, "monotonic", lambda: next(clock))
    versions = ["2.14.1", "0.29.1"] if matches else ["2.14.0", "0.29.0"]
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps(versions)))
    def install(specs, active_id, *, mirror=False):
        if specs[0] == "torch==2.14.1":
            return actual_pip_install(specs, active_id, mirror=mirror)
        state["version"] = "2.14.0"
        state["installs"].append(specs)
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", install)
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    job = registry.get(job_id)
    process.kill.assert_called_once()
    process.wait.assert_any_call(timeout=10)
    assert job["status"] == ("complete" if matches else "error")
    if not matches:
        assert "已回滚至 2.14.0" in job["message"]
        assert state["installs"] == [["torch==2.14.0", "torchvision==0.29.0"]]


@pytest.mark.parametrize("matches", [True, False])
def test_killed_timeout_job_terminates_and_releases_lock(local_job, monkeypatch, matches):
    registry, previous_id, state, _ = local_job
    registry.update(previous_id, error="finished")
    process = Mock(returncode=0)
    process.wait.side_effect = [torch_upgrade_local.subprocess.TimeoutExpired("pip", 3600), 0]
    process.poll.return_value = None
    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", lambda *args, **kwargs: process)
    clock = iter([0, 1801])
    monkeypatch.setattr(torch_upgrade_local.time, "monotonic", lambda: next(clock))
    versions = ["2.14.1", "0.29.1"] if matches else ["2.14.0", "0.29.0"]
    monkeypatch.setattr(torch_upgrade_local.subprocess, "run", lambda *args, **kwargs: SimpleNamespace(stdout=json.dumps(versions)))
    def install(specs, active_id, *, mirror=False):
        if specs[0] == "torch==2.14.1":
            return actual_pip_install(specs, active_id, mirror=mirror)
        state["version"] = "2.14.0"
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", install)
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    job_id = torch_upgrade_local.upgrade_engine_torch("2.14.1")
    assert registry.get(job_id)["status"] == ("complete" if matches else "error")
    process.kill.assert_called_once()
    assert not torch_upgrade_local._TORCH_UPGRADE_LOCK.locked()


@pytest.mark.parametrize("kill_fails", [False, True])
def test_unreaped_killed_pip_fails_without_concurrent_rollback(local_job, monkeypatch, kill_fails):
    from comfyui import plugin_manager

    registry, previous_id, state, _ = local_job
    registry.update(previous_id, error="finished")
    process = Mock()
    process.wait.side_effect = torch_upgrade_local.subprocess.TimeoutExpired("pip", 10)
    process.poll.return_value = None
    if kill_fails:
        process.kill.side_effect = OSError("cannot kill")
    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", lambda *args, **kwargs: process)
    clock = iter([0, 1801])
    monkeypatch.setattr(torch_upgrade_local.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", actual_pip_install)
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    try:
        job_id = torch_upgrade_local.upgrade_engine_torch("2.14.1")
        assert registry.get(job_id)["status"] == "error"
        assert "无法确认 pip 已终止" in registry.get(job_id)["message"]
        assert not state["installs"]
        process.kill.assert_called_once()
        assert torch_upgrade_local._TORCH_UPGRADE_LOCK.locked()
        marker_data = json.loads(service._torch_stuck_marker().read_text())
        assert marker_data["mode"] == "local" and marker_data["state"] == "stuck"
        with pytest.raises(engine_manager.EngineOpError, match="暂停引擎更新"):
            engine_manager.EngineManager().update_job()
        with pytest.raises(engine_manager.EngineOpError, match="暂停插件安装"):
            plugin_manager.install_plugin_job("git", "example")
    finally:
        if service._TORCH_STUCK_HELD:
            service._TORCH_UPGRADE_LOCK.release()
            service._TORCH_STUCK_HELD = False


def test_local_marker_write_failure_is_visible_and_keeps_lock(local_job, monkeypatch, tmp_path):
    registry, previous_id, _, _ = local_job
    registry.update(previous_id, error="finished")
    blocked = tmp_path / "not-a-directory"
    blocked.write_text("block")
    marker_path = {"value": tmp_path / "writable" / "stuck.json"}
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: marker_path["value"])
    process = Mock()
    process.wait.side_effect = torch_upgrade_local.subprocess.TimeoutExpired("pip", 10)
    process.poll.return_value = None
    def cannot_kill():
        marker_path["value"] = blocked / "stuck.json"
        raise OSError("cannot kill")
    process.kill.side_effect = cannot_kill
    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", lambda *args, **kwargs: process)
    clock = iter([0, 1801])
    monkeypatch.setattr(torch_upgrade_local.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", actual_pip_install)
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    try:
        job = registry.get(torch_upgrade_local.upgrade_engine_torch("2.14.1"))
        assert job["status"] == "error"
        assert "无法确认 pip 已终止" in job["message"]
        assert "备用标记" in job["message"]
        assert service._TORCH_STUCK_HELD and service._TORCH_UPGRADE_LOCK.locked()
    finally:
        service._TORCH_UPGRADE_LOCK.release()
        service._TORCH_STUCK_HELD = False
    with pytest.raises(RuntimeError, match="异常标记无法清除"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")
    fallback = service._torch_fallback_marker()
    original = fallback.read_bytes()
    marker_path["value"] = tmp_path / "restored" / "stuck.json"
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", Mock(side_effect=RuntimeError("version mismatch")))
    with pytest.raises(RuntimeError, match="无法核实"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")
    assert fallback.read_bytes() == original
    assert not marker_path["value"].exists()


@pytest.mark.parametrize("blocked_path", ["primary", "fallback"])
def test_marker_preflight_checks_both_paths_before_stopping(local_job, monkeypatch, tmp_path, blocked_path):
    registry, previous_id, _, manager = local_job
    registry.update(previous_id, error="finished")
    blocked = tmp_path / "blocked"
    blocked.write_text("not a directory")
    marker_name = "_torch_stuck_marker" if blocked_path == "primary" else "_torch_fallback_marker"
    monkeypatch.setattr(service, marker_name, lambda: blocked / "stuck.json")
    with pytest.raises(RuntimeError, match="异常标记路径不可写"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")
    manager._stop_managed_process.assert_not_called()


def test_local_fallback_survives_restart_and_primary_recovery(local_job, monkeypatch, tmp_path):
    registry, previous_id, _, _ = local_job
    registry.update(previous_id, error="finished")
    blocked = tmp_path / "blocked"
    blocked.write_text("not a directory")
    primary = {"path": blocked / "stuck.json"}
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: primary["path"])
    with pytest.raises(RuntimeError, match="备用标记"):
        service._write_torch_in_progress("job", mode="local", target="2.14.1")
    fallback = service._torch_fallback_marker()
    original = fallback.read_bytes()
    primary["path"] = tmp_path / "restored" / "stuck.json"
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", lambda: None)
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", Mock(side_effect=RuntimeError("version mismatch")))
    with pytest.raises(RuntimeError, match="无法核实"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")
    assert fallback.read_bytes() == original
    assert not primary["path"].exists()


def test_marker_blocks_pip_entries_after_restart(monkeypatch, tmp_path):
    from comfyui import plugin_manager

    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    marker = service._torch_stuck_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local", "state": "in-progress", "host": None, "jobId": "job", "at": "now", "target": "2.14.1", "kind": "in-progress", "reason": "test"}))
    assert not service._TORCH_UPGRADE_LOCK.locked()
    with pytest.raises(engine_manager.EngineOpError, match="pip 未知态残留"):
        engine_manager.EngineManager().update_job()
    with pytest.raises(engine_manager.EngineOpError, match="pip 未知态残留"):
        plugin_manager.install_plugin_job("git", "example")


@pytest.mark.parametrize("matches", [False, True])
def test_fallback_after_restart_requires_matching_version(monkeypatch, tmp_path, matches):
    from comfyui import plugin_manager

    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    marker = service._torch_fallback_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local", "host": None, "jobId": "job", "at": "now", "target": "2.14.1", "kind": "stuck", "state": "stuck", "reason": "test"}))
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", lambda: None)
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", Mock(side_effect=None if matches else RuntimeError("version mismatch")))
    with pytest.raises(engine_manager.EngineOpError, match="pip 未知态残留"):
        engine_manager.EngineManager().update_job()
    with pytest.raises(engine_manager.EngineOpError, match="pip 未知态残留"):
        plugin_manager.install_plugin_job("git", "example")
    if not matches:
        with pytest.raises(RuntimeError, match="无法核实"):
            service._acquire_torch_operation(service.SSHService())
        assert marker.exists()
    else:
        service._acquire_torch_operation(service.SSHService())
        try:
            assert not service._torch_any_marker()
        finally:
            service._TORCH_UPGRADE_LOCK.release()


def test_recovery_clears_both_matching_markers(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    record = {"jobId": "job", "at": "now", "mode": "local", "host": None, "target": "2.14.1", "kind": "in-progress", "state": "in-progress", "reason": "test"}
    for marker in (service._torch_stuck_marker(), service._torch_fallback_marker()):
        marker.parent.mkdir(parents=True)
        marker.write_text(json.dumps(record))
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", lambda: None)
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", lambda target: None)
    service._acquire_torch_operation(service.SSHService())
    try:
        assert not service._torch_any_marker()
    finally:
        service._TORCH_UPGRADE_LOCK.release()


def test_legacy_fallback_without_target_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    marker = service._torch_fallback_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local"}))
    with pytest.raises(RuntimeError, match="无法核实"):
        service._acquire_torch_operation(service.SSHService())
    assert marker.exists()


@pytest.mark.parametrize("recovery_fails", [False, True])
@pytest.mark.parametrize("held", [False, True])
def test_local_marker_recovery_requires_no_pip_and_import(local_job, monkeypatch, recovery_fails, held):
    registry, previous_id, _, _ = local_job
    registry.update(previous_id, error="finished")
    marker = service._torch_stuck_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local", "state": "in-progress", "host": None, "target": "2.14.1", "jobId": "job", "at": "now", "kind": "in-progress", "reason": "test"}))
    if held:
        service._TORCH_UPGRADE_LOCK.acquire()
        monkeypatch.setattr(service, "_TORCH_STUCK_HELD", True)
        monkeypatch.setattr(service, "_TORCH_STUCK_MODE", "local")
        monkeypatch.setattr(service, "_TORCH_STUCK_HOST", None)
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", Mock(side_effect=RuntimeError("import failed") if recovery_fails else None))
    monkeypatch.setattr(registry, "start", lambda job_id, target: target(job_id))
    try:
        if recovery_fails:
            with pytest.raises(RuntimeError, match="无法核实"):
                torch_upgrade_local.upgrade_engine_torch("2.14.1")
            assert marker.exists()
            assert service._TORCH_UPGRADE_LOCK.locked() is held
        else:
            job_id = torch_upgrade_local.upgrade_engine_torch("2.14.1")
            assert registry.get(job_id)["status"] == "complete"
            assert not marker.exists()
            assert not service._TORCH_UPGRADE_LOCK.locked()
    finally:
        if service._TORCH_STUCK_HELD:
            service._TORCH_UPGRADE_LOCK.release()
            service._TORCH_STUCK_HELD = False


def test_local_marker_recovery_rejects_live_pip(local_job, monkeypatch):
    registry, previous_id, _, _ = local_job
    registry.update(previous_id, error="finished")
    marker = service._torch_stuck_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local", "state": "in-progress", "host": None, "target": "2.14.1", "jobId": "job", "at": "now", "kind": "in-progress", "reason": "test"}))
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", Mock(side_effect=RuntimeError("pip running")))
    verify = Mock()
    monkeypatch.setattr(torch_upgrade_local, "_verify_recovery_import", verify)
    with pytest.raises(RuntimeError, match="无法核实"):
        torch_upgrade_local.upgrade_engine_torch("2.14.1")
    verify.assert_not_called()
    assert marker.exists()


def test_remote_entry_recovers_local_marker_only_after_local_probe(local_job, monkeypatch):
    registry, previous_id, _, _ = local_job
    registry.update(previous_id, error="finished")
    marker = service._torch_stuck_marker()
    marker.parent.mkdir(parents=True)
    marker.write_text(json.dumps({"mode": "local", "host": None, "jobId": "job", "at": "now", "target": "2.14.1", "state": "in-progress", "kind": "in-progress", "reason": "test"}))
    verify = Mock()
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", verify)
    instance = service.SSHService()
    instance._torch_remote_pip_running = Mock()
    service._acquire_torch_operation(instance)
    try:
        verify.assert_called_once_with("2.14.1")
        instance._torch_remote_pip_running.assert_not_called()
        assert not marker.exists()
    finally:
        service._TORCH_UPGRADE_LOCK.release()


@pytest.mark.parametrize("entry", ["remote", "sync", "local", "engine", "plugin"])
def test_unwritable_marker_after_restart_blocks_each_entry(monkeypatch, tmp_path, entry):
    from comfyui import plugin_manager

    monkeypatch.setattr(engine_manager, "jobs", engine_manager.JobRegistry())
    monkeypatch.setattr(plugin_manager, "jobs", engine_manager.jobs)
    monkeypatch.setattr(service, "_TORCH_STUCK_HELD", False)
    blocked = tmp_path / "blocked"
    blocked.write_text("file")
    monkeypatch.setattr(service, "_torch_stuck_marker", lambda: blocked / "stuck.json")
    monkeypatch.setattr(plugin_manager.cm, "engine_installed", lambda: True)
    monkeypatch.setattr(plugin_manager.cm, "plugin_ledger", dict)
    monkeypatch.setattr(plugin_manager, "_resolve_plan", lambda *_: {"dirName": "plugin"})
    instance = service.SSHService()
    calls = {
        "remote": lambda: instance.upgrade_engine_torch("2.14.1"),
        "sync": lambda: instance.sync_engine([]),
        "local": lambda: torch_upgrade_local.upgrade_engine_torch("2.14.1"),
        "engine": lambda: engine_manager.EngineManager().update_job(),
        "plugin": lambda: plugin_manager.install_plugin_job("git", "example"),
    }
    error_type = engine_manager.EngineOpError if entry in ("engine", "plugin") else RuntimeError
    with pytest.raises(error_type, match="异常标记路径不可写.*须人工介入"):
        calls[entry]()
    assert not service._TORCH_UPGRADE_LOCK.locked()


def test_local_in_progress_lifecycle(local_job, monkeypatch):
    registry, job_id, _, _ = local_job
    marker = service._torch_stuck_marker()
    def install(*_args, **_kwargs):
        data = json.loads(marker.read_text())
        assert data["state"] == "in-progress" and data["mode"] == "local"
        assert data["jobId"] == job_id and data["host"] is None
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", install)
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    assert registry.get(job_id)["status"] == "complete"
    assert not marker.exists()


def test_local_in_progress_write_failure_never_starts_pip(local_job, monkeypatch):
    registry, job_id, _, manager = local_job
    pip = Mock()
    monkeypatch.setattr(torch_upgrade_local, "_pip_install", pip)
    monkeypatch.setattr(service, "_write_torch_in_progress", Mock(side_effect=RuntimeError("marker failed")))
    torch_upgrade_local._upgrade_job(job_id, "2.14.1")
    assert registry.get(job_id)["status"] == "error"
    pip.assert_not_called()
    assert manager.start_sync.call_count >= 1


def test_plugin_dry_run_does_not_probe_marker_path(monkeypatch):
    from comfyui import plugin_manager

    monkeypatch.setattr(service, "_ensure_stuck_marker_writable", Mock(side_effect=AssertionError("must not write")))
    monkeypatch.setattr(plugin_manager.cm, "engine_installed", lambda: True)
    monkeypatch.setattr(plugin_manager, "_resolve_plan", lambda *_: {"dirName": "plugin"})
    monkeypatch.setattr(plugin_manager, "_preflight", lambda _: [])
    assert plugin_manager.install_plugin_job("git", "example", dry_run=True)["conflicts"] == []


def test_local_route_dispatch(monkeypatch):
    from http import HTTPStatus

    from test_server_upgrade_torch_route import call
    manager = SimpleNamespace(remote_engine_status=lambda: {"source": "local", "url": ""})
    monkeypatch.setattr(engine_manager, "engine_manager", lambda: manager)
    monkeypatch.setattr(torch_upgrade_local, "upgrade_engine_torch", lambda target: "local-job")
    response, status = call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1"})
    assert status == HTTPStatus.OK and response == {"jobId": "local-job", "mode": "local"}
