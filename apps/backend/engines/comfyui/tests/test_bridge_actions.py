# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""制作动作通道测试:提交/去重/游标/ack/上限。"""

from __future__ import annotations

import importlib

import pytest

from engines.comfyui import bridge_actions


def setup_function(_):
    bridge_actions.reset_for_tests()


def test_stale_epoch_ack_cannot_delete_restarted_queue():
    bridge_actions.submit("view-doc", origin_project_id="project-a", origin_episode_id="episode-1")
    old_queue = bridge_actions.list_since(0)["queueId"]
    importlib.reload(bridge_actions)
    new_item = bridge_actions.submit("view-doc", origin_project_id="project-a", origin_episode_id="episode-1")
    new_queue = bridge_actions.list_since(0)["queueId"]
    assert new_queue != old_queue
    assert bridge_actions.ack(new_item["id"], old_queue, ids=[new_item["id"]]) == 0
    assert len(bridge_actions.list_since(0)["items"]) == 1


def test_exact_ack_retains_other_project_and_requires_epoch_and_ids():
    first = bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("generate-images", origin_project_id="project-b", origin_episode_id="episode-1")
    listing = bridge_actions.list_since(0)
    assert second["duplicate"] is False
    assert [item["originProjectId"] for item in listing["items"]] == ["project-a", "project-b"]
    assert bridge_actions.ack(second["id"]) == 0
    assert bridge_actions.ack(second["id"], listing["queueId"]) == 0
    assert bridge_actions.ack(second["id"], listing["queueId"], ids=[second["id"]]) == 1
    assert [item["id"] for item in bridge_actions.list_since(0)["items"]] == [first["id"]]


@pytest.mark.parametrize("origin", [None, "", " ", 17])
def test_submit_rejects_missing_or_invalid_origin(origin):
    with pytest.raises(ValueError, match="来源项目"):
        bridge_actions.submit("generate-images", origin_project_id=origin)
    assert bridge_actions.list_since(0)["items"] == []


@pytest.mark.parametrize("ids", [[True], [0], [-1], [1.5], ["1"], "1", [1, None]])
def test_invalid_action_ack_does_not_delete_any_item(ids):
    item = bridge_actions.submit("view-doc", origin_project_id="project-a", origin_episode_id="episode-1")
    listing = bridge_actions.list_since(0)
    with pytest.raises(ValueError, match="确认"):
        bridge_actions.ack(queue_id=listing["queueId"], ids=ids)
    assert bridge_actions.list_since(0)["items"][0]["id"] == item["id"]


