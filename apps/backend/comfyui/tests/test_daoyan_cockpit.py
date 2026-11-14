# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""章节驾驶舱测试(1114:选章→剧本/导演计划/分镜表自动带出来)。

被测 = my_nodes/daoyan_server.py 纯函数层:merge_storyboards 跨分片并集/
latest_agent_work/chapter_payload 三件/chapter_image_bytes 白名单/
import_storyboard 镜行→segment+图拷贝。零引擎依赖(tmp 目录注入)。
"""
from __future__ import annotations

import json
from pathlib import Path

from comfyui.my_nodes import daoyan_server as srv


def _mk_project(root: Path) -> Path:
    """最小项目盘:novel/drama+chapters+store 分片(manifest/storyboards/agent)。"""
    loc = root / "MA"
    (loc / "novel" / "drama").mkdir(parents=True)
    (loc / "novel" / "drama" / "chapter-001_漫剧.md").write_text(
        "# 道劫 EP01：断剑初醒\n# 范围与目标：测试\n\n## 剧情梗概\n梗概行\n\n"
        "1-1 金水河码头 拂晓/外 ·约50秒\n人物：独孤剑尘\n镜头1：雾中渡河\n"
        "OS（旁白，沉）：道起于劫。\n", encoding="utf-8")
    (loc / "novel" / "chapters").mkdir(parents=True)
    (loc / "novel" / "chapters" / "chapter-001.md").write_text(
        "# 第1章：断剑为谁而鸣\n> 卷：第一卷\n", encoding="utf-8")
    cdir = loc / "store" / "studio-workflow" / "chapters" / "chapter-001"
    cdir.mkdir(parents=True)
    wf = loc / "store" / "studio-workflow"
    (wf / "manifest.json").write_text(json.dumps(
        {"chapterIndex": [{"id": "chapter-001", "index": 1,
                           "title": "第1章：断剑为谁而鸣"}],
         "activeChapterId": "chapter-001"}, ensure_ascii=False), encoding="utf-8")
    # 两个分镜分片(后文件胜:镜2 描述更新;镜3 只在后片=并集)
    (cdir / "storyboards-001-aaa.json").write_text(json.dumps(
        {"state": {"storyboards": [
            {"index": 1, "id": "sb-001-1", "duration": 5,
             "videoDesc": "旧描述一", "prompt": "p1", "line": "台词一",
             "mediaRef": {"kind": "image", "path":
                          "project-file://p1/workflow-images/c1/sb1.png"}},
            {"index": 2, "id": "sb-001-2", "duration": 4,
             "videoDesc": "旧描述二", "prompt": "p2", "line": "",
             "mediaRef": None}]}}, ensure_ascii=False), encoding="utf-8")
    (cdir / "storyboards-002-bbb.json").write_text(json.dumps(
        {"state": {"storyboards": [
            {"index": 2, "id": "sb-001-2", "duration": 4,
             "videoDesc": "新描述二", "prompt": "p2", "line": "l2",
             "mediaRef": {"kind": "image", "path":
                          "project-file://p1/workflow-images/c1/sb2.png"}},
            {"index": 3, "id": "sb-001-3", "duration": 30,
             "videoDesc": "超长镜", "prompt": "p3", "line": "",
             "mediaRef": None}]}}, ensure_ascii=False), encoding="utf-8")
    (cdir / "agent-work-data-001-x.json").write_text(json.dumps(
        {"state": {"agentWorkData": [
            {"key": "directorPlan", "data": "旧计划",
             "updatedAt": "t1"}]}}, ensure_ascii=False), encoding="utf-8")
    (cdir / "agent-work-data-002-y.json").write_text(json.dumps(
        {"state": {"agentWorkData": [
            {"key": "eventAnalysis", "data": "别键"},
            {"key": "directorPlan", "data": "《导演创作规划》最新",
             "updatedAt": "t2"}]}}, ensure_ascii=False), encoding="utf-8")
    # 分镜图实体(sb1 在白名单目录;两张同内容测幂等拷贝)
    img_dir = loc / "workflow-images" / "c1"
    img_dir.mkdir(parents=True)
    (img_dir / "sb1.png").write_bytes(b"\x89PNG-fake-shot1")
    (img_dir / "sb2.png").write_bytes(b"\x89PNG-fake-shot2")
    return loc


def test_chapter_payload_three_sources(tmp_path):
    loc = _mk_project(tmp_path)
    payload = srv.chapter_payload(loc, "chapter-001")
    assert payload.get("title") == "第1章：断剑为谁而鸣"
    assert "雾中渡河" in payload["script"]["text"]
    assert payload["script"]["lines"] >= 6
    assert payload["directorPlan"]["text"] == "《导演创作规划》最新"
    assert payload["directorPlan"]["updatedAt"] == "t2"
    items = payload["storyboards"]["items"]
    assert payload["storyboards"]["count"] == 3
    assert [i["index"] for i in items] == [1, 2, 3]
    assert items[1]["videoDesc"] == "新描述二"  # 后分片胜
    assert items[0]["image"] == "workflow-images/c1/sb1.png"


def test_chapter_payload_no_data_states(tmp_path):
    loc = _mk_project(tmp_path)
    payload = srv.chapter_payload(loc, "chapter-999")
    assert payload["script"]["text"] == ""
    assert payload["storyboards"]["count"] == 0
    assert payload["directorPlan"]["text"] == ""
    bad = srv.chapter_payload(loc, "../etc")
    assert bad.get("error")


def test_chapter_image_whitelist(tmp_path):
    loc = _mk_project(tmp_path)
    data, err = srv.chapter_image_bytes(loc, "workflow-images/c1/sb1.png")
    assert data is not None and data.startswith(b"\x89PNG")
    assert srv.chapter_image_bytes(loc, "../projects/store.json")[0] is None
    assert srv.chapter_image_bytes(loc, "novel/drama/x.md")[1] == \
        "路径不在分镜图/连续性资产白名单"
    assert srv.chapter_image_bytes(loc, "workflow-images/c1/none.png")[0] is None


def test_import_storyboard_maps_segments(tmp_path):
    loc = _mk_project(tmp_path)
    input_dir = tmp_path / "engine-input"
    r = srv.import_storyboard(loc, "chapter-001", input_dir)
    assert r["ok"] and r["count"] == 3
    segs = r["segments"]
    assert segs[0]["id"] == "sb-001-1" and segs[0]["mode"] == "r2v"
    assert segs[0]["prompt"]["description"] == "旧描述一"
    assert segs[0]["images"] == ["daoyan-sb-chapter-001-001.png"]
    assert (input_dir / "daoyan-sb-chapter-001-001.png").read_bytes() \
        .startswith(b"\x89PNG")
    assert segs[1]["prompt"]["description"] == "新描述二"
    assert segs[2]["seconds"] == 15.0  # 30s 钳到产线上限
    assert segs[2]["images"] == []     # 无图镜=空引用
    # 幂等:重跑不重复拷
    srv.import_storyboard(loc, "chapter-001", input_dir)
    assert len(list(input_dir.glob("daoyan-sb-*.png"))) == 2
    # 无分镜章
    r2 = srv.import_storyboard(loc, "chapter-888", input_dir)
    assert not r2["ok"] and "无分镜" in r2["error"]


def test_merge_storyboards_latest_wins_and_union(tmp_path):
    cdir = tmp_path / "c"
    cdir.mkdir()
    (cdir / "storyboards-001-a.json").write_text(json.dumps(
        {"state": {"storyboards": [{"index": 1, "videoDesc": "旧"}]}}),
        encoding="utf-8")
    (cdir / "storyboards-002-b.json").write_text(json.dumps(
        {"state": {"storyboards": [{"index": 1, "videoDesc": "新"},
                                    {"index": 2}]}}), encoding="utf-8")
    merged = srv.merge_storyboards(cdir)
    assert [m["index"] for m in merged] == [1, 2]
    assert merged[0]["videoDesc"] == "新"


def test_parse_script_shots_fallback(tmp_path):
    """剧本解析兜底(1114 用户勘误:每章剧本都有分镜,不止2章)。"""
    text = ("# 道劫 EP01\n## 剧情梗概\nx\n\n"
            "1-1 码头 拂晓/外 ·约50秒\n人物：甲\n"
            "镜头1：雾中渡河，风灯浮动\n台词行不进镜\n"
            "镜头2：高台俯瞰\n\n"
            "1-2 巷口 夜/内 ·约10秒\n"
            "镜头3：檐下打量\n")
    shots = srv.parse_script_shots(text)
    assert [s["index"] for s in shots] == [1, 2, 3]
    assert shots[0]["duration"] == 15  # 50s 场次钳到产线上限
    assert shots[2]["duration"] == 10  # 场次 1-2
    assert "雾中渡河" in shots[0]["videoDesc"]


def test_chapter_payload_falls_back_to_script(tmp_path):
    """无分片章:分镜表=剧本解析(fromScript=True);有分片章不受扰。"""
    loc = _mk_project(tmp_path)
    p1 = srv.chapter_payload(loc, "chapter-001")
    assert p1["storyboards"]["count"] == 3
    assert p1["storyboards"]["fromScript"] is False  # 有分片不兜底
    (loc / "novel" / "drama" / "chapter-777_漫剧.md").write_text(
        "1-1 x ·约8秒\n镜头1：甲\n镜头2：乙\n", encoding="utf-8")
    p2 = srv.chapter_payload(loc, "chapter-777")
    assert p2["storyboards"]["count"] == 2
    assert p2["storyboards"]["fromScript"] is True
    assert p2["storyboards"]["items"][0]["videoDesc"] == "甲"


def test_import_storyboard_fallback_from_script(tmp_path):
    loc = _mk_project(tmp_path)
    (loc / "novel" / "drama" / "chapter-777_漫剧.md").write_text(
        "1-1 x ·约8秒\n镜头1：甲\n镜头2：乙\n", encoding="utf-8")
    r = srv.import_storyboard(loc, "chapter-777", tmp_path / "in")
    assert r["ok"] and r["count"] == 2 and r["fromScript"] is True
    assert r["segments"][0]["prompt"]["description"] == "甲"
    assert r["segments"][0]["seconds"] == 8
    assert r["segments"][0]["images"] == []
