"""PE 文本编码器件名按引擎在盘分叉(1118 用户令)单测:零网络零子进程。

服务链锚点:read_workflow 服务时按当前生效引擎的 CLIPLoader 在盘清单,
把 PE 别名组内缺件名换算成在盘名(repo 真源恒正典,磁盘/契约零改动)。
引擎清单一律打桩;探测函数仅用假 urlopen 验解析与 fail-open。
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from comfyui import manifest as cm
from comfyui import plugin_manager as pm

CANON_T2I = "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors"
INT8_T2I = "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors"
CANON_I2I = "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors"
INT8_I2I = "qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors"
HERETIC = "qwen3vl_8b_bf16_heretic.safetensors"


def _use_tmp_home(tmp_path, monkeypatch):
    home = tmp_path / "comfyui"
    monkeypatch.setenv("MYSTUDIO_COMFYUI_HOME", str(home))
    repo = tmp_path / "repo-workflows"
    monkeypatch.setattr(cm, "repo_workflows_dir", lambda: repo, raising=False)
    return home, repo


def _wf_text(names_with_ids) -> str:
    nodes = [{"id": nid, "type": "CLIPLoader",
              "widgets_values": [name, "qwen_image", "default"]}
             for nid, name in names_with_ids]
    return json.dumps({"nodes": nodes, "links": [], "version": 0.4},
                      ensure_ascii=False, indent=2)


class TestAdaptOnRead:
    def test_win_engine_swaps_canonical_to_int8(self, tmp_path, monkeypatch):
        """Win 实况=只有官方量化件:正典名服务时换算成在盘名,其余字节零动。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "1_图片"
        sub.mkdir(parents=True)
        text = _wf_text([(11, CANON_T2I), (4019, CANON_I2I)])
        (sub / "qi21.json").write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names",
                            lambda: {INT8_T2I, INT8_I2I, HERETIC})
        served = pm.read_workflow("repo:1_图片/qi21.json")["content"]
        expected = text.replace(CANON_T2I, INT8_T2I).replace(CANON_I2I, INT8_I2I)
        assert served == expected
        assert json.loads(served)["nodes"][0]["widgets_values"][0] == INT8_T2I

    def test_mac_engine_with_bf16_keeps_bytes(self, tmp_path, monkeypatch):
        """Mac 实况=正典件在盘:原样服务,逐字节相等。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "1_图片"
        sub.mkdir(parents=True)
        text = _wf_text([(4019, CANON_I2I)])
        (sub / "qi21.json").write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names",
                            lambda: {CANON_T2I, CANON_I2I, HERETIC})
        assert pm.read_workflow("repo:1_图片/qi21.json")["content"] == text

    def test_engine_unreachable_fail_open(self, tmp_path, monkeypatch):
        """引擎不可达=None → fail-open 原样(与既有行为一致)。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "1_图片"
        sub.mkdir(parents=True)
        text = _wf_text([(4019, CANON_I2I)])
        (sub / "qi21.json").write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names", lambda: None)
        assert pm.read_workflow("repo:1_图片/qi21.json")["content"] == text

    def test_group_absent_on_engine_no_swap(self, tmp_path, monkeypatch):
        """组内两件都不在引擎(如只挂 heretic 的最小机):不换,维持原值。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "1_图片"
        sub.mkdir(parents=True)
        text = _wf_text([(4019, CANON_I2I)])
        (sub / "qi21.json").write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names", lambda: {HERETIC})
        assert pm.read_workflow("repo:1_图片/qi21.json")["content"] == text

    def test_bidirectional_int8_to_canonical(self, tmp_path, monkeypatch):
        """官方模板引用量化名、引擎只有 bf16 件时反向换算(社区件在 Mac 同病)。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "3_社区模板"
        sub.mkdir(parents=True)
        text = _wf_text([(21, INT8_T2I), (22, INT8_I2I)])
        (sub / "官方PE.json").write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names",
                            lambda: {CANON_T2I, CANON_I2I})
        served = pm.read_workflow("repo:3_社区模板/官方PE.json")["content"]
        expected = text.replace(INT8_T2I, CANON_T2I).replace(INT8_I2I, CANON_I2I)
        assert served == expected

    def test_non_pe_workflow_never_queries_engine(self, tmp_path, monkeypatch):
        """无 PE 名的件零探测(早卫兵):非 PE 库全量不受任何影响。"""
        _, repo = _use_tmp_home(tmp_path, monkeypatch)
        sub = repo / "2_视频"
        sub.mkdir(parents=True)
        text = _wf_text([(100, HERETIC)])
        (sub / "三采.json").write_text(text, encoding="utf-8")

        def _boom():
            raise AssertionError("非 PE 件不应探测引擎")
        monkeypatch.setattr(pm, "_engine_clip_loader_names", _boom)
        assert pm.read_workflow("repo:2_视频/三采.json")["content"] == text

    def test_engine_home_copy_also_adapted(self, tmp_path, monkeypatch):
        """引擎家用户区克隆件同款换算(服务层统一口径,不分 repo/本地支路)。"""
        home, _ = _use_tmp_home(tmp_path, monkeypatch)
        target = cm.workflows_dir() / "克隆-qi21-i2i.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        text = _wf_text([(4019, CANON_I2I)])
        target.write_text(text, encoding="utf-8")
        monkeypatch.setattr(pm, "_engine_clip_loader_names", lambda: {INT8_I2I})
        served = pm.read_workflow("克隆-qi21-i2i.json")["content"]
        assert served == text.replace(CANON_I2I, INT8_I2I)


