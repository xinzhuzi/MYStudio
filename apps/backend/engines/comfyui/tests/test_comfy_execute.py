"""comfy_execute 单测(09-08 二期/三期收官):假引擎 HTTP stub 驱动全链。

覆盖:请求校验/字符串注入/图片上传注入/提交 node_errors 翻译/history 轮询
收图/超时中断/单类 object_info 详情瘦身。假引擎=线程化 http.server,只实现
/upload/image、/prompt、/history/{id}、/view、/object_info/{class}。
"""
from __future__ import annotations

import base64
import copy
import json
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import pytest

from engines.comfyui import execute as comfy_execute
from engines.comfyui.engine_manager import EngineOpError


PNG_B64 = base64.b64encode(b"fake-png-bytes").decode("ascii")


class FakeComfyEngine:
    """假 ComfyUI 引擎:可编程的 /prompt 应答与 history 状态机。"""

    def __init__(self):
        self.uploaded: list[tuple[str, bytes]] = []
        self.prompts: list[dict] = []
        self.prompt_replies: list[dict] = []          # 逐次 /prompt 应答(耗尽后用最后一条)
        self.histories: dict[str, dict] = {}
        self.default_history: dict = {}
        self.interrupts = list[str]()
        self.cancelled_prompts: list[str] = []
        self.view_bodies: dict[str, bytes] = {}
        handler = self._build_handler()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def close(self):
        self.server.shutdown()
        self.server.server_close()

    def queue_success(self, images=("out-1.png",), audios=(), texts=(), prompt_id="p-1", delay_s=0.0):
        """编程一次成功执行:images 进 ui["images"],audios 进 ui["audio"],texts 进 ui["text"]。"""
        self.prompt_replies.append({"prompt_id": prompt_id})
        outputs = {}
        if images:
            outputs["11"] = {"images": [
                {"filename": name, "subfolder": "", "type": "output"} for name in images
            ]}
        if audios:
            outputs["12"] = {"audio": [
                {"filename": name, "subfolder": "", "type": "output"} for name in audios
            ]}
        if texts:
            outputs["14"] = {"text": list(texts)}
        self.histories[prompt_id] = {
            "status": {"status_str": "success" if not delay_s else "executing"},
            "outputs": outputs,
        }
        if delay_s:
            def _flip():
                time.sleep(delay_s)
                self.histories[prompt_id]["status"]["status_str"] = "success"
            threading.Thread(target=_flip, daemon=True).start()

    def _build_handler(self):
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, fmt, *args):  # noqa: N802
                pass

            def _json(self, payload, status=HTTPStatus.OK):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):  # noqa: N802
                if self.path.startswith("/api/jobs/") and self.path.endswith("/cancel"):
                    length = int(self.headers.get("Content-Length", "0") or 0)
                    self.rfile.read(length)
                    outer.cancelled_prompts.append(self.path.split("/")[3])
                    self._json({"cancelled": True})
                    return
                if self.path == "/upload/image":
                    length = int(self.headers.get("Content-Length", "0") or 0)
                    raw = self.rfile.read(length)
                    filename = "uploaded-%d.png" % (len(outer.uploaded) + 1)
                    outer.uploaded.append((filename, raw))
                    self._json({"name": filename, "subfolder": "", "type": "input"})
                    return
                if self.path == "/prompt":
                    length = int(self.headers.get("Content-Length", "0") or 0)
                    outer.prompts.append(json.loads(self.rfile.read(length).decode("utf-8")))
                    reply = outer.prompt_replies[-1] if outer.prompt_replies else {"prompt_id": "p-x"}
                    status = HTTPStatus.OK
                    if reply.get("node_errors") and not reply.get("prompt_id"):
                        status = HTTPStatus.BAD_REQUEST
                    self._json(reply, status)
                    return
                if self.path == "/interrupt":
                    outer.interrupts.append("interrupt")
                    self._json({})
                    return
                self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

            def do_GET(self):  # noqa: N802
                if self.path.startswith("/history/"):
                    prompt_id = self.path.rsplit("/", 1)[-1]
                    entry = outer.histories.get(prompt_id)
                    # 真实 ComfyUI /history/{id} 应答形如 {prompt_id: {...}}
                    self._json({prompt_id: entry} if entry is not None else outer.default_history)
                    return
                if self.path.startswith("/view"):
                    # 按引擎文件名回体(测音频/图片分文件);未编排的回落默认体
                    query_filename = parse_qs(urlparse(self.path).query).get("filename", [None])[-1]
                    body = outer.view_bodies.get(query_filename) or outer.view_bodies.get("default", b"view-image-bytes")
                    self.send_response(HTTPStatus.OK)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
                if self.path.startswith("/object_info/"):
                    class_type = self.path.rsplit("/", 1)[-1]
                    if class_type == "KSampler":
                        self._json({"KSampler": {
                            "input": {
                                "seed": ["INT", {"default": 0, "min": 0, "max": 100}],
                                "sampler_name": [["euler", "euler_ancestral"]],
                                "model": [["MODEL"]],
                            },
                            "output": ["LATENT"],
                            "name": "KSampler",
                            "category": "sampling",
                        }})
                    else:
                        self._json({}, HTTPStatus.NOT_FOUND)
                    return
                self._json({"error": "not found"}, HTTPStatus.NOT_FOUND)

        return Handler


