import json
import os
import sys
import threading
import time
from email.message import Message
from http import HTTPStatus
from http.server import ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from urllib.request import Request, urlopen
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_gen import server
from comfyui import engine_manager, manifest, torch_upgrade_local
from comfyui.engine_manager import jobs
from remote_ssh import service


class Handler(server.Handler):
    def _send_json(self, payload, status=HTTPStatus.OK):
        self.response = (payload, status)

    def _send_error_json(self, status, message, code="error"):
        self.response = ({"message": message, "code": code}, status)


def call(method, path, payload=None, query=None):
    handler = Handler.__new__(Handler)
    handler.headers = Message()
    handler._comfy(method, path, payload or {}, query or {})
    return handler.response


@pytest.mark.parametrize("target,channel", [("1;bad", "cu132"), ("2.14.1", "bad"), ("2.14", "cu132")])
def test_invalid_request(target, channel):
    assert call("POST", "/comfy/ssh/upgrade-torch", {"target": target, "channel": channel, "mode": "remote"})[1] == HTTPStatus.BAD_REQUEST


def test_busy_and_success():
    instance = Mock()
    instance.status.return_value = {"connected": True, "host": "engine.example"}
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    with patch("image_gen.server._ssh_service", return_value=instance), patch("comfyui.engine_manager.engine_manager", return_value=manager):
        instance.upgrade_engine_torch.side_effect = RuntimeError("busy")
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "remote"})[1] == HTTPStatus.CONFLICT
        instance.upgrade_engine_torch.side_effect = None
        instance.upgrade_engine_torch.return_value = "job"
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "remote"})[0] == {"jobId": "job", "mode": "remote"}
        instance.upgrade_engine_torch.assert_called_with("2.14.1", "cu132", expected_host="engine.example")
        manager.remote_engine_status.return_value = {"source": "settings", "url": "http://other.example:17000"}
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "remote"})[1] == HTTPStatus.CONFLICT


def test_info_receives_active_engine_host():
    instance = Mock()
    instance.get_engine_torch_info.return_value = {"hostMatched": False, "live": False, "jobId": "job"}
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    with patch("image_gen.server._ssh_service", return_value=instance), patch("comfyui.engine_manager.engine_manager", return_value=manager):
        assert call("GET", "/comfy/ssh/torch-info", query={"mode": ["remote"]})[0]["jobId"] == "job"
        instance.get_engine_torch_info.assert_called_once_with(expected_host="engine.example", expected_url="http://engine.example:17000")


@pytest.mark.parametrize("mode,host,expected", [
    ("remote", "a.example", HTTPStatus.OK),
    ("remote", "b.example", HTTPStatus.NOT_FOUND),
    ("local", "a.example", HTTPStatus.NOT_FOUND),
    ("", "a.example", HTTPStatus.NOT_FOUND),
])
def test_torch_job_status_requires_matching_mode_and_origin(mode, host, expected):
    registry = jobs
    job_id = registry.create("torch-upgrade", mode="remote", origin_host="a.example")
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": f"http://{host}:17000"}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager):
        payload, status = call("GET", f"/comfy/jobs/{job_id}", query={"mode": [mode]})
    assert status == expected
    if expected == HTTPStatus.OK:
        assert payload["id"] == job_id
    registry.update(job_id, error="finished")


def test_local_torch_job_status_requires_local_mode():
    job_id = jobs.create("torch-upgrade", mode="local", origin_host="local")
    assert call("GET", f"/comfy/jobs/{job_id}", query={"mode": ["local"]})[1] == HTTPStatus.OK
    assert call("GET", f"/comfy/jobs/{job_id}", query={"mode": ["remote"]})[1] == HTTPStatus.NOT_FOUND
    jobs.update(job_id, error="finished")


