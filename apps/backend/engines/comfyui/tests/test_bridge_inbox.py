# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""bridge 回写收件箱:落盘/cursor 轮询/ack 清理。"""

from __future__ import annotations

import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError

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


def test_exact_ack_retains_skipped_items_and_durable_sequence(home):
    first = bridge_inbox.append({"meta": {"originProjectId": "project-a"}}, "eg==")
    second = bridge_inbox.append({"meta": {"originProjectId": "project-b"}}, "eg==")
    third = bridge_inbox.append({}, "eg==")
    assert bridge_inbox.ack(ids=[second, second]) == 1
    assert [item["id"] for item in bridge_inbox.list_since(0)["items"]] == [first, third]
    assert bridge_inbox.ack(ids=[second]) == 0
    assert bridge_inbox.ack(ids=[]) == 0
    assert bridge_inbox.ack(ids=[first, third]) == 2
    importlib.reload(bridge_inbox)
    assert bridge_inbox.append({}, "eg==") == third + 1


@pytest.mark.parametrize("ids", [[True], [0], [-1], [1.5], ["1"], "1", [1, None]])
def test_invalid_exact_ack_fails_before_deleting_any_item(home, ids):
    first = bridge_inbox.append({}, "eg==")
    with pytest.raises(ValueError, match="确认"):
        bridge_inbox.ack(ids=ids)
    assert bridge_inbox.list_since(0)["items"][0]["id"] == first


def test_inbox_survives_module_reload(home):
    bridge_inbox.append({"shotTarget": "S01"}, "eg==")
    import importlib

    importlib.reload(bridge_inbox)
    assert bridge_inbox.list_since(0)["items"][0]["shotTarget"] == "S01"  # 落盘为源


def test_ids_increase_after_full_ack_and_reload(home):
    first = bridge_inbox.append({"shotTarget": "first"}, "eg==")
    assert bridge_inbox.ack(first) == 1
    importlib.reload(bridge_inbox)

    second = bridge_inbox.append({"shotTarget": "second"}, "eg==")

    assert second > first
    assert bridge_inbox.list_since(first)["items"][0]["id"] == second


def test_ids_increase_after_full_ack_and_new_process(home):
    first = bridge_inbox.append({}, "eg==")
    bridge_inbox.ack(first)
    env = dict(os.environ, PYTHONPATH=str(Path(__file__).resolve().parents[3]))
    child = subprocess.run(
        [sys.executable, "-c", "from engines.comfyui import bridge_inbox; print(bridge_inbox.append({}, 'eg=='))"],
        env=env, capture_output=True, text=True, check=True, timeout=10,
    )

    assert int(child.stdout.strip()) > first


def test_legacy_ids_survive_ack_before_first_new_append(home):
    directory = home / "bridge-inbox"
    directory.mkdir(parents=True)
    (directory / "42.json").write_text(json.dumps({"id": 42, "imageB64": "eg=="}))

    assert bridge_inbox.ack(42) == 1
    importlib.reload(bridge_inbox)

    assert bridge_inbox.append({}, "eg==") > 42


def test_legacy_files_are_listed_in_numeric_order(home):
    directory = home / "bridge-inbox"
    directory.mkdir(parents=True)
    for item_id in [2, 10, 99999999, 100000000]:
        (directory / f"{item_id}.json").write_text(json.dumps({"id": item_id}))

    assert [item["id"] for item in bridge_inbox.list_since(0)["items"]] == [2, 10, 99999999, 100000000]


def test_list_cursor_never_moves_backwards(home):
    bridge_inbox.append({}, "eg==")

    assert bridge_inbox.list_since(50) == {"cursor": 50, "items": []}


