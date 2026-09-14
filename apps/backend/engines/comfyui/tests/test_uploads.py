# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""参考图上传转发(uploads.upload_reference)契约测试。"""

from __future__ import annotations

import base64
import json
from unittest.mock import patch

import pytest

from engines.comfyui import manifest as cm
from engines.comfyui import uploads
from engines.comfyui.engine_manager import EngineOpError


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    write = {"engine": {"version": "v0.34.6", "port": 17001}}
    tmp_path_comfy = tmp_path / "comfyui"
    tmp_path_comfy.mkdir(parents=True)
    (tmp_path_comfy / "manifest.json").write_text(json.dumps(write), encoding="utf-8")
    cm._read_cache.clear()
    yield tmp_path_comfy
    cm._read_cache.clear()


class _FakeResponse:
    def __init__(self, body: dict):
        self._body = json.dumps(body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def test_upload_posts_multipart_with_overwrite(home):
    captured = {}

    def fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["boundary"] = request.headers["Content-type"].split("boundary=")[1]
        captured["body"] = request.data
        return _FakeResponse({"name": "my-ref-1-abc.png", "subfolder": "", "type": "input"})

    with patch("urllib.request.urlopen", side_effect=fake_urlopen):
        result = uploads.upload_reference(base64.b64encode(b"png-bytes").decode(), "my-ref-1-abc.png")

    assert "overwrite=true" in captured["url"]
    assert "17001" in captured["url"]
    assert b'filename="my-ref-1-abc.png"' in captured["body"]
    assert b"png-bytes" in captured["body"]
    assert result["name"] == "my-ref-1-abc.png"


def test_upload_rejects_bad_base64_and_empty(home):
    with pytest.raises(EngineOpError, match="base64"):
        uploads.upload_reference("!!!not-base64-checked-len", "a.png")
    with pytest.raises(EngineOpError, match="为空"):
        uploads.upload_reference(base64.b64encode(b"").decode(), "a.png")


def test_upload_engine_unreachable_raises_plain_language(home):
    import urllib.request

    with patch("urllib.request.urlopen", side_effect=OSError("refused")):
        with pytest.raises(EngineOpError, match="引擎不可达"):
            uploads.upload_reference(base64.b64encode(b"x").decode(), "a.png")
