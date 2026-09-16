# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""my_nodes 契约测试(源码位可测:引擎库全懒加载)。

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

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, bridge


# ── 注册面 ────────────────────────────────────────────────
def test_registry_exposes_first_batch_nodes():
    assert set(NODE_CLASS_MAPPINGS) == {
        "MyPrompt", "MyReference", "MyGenerated", "MyShot", "MyCloudImage",
        "MyStage", "MyStylesLibrary",
        # 09-14 manying→my 改名前的旧键别名(存量工作流加载兼容)
        "ManyingPrompt", "ManyingReference", "ManyingGenerated", "ManyingShot",
        "ManyingCloudImage", "ManyingStage"}
    for node in NODE_CLASS_MAPPINGS.values():
        assert node.CATEGORY == "my"


def test_legacy_aliases_deprecated_and_behaviour_aligned():
    """旧键别名:DEPRECATED(前端默认隐藏菜单)+ 与新类同行为;旧 Stage
    线型钉回 MANYING_FLOW 使纯旧链校验自洽。"""
    legacy_pairs = {
        "ManyingPrompt": "MyPrompt",
        "ManyingReference": "MyReference",
        "ManyingGenerated": "MyGenerated",
        "ManyingShot": "MyShot",
        "ManyingCloudImage": "MyCloudImage",
        "ManyingStage": "MyStage",
    }
    for legacy_key, canonical_key in legacy_pairs.items():
        legacy = NODE_CLASS_MAPPINGS[legacy_key]
        canonical = NODE_CLASS_MAPPINGS[canonical_key]
        assert getattr(legacy, "DEPRECATED", False) is True
        assert issubclass(legacy, canonical)
        if hasattr(canonical, "OUTPUT_NODE"):
            assert legacy.OUTPUT_NODE == canonical.OUTPUT_NODE
    legacy_stage = NODE_CLASS_MAPPINGS["ManyingStage"]
    assert legacy_stage.RETURN_TYPES == ("MANYING_FLOW",)
    assert legacy_stage.INPUT_TYPES()["optional"]["upstream"] == ("MANYING_FLOW",)
    result = NODE_CLASS_MAPPINGS["ManyingStage"]().run("script", "剧本", "已导入 3 章", status="已完成")
    assert result["result"] == ("flow",)


# ── MyStage:流程环节锚点(旧画布链迁移 09-11)─────────
def test_stage_flow_anchor_returns_ui_and_flow():
    node = NODE_CLASS_MAPPINGS["MyStage"]()
    inputs = node.INPUT_TYPES()
    assert set(inputs["required"]) == {"stage_key", "title", "summary"}
    assert inputs["optional"]["upstream"] == ("MY_FLOW",)
    assert node.RETURN_TYPES == ("MY_FLOW",)
    result = node.run("script", "剧本", "已导入 3 章", status="已完成")
    assert result["result"] == ("flow",)
    assert result["ui"]["my_stage"]["stageKey"] == "script"


# ── MyPrompt:STRING 双出(核实点③落定)──────────────
def test_prompt_outputs_plain_strings():
    node = NODE_CLASS_MAPPINGS["MyPrompt"]()
    inputs = node.INPUT_TYPES()
    assert set(inputs["required"]) == {"positive", "negative"}
    assert node.RETURN_TYPES == ("STRING", "STRING")
    assert node.RETURN_NAMES == ("positive", "negative")
    assert node.run("p", "n") == ("p", "n")
    assert node.run(None, None) == ("", "")


# ── MyReference:input 目录读图,缺图大白话────────────
def test_reference_reads_input_dir_image(tmp_path, monkeypatch):
    from PIL import Image

    Image.new("RGB", (4, 4), (255, 0, 0)).save(tmp_path / "ref.png")

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_annotated_filepath = lambda name: str(tmp_path / name)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    node = NODE_CLASS_MAPPINGS["MyReference"]()
    (tensor,) = node.run("ref.png")
    array = tensor.numpy()
    assert array.shape == (1, 4, 4, 3)
    assert array.max() > 0.9  # 红色通道到位


def test_reference_missing_file_raises_plain_language(tmp_path, monkeypatch):
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_annotated_filepath = lambda name: str(tmp_path / name)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    node = NODE_CLASS_MAPPINGS["MyReference"]()
    with pytest.raises(RuntimeError, match="参考图不存在"):
        node.run("missing.png")


# ── MyGenerated:终端节点,deliver 透传参数────────────
def test_generated_is_output_node_and_delegates(tmp_path):
    node = NODE_CLASS_MAPPINGS["MyGenerated"]()
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
    assert result["ui"]["my"]["shotTarget"] == "S01-02"


def test_shot_video_slot_is_optional_and_writes_latest_video(tmp_path, monkeypatch):
    node = NODE_CLASS_MAPPINGS["MyShot"]()
    assert node.INPUT_TYPES()["optional"]["video"] == ("VIDEO",)
    old_result = node.run("sb-1", "S01", "desc")
    assert old_result["ui"]["my_shot"]["shotId"] == "sb-1"

    output_dir = tmp_path / "output"
    video_dir = output_dir / "video" / "漫影" / "chapter-001" / "sb-1"
    video_dir.mkdir(parents=True)
    video_path = video_dir / "ambient_00001_.mp4"
    video_path.write_bytes(b"mp4")
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: str(output_dir)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)

    with patch.object(bridge.writeback, "deliver_video", return_value={"accepted": True, "id": 9}) as deliver:
        result = node.run("sb-1", "S01", "desc", video=object())

    deliver.assert_called_once()
    assert deliver.call_args.args[0] == "sb-1"
    assert deliver.call_args.args[2] == "video/漫影/chapter-001/sb-1"
    assert deliver.call_args.args[3] == "ambient"
    assert result["ui"]["my_shot"]["videoWriteback"] == 9


@pytest.mark.parametrize("shot_id", ["", "sb-chapter-001/escape", "../escape"])
def test_shot_video_writeback_rejects_empty_or_path_like_shot_id(shot_id):
    node = NODE_CLASS_MAPPINGS["MyShot"]()

    with pytest.raises(RuntimeError, match="合法shot_id"):
        node.run(shot_id, "S01", "desc", video=object())


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


def test_video_writeback_posts_video_payload_with_metadata(monkeypatch):
    monkeypatch.setenv("MYSTUDIO_BRIDGE_URL", "http://127.0.0.1:9123/")
    monkeypatch.setenv("MYSTUDIO_BRIDGE_TOKEN", "tok-video")
    captured = {}

    def _fake_urlopen(request, timeout=0):
        captured["payload"] = json.loads(request.data.decode())
        captured["token"] = request.headers.get("X-manying-image-token")
        return _FakeResponse({"accepted": True, "id": 8})

    with patch("urllib.request.urlopen", side_effect=_fake_urlopen):
        body = bridge.writeback.deliver_video(
            "sb-1",
            base64.b64encode(b"mp4").decode(),
            "video/漫影/chapter-001/sb-1",
            "ambient",
        )

    assert body["accepted"] is True
    assert captured["token"] == "tok-video"
    assert captured["payload"]["videoB64"] == base64.b64encode(b"mp4").decode()
    assert captured["payload"]["meta"] == {
        "kind": "video",
        "subfolder": "video/漫影/chapter-001/sb-1",
        "policy": "ambient",
    }


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