@pytest.mark.parametrize("broken", ['{"id": 2', "[]", "null"])
def test_unreadable_legacy_item_blocks_later_cumulative_ack(home, broken):
    for _ in range(3):
        bridge_inbox.append({}, "eg==")
    damaged = home / "bridge-inbox/00000002.json"
    damaged.write_text(broken)

    listing = bridge_inbox.list_since(0)

    assert listing["cursor"] == 1
    assert [item["id"] for item in listing["items"]] == [1]
    bridge_inbox.ack(listing["cursor"])
    assert damaged.read_text() == broken
    assert (home / "bridge-inbox/00000003.json").exists()


def test_metadata_cannot_override_allocated_id(home):
    item_id = bridge_inbox.append({"id": 999}, "eg==")

    assert bridge_inbox.list_since(0)["items"][0]["id"] == item_id


def test_legacy_payload_id_uses_durable_filename(home):
    directory = home / "bridge-inbox"
    directory.mkdir(parents=True)
    legacy = directory / "00000002.json"
    original = json.dumps({"id": 999, "imageB64": "eg=="})
    legacy.write_text(original)

    assert bridge_inbox.list_since(0)["items"][0]["id"] == 2
    assert legacy.read_text() == original


def test_failed_serialization_does_not_publish_partial_item(home):
    with pytest.raises(TypeError):
        bridge_inbox.append({"unserializable": object()}, "eg==")

    assert bridge_inbox.list_since(0) == {"cursor": 0, "items": []}
    assert not list((home / "bridge-inbox").glob("[0-9]*.json"))
    assert bridge_inbox.append({}, "eg==") > 1


def test_failed_item_publication_reserves_id_across_reload(home, monkeypatch):
    replace = Path.replace

    def fail_item(self, target):
        if Path(target).stem.isdigit():
            raise OSError("simulated publication failure")
        return replace(self, target)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", fail_item)
        with pytest.raises(OSError, match="publication failure"):
            bridge_inbox.append({}, "eg==")

    assert bridge_inbox.list_since(0) == {"cursor": 0, "items": []}
    importlib.reload(bridge_inbox)
    assert bridge_inbox.append({}, "eg==") == 2


def test_failed_sequence_publication_keeps_pending_items(home, monkeypatch):
    first = bridge_inbox.append({}, "eg==")
    replace = Path.replace

    def fail_sequence(self, target):
        if Path(target).name == ".sequence.json":
            raise OSError("simulated sequence failure")
        return replace(self, target)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "replace", fail_sequence)
        with pytest.raises(OSError, match="sequence failure"):
            bridge_inbox.append({}, "eg==")
        with pytest.raises(OSError, match="sequence failure"):
            bridge_inbox.ack(first)

    assert [item["id"] for item in bridge_inbox.list_since(0)["items"]] == [first]
    assert bridge_inbox.append({}, "eg==") == first + 1


@pytest.mark.parametrize("state", ["{", "[]", '{"lastId": true}', '{"lastId": -1}', '{"lastId": "3"}'])
def test_corrupt_sequence_fails_closed_without_deleting_items(home, state):
    first = bridge_inbox.append({}, "eg==")
    path = home / "bridge-inbox/.sequence.json"
    path.write_text(state)

    with pytest.raises(RuntimeError, match="序号"):
        bridge_inbox.append({}, "eg==")
    with pytest.raises(RuntimeError, match="序号"):
        bridge_inbox.ack(first)

    assert path.read_text() == state
    assert bridge_inbox.list_since(0)["items"][0]["id"] == first


def test_existing_legacy_item_advances_stale_sequence(home):
    bridge_inbox.append({}, "eg==")
    (home / "bridge-inbox/00000080.json").write_text('{"id": 80, "imageB64": "eg=="}')

    assert bridge_inbox.append({}, "eg==") == 81


