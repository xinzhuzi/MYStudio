# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""manying_nodes 契约测试(源码位可测:引擎库全懒加载)。

对拍 design.md 2.1 节点契约表:注册面/INPUT_TYPES/RETURN_TYPES/回写失败
大白话;bridge 传输层 mock urllib 验令牌头与载荷形状。"""

from __future__ import annotations

import base64
import io
import json
import sys
import types
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest

from engines.comfyui.manying_nodes import NODE_CLASS_MAPPINGS, bridge


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_first_batch_nodes():
    assert set(NODE_CLASS_MAPPINGS) == {
        "ManyingPrompt", "ManyingReference", "ManyingGenerated", "ManyingShot", "ManyingMusic3",
    }
    for node in NODE_CLASS_MAPPINGS.values():
        assert node.CATEGORY == "manying"


# ── ManyingPrompt:STRING 双出(核实点③落定)──────────────
def test_prompt_outputs_plain_strings():
    node = NODE_CLASS_MAPPINGS["ManyingPrompt"]()
    inputs = node.INPUT_TYPES()
    assert set(inputs["required"]) == {"positive", "negative"}
    assert node.RETURN_TYPES == ("STRING", "STRING")
    assert node.RETURN_NAMES == ("positive", "negative")
    assert node.run("p", "n") == ("p", "n")
    assert node.run(None, None) == ("", "")


# ── ManyingReference:input 目录读图,缺图大白话────────────
def test_reference_reads_input_dir_image(tmp_path, monkeypatch):
    from PIL import Image

    Image.new("RGB", (4, 4), (255, 0, 0)).save(tmp_path / "ref.png")

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_annotated_filepath = lambda name: str(tmp_path / name)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    node = NODE_CLASS_MAPPINGS["ManyingReference"]()
    (tensor,) = node.run("ref.png")
    array = tensor.numpy()
    assert array.shape == (1, 4, 4, 3)
    assert array.max() > 0.9  # 红色通道到位


def test_reference_missing_file_raises_plain_language(tmp_path, monkeypatch):
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_annotated_filepath = lambda name: str(tmp_path / name)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    node = NODE_CLASS_MAPPINGS["ManyingReference"]()
    with pytest.raises(RuntimeError, match="参考图不存在"):
        node.run("missing.png")


# ── ManyingGenerated:终端节点,deliver 透传参数────────────
def test_generated_is_output_node_and_delegates(tmp_path):
    node = NODE_CLASS_MAPPINGS["ManyingGenerated"]()
    inputs = node.INPUT_TYPES()
    assert inputs["required"]["images"][0] == "IMAGE"
    assert node.OUTPUT_NODE is True
    assert node.RETURN_TYPES == ()

    class _FakeFrame:
        def numpy(self):
            return np.full((4, 4, 3), 0.5, dtype=np.float32)

    fake = [_FakeFrame()]
    with patch.object(bridge.writeback, "deliver", return_value={"accepted": True, "id": 7}) as deliver:
        result = node.run(fake, "S01-02", prompt="p", meta='{"seed": 1}')
    deliver.assert_called_once_with(fake, "S01-02", "p", '{"seed": 1}')
    assert result["result"] == ()
    assert result["ui"]["manying"]["shotTarget"] == "S01-02"


# ── bridge 传输:令牌头+载荷形状+失败大白话 ───────────────
class _FakeResponse:
    def __init__(self, body: dict, status: int = 200):
        self._body = json.dumps(body).encode()
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self):
        return self._body


def test_writeback_posts_png_with_token(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_BRIDGE_URL", "http://127.0.0.1:9123/")
    monkeypatch.setenv("MYSTUDIO_BRIDGE_TOKEN", "tok-1")

    class _Frame:
        def numpy(self):
            return np.full((2, 2, 3), 1.0, dtype=np.float32)

    captured = {}

    def _fake_urlopen(request, timeout=0):
        captured["url"] = request.full_url
        captured["token"] = request.headers.get("X-manying-image-token")
        captured["payload"] = json.loads(request.data.decode())
        return _FakeResponse({"accepted": True, "id": 3})

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        body = bridge.writeback.deliver([_Frame()], "S02-01", "p", "not-json")

    assert captured["url"] == "http://127.0.0.1:9123/comfy/bridge/writeback"
    assert captured["token"] == "tok-1"
    payload = captured["payload"]
    assert payload["shotTarget"] == "S02-01"
    assert payload["meta"] == {"raw": "not-json"}
    assert base64.b64decode(payload["imageB64"])[:4] == b"\x89PNG"
    assert body["accepted"] is True


def test_writeback_unreachable_raises_plain_language(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_BRIDGE_URL", "http://127.0.0.1:9")

    class _Frame:
        def numpy(self):
            return np.zeros((2, 2, 3), dtype=np.float32)

    with patch("urllib.request.urlopen", side_effect=OSError("refused")):
        with pytest.raises(RuntimeError, match="成图回写失败"):
            bridge.writeback.deliver([_Frame()], "", "", "")


def test_settings_env_overrides():
    import os

    old = {k: os.environ.get(k) for k in ("MYSTUDIO_BRIDGE_URL", "MYSTUDIO_BRIDGE_TOKEN")}
    try:
        os.environ["MYSTUDIO_BRIDGE_URL"] = "http://localhost:17595/"
        os.environ.pop("MYSTUDIO_BRIDGE_TOKEN", None)
        assert bridge.settings.bridge_url() == "http://localhost:17595"
        assert bridge.settings.bridge_token() == ""
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


# ── ManyingMusic3:本地作曲(09-09 MiniMax M3 转入 ComfyUI)────────
def test_music3_serve_url_resolution(monkeypatch, tmp_path):
    from engines.comfyui.manying_nodes.nodes.manying_music3 import resolve_serve_url

    monkeypatch.delenv("MYSTUDIO_MUSIC3_SERVE_URL", raising=False)
    monkeypatch.delenv("MYSTUDIO_USER_DATA", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    assert resolve_serve_url() == "http://127.0.0.1:11273"  # 无配置回落默认

    (tmp_path / "Library" / "Application Support" / "漫影工作室").mkdir(parents=True)
    monkeypatch.setenv("MYSTUDIO_USER_DATA", str(tmp_path / "Library" / "Application Support" / "漫影工作室"))
    assert resolve_serve_url() == "http://127.0.0.1:11273"  # 配置在但无 port 键

    monkeypatch.setenv("MYSTUDIO_MUSIC3_SERVE_URL", "http://127.0.0.1:19999/")
    assert resolve_serve_url() == "http://127.0.0.1:19999"  # env 优先,尾斜杠剥


def test_music3_contract_and_offline_error(monkeypatch):
    from engines.comfyui.manying_nodes.nodes import manying_music3 as mod

    node = mod.ManyingMusic3()
    inputs = node.INPUT_TYPES()["required"]
    assert set(inputs) == {"prompt", "lyrics", "duration_seconds", "steps", "seed"}
    assert node.RETURN_TYPES == ("AUDIO",)

    def boom(url, payload, timeout):
        raise OSError("conn refused")

    monkeypatch.setattr(mod, "_http_json", boom)
    monkeypatch.setattr(mod, "resolve_serve_url", lambda: "http://127.0.0.1:11273")
    try:
        node.run("中国风", "", 60, 30, 7)
        raised = False
    except RuntimeError as exc:
        raised = "辅助→音乐" in str(exc)
    assert raised, "serve 未起须大白话指路"


def test_music3_wav_to_audio():
    import io as _io

    import numpy as np
    import soundfile as sf

    from engines.comfyui.manying_nodes.nodes import manying_music3 as mod

    sr, data = sf.read(_io.BytesIO(b"") if False else None, dtype="float32") if False else (44100, np.zeros((2, 4410), dtype="float32"))
    buf = _io.BytesIO()
    sf.write(buf, data.T, sr, format="WAV")
    wav_bytes = buf.getvalue()

    captured = {}

    def fake_http(url, payload, timeout):
        captured["url"] = url
        captured["payload"] = payload
        return wav_bytes

    mod._http_json = fake_http
    mod.resolve_serve_url = lambda: "http://127.0.0.1:11273"
    node = mod.ManyingMusic3()
    audio = node.run("史诗战斗曲", "  ", 60, 30, 7)[0]
    import torch

    assert captured["url"].endswith("/v1/audio/music-generations")
    assert captured["payload"]["lyrics"] == "[Instrumental]"  # 空歌词回落纯音乐
    assert audio["sample_rate"] == sr
    assert tuple(audio["waveform"].shape) == (1, 2, 4410)  # (batch, channels, samples)
    assert audio["waveform"].dtype == torch.float32