def test_local_pip_job_route_streams_and_matches_frontend_fixture(monkeypatch, tmp_path):
    fixture_path = Path(__file__).resolve().parents[2] / "frontend/components/panels/settings/comfy-engine/__fixtures__/torch-job-route.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    job_id = registry.create("torch-upgrade", mode="local", origin_host="local")
    registry.update(job_id, progress=15, step="install", message="安装中")
    real_popen = torch_upgrade_local.subprocess.Popen
    processes = []
    ready = threading.Event()
    gate = tmp_path / "continue"
    failures = []
    original_update = registry.update

    def launch(_command, **kwargs):
        script = ('import pathlib, sys, time; print("Collecting torch==2.14.1", flush=True); '
                  'print("Downloading torch-2.14.1.whl", flush=True); gate = pathlib.Path(sys.argv[1]);\n'
                  'while not gate.exists(): time.sleep(0.01)\nprint("finished", flush=True)')
        process = real_popen([sys.executable, "-u", "-c", script, str(gate)], **kwargs)
        processes.append(process)
        return process

    def update(active_id, **kwargs):
        result = original_update(active_id, **kwargs)
        if kwargs.get("tail_line") == "Downloading torch-2.14.1.whl":
            ready.set()
        return result

    def install():
        try:
            torch_upgrade_local._pip_install(["torch==2.14.1"], job_id)
            registry.update(job_id, step="ledger", message="升级完成，引擎已重启", result={"from": "2.14.0", "to": "2.14.1"})
        except Exception as exc:
            failures.append(exc)

    def normalized(payload):
        return {**payload, "id": "local-job", "createdAt": 1000, "updatedAt": 2000}

    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", launch)
    monkeypatch.setattr(registry, "update", update)
    worker = threading.Thread(target=install)
    worker.start()
    try:
        assert ready.wait(5)
        payload, status = call("GET", f"/comfy/jobs/{job_id}", query={"mode": ["local"]})
        assert status == HTTPStatus.OK and payload["status"] == "running"
        assert processes[0].poll() is None
        assert payload["tail"][-1] == "Downloading torch-2.14.1.whl"
        assert normalized(payload) == fixture["running"]
    finally:
        gate.touch()
        worker.join(timeout=5)
    assert not worker.is_alive() and not failures and processes[0].returncode == 0
    payload, status = call("GET", f"/comfy/jobs/{job_id}", query={"mode": ["local"]})
    assert status == HTTPStatus.OK
    assert normalized(payload) == fixture["complete"]