@pytest.fixture()
def engine(monkeypatch):
    fake = FakeComfyEngine().start()
    monkeypatch.setattr(comfy_execute, "_engine_url", lambda: fake.url)
    yield fake
    fake.close()


def _graph_fixture() -> dict:
    return {
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": "默认文本", "clip": ["4", 0]}},
        "10": {"class_type": "LoadImage", "inputs": {"image": "placeholder.png"}},
        "11": {"class_type": "SaveImage", "inputs": {"images": ["9", 0], "filename_prefix": "mystudio"}},
    }


def _wait_job_terminal(job_id: str, timeout_s: float = 10.0) -> dict:
    from engines.comfyui.engine_manager import jobs

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        job = jobs.get(job_id)
        if job and job.get("status") != "running":
            return job
        time.sleep(0.02)
    raise AssertionError("job 未在时限内到终态")


class TestValidation:
    def test_rejects_empty_or_malformed_graph(self):
        with pytest.raises(ValueError):
            comfy_execute.validate_execute_request({"graph": {}})
        with pytest.raises(ValueError):
            comfy_execute.validate_execute_request({"graph": {"1": {"inputs": {}}}})
        with pytest.raises(ValueError):
            comfy_execute.validate_execute_request({})

    def test_rejects_bad_strings_and_images_shape(self):
        graph = _graph_fixture()
        with pytest.raises(ValueError):
            comfy_execute.validate_execute_request({"graph": graph, "inputs": {"strings": {"a": 1}}})
        with pytest.raises(ValueError):
            comfy_execute.validate_execute_request({"graph": graph, "inputs": {"images": [{"key": "a"}]}})

    def test_ok_payload_passes(self):
        graph, strings, images = comfy_execute.validate_execute_request({
            "graph": _graph_fixture(),
            "inputs": {"strings": {"6.text": "x"}, "images": [{"key": "10.image", "name": "a.png", "b64": PNG_B64}]},
        })
        assert strings == {"6.text": "x"}
        assert images[0]["key"] == "10.image"


class TestInjections:
    def test_string_injection_sets_widget_value(self):
        graph = _graph_fixture()
        comfy_execute.apply_string_injections(graph, {"6.text": "一只猫"})
        assert graph["6"]["inputs"]["text"] == "一只猫"

    def test_string_injection_unknown_node_rejected(self):
        graph = _graph_fixture()
        with pytest.raises(ValueError, match="不在工作流里"):
            comfy_execute.apply_string_injections(graph, {"99.text": "x"})

    def test_string_injection_unknown_field_rejected(self):
        graph = _graph_fixture()
        with pytest.raises(ValueError, match="没有 no_such"):
            comfy_execute.apply_string_injections(graph, {"6.no_such": "x"})

    def test_image_injection_uploads_and_sets_filename(self):
        graph = _graph_fixture()
        calls = []

        def uploader(b64, name):
            calls.append((b64, name))
            return "uploaded-1.png"

        comfy_execute.apply_image_injections(graph, [{"key": "10.image", "name": "in.png", "b64": PNG_B64}], uploader)
        assert graph["10"]["inputs"]["image"] == "uploaded-1.png"
        assert calls == [(PNG_B64, "in.png")]


