# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
"""制作动作通道测试:提交/去重/游标/ack/上限。"""

from __future__ import annotations

from engines.comfyui import bridge_actions


def setup_function(_):
    bridge_actions.reset_for_tests()


def test_submit_roundtrip_and_ack():
    first = bridge_actions.submit("generate-images")
    second = bridge_actions.submit("generate-videos")
    assert first["duplicate"] is False and second["duplicate"] is False
    listed = bridge_actions.list_since(0)
    assert [item["kind"] for item in listed["items"]] == ["generate-images", "generate-videos"]
    # 游标只取增量
    assert bridge_actions.list_since(first["id"])["items"][0]["kind"] == "generate-videos"
    # ack 清理
    deleted = bridge_actions.ack(second["id"])
    assert deleted == 2
    assert bridge_actions.list_since(0)["items"] == []


def test_submit_dedupes_same_kind():
    bridge_actions.submit("generate-images")
    again = bridge_actions.submit("generate-images")
    assert again["duplicate"] is True
    assert len(bridge_actions.list_since(0)["items"]) == 1


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
    ):
        result = bridge_actions.submit(kind)
        assert result["duplicate"] is False
    kinds = [item["kind"] for item in bridge_actions.list_since(0)["items"]]
    assert set(kinds) >= {
        "generate-images",
        "generate-videos",
        "generate-director-plan",
        "generate-storyboard-table",
        "rebuild-workbench-tracks",
    }


def test_note_roundtrip_and_dedup_update():
    """09-12 B1 补充要求:note 随动作入队/回读;同类在途重提=note 更新胜出。"""
    bridge_actions.reset_for_tests()
    reply = bridge_actions.submit("generate-director-plan", "  多加两个反派伏笔  ")
    assert reply["duplicate"] is False
    listed = bridge_actions.list_since(0)["items"]
    assert listed[0]["note"] == "多加两个反派伏笔"
    # 同类在途 + 新 note → duplicate 但 note 更新
    bridge_actions.submit("generate-director-plan", "改成三个伏笔")
    listed = bridge_actions.list_since(0)["items"]
    assert len(listed) == 1
    assert listed[0]["note"] == "改成三个伏笔"
    # 无 note 提交不带 note 键(消费侧 userInstruction 回落空串)
    bridge_actions.ack(99)
    bridge_actions.submit("generate-storyboard-table")
    listed = bridge_actions.list_since(0)["items"]
    assert "note" not in listed[0]
    # 超长截断
    bridge_actions.ack(99)
    bridge_actions.submit("generate-storyboard-table", "长" * 5000)
    listed = bridge_actions.list_since(0)["items"]
    assert len(listed[0]["note"]) == 2000
    bridge_actions.reset_for_tests()