def test_local_upgrade_http_streams_live_subprocess_until_terminal(monkeypatch, tmp_path):
    registry = engine_manager.JobRegistry()
    monkeypatch.setattr(engine_manager, "jobs", registry)
    monkeypatch.setattr(manifest, "comfy_home", lambda: tmp_path)
    executable = tmp_path / "fake-venv-python"
    first_gate, second_gate = tmp_path / "first-gate", tmp_path / "second-gate"
    executable.write_text(
        f"#!{sys.executable}\n"
        "import pathlib, time\n"
        f"gates = {[str(first_gate), str(second_gate)]!r}\n"
        "for line, gate in zip(('first', 'second'), gates):\n"
        "    print(line, flush=True)\n"
        "    deadline = time.monotonic() + 15\n"
        "    while not pathlib.Path(gate).exists() and time.monotonic() < deadline:\n"
        "        time.sleep(0.01)\n"
        "    if not pathlib.Path(gate).exists(): raise SystemExit(1)\n"
        "print('finished', flush=True)\n",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    monkeypatch.setattr(manifest, "venv_python", lambda: executable)
    manager = SimpleNamespace(
        _lock=threading.Lock(), _stop_generation=1,
        remote_engine_status=lambda: {"source": "local", "url": ""},
        is_healthy=lambda: False, start_sync=Mock(),
        _stop_managed_process=lambda: (1, True), engine_url=lambda: "http://127.0.0.1:17001",
    )
    monkeypatch.setattr(engine_manager, "engine_manager", lambda: manager)
    monkeypatch.setattr(engine_manager, "_engine_home_processes", list)
    monkeypatch.setattr(engine_manager, "_get_json", lambda url, **_: (
        {"queue_pending": [], "queue_running": []} if url.endswith("/queue") else
        {"system": {"pytorch_version": "2.14.1"}, "devices": [{}]} if url.endswith("/system_stats") else {"Node": {}}
    ))
    monkeypatch.setattr(torch_upgrade_local, "_ensure_no_pip", lambda: None)
    monkeypatch.setattr(torch_upgrade_local, "snapshot_installed_packages", lambda _: ("2.14.0", "0.29.0"))
    monkeypatch.setattr(torch_upgrade_local, "_verify_import", lambda _: None)
    monkeypatch.setattr(torch_upgrade_local.shutil, "disk_usage", lambda _: SimpleNamespace(free=20 * 1024 ** 3))
    lock = threading.Lock()
    monkeypatch.setattr(torch_upgrade_local, "_TORCH_UPGRADE_LOCK", lock)
    monkeypatch.setattr(torch_upgrade_local, "_LOCAL_TORCH_JOB_ID", None)
    monkeypatch.setattr(service, "_TORCH_STUCK_HELD", False)
    monkeypatch.setattr(service, "ssh_service", lambda: None)
    monkeypatch.setattr(service, "_acquire_torch_operation", lambda _: lock.acquire())
    monkeypatch.setenv("MANYING_LOCAL_IMAGE_TOKEN", "test-http-token")
    processes = []
    real_popen = torch_upgrade_local.subprocess.Popen

    def launch(command, **kwargs):
        process = real_popen(command, **kwargs)
        processes.append(process)
        return process

    monkeypatch.setattr(torch_upgrade_local.subprocess, "Popen", launch)
    http_server = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    server_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    server_thread.start()
    base_url = f"http://127.0.0.1:{http_server.server_port}"

    def request(path, body=None):
        headers = {"Authorization": "Bearer test-http-token"}
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        with urlopen(Request(base_url + path, data=data, headers=headers), timeout=5) as response:
            assert response.status == HTTPStatus.OK
            return json.load(response)

    def poll(job_id, predicate):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            job = request(f"/comfy/jobs/{job_id}?mode=local")
            if predicate(job):
                return job
            assert job["status"] == "running", job
            time.sleep(0.01)
        pytest.fail(f"job polling timed out: {job}")

    try:
        started = request("/comfy/ssh/upgrade-torch", {"target": "2.14.1", "channel": "cu132", "mode": "local"})
        assert started["mode"] == "local"
        job_id = started["jobId"]
        # If output is deferred until exit, neither live poll can satisfy its assertion.
        first = poll(job_id, lambda job: job["tail"] == ["first"])
        assert first["status"] == "running" and processes[0].poll() is None
        first_gate.touch()
        second = poll(job_id, lambda job: job["tail"] == ["first", "second"])
        assert second["status"] == "running" and processes[0].poll() is None
        second_gate.touch()
        terminal = poll(job_id, lambda job: job["status"] != "running")
        assert terminal["status"] == "complete"
        assert terminal["tail"] == ["first", "second", "finished"]
        assert terminal["result"] == {"from": "2.14.0", "to": "2.14.1"}
        assert processes[0].returncode == 0
    finally:
        first_gate.touch()
        second_gate.touch()
        if processes:
            processes[0].wait(timeout=10)
        deadline = time.monotonic() + 10
        while (registry.active_of("torch-upgrade") or lock.locked()) and time.monotonic() < deadline:
            time.sleep(0.01)
        http_server.shutdown()
        server_thread.join(timeout=5)
        http_server.server_close()


def test_info_uses_local_probe_when_engine_is_local():
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "local", "url": ""}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager), patch(
        "comfyui.torch_upgrade_local.get_engine_torch_info", return_value={"mode": "local", "live": True}
    ) as probe:
        assert call("GET", "/comfy/ssh/torch-info", query={"mode": ["local"]})[0]["mode"] == "local"
        probe.assert_called_once_with()


