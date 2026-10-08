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
from unittest.mock import patch

import numpy as np
import pytest

from engines.comfyui.my_nodes import (
    NODE_CLASS_MAPPINGS,
    NODE_DISPLAY_NAME_MAPPINGS,
    bridge,
)


# ── 注册面 ────────────────────────────────────────────────
def _json_types(bases_json_path) -> list:
    """道劫底座真源 types[] 现读(1004 集中化:qi21_bases.json dict 外壳,
    原平铺 daojie_bases.json 退役删件;十档=九型+自由)。"""
    import json as _json
    data = _json.loads(bases_json_path.read_text(encoding="utf-8"))
    return data["types"]


def test_registry_exposes_first_batch_nodes():
    assert set(NODE_CLASS_MAPPINGS) == {
        "MyPrompt", "MyReference", "MyGenerated", "MyShot", "MyCloudImage",
        "MyStage", "MyStylesLibrary", "MyDaojieBase", "MyDaojieLoras",
        "MyDaojieLoraStack",  # 09-19 LoRA快速启停 R2:14 槽九型驱动栈节点
        "MyDaojieRoute",  # 09-21 [90] 子图按型线路路由(只选线不加载)
        "MyQi21DaojieBase",  # 09-23 qi21 道劫九选一底座(仿 K2 MyDaojieBase)
        "MyQi21SpeedSelect",  # 09-29 qi21 加速区并行化:三支路 LATENT 单点懒选择
        "MyQi21RgbaSelect",  # 0929 D6 三态选择;1001 ① 文案轮:自动/true/false
        "MyQi21PromptAssembly",  # 1001 S8 R7 集成(裁定A上游):装配全文=主体句+BASE+美术风格底座 单口真源
        "MyQi21PromptSelect",  # 1001 S8 R7 集成(裁定A下游):最终文本=pe开关选路+透明文本包裹(lazy 破环)
        "MyQi21WhSuggest",  # 1001 S8 R7 集成:画幅联动链 8合1;1008 建议路清退(现役=手动成对/九型直通)
        "MyQi21ChinesePE",  # 1004 中文PE:drop-in替上游PE(系统指令内存patch中文规则+负向双出)
        "MyQi21SubjectSelect",  # 1005 ㉜ 管线重序:主体句过PE后拼型/底座(pe开选PE扩写文)
        "MyQi21PromptPreview",  # 1005 正负双预览(合成一个节点)
        "MyQi21BoolBranch",  # 1005 布尔分支(true/false双路;㊄已退役留档=回滚杠杆)
        "MyQi21PESwitch",  # 1005 ㊝ PE开关路由:主体句+开关→PE路/直写路+true/false双出
        "MyQi21FinalOutput",  # 1005 ㊄ 拆双类:t2i专用最终输出(零PE槽,透明包裹+双口输出)
        "MyQi21ApiPE",  # 1006 API版PE:LM Studio本机大模型按真源教材扩写(批C 九入全上下文+双口;服务不在=透传)
        "MyQi21BasesText",  # 1006 真源文本:qi21_bases.json三节只读出口(全上下文节点化)
        "MyQi21系统提示词",  # 1006 九轮:零控件专用类(无下拉)
        "MyQi21色卡",
        "MyQi21美术风格底座",
        "MyImageGridSplit",  # 0929 TE-MAN 排查 B3:宫格切割回灌 input(A5 铁约束随档)
        "MyVideoFrameGrab",  # 0929 TE-MAN 排查 B1:视频截帧回灌 input(keyframes 最后一跳)
        "MyImageABCompare",  # 0929 TE-MAN 排查 B2:图对比审片(canvas 滑帘+2-7x 放大镜)
        "MyVideoABCompare",  # 0929 TE-MAN 排查 B2:视频对比审片(双 video 同步+帧对齐)
        "MyModelBus",     # 09-21 模型分线排(1进9出,画布走线治理备件)
        "MyCharsheetLabels",  # 09-20 设定表汉字程序叠加(案一)
        "MyImageSave",     # 1001 TE-MAN B7①:存图可追溯(核心存图子类+底部 prompt 面板,ui.myPrompt 回传)
        # 09-14 manying→my 改名前的旧键别名(存量工作流加载兼容)
        "ManyingPrompt", "ManyingReference", "ManyingGenerated", "ManyingShot",
        "ManyingCloudImage", "ManyingStage"}
    # 双表全集等集(0930 F1):显示名表缺键=引擎画布菜单回退英文类名
    # (MyCharsheetLabels 先例),与 CLASS 表键集互锁防再发。
    assert set(NODE_DISPLAY_NAME_MAPPINGS) == set(NODE_CLASS_MAPPINGS), (
        "NODE_DISPLAY_NAME_MAPPINGS 与 NODE_CLASS_MAPPINGS 键集漂移:"
        f"仅显示名表有 {sorted(set(NODE_DISPLAY_NAME_MAPPINGS) - set(NODE_CLASS_MAPPINGS))},"
        f"仅 CLASS 表有 {sorted(set(NODE_CLASS_MAPPINGS) - set(NODE_DISPLAY_NAME_MAPPINGS))}")
    for name, node in NODE_CLASS_MAPPINGS.items():
        # 1004 类目统一:右键菜单单分组「漫影」——道劫走线族(09-21)仍归
        # 「漫影/道劫」子组,其余恒 "漫影"(原 "my" 并入,用户裁定)。
        if name in ("MyDaojieRoute", "MyModelBus"):
            assert node.CATEGORY == "漫影/道劫"
        else:
            assert node.CATEGORY == "漫影"


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
    # 1004 集中化:combo=真源家 qi21_bases.json types[] 全十档(九型+自由末位;
    # 原九型 sidecar daojie_bases.json 退役删件,锚随迁)
    assert combo[0] == [
        "人物", "场景", "道具", "美宣", "人物多视图",
        "高清人脸", "分镜剧情图", "表情差分", "概念气氛图", "自由"]
    assert combo[1]["default"] == "人物"
    # 09-18 分辨率数据面:追加 aspect(COMBO,对齐 [61] aspect_ratio 槽)/
    # megapixels(FLOAT) 两出,前两 STRING 槽位不动(存量图 [80] 链 45/46 免改);
    # 09-19 第五出 base(COMBO 型直通)=驱动按型 LoRA [85] 供线
    assert node.RETURN_TYPES == ("STRING", "STRING", "COMBO", "FLOAT", "COMBO", "INT", "INT")  # 09-20 +WH 两出
    assert node.RETURN_NAMES == ("positive", "negative", "aspect", "megapixels", "base", "width", "height")

    from engines.comfyui.my_nodes.nodes import my_daojie_base
    bases = _json_types(my_daojie_base._BASES_JSON)
    renwu = next(e for e in bases if e["zh"] == "人物")
    lock = my_daojie_base._load_art_style_base()
    # 1008 用户令「[4010] 应该只有类型句才对」:只出型层,三层拼装归 [4013] PE
    pos, _neg, _ar, _mp, _base, _w, _h = node.run("人物", positive="一位女修士")
    assert pos == renwu["positive_text"]  # 纯型层
    assert lock["positive"] not in pos  # 底座不在
    assert "一位女修士" not in pos  # 主体句不在
    pos_empty, neg_empty, ar_empty, mp_empty, _b, _w, _h = node.run("人物")
    assert pos_empty == renwu["positive_text"]
    assert neg_empty == renwu["negative_text"]  # 纯型层负向
    assert (ar_empty, mp_empty) == (renwu["aspect_ratio"], renwu["megapixels"])