class TestExecuteJob:
    def test_end_to_end_success_uploads_polls_and_collects(self, engine):
        engine.queue_success(images=("out-1.png",))
        job_id = comfy_execute.execute_job({
            "graph": _graph_fixture(),
            "inputs": {
                "strings": {"6.text": "一只猫"},
                "images": [{"key": "10.image", "name": "in.png", "b64": PNG_B64}],
            },
        })
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        result = job["result"]
        assert result["promptId"] == "p-1"
        assert len(result["images"]) == 1
        assert result["images"][0]["filename"] == "out-1.png"
        assert base64.b64decode(result["images"][0]["b64"]) == b"view-image-bytes"
        # 提交给引擎的 graph 已含注入:字符串改写+文件名替换
        submitted_graph = engine.prompts[0]["prompt"]
        assert submitted_graph["6"]["inputs"]["text"] == "一只猫"
        assert submitted_graph["10"]["inputs"]["image"] == "uploaded-1.png"
        assert len(engine.uploaded) == 1

    def test_node_errors_translated_to_plain_error(self, engine):
        engine.prompt_replies.append({"node_errors": {"10": ["image not found"]}})
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "error"
        assert "引擎拒绝工作流" in job["error"]

    @pytest.mark.parametrize("outcome", ["success", "error", "timeout"])
    def test_partial_acceptance_retains_prompt_and_warnings_through_terminal_state(self, engine, monkeypatch, outcome):
        node_errors = {"bad-output": {"errors": [{"message": "Required input is missing"}]}}
        engine.prompt_replies.append({"prompt_id": "p-partial", "node_errors": node_errors})
        if outcome == "success":
            engine.histories["p-partial"] = {"status": {"status_str": "success"}, "outputs": {
                "11": {"images": [{"filename": "out.png"}]},
            }}
        elif outcome == "error":
            engine.histories["p-partial"] = {"status": {"status_str": "error", "messages": "OOM"}}
        monkeypatch.setattr(comfy_execute, "EXECUTE_TIMEOUT_S", 0.1)
        monkeypatch.setattr(comfy_execute, "HISTORY_POLL_INTERVAL_S", 0.01)
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == ("complete" if outcome == "success" else "error"), job
        assert job["result"]["promptId"] == "p-partial"
        assert job["result"]["nodeErrors"] == node_errors
        assert job["result"]["warnings"]
        assert any("p-partial" in line and "bad-output" in line for line in job["tail"])
        if outcome == "success":
            assert base64.b64decode(job["result"]["images"][0]["b64"]) == b"view-image-bytes"
        elif outcome == "error":
            assert "OOM" in job["error"]
        else:
            assert "超时" in job["error"]
            assert engine.cancelled_prompts == ["p-partial"]

    def test_accepted_prompt_metadata_is_visible_without_completing_running_job(self, monkeypatch):
        node_errors = {"bad-output": {"errors": ["missing input"]}}
        job_id = comfy_execute.jobs.create("comfy-execute")

        def http_json(method, url, payload=None, timeout=10):
            if method == "POST":
                return {"prompt_id": "p-pending", "node_errors": node_errors}
            pending = comfy_execute.jobs.get(job_id)
            assert pending["status"] == "running"
            assert pending["result"]["promptId"] == "p-pending"
            assert pending["result"]["nodeErrors"] == node_errors
            return {"p-pending": {"status": {"status_str": "error", "messages": "probe-end"}}}

        monkeypatch.setattr(comfy_execute, "_http_json", http_json)
        comfy_execute._execute_target(job_id, _graph_fixture(), {}, [])
        assert "probe-end" in comfy_execute.jobs.get(job_id)["error"]

    def test_history_error_state_surfaces_message(self, engine):
        engine.prompt_replies.append({"prompt_id": "p-err"})
        engine.histories["p-err"] = {"status": {"status_str": "error", "messages": "OOM"}}
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "error"
        assert "OOM" in job["error"]

    def test_no_output_images_is_plain_error(self, engine):
        engine.queue_success(images=())
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "error"
        assert "没有输出图片" in job["error"]

    def test_timeout_interrupts_and_errors(self, engine, monkeypatch):
        monkeypatch.setattr(comfy_execute, "EXECUTE_TIMEOUT_S", 0.2)
        monkeypatch.setattr(comfy_execute, "HISTORY_POLL_INTERVAL_S", 0.02)
        engine.prompt_replies.append({"prompt_id": "p-slow"})
        engine.histories["p-slow"] = {"status": {"status_str": "executing"}, "outputs": {}}
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "error"
        assert "超时" in job["error"]
        assert engine.cancelled_prompts == ["p-slow"]
        assert engine.interrupts == []

    def test_job_progress_walks_stages(self, engine):
        engine.queue_success(images=("a.png", "b.png"))
        job_id = comfy_execute.execute_job({
            "graph": _graph_fixture(),
            "inputs": {"images": [{"key": "10.image", "name": "in.png", "b64": PNG_B64}]},
        })
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete"
        # 终态进度=100,消息链含关键阶段字样(结果消息只保留最后一条)
        assert job["progress"] == 100

    # ── 音频输出收集(09-20 YuE2 BGM 接线) ──────────────────────────

    def test_audio_only_success_collects_audios(self, engine):
        """无图有音:不再走『没有输出图片』报错,audios 带回 /view 的 b64。"""
        engine.queue_success(images=(), audios=("YuE2-BGM_00001_.flac",))
        engine.view_bodies["YuE2-BGM_00001_.flac"] = b"fake-flac-bytes"
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        result = job["result"]
        assert result["images"] == []
        assert len(result["audios"]) == 1
        assert result["audios"][0]["filename"] == "YuE2-BGM_00001_.flac"
        assert result["audios"][0]["nodeId"] == "12"
        assert base64.b64decode(result["audios"][0]["b64"]) == b"fake-flac-bytes"

    def test_images_and_audios_mixed_collects_both(self, engine):
        engine.queue_success(images=("out-1.png",), audios=("bgm.flac", "bgm-2.flac"))
        engine.view_bodies["bgm.flac"] = b"fake-flac-bytes"
        engine.view_bodies["bgm-2.flac"] = b"fake-flac-bytes-2"
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        result = job["result"]
        assert [item["filename"] for item in result["images"]] == ["out-1.png"]
        assert [item["filename"] for item in result["audios"]] == ["bgm.flac", "bgm-2.flac"]
        assert base64.b64decode(result["audios"][1]["b64"]) == b"fake-flac-bytes-2"

    # ── 文本输出收集(09-20 YuE2 出谱流接线:PreviewAny 类 ui["text"]) ──

    def test_text_only_success_collects_texts(self, engine):
        """无图无音有文本:空输出守卫放行,texts 原样内联回带(不走 /view)。"""
        abc_text = "X:1\nT:test\nK:G\n| c'2 |"
        engine.queue_success(images=(), audios=(), texts=(abc_text,))
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        result = job["result"]
        assert result["images"] == []
        assert result["audios"] == []
        assert result["texts"] == [{"nodeId": "14", "text": abc_text}]

    def test_texts_and_audios_mixed_collects_both(self, engine):
        """出谱+渲染同链:文本与音频同时收,texts 逐条保序。"""
        engine.queue_success(images=(), audios=("bgm.flac",), texts=("X:1\nfirst", "X:2\nsecond"))
        engine.view_bodies["bgm.flac"] = b"fake-flac-bytes"
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        result = job["result"]
        assert [item["filename"] for item in result["audios"]] == ["bgm.flac"]
        assert [item["text"] for item in result["texts"]] == ["X:1\nfirst", "X:2\nsecond"]
        assert [item["nodeId"] for item in result["texts"]] == ["14", "14"]

    def test_non_string_text_entries_skipped(self, engine):
        """ui["text"] 里混非 str 条目只收 str(引擎异常形状不炸不脏结果)。"""
        engine.queue_success(images=(), audios=(), texts=("X:1\nok",))
        engine.histories["p-1"]["outputs"]["14"] = {"text": ["X:1\nok", None, 42, {"bad": "shape"}]}
        job_id = comfy_execute.execute_job({"graph": _graph_fixture(), "inputs": {}})
        job = _wait_job_terminal(job_id)
        assert job["status"] == "complete", job
        assert job["result"]["texts"] == [{"nodeId": "14", "text": "X:1\nok"}]

    def test_timeout_s_payload_overrides_module_default(self, engine, monkeypatch):
        """payload.timeoutS 生效:0.3s 压过模块默认 30s → 快速超时+interrupt;
        纯函数口径:缺省回落默认、非法回落默认、超上限钳到 MAX_EXECUTE_TIMEOUT_S。"""
        monkeypatch.setattr(comfy_execute, "EXECUTE_TIMEOUT_S", 30.0)
        monkeypatch.setattr(comfy_execute, "HISTORY_POLL_INTERVAL_S", 0.02)
        engine.prompt_replies.append({"prompt_id": "p-slow"})
        engine.histories["p-slow"] = {"status": {"status_str": "executing"}, "outputs": {}}
        job_id = comfy_execute.execute_job({
            "graph": _graph_fixture(),
            "inputs": {},
            "timeoutS": 0.3,
        })
        job = _wait_job_terminal(job_id)  # 模块默认 30s 下若 timeoutS 不生效会超 10s 断言
        assert job["status"] == "error"
        assert "超时" in job["error"]
        assert "1 秒" in job["error"]  # ceil(0.3) 的人话秒数
        assert engine.cancelled_prompts == ["p-slow"]
        assert engine.interrupts == []
        assert comfy_execute.resolve_execute_timeout_s({}) == 30.0
        assert comfy_execute.resolve_execute_timeout_s({"timeoutS": "oops"}) == 30.0
        assert comfy_execute.resolve_execute_timeout_s({"timeoutS": 0}) == 30.0
        assert comfy_execute.resolve_execute_timeout_s({"timeoutS": 999999}) == comfy_execute.MAX_EXECUTE_TIMEOUT_S