@pytest.mark.parametrize("method,path", [("GET", "/comfy/ssh/torch-info"), ("POST", "/comfy/ssh/upgrade-torch")])
def test_explicit_remote_requires_active_remote(method, path):
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "local", "url": ""}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager):
        assert call(method, path, {"target": "2.14.1", "mode": "remote"}, {"mode": ["remote"]})[1] == HTTPStatus.CONFLICT


def test_explicit_local_works_when_remote_active():
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager), patch(
        "comfyui.torch_upgrade_local.get_engine_torch_info", return_value={"mode": "local"}
    ) as probe, patch("comfyui.torch_upgrade_local.upgrade_engine_torch", return_value="local-job") as upgrade:
        assert call("GET", "/comfy/ssh/torch-info", query={"mode": ["local"]})[0]["mode"] == "local"
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "local"})[0] == {"jobId": "local-job", "mode": "local"}
        probe.assert_called_once_with()
        upgrade.assert_called_once_with("2.14.1")


def test_explicit_remote_uses_active_ssh_host():
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    service = Mock()
    service.status.return_value = {"connected": True, "host": "engine.example"}
    service.get_engine_torch_info.return_value = {"live": True}
    service.upgrade_engine_torch.return_value = "remote-job"
    with patch("comfyui.engine_manager.engine_manager", return_value=manager), patch("image_gen.server._ssh_service", return_value=service):
        assert call("GET", "/comfy/ssh/torch-info", query={"mode": ["remote"]})[0]["mode"] == "remote"
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "remote"})[0]["jobId"] == "remote-job"
        service.get_engine_torch_info.assert_called_once_with(expected_host="engine.example", expected_url="http://engine.example:17000")
        service.upgrade_engine_torch.assert_called_once_with("2.14.1", "cu132", expected_host="engine.example")


def test_invalid_modes_are_rejected():
    assert call("GET", "/comfy/ssh/torch-info", query={"mode": ["bad"]})[1] == HTTPStatus.BAD_REQUEST
    assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1", "mode": "bad"})[1] == HTTPStatus.BAD_REQUEST


@pytest.mark.parametrize("method,path", [("GET", "/comfy/ssh/torch-info"), ("POST", "/comfy/ssh/upgrade-torch")])
def test_missing_mode_is_rejected(method, path):
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "local", "url": ""}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager), patch(
        "comfyui.torch_upgrade_local.upgrade_engine_torch", return_value="must-not-start"
    ) as upgrade:
        payload, status = call(method, path, {"target": "2.14.1"})
        upgrade.assert_not_called()
    assert status == HTTPStatus.BAD_REQUEST
    assert "local" in payload["message"] and "remote" in payload["message"]


def test_unknown_version_is_rejected_with_allowed_versions():
    payload, status = call("POST", "/comfy/ssh/upgrade-torch", {"target": "9.9.9", "mode": "remote"})
    assert status == HTTPStatus.BAD_REQUEST
    assert all(version in payload["message"] for version in ("2.14.1", "2.14.0", "2.13.0"))


@pytest.mark.parametrize("method,path", [("GET", "/comfy/ssh/torch-info"), ("POST", "/comfy/ssh/upgrade-torch")])
def test_authentication(method, path):
    handler = server.Handler.__new__(server.Handler)
    handler.headers = Message()
    handler.path = path
    handler.rfile = BytesIO(b"{}")
    handler.wfile = BytesIO()
    handler.send_response = Mock()
    handler.send_header = Mock()
    handler.end_headers = Mock()
    with patch.dict(os.environ, {}, clear=True):
        getattr(handler, f"do_{method}")()
    assert b"invalid_local_token" in handler.wfile.getvalue()


def test_token_header_is_accepted():
    handler = server.Handler.__new__(server.Handler)
    handler.headers = Message()
    handler.headers["X-Manying-Image-Token"] = "test-token"
    with patch.dict(os.environ, {"MANYING_LOCAL_IMAGE_TOKEN": "test-token"}):
        assert handler._authorized()
