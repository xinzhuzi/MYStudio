import os
import sys
from email.message import Message
from http import HTTPStatus
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from image_gen import server


class Handler(server.Handler):
    def _send_json(self, payload, status=HTTPStatus.OK):
        self.response = (payload, status)

    def _send_error_json(self, status, message, code="error"):
        self.response = ({"message": message, "code": code}, status)


def call(method, path, payload=None):
    handler = Handler.__new__(Handler)
    handler.headers = Message()
    handler._comfy(method, path, payload or {}, {})
    return handler.response


@pytest.mark.parametrize("target,channel", [("1;bad", "cu132"), ("2.14.1", "bad"), ("2.14", "cu132")])
def test_invalid_request(target, channel):
    assert call("POST", "/comfy/ssh/upgrade-torch", {"target": target, "channel": channel})[1] == HTTPStatus.BAD_REQUEST


def test_busy_and_success():
    instance = Mock()
    instance.status.return_value = {"connected": True, "host": "engine.example"}
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    with patch("image_gen.server._ssh_service", return_value=instance), patch("comfyui.engine_manager.engine_manager", return_value=manager):
        instance.upgrade_engine_torch.side_effect = RuntimeError("busy")
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1"})[1] == HTTPStatus.CONFLICT
        instance.upgrade_engine_torch.side_effect = None
        instance.upgrade_engine_torch.return_value = "job"
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1"})[0] == {"jobId": "job", "mode": "remote"}
        instance.upgrade_engine_torch.assert_called_with("2.14.1", "cu132", expected_host="engine.example")
        manager.remote_engine_status.return_value = {"source": "settings", "url": "http://other.example:17000"}
        assert call("POST", "/comfy/ssh/upgrade-torch", {"target": "2.14.1"})[1] == HTTPStatus.CONFLICT


def test_info_receives_active_engine_host():
    instance = Mock()
    instance.get_engine_torch_info.return_value = {"hostMatched": False, "live": False, "jobId": "job"}
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "settings", "url": "http://engine.example:17000"}
    with patch("image_gen.server._ssh_service", return_value=instance), patch("comfyui.engine_manager.engine_manager", return_value=manager):
        assert call("GET", "/comfy/ssh/torch-info")[0]["jobId"] == "job"
        instance.get_engine_torch_info.assert_called_once_with(expected_host="engine.example")


def test_info_uses_local_probe_when_engine_is_local():
    manager = Mock()
    manager.remote_engine_status.return_value = {"source": "local", "url": ""}
    with patch("comfyui.engine_manager.engine_manager", return_value=manager), patch(
        "comfyui.torch_upgrade_local.get_engine_torch_info", return_value={"mode": "local", "live": True}
    ) as probe:
        assert call("GET", "/comfy/ssh/torch-info")[0]["mode"] == "local"
        probe.assert_called_once_with()


def test_unknown_version_is_rejected_with_allowed_versions():
    payload, status = call("POST", "/comfy/ssh/upgrade-torch", {"target": "9.9.9"})
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