def test_daojie_base_resolution_outputs_nine_types():
    """九型+自由分辨率两出全枚举实测:aspect 逐字命中官方 ResolutionSelector
    AspectRatio 枚举(引擎 comfy_extras/nodes_resolution.py,8 项;sidecar
    测试不可 import 引擎库,枚举镜像硬编码于此)、megapixels 1008 快出档缩编
    (用户令 1-2MP 快出+后放大):道具/高清人脸/自由 1.0(09-19 用户裁定出
    1024×1024,该节点口径 1.0 MP 精确=1024×1024;自由=Q2.1 十档末位
    1:1/1.0MP 兜底)、多视图 1.8、其余五型 1.5(4.2 旧档退役入 git 史)、
    两值与真源家 qi21_bases.json types[] 字段一比一(原 daojie_bases.json
    退役,锚随迁);正负 STRING=1004 三层拼装/合并语义(逐字锚归
    test_my_daojie_base.py 专项件)。"""
    node = NODE_CLASS_MAPPINGS["MyDaojieBase"]()
    from engines.comfyui.my_nodes.nodes import my_daojie_base
    bases = _json_types(my_daojie_base._BASES_JSON)
    official_aspects = {
        "1:1 (Square)", "2:3 (Portrait Photo)", "3:2 (Photo)",
        "3:4 (Portrait Standard)", "4:3 (Standard)",
        "9:16 (Portrait Widescreen)", "16:9 (Widescreen)", "21:9 (Ultrawide)",
    }
    expected_mp = {"道具": 1.0, "高清人脸": 1.0, "自由": 1.0,
                   "人物多视图": 1.8}.get  # 其余五型 1.5(缺省)
    for entry in bases:
        pos, neg, aspect, megapixels, base_out, _w, _h = node.run(entry["zh"])
        assert base_out == entry["zh"]  # 09-19 第五出=型直通(驱动按型 LoRA 供线)
        assert aspect == entry["aspect_ratio"], entry["zh"]
        assert aspect in official_aspects, f"「{entry['zh']}」aspect 非官方枚举逐字串"
        assert megapixels == entry["megapixels"] == expected_mp(entry["zh"], 1.5), entry["zh"]
        # 1008:留空=纯型层(不再拼底座);负向=纯型层负向(中文基线非空)
        assert pos == entry["positive_text"]
        if pos:  # 自由型正向=空串,跳过句号检查
            assert pos.endswith("。")
        assert neg == entry.get("negative_text", "") or (neg and "模糊" in neg)


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


def test_bridge_settings_config_payload_follows_env(monkeypatch):
    # 0924 令牌随机化:web 侧栏经 /my_bridge/config 取装机随机令牌;
    # payload 与 settings env 严格同源,env 缺失=空令牌(fail-closed)
    from engines.comfyui.my_nodes import bridge_settings_server

    monkeypatch.setenv("MYSTUDIO_BRIDGE_URL", "http://127.0.0.1:9123/")
    monkeypatch.setenv("MYSTUDIO_BRIDGE_TOKEN", "tok-config")
    assert bridge_settings_server.config_payload() == {
        "bridgeUrl": "http://127.0.0.1:9123",
        "bridgeToken": "tok-config",
    }

    monkeypatch.delenv("MYSTUDIO_BRIDGE_TOKEN", raising=False)
    assert bridge_settings_server.config_payload()["bridgeToken"] == ""


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