class TestRealRepoCanvas:
    def test_daojie_i2i_canvas_served_win_adapted(self, tmp_path, monkeypatch):
        """正典件实弹:道劫-i2i 画布(widget+内嵌子图+说明文案)全量换净且仍合法 JSON。"""
        _, _repo = _use_tmp_home(tmp_path, monkeypatch)
        real = (Path(__file__).resolve().parents[1] / "workflows" / "1_图片"
                / "QwenImage2.1" / "2_图生图" / "qi21-道劫-i2i.json")
        repo_root = real.parents[3]
        monkeypatch.setattr(cm, "repo_workflows_dir", lambda: repo_root, raising=False)
        monkeypatch.setattr(pm, "_engine_clip_loader_names", lambda: {INT8_I2I})
        served = pm.read_workflow(
            "repo:1_图片/QwenImage2.1/2_图生图/qi21-道劫-i2i.json")["content"]
        assert CANON_I2I not in served
        assert INT8_I2I in served
        json.loads(served)  # 换算后仍是合法 JSON(画布可开)


class TestEngineClipNamesProbe:
    """探测函数本体:假 urlopen_outbound 验解析/阶梯/fail-open,零网络。"""

    @staticmethod
    def _fake_urlopen(monkeypatch, payload):
        class _Resp:
            def __init__(self, data):
                self._data = data

            def read(self):
                return self._data

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False
        monkeypatch.setattr(pm, "urlopen_outbound",
                            lambda req, timeout: _Resp(json.dumps(payload).encode("utf-8")))
        monkeypatch.setattr("engines.image_engine.comfyui_bridge.bridge_url",
                            lambda: "http://127.0.0.1:17000", raising=False)

        def _no_engine():
            raise pm.EngineOpError("无自管实例")
        monkeypatch.setattr(pm, "engine_manager", _no_engine)

    def test_extracts_combo(self, monkeypatch):
        self._fake_urlopen(monkeypatch, {"CLIPLoader": {"input": {"required": {
            "clip_name": [["a.safetensors", "b.safetensors"], {}]}}}})
        assert pm._engine_clip_loader_names() == {"a.safetensors", "b.safetensors"}

    def test_bad_structure_returns_none(self, monkeypatch):
        self._fake_urlopen(monkeypatch, {"unexpected": True})
        assert pm._engine_clip_loader_names() is None

    def test_unreachable_returns_none(self, monkeypatch):
        def _boom(req, timeout):
            raise OSError("engine down")
        monkeypatch.setattr(pm, "urlopen_outbound", _boom)
        monkeypatch.setattr("engines.image_engine.comfyui_bridge.bridge_url",
                            lambda: "http://127.0.0.1:17000", raising=False)

        def _no_engine():
            raise pm.EngineOpError("无自管实例")
        monkeypatch.setattr(pm, "engine_manager", _no_engine)
        assert pm._engine_clip_loader_names() is None

    def test_second_candidate_rescues(self, monkeypatch, tmp_path):
        """桥解算坠落死口(17598)时,阶梯二段 engine_url 救回。"""
        seen = []

        def _fake(req, timeout):
            seen.append(req.full_url)
            if "17598" in req.full_url:
                raise OSError("dead port")
            return type("R", (), {
                "read": lambda s: json.dumps({"CLIPLoader": {"input": {"required": {
                    "clip_name": [["x.safetensors"], {}]}}}}).encode("utf-8"),
                "__enter__": lambda s: s, "__exit__": lambda s, *a: False})()

        class _FakeEngine:
            @staticmethod
            def engine_url():
                return "http://127.0.0.1:17000"

        monkeypatch.setattr(pm, "urlopen_outbound", _fake)
        monkeypatch.setattr("engines.image_engine.comfyui_bridge.bridge_url",
                            lambda: "http://127.0.0.1:17598", raising=False)
        monkeypatch.setattr(pm, "engine_manager", lambda: _FakeEngine())
        assert pm._engine_clip_loader_names() == {"x.safetensors"}
        assert seen[0].endswith("17598/object_info/CLIPLoader")