def test_dedup_update_is_confined_to_exact_project_origin():
    first = bridge_actions.submit("generate-images", "a", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("generate-images", "b", origin_project_id="project-b", origin_episode_id="episode-1")
    updated = bridge_actions.submit("generate-images", "updated a", origin_project_id="project-a", origin_episode_id="episode-1")
    assert updated["id"] == first["id"]
    assert updated["duplicate"] is True
    assert [(entry["id"], entry["note"]) for entry in bridge_actions.list_since(0)["items"]] == [
        (first["id"], "updated a"), (second["id"], "b"),
    ]


def test_same_project_different_episodes_keep_independent_actions():
    first = bridge_actions.submit("generate-images", "first", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("generate-images", "second", origin_project_id="project-a", origin_episode_id="episode-2")
    updated = bridge_actions.submit("generate-images", "new first", origin_project_id="project-a", origin_episode_id="episode-1")
    assert second["duplicate"] is False
    assert updated["id"] == first["id"]
    assert [(item["originEpisodeId"], item["note"]) for item in bridge_actions.list_since(0)["items"]] == [
        ("episode-1", "new first"), ("episode-2", "second"),
    ]


@pytest.mark.parametrize("episode", [None, "", " ", 17])
def test_submit_rejects_missing_or_invalid_episode(episode):
    with pytest.raises(ValueError, match="来源章节"):
        bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id=episode)
    assert bridge_actions.list_since(0)["items"] == []


def test_submit_roundtrip_and_ack():
    first = bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("generate-videos", origin_project_id="project-a", origin_episode_id="episode-1")
    assert first["duplicate"] is False and second["duplicate"] is False
    listed = bridge_actions.list_since(0)
    assert [item["kind"] for item in listed["items"]] == ["generate-images", "generate-videos"]
    # 游标只取增量
    assert bridge_actions.list_since(first["id"])["items"][0]["kind"] == "generate-videos"
    # ack 清理
    deleted = bridge_actions.ack(second["id"], listed["queueId"], ids=[first["id"], second["id"]])
    assert deleted == 2
    assert bridge_actions.list_since(0)["items"] == []


def test_submit_dedupes_same_kind():
    bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
    again = bridge_actions.submit("generate-images", origin_project_id="project-a", origin_episode_id="episode-1")
    assert again["duplicate"] is True
    assert len(bridge_actions.list_since(0)["items"]) == 1


def test_full_queue_rejection_does_not_enqueue_or_consume_id():
    for index in range(bridge_actions.CAP):
        bridge_actions.submit("view-doc", str(index), origin_project_id="project-a", origin_episode_id="episode-1")
    before = bridge_actions.list_since(0)
    for _ in range(3):
        with pytest.raises(ValueError, match="上限"):
            bridge_actions.submit("edit-doc", "rejected", origin_project_id="project-a", origin_episode_id="episode-1")
    assert bridge_actions.list_since(0) == before
    bridge_actions.ack(queue_id=before["queueId"], ids=[item["id"] for item in before["items"]])
    assert bridge_actions.submit("edit-doc", origin_project_id="project-a", origin_episode_id="episode-1")["id"] == bridge_actions.CAP + 1


def test_full_queue_still_allows_updating_duplicate():
    original = bridge_actions.submit("generate-images", "old", origin_project_id="project-a", origin_episode_id="episode-1")
    for index in range(bridge_actions.CAP - 1):
        bridge_actions.submit("view-doc", str(index), origin_project_id="project-a", origin_episode_id="episode-1")
    result = bridge_actions.submit("generate-images", "new", origin_project_id="project-a", origin_episode_id="episode-1")
    assert result == {"id": original["id"], "kind": "generate-images", "duplicate": True}
    assert bridge_actions.list_since(0)["items"][0]["note"] == "new"
    assert len(bridge_actions.list_since(0)["items"]) == bridge_actions.CAP


def test_doc_kinds_exempt_from_dedupe():
    """09-13 用户裁定:全文/编辑=幂等 UI 开合,逐击送达(同 kind 不同节点常态)。"""
    bridge_actions.reset_for_tests()
    first = bridge_actions.submit("view-doc", "script", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("view-doc", "storyboardTable", origin_project_id="project-a", origin_episode_id="episode-1")
    third = bridge_actions.submit("edit-doc", "script", origin_project_id="project-a", origin_episode_id="episode-1")
    assert first["duplicate"] is False
    assert second["duplicate"] is False and second["id"] != first["id"]
    assert third["duplicate"] is False and third["id"] not in (first["id"], second["id"])
    items = bridge_actions.list_since(0)["items"]
    assert [(i["kind"], i.get("note")) for i in items] == [
        ("view-doc", "script"),
        ("view-doc", "storyboardTable"),
        ("edit-doc", "script"),
    ]


def test_shot_video_kinds_are_exempt_from_dedupe():
    first = bridge_actions.submit("open-shot-video", "shot-a", origin_project_id="project-a", origin_episode_id="episode-1")
    second = bridge_actions.submit("open-shot-video", "shot-b", origin_project_id="project-a", origin_episode_id="episode-1")
    assert first["duplicate"] is False
    assert second["duplicate"] is False
    assert [item.get("note") for item in bridge_actions.list_since(0)["items"]] == ["shot-a", "shot-b"]


def test_submit_rejects_unknown_kind():
    try:
        bridge_actions.submit("format-disk")
    except ValueError as exc:
        assert "未知动作类型" in str(exc)
    else:
        raise AssertionError("未知动作未拒")


def test_stage_node_action_kinds_allowed():
    """09-12 功能完备:老画布环节动作全量收编(节点按钮→宿主老派发器)。"""
    for kind in (
        "generate-images",
        "generate-videos",
        "generate-director-plan",
        "generate-storyboard-table",
        "rebuild-workbench-tracks",
        "open-shot-video",
    ):
        result = bridge_actions.submit(kind, origin_project_id="project-a", origin_episode_id="episode-1")
        assert result["duplicate"] is False
    kinds = [item["kind"] for item in bridge_actions.list_since(0)["items"]]
    assert set(kinds) >= {
        "generate-images",
        "generate-videos",
        "generate-director-plan",
        "generate-storyboard-table",
        "rebuild-workbench-tracks",
        "open-shot-video",
    }


def test_note_roundtrip_and_dedup_update():
    """09-12 B1 补充要求:note 随动作入队/回读;同类在途重提=note 更新胜出。"""
    bridge_actions.reset_for_tests()
    reply = bridge_actions.submit("generate-director-plan", "  多加两个反派伏笔  ", origin_project_id="project-a", origin_episode_id="episode-1")
    assert reply["duplicate"] is False
    listed = bridge_actions.list_since(0)["items"]
    assert listed[0]["note"] == "多加两个反派伏笔"
    # 同类在途 + 新 note → duplicate 但 note 更新
    bridge_actions.submit("generate-director-plan", "改成三个伏笔", origin_project_id="project-a", origin_episode_id="episode-1")
    listed = bridge_actions.list_since(0)["items"]
    assert len(listed) == 1
    assert listed[0]["note"] == "改成三个伏笔"
    # 无 note 提交不带 note 键(消费侧 userInstruction 回落空串)
    bridge_actions.ack(queue_id=bridge_actions.list_since(0)["queueId"], ids=[item["id"] for item in listed])
    bridge_actions.submit("generate-storyboard-table", origin_project_id="project-a", origin_episode_id="episode-1")
    listed = bridge_actions.list_since(0)["items"]
    assert "note" not in listed[0]
    # 超长截断
    bridge_actions.ack(queue_id=bridge_actions.list_since(0)["queueId"], ids=[item["id"] for item in listed])
    bridge_actions.submit("generate-storyboard-table", "长" * 5000, origin_project_id="project-a", origin_episode_id="episode-1")
    listed = bridge_actions.list_since(0)["items"]
    assert len(listed[0]["note"]) == 2000
    bridge_actions.reset_for_tests()
