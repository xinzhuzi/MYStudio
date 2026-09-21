"""MyShot must forward the supplied VIDEO, never a similarly named output file."""

from __future__ import annotations

import base64
import os
import sys
import types
from unittest.mock import patch

import pytest

from engines.comfyui.my_nodes import NODE_CLASS_MAPPINGS, bridge


class SuppliedVideo:
    def __init__(self, payload=b"supplied-video"):
        self.payload = payload
        self.saved_formats = []

    def save_to(self, buffer, format="auto"):
        self.saved_formats.append(format)
        buffer.write(self.payload)

    def get_stream_source(self):
        raise AssertionError("Reading the underlying source would discard video edits")


def queued_prompt(prefix="video/漫影/chapter-a/sb-1/ambient"):
    return {
        "100": {"class_type": "MyShot", "inputs": {"video": ["4", 0]}},
        "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": prefix}},
    }


def run_queued(video, prompt, *, node_name="MyShot"):
    node = NODE_CLASS_MAPPINGS[node_name]()
    # Match ComfyUI's legacy-node hidden-input injection, including the old ABI.
    supplied = {
        "PROMPT": prompt,
        "UNIQUE_ID": "100",
        "EXTRA_PNGINFO": {"workflow": {"nodes": [
            {"id": 100, "properties": {"myOriginProjectId": "project-a"}},
        ]}},
    }
    hidden = {key: supplied[kind] for key, kind in node.INPUT_TYPES()["hidden"].items()}
    return node.run("sb-1", "S01", "description", video=video, **hidden)


@pytest.fixture
def other_output(tmp_path, monkeypatch):
    directory = tmp_path / "video" / "漫影" / "chapter-b" / "sb-1"
    directory.mkdir(parents=True)
    decoy = directory / "other-policy_99999_.mp4"
    decoy.write_bytes(b"unrelated-project-video")
    os.utime(decoy, (2_000_000_000, 2_000_000_000))
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: str(tmp_path)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)
    return decoy


@pytest.mark.parametrize("node_name", ["MyShot", "ManyingShot"])
def test_queued_video_identity_ignores_newer_same_shot_output(other_output, node_name):
    supplied = SuppliedVideo()
    with patch.object(bridge.writeback, "deliver_video", return_value={"id": 7}) as deliver:
        result = run_queued(supplied, queued_prompt(), node_name=node_name)
    assert base64.b64decode(deliver.call_args.args[1]) == b"supplied-video"
    assert supplied.saved_formats == ["mp4"]
    assert deliver.call_args.args[2:] == ("video/漫影/chapter-a/sb-1", "ambient")
    assert deliver.call_args.kwargs == {"origin_project_id": "project-a"}
    assert result["ui"]["my_shot"]["videoWriteback"] == 7


def test_video_writeback_does_not_require_any_output_file(tmp_path, monkeypatch):
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: str(tmp_path)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)
    with patch.object(bridge.writeback, "deliver_video", return_value={"id": 8}) as deliver:
        run_queued(SuppliedVideo(), queued_prompt())
    assert base64.b64decode(deliver.call_args.args[1]) == b"supplied-video"


@pytest.mark.parametrize("prompt", [
    None,
    {},
    {"100": {"inputs": {"video": ["missing", 0]}}},
    {"100": {"inputs": {"video": ["4", 1]}}, "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "video/漫影/chapter-a/sb-1/ambient"}}},
    {"100": {"inputs": {"video": ["4", 0]}}, "4": {"class_type": "Reroute", "inputs": {"filename_prefix": "video/漫影/chapter-a/sb-1/ambient"}}},
    queued_prompt(["prefix-node", 0]),
    queued_prompt("video/漫影/chapter-a/another-shot/ambient"),
    queued_prompt("video/漫影/../sb-1/ambient"),
    queued_prompt("video/漫影/chapter-a/sb-1/../../ambient"),
    queued_prompt("video/漫影/chapter-a/sb-1/bad\\policy"),
])
def test_ambiguous_or_unsafe_video_destination_fails_without_delivery(other_output, prompt):
    supplied = SuppliedVideo()
    with patch.object(bridge.writeback, "deliver_video") as deliver:
        with pytest.raises(RuntimeError, match="SaveVideo|路径|策略"):
            run_queued(supplied, prompt)
    deliver.assert_not_called()
    assert supplied.saved_formats == []


@pytest.mark.parametrize("failure", ["empty", "encoder", "oversize", "invalid"])
def test_failed_video_export_never_delivers_unrelated_output(other_output, failure):
    class FailedVideo:
        def save_to(self, buffer, format="auto"):
            if failure == "empty":
                return
            if failure == "encoder":
                raise ValueError("encoder failed")
            buffer.seek(64 * 1024 * 1024)
            buffer.write(b"x")

    supplied = object() if failure == "invalid" else FailedVideo()
    with patch.object(bridge.writeback, "deliver_video") as deliver:
        with pytest.raises(RuntimeError, match="视频|64MB"):
            run_queued(supplied, queued_prompt())
    deliver.assert_not_called()
