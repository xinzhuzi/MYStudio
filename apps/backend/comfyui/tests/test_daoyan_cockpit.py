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
    # 1115 带出链下沉(件#9 拟改法2):description 尾补否定线(J1);
    # summary=时长/格式/媒介身份首句+画面描述列作场景身份(J6)
    assert segs[0]["prompt"]["description"] == "旧描述一 No text or logos."
    assert segs[0]["prompt"]["summary"] == "5秒，16:9横版视频。p1"
    assert segs[0]["images"] == ["daoyan-sb-chapter-001-001.png"]
    assert (input_dir / "daoyan-sb-chapter-001-001.png").read_bytes() \
        .startswith(b"\x89PNG")
    assert segs[1]["prompt"]["description"] == "新描述二 No text or logos."
    assert segs[1]["prompt"]["summary"] == "4秒，16:9横版视频。p2"
    assert segs[2]["seconds"] == 15.0  # 30s 钳到产线上限
    assert segs[2]["prompt"]["summary"] == "15秒，16:9横版视频。p3"
    assert segs[2]["images"] == []     # 无图镜=空引用
    # 幂等:重跑不重复拷
    srv.import_storyboard(loc, "chapter-001", input_dir)
    assert len(list(input_dir.glob("daoyan-sb-*.png"))) == 2
    # 无分镜章
    r2 = srv.import_storyboard(loc, "chapter-888", input_dir)
    assert not r2["ok"] and "无分镜" in r2["error"]


def test_import_storyboard_prompt_prefill_j6_j7_j1(tmp_path):
    """带出链出词层吸收 J6/J7/J1(1115 审计件#9 拟改法2,对齐官方样例
    AIMixer-r2v「No text or logos.」与 external-groups「15秒，16:9横版视频。」):
    summary 首句=时长规格+媒介+场景身份;运镜前置到动作之前(中文归一英文
    受控词,词表对齐 App 链 mapH3CameraMove);description 尾补否定线且不重复补。"""
    cdir = tmp_path / "store" / "studio-workflow" / "chapters" / "chapter-001"
    cdir.mkdir(parents=True)
    (cdir / "storyboards-001-a.json").write_text(json.dumps(
        {"state": {"storyboards": [
            # J7 中文运镜(推近)+J6 场景身份列
            {"index": 1, "id": "s1", "duration": 6, "videoDesc": "少年拔剑",
             "prompt": "雪夜竹林",
             "shotSemantics": {"cameraMove": "缓慢推近", "shotSize": "中景"}},
            # 英文受控运镜=原样透传
            {"index": 2, "id": "s2", "duration": 7.5, "videoDesc": "回身望塔",
             "shotSemantics": {"cameraMove": "slow push-in"}},
            # 左摇/变焦拉远归一+已含守卫线不重复补
            {"index": 3, "id": "s3", "duration": 5,
             "videoDesc": "门开 No text or logos.",
             "shotSemantics": {"cameraMove": "左摇"}},
            # 零运镜零正文=description 空段待手填;summary 仍恒身份首句
            {"index": 4, "id": "s4", "duration": 5, "videoDesc": "",
             "prompt": ""},
            # 分镜域枚举 id(camera-move-bridge 词表)查表归一
            {"index": 5, "id": "s5", "duration": 5, "videoDesc": "踏阶而上",
             "shotSemantics": {"cameraMove": "crane-up"}},
        ]}}, ensure_ascii=False), encoding="utf-8")
    r = srv.import_storyboard(tmp_path, "chapter-001", tmp_path / "in")
    assert r["ok"] and r["count"] == 5
    segs = r["segments"]
    # J6:身份首句(时长/格式/媒介)领衔,场景身份(画面描述列)随后
    assert segs[0]["prompt"]["summary"] == "6秒，16:9横版视频。雪夜竹林"
    # J7:运镜句先于动作正文;J1:尾补否定线
    assert segs[0]["prompt"]["description"] \
        == "The camera uses a Push In. 少年拔剑 No text or logos."
    # 半秒时长规格成文;英文受控词透传不改写
    assert segs[1]["prompt"]["summary"] == "7.5秒，16:9横版视频。"
    assert segs[1]["prompt"]["description"] \
        == "The camera uses a slow push-in. 回身望塔 No text or logos."
    # 左摇→Pan Left;正文已含守卫线=不重复补
    assert segs[2]["prompt"]["description"] \
        == "The camera uses a Pan Left. 门开 No text or logos."
    # 零内容=空段(不硬造);summary 恒身份句
    assert segs[3]["prompt"]["description"] == ""
    assert segs[3]["prompt"]["summary"] == "5秒，16:9横版视频。"
    # 枚举 id 查表(crane-up→Crane Up)前置
    assert segs[4]["prompt"]["description"] \
        == "The camera uses a Crane Up. 踏阶而上 No text or logos."
    # retention/soundscape 分镜表无对应列=恒空(面板模板只填空段接管)
    for seg in segs:
        assert seg["prompt"]["retention"] == ""
        assert seg["prompt"]["soundscape"] == ""


