# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""业务侧栏数据面:快照推/拉/清洗/上限。"""

from __future__ import annotations

from engines.comfyui import bridge_sidepanel


def setup_function(_):
    bridge_sidepanel.reset_for_tests()


def test_update_and_snapshot_roundtrip():
    result = bridge_sidepanel.update(
        [
            {"id": "sb-1", "label": "S01 · 开篇", "episodeId": "ep-1", "videoReady": True, "imageReady": False},
            {"id": "sb-2", "label": "", "episodeId": "ep-1"},  # 空标签回落 id
        ],
        {"currentEpisodeId": "ep-1"},
    )
    assert result["updatedAt"] > 0
    snap = bridge_sidepanel.snapshot()
    assert snap["currentEpisodeId"] == "ep-1"
    shots = snap["shots"]
    assert [shot["id"] for shot in shots] == ["sb-1", "sb-2"]
    assert shots[0]["label"] == "S01 · 开篇"
    assert shots[1]["label"] == "sb-2"
    assert shots[0]["videoReady"] is True and shots[0]["imageReady"] is False
    assert shots[1]["videoReady"] is False


def test_update_filters_bad_entries_and_caps():
    bridge_sidepanel.update([{"id": "ok", "label": "x"}, {"label": "无id"}, "junk", 3])
    assert len(bridge_sidepanel.snapshot()["shots"]) == 1
    try:
        bridge_sidepanel.update([{"id": f"s{i}", "label": "x"} for i in range(501)])
    except ValueError as exc:
        assert "500" in str(exc)
    else:
        raise AssertionError("超上限未拒")


def test_snapshot_defaults_empty():
    snap = bridge_sidepanel.snapshot()
    assert snap == {"updatedAt": 0, "staleAfterMs": 900_000, "shots": [], "currentEpisodeId": "", "queue": []}


def test_queue_snapshot_roundtrip_and_clean():
    """09-12 B2 队列实时快照:合法条目清洗入库回读;非法状态/越界进度剔除。"""
    bridge_sidepanel.reset_for_tests()
    bridge_sidepanel.update(
        [{"id": "s1", "label": "S01", "episodeId": "chapter-001"}],
        {
            "currentEpisodeId": "chapter-001",
            "queue": [
                {"index": 3, "status": "running", "progress": 0.45},
                {"index": 4, "status": "failed", "progress": 9},      # 进度钳 1.0
                {"index": 5, "status": "bogus", "progress": 0.5},     # 状态非法剔除
                "junk",                                                # 非法条目剔除
            ],
        },
    )
    snap = bridge_sidepanel.snapshot()
    assert snap["queue"] == [
        {"index": 3, "status": "running", "progress": 0.45},
        {"index": 4, "status": "failed", "progress": 1.0},
    ]
    # 缺省=空队列
    bridge_sidepanel.update([{"id": "s1", "label": "S01"}], {"currentEpisodeId": "chapter-001"})
    assert bridge_sidepanel.snapshot()["queue"] == []
    bridge_sidepanel.reset_for_tests()
