# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写收件箱:落盘/cursor 轮询/ack 清理。"""

from __future__ import annotations

import pytest

from engines.comfyui import bridge_inbox, manifest as cm


@pytest.fixture()
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(tmp_path / "comfyui"))
    cm._read_cache.clear()
    yield tmp_path / "comfyui"
    cm._read_cache.clear()


def test_append_list_ack_roundtrip(home):
    first = bridge_inbox.append({"shotTarget": "S01-01"}, "aGVsbG8=")
    second = bridge_inbox.append({"shotTarget": "S01-02"}, "d29ybGQ=")
    assert (first, second) == (1, 2)

    listing = bridge_inbox.list_since(0)
    assert listing["cursor"] == 2
    assert [item["shotTarget"] for item in listing["items"]] == ["S01-01", "S01-02"]
    assert listing["items"][0]["imageB64"] == "aGVsbG8="

    assert bridge_inbox.list_since(1)["items"][0]["shotTarget"] == "S01-02"
    slim = bridge_inbox.list_since(1, include_image=False)
    assert "imageB64" not in slim["items"][0]

    bridge_inbox.append({"shotTarget": "S01-03", "meta": {"kind": "video"}}, "bXA0", "videoB64")
    video = bridge_inbox.list_since(1)["items"][1]
    assert video["videoB64"] == "bXA0"
    assert "videoB64" not in bridge_inbox.list_since(1, include_image=False)["items"][1]

    assert bridge_inbox.ack(1) == 1
    assert bridge_inbox.list_since(0)["items"][0]["shotTarget"] == "S01-02"


def test_inbox_survives_module_reload(home):
    bridge_inbox.append({"shotTarget": "S01"}, "eg==")
    import importlib

    importlib.reload(bridge_inbox)
    assert bridge_inbox.list_since(0)["items"][0]["shotTarget"] == "S01"  # 落盘为源