def test_map_camera_move_vocabulary():
    """运镜归一词表(对齐 App 链 h3-shot-prompt.ts mapH3CameraMove+
    camera-move-bridge 17 值枚举):中文族逐词归一/枚举 id 查表/英文受控词
    透传/未知词原样/空=空。"""
    m = srv.map_camera_move
    assert m("") == "" and m(None) == ""
    assert m("推近") == "Push In" and m("快速推进") == "Push In"
    assert m("拉远") == "Pull Out"
    assert m("左摇") == "Pan Left" and m("右摇") == "Pan Right" \
        and m("摇镜") == "Pan"
    assert m("横移") == "Truck" and m("左移") == "Truck Left"
    assert m("跟拍") == "Tracking Shot"
    assert m("升") == "Pedestal Up" and m("降") == "Pedestal Down"
    assert m("俯拍") == "Tilt Down" and m("仰拍") == "Tilt Up"
    assert m("环绕") == "Arc Shot"
    assert m("变焦") == "Zoom In" and m("变焦拉远") == "Zoom Out"
    assert m("固定机位") == srv.STATIC_HOLD and m("静止") == srv.STATIC_HOLD
    # 分镜域 17 值枚举 id(camera-move-bridge 词表)查表归一
    assert m("static") == srv.STATIC_HOLD and m("tracking") == "Tracking Shot"
    assert m("orbit") == "Arc Shot"
    assert m("zoom-in") == "Zoom In" and m("zoom-out") == "Zoom Out"
    assert m("pan-left") == "Pan Left" and m("tilt-down") == "Tilt Down"
    assert m("dolly-in") == "Dolly In" and m("dolly-out") == "Dolly Out"
    assert m("truck-left") == "Truck Left" and m("crane-up") == "Crane Up"
    assert m("drone-aerial") == "Aerial Shot" and m("360-roll") == "360 Roll"
    assert m("slow push in") == "slow push in"   # 英文受控词透传
    assert m("手持呼吸感") == "手持呼吸感"        # 未知词原样不改写


def test_description_prefill_static_hold_sentence():
    """固定机位=持静句(The camera holds still.),不出「uses a static」
    病句;J1 守卫线照补。"""
    out = srv._description_prefill("少女回眸", "static")
    assert out == "The camera holds still. 少女回眸 No text or logos."
    assert srv._description_prefill("空转", "固定机位") \
        == "The camera holds still. 空转 No text or logos."


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
    # 剧本兜底镜无画面描述列=summary 仅身份首句;描述体仍尾补否定线
    assert r["segments"][0]["prompt"]["description"] == "甲 No text or logos."
    assert r["segments"][0]["prompt"]["summary"] == "8秒，16:9横版视频。"
    assert r["segments"][0]["seconds"] == 8
    assert r["segments"][0]["images"] == []
