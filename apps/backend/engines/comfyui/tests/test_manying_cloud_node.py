# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""漫影云端生图节点契约(系统 python3 可跑,torch/PIL 懒加载不触达)。"""

from __future__ import annotations

import base64
import io
import json
import urllib.error
from unittest import mock

import pytest

from engines.comfyui import manying_nodes as manying_nodes_pkg
from engines.comfyui.manying_nodes.bridge import settings
from engines.comfyui.manying_nodes.nodes import manying_cloud_image as node_mod


def test_node_registered_with_display_name():
    assert manying_nodes_pkg.NODE_CLASS_MAPPINGS["ManyingCloudImage"] is node_mod.ManyingCloudImage
    assert manying_nodes_pkg.NODE_DISPLAY_NAME_MAPPINGS["ManyingCloudImage"] == "漫影 云端生图"


def test_input_types_shape():
    spec = node_mod.ManyingCloudImage.INPUT_TYPES()
    assert spec["required"]["prompt"][0] == "STRING"
    assert spec["optional"]["aspect_ratio"][0] == node_mod.ASPECT_RATIOS
    assert spec["optional"]["aspect_ratio"][1]["default"] == "auto"
    assert spec["optional"]["reference"][0] == "IMAGE"
    assert node_mod.ManyingCloudImage.RETURN_TYPES == ("IMAGE",)


def test_cloud_relay_settings_read_env(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_CLOUD_RELAY_URL", "http://127.0.0.1:19999/")
    monkeypatch.setenv("MYSTUDIO_CLOUD_RELAY_TOKEN", "t-ok")
    assert settings.cloud_relay_url() == "http://127.0.0.1:19999"
    assert settings.cloud_relay_token() == "t-ok"
    monkeypatch.delenv("MYSTUDIO_CLOUD_RELAY_URL")
    monkeypatch.delenv("MYSTUDIO_CLOUD_RELAY_TOKEN")
    assert settings.cloud_relay_url() == settings.DEFAULT_CLOUD_RELAY_URL
    assert settings.cloud_relay_token() == ""


class _FakeResponse:
    def __init__(self, body: dict, status: int = 200):
        self._body = json.dumps(body).encode("utf-8")
        self.status = status

    def read(self) -> bytes:
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def _png_bytes() -> bytes:
    # 1×1 红点 PNG(与 PIL 解耦的固定字节,契约面只关心透传)
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4"
        "z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=="
    )


def test_request_posts_relay_contract(monkeypatch):
    captured = {}

    def fake_urlopen(request, timeout=None):
        captured["url"] = request.full_url
        captured["token"] = request.get_header("X-manying-cloud-token")
        captured["body"] = json.loads(request.data.decode("utf-8"))
        captured["timeout"] = timeout
        return _FakeResponse({"ok": True, "imageB64": base64.b64encode(_png_bytes()).decode()})

    monkeypatch.setenv("MYSTUDIO_CLOUD_RELAY_URL", "http://127.0.0.1:17596")
    monkeypatch.setenv("MYSTUDIO_CLOUD_RELAY_TOKEN", "manying-cloud-relay")
    with mock.patch.object(node_mod.urllib.request, "urlopen", fake_urlopen):
        data = node_mod.request_cloud_image(
            prompt="一只猫", negative_prompt="模糊", aspect_ratio="16:9", reference_b64s=["QUJD"])
    assert captured["url"] == "http://127.0.0.1:17596/v1/cloud/images/generations"
    assert captured["token"] == "manying-cloud-relay"
    assert captured["body"] == {
        "prompt": "一只猫", "negativePrompt": "模糊", "aspectRatio": "16:9", "referenceB64s": ["QUJD"]}
    assert captured["timeout"] == 420
    assert data == _png_bytes()


def test_request_error_surfaces_plain_language(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_CLOUD_RELAY_URL", "http://127.0.0.1:17596")
    monkeypatch.delenv("MYSTUDIO_CLOUD_RELAY_TOKEN", raising=False)

    err = urllib.error.HTTPError(
        "url", 503, "unavailable", None,
        io.BytesIO(json.dumps({"error": "漫影应用未连接"}).encode("utf-8")))

    with mock.patch.object(node_mod.urllib.request, "urlopen", side_effect=err):
        with pytest.raises(RuntimeError, match="漫影云端生图被拒\\(HTTP 503\\):漫影应用未连接"):
            node_mod.request_cloud_image(prompt="x", negative_prompt="", aspect_ratio="")

    with mock.patch.object(node_mod.urllib.request, "urlopen", side_effect=OSError("refused")):
        with pytest.raises(RuntimeError, match="漫影云端通道未接通"):
            node_mod.request_cloud_image(prompt="x", negative_prompt="", aspect_ratio="")

    ok_no_image = _FakeResponse({"ok": True})
    with mock.patch.object(node_mod.urllib.request, "urlopen", return_value=ok_no_image):
        with pytest.raises(RuntimeError, match="未返回图像"):
            node_mod.request_cloud_image(prompt="x", negative_prompt="", aspect_ratio="")