def test_poll_waits_for_atomic_publication(home, monkeypatch):
    before_publish = threading.Event()
    release_publish = threading.Event()
    poll_started = threading.Event()
    replace = Path.replace

    def pause_item(self, target):
        if Path(target).stem.isdigit():
            before_publish.set()
            assert release_publish.wait(5)
        return replace(self, target)

    def poll():
        poll_started.set()
        return bridge_inbox.list_since(0)

    monkeypatch.setattr(Path, "replace", pause_item)
    with ThreadPoolExecutor(max_workers=2) as executor:
        producer = executor.submit(bridge_inbox.append, {}, "eg==")
        try:
            assert before_publish.wait(5)
            assert not list((home / "bridge-inbox").glob("[0-9]*.json"))
            consumer = executor.submit(poll)
            assert poll_started.wait(5)
            with pytest.raises(TimeoutError):
                consumer.result(timeout=0.05)
        finally:
            release_publish.set()
        item_id = producer.result(timeout=5)
        result = consumer.result(timeout=5)

    assert result["cursor"] == item_id
    assert result["items"] == [{"id": item_id, "imageB64": "eg=="}]


def test_ack_waits_for_consistent_poll_snapshot(home, monkeypatch):
    first = bridge_inbox.append({}, "eg==")
    second = bridge_inbox.append({}, "eg==")
    read_started = threading.Event()
    release_read = threading.Event()
    ack_started = threading.Event()
    read_text = Path.read_text

    def pause_read(self, *args, **kwargs):
        if self.name == "00000001.json":
            read_started.set()
            assert release_read.wait(5)
        return read_text(self, *args, **kwargs)

    def acknowledge():
        ack_started.set()
        return bridge_inbox.ack(second)

    monkeypatch.setattr(Path, "read_text", pause_read)
    with ThreadPoolExecutor(max_workers=2) as executor:
        consumer = executor.submit(bridge_inbox.list_since, 0)
        try:
            assert read_started.wait(5)
            acknowledger = executor.submit(acknowledge)
            assert ack_started.wait(5)
            with pytest.raises(TimeoutError):
                acknowledger.result(timeout=0.05)
        finally:
            release_read.set()
        result = consumer.result(timeout=5)
        assert acknowledger.result(timeout=5) == 2

    assert [item["id"] for item in result["items"]] == [first, second]
    assert result["cursor"] == second


def test_concurrent_appends_allocate_unique_ids(home):
    with ThreadPoolExecutor(max_workers=8) as executor:
        ids = list(executor.map(lambda n: bridge_inbox.append({"shotTarget": str(n)}, "eg=="), range(24)))

    assert sorted(ids) == list(range(1, 25))
    assert [item["id"] for item in bridge_inbox.list_since(0)["items"]] == list(range(1, 25))
    bridge_inbox.ack(max(ids))
    assert bridge_inbox.append({}, "eg==") == 25


def test_interrupted_legacy_ack_preserves_sequence_before_deletion(home, monkeypatch):
    directory = home / "bridge-inbox"
    directory.mkdir(parents=True)
    for item_id in [11, 12]:
        (directory / f"{item_id:08d}.json").write_text(json.dumps({"id": item_id}))
    unlink = Path.unlink
    deleted = []

    def interrupt_ack(self, *args, **kwargs):
        if self.stem.isdigit():
            if deleted:
                raise OSError("simulated ack interruption")
            deleted.append(self.name)
        return unlink(self, *args, **kwargs)

    with monkeypatch.context() as patch:
        patch.setattr(Path, "unlink", interrupt_ack)
        with pytest.raises(OSError, match="ack interruption"):
            bridge_inbox.ack(12)

    assert len(deleted) == 1
    importlib.reload(bridge_inbox)
    assert bridge_inbox.ack(12) == 1
    assert bridge_inbox.append({}, "eg==") == 13


def test_failed_fsync_does_not_publish_item(home, monkeypatch):
    def fail_sync(_descriptor):
        raise OSError("simulated flush failure")

    with monkeypatch.context() as patch:
        patch.setattr(bridge_inbox.os, "fsync", fail_sync)
        with pytest.raises(OSError, match="flush failure"):
            bridge_inbox.append({}, "eg==")

    assert bridge_inbox.list_since(0) == {"cursor": 0, "items": []}
    assert bridge_inbox.append({}, "eg==") == 1