class TestObjectInfoDetail:
    def test_detail_trims_and_keeps_shape(self, engine):
        detail = comfy_execute.object_info_detail("KSampler")
        assert detail["input"]["seed"][0] == "INT"
        assert detail["input"]["model"] == [["MODEL"]]
        assert detail["category"] == "sampling"

    def test_unknown_class_raises_plain_error(self, engine):
        with pytest.raises(EngineOpError, match="没有名为"):
            comfy_execute.object_info_detail("NoSuchNode")

    def test_trim_options_caps_long_combo(self):
        spec = [f"model-{i}.safetensors" for i in range(1200)]
        trimmed = comfy_execute._trim_options(spec)
        assert len(trimmed) <= comfy_execute.OBJECT_INFO_MAX_OPTIONS + 1
        short = ["a", "b"]
        assert comfy_execute._trim_options(short) == short

    def test_nested_groups_bound_options_and_preserve_defaults_metadata(self):
        options = [f"model-{i}" for i in range(1200)]
        entry = {
            "input": {
                "required": {"model": [options, {"default": "model-1100", "tooltip": "model"}]},
                "optional": {"model": [options, {"default": "model-900"}]},
                "hidden": {"prompt": "PROMPT", "unique_id": "UNIQUE_ID"},
            },
            "input_order": {"required": ["model"]},
            "output": ["MODEL"], "output_is_list": [False], "output_node": False,
        }
        original = copy.deepcopy(entry)
        detail = comfy_execute.trim_object_info_entry(entry)
        for group in ("required", "optional"):
            spec = detail["input"][group]["model"]
            assert len(spec[0]) <= comfy_execute.OBJECT_INFO_MAX_OPTIONS
            assert spec[1]["default"] in spec[0]
            assert spec[1] == entry["input"][group]["model"][1]
        assert detail["input"]["hidden"] == entry["input"]["hidden"]
        assert detail["input_order"] == entry["input_order"]
        assert detail["output_is_list"] == [False]
        assert detail["output_node"] is False
        assert entry == original
        detail["input"]["required"]["model"][0].append("changed")
        detail["input"]["required"]["model"][1]["tooltip"] = "changed"
        assert entry == original

    def test_flat_combo_with_metadata_remains_supported(self):
        entry = {"input": {"choice": [list(range(1200)), {"default": 1100}]}}
        result = comfy_execute.trim_object_info_entry(entry)
        spec = result["input"]["choice"]
        assert len(spec[0]) <= comfy_execute.OBJECT_INFO_MAX_OPTIONS
        assert 1100 in spec[0]
        assert spec[1] == {"default": 1100}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf"), "NaN", "Infinity", True, False])
def test_invalid_timeout_falls_back_to_finite_default(value):
    assert comfy_execute.resolve_execute_timeout_s({"timeoutS": value}) == comfy_execute.EXECUTE_TIMEOUT_S
