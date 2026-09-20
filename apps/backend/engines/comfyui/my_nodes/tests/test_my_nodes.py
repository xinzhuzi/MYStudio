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
        "MyStage", "MyStylesLibrary", "MyDaojieBase", "MyDaojieLoras",
        "MyDaojieLoraStack",  # 09-19 LoRA快速启停 R2:14 槽九型驱动栈节点
        "MyCharsheetLabels",  # 09-20 设定表汉字程序叠加(案一)
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


def test_shot_video_slot_is_optional_and_writes_supplied_video(tmp_path, monkeypatch):
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

    class Video:
        def save_to(self, buffer, format="auto"):
            assert format == "mp4"
            buffer.write(b"supplied-mp4")

    prompt = {
        "100": {"inputs": {"video": ["4", 0]}},
        "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "video/漫影/chapter-001/sb-1/ambient"}},
    }
    with patch.object(bridge.writeback, "deliver_video", return_value={"accepted": True, "id": 9}) as deliver:
        result = node.run("sb-1", "S01", "desc", video=Video(), prompt=prompt, unique_id="100")

    deliver.assert_called_once()
    assert deliver.call_args.args[0] == "sb-1"
    assert base64.b64decode(deliver.call_args.args[1]) == b"supplied-mp4"
    assert deliver.call_args.args[2] == "video/漫影/chapter-001/sb-1"
    assert deliver.call_args.args[3] == "ambient"
    assert result["ui"]["my_shot"]["videoWriteback"] == 9


def test_shot_video_carries_origin_from_its_queued_node_only(tmp_path, monkeypatch):
    node = NODE_CLASS_MAPPINGS["MyShot"]()
    video_dir = tmp_path / "video" / "漫影" / "chapter-001" / "sb-1"
    video_dir.mkdir(parents=True)
    (video_dir / "ambient_00001_.mp4").write_bytes(b"mp4")
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_output_directory = lambda: str(tmp_path)
    monkeypatch.setitem(sys.modules, "folder_paths", folder_paths)
    queued = {"workflow": {"nodes": [
        {"id": 99, "properties": {"myOriginProjectId": "wrong-project"}},
        {"id": 100, "properties": {"myOriginProjectId": "project-a"}},
    ]}}
    class Video:
        def save_to(self, buffer, format="auto"):
            buffer.write(b"mp4")

    prompt = {
        "100": {"inputs": {"video": ["4", 0]}},
        "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "video/漫影/chapter-001/sb-1/ambient"}},
    }
    with patch.object(bridge.writeback, "deliver_video", return_value={"id": 1}) as deliver:
        node.run("sb-1", "S01", "desc", video=Video(), extra_pnginfo=queued, unique_id="100", prompt=prompt)
    assert deliver.call_args.kwargs["origin_project_id"] == "project-a"


def test_video_transport_preserves_origin_without_reading_active_project():
    with patch.object(bridge.writeback, "_post", return_value={"id": 1}) as post:
        bridge.writeback.deliver_video("sb-1", "bXA0", "video/漫影/chapter-001/sb-1", "ambient", origin_project_id="project-a")
    assert post.call_args.args[0]["meta"]["originProjectId"] == "project-a"


@pytest.mark.parametrize("shot_id", ["", "sb-chapter-001/escape", "../escape"])
def test_shot_video_writeback_rejects_empty_or_path_like_shot_id(shot_id):
    node = NODE_CLASS_MAPPINGS["MyShot"]()

    with pytest.raises(RuntimeError, match="合法shot_id"):
        node.run(shot_id, "S01", "desc", video=object())


# ── MyDaojieBase:九型底座下拉+装配收进节点(09-18;同日分辨率两出)──
def test_daojie_base_options_and_assembly():
    node = NODE_CLASS_MAPPINGS["MyDaojieBase"]()
    inputs = node.INPUT_TYPES()
    assert set(inputs["required"]) == {"base"}
    combo = inputs["required"]["base"]
    assert combo[0] == [
        "人物", "场景", "道具", "美宣", "三视图",
        "高清人脸", "分镜剧情图", "表情差分", "概念气氛图"]
    assert combo[1]["default"] == "人物"
    # 09-18 分辨率数据面:追加 aspect(COMBO,对齐 [61] aspect_ratio 槽)/
    # megapixels(FLOAT) 两出,前两 STRING 槽位不动(存量图 [80] 链 45/46 免改);
    # 09-19 第五出 base(COMBO 型直通)=驱动按型 LoRA [85] 供线
    assert node.RETURN_TYPES == ("STRING", "STRING", "COMBO", "FLOAT", "COMBO", "INT", "INT")  # 09-20 +WH 两出
    assert node.RETURN_NAMES == ("positive", "negative", "aspect", "megapixels", "base", "width", "height")

    import json as _json
    bases = _json.loads(
        (Path(__file__).resolve().parent.parent / "nodes" / "daojie_bases.json")
        .read_text(encoding="utf-8"))
    renwu = next(e for e in bases if e["zh"] == "人物")
    # 拼接行为:底座在前+主体句零分隔符直拼;留空=恒等纯底座
    pos, _neg, _ar, _mp, _base, _w, _h = node.run("人物", positive="一位女修士")
    assert pos == renwu["positive"] + "一位女修士"
    pos_empty, neg_empty, ar_empty, mp_empty, _b, _w, _h = node.run("人物")
    assert pos_empty == renwu["positive"]
    assert neg_empty == renwu["negative"]  # 输出非空(纯英文负面基线)
    assert (ar_empty, mp_empty) == (renwu["aspect_ratio"], renwu["megapixels"])


def test_daojie_base_resolution_outputs_nine_types():
    """九型分辨率两出全枚举实测:aspect 逐字命中官方 ResolutionSelector
    AspectRatio 枚举(引擎 comfy_extras/nodes_resolution.py,8 项;sidecar
    测试不可 import 引擎库,枚举镜像硬编码于此)、megapixels 道具/高清人脸
    1.0(09-19 用户裁定出 1024×1024,该节点口径 1.0 MP 精确=1024×1024)
    其余 4.2、
    两值与 daojie_bases.json 字段一比一;正负 STRING 原语义逐字不变。"""
    node = NODE_CLASS_MAPPINGS["MyDaojieBase"]()
    import json as _json
    bases = _json.loads(
        (Path(__file__).resolve().parent.parent / "nodes" / "daojie_bases.json")
        .read_text(encoding="utf-8"))
    official_aspects = {
        "1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)",
        "3:4 (Portrait Standard)", "4:3 (Standard)",
        "9:16 (Portrait Widescreen)", "16:9 (Widescreen)", "21:9 (Ultrawide)",
    }
    for entry in bases:
        pos, neg, aspect, megapixels, base_out, _w, _h = node.run(entry["zh"])
        assert base_out == entry["zh"]  # 09-19 第五出=型直通(驱动按型 LoRA 供线)
        assert aspect == entry["aspect_ratio"], entry["zh"]
        assert aspect in official_aspects, f"「{entry['zh']}」aspect 非官方枚举逐字串"
        expected_mp = 1.0 if entry["zh"] in ("道具", "高清人脸") else 4.2
        assert megapixels == entry["megapixels"] == expected_mp, entry["zh"]
        # 原两路 STRING 语义不受新出影响:留空=恒等纯底座/纯负面基线
        assert pos == entry["positive"]
        assert neg == entry["negative"]


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
